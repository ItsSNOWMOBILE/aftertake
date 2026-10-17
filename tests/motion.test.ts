import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectSchema, recipeSchema, renderSettingsKey, usesCue, type Recipe } from '../src/domain.js';
import { buildWorkflow, requirements } from '../server/workflow.js';
import { RecipeAssetError, resolveRecipeAssets } from '../server/assets.js';

const base = JSON.parse(await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8')) as Recipe;
const image = { ...base.clip, id: '00000000-0000-4000-8000-000000000001', kind: 'image' as const,
  name: 'character.png', url: '/media/character.png', duration: 1, width: 576, height: 768, sha256: 'a'.repeat(64) };
const recipe: Recipe = { ...base, pipeline: 'motion-transfer', transfer: { reference: image, scope: 'frame', motionCaption: 'A character waves.' },
  cue: { ...base.cue, strokes: [] } };

test('whole-frame motion needs a still appearance and video driver; painted motion also needs a cue', () => {
  assert.equal(recipeSchema.safeParse(recipe).success, true);
  assert.equal(usesCue(recipe), false);
  const unfinished = { ...recipe, transfer: { scope: 'frame' } };
  assert.equal(projectSchema.safeParse(unfinished).success, true);
  assert.equal(recipeSchema.safeParse(unfinished).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, transfer: { ...recipe.transfer, reference: { ...image, kind: 'video' } } }).success, false);
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
  assert.equal(key, renderSettingsKey({ ...recipe, transfer: { ...recipe.transfer!, reference: { ...image, id: base.clip.id, url: '/media/rebound.png' } } }));
  assert.notEqual(key, renderSettingsKey({ ...recipe, transfer: { ...recipe.transfer!, reference: { ...image, sha256: 'b'.repeat(64) } } }));
  assert.notEqual(key, renderSettingsKey({ ...recipe, transfer: { ...recipe.transfer!, motionCaption: 'A character jumps.' } }));
  const cued = { ...recipe, transfer: { ...recipe.transfer!, scope: 'cue' as const }, cue: base.cue };
  assert.notEqual(key, renderSettingsKey(cued));
  assert.notEqual(renderSettingsKey(cued), renderSettingsKey({ ...cued, cue: { ...base.cue, end: base.cue.end - .1 } }));
});

test('motion graph conditions appearance and driving pixels separately, crops without stretching and preserves source audio', () => {
  for (const quality of ['draft', 'final'] as const) for (const scope of ['frame', 'cue'] as const) {
    const r = { ...recipe, quality, transfer: { ...recipe.transfer!, scope }, cue: base.cue };
    const graph = buildWorkflow(r) as Record<string, { class_type: string; inputs: Record<string, any> }>;
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
    assert.equal(JSON.parse(graph['21'].inputs.recipe_json).transfer.reference.sha256, image.sha256);
    assert.ok(requirements('motion-transfer').menus.every(([node]) => graph[Object.keys(graph).find(id => graph[id].class_type === node)!]));
  }
});

test('motion submission resolves canonical appearance bytes and rejects a forged hash or changed image', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'aftertake-motion-'));
  const sourceBytes = Buffer.from('source fixture'), imageBytes = Buffer.from('image fixture');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const source = { ...base.clip, url: '/media/source.mp4', sha256: hash(sourceBytes) };
  const appearance = { ...image, sha256: hash(imageBytes) };
  const r = { ...recipe, clip: source, transfer: { ...recipe.transfer!, reference: appearance } };
  try {
    await writeFile(path.join(folder, `${source.id}.json`), JSON.stringify(source));
    await writeFile(path.join(folder, `${appearance.id}.json`), JSON.stringify(appearance));
    await writeFile(path.join(folder, 'source.mp4'), sourceBytes);
    await writeFile(path.join(folder, 'character.png'), imageBytes);
    const resolved = await resolveRecipeAssets({ ...r, transfer: { ...r.transfer, reference: { ...appearance, url: '/media/forged.png', width: 1 } } }, folder);
    assert.equal(resolved.transfer?.reference?.url, appearance.url);
    assert.equal(resolved.transfer?.reference?.width, appearance.width);
    await assert.rejects(resolveRecipeAssets({ ...r, transfer: { ...r.transfer, reference: { ...appearance, sha256: 'b'.repeat(64) } } }, folder), RecipeAssetError);
    await writeFile(path.join(folder, 'character.png'), 'changed');
    await assert.rejects(resolveRecipeAssets(r, folder), RecipeAssetError);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
