import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import { layerStackRouter } from '../server/layer-stack.js';
import { handleRequestError } from '../server/http-errors.js';
import {
  layerBlendModes,
  layerStackRequestSchema,
  layerStackRecipeSchema,
} from '../src/layer-stack.js';
import { defaultFinishingSettings } from '../src/finishing.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0woAAAAASUVORK5CYII=',
  'base64',
);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t: any) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-layers-')),
    assetFolder = path.join(directory, 'films', 'assets');
  await mkdir(assetFolder, { recursive: true });
  const assetId = randomUUID(),
    source = { assetId, sha256: hash(png) };
  await writeFile(path.join(assetFolder, assetId + '.png'), png);
  const metadata = {
    id: assetId,
    kind: 'image',
    name: 'Original alpha.png',
    extension: '.png',
    sha256: source.sha256,
    width: 1,
    height: 1,
  };
  await writeFile(path.join(assetFolder, assetId + '.json'), JSON.stringify(metadata));
  let renders = 0,
    failCheck = false;
  const worker = async (args: string[]) => {
    if (args[1] === '--check') {
      if (failCheck) throw Error('missing runtime');
      return { stdout: JSON.stringify({ ready: true, processor: 'aftertake-cpu-layer-stack/1' }) };
    }
    if (args[1] === '--inspect')
      return {
        stdout: JSON.stringify({ width: 1, height: 1, sha256: hash(await readFile(args[2])) }),
      };
    const work = JSON.parse(await readFile(args[1], 'utf8'));
    renders++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(work.output, png);
    await writeFile(
      work.receipt,
      JSON.stringify({
        processor: 'aftertake-cpu-layer-stack/1',
        width: 1,
        height: 1,
        sha256: hash(png),
        sources: work.assets.map(({ assetId, sha256 }: any) => ({ assetId, sha256 })),
      }),
    );
    return { stdout: '{}' };
  };
  const context = { root: directory, data: directory, python: 'not-spawned', worker };
  const app = express();
  app.use(express.json());
  app.use('/layers', (await layerStackRouter(context)).router);
  app.use(handleRequestError);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/layers`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(path.dirname(directory), tmpdir());
    await rm(directory, { recursive: true, force: true });
  });
  const request = layerStackRequestSchema.parse({
    format: 'aftertake-layer-stack/1',
    name: 'My still project',
    canvas: { width: 1, height: 1 },
    layers: [{ type: 'image', id: randomUUID(), name: 'Original', source }],
  });
  const call = (route: string, body?: unknown, key?: string) =>
    fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function completed(id: string) {
    for (let i = 0; i < 100; i++) {
      const job = await (await call('/' + id)).json();
      if (['succeeded', 'failed', 'interrupted'].includes(job.state)) return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw Error('Layer fixture did not finish.');
  }
  return {
    directory,
    assetFolder,
    assetId,
    metadata,
    source,
    request,
    context,
    call,
    completed,
    renders: () => renders,
    fail: () => {
      failCheck = true;
    },
  };
}

test('still layer schema bounds media, masks, transform and blend contracts while preserving full finishing settings', () => {
  assert.equal(layerBlendModes.length, 27);
  const source = { assetId: randomUUID(), sha256: 'a'.repeat(64) };
  const image = { type: 'image', id: randomUUID(), name: 'Base', source };
  const base = {
    format: 'aftertake-layer-stack/1',
    name: 'Draft',
    canvas: { width: 640, height: 384 },
    layers: [image],
  };
  const parsed = layerStackRequestSchema.parse(base);
  assert.deepEqual(parsed.layers[0].type === 'image' && parsed.layers[0].transform, {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    flipX: false,
  });
  assert.equal(parsed.layers[0].dissolveSeed, 42);
  for (const bad of [
    { ...base, canvas: { width: 4096, height: 4096 } },
    { ...base, layers: Array(9).fill(image) },
    { ...base, layers: [{ ...image, blend: 'bogus' }] },
    { ...base, layers: [{ ...image, transform: { scale: 0 } }] },
    { ...base, layers: [{ ...image, clipToBelow: true }] },
    { ...base, layers: [image, image] },
  ])
    assert.equal(layerStackRequestSchema.safeParse(bad).success, false);
  const adjusted = layerStackRequestSchema.parse({
    ...base,
    layers: [
      image,
      {
        type: 'adjustment',
        id: randomUUID(),
        name: 'Grade',
        settings: defaultFinishingSettings,
        mask: {
          kind: 'ellipse',
          x: 0.1,
          y: 0.1,
          width: 0.8,
          height: 0.8,
          invert: true,
          feather: 2,
        },
      },
    ],
  });
  assert.deepEqual(
    adjusted.layers[1].type === 'adjustment' && adjusted.layers[1].settings,
    defaultFinishingSettings,
  );
});

test('actual layer routes create a durable content-bound job, authoritative PNG preview and recipe', async (t) => {
  const f = await fixture(t);
  const preview = await f.call('/preview', f.request);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type') || '', /image\/png/);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png);
  assert.deepEqual(await (await f.call('')).json(), []);
  const response = await f.call('', f.request, 'reviewed-key');
  assert.equal(response.status, 202);
  const admitted = await response.json();
  const blocked = await f.call('/preview', f.request);
  assert.equal(blocked.status, 409);
  const job = await f.completed(admitted.id);
  assert.equal(job.state, 'succeeded');
  assert.equal(job.clip.kind, 'image');
  assert.equal(job.clip.sha256, hash(png));
  const count = f.renders();
  const replay = await f.call('', f.request, 'reviewed-key');
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, job.id);
  assert.equal(f.renders(), count);
  assert.equal(
    (await f.call('', { ...f.request, name: 'Different edit' }, 'reviewed-key')).status,
    409,
  );
  const recipe = layerStackRecipeSchema.parse(
    await (await f.call('/' + job.id + '/recipe')).json(),
  );
  assert.deepEqual(recipe.request, f.request);
  assert.equal(recipe.media[0].sha256, f.source.sha256);
  assert.deepEqual(Buffer.from(await (await f.call('/' + job.id + '/media')).arrayBuffer()), png);
  await writeFile(path.join(f.directory, 'clips', job.id + '.png'), 'changed');
  assert.equal((await f.call('/' + job.id + '/media')).status, 409);
});

test('portable recipes bind matching original bytes in a fresh workspace without rendering', async (t) => {
  const original = await fixture(t),
    fresh = await fixture(t);
  const recipe = {
    format: 'aftertake-layer-stack-recipe/1',
    processor: 'aftertake-cpu-layer-stack/1',
    request: original.request,
    media: [{ ...original.source, filename: 'Original alpha.png' }],
  };
  const response = await fresh.call('/resolve', recipe);
  assert.equal(response.status, 200);
  const restored = layerStackRequestSchema.parse(await response.json());
  assert.equal(
    restored.layers[0].type === 'image' && restored.layers[0].source.assetId,
    fresh.assetId,
  );
  assert.equal(restored.layers[0].id, original.request.layers[0].id);
  assert.equal(fresh.renders(), 0);
  assert.deepEqual(await (await fresh.call('')).json(), []);
  const changed = structuredClone(recipe);
  changed.media[0].sha256 = 'f'.repeat(64);
  assert.equal((await fresh.call('/resolve', changed)).status, 400);
  await writeFile(path.join(fresh.assetFolder, fresh.assetId + '.png'), 'changed');
  assert.equal((await fresh.call('/resolve', recipe)).status, 409);
});

test('hashes, metadata bounds, paths, unknown IDs and unavailable runtime reject before job creation', async (t) => {
  const f = await fixture(t);
  const unknown = structuredClone(f.request);
  if (unknown.layers[0].type === 'image') unknown.layers[0].source.assetId = randomUUID();
  assert.equal((await f.call('', unknown)).status, 404);
  const changed = structuredClone(f.request);
  if (changed.layers[0].type === 'image') changed.layers[0].source.sha256 = 'f'.repeat(64);
  assert.equal((await f.call('', changed)).status, 409);
  await writeFile(
    path.join(f.assetFolder, f.assetId + '.json'),
    JSON.stringify({ ...f.metadata, width: 2 }),
  );
  assert.equal((await f.call('', f.request)).status, 409);
  await writeFile(
    path.join(f.assetFolder, f.assetId + '.json'),
    JSON.stringify({ ...f.metadata, extension: '../../outside.png' }),
  );
  assert.equal((await f.call('', f.request)).status, 400);
  await writeFile(path.join(f.assetFolder, f.assetId + '.json'), JSON.stringify(f.metadata));
  f.fail();
  assert.equal((await f.call('', f.request)).status, 503);
  assert.equal(f.renders(), 0);
  assert.deepEqual(await (await f.call('')).json(), []);
});

test('interrupted layer jobs are retained without reexecution on restart', async (t) => {
  const f = await fixture(t),
    id = randomUUID(),
    now = new Date().toISOString();
  const folder = path.join(f.directory, 'layer-stacks');
  await writeFile(
    path.join(folder, id + '.json'),
    JSON.stringify({
      id,
      request: f.request,
      media: [{ ...f.source, filename: 'Original alpha.png' }],
      state: 'running',
      createdAt: now,
      updatedAt: now,
    }),
  );
  const restored = await layerStackRouter(f.context);
  assert.equal(restored.busy(), false);
  const stored = JSON.parse(await readFile(path.join(folder, id + '.json'), 'utf8'));
  assert.equal(stored.state, 'interrupted');
  assert.match(stored.error, /not executed again/);
  assert.equal(f.renders(), 0);
  assert.equal((await readdir(folder)).filter((name) => name.endsWith('.tmp')).length, 0);
});
