import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRecordedPreviewCache } from '../src/preview-media';
import { createBrowserTransport } from '../src/transport';
import type { DemoSnapshot } from '../src/demo-runtime';

function snapshot(): DemoSnapshot {
  return {
    format: 'aftertake-browser-demo/1',
    mediaRevision: 'a'.repeat(40),
    clips: [],
    renders: [],
    frameEdits: [],
    templates: [],
    media: {
      '/one': '/assets/one.mp4',
      '/one-alias': '/assets/one.mp4',
      '/two': '/assets/two.mp4',
      '/still': '/assets/still.png',
    },
    thumbnails: {},
    workspace: { examples: true, exampleCount: 0, exampleNames: {}, featuredRenderId: '' },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('requested recorded video bytes are deduplicated and preserved in a seekable MP4 blob', async () => {
  const bytes = await readFile(new URL('../examples/portal/source.mp4', import.meta.url));
  const response = deferred<Response>();
  const calls: string[] = [],
    blobs: Blob[] = [],
    states: string[] = [];
  const cache = createRecordedPreviewCache({
    fetch: (url) => {
      calls.push(url);
      return response.promise;
    },
    createURL: (blob) => {
      blobs.push(blob);
      return 'blob:original-video';
    },
  });
  const unsubscribe = cache.subscribe('/one.mp4', () => states.push(cache.get('/one.mp4').status));
  assert.deepEqual(calls, [], 'Creating the cache must not prepare videos.');
  assert.equal(cache.get('/one.mp4').status, 'idle');
  const first = cache.load('/one.mp4'),
    second = cache.load('/one.mp4');
  assert.equal(first, second);
  await Promise.resolve();
  assert.deepEqual(calls, ['/one.mp4']);
  assert.equal(cache.get('/one.mp4').src, undefined, 'Do not send the unprepared URL to a video.');
  response.resolve(new Response(bytes));
  assert.equal(await first, 'blob:original-video');
  assert.equal(await second, 'blob:original-video');
  assert.equal(await cache.load('/one.mp4'), 'blob:original-video');
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, 'video/mp4');
  assert.deepEqual(Buffer.from(await blobs[0].arrayBuffer()), bytes);
  assert.deepEqual(states, ['loading', 'ready']);
  unsubscribe();
});

test('one failed video cannot block or discard an unrelated preview; retry is explicit and isolated', async () => {
  const calls: string[] = [],
    released: string[] = [];
  let fail = true;
  const cache = createRecordedPreviewCache({
    fetch: async (url) => {
      calls.push(url);
      return new Response('original video bytes', {
        status: url === '/bad.mp4' && fail ? 503 : 200,
      });
    },
    createURL: () => 'blob:take-' + calls.length,
    revokeURL: (url) => released.push(url),
  });
  const result = await Promise.allSettled([cache.load('/bad.mp4'), cache.load('/good.mp4')]);
  assert.equal(result[0].status, 'rejected');
  assert.equal(result[1].status, 'fulfilled');
  const good = cache.get('/good.mp4');
  assert.equal(good.status, 'ready');
  assert.equal(cache.get('/bad.mp4').status, 'error');
  assert.deepEqual(released, []);
  await assert.rejects(cache.load('/bad.mp4'), /could not be loaded/);
  assert.equal(
    calls.filter((url) => url === '/bad.mp4').length,
    1,
    'Remounting must not create an automatic retry loop.',
  );
  fail = false;
  await cache.load('/bad.mp4', true);
  assert.equal(cache.get('/bad.mp4').status, 'ready');
  assert.equal(cache.get('/good.mp4'), good);
  assert.deepEqual(calls, ['/bad.mp4', '/good.mp4', '/bad.mp4']);
});

test('network failures publish a bounded per-video message and can be retried', async () => {
  let failed = true;
  const cache = createRecordedPreviewCache({
    fetch: async () => {
      if (failed) throw Error('private provider detail');
      return new Response('video');
    },
    createURL: () => 'blob:retried',
  });
  await assert.rejects(cache.load('/take.mp4'), /private provider detail/);
  assert.equal(cache.get('/take.mp4').error, 'This video could not be loaded. Try again.');
  failed = false;
  assert.equal(await cache.load('/take.mp4', true), 'blob:retried');
});

test('disposing a lazy cache releases completed previews and cannot leak an in-flight blob', async () => {
  const pending = deferred<Response>();
  const released: string[] = [],
    created: string[] = [];
  const cache = createRecordedPreviewCache({
    fetch: async (url) => (url === '/pending.mp4' ? pending.promise : new Response('video')),
    createURL: () => {
      const url = 'blob:take-' + created.length;
      created.push(url);
      return url;
    },
    revokeURL: (url) => released.push(url),
  });
  await cache.load('/ready.mp4');
  const loading = cache.load('/pending.mp4');
  cache.dispose();
  pending.resolve(new Response('late video'));
  await assert.rejects(loading, /preview was closed/);
  assert.deepEqual(created, ['blob:take-0']);
  assert.deepEqual(released, created);
  assert.equal(cache.get('/ready.mp4').status, 'idle');
});

test('browser transport startup resolves after the snapshot without fetching or waiting for any MP4', async () => {
  const videoResponse = deferred<Response>(),
    calls: string[] = [];
  const transport = createBrowserTransport({
    blobPreviews: true,
    fetch: async (url) => {
      calls.push(url);
      return url === '/snapshot.json' ? Response.json(snapshot()) : videoResponse.promise;
    },
    createURL: () => 'blob:selected-preview',
  });
  await transport.initialize('/snapshot.json');
  assert.deepEqual(calls, ['/snapshot.json']);
  assert.deepEqual(await (await transport.request('/api/templates')).json(), []);
  assert.equal(transport.source('/one').status, 'idle');
  const selected = transport.prepare('/one');
  await Promise.resolve();
  assert.deepEqual(calls, ['/snapshot.json', '/assets/one.mp4']);
  assert.equal(transport.source('/one').status, 'loading');
  assert.equal(
    (await transport.request('/api/workspace')).status,
    200,
    'An unresolved video must not gate the editor API.',
  );
  assert.equal(transport.source('/two').status, 'idle');
  videoResponse.resolve(new Response('selected video bytes'));
  assert.equal(await selected, 'blob:selected-preview');
  assert.deepEqual(calls, ['/snapshot.json', '/assets/one.mp4']);
});

test('aliases share the same lazy preview while still images resolve synchronously without preparation', async () => {
  const calls: string[] = [];
  const transport = createBrowserTransport({
    blobPreviews: true,
    fetch: async (url) => {
      calls.push(url);
      return url === '/snapshot.json' ? Response.json(snapshot()) : new Response('original bytes');
    },
    createURL: () => 'blob:one',
  });
  await transport.initialize('/snapshot.json');
  assert.deepEqual(transport.source('/still'), { status: 'ready', src: '/assets/still.png' });
  assert.equal(transport.mediaUrl('/still'), '/assets/still.png');
  assert.equal(await transport.prepare('/still'), '/assets/still.png');
  assert.deepEqual(calls, ['/snapshot.json']);
  assert.deepEqual(
    await Promise.all([transport.prepare('/one'), transport.prepare('/one-alias')]),
    ['blob:one', 'blob:one'],
  );
  assert.equal(transport.mediaUrl('/one'), 'blob:one');
  assert.equal(transport.mediaUrl('/one-alias'), 'blob:one');
  assert.equal(transport.source('/one'), transport.source('/one-alias'));
  assert.deepEqual(calls, ['/snapshot.json', '/assets/one.mp4']);
});

test('downloading a recorded video reuses the prepared original bytes without another source download', async () => {
  const bytes = await readFile(new URL('../examples/portal/source.mp4', import.meta.url));
  const calls: string[] = [],
    objects = new Map<string, Blob>();
  const transport = createBrowserTransport({
    blobPreviews: true,
    fetch: async (url) => {
      calls.push(url);
      if (url === '/snapshot.json') return Response.json(snapshot());
      if (objects.has(url)) return new Response(objects.get(url));
      return new Response(bytes);
    },
    createURL: (blob) => {
      objects.set('blob:original', blob);
      return 'blob:original';
    },
  });
  await transport.initialize('/snapshot.json');
  await transport.prepare('/one');
  const download = await transport.blob('/one-alias');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.deepEqual(calls, ['/snapshot.json', '/assets/one.mp4', 'blob:original']);
});

test('direct-media browser builds keep native video URLs and never prepare blobs', async () => {
  const calls: string[] = [];
  const transport = createBrowserTransport({
    fetch: async (url) => {
      calls.push(url);
      return Response.json(snapshot());
    },
    createURL: () => {
      throw Error('Direct mode must not create a blob.');
    },
  });
  await transport.initialize('/snapshot.json');
  assert.deepEqual(transport.source('/one'), { status: 'ready', src: '/assets/one.mp4' });
  assert.equal(await transport.prepare('/one'), '/assets/one.mp4');
  assert.deepEqual(calls, ['/snapshot.json']);
});

test('missing recorded media shows a bounded error while an absent preview stays idle', async () => {
  const calls: string[] = [];
  const transport = createBrowserTransport({
    blobPreviews: true,
    fetch: async (url) => {
      calls.push(url);
      return Response.json(snapshot());
    },
  });
  await transport.initialize('/snapshot.json');
  assert.deepEqual(transport.source(undefined), { status: 'idle' });
  assert.deepEqual(transport.source(''), { status: 'idle' });
  assert.deepEqual(transport.source('/missing-video'), {
    status: 'error',
    error: 'This recorded video is unavailable. Choose another recorded take.',
  });
  await assert.rejects(transport.prepare('/missing-video', true), /recorded asset is unavailable/);
  assert.equal(transport.source('/missing-video').status, 'error');
  assert.equal(transport.source('/one').status, 'idle');
  assert.deepEqual(calls, ['/snapshot.json'], 'Do not fetch the page or an empty URL as media.');
});
