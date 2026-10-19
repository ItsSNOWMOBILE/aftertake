import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadRouterMedia,
  inspectRouterMedia,
  supportedRouterMediaUrl,
  type RouterMediaInfo,
} from '../server/router-media.js';
import type { RouterVideoRequest } from '../src/router-video.js';

const mediaUrl =
  'https://storage.googleapis.com/ltx-research-model-serving/fixture/output/video.mp4';
const request: RouterVideoRequest = {
  format: 'aftertake-router-video/1',
  name: 'Hosted coffee fixture',
  prompt: 'A still coffee cup in soft morning light.',
  aspect: 'landscape',
  seconds: 2,
  sound: false,
};
const runtime = { root: 'unused-runtime', python: 'unused-python' };
const clock = (): RouterMediaInfo => ({
  width: 1280,
  height: 720,
  frames: 49,
  fps: 24,
  duration: 49 / 24,
  hasAudio: false,
  regularTimestamps: true,
  firstTimestamp: 0,
});
const withSound = (padding = 0): RouterMediaInfo => ({
  ...clock(),
  hasAudio: true,
  audio: {
    sampleRate: 48000,
    channels: 2,
    samples: Math.round((49 / 24 + padding) * 48000),
    duration: 49 / 24 + padding,
    firstTimestamp: 0,
    regularTimestamps: true,
  },
});

function mp4() {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('isom', 8, 'ascii');
  bytes.write('fixture-byte-identity', 24, 'ascii');
  return bytes;
}

type FetchCall = { url: string; init: RequestInit };
function fetchFixture(answer: () => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetcher = (async (url: URL | Request | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { calls, fetcher };
}

test('only HTTPS MP4 results in the observed LTX bucket are eligible for collection', () => {
  assert.equal(supportedRouterMediaUrl(mediaUrl).href, mediaUrl);
  const signed = `${mediaUrl}?X-Goog-Signature=private-fixture-token`;
  assert.equal(supportedRouterMediaUrl(signed).href, signed);
  assert.equal(
    supportedRouterMediaUrl(
      mediaUrl.replace('storage.googleapis.com', 'storage.googleapis.com:443'),
    ).href,
    mediaUrl,
  );
  for (const url of [
    'http://127.0.0.1/video.mp4',
    'https://127.0.0.1/video.mp4',
    'https://localhost/video.mp4',
    'https://169.254.169.254/ltx-research-model-serving/video.mp4',
    mediaUrl.replace('storage.googleapis.com', 'storage.googleapis.com.evil.test'),
    mediaUrl.replace('storage.googleapis.com', 'user:password@storage.googleapis.com'),
    mediaUrl.replace('storage.googleapis.com', 'storage.googleapis.com:8443'),
    mediaUrl.replace('/ltx-research-model-serving/', '/different-bucket/'),
    mediaUrl.replace('/ltx-research-model-serving/', '/ltx-research-model-serving-lookalike/'),
    mediaUrl.replace('/fixture/', '/../../different-bucket/'),
    mediaUrl.replace('/fixture/', '/%2e%2e/%2e%2e/different-bucket/'),
    mediaUrl.replace('.mp4', '.html'),
    `${mediaUrl}#fragment`,
    `file:///ltx-research-model-serving/video.mp4`,
    `https://storage.googleapis.com/ltx-research-model-serving/${'x'.repeat(8192)}.mp4`,
  ]) {
    assert.throws(
      () => supportedRouterMediaUrl(url),
      /unsupported media destination/,
      `destination was unexpectedly accepted: ${url.slice(0, 120)}`,
    );
  }
});

test('untrusted media destinations fail before the network is used', async () => {
  const { calls, fetcher } = fetchFixture(() => new Response(mp4()));
  await assert.rejects(
    downloadRouterMedia('https://127.0.0.1/private/video.mp4', fetcher),
    /unsupported media destination/,
  );
  assert.equal(calls.length, 0);
});

test('MP4 collection preserves exact bytes and never sends authentication or follows redirects', async () => {
  const original = mp4();
  const { calls, fetcher } = fetchFixture(
    () => new Response(original, { headers: { 'Content-Type': 'video/mp4' } }),
  );
  assert.deepEqual(await downloadRouterMedia(mediaUrl, fetcher), original);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, mediaUrl);
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual([...new Headers(calls[0].init.headers)], []);
  assert.equal(calls[0].init.body, undefined);
});

test('redirect, failure and empty responses cannot become completed media', async () => {
  for (const reply of [
    new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } }),
    new Response('provider failed', { status: 500 }),
    new Response(null, { status: 200 }),
  ]) {
    const { calls, fetcher } = fetchFixture(() => reply);
    await assert.rejects(downloadRouterMedia(mediaUrl, fetcher));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, 'error');
    assert.deepEqual([...new Headers(calls[0].init.headers)], []);
  }
});

test('the declared 100 MiB limit rejects an oversized response before reading its body', async () => {
  let reads = 0;
  let canceled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        controller.enqueue(mp4());
      },
      cancel() {
        canceled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const { fetcher } = fetchFixture(
    () =>
      new Response(body, {
        headers: { 'Content-Length': String(100 * 1024 * 1024 + 1) },
      }),
  );
  await assert.rejects(downloadRouterMedia(mediaUrl, fetcher), /media limit/);
  assert.equal(reads, 0);
  assert.equal(canceled, true);
});

test('the streamed 100 MiB limit applies even when Content-Length is absent or dishonest', async () => {
  for (const contentLength of [undefined, '64']) {
    const chunk = Buffer.alloc(1024 * 1024);
    chunk.write('ftyp', 4, 'ascii');
    let emitted = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          emitted++;
          controller.enqueue(chunk);
        },
        cancel() {
          canceled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const { fetcher } = fetchFixture(
      () =>
        new Response(body, {
          headers: contentLength ? { 'Content-Length': contentLength } : {},
        }),
    );
    await assert.rejects(downloadRouterMedia(mediaUrl, fetcher), /download was interrupted/);
    assert.equal(emitted, 101);
    assert.equal(canceled, true);
  }
});

test('short payloads, HTML and interrupted streams do not pass the MP4 guard', async () => {
  for (const bytes of [Buffer.alloc(15), Buffer.from('<html>not a video</html>')]) {
    const { fetcher } = fetchFixture(() => new Response(bytes));
    await assert.rejects(downloadRouterMedia(mediaUrl, fetcher), /did not return an MP4/);
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(mp4());
      controller.error(new Error('private provider transport detail'));
    },
  });
  const { fetcher } = fetchFixture(() => new Response(body));
  await assert.rejects(downloadRouterMedia(mediaUrl, fetcher), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /original request is retained/);
    assert.equal(error.message.includes('private provider transport detail'), false);
    return true;
  });
});

test('the actual 49-frame two-second LTX clock is accepted without changing the media', async () => {
  const measured = clock();
  let inspectedFilename = '';
  const result = await inspectRouterMedia(
    'native-output.mp4',
    request,
    runtime,
    async (filename) => {
      inspectedFilename = filename;
      return measured;
    },
  );
  assert.equal(inspectedFilename, 'native-output.mp4');
  assert.equal(result, measured);
  assert.equal(result.duration, 49 / 24);
  assert.equal(result.frames, 49);
});

test('portrait requests validate against their actual 720 by 1280 output canvas', async () => {
  const measured = { ...clock(), width: 720, height: 1280 };
  assert.equal(
    await inspectRouterMedia(
      'portrait.mp4',
      { ...request, aspect: 'portrait' },
      runtime,
      async () => measured,
    ),
    measured,
  );
});

test('supported durations accept exactly their nominal frame count or the observed extra frame', async () => {
  for (const seconds of [2, 3, 4, 5] as const) {
    for (const frames of [seconds * 24, seconds * 24 + 1]) {
      const measured = { ...clock(), frames, duration: frames / 24 };
      assert.equal(
        await inspectRouterMedia(
          'native-clock.mp4',
          { ...request, seconds },
          runtime,
          async () => measured,
        ),
        measured,
      );
    }
  }
});

test('wrong geometry, frame rate, timestamps, measured duration and sound fail validation', async () => {
  const changes: Partial<RouterMediaInfo>[] = [
    { width: 720, height: 1280 },
    { width: 1279 },
    { height: 721 },
    { fps: 25 },
    { fps: 0 },
    { frames: 0 },
    { frames: 46, duration: 46 / 24 },
    { frames: 47, duration: 47 / 24 },
    { frames: 50, duration: 50 / 24 },
    { frames: 56, duration: 56 / 24 },
    { frames: 57, duration: 57 / 24 },
    { frames: 49.5 },
    { frames: Number.NaN },
    { regularTimestamps: false },
    { firstTimestamp: 1 / 24 },
    { duration: 2 },
    { duration: Number.NaN },
    { duration: Number.POSITIVE_INFINITY },
    { hasAudio: true },
  ];
  for (const change of changes) {
    await assert.rejects(
      inspectRouterMedia('invalid.mp4', request, runtime, async () => ({ ...clock(), ...change })),
      /does not match its requested canvas/,
      JSON.stringify(change),
    );
  }
});

test('generated sound must be present, contiguous and cover the measured video clock', async () => {
  const soundRequest = { ...request, sound: true };
  for (const measured of [
    clock(),
    { ...withSound(), audio: undefined },
    {
      ...withSound(),
      audio: { ...withSound().audio!, regularTimestamps: false },
    },
    {
      ...withSound(),
      audio: { ...withSound().audio!, firstTimestamp: 0.025 },
    },
    { ...withSound(), audio: { ...withSound().audio!, samples: 0 } },
    { ...withSound(), audio: { ...withSound().audio!, channels: 0 } },
    { ...withSound(), audio: { ...withSound().audio!, channels: 6 } },
    { ...withSound(), audio: { ...withSound().audio!, duration: Number.NaN } },
  ]) {
    await assert.rejects(
      inspectRouterMedia('sound.mp4', soundRequest, runtime, async () => measured),
    );
  }
});

test('audio encoder padding within 0.08 seconds is tolerated without stretching or trimming', async () => {
  const soundRequest = { ...request, sound: true };
  for (const padding of [-0.079, 0, 0.079]) {
    const measured = withSound(padding);
    assert.equal(
      await inspectRouterMedia('sound.mp4', soundRequest, runtime, async () => measured),
      measured,
    );
  }
  for (const padding of [-0.081, 0.081]) {
    await assert.rejects(
      inspectRouterMedia('sound.mp4', soundRequest, runtime, async () => withSound(padding)),
      /does not cover the measured video clock/,
    );
  }
});

test('audio sample counts and rates cannot contradict the declared audio duration', async () => {
  const soundRequest = { ...request, sound: true };
  for (const change of [
    { samples: Number.NaN },
    { samples: Number.POSITIVE_INFINITY },
    { samples: -1 },
    { samples: 98000.5 },
    { samples: 48000 },
    { sampleRate: 0 },
    { sampleRate: Number.NaN },
    { sampleRate: 48000.5 },
    { sampleRate: 8000 },
    { sampleRate: 384000 },
    { sampleRate: 24000 },
  ]) {
    const measured = withSound();
    measured.audio = { ...measured.audio!, ...change };
    await assert.rejects(
      inspectRouterMedia('sound.mp4', soundRequest, runtime, async () => measured),
      /does not cover the measured video clock/,
      JSON.stringify(change),
    );
  }
});
