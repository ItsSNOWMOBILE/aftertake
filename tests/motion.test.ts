import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  displayDimensions,
  motionGenerationKey,
  projectSchema,
  recipeSchema,
  renderDimensions,
  renderSettingsKey,
  usesCue,
  type Recipe,
  type Clip,
} from '../src/domain.js';
import { inspectVideoMetadata } from '../server/video-metadata.js';
import { buildWorkflow, requirements } from '../server/workflow.js';
import { RecipeAssetError, resolveRecipeAssets } from '../server/assets.js';

const base = JSON.parse(
  await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
) as Recipe;
const image = {
  ...base.clip,
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'image' as const,
  name: 'character.png',
  url: '/media/character.png',
  duration: 1,
  width: 576,
  height: 768,
  sha256: 'a'.repeat(64),
};
const recipe: Recipe = {
  ...base,
  pipeline: 'motion-transfer',
  transfer: { reference: image, scope: 'frame', motionCaption: 'A character waves.' },
  cue: { ...base.cue, strokes: [] },
};

test('whole-frame motion needs a still appearance and video driver; painted motion also needs a cue', () => {
  assert.equal(recipeSchema.safeParse(recipe).success, true);
  assert.equal(usesCue(recipe), false);
  const unfinished = { ...recipe, transfer: { scope: 'frame' } };
  assert.equal(projectSchema.safeParse(unfinished).success, true);
  assert.equal(recipeSchema.safeParse(unfinished).success, false);
  assert.equal(
    recipeSchema.safeParse({
      ...recipe,
      transfer: { ...recipe.transfer, reference: { ...image, kind: 'video' } },
    }).success,
    false,
  );
  assert.equal(recipeSchema.safeParse({ ...recipe, clip: image }).success, false);
  assert.equal(projectSchema.safeParse({ ...recipe, pipeline: 'cinema' }).success, false);
  const cued = { ...recipe, transfer: { ...recipe.transfer!, scope: 'cue' as const } };
  assert.equal(usesCue(cued), true);
  assert.equal(recipeSchema.safeParse(cued).success, false);
  assert.equal(recipeSchema.safeParse({ ...cued, cue: base.cue }).success, true);
});

test('motion take identity follows both media hashes, captions and scope while ignoring inactive paint', () => {
  const key = renderSettingsKey(recipe);
  assert.equal(key, renderSettingsKey({ ...recipe, cue: base.cue }));
  assert.equal(
    key,
    renderSettingsKey({ ...recipe, transfer: { ...recipe.transfer!, poseStrength: 1 } }),
  );
  assert.notEqual(
    key,
    renderSettingsKey({ ...recipe, transfer: { ...recipe.transfer!, poseStrength: 1.4 } }),
  );
  assert.equal(
    key,
    renderSettingsKey({
      ...recipe,
      transfer: {
        ...recipe.transfer!,
        reference: { ...image, id: base.clip.id, url: '/media/rebound.png' },
      },
    }),
  );
  assert.notEqual(
    key,
    renderSettingsKey({
      ...recipe,
      transfer: { ...recipe.transfer!, reference: { ...image, sha256: 'b'.repeat(64) } },
    }),
  );
  assert.notEqual(
    key,
    renderSettingsKey({
      ...recipe,
      transfer: { ...recipe.transfer!, motionCaption: 'A character jumps.' },
    }),
  );
  const cued = {
    ...recipe,
    transfer: { ...recipe.transfer!, scope: 'cue' as const },
    cue: base.cue,
  };
  assert.notEqual(key, renderSettingsKey(cued));
  assert.notEqual(
    renderSettingsKey(cued),
    renderSettingsKey({ ...cued, cue: { ...base.cue, end: base.cue.end - 0.1 } }),
  );
});

test('motion strength survives recipe sharing within bounds and reaches the native guidance input', () => {
  const changed = { ...recipe, transfer: { ...recipe.transfer!, poseStrength: 1.4 } };
  const restored = recipeSchema.parse(JSON.parse(JSON.stringify(changed)));
  assert.equal(restored.transfer?.poseStrength, 1.4);
  for (const strength of [0, 0.49, 1.51, 2, 1.234, NaN])
    assert.equal(
      projectSchema.safeParse({
        ...recipe,
        transfer: { ...recipe.transfer!, poseStrength: strength },
      }).success,
      false,
    );
  for (const strength of [0.5, 1, 1.4, 1.5]) {
    const r = recipeSchema.parse({
      ...recipe,
      transfer: { ...recipe.transfer!, poseStrength: strength },
    });
    const graph = buildWorkflow(r) as Record<string, { inputs: Record<string, any> }>;
    assert.equal(graph['13'].inputs.pose_strength, strength);
    assert.equal(graph['13'].inputs.reference_image_strength, 1);
    assert.equal(JSON.parse(graph['21'].inputs.recipe_json).transfer.poseStrength, strength);
  }
  assert.equal((buildWorkflow(recipe) as any)['13'].inputs.pose_strength, 1);
});

test('motion graph conditions appearance and driving pixels separately, crops without stretching and preserves source audio', () => {
  for (const quality of ['draft', 'final'] as const)
    for (const scope of ['frame', 'cue'] as const) {
      const r = { ...recipe, quality, transfer: { ...recipe.transfer!, scope }, cue: base.cue };
      const graph = buildWorkflow(r) as Record<
        string,
        { class_type: string; inputs: Record<string, any> }
      >;
      assert.equal(graph['13'].class_type, 'WanAnimate2ToVideo');
      assert.deepEqual(graph['13'].inputs.pose_video, ['8', 0]);
      assert.deepEqual(graph['13'].inputs.reference_image, ['46', 0]);
      assert.deepEqual(graph['13'].inputs.positive_pose, ['7', 0]);
      assert.equal(graph['45'].inputs.width, image.width);
      assert.equal(graph['46'].inputs.crop, 'center');
      assert.equal(graph['14'].inputs.dtype, quality === 'final' ? 'int4' : 'int8');
      assert.deepEqual(graph['18'].inputs.trim_amount, ['13', 3]);
      assert.deepEqual(graph['19'].inputs.samples, ['18', 0]);
      assert.deepEqual(graph['21'].inputs.images, [scope === 'cue' ? '20' : '19', 0]);
      assert.equal(Boolean(graph['9']), scope === 'cue');
      assert.deepEqual(graph['21'].inputs.source_audio, ['8', 1]);
      assert.equal(
        JSON.parse(graph['21'].inputs.recipe_json).transfer.reference.sha256,
        image.sha256,
      );
      assert.ok(
        requirements('motion-transfer').menus.every(
          ([node]) => graph[Object.keys(graph).find((id) => graph[id].class_type === node)!],
        ),
      );
    }
});

test('scene-matched references share the driver transform and display geometry removes latent padding', () => {
  const clip = { ...recipe.clip, width: 768, height: 432 };
  const r = {
    ...recipe,
    clip,
    quality: 'final' as const,
    transfer: { ...recipe.transfer!, reference: { ...image, width: 768, height: 432 } },
  };
  const graph = buildWorkflow(r) as any;
  assert.equal(graph['46'].inputs.crop, 'disabled');
  assert.deepEqual(displayDimensions(r), { width: 768, height: 432 });
  assert.equal(graph['21'].inputs.display_width, 768);
  assert.equal(graph['21'].inputs.display_height, 432);
  assert.equal(graph['8'].inputs.height, 448);
  const cued = {
    ...r,
    transfer: { ...r.transfer, scope: 'cue' as const },
    cue: base.cue,
    matchSourceColor: true,
  };
  assert.equal((buildWorkflow(cued) as any)['20'].inputs.match_color, true);
  assert.notEqual(renderSettingsKey(cued), renderSettingsKey({ ...cued, matchSourceColor: false }));
});

test('saved motion finishing uses exact raw pixels and a matte, bound to the actual generation receipt', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'aftertake-motion-finish-'));
  const raw = await readFile(new URL('../examples/character-replacement/raw.mp4', import.meta.url));
  const original = inspectVideoMetadata(raw).recipe,
    d = renderDimensions(original);
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const generation: Clip = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Raw generation',
    url: '/media/generation.mp4',
    sha256: digest(raw),
    width: d.width,
    height: d.height,
    duration: d.duration,
  };
  const source = await readFile(
    new URL('../examples/character-replacement/source.mp4', import.meta.url),
  );
  const appearance = await readFile(
    new URL('../examples/character-replacement/appearance.png', import.meta.url),
  );
  const matte: Clip = {
    ...original.clip,
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Matte',
    url: '/media/matte.mp4',
    sha256: digest(source),
  };
  const draft: Recipe = {
    ...original,
    transfer: {
      ...original.transfer!,
      scope: 'cue',
      finish: { generation, matte, settingsKey: motionGenerationKey(original) },
    },
  };
  const fixtures: [Clip, Buffer][] = [
    [draft.clip, source],
    [draft.transfer!.reference!, appearance],
    [generation, raw],
    [matte, source],
  ];
  try {
    for (const [clip, bytes] of fixtures) {
      await writeFile(path.join(folder, `${clip.id}.json`), JSON.stringify(clip));
      await writeFile(path.join(folder, path.basename(clip.url)), bytes);
    }
    const resolved = await resolveRecipeAssets(draft, folder);
    assert.equal(resolved.transfer?.finish?.generation.sha256, generation.sha256);
    const graph = buildWorkflow(resolved) as any;
    assert.equal(graph['19'].class_type, 'AftertakeLoadClip');
    assert.equal(graph['19'].inputs.filename, 'GENERATION.mp4');
    assert.deepEqual(graph['51'].inputs, {
      destination: ['9', 0],
      source: ['50', 0],
      x: 0,
      y: 0,
      operation: 'multiply',
    });
    assert.deepEqual(graph['20'].inputs.mask, ['51', 0]);
    assert.equal(
      recipeSchema.safeParse({ ...draft, transfer: { ...draft.transfer, scope: 'frame' } }).success,
      false,
    );
    const focused = {
      ...draft,
      transfer: { ...draft.transfer!, focus: { x: 0, y: 0, width: 1, height: 1 } },
    };
    focused.transfer.finish = {
      ...focused.transfer.finish!,
      settingsKey: motionGenerationKey(focused),
    };
    await assert.rejects(
      resolveRecipeAssets(focused, folder),
      /different source, appearance or generation settings/,
    );
    const changed = { ...draft, seed: draft.seed + 1 };
    changed.transfer = {
      ...changed.transfer!,
      finish: { ...changed.transfer!.finish!, settingsKey: motionGenerationKey(changed) },
    };
    await assert.rejects(
      resolveRecipeAssets(changed, folder),
      /different source, appearance or generation settings/,
    );
    await writeFile(
      path.join(folder, `${matte.id}.json`),
      JSON.stringify({ ...matte, duration: 1 }),
    );
    await assert.rejects(resolveRecipeAssets(draft, folder), /full-length video matte/);
  } finally {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(tmpdir()));
    assert.ok(path.basename(folder).startsWith('aftertake-motion-finish-'));
    await rm(folder, { recursive: true, force: true });
  }
});

test('motion submission resolves canonical appearance bytes and rejects a forged hash or changed image', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'aftertake-motion-'));
  const sourceBytes = Buffer.from('source fixture'),
    imageBytes = Buffer.from('image fixture');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const source = { ...base.clip, url: '/media/source.mp4', sha256: hash(sourceBytes) };
  const appearance = { ...image, sha256: hash(imageBytes) };
  const r = {
    ...recipe,
    clip: source,
    transfer: { ...recipe.transfer!, reference: appearance, poseStrength: 1.4 },
  };
  try {
    await writeFile(path.join(folder, `${source.id}.json`), JSON.stringify(source));
    await writeFile(path.join(folder, `${appearance.id}.json`), JSON.stringify(appearance));
    await writeFile(path.join(folder, 'source.mp4'), sourceBytes);
    await writeFile(path.join(folder, 'character.png'), imageBytes);
    const resolved = await resolveRecipeAssets(
      {
        ...r,
        transfer: {
          ...r.transfer,
          reference: { ...appearance, url: '/media/forged.png', width: 1 },
        },
      },
      folder,
    );
    assert.equal(resolved.transfer?.reference?.url, appearance.url);
    assert.equal(resolved.transfer?.reference?.width, appearance.width);
    assert.equal(resolved.transfer?.poseStrength, 1.4);
    await assert.rejects(
      resolveRecipeAssets(
        { ...r, transfer: { ...r.transfer, reference: { ...appearance, sha256: 'b'.repeat(64) } } },
        folder,
      ),
      RecipeAssetError,
    );
    await writeFile(path.join(folder, 'character.png'), 'changed');
    await assert.rejects(resolveRecipeAssets(r, folder), RecipeAssetError);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
