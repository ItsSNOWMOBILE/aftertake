import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectVideoMetadata } from '../server/video-metadata.js';

test('executed graphs come from actual bundled MP4 metadata and reject a different recipe or truncated output', async () => {
  for (const slug of ['portal', 'golden-falls', 'crystal-forest']) {
    const bytes = await readFile(new URL(`../examples/${slug}/result.mp4`, import.meta.url));
    const recipe = JSON.parse(await readFile(new URL(`../examples/${slug}/recipe.json`, import.meta.url), 'utf8'));
    const inspected = inspectVideoMetadata(bytes, recipe);
    assert.equal((inspected.workflow['8'] as any).class_type, 'AftertakeLoadClip');
    assert.ok((inspected.workflow['8'] as any).inputs.filename);
    assert.throws(() => inspectVideoMetadata(bytes, { ...recipe, seed: recipe.seed + 1 }), /does not match/);
    assert.throws(() => inspectVideoMetadata(bytes.subarray(0, bytes.length - 10)), /incomplete/);
  }
});
