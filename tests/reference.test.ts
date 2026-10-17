import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { editReferenceIssue, findImportedClip, projectSchema, recipeSchema, renderSettingsKey, type Recipe } from '../src/domain.js';
import { buildWorkflow } from '../server/workflow.js';
import { RecipeAssetError, resolveRecipeAssets } from '../server/assets.js';
import { applyTemplate, type Template } from '../src/templates.js';

const base = JSON.parse(await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8')) as Recipe;
const reference = { ...base.clip, id: '00000000-0000-4000-8000-000000000001', name: 'edited.png', kind: 'image' as const, url: '/media/edited.png', duration: 1, sha256: 'a'.repeat(64) };

test('recipe import recognizes the verified original image after normalization and prefers an exact stored file', () => {
  const normalized = { ...reference, sha256: 'b'.repeat(64), originalSha256: reference.sha256 };
  assert.equal(findImportedClip([normalized], reference), normalized);
  assert.equal(findImportedClip([normalized, reference], reference), reference);
  assert.equal(findImportedClip([normalized], { ...reference, sha256: 'c'.repeat(64) }), undefined);
  assert.equal(findImportedClip([{ ...normalized, kind: 'video' }], reference), undefined);
  assert.equal(findImportedClip([normalized], { ...reference, kind: 'video' }), undefined);
  const rebound = recipeSchema.parse({ ...base, editReference: findImportedClip([normalized], reference) });
  assert.equal(rebound.editReference?.sha256, normalized.sha256);
});

test('edited first frames are hash-bound images with source-compatible geometry', () => {
  const recipe = { ...base, editReference: reference };
  assert.equal(recipeSchema.safeParse(recipe).success, true);
  assert.equal(projectSchema.parse(JSON.parse(JSON.stringify(recipe))).editReference?.sha256, reference.sha256);
  assert.equal(recipeSchema.safeParse({ ...recipe, editReference: { ...reference, kind: 'video' } }).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, editReference: { ...reference, width: 432, height: 768 } }).success, false);
  assert.notEqual(renderSettingsKey(recipe), renderSettingsKey(base));
  assert.equal(renderSettingsKey(recipe), renderSettingsKey({ ...recipe, editReference: { ...reference, id: '00000000-0000-4000-8000-000000000002', url: '/media/remapped.png' } }));
  assert.notEqual(renderSettingsKey(recipe), renderSettingsKey({ ...recipe, editReference: { ...reference, sha256: 'b'.repeat(64) } }));
  assert.equal(editReferenceIssue(base.clip, { ...reference, height: 448 }), null);
  const next = applyTemplate(recipe, { recipe: base } as Template);
  assert.equal(next.editReference, undefined);
  assert.deepEqual(next.cue.strokes, recipe.cue.strokes);
});

test('reference conditioning reaches both native stages without changing the source composite or audio', () => {
  for (const quality of ['draft', 'final'] as const) {
    const graph = buildWorkflow({ ...base, quality, editReference: reference }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    assert.equal(graph['45'].inputs.width, graph['11'].inputs.width);
    assert.equal(graph['45'].inputs.height, graph['11'].inputs.height);
    assert.equal(graph['45'].inputs.frames, 1);
    assert.equal(graph['45'].inputs.trim_start, 0);
    assert.equal(graph['46'].inputs.bypass, false);
    assert.deepEqual(graph['12'].inputs.latent, ['46', 0]);
    assert.deepEqual(graph['20'].inputs.original, ['8', 0]);
    assert.deepEqual(graph['20'].inputs.mask, ['9', 0]);
    assert.deepEqual(graph['21'].inputs.source_audio, ['8', 1]);
    if (quality === 'final') {
      assert.equal(graph['47'].inputs.width, graph['29'].inputs.width);
      assert.equal(graph['47'].inputs.height, graph['29'].inputs.height);
      assert.deepEqual(graph['48'].inputs.latent, ['30', 0]);
      assert.deepEqual(graph['33'].inputs.latent_image, ['48', 0]);
    } else assert.equal('47' in graph, false);
  }
});

test('render assets are resolved from canonical metadata and verified against their actual bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-assets-test-'));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const sourceBytes = Buffer.from('canonical source fixture'), referenceBytes = Buffer.from('canonical reference fixture');
  const clip = { ...base.clip, sha256: hash(sourceBytes), url: '/media/source.mp4' };
  const image = { ...reference, sha256: hash(referenceBytes) };
  const recipe = { ...base, clip, editReference: image };
  try {
    for (const asset of [clip, image]) await writeFile(path.join(directory, `${asset.id}.json`), JSON.stringify(asset));
    await writeFile(path.join(directory, 'source.mp4'), sourceBytes); await writeFile(path.join(directory, 'edited.png'), referenceBytes);
    const canonical = await resolveRecipeAssets({ ...recipe, clip: { ...clip, url: '/media/forged.mp4', name: 'spoofed source' }, editReference: { ...image, url: '/media/forged.png' } }, directory);
    assert.equal(canonical.clip.url, clip.url); assert.equal(canonical.clip.name, clip.name); assert.equal(canonical.editReference?.url, image.url);
    await assert.rejects(resolveRecipeAssets({ ...recipe, editReference: { ...image, sha256: 'b'.repeat(64) } }, directory), RecipeAssetError);
    await writeFile(path.join(directory, 'edited.png'), 'changed pixels');
    await assert.rejects(resolveRecipeAssets(recipe, directory), /edited first frame changed/);
    await writeFile(path.join(directory, 'edited.png'), referenceBytes); await writeFile(path.join(directory, 'source.mp4'), 'changed footage');
    await assert.rejects(resolveRecipeAssets(recipe, directory), /source changed/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-assets-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
