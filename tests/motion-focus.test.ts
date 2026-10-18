import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  recipeSchema,
  projectSchema,
  renderDimensions,
  renderSettingsKey,
  motionGenerationKey,
  type Recipe,
} from '../src/domain.js';
import { motionFocusGeometry, focusFromPaint } from '../src/motion-focus.js';
import { spatialMask } from '../src/mask.js';
import { buildMotionTransferWorkflow } from '../server/motion-workflow.js';

const baseline = JSON.parse(
  await readFile(
    new URL('../examples/character-replacement/generation-render.json', import.meta.url),
    'utf8',
  ),
).recipe as Recipe;
const focused: Recipe = {
  ...baseline,
  transfer: { ...baseline.transfer!, focus: { x: 0.1875, y: 0, width: 0.4375, height: 1 } },
};

test('a focused performance returns to the original scene geometry before the painted composite or saved-generation finish', () => {
  const restored = recipeSchema.parse(JSON.parse(JSON.stringify(focused)));
  assert.deepEqual(motionFocusGeometry(restored), {
    x: 144,
    y: 0,
    width: 336,
    height: 448,
    targetWidth: 608,
    targetHeight: 768,
  });
  const graph = buildMotionTransferWorkflow(restored) as any;
  assert.deepEqual(graph['52'].inputs, {
    images: ['8', 0],
    x: 144,
    y: 0,
    width: 336,
    height: 448,
    target_width: 608,
    target_height: 768,
  });
  assert.deepEqual(graph['46'].inputs.images, ['53', 0]);
  assert.equal(graph['53'].inputs.crop, 'disabled');
  assert.deepEqual(graph['13'].inputs.pose_video, ['52', 0]);
  assert.deepEqual([graph['13'].inputs.width, graph['13'].inputs.height], [608, 768]);
  assert.deepEqual(graph['54'].inputs, {
    original: ['8', 0],
    generated: ['19', 0],
    x: 144,
    y: 0,
    width: 336,
    height: 448,
  });
  assert.deepEqual(graph['20'].inputs.generated, ['54', 0]);
  assert.deepEqual(graph['22'].inputs.images, ['54', 0]);
  assert.deepEqual(graph['55'].inputs.images, ['19', 0]);
  assert.deepEqual(
    [graph['21'].inputs.display_width, graph['21'].inputs.display_height],
    [768, 432],
  );
  const generation = {
    ...baseline.clip,
    id: '10000000-0000-4000-8000-000000000009',
    width: 768,
    height: 448,
    duration: 73 / 24,
  };
  const finish = recipeSchema.parse({
    ...restored,
    transfer: {
      ...restored.transfer,
      finish: {
        generation,
        matte: { ...generation, width: 768, height: 432 },
        settingsKey: motionGenerationKey(restored),
      },
    },
  });
  const finishing = buildMotionTransferWorkflow(finish) as any;
  assert.equal(finishing['19'].class_type, 'AftertakeLoadClip');
  assert.deepEqual(finishing['20'].inputs.generated, ['19', 0]);
  assert.equal(finishing['54'], undefined);
  assert.equal(finishing['55'], undefined);
});

test('focus bounds cover the native positive paint, survive import and invalidate a different generation without changing old keys', () => {
  const d = renderDimensions(baseline),
    focus = focusFromPaint(baseline),
    r = { ...baseline, transfer: { ...baseline.transfer!, focus } };
  const bounds = motionFocusGeometry(r)!;
  const pixels = spatialMask(d.width, d.height, baseline.cue);
  for (let y = 0; y < d.height; y++)
    for (let x = 0; x < d.width; x++)
      if (pixels[(y * d.width + x) * 4 + 3])
        assert.ok(
          x >= bounds.x &&
            x < bounds.x + bounds.width &&
            y >= bounds.y &&
            y < bounds.y + bounds.height,
        );
  assert.notEqual(renderSettingsKey(r), renderSettingsKey(baseline));
  assert.notEqual(motionGenerationKey(r), motionGenerationKey(baseline));
  assert.equal(
    renderSettingsKey({ ...baseline, transfer: { ...baseline.transfer!, focus: undefined } }),
    renderSettingsKey(baseline),
  );
  assert.equal(
    motionGenerationKey({ ...baseline, transfer: { ...baseline.transfer!, focus: undefined } }),
    motionGenerationKey(baseline),
  );
  assert.deepEqual(recipeSchema.parse(JSON.parse(JSON.stringify(r))).transfer?.focus, focus);
  assert.equal(
    projectSchema.safeParse({ ...focused, transfer: { ...focused.transfer!, scope: 'frame' } })
      .success,
    false,
  );
  assert.equal(
    recipeSchema.safeParse({
      ...focused,
      transfer: {
        ...focused.transfer!,
        reference: { ...focused.transfer!.reference!, width: 432, height: 768 },
      },
    }).success,
    false,
  );
  for (const bad of [
    { x: -0.1, y: 0, width: 0.5, height: 1 },
    { x: 0.8, y: 0, width: 0.4, height: 1 },
    { x: 0, y: 0, width: 0.01, height: 1 },
  ])
    assert.equal(
      projectSchema.safeParse({ ...focused, transfer: { ...focused.transfer!, focus: bad } })
        .success,
      false,
    );
});
