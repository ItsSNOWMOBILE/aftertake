import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cueEnvelope,
  projectSchema,
  recipeSchema,
  renderDimensions,
  renderSettingsKey,
  type Recipe,
} from '../src/domain.js';
import { buildWorkflow, requirements } from '../server/workflow.js';
import {
  cameraMovements,
  cameraTracks,
  cinemaOptions,
  cinemaPrompt,
  cinemaSchema,
  defaultCinema,
  movementNotes,
  promptOnlyMovements,
} from '../src/cinema.js';
import { spatialMask } from '../src/mask.js';
const recipe: Recipe = {
  format: 'aftertake/1',
  name: 'Test take',
  clip: {
    id: 'a7e24e70-2168-4e9c-b97f-06ae1401f558',
    name: 'source.mp4',
    sha256: 'a'.repeat(64),
    width: 1920,
    height: 1080,
    duration: 5,
    url: '/media/test.mp4',
  },
  prompt: 'Living vines on concrete',
  cue: {
    start: 0.4,
    end: 2.9,
    fade: 0.4,
    feather: 0.05,
    strokes: [{ radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }],
  },
  seed: 42,
  quality: 'draft',
  trimStart: 0,
};
test('temporal cue is zero outside the interval and smoothly reaches full strength', () => {
  assert.equal(cueEnvelope(0, recipe.cue), 0);
  assert.equal(cueEnvelope(0.4, recipe.cue), 0);
  assert.equal(cueEnvelope(0.6, recipe.cue), 0.4999999999999998);
  assert.equal(cueEnvelope(1.2, recipe.cue), 1);
  assert.equal(cueEnvelope(3, recipe.cue), 0);
  assert.equal(cueEnvelope(0.4, { ...recipe.cue, fade: 0 }), 1);
});
test('short and portrait videos produce valid LTX geometry near the source aspect ratio', () => {
  for (const [width, height, duration] of [
    [1920, 1080, 5],
    [1080, 1920, 1.1],
    [1000, 1000, 2],
  ]) {
    const d = renderDimensions({ ...recipe, clip: { ...recipe.clip, width, height, duration } });
    assert.equal(d.width % 32, 0);
    assert.equal(d.height % 32, 0);
    assert.equal((d.frames - 1) % 8, 0);
    assert.ok(d.duration <= duration);
    assert.ok(Math.abs(d.width / d.height - width / height) < 0.04);
  }
  assert.throws(() => renderDimensions({ ...recipe, trimStart: 4.9 }), /too short/);
});
test('invalid recipes cannot request unbounded masks or arbitrary source URLs', () => {
  assert.equal(recipeSchema.safeParse(recipe).success, true);
  assert.equal(
    recipeSchema.safeParse({ ...recipe, clip: { ...recipe.clip, url: 'file:///secret' } }).success,
    false,
  );
  assert.equal(
    recipeSchema.safeParse({ ...recipe, cue: { ...recipe.cue, end: 0.2 } }).success,
    false,
  );
  assert.equal(recipeSchema.safeParse({ ...recipe, seed: -1 }).success, false);
});
test('an unpainted project survives save and reload while generation still needs paint', () => {
  const empty = { ...recipe, cue: { ...recipe.cue, strokes: [] } };
  assert.equal(projectSchema.safeParse(JSON.parse(JSON.stringify(empty))).success, true);
  assert.equal(recipeSchema.safeParse(empty).success, false);
  const erased = {
    ...empty,
    cue: { ...empty.cue, strokes: [{ mode: 'erase', radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }] },
  };
  assert.equal(projectSchema.safeParse(erased).success, true);
  assert.equal(recipeSchema.safeParse(erased).success, false);
});
test('render matching follows source content and settings, independent of local names or ids', () => {
  const remapped = {
    ...recipe,
    name: 'Renamed project',
    clip: {
      ...recipe.clip,
      id: '00000000-0000-0000-0000-000000000001',
      url: '/media/remapped.mp4',
    },
    pipeline: 'structure' as const,
    directionStrength: 1,
    cue: { ...recipe.cue, tracking: 'static' as const, anchor: 0 },
  };
  assert.equal(renderSettingsKey(recipe), renderSettingsKey(remapped));
  assert.notEqual(renderSettingsKey(recipe), renderSettingsKey({ ...recipe, seed: 43 }));
  assert.notEqual(
    renderSettingsKey(recipe),
    renderSettingsKey({ ...recipe, cue: { ...recipe.cue, end: 2.5 } }),
  );
});
test('workflow connects the same cue to generation guidance and final compositing', () => {
  const graph = buildWorkflow(recipe) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;
  assert.deepEqual(graph['12'].inputs.attention_mask, ['9', 1]);
  assert.deepEqual(graph['20'].inputs.mask, ['9', 0]);
  assert.deepEqual(graph['20'].inputs.original, ['8', 0]);
  assert.deepEqual(graph['21'].inputs.source_audio, ['8', 1]);
  assert.equal(graph['21'].inputs.audio_start, recipe.trimStart);
  assert.equal('source_audio' in graph['22'].inputs, false);
  assert.equal(JSON.parse(String(graph['21'].inputs.recipe_json)).seed, 42);
  assert.equal(
    Object.values(graph).some((node) => /API|Partner|Router/.test(node.class_type)),
    false,
  );
});
test('editor mask has a fully selected center and zero outside the brush', () => {
  const pixels = spatialMask(128, 64, recipe.cue);
  assert.equal(pixels[(32 * 128 + 64) * 4 + 3], 255);
  assert.equal(pixels[(2 * 128 + 64) * 4 + 3], 0);
});
test('eraser protects an interior region and later paint restores it', () => {
  const paint = { radius: 0.2, points: [{ x: 0.5, y: 0.5 }] };
  const erase = { ...paint, radius: 0.1, mode: 'erase' as const };
  const cue = { ...recipe.cue, feather: 0.01, strokes: [paint, erase] };
  assert.equal(spatialMask(128, 64, cue)[(32 * 128 + 64) * 4 + 3], 0);
  assert.equal(spatialMask(128, 64, cue)[(32 * 128 + 72) * 4 + 3], 255);
  cue.strokes.push({ ...paint, radius: 0.05 });
  assert.equal(spatialMask(128, 64, cue)[(32 * 128 + 64) * 4 + 3], 255);
});
test('native inpainting uses the masked source plate instead of structural edges', () => {
  const graph = buildWorkflow({ ...recipe, pipeline: 'inpaint' }) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;
  assert.equal(graph['2'].class_type, 'CLIPLoader');
  assert.equal(graph['10'].class_type, 'LTXVInpaintPreprocess');
  assert.deepEqual(graph['10'].inputs.images, ['8', 0]);
  assert.deepEqual(graph['23'].inputs.mask, ['9', 2]);
  assert.equal('attention_mask' in graph['12'].inputs, false);
  assert.deepEqual(graph['20'].inputs.mask, ['9', 0]);
});
test('finish workflows have complete acyclic links and refine to the requested size', () => {
  for (const pipeline of ['structure', 'inpaint'] as const) {
    const r = { ...recipe, pipeline, quality: 'final' as const };
    const graph = buildWorkflow(r) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    const visited = new Set<string>(),
      visiting = new Set<string>();
    const visit = (id: string) => {
      assert.ok(graph[id], `Missing referenced node ${id}`);
      if (visited.has(id)) return;
      assert.equal(visiting.has(id), false, `Cycle at ${id}`);
      visiting.add(id);
      for (const input of Object.values(graph[id].inputs))
        if (Array.isArray(input) && typeof input[0] === 'string') visit(input[0]);
      visiting.delete(id);
      visited.add(id);
    };
    Object.keys(graph).forEach(visit);
    if (pipeline === 'inpaint') {
      const d = renderDimensions(r);
      assert.equal(graph['29'].inputs.width, d.width);
      assert.equal(graph['29'].inputs.height, d.height);
      assert.ok(Number(graph['11'].inputs.width) < d.width);
      assert.equal(graph['33'].class_type, 'SamplerCustomAdvanced');
      assert.deepEqual(graph['20'].inputs.original, ['8', 0]);
      assert.deepEqual(graph['20'].inputs.mask, ['9', 0]);
    }
  }
});

test('bounded LTX shots retain their temporal context through every video codec', () => {
  // Short external tiles blend different versions of moving edges. Keep the
  // whole shot available to the native codec (or any future explicit tiler).
  for (const pipeline of ['structure', 'inpaint', 'cinema'] as const)
    for (const quality of ['draft', 'final'] as const)
      for (const [width, height] of [
        [1920, 1080],
        [1080, 1920],
      ]) {
        const r = { ...recipe, pipeline, quality, clip: { ...recipe.clip, width, height } };
        const frames = renderDimensions(r).frames;
        const graph = buildWorkflow(r) as Record<
          string,
          { class_type: string; inputs: Record<string, unknown> }
        >;
        for (const node of Object.values(graph))
          if (/^VAE(?:Encode|Decode)Tiled$/.test(node.class_type))
            assert.ok(
              Number(node.inputs.temporal_size) >= frames,
              `${pipeline}/${quality} resets temporal context`,
            );
      }
});

test('frame animation conditions only the opening frame and generates without the masked-edit adapter', () => {
  const r: Recipe = {
    ...recipe,
    pipeline: 'cinema',
    cinema: defaultCinema,
    trimStart: 4.9,
    cue: { ...recipe.cue, strokes: [] },
  };
  assert.equal(recipeSchema.safeParse(r).success, true);
  assert.equal(renderDimensions(r).frames, 49);
  const graph = buildWorkflow(r) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;
  assert.equal(graph['8'].inputs.frames, 1);
  assert.equal(graph['8'].inputs.trim_start, 4.9);
  assert.equal('source_audio' in graph['21'].inputs, false);
  assert.equal(graph['12'].class_type, 'LTXVImgToVideoInplace');
  assert.deepEqual(graph['16'].inputs.model, ['1', 0]);
  assert.deepEqual(graph['21'].inputs.images, ['20', 0]);
  assert.equal(graph['20'].class_type, 'AftertakeFilmGrade');
  assert.equal(
    Object.values(graph).some((n) => /ICLoRA|Composite|CueMask|API/.test(n.class_type)),
    false,
  );
  assert.equal(
    requirements('cinema').menus.some(([, input]) => input === 'lora_name'),
    false,
  );
});

test('cinema settings change the actual encoder prompt and survive a recipe round trip', () => {
  const r: Recipe = {
    ...recipe,
    pipeline: 'cinema',
    cinema: { ...defaultCinema, movement: 'orbit', palette: 'monochrome' },
  };
  const restored = recipeSchema.parse(JSON.parse(JSON.stringify(r)));
  const prompt = cinemaPrompt(restored.prompt, restored.cinema);
  assert.match(prompt, /small smooth arc/);
  assert.match(prompt, /Black-and-white/);
  assert.notEqual(prompt, cinemaPrompt(r.prompt, defaultCinema));
  assert.notEqual(renderSettingsKey(r), renderSettingsKey({ ...r, cinema: defaultCinema }));
  assert.equal(renderSettingsKey(r), renderSettingsKey({ ...r, cue: { ...r.cue, strokes: [] } }));
});

test('still sources animate from frame zero and cannot masquerade as moving footage', () => {
  const still = {
    ...recipe,
    clip: { ...recipe.clip, kind: 'image' as const, duration: 1 },
    pipeline: 'cinema' as const,
    cue: { ...recipe.cue, strokes: [] },
  };
  assert.equal(recipeSchema.safeParse(still).success, true);
  assert.equal(renderDimensions({ ...still, quality: 'final' }).frames, 97);
  assert.equal(recipeSchema.safeParse({ ...still, pipeline: 'inpaint' }).success, false);
  assert.equal(recipeSchema.safeParse({ ...still, trimStart: 0.5 }).success, false);
});

test('framing tracks have the requested temporal direction and enter the actual motion guide', () => {
  const pull = cameraTracks(512, 288, 49, 'pull');
  assert.equal(pull.length, 12);
  for (const track of pull) {
    assert.equal(track.length, 49);
    const startDistance = Math.hypot(track[0].x - 256, track[0].y - 144);
    const endDistance = Math.hypot(track[48].x - 256, track[48].y - 144);
    assert.ok(endDistance < startDistance);
    for (const point of track)
      assert.ok(point.x >= 0 && point.x <= 512 && point.y >= 0 && point.y <= 288);
  }
  for (const track of cameraTracks(512, 288, 49, 'locked')) assert.deepEqual(track[0], track[48]);
  for (const track of cameraTracks(512, 288, 49, 'pan')) assert.ok(track[48].x > track[0].x);
  assert.equal(
    cinemaSchema.safeParse({ ...defaultCinema, movement: 'orbit', guidance: 'tracks' }).success,
    false,
  );
  const r: Recipe = {
    ...recipe,
    pipeline: 'cinema',
    cinema: { ...defaultCinema, movement: 'pull', guidance: 'tracks' },
  };
  const graph = buildWorkflow(r) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;
  const d = renderDimensions(r);
  assert.equal(d.width % 64, 0);
  assert.equal(d.height % 64, 0);
  assert.ok(Math.abs(d.width / d.height - 1920 / 1080) < 0.04);
  assert.deepEqual(
    JSON.parse(String(graph['41'].inputs.tracks)),
    cameraTracks(d.width, d.height, d.frames, 'pull'),
  );
  assert.deepEqual(graph['42'].inputs.image, ['41', 0]);
  assert.deepEqual(graph['17'].inputs.latent_image, ['42', 2]);
  assert.deepEqual(graph['19'].inputs.samples, ['18', 2]);
  assert.deepEqual(graph['44'].inputs.images, ['41', 0]);
  assert.match(String(graph['4'].inputs.lora_name), /motion-track-control/);
});

test('every camera move has wording, a gallery line and on-canvas tracks that go the right way', () => {
  assert.deepEqual(
    cinemaOptions.movement.map(([value]) => value),
    [...cameraMovements],
  );
  const prompts = new Set<string>();
  for (const movement of cameraMovements) {
    assert.ok(movementNotes[movement].length > 10, movement);
    const prompt = cinemaPrompt('A lighthouse at dusk.', { ...defaultCinema, movement }, false);
    prompts.add(prompt.split('.')[0]);
    const tracks = cameraTracks(512, 288, 49, movement);
    assert.equal(tracks.length, promptOnlyMovements.has(movement) ? 0 : 12, movement);
    for (const track of tracks)
      for (const point of track)
        assert.ok(point.x >= 0 && point.x <= 512 && point.y >= 0 && point.y <= 288, movement);
    assert.equal(
      cinemaSchema.safeParse({ ...defaultCinema, movement, guidance: 'tracks' }).success,
      !promptOnlyMovements.has(movement),
      movement,
    );
  }
  assert.equal(prompts.size, cameraMovements.length);
  const middle = (movement: (typeof cameraMovements)[number]) =>
    cameraTracks(512, 288, 49, movement)[5];
  assert.ok(middle('pan-right')[48].x < middle('pan-right')[0].x);
  assert.ok(middle('tilt-up')[48].y > middle('tilt-up')[0].y);
  assert.ok(middle('tilt-down')[48].y < middle('tilt-down')[0].y);
  assert.ok(middle('crane-up')[48].y > middle('crane-up')[0].y);
  // Trucking moves nearer (lower) points further than distant (upper) ones.
  const truck = cameraTracks(512, 288, 49, 'truck');
  assert.ok(truck[9][48].x - truck[9][0].x > truck[1][48].x - truck[1][0].x);
  // A crash zoom holds first, then lands well past a slow push.
  const crash = cameraTracks(512, 288, 49, 'crash-zoom')[0];
  assert.deepEqual(crash[10], crash[0]);
  const push = cameraTracks(512, 288, 49, 'push')[0];
  assert.ok(Math.abs(crash[48].x - 256) > Math.abs(push[48].x - 256));
  const handheld = cameraTracks(512, 288, 49, 'handheld')[5];
  assert.ok(handheld.every((point) => Math.abs(point.x - handheld[0].x) < 512 * 0.04));
  // Optical zooms scale about the centre without the truck's depth parallax.
  const zoomIn = cameraTracks(512, 288, 49, 'zoom-in')[0],
    zoomOut = cameraTracks(512, 288, 49, 'zoom-out')[0];
  assert.ok(Math.abs(zoomIn[48].x - 256) > Math.abs(zoomIn[0].x - 256));
  assert.ok(Math.abs(zoomOut[48].x - 256) < Math.abs(zoomOut[0].x - 256));
  const right = cameraTracks(512, 288, 49, 'truck-right');
  for (const [index, track] of right.entries())
    assert.ok(
      Math.abs(track[48].x - track[0].x + (truck[index][48].x - truck[index][0].x)) < 1e-9,
      'truck right mirrors truck left',
    );
  assert.ok(middle('boom-down')[48].y < middle('boom-down')[0].y);
  // A barrel roll turns points once around the centre, keeping their distance from it.
  const roll = cameraTracks(512, 288, 49, 'barrel-roll')[5];
  const from = { x: roll[0].x - 256, y: roll[0].y - 144 },
    halfway = { x: roll[24].x - 256, y: roll[24].y - 144 };
  assert.ok(Math.abs(halfway.x + from.x) < 1e-9 && Math.abs(halfway.y + from.y) < 1e-9);
  assert.ok(Math.abs(roll[48].x - roll[0].x) < 1e-9 && Math.abs(roll[48].y - roll[0].y) < 1e-9);
  assert.ok(
    roll.some((point) => Math.abs(point.y - 144) > 30),
    'the point leaves the horizon',
  );
  // An impact shake is still before the jolt and has settled by the end.
  const shake = cameraTracks(512, 288, 49, 'impact-shake')[5];
  assert.deepEqual(shake[5], shake[0]);
  assert.ok(shake.some((point) => Math.abs(point.x - shake[0].x) > 5));
  assert.ok(Math.abs(shake[48].x - shake[0].x) < 1);
});
