import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueEnvelope, recipeSchema, renderDimensions, type Recipe } from '../src/domain.js';
import { buildWorkflow } from '../server/workflow.js';
import { spatialMask } from '../src/mask.js';
const recipe: Recipe = {
  format: 'aftertake/1', name: 'Test take',
  clip: { id: 'a7e24e70-2168-4e9c-b97f-06ae1401f558', name: 'source.mp4', sha256: 'a'.repeat(64), width: 1920, height: 1080, duration: 5, url: '/media/test.mp4' },
  prompt: 'Living vines on concrete', cue: { start: .4, end: 2.9, fade: .4, feather: .05, strokes: [{ radius: .1, points: [{ x: .5, y: .5 }] }] },
  seed: 42, quality: 'draft', trimStart: 0,
};
test('temporal cue is zero outside the interval and smoothly reaches full strength', () => {
  assert.equal(cueEnvelope(0, recipe.cue), 0);
  assert.equal(cueEnvelope(.4, recipe.cue), 0);
  assert.equal(cueEnvelope(.6, recipe.cue), .4999999999999998);
  assert.equal(cueEnvelope(1.2, recipe.cue), 1);
  assert.equal(cueEnvelope(3, recipe.cue), 0);
  assert.equal(cueEnvelope(.4, { ...recipe.cue, fade: 0 }), 1);
});
test('short and portrait videos produce valid non-stretching LTX frame geometry', () => {
  for (const [width, height, duration] of [[1920, 1080, 5], [1080, 1920, 1.1], [1000, 1000, 2]]) {
    const d = renderDimensions({ ...recipe, clip: { ...recipe.clip, width, height, duration } });
    assert.equal(d.width % 32, 0); assert.equal(d.height % 32, 0);
    assert.equal((d.frames - 1) % 8, 0); assert.ok(d.duration <= duration);
    assert.ok(Math.abs(d.width / d.height - width / height) < .04);
  }
  assert.throws(() => renderDimensions({ ...recipe, trimStart: 4.9 }), /too short/);
});
test('invalid recipes cannot request unbounded masks or arbitrary source URLs', () => {
  assert.equal(recipeSchema.safeParse(recipe).success, true);
  assert.equal(recipeSchema.safeParse({ ...recipe, clip: { ...recipe.clip, url: 'file:///secret' } }).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, cue: { ...recipe.cue, end: .2 } }).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, seed: -1 }).success, false);
});
test('workflow connects the same cue to generation guidance and final compositing', () => {
  const graph = buildWorkflow(recipe) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  assert.deepEqual(graph['12'].inputs.attention_mask, ['9', 1]);
  assert.deepEqual(graph['20'].inputs.mask, ['9', 0]);
  assert.deepEqual(graph['20'].inputs.original, ['8', 0]);
  assert.equal(JSON.parse(String(graph['21'].inputs.recipe_json)).seed, 42);
  assert.equal(Object.values(graph).some(node => /API|Partner|Router/.test(node.class_type)), false);
});
test('editor mask has a fully selected center and zero outside the brush', () => {
  const pixels = spatialMask(128, 64, recipe.cue);
  assert.equal(pixels[(32 * 128 + 64) * 4 + 3], 255);
  assert.equal(pixels[(2 * 128 + 64) * 4 + 3], 0);
});
test('native inpainting uses the masked source plate instead of structural edges', () => {
  const graph = buildWorkflow({ ...recipe, pipeline: 'inpaint' }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  assert.equal(graph['2'].class_type, 'CLIPLoader');
  assert.equal(graph['10'].class_type, 'LTXVInpaintPreprocess');
  assert.deepEqual(graph['10'].inputs.images, ['8', 0]);
  assert.deepEqual(graph['23'].inputs.mask, ['9', 0]);
  assert.equal('attention_mask' in graph['12'].inputs, false);
  assert.deepEqual(graph['20'].inputs.mask, ['9', 0]);
});
test('finish workflows have complete acyclic links and refine to the requested size', () => {
  for (const pipeline of ['structure', 'inpaint'] as const) {
    const r = { ...recipe, pipeline, quality: 'final' as const };
    const graph = buildWorkflow(r) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const visited = new Set<string>(), visiting = new Set<string>();
    const visit = (id: string) => {
      assert.ok(graph[id], `Missing referenced node ${id}`);
      if (visited.has(id)) return;
      assert.equal(visiting.has(id), false, `Cycle at ${id}`);
      visiting.add(id);
      for (const input of Object.values(graph[id].inputs)) if (Array.isArray(input) && typeof input[0] === 'string') visit(input[0]);
      visiting.delete(id); visited.add(id);
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
