import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReviewedRefresh, validateRefreshBinding } from '../scripts/example-refresh.mjs';

const sourceSha256 = 'a'.repeat(64);
const original = {
  slug: 'portal',
  renderId: '11111111-1111-4111-8111-111111111111',
  workspace: '.data-old',
  title: 'An opening elsewhere',
  credit: 'Curtis Adams / Pexels',
  license: 'Pexels License',
  sourceUrl: 'https://www.pexels.com/video/19227392/',
  frameEditId: '22222222-2222-4222-8222-222222222222',
};
const override = {
  slug: 'portal',
  renderId: '33333333-3333-4333-8333-333333333333',
  workspace: 'E:/Reviewed refresh/data',
  sourceSha256,
};
const manifest = (cases: unknown[] = [override]) => ({
  format: 'aftertake-example-refresh/1',
  reviewed: true,
  cases,
});

test('a reviewed refresh rebinds only the requested render/workspace and retains footage attribution and prerequisite provenance', () => {
  const other = {
    ...original,
    slug: 'unchanged',
    renderId: '44444444-4444-4444-8444-444444444444',
  };
  const selected = applyReviewedRefresh([original, other], manifest());
  assert.deepEqual(selected[0], { ...original, ...override });
  assert.deepEqual(selected[1], other);
  assert.equal(selected[0].credit, original.credit);
  assert.equal(selected[0].sourceUrl, original.sourceUrl);
  assert.equal(selected[0].frameEditId, original.frameEditId);
  assert.equal(original.renderId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(applyReviewedRefresh([original], undefined), [original]);
});

test('unreviewed, unknown, duplicate, incomplete or attribution-changing refresh entries are rejected', () => {
  const invalid = [
    { ...manifest(), reviewed: false },
    { ...manifest(), format: 'aftertake-gallery-refresh-candidates/1' },
    manifest([]),
    manifest([{ ...override, slug: '../other' }]),
    manifest([override, override]),
    manifest([{ ...override, renderId: '../not-a-render' }]),
    manifest([{ ...override, workspace: '' }]),
    manifest([{ ...override, sourceSha256: 'not-a-hash' }]),
    manifest([{ ...override, sourceSha256: undefined }]),
    manifest([{ ...override, license: 'relicensed' }]),
    manifest([{ ...override, frameEditId: null }]),
  ];
  for (const value of invalid) assert.throws(() => applyReviewedRefresh([original], value));
});

test('the selected completed render must bind to both the requested ID and the existing licensed source', () => {
  const item = applyReviewedRefresh([original], manifest())[0];
  const render = {
    id: override.renderId,
    state: 'succeeded',
    output: '/outputs/final.mp4',
    recipe: { clip: { sha256: sourceSha256 } },
  };
  const prior = { clip: { sha256: sourceSha256 } };
  assert.doesNotThrow(() => validateRefreshBinding(item, render, prior));
  assert.throws(
    () => validateRefreshBinding(item, { ...render, id: original.renderId }, prior),
    /requested completed render/,
  );
  assert.throws(
    () => validateRefreshBinding(item, { ...render, state: 'running' }, prior),
    /requested completed render/,
  );
  assert.throws(
    () => validateRefreshBinding(item, { ...render, output: null }, prior),
    /requested completed render/,
  );
  assert.throws(
    () =>
      validateRefreshBinding(
        item,
        { ...render, recipe: { clip: { sha256: 'b'.repeat(64) } } },
        prior,
      ),
    /reviewed source/,
  );
  assert.throws(
    () => validateRefreshBinding(item, render, { clip: { sha256: 'b'.repeat(64) } }),
    /reviewed source/,
  );
});

test('the CLI rejects an unreviewed refresh before changing the existing example bundle', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = [
    'examples/manifest.json',
    'examples/reclaimed/recipe.json',
    'examples/reclaimed/result.mp4',
  ];
  const before = await Promise.all(files.map((file) => readFile(path.join(root, file))));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aftertake-refresh-test-'));
  const refreshPath = path.join(directory, 'unreviewed.json');
  try {
    await writeFile(refreshPath, JSON.stringify({ ...manifest(), reviewed: false }));
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [path.join(root, 'scripts/package-examples.mjs'), '--refresh=' + refreshPath],
          { cwd: directory, stdio: 'pipe', timeout: 10000 },
        ),
      /reviewed aftertake-example-refresh/,
    );
    const after = await Promise.all(files.map((file) => readFile(path.join(root, file))));
    assert.deepEqual(after, before);
  } finally {
    await unlink(refreshPath).catch(() => {});
    await rmdir(directory);
  }
});
