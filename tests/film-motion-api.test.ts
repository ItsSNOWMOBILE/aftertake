import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { filmRouter } from '../server/films.js';
import { handleRequestError } from '../server/http-errors.js';
import { filmDimensions, filmManifestSchema, filmRequestSchema } from '../src/film.js';
import { motionPreset } from '../src/film-motion.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const hash = createHash('sha256').update(png).digest('hex');

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-motion-api-'));
  const assets = path.join(directory, 'films', 'assets');
  await mkdir(assets, { recursive: true });
  const assetId = randomUUID();
  await writeFile(path.join(assets, assetId + '.png'), png);
  await writeFile(
    path.join(assets, assetId + '.json'),
    JSON.stringify({
      id: assetId,
      kind: 'image',
      extension: '.png',
      name: 'Original logo',
      sha256: hash,
      width: 1,
      height: 1,
      duration: 600,
      url: `/api/films/assets/${assetId}/media`,
      createdAt: new Date().toISOString(),
    }),
  );
  const app = express();
  app.use(express.json());
  app.use('/api/films', await filmRouter(directory, directory, process.execPath, new Map()));
  app.use(handleRequestError);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-motion-api-'));
    await rm(directory, { recursive: true, force: true });
  });
  const post = (route: string, body: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/api/films${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const graphic = {
    id: randomUUID(),
    name: 'Logo card',
    kind: 'image' as const,
    start: 0,
    end: 1,
    x: 0.5,
    y: 0.5,
    width: 0.25,
    height: 0.25,
    color: '#ffffff',
    opacity: 1,
    assetId: randomUUID(),
    sha256: hash,
    motion: motionPreset('pop'),
  };
  const project = {
    format: 'aftertake-film/3',
    name: 'Portable motion',
    aspect: 'landscape',
    resolution: '2160p',
    shots: [{ assetId: randomUUID(), sha256: hash, start: 0, end: 1 }],
    graphics: [graphic],
    titles: [
      {
        id: randomUUID(),
        text: 'Move it.',
        start: 0,
        end: 1,
        style: 'headline',
        position: 'center',
        animation: 'none',
        color: '#ffffff',
        motion: motionPreset('slide-up'),
      },
    ],
  };
  return { directory, assets, assetId, graphic, project, post };
}

test('portable motion rebinds image identity by verified content while retaining every curve and resolution', async (t) => {
  const f = await fixture(t);
  assert.equal(filmManifestSchema.safeParse(f.project).success, true);
  const response = await f.post('/resolve', f.project);
  assert.equal(response.status, 200);
  const draft = filmRequestSchema.parse(await response.json());
  assert.equal(draft.shots[0].assetId, f.assetId);
  assert.equal(draft.graphics?.[0].assetId, f.assetId);
  assert.equal(draft.graphics?.[0].sha256, hash);
  assert.deepEqual(draft.graphics?.[0].motion, f.graphic.motion);
  assert.deepEqual(draft.titles?.[0].motion, f.project.titles[0].motion);
  assert.deepEqual(filmDimensions(draft), [3840, 2160]);
});

test('a missing, altered or substituted graphic source cannot be silently restored or rendered', async (t) => {
  const f = await fixture(t);
  const wrong = structuredClone(f.project);
  wrong.graphics[0].sha256 = 'b'.repeat(64);
  assert.equal((await f.post('/resolve', wrong)).status, 400);
  await writeFile(path.join(f.assets, f.assetId + '.png'), Buffer.from('changed original'));
  assert.equal((await f.post('/resolve', f.project)).status, 400);
  const draft = {
    ...f.project,
    shots: [{ assetId: f.assetId, start: 0, end: 1 }],
    graphics: [{ ...f.graphic, assetId: f.assetId }],
  };
  assert.equal((await f.post('', draft)).status, 400);
});

test('graphic timing and image hash checks reject invalid exports before admitting a Film job', async (t) => {
  const f = await fixture(t);
  const draft = {
    name: 'Bounded graphic',
    aspect: 'landscape',
    shots: [{ assetId: f.assetId, start: 0, end: 1 }],
    graphics: [{ ...f.graphic, assetId: f.assetId, sha256: 'b'.repeat(64) }],
  };
  assert.equal((await f.post('', draft)).status, 400);
  assert.equal(
    (await f.post('', { ...draft, graphics: [{ ...draft.graphics[0], sha256: hash, end: 1.5 }] }))
      .status,
    400,
  );
  // No renderer is invoked for either rejection.
  const entries = await (await import('node:fs/promises')).readdir(path.join(f.directory, 'films'));
  assert.ok(entries.every((name) => !/^[a-f0-9-]{36}\.json$/.test(name)));
});

test('graphics cannot carry executable or filesystem inputs, and portable images require hashes', () => {
  const base = {
    name: 'A graphic',
    aspect: 'landscape',
    shots: [{ assetId: randomUUID(), start: 0, end: 1 }],
  };
  const graphic = {
    id: randomUUID(),
    name: 'Accent',
    kind: 'rect',
    start: 0,
    end: 1,
    x: 0.5,
    y: 0.5,
    width: 0.3,
    height: 0.1,
    color: '#d5e991',
    opacity: 1,
  };
  assert.equal(
    filmRequestSchema.safeParse({ ...base, graphics: [{ ...graphic, source: 'C:/private.png' }] })
      .success,
    false,
  );
  assert.equal(
    filmRequestSchema.safeParse({
      ...base,
      graphics: [{ ...graphic, motion: { expression: 'eval(code)' } }],
    }).success,
    false,
  );
  const image = { ...graphic, kind: 'image', assetId: randomUUID() };
  const manifest = {
    ...base,
    format: 'aftertake-film/2',
    shots: [{ ...base.shots[0], sha256: hash }],
    graphics: [image],
  };
  assert.equal(filmRequestSchema.safeParse({ ...base, graphics: [image] }).success, true);
  assert.equal(filmManifestSchema.safeParse(manifest).success, false);
});

test('export size is explicit and legacy geometry remains unchanged in all orientations', () => {
  assert.deepEqual(filmDimensions({ aspect: 'landscape' }), [1280, 720]);
  assert.deepEqual(filmDimensions({ aspect: 'portrait' }), [720, 1280]);
  assert.deepEqual(filmDimensions({ aspect: 'square' }), [720, 720]);
  assert.deepEqual(filmDimensions({ aspect: 'portrait', resolution: '1080p' }), [1080, 1920]);
  assert.deepEqual(filmDimensions({ aspect: 'square', resolution: '2160p' }), [2160, 2160]);
  assert.equal(
    filmRequestSchema.safeParse({
      name: 'Unsafe',
      aspect: 'landscape',
      resolution: '8k',
      shots: [{ assetId: randomUUID(), start: 0, end: 1 }],
    }).success,
    false,
  );
});

test('API and portable image projects reject colliding graphic IDs before admitting an export', async (t) => {
  const f = await fixture(t);
  const duplicate = { ...f.graphic, name: 'Second logo', x: 0.75, radius: 0.4 };
  const project = { ...f.project, graphics: [f.graphic, duplicate] };
  const draft = {
    ...project,
    shots: [{ assetId: f.assetId, start: 0, end: 1 }],
    graphics: project.graphics.map((graphic) => ({ ...graphic, assetId: f.assetId })),
  };
  assert.equal(filmRequestSchema.safeParse(draft).success, false);
  assert.equal(filmManifestSchema.safeParse(project).success, false);
  assert.equal((await f.post('', draft)).status, 400);
  assert.equal((await f.post('/resolve', project)).status, 400);
  const entries = await (await import('node:fs/promises')).readdir(path.join(f.directory, 'films'));
  assert.ok(entries.every((name) => !/^[a-f0-9-]{36}\.json$/.test(name)));

  // Reusing the same source is legitimate when each authored layer has its own ID.
  const distinct = { ...project, graphics: [f.graphic, { ...duplicate, id: randomUUID() }] };
  const response = await f.post('/resolve', distinct);
  assert.equal(response.status, 200);
  const resolved = filmRequestSchema.parse(await response.json());
  assert.equal(resolved.graphics?.length, 2);
  assert.equal(resolved.graphics?.[0].assetId, resolved.graphics?.[1].assetId);
  assert.equal(resolved.graphics?.[1].radius, 0.4);
});
