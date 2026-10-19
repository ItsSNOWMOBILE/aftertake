import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compositeRegionSchema,
  displayDimensions,
  finalCompositeCue,
  motionGenerationKey,
  projectSchema,
  recipeSchema,
  renderDimensions,
  renderSettingsKey,
  supportsCompositeRegion,
  type CompositeRegion,
  type Recipe,
} from '../src/domain.js';
import { buildWorkflow } from '../server/workflow.js';
import { generationAdmission } from '../server/generation-admission.js';

const recipe: Recipe = {
  format: 'aftertake/1',
  name: 'Independent final region',
  clip: {
    id: 'a7e24e70-2168-4e9c-b97f-06ae1401f558',
    name: 'source.mp4',
    sha256: 'a'.repeat(64),
    width: 1920,
    height: 1080,
    duration: 5,
    url: '/media/test.mp4',
  },
  prompt: 'Warm amber light on the castle',
  cue: {
    start: 0.4,
    end: 2.9,
    fade: 0.4,
    feather: 0.05,
    tracking: 'flow',
    anchor: 0.75,
    strokes: [{ radius: 0.25, points: [{ x: 0.5, y: 0.5 }] }],
  },
  seed: 42,
  quality: 'draft',
  trimStart: 0,
};
const region: CompositeRegion = {
  feather: 0.01,
  strokes: [{ radius: 0.11, points: [{ x: 0.48, y: 0.42 }] }],
};
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

test('a final region shares cue spatial bounds, rejects a separate clock and supports only regional pipelines', () => {
  assert(compositeRegionSchema.safeParse(region).success);
  for (const invalid of [
    { feather: 0 },
    { feather: 0.201 },
    { feather: Number.POSITIVE_INFINITY },
    { anchor: -1 },
    { anchor: 12.01 },
    { tracking: 'model' },
    { strokes: Array.from({ length: 101 }, () => region.strokes[0]) },
    { strokes: [{ ...region.strokes[0], radius: 0.501 }] },
    { strokes: [{ ...region.strokes[0], points: [{ x: 1.01, y: 0.5 }] }] },
    { strokes: [{ ...region.strokes[0], points: [] }] },
    { start: 0 },
    { end: 1 },
    { fade: 0 },
  ])
    assert.equal(compositeRegionSchema.safeParse({ ...region, ...invalid }).success, false);
  for (const pipeline of [undefined, 'structure', 'inpaint'] as const) {
    const value = { ...recipe, pipeline, compositeRegion: region };
    assert(supportsCompositeRegion(value));
    assert(recipeSchema.safeParse(value).success);
  }
  for (const pipeline of ['cinema', 'motion-transfer'] as const) {
    const value = { ...recipe, pipeline, compositeRegion: region };
    assert.equal(supportsCompositeRegion(value), false);
    assert.equal(projectSchema.safeParse(value).success, false);
    assert.equal(recipeSchema.safeParse(value).success, false);
  }
});

test('empty final-region drafts can be saved but rendering needs independent generation and final paint', () => {
  for (const strokes of [[], [{ ...region.strokes[0], mode: 'erase' as const }]]) {
    const value = { ...recipe, compositeRegion: { ...region, strokes } };
    assert(projectSchema.safeParse(JSON.parse(JSON.stringify(value))).success);
    const result = recipeSchema.safeParse(value);
    assert.equal(result.success, false);
    if (!result.success)
      assert(
        result.error.issues.some((issue) => issue.path.join('.') === 'compositeRegion.strokes'),
      );
  }
  assert.equal(
    recipeSchema.safeParse({
      ...recipe,
      cue: { ...recipe.cue, strokes: [] },
      compositeRegion: region,
    }).success,
    false,
    'Final paint must not substitute for generation context.',
  );
  assert(recipeSchema.safeParse({ ...recipe, compositeRegion: region }).success);
});

test('final cue inherits only the temporal envelope and retains independent tracking and paint', () => {
  assert.equal(finalCompositeCue(recipe), recipe.cue, 'Absent region returns the original cue.');
  const final = finalCompositeCue({ ...recipe, compositeRegion: region });
  assert.deepEqual(final, {
    start: recipe.cue.start,
    end: recipe.cue.end,
    fade: recipe.cue.fade,
    ...region,
    tracking: undefined,
    anchor: undefined,
  });
  assert.equal(
    final.tracking,
    undefined,
    'An omitted final tracking mode defaults to static, not generation flow.',
  );
  assert.equal(final.anchor, undefined);
  assert.equal(final.strokes, region.strokes);
  const tracked = finalCompositeCue({
    ...recipe,
    compositeRegion: { ...region, tracking: 'flow', anchor: 1.25 },
  });
  assert.equal(tracked.tracking, 'flow');
  assert.equal(tracked.anchor, 1.25);
  assert.deepEqual(
    JSON.parse(JSON.stringify(recipeSchema.parse({ ...recipe, compositeRegion: region })))
      .compositeRegion,
    region,
  );
});

test('final-region changes affect render and admission identity without changing legacy or generation keys', () => {
  const parsedLegacy = recipeSchema.parse(recipe);
  assert.equal(Object.hasOwn(parsedLegacy, 'compositeRegion'), false);
  assert.equal(renderSettingsKey(parsedLegacy), renderSettingsKey(recipe));
  assert.deepEqual(
    buildWorkflow(parsedLegacy),
    buildWorkflow(recipeSchema.parse({ ...recipe, compositeRegion: undefined })),
  );
  const value = { ...recipe, compositeRegion: region };
  const legacyKey = JSON.parse(renderSettingsKey(recipe));
  const finalKey = JSON.parse(renderSettingsKey(value));
  assert.deepEqual(
    finalKey.slice(0, -1),
    legacyKey,
    'The existing regional key prefix stays byte-equivalent.',
  );
  assert.equal(finalKey.at(-1)[0], 'composite-region');
  assert.notEqual(renderSettingsKey(value), renderSettingsKey(recipe));
  assert.notEqual(
    renderSettingsKey(value),
    renderSettingsKey({ ...value, compositeRegion: { ...region, feather: 0.02 } }),
  );
  assert.equal(
    renderSettingsKey(value),
    renderSettingsKey({ ...value, compositeRegion: { ...region, tracking: 'static', anchor: 0 } }),
  );
  assert.equal(motionGenerationKey(value), motionGenerationKey(recipe));
  const previous = generationAdmission('composite-test', parsedLegacy, []);
  assert(
    generationAdmission('composite-test', recipeSchema.parse(value), [{ ...previous.identity }])
      .conflict,
  );
});

test('separate final masks change only composite inputs and embedded recipes across both native generation pipelines', () => {
  for (const pipeline of [undefined, 'structure', 'inpaint'] as const)
    for (const quality of ['draft', 'final'] as const)
      for (const matchSourceColor of [false, true]) {
        const original = { ...recipe, pipeline, quality, matchSourceColor, directionStrength: 3 };
        const revised = { ...original, compositeRegion: region };
        const baseline = buildWorkflow(original) as Graph;
        const graph = buildWorkflow(revised) as Graph;
        const d = renderDimensions(revised);
        const display = displayDimensions(revised);
        assert.equal('49' in baseline, false);
        assert.equal('50' in baseline, false);
        assert.deepEqual(graph['50'], {
          class_type: 'AftertakeLoadClip',
          inputs: {
            filename: ['8', 1],
            width: display.width,
            height: display.height,
            frames: d.frames,
            fps: d.fps,
            trim_start: revised.trimStart,
          },
        });
        assert.deepEqual(graph['49'], {
          class_type: 'AftertakeCueMask',
          inputs: {
            width: display.width,
            height: display.height,
            frames: d.frames,
            fps: d.fps,
            cue_json: JSON.stringify(finalCompositeCue(revised)),
            images: ['50', 0],
          },
        });
        assert.deepEqual(graph['9'], baseline['9']);
        assert.deepEqual(graph['20'].inputs.original, ['50', 0]);
        assert.deepEqual(graph['20'].inputs.mask, ['49', 0]);
        assert.deepEqual(graph['20'].inputs.spatial_mask, ['49', 2]);
        const consumers = Object.entries(graph).flatMap(([id, node]) =>
          Object.entries(node.inputs)
            .filter(([, input]) => Array.isArray(input) && input[0] === '49')
            .map(([input]) => `${id}.${input}`),
        );
        assert.deepEqual(consumers.sort(), ['20.mask', '20.spatial_mask']);
        const normalized = structuredClone(graph);
        delete normalized['49'];
        delete normalized['50'];
        normalized['20'].inputs.original = ['8', 0];
        normalized['20'].inputs.mask = ['9', 0];
        normalized['20'].inputs.spatial_mask = ['9', 2];
        for (const [id, node] of Object.entries(normalized))
          if (typeof node.inputs.recipe_json === 'string') {
            assert.deepEqual(JSON.parse(node.inputs.recipe_json).compositeRegion, region);
            node.inputs.recipe_json = baseline[id].inputs.recipe_json;
          }
        assert.deepEqual(
          normalized,
          baseline,
          `${pipeline || 'structure'}/${quality} changed generation or pyramid conditioning`,
        );
        assert.deepEqual(graph['21'].inputs.source_audio, baseline['21'].inputs.source_audio);
      }
});

test('optional final compositing decodes the source on the landscape or portrait display grid without changing native geometry', () => {
  for (const [width, height] of [
    [1920, 1080],
    [1080, 1920],
  ]) {
    const value: Recipe = {
      ...recipe,
      quality: 'final',
      trimStart: 0.5,
      clip: { ...recipe.clip, width, height },
      compositeRegion: { ...region, tracking: 'flow', anchor: 0.75 },
    };
    const graph = buildWorkflow(value) as Graph;
    const d = renderDimensions(value);
    const display = displayDimensions(value);
    assert.notDeepEqual([d.width, d.height], [display.width, display.height]);
    assert.deepEqual([graph['8'].inputs.width, graph['8'].inputs.height], [d.width, d.height]);
    assert.deepEqual([graph['9'].inputs.width, graph['9'].inputs.height], [d.width, d.height]);
    assert.deepEqual(
      [graph['50'].inputs.width, graph['50'].inputs.height],
      [display.width, display.height],
    );
    assert.deepEqual(
      [graph['49'].inputs.width, graph['49'].inputs.height],
      [display.width, display.height],
    );
    assert.deepEqual(
      [graph['21'].inputs.display_width, graph['21'].inputs.display_height],
      [display.width, display.height],
    );
    assert.equal(graph['50'].inputs.trim_start, value.trimStart);
    assert.equal(graph['50'].inputs.frames, graph['8'].inputs.frames);
    assert.equal(graph['50'].inputs.fps, graph['8'].inputs.fps);
    const sourceConsumers = Object.entries(graph).flatMap(([id, node]) =>
      Object.entries(node.inputs)
        .filter(([, input]) => Array.isArray(input) && input[0] === '50')
        .map(([input]) => `${id}.${input}`),
    );
    assert.deepEqual(sourceConsumers.sort(), ['20.original', '49.images']);
    assert.deepEqual(graph['21'].inputs.source_audio, ['8', 1]);
  }
});
