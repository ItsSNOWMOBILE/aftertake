import { createJobTarget } from '../server/job-target.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import type { Comfy } from '@comfyorg/sdk';
import { imageRouter } from '../server/images.js';
import { buildImageWorkflow, imageRequirements } from '../server/image-workflow.js';
import {
  imageBusy,
  imageDimensions,
  imagePrompt,
  imageRequestSchema,
  type ImageGeneration,
  type ImageRequest,
} from '../src/image-generation.js';
import { contentDigest } from '../server/edit-plan.js';

const request: ImageRequest = {
  format: 'aftertake-image/1',
  name: 'A new scene',
  prompt: 'An observatory above a sea of clouds.',
  seed: 5090,
  aspect: 'landscape',
  style: 'cinematic',
};

// A complete, decodable RGB PNG with a controlled native prompt chunk. Wrong
// dimensions, missing metadata and altered graphs must never become source clips.
function imagePng(graph?: Record<string, unknown>, aspect: ImageRequest['aspect'] = 'landscape') {
  const [width, height] = imageDimensions(aspect);
  function chunk(name: string, data: Buffer) {
    const type = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([type, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    type.copy(result, 4);
    data.copy(result, 8);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...(graph ? [chunk('tEXt', Buffer.from('prompt\0' + JSON.stringify(graph)))] : []),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function until(
  read: (signal?: AbortSignal) => Promise<ImageGeneration[]>,
  state: string,
  error?: RegExp,
) {
  const timeout = AbortSignal.timeout(15000),
    started = performance.now();
  let value: ImageGeneration | undefined;
  const describe = () =>
    JSON.stringify({ state: value?.state, stage: value?.stage, error: value?.error });
  try {
    for (;;) {
      value = (await read(timeout))[0];
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
            `Image reached an unexpected state while waiting for ${state}: ${describe()}`,
          );
      }
      await delay(25, undefined, { signal: timeout });
    }
  } catch (failure) {
    if (!timeout.aborted) throw failure;
  }
  assert.fail(
    `Image did not reach ${state} within ${Math.round(performance.now() - started)}ms: ${describe()}`,
  );
}

test('text-only generation uses an empty latent, the chosen format/style and the official eight-step sampler', () => {
  for (const aspect of ['landscape', 'portrait', 'square'] as const) {
    const graph = buildImageWorkflow({ ...request, aspect });
    assert.equal(
      Object.values(graph).some((node) => /LoadImage|LoadVideo/.test(node.class_type)),
      false,
    );
    assert.deepEqual([graph['7'].inputs.width, graph['7'].inputs.height], imageDimensions(aspect));
    assert.equal(graph['7'].class_type, 'EmptySD3LatentImage');
    assert.deepEqual(graph['17'].inputs.latent_image, ['7', 0]);
    assert.deepEqual(graph['17'].inputs.positive, ['5', 0]);
    assert.equal(graph['17'].inputs.sampler_name, 'res_multistep');
    assert.equal(graph['17'].inputs.scheduler, 'simple');
    assert.equal(graph['17'].inputs.steps, 8);
    assert.equal(graph['17'].inputs.cfg, 1);
    assert.equal(graph['17'].inputs.seed, 5090);
    assert.equal(graph['2'].inputs.type, 'lumina2');
    assert.match(String(graph['5'].inputs.text), /observatory.*clouds/);
    assert.match(String(graph['5'].inputs.text), /Cinematic composition/);
  }
  assert.equal(imagePrompt({ ...request, style: 'none' }), request.prompt);
  assert.notEqual(
    imagePrompt({ ...request, style: 'photo' }),
    imagePrompt({ ...request, style: 'product' }),
  );
  assert.equal(imageRequirements().menus.length, 3);
  for (const change of [
    { name: ' ' },
    { prompt: 'hi' },
    { seed: -1 },
    { seed: 0.5 },
    { seed: 2 ** 32 },
    { aspect: 'wide' },
    { style: 'secret' },
  ])
    assert.equal(imageRequestSchema.safeParse({ ...request, ...change }).success, false);
});

test('image shot direction survives sharing and reaches the executed prompt without changing older recipes', () => {
  const directed = imageRequestSchema.parse({
    ...request,
    direction: { shot: 'close', lens: 'portrait', lighting: 'soft' },
  });
  assert.deepEqual(imageRequestSchema.parse(JSON.parse(JSON.stringify(directed))), directed);
  const prompt = imagePrompt(directed),
    graph = buildImageWorkflow(directed);
  assert.match(prompt, /Close-up composition/);
  assert.match(prompt, /85 mm/);
  assert.match(prompt, /Soft, directional window light/);
  assert.equal(graph['5'].inputs.text, prompt);
  assert.notEqual(
    imagePrompt({ ...directed, direction: { ...directed.direction!, lighting: 'hard' } }),
    prompt,
  );
  assert.equal(
    imagePrompt({ ...request, direction: { shot: 'none', lens: 'none', lighting: 'none' } }),
    imagePrompt(request),
  );
  assert.equal(imageRequestSchema.parse(request).direction, undefined);
  assert.equal(
    imageRequestSchema.safeParse({
      ...request,
      direction: { shot: 'fake', lens: 'portrait', lighting: 'soft' },
    }).success,
    false,
  );
});

test('ambiguous image admission keeps its key and rejects a mismatched output before publishing any canonical clip', async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-image-test-'));
  const wrong = buildImageWorkflow(request);
  wrong['17'].inputs.seed = 123;
  let output = imagePng(wrong),
    first = true,
    admitting = false,
    freeCalls = 0,
    outputCalls = 0;
  const keys: string[] = [];
  const job = {
    id: randomUUID(),
    status: 'running',
    refresh: async () => {},
    events: async function* () {},
    cancel: async () => {
      job.status = 'canceled';
    },
    getOutputs: () => [
      {
        toFile: async (file: string) => {
          outputCalls++;
          await writeFile(file, output);
        },
      },
    ],
  };
  const client = {
    workflows: { fromJson: (graph: unknown) => graph },
    jobs: { get: async () => job },
    submit: async (_graph: unknown, options: { idempotencyKey: string }) => {
      const persisted = JSON.parse(
        await readFile(path.join(data, 'images', options.idempotencyKey + '.json'), 'utf8'),
      );
      assert.deepEqual(persisted.jobTarget, context.target.binding);
      assert.equal(admitting || keys.length > 0, true);
      keys.push(options.idempotencyKey);
      if (first) {
        first = false;
        throw Error('response lost after admission');
      }
      return job;
    },
  } as unknown as Comfy;
  let imageFile = '',
    runningWrites = 0,
    heldFailure = false,
    releaseRunning!: () => void,
    runningReady!: () => void,
    releaseFailure!: () => void,
    failureReady!: () => void;
  const runningPersisting = new Promise<void>((resolve) => {
      runningReady = resolve;
    }),
    runningReleased = new Promise<void>((resolve) => {
      releaseRunning = resolve;
    }),
    failurePersisting = new Promise<void>((resolve) => {
      failureReady = resolve;
    }),
    failureReleased = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    }),
    rename = fs.rename;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] === imageFile) {
      const pending = JSON.parse(await readFile(args[0], 'utf8')) as ImageGeneration;
      if (pending.state === 'running' && ++runningWrites === 2) {
        runningReady();
        await runningReleased;
      }
      if (!heldFailure && pending.state === 'output_error') {
        heldFailure = true;
        failureReady();
        await failureReleased;
      }
    }
    await rename(...args);
  });
  syncBuiltinESMExports();
  const context = {
    data,
    client,
    target: createJobTarget({
      sdkBaseUrl: 'http://127.0.0.1:8189',
      uiBaseUrl: 'http://127.0.0.1:8188',
      allowLegacyLoopback: true,
    }),
    uiUrl: '',
    engine: async () => ({ connected: true, ready: true, missing: [], message: '' }),
    takeBusy: () => admitting,
    setAdmitting: (value: boolean) => {
      admitting = value;
    },
  };
  const images = await imageRouter(context),
    app = express();
  app.use(express.json());
  app.use('/api/images', images.router);
  app.get('/queue', (_req, res) => {
    res.json({ queue_running: [1], queue_pending: [] });
  });
  app.post('/free', (_req, res) => {
    freeCalls++;
    res.json({});
  });
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  context.uiUrl = `http://127.0.0.1:${address.port}`;
  const post = (url: string, body: unknown = {}, key?: string) =>
    fetch(context.uiUrl + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
  const read = (signal?: AbortSignal) =>
    fetch(context.uiUrl + '/api/images', { signal }).then((r) => {
      assert.equal(r.status, 200);
      return r.json();
    }) as Promise<ImageGeneration[]>;
  try {
    const initial = await post('/api/images', request, 'image-original');
    assert.equal(initial.status, 502);
    const { image } = await initial.json();
    imageFile = path.join(data, 'images', image.id + '.json');
    assert.equal(image.state, 'submission_unknown');
    assert.equal(images.busy(), true);
    assert.equal(admitting, false);
    assert.equal((await post('/api/images', request)).status, 409);
    const rejoined = await post('/api/images', request, 'image-original');
    assert.equal(rejoined.status, 202);
    assert.equal((await rejoined.json()).id, image.id);
    assert.equal(keys.length, 1);
    assert.equal(
      (await post('/api/images', { ...request, seed: 123 }, 'image-original')).status,
      409,
    );
    assert.equal(keys.length, 1);
    assert.equal(
      (
        await post(
          '/api/images',
          { ...request, direction: { shot: 'close', lens: 'portrait', lighting: 'soft' } },
          'image-original',
        )
      ).status,
      409,
    );
    assert.equal(keys.length, 1);
    admitting = true;
    assert.equal((await post(`/api/images/${image.id}/reconcile`)).status, 409);
    assert.equal(keys.length, 1);
    admitting = false;
    assert.equal((await post(`/api/images/${image.id}/reconcile`)).status, 200);
    assert.deepEqual(keys, [image.id, image.id]);
    assert.equal((await post('/api/images', request)).status, 409);
    await Promise.race([
      runningPersisting,
      delay(15000, undefined, { ref: false }).then(() => {
        assert.fail('Image tracker did not begin persisting its running status within 15s.');
      }),
    ]);
    // SDK events can refresh this same job handle while the tracker persists.
    // A terminal status not yet processed must not make the running iteration exit.
    job.status = 'succeeded';
    releaseRunning();
    await Promise.race([
      failurePersisting,
      delay(15000, undefined, { ref: false }).then(async () => {
        const saved = JSON.parse(await readFile(imageFile, 'utf8')) as ImageGeneration;
        assert.fail(
          `Image did not begin persisting its workflow rejection within 15s: ${JSON.stringify({
            savedState: saved.state,
            jobStatus: job.status,
            runningWrites,
            outputCalls,
          })}`,
        );
      }),
    ]);
    // Recoverable errors become public only after persistence and tracker cleanup.
    // Hold the disk write to expose a prematurely published terminal state.
    const pending = (await read())[0];
    assert.equal(pending.state, 'finalizing');
    assert.equal(pending.error, undefined);
    assert.equal(images.busy(), true);
    assert.equal(JSON.parse(await readFile(imageFile, 'utf8')).state, 'finalizing');
    assert.equal((await post(`/api/images/${image.id}/reconcile`)).status, 409);
    releaseFailure();
    const rejected = await until(read, 'output_error', /metadata does not match/);
    assert.equal(rejected.clip, undefined);
    await assert.rejects(readFile(path.join(data, 'clips', `${image.id}.json`)), {
      code: 'ENOENT',
    });
    // A retry of the same finished job still rejects a portrait file for a landscape request.
    output = imagePng(buildImageWorkflow(request), 'portrait');
    assert.equal((await post(`/api/images/${image.id}/reconcile`)).status, 200);
    await until(read, 'output_error', /unexpected dimensions/);
    await assert.rejects(readFile(path.join(data, 'clips', `${image.id}.json`)), {
      code: 'ENOENT',
    });
    // Property order is irrelevant. Exact graph inputs, dimensions and downloaded bytes matter.
    const actual = buildImageWorkflow(request);
    actual['17'].inputs = Object.fromEntries(Object.entries(actual['17'].inputs).reverse());
    output = imagePng(actual);
    assert.equal((await post(`/api/images/${image.id}/reconcile`)).status, 200);
    const completed = await until(read, 'succeeded');
    assert.equal(images.busy(), false);
    assert.equal(imageBusy(completed), false);
    assert.equal(keys.length, 2);
    assert.equal(freeCalls, 0);
    assert.equal(outputCalls, 3);
    assert.equal(completed.clip!.sha256, createHash('sha256').update(output).digest('hex'));
    const stored = JSON.parse(await readFile(path.join(data, 'clips', `${image.id}.json`), 'utf8'));
    assert.deepEqual(stored, completed.clip);
    const recipe = await fetch(context.uiUrl + `/api/images/${image.id}/recipe`).then((r) =>
      r.json(),
    );
    assert.deepEqual(recipe.workflow, actual);
    assert.equal(recipe.request.prompt, request.prompt);
    assert.equal(recipe.jobId, job.id);
    const finished = await post('/api/images', request, 'image-original');
    assert.equal(finished.status, 200);
    assert.equal((await finished.json()).id, image.id);
    assert.equal(keys.length, 2);
  } finally {
    releaseRunning();
    releaseFailure();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    job.status = 'canceled';
    server.close();
    server.closeAllConnections();
    assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
    assert.ok(path.basename(data).startsWith('aftertake-image-test-'));
    await rm(data, { recursive: true, force: true });
  }
});

test('restarting observes known image jobs and holds uncertain submissions for explicit recovery with their original key', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-image-test-'));
  await mkdir(path.join(data, 'images'));
  const base = {
    request,
    workflow: buildImageWorkflow(request),
    progress: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const originalGraph = structuredClone(base.workflow);
  originalGraph['5'].inputs.text = 'Original saved prompt from a previous workflow revision';
  const unknown = {
      ...base,
      workflow: originalGraph,
      id: randomUUID(),
      state: 'submitting',
      requestKey: 'persisted-image',
      requestDigest: contentDigest(request),
    },
    known = { ...base, id: randomUUID(), state: 'running', jobId: randomUUID() };
  for (const record of [unknown, known])
    await writeFile(path.join(data, 'images', record.id + '.json'), JSON.stringify(record));
  let submits = 0,
    observations = 0,
    ready = true;
  const job = {
    id: known.jobId,
    status: 'canceled',
    refresh: async () => {},
    events: async function* () {},
  };
  const client = {
    workflows: { fromJson: (graph: unknown) => graph },
    jobs: {
      get: async () => {
        observations++;
        return job;
      },
    },
    submit: async (graph: unknown, options: { idempotencyKey: string }) => {
      submits++;
      assert.deepEqual(graph, originalGraph);
      assert.equal(options.idempotencyKey, unknown.id);
      return job;
    },
  } as unknown as Comfy;
  const images = await imageRouter({
    data,
    client,
    target: createJobTarget({
      sdkBaseUrl: 'http://127.0.0.1:8189',
      uiBaseUrl: 'http://127.0.0.1:8188',
      allowLegacyLoopback: true,
    }),
    uiUrl: '',
    engine: async () => ({ connected: true, ready, missing: [], message: '' }),
    takeBusy: () => false,
    setAdmitting: () => {},
  });
  const app = express();
  app.use(express.json());
  app.use('/api/images', images.router);
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const post = (endpoint: string, body: unknown = {}, key?: string) =>
    fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
  try {
    const records: ImageGeneration[] = await fetch(url + '/api/images').then((r) => r.json());
    assert.equal(records.find((image) => image.id === unknown.id)?.state, 'submission_unknown');
    assert.equal(observations, 1);
    assert.equal(submits, 0);
    assert.equal(images.busy(), true);
    const rejoined = await post('/api/images', request, 'persisted-image');
    assert.equal(rejoined.status, 202);
    assert.equal((await rejoined.json()).id, unknown.id);
    assert.equal(submits, 0);
    assert.equal((await post('/api/images', request)).status, 409);
    assert.equal((await post(`/api/images/${unknown.id}/cancel`)).status, 409);
    assert.equal((await post(`/api/images/${unknown.id}/reconcile`)).status, 200);
    for (let attempt = 0; images.busy() && attempt < 50; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(images.busy(), false);
    assert.equal(submits, 1);
    ready = false;
    assert.equal((await post('/api/images', request)).status, 409);
    assert.equal(submits, 1);
    await assert.rejects(readFile(path.join(data, 'clips', unknown.id + '.json')), {
      code: 'ENOENT',
    });
  } finally {
    server.close();
    server.closeAllConnections();
    assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
    assert.ok(path.basename(data).startsWith('aftertake-image-test-'));
    await rm(data, { recursive: true, force: true });
  }
});
