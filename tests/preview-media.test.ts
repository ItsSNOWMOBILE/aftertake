import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cacheRecordedVideos } from '../src/preview-media';

test('recorded video bytes become deduplicated blob sources without relying on server ranges', async () => {
  const bytes = await readFile(new URL('../examples/portal/source.mp4', import.meta.url));
  const snapshot = { clips: [{ kind: 'video' as const, url: '/source' }, { kind: 'image' as const, url: '/still' }], renders: [{ output: '/result' }], templates: [{ source: '/source-alias', result: '/result' }] };
  const original = structuredClone(snapshot), calls: string[] = [], blobs: Blob[] = [];
  const resolve = (url: string) => url === '/still' ? '/still.png' : url === '/result' ? '/result.mp4' : '/source.mp4';
  const cached = await cacheRecordedVideos(snapshot, resolve, {
    fetch: async url => { calls.push(url); return new Response(bytes); },
    createURL: blob => { blobs.push(blob); return 'blob:test/' + blobs.length; },
  });
  assert.deepEqual(calls, ['/source.mp4', '/result.mp4']);
  assert.equal(cached.get(resolve('/source')), cached.get(resolve('/source-alias')));
  assert.equal(cached.size, 2);
  assert.deepEqual(snapshot, original);
  for (const blob of blobs) {
    assert.equal(blob.type, 'video/mp4');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  }
});

test('a failed preview download releases completed object URLs and never returns a partial cache', async () => {
  const created: string[] = [], released: string[] = [];
  const snapshot = { clips: [], templates: [], renders: Array.from({ length: 6 }, (_, index) => ({ output: `/take-${index}.mp4` })) };
  await assert.rejects(cacheRecordedVideos(snapshot, url => url, {
    fetch: async url => new Response('recorded bytes', { status: url === '/take-4.mp4' ? 503 : 200 }),
    createURL: () => { const url = 'blob:test/' + created.length; created.push(url); return url; },
    revokeURL: url => released.push(url),
  }), /download a recorded preview/);
  assert.equal(created.length, 4);
  assert.deepEqual(released, created);
});
