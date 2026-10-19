import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { createJobTarget } from '../server/job-target.js';
import {
  depthEffectsRouter,
  buildDepthWorkflow,
  depthRequirements,
} from '../server/depth-effects.js';
import {
  depthEffectRequestSchema,
  defaultDepthSettings,
  depthModel,
} from '../src/depth-effects.js';
import { handleRequestError } from '../server/http-errors.js';
import type { EngineClient } from '../server/sdk-port.js';

test('depth accepts still images only and its graph cannot allocate a model before the guarded wrapper', () => {
  const request = depthEffectRequestSchema.parse({
    format: 'aftertake-depth-effect/1',
    name: 'Depth',
    clip: {
      id: randomUUID(),
      name: 'Source',
      kind: 'image',
      sha256: 'a'.repeat(64),
      width: 640,
      height: 384,
      duration: 1,
      url: '/media/source.png',
    },
    settings: defaultDepthSettings,
  });
  const graph = buildDepthWorkflow(request);
  assert.deepEqual(
    Object.values(graph).map((node) => node.class_type),
    ['AftertakeLoadClip', 'AftertakeEstimateDepth'],
  );
  assert.equal(graph['1'].inputs.frames, 1);
  assert.equal(JSON.parse(graph['2'].inputs.request_json).clip.sha256, request.clip.sha256);
  assert.deepEqual(depthRequirements().menus, [
    ['LoadDA3Model', 'model_name', depthModel.filename],
  ]);
  for (const patch of [
    { clip: { ...request.clip, kind: 'video' } },
    { clip: { ...request.clip, width: 4096, height: 4096 } },
    { settings: { ...request.settings, blur: 33 } },
    { settings: { ...request.settings, lightStrength: NaN } },
  ])
    assert.equal(depthEffectRequestSchema.safeParse({ ...request, ...patch }).success, false);
});

test('depth admission honors GPU readiness/global lock and preserves ambiguous SDK request identity', async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-depth-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const clips = path.join(data, 'clips');
  await mkdir(clips);
  const savedFolder = path.join(data, 'depth-effects');
  await mkdir(savedFolder);
  const brokenRecord = path.join(savedFolder, randomUUID() + '.json');
  await writeFile(brokenRecord, '{incomplete record');
  const bytes = Buffer.from('synthetic image: admission test never decodes or estimates depth');
  const clip = {
    id: randomUUID(),
    name: 'Source',
    kind: 'image' as const,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: 96,
    height: 64,
    duration: 1,
    url: '/media/source.png',
  };
  await writeFile(path.join(clips, clip.id + '.json'), JSON.stringify(clip));
  await writeFile(path.join(clips, 'source.png'), bytes);
  let ready = false,
    locked = false,
    admitting = false,
    submits = 0;
  const keys: string[] = [],
    bindings: unknown[] = [];
  const client: EngineClient = {
    assets: { fromFile: (value) => value },
    workflows: { fromJson: () => ({ setInput: (_id, _name, value) => bindings.push(value) }) },
    jobs: {
      get: async () => {
        throw Error('Unexpected recovery');
      },
    },
    submit: async (_workflow, options) => {
      submits++;
      keys.push(options.idempotencyKey);
      throw Error('SDK response timed out');
    },
  };
  const target = createJobTarget({
    sdkBaseUrl: 'http://127.0.0.1:8189',
    uiBaseUrl: 'http://127.0.0.1:8188',
  });
  const worker = await depthEffectsRouter({
    root: data,
    data,
    python: process.execPath,
    client,
    target,
    engine: async () => ({
      connected: true,
      ready,
      missing: ready ? [] : ['CUDA BF16 is unavailable'],
      message: 'Depth blocked',
    }),
    takeBusy: () => locked,
    setAdmitting: (value) => {
      admitting = value;
    },
  });
  const app = express();
  app.use(express.json());
  app.use('/depth', worker.router);
  app.use(handleRequestError);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/depth`;
  const request = {
      format: 'aftertake-depth-effect/1',
      name: 'Test',
      clip,
      settings: defaultDepthSettings,
    },
    key = randomUUID();
  const post = (body = request, requestKey = key) =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
      body: JSON.stringify(body),
    });
  let response = await post();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /CUDA BF16/);
  assert.equal(submits, 0);
  assert.equal(admitting, false);
  ready = true;
  locked = true;
  response = await post();
  assert.equal(response.status, 409);
  assert.equal(submits, 0);
  locked = false;
  response = await post();
  assert.equal(response.status, 502);
  const value = await response.json();
  assert.equal(value.depthEffect.state, 'submission_unknown');
  assert.equal(submits, 1);
  assert.equal(admitting, false);
  assert.equal(worker.busy(), true);
  assert.equal(bindings[0], path.join(clips, 'source.png'));
  response = await post();
  assert.equal(response.status, 202);
  assert.equal(submits, 1);
  response = await post({ ...request, name: 'Different' });
  assert.equal(response.status, 409);
  assert.equal(submits, 1);
  response = await fetch(base + '/' + value.depthEffect.id + '/reconcile', { method: 'POST' });
  assert.equal(response.status, 502);
  assert.equal(submits, 2);
  assert.equal(keys[0], keys[1]);
  const saved = JSON.parse(
    await readFile(path.join(data, 'depth-effects', value.depthEffect.id + '.json'), 'utf8'),
  );
  assert.equal(saved.requestKey, key);
  assert.equal(saved.jobTarget.fingerprint, target.binding.fingerprint);
  assert.equal(
    await readFile(brokenRecord, 'utf8'),
    '{incomplete record',
    'Corrupt records stay recoverable without preventing startup.',
  );
});
