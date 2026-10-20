import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  displayDimensions,
  renderDimensions,
  renderSettingsKey,
  motionGenerationKey,
  recipeSchema,
  type Recipe,
} from '../src/domain.js';
import { buildWorkflow } from '../server/workflow.js';
import { spatialMask } from '../src/mask.js';
import { cuePreviewSettings } from '../src/cue-target.js';
import { motionFocusGeometry } from '../src/motion-focus.js';

type Graph = Record<string, { class_type: string; inputs: Record<string, any> }>;
const portal = JSON.parse(
  readFileSync(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
) as Recipe;
const hd: Recipe = {
  ...portal,
  resolution: '720p',
  clip: { ...portal.clip, width: 1280, height: 720 },
};

test('720p is an explicit final-quality request and does not change existing dimensions or cache identities', () => {
  assert.equal(renderDimensions(portal).width, 768);
  assert.equal(recipeSchema.safeParse(hd).success, true);
  assert.equal(recipeSchema.safeParse({ ...hd, quality: 'draft' }).success, false);
  assert.equal(
    recipeSchema.safeParse({ ...hd, clip: { ...hd.clip, width: 1000, height: 1000 } }).success,
    false,
  );
  assert.notEqual(renderSettingsKey(hd), renderSettingsKey({ ...hd, resolution: undefined }));
  assert.deepEqual(displayDimensions(hd), { width: 1280, height: 720 });
  assert.deepEqual(renderDimensions(hd), {
    width: 1280,
    height: 736,
    frames: 97,
    fps: 24,
    duration: 97 / 24,
  });
});

test('720p source pixels are padded to the latent grid and cropped at export instead of stretched', () => {
  const graph = buildWorkflow(hd) as Graph;
  assert.equal(graph['8'].inputs.width, 1280);
  assert.equal(graph['8'].inputs.height, 720);
  assert.deepEqual(graph.hd_pad_8.inputs, {
    image: ['8', 0],
    left: 0,
    top: 8,
    right: 0,
    bottom: 8,
    feathering: 0,
  });
  assert.deepEqual(graph['20'].inputs.original, ['hd_pad_8', 0]);
  assert.deepEqual(graph.hd_crop_21.inputs, {
    image: ['20', 0],
    width: 1280,
    height: 720,
    x: 0,
    y: 8,
  });
  assert.deepEqual(graph['21'].inputs.images, ['hd_crop_21', 0]);
  assert.deepEqual(graph['21'].inputs.source_audio, ['8', 1]);
  const cue = JSON.parse(graph['9'].inputs.cue_json);
  assert.equal(cue.strokes[0].points[0].y, (portal.cue.strokes[0].points[0].y * 720 + 8) / 736);
  assert.ok(Math.abs(cue.strokes[0].radius - (portal.cue.strokes[0].radius * 720) / 736) < 1e-12);
});

test('tracked camera moves retain their required 64-pixel latent grid and visible 720p canvas', () => {
  const recipe = JSON.parse(
    readFileSync(new URL('../examples/castle-pullback/recipe.json', import.meta.url), 'utf8'),
  ) as Recipe;
  const request: Recipe = {
    ...recipe,
    resolution: '720p',
    clip: { ...recipe.clip, width: 1280, height: 720 },
  };
  const graph = buildWorkflow(request) as Graph;
  assert.equal(renderDimensions(request).height, 768);
  assert.equal(graph.hd_pad_8.inputs.top, 24);
  assert.equal(graph.hd_crop_21.inputs.y, 24);
  assert.equal(graph['13'].inputs.noise_seed, recipe.seed);
  assert.equal(graph['4'].class_type, 'LTXICLoRALoaderModelOnly');
  assert.equal(graph['41'].inputs.height, 768);
});

test('720p graphs keep all links resolvable, acyclic and preserve original source audio', () => {
  const motion = JSON.parse(
    readFileSync(new URL('../examples/signal/recipe.json', import.meta.url), 'utf8'),
  ) as Recipe;
  for (const request of [
    hd,
    { ...motion, resolution: '720p', clip: { ...motion.clip, width: 1280, height: 720 } } as Recipe,
  ]) {
    const graph = buildWorkflow(request) as Graph;
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
      assert.ok(graph[id], `Missing ${id}`);
      if (visited.has(id)) return;
      assert.equal(visiting.has(id), false, `Cycle at ${id}`);
      visiting.add(id);
      for (const value of Object.values(graph[id].inputs))
        if (Array.isArray(value) && typeof value[0] === 'string') visit(value[0]);
      visiting.delete(id);
      visited.add(id);
    };
    Object.keys(graph).forEach(visit);
    assert.deepEqual(graph['21'].inputs.source_audio, ['8', 1]);
  }
});

test('a separate final region composites directly at 720p after cropping generated padding', () => {
  const request = { ...hd, compositeRegion: { feather: hd.cue.feather, strokes: hd.cue.strokes } };
  const graph = buildWorkflow(request) as Graph;
  assert.deepEqual(graph['20'].inputs.original, ['50', 0]);
  assert.deepEqual(graph['20'].inputs.generated, ['hd_composite_crop', 0]);
  assert.equal(graph['50'].inputs.height, 720);
  assert.equal(graph.hd_crop_21, undefined);
  assert.deepEqual(graph['21'].inputs.images, ['20', 0]);
});

test('padding and cropping preserve every visible painted alpha pixel, including edge strokes and erasers', () => {
  for (const portrait of [false, true]) {
    const request: Recipe = {
      ...hd,
      clip: { ...hd.clip, width: portrait ? 720 : 1280, height: portrait ? 1280 : 720 },
      cue: {
        ...hd.cue,
        feather: 0.01,
        strokes: [
          {
            radius: 0.15,
            points: [
              { x: 0, y: 0 },
              { x: 0.03, y: 0.98 },
            ],
          },
          { radius: 0.19, points: [{ x: 0.96, y: 0.95 }] },
          { mode: 'erase', radius: 0.07, points: [{ x: 0.96, y: 0.98 }] },
        ],
      },
    };
    const display = displayDimensions(request);
    const model = renderDimensions(request);
    const graph = buildWorkflow(request) as Graph;
    const visible = spatialMask(display.width, display.height, request.cue);
    const padded = spatialMask(model.width, model.height, JSON.parse(graph['9'].inputs.cue_json));
    const left = (model.width - display.width) / 2;
    const top = (model.height - display.height) / 2;
    for (let y = 0; y < display.height; y++)
      for (let x = 0; x < display.width; x++)
        assert.equal(
          padded[((y + top) * model.width + x + left) * 4 + 3],
          visible[(y * display.width + x) * 4 + 3],
        );
    assert.equal(cuePreviewSettings(request, 'generation').width, display.width);
    assert.equal(cuePreviewSettings(request, 'generation').height, display.height);
  }
});

test('HD focused motion pads the complete appearance before cropping and preserves Wan target geometry', () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL('../examples/character-replacement/generation-render.json', import.meta.url),
      'utf8',
    ),
  ).recipe as Recipe;
  const request: Recipe = {
    ...baseline,
    resolution: '720p',
    clip: { ...baseline.clip, width: 1280, height: 720 },
    transfer: { ...baseline.transfer!, focus: { x: 0.1875, y: 0, width: 0.4375, height: 1 } },
  };
  const focus = motionFocusGeometry(request)!;
  assert.deepEqual(focus, {
    x: 240,
    y: 8,
    width: 560,
    height: 720,
    targetWidth: 608,
    targetHeight: 768,
  });
  const graph = buildWorkflow(request) as Graph;
  assert.equal(graph['53'].class_type, 'ImageScale');
  assert.deepEqual([graph['53'].inputs.width, graph['53'].inputs.height], [1280, 720]);
  assert.deepEqual(graph.hd_pad_53.inputs.image, ['53', 0]);
  assert.equal(graph.hd_pad_53.inputs.top, 8);
  assert.equal(graph.hd_pad_46, undefined);
  assert.deepEqual(graph['46'].inputs, {
    images: ['hd_pad_53', 0],
    x: focus.x,
    y: focus.y,
    width: focus.width,
    height: focus.height,
    target_width: focus.targetWidth,
    target_height: focus.targetHeight,
  });
  assert.ok(focus.x + focus.width <= 1280);
  assert.ok(focus.y + focus.height <= 736);
  assert.deepEqual(
    [graph['13'].inputs.width, graph['13'].inputs.height],
    [graph['46'].inputs.target_width, graph['46'].inputs.target_height],
  );
  assert.deepEqual(graph['22'].inputs.images, ['54', 0]);
  assert.equal(graph.hd_crop_22, undefined);
});

test('HD saved finishing retains native raw geometry and pads a visible-grid matte without stretching', () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL('../examples/character-replacement/generation-render.json', import.meta.url),
      'utf8',
    ),
  ).recipe as Recipe;
  const request: Recipe = {
    ...baseline,
    resolution: '720p',
    clip: { ...baseline.clip, width: 1280, height: 720 },
  };
  const d = renderDimensions(request);
  const generation = {
    ...request.clip,
    id: '10000000-0000-4000-8000-000000000001',
    sha256: 'a'.repeat(64),
    width: d.width,
    height: d.height,
    duration: d.duration,
  };
  const matte = {
    ...generation,
    id: '10000000-0000-4000-8000-000000000002',
    width: 1280,
    height: 720,
  };
  const finish = recipeSchema.parse({
    ...request,
    transfer: {
      ...request.transfer!,
      finish: { generation, matte, settingsKey: motionGenerationKey(request) },
    },
  });
  const graph = buildWorkflow(finish) as Graph;
  assert.equal(graph['19'].inputs.width, 1280);
  assert.equal(graph['19'].inputs.height, 736);
  assert.deepEqual(graph['20'].inputs.generated, ['19', 0]);
  assert.deepEqual(graph['22'].inputs.images, ['19', 0]);
  assert.equal(graph['49'].inputs.width, 1280);
  assert.equal(graph['49'].inputs.height, 720);
  assert.deepEqual(graph['50'].inputs.image, ['hd_pad_49', 0]);
  assert.equal(graph.hd_pad_49.inputs.top, 8);
  assert.deepEqual(graph['21'].inputs.images, ['hd_crop_21', 0]);
});

test('HD inpaint coarse reference and source share the same padded full-frame transform', () => {
  const request: Recipe = { ...hd, editReference: { ...hd.clip, kind: 'image', duration: 1 } };
  const graph = buildWorkflow(request) as Graph;
  assert.equal(graph['45'].class_type, 'AftertakeLoadClip');
  assert.equal(graph['47'].class_type, 'AftertakeLoadClip');
  assert.deepEqual(graph['46'].inputs.image, ['hd_reference_coarse', 0]);
  assert.deepEqual(graph.hd_reference_coarse.inputs.image, ['hd_pad_47', 0]);
  assert.deepEqual(
    [graph.hd_reference_coarse.inputs.width, graph.hd_reference_coarse.inputs.height],
    [graph['24'].inputs.width, graph['24'].inputs.height],
  );
  assert.equal(graph.hd_reference_coarse.inputs.upscale_method, graph['24'].inputs.upscale_method);
  assert.deepEqual(graph['48'].inputs.image, ['hd_pad_47', 0]);
});
