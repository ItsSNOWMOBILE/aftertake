import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Comfy } from '@comfyorg/sdk';
import {
  videoRequestSchema,
  videoDimensions,
  videoPrompt,
  type VideoRequest,
  type VideoGeneration,
} from '../src/video-generation.js';
import { buildVideoWorkflow } from '../server/video-workflow.js';
import { videoRouter } from '../server/videos.js';
import { registerGenerationTools } from '../server/generation-tools.js';

const request: VideoRequest = {
  format: 'aftertake-text-video/1',
  name: 'Native video fixture',
  prompt: 'Steam rises from an unbranded coffee cup.',
  seed: 5090,
  aspect: 'landscape',
  quality: 'draft',
  seconds: 2,
  sound: true,
};
const box = (name: string, data: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + data.length);
  header.write(name, 4, 'latin1');
  return Buffer.concat([header, data]);
};
function movie(workflow = buildVideoWorkflow(request), recipe = request) {
  const type = Buffer.alloc(8);
  type.writeUInt32BE(1);
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000')),
    box('mdat', Buffer.from([1])),
    box(
      'moov',
      box(
        'udta',
        box(
          'meta',
          Buffer.concat([
            Buffer.alloc(4),
            box(
              'ilst',
              box(
                '©cmt',
                box(
                  'data',
                  Buffer.concat([type, Buffer.from(JSON.stringify({ recipe, workflow }))]),
                ),
              ),
            ),
          ]),
        ),
      ),
    ),
  ]);
}

test('text video has a native source-free AV graph, shared frame grid and effective sound/direction settings', () => {
  const value = videoRequestSchema.parse({
      ...request,
      cinema: { movement: 'pan', lens: 'wide', lighting: 'neon', palette: 'cool' },
    }),
    graph = buildVideoWorkflow(value);
  assert.deepEqual(videoDimensions(value), {
    width: 512,
    height: 288,
    frames: 49,
    fps: 24,
    duration: 49 / 24,
  });
  assert.deepEqual(
    videoDimensions({ ...value, quality: 'final', aspect: 'portrait', seconds: 5 }),
    { width: 576, height: 1024, frames: 121, fps: 24, duration: 121 / 24 },
  );
  assert.ok(
    Object.values(graph).every(
      (n) =>
        !['LoadImage', 'LoadVideo', 'AftertakeLoadClip', 'LTXVImgToVideoInplace'].includes(
          n.class_type,
        ),
    ),
  );
  assert.match(videoPrompt(value), /rotates slowly to the left/);
  assert.match(videoPrompt(value), /Cyan and magenta/);
  assert.doesNotMatch(videoPrompt(value), /reference|supplied/i);
  assert.equal(graph['5'].inputs.text, videoPrompt(value));
  assert.equal(graph['20'].inputs.palette, 'cool');
  assert.deepEqual(graph['21'].inputs.generated_audio, ['22', 0]);
  const silent = buildVideoWorkflow({ ...value, sound: false });
  assert.equal(silent['22'], undefined);
  assert.equal(silent['21'].inputs.generated_audio, undefined);
  assert.ok(
    silent['9'] && silent['10'],
    'Silent delivery still uses the trained joint AV sampler.',
  );
  assert.equal(
    videoRequestSchema.safeParse({ ...value, cinema: { ...value.cinema, guidance: 'tracks' } })
      .success,
    false,
  );
  for (const bad of [{ seconds: 2.5 }, { seconds: 20 }, { seed: -1 }, { prompt: '   ' }])
    assert.equal(videoRequestSchema.safeParse({ ...request, ...bad }).success, false);
});

test('native video admission rejoins its key and rejects mismatched workflow or decoded media before source publication', async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-video-')),
    keys: string[] = [];
  let first = true,
    admitting = false,
    output = movie(),
    decoded = {
      ...videoDimensions(request),
      hasAudio: true,
      regularTimestamps: true,
      firstTimestamp: 0,
      audio: {
        sampleRate: 24000,
        channels: 2,
        samples: 49000,
        duration: 49 / 24,
        firstTimestamp: 0,
        regularTimestamps: true,
      },
    };
  const job = {
    id: randomUUID(),
    status: 'running',
    refresh: async () => {},
    events: async function* () {},
    cancel: async () => {
      job.status = 'canceled';
    },
    getOutputs: () => [{ toFile: async (file: string) => writeFile(file, output) }],
  };
  const client = {
    workflows: { fromJson: (graph: unknown) => graph },
    jobs: { get: async () => job },
    submit: async (_graph: unknown, options: { idempotencyKey: string }) => {
      keys.push(options.idempotencyKey);
      if (first) {
        first = false;
        throw Error('response lost after admission');
      }
      return job;
    },
  } as unknown as Comfy;
  let videoFile = '',
    heldFailure = false,
    releaseFailure!: () => void,
    failureReady!: () => void;
  const failurePersisting = new Promise<void>((resolve) => {
      failureReady = resolve;
    }),
    failureReleased = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    }),
    rename = fs.rename;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (!heldFailure && args[1] === videoFile) {
      const pending = JSON.parse(await readFile(args[0], 'utf8')) as VideoGeneration;
      if (pending.state === 'output_error') {
        heldFailure = true;
        failureReady();
        await failureReleased;
      }
    }
    await rename(...args);
  });
  syncBuiltinESMExports();
  const context = {
    root: process.cwd(),
    python: 'unused',
    data,
    client,
    uiUrl: '',
    inspect: async () => decoded,
    engine: async () => ({ connected: true, ready: true, missing: [], message: '' }),
    takeBusy: () => admitting,
    setAdmitting: (v: boolean) => {
      admitting = v;
    },
  };
  const videos = await videoRouter(context),
    app = express();
  app.use(express.json());
  app.use('/api/videos', videos.router);
  app.get('/queue', (_req, res) => res.json({ queue_running: [1], queue_pending: [] }));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  context.uiUrl = `http://127.0.0.1:${address.port}`;
  const post = (route: string, value: unknown = {}, key?: string) =>
    fetch(context.uiUrl + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(value),
    });
  const read = (signal?: AbortSignal) =>
    fetch(context.uiUrl + '/api/videos', { signal }).then((r) => {
      assert.equal(r.status, 200);
      return r.json();
    }) as Promise<VideoGeneration[]>;
  async function until(id: string, state: string, error?: RegExp) {
    const timeout = AbortSignal.timeout(15000),
      started = performance.now();
    let value: VideoGeneration | undefined;
    const describe = () =>
      JSON.stringify({
        state: value?.state,
        stage: value?.stage,
        error: value?.error,
      });
    try {
      for (;;) {
        value = (await read(timeout)).find((video) => video.id === id);
        if (value) {
          if (value.state === state) {
            if (error) assert.match(value.error || '', error);
            return value;
          }
          if (
            [
              'succeeded',
              'failed',
              'canceled',
              'expired',
              'output_error',
              'connection_lost',
              'submission_unknown',
            ].includes(value.state)
          )
            assert.fail(
              `Video ${id} reached an unexpected state while waiting for ${state}: ${describe()}`,
            );
        }
        await delay(25, undefined, { signal: timeout });
      }
    } catch (failure) {
      if (!timeout.aborted) throw failure;
    }
    assert.fail(
      `Video ${id} did not reach ${state} within ${Math.round(performance.now() - started)}ms: ${describe()}`,
    );
  }
  try {
    assert.equal((await post('/api/videos', request, 'video-original')).status, 502);
    const record = (await read())[0];
    videoFile = path.join(data, 'videos', record.id + '.json');
    assert.equal(record.state, 'submission_unknown');
    assert.ok(videos.busy());
    const joined = await post('/api/videos', request, 'video-original');
    assert.equal(joined.status, 202);
    assert.equal((await joined.json()).id, record.id);
    assert.equal(keys.length, 1);
    assert.equal(
      (await post('/api/videos', { ...request, sound: false }, 'video-original')).status,
      409,
    );
    assert.equal(keys.length, 1);
    assert.equal((await post('/api/videos', request, 'another-video')).status, 409);
    const wrong = buildVideoWorkflow(request);
    wrong['13'].inputs.noise_seed = 123;
    output = movie(wrong);
    job.status = 'succeeded';
    assert.equal((await post(`/api/videos/${record.id}/reconcile`)).status, 200);
    assert.deepEqual(keys, [record.id, record.id]);
    await Promise.race([
      failurePersisting,
      delay(15000, undefined, { ref: false }).then(() => {
        assert.fail('Video did not begin persisting its workflow rejection within 15s.');
      }),
    ]);
    // A public terminal error must mean an immediate recovery can start. Hold the
    // disk write so a premature state update cannot race past this assertion.
    const pending = (await read()).find((video) => video.id === record.id)!;
    assert.equal(pending.state, 'finalizing');
    assert.equal(pending.error, undefined);
    assert.equal(videos.busy(), true);
    assert.equal(JSON.parse(await readFile(videoFile, 'utf8')).state, 'finalizing');
    assert.equal((await post(`/api/videos/${record.id}/reconcile`)).status, 409);
    releaseFailure();
    await until(record.id, 'output_error', /workflow differs/);
    await assert.rejects(readFile(path.join(data, 'clips', record.id + '.json')), {
      code: 'ENOENT',
    });
    output = movie();
    decoded = { ...decoded, hasAudio: false };
    assert.equal((await post(`/api/videos/${record.id}/reconcile`)).status, 200);
    await until(record.id, 'output_error', /decoded video/);
    assert.equal(keys.length, 2);
    decoded = { ...decoded, hasAudio: true, frames: 48 };
    assert.equal((await post(`/api/videos/${record.id}/reconcile`)).status, 200);
    await until(record.id, 'output_error', /frame clock/);
    decoded = {
      ...videoDimensions(request),
      hasAudio: true,
      regularTimestamps: true,
      firstTimestamp: 0,
      audio: {
        sampleRate: 24000,
        channels: 2,
        samples: 49000,
        duration: 49 / 24,
        firstTimestamp: 0,
        regularTimestamps: true,
      },
    };
    assert.equal((await post(`/api/videos/${record.id}/reconcile`)).status, 200);
    const completed = await until(record.id, 'succeeded');
    assert.equal(completed.clip!.sha256, createHash('sha256').update(output).digest('hex'));
    assert.equal(completed.clip!.kind, 'video');
    assert.equal(videos.busy(), false);
    assert.equal((await post('/api/videos', request, 'video-original')).status, 200);
    assert.equal(keys.length, 2);
    const recipe = await fetch(context.uiUrl + `/api/videos/${record.id}/recipe`).then((r) =>
      r.json(),
    );
    assert.equal(recipe.jobId, job.id);
    assert.deepEqual(recipe.workflow, buildVideoWorkflow(request));
    const reopened = await videoRouter(context);
    assert.equal(reopened.busy(), false);
    assert.equal(keys.length, 2);
  } finally {
    releaseFailure();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    server.close();
    server.closeAllConnections();
  }
});

test('agent text video requires native support, uses stable request keys and exposes the completed source clip', async () => {
  const tools = new Map<string, any>(),
    calls: { route: string; key?: string }[] = [];
  let supported = false;
  const record = {
    id: randomUUID(),
    state: 'succeeded',
    request,
    requestKey: '',
    clip: { id: randomUUID(), url: '/media/fixture.mp4' },
  };
  registerGenerationTools({
    base: 'http://127.0.0.1:4345',
    bytes: async () => Buffer.alloc(0),
    tool: (name, _description, _schema, run) => {
      tools.set(name, run);
    },
    api: async (route: string, _body?: unknown, key?: string) => {
      calls.push({ route, key });
      if (route === '/api/workspace')
        return { generationProtocol: 1, textVideoProtocol: supported ? 1 : undefined } as any;
      if (route === '/api/videos' && key) {
        record.requestKey = key;
        return record as any;
      }
      if (route === '/api/videos') return [record] as any;
      throw Error('Unexpected route ' + route);
    },
  });
  await assert.rejects(
    tools.get('aftertake_generate_video')({ requestId: 'product-take', request }),
    /text-to-video support/,
  );
  assert.equal(calls.filter((c) => c.key).length, 0);
  supported = true;
  const first = await tools.get('aftertake_generate_video')({ requestId: 'product-take', request });
  const second = await tools.get('aftertake_generate_video')({
    requestId: 'product-take',
    request,
  });
  assert.equal(first.data.id, second.data.id);
  assert.equal(first.data.clip.id, record.clip.id);
  assert.equal(calls.filter((c) => c.key)[0].key, calls.filter((c) => c.key)[1].key);
  const status = await tools.get('aftertake_generation_status')({
    kind: 'video',
    requestId: 'product-take',
    includeWorkflow: true,
  });
  assert.equal(status.data.id, record.id);
});
