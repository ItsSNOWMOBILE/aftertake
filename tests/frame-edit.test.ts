import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import type { Comfy } from '@comfyorg/sdk';
import { frameEditorRouter, inspectFramePng } from '../server/frame-edits.js';
import { buildFrameEditWorkflow } from '../server/frame-workflow.js';
import { frameEditRequestSchema, type FrameEditRequest } from '../src/frame-edit.js';

const source = JSON.parse(
  await readFile(new URL('../examples/quiet-approach/clip.json', import.meta.url), 'utf8'),
);
const request: FrameEditRequest = {
  format: 'aftertake-frame-edit/1',
  clip: source,
  trimStart: 0,
  prompt: 'Replace the window with a crystal sculpture. Keep the composition.',
  seed: 731,
  mode: 'fast',
};

test('frame editing conditions on the selected source and optional subject, with distinct fast/detail samplers', () => {
  const subject = { ...source, id: '00000000-0000-4000-8000-000000000001', kind: 'image' as const };
  for (const mode of ['fast', 'detail'] as const) {
    const graph = buildFrameEditWorkflow({ ...request, mode, subject });
    assert.deepEqual(graph['10'].inputs.image1, ['9', 0]);
    assert.deepEqual(graph['10'].inputs.image2, ['23', 0]);
    assert.deepEqual(graph['11'].inputs.image2, ['23', 0]);
    assert.deepEqual(graph['14'].inputs.pixels, ['9', 0]);
    assert.equal(graph['12'].inputs.reference_latents_method, 'index_timestep_zero');
    assert.equal(graph['17'].inputs.steps, mode === 'fast' ? 4 : 20);
    assert.equal(graph['17'].inputs.cfg, mode === 'fast' ? 1 : 4);
    assert.deepEqual(graph['17'].inputs.model, [mode === 'fast' ? '6' : '5', 0]);
    assert.equal('6' in graph, mode === 'fast');
    assert.equal(graph['20'].inputs.width, source.width);
    assert.equal(graph['20'].inputs.height, source.height);
    assert.equal(graph['20'].inputs.crop, 'disabled');
  }
  assert.equal(frameEditRequestSchema.safeParse({ ...request, trimStart: 1 }).success, false);
  assert.equal(
    frameEditRequestSchema.safeParse({ ...request, subject: { ...subject, kind: 'video' } })
      .success,
    false,
  );
});

function withWorkflow(png: Buffer, workflow: Record<string, unknown>) {
  const data = Buffer.from('prompt\0' + JSON.stringify(workflow)),
    type = Buffer.from('tEXt');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

test('PNG output must retain the executed graph and reject missing or truncated metadata', async () => {
  const png = await readFile(new URL('../examples/quiet-approach/source.png', import.meta.url));
  assert.throws(() => inspectFramePng(png), /missing its executed workflow/);
  assert.throws(() => inspectFramePng(Buffer.from('not an image')), /did not return a PNG/);
  const graph = buildFrameEditWorkflow(request),
    bytes = withWorkflow(png, graph);
  assert.deepEqual(inspectFramePng(bytes).workflow, graph);
  assert.equal(inspectFramePng(bytes).width, source.width);
  assert.throws(() => inspectFramePng(bytes.subarray(0, bytes.length - 3)), /incomplete/);
});

test('accepted-but-unobserved frame submissions recover by the same key and publish a canonical image only after download', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-frame-test-'));
  await mkdir(path.join(data, 'clips'));
  const png = await readFile(new URL('../examples/quiet-approach/source.png', import.meta.url));
  await writeFile(path.join(data, 'clips', path.basename(source.url)), png);
  await writeFile(path.join(data, 'clips', `${source.id}.json`), JSON.stringify(source));
  const executed = buildFrameEditWorkflow(request);
  executed['8'].inputs.filename = 'sdk-uploaded-source.png';
  const output = withWorkflow(png, executed),
    keys: string[] = [],
    bindings: unknown[][] = [];
  const job = {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'running',
    refresh: async () => {},
    events: async function* () {},
    cancel: async () => {
      job.status = 'canceled';
    },
    getOutputs: () => [
      {
        toFile: async (file: string) => {
          await writeFile(file, output);
        },
      },
    ],
  };
  let first = true,
    admitting = false;
  const client = {
    workflows: { fromJson: () => ({ setInput: (...args: unknown[]) => bindings.push(args) }) },
    assets: { fromFile: (file: string) => file },
    jobs: { get: async () => job },
    submit: async (_workflow: unknown, options: { idempotencyKey: string }) => {
      keys.push(options.idempotencyKey);
      if (first) {
        first = false;
        throw Error('response lost after admission');
      }
      return job;
    },
  } as unknown as Comfy;
  const context = {
    data,
    client,
    uiUrl: '',
    engine: async () => ({ connected: true, ready: true, missing: [], message: '' }),
    takeBusy: () => admitting,
    setAdmitting: (value: boolean) => {
      admitting = value;
    },
  };
  const editor = await frameEditorRouter(context),
    app = express();
  app.use(express.json());
  app.use('/api/frame-edits', editor.router);
  app.get('/queue', (_req, res) => {
    res.json({ queue_running: [1], queue_pending: [] });
  });
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  context.uiUrl = `http://127.0.0.1:${address.port}`;
  const post = (url: string, body?: unknown, key?: string) =>
    fetch(context.uiUrl + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
  try {
    const input = {
      ...request,
      clip: { ...source, name: 'forged name', url: '/media/forged.png' },
    };
    const initial = await post('/api/frame-edits', input, 'frame-original');
    assert.equal(initial.status, 502);
    const { edit } = await initial.json();
    assert.equal(edit.state, 'submission_unknown');
    assert.equal(edit.request.clip.url, source.url);
    assert.equal(editor.busy(), true);
    assert.equal((await post('/api/frame-edits', request)).status, 409);
    assert.equal(keys.length, 1);
    const rejoined = await post('/api/frame-edits', input, 'frame-original');
    assert.equal(rejoined.status, 202);
    assert.equal((await rejoined.json()).id, edit.id);
    assert.equal(keys.length, 1);
    assert.equal(
      (await post('/api/frame-edits', { ...input, seed: input.seed + 1 }, 'frame-original')).status,
      409,
    );
    assert.equal(keys.length, 1);
    admitting = true;
    assert.equal((await post(`/api/frame-edits/${edit.id}/reconcile`)).status, 409);
    assert.equal(keys.length, 1);
    admitting = false;
    assert.equal((await post(`/api/frame-edits/${edit.id}/reconcile`)).status, 200);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(bindings[0][2], path.join(data, 'clips', path.basename(source.url)));
    job.status = 'succeeded';
    let completed: any;
    for (let attempt = 0; attempt < 70; attempt++) {
      completed = (await fetch(context.uiUrl + '/api/frame-edits').then((r) => r.json()))[0];
      if (completed.state === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(completed.state, 'succeeded');
    assert.equal(editor.busy(), false);
    assert.equal(completed.clip.sha256, createHash('sha256').update(output).digest('hex'));
    const recipe = await fetch(context.uiUrl + `/api/frame-edits/${edit.id}/recipe`).then((r) =>
      r.json(),
    );
    assert.deepEqual(recipe.workflow, executed);
    assert.deepEqual(recipe.output, completed.clip);
    const stored = JSON.parse(await readFile(path.join(data, 'clips', `${edit.id}.json`), 'utf8'));
    assert.equal(stored.kind, 'image');
    assert.equal(stored.width, source.width);
    const finished = await post('/api/frame-edits', input, 'frame-original');
    assert.equal(finished.status, 200);
    assert.equal((await finished.json()).id, edit.id);
    assert.equal(keys.length, 2);
  } finally {
    job.status = 'canceled';
    server.close();
    server.closeAllConnections();
    assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
    assert.ok(path.basename(data).startsWith('aftertake-frame-test-'));
    await rm(data, { recursive: true, force: true });
  }
});
