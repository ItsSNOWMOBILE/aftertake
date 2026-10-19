import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmRequestSchema, filmManifestSchema, filmTimeline } from '../src/film.js';
import express from 'express';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { filmRouter } from '../server/films.js';
import type { Film } from '../src/film.js';
import type { Render } from '../src/domain.js';

test('film exports require bounded, ordered trims of finished render identities', () => {
  const shot = { renderId: 'ca56f918-ba61-4935-86ca-13814f22d56c', start: 0.5, end: 2 };
  const film = {
    name: 'The next scene',
    aspect: 'landscape',
    shots: [shot, { ...shot, start: 0, end: 1 }],
  };
  assert.equal(filmRequestSchema.parse(film).shots[0].start, 0.5);
  for (const invalid of [
    { ...film, shots: [] },
    { ...film, shots: Array(49).fill(shot) },
    { ...film, shots: [{ ...shot, start: 2 }] },
    { ...film, shots: [{ ...shot, renderId: '../outputs/private' }] },
    { ...film, shots: [{ ...shot, end: 100 }] },
  ])
    assert.equal(filmRequestSchema.safeParse(invalid).success, false);
});

test('dissolves overlap on the shared frame clock and remain safe after trim changes', () => {
  const shots = [
    { start: 0.13, end: 2.13 },
    { start: 0, end: 1, dissolve: 0.25 },
    { start: 0, end: 0.25, dissolve: 1 },
    { start: 0, end: 1 },
  ];
  assert.deepEqual(filmTimeline(shots), [
    { start: 0, end: 2, duration: 2, overlap: 0 },
    { start: 1.75, end: 2.75, duration: 1, overlap: 0.25 },
    { start: 2.625, end: 2.875, duration: 0.25, overlap: 0.125 },
    { start: 2.875, end: 3.875, duration: 1, overlap: 0 },
  ]);
  const film = {
    name: 'Dissolve',
    aspect: 'landscape',
    shots: [{ assetId: 'ca56f918-ba61-4935-86ca-13814f22d56c', start: 0, end: 2, dissolve: 0.25 }],
  };
  assert.equal(filmRequestSchema.parse(film).shots[0].dissolve, 0.25);
  assert.equal(
    filmRequestSchema.safeParse({ ...film, shots: [{ ...film.shots[0], dissolve: 1.1 }] }).success,
    false,
  );
});

test('film projects retain imported footage, timed type and trimmed narration while rejecting ambiguous identities', () => {
  const id = 'ca56f918-ba61-4935-86ca-13814f22d56c';
  const project = {
    format: 'aftertake-film/2',
    name: 'Made in Aftertake',
    aspect: 'landscape',
    sourceVolume: 0.2,
    shots: [{ assetId: id, start: 0, end: 100, sha256: 'a'.repeat(64) }],
    titles: [
      {
        id,
        text: 'Cut. Title. Tell the story.',
        start: 2,
        end: 4,
        style: 'headline',
        position: 'center',
        animation: 'rise',
        color: '#d5e991',
      },
    ],
    audio: [
      {
        assetId: id,
        start: 1,
        sourceStart: 0.5,
        sourceEnd: 10,
        volume: 0.8,
        sha256: 'b'.repeat(64),
      },
    ],
  };
  assert.deepEqual(filmManifestSchema.parse(project), project);
  assert.equal(
    filmRequestSchema.safeParse({ ...project, shots: [{ ...project.shots[0], renderId: id }] })
      .success,
    false,
  );
  assert.equal(
    filmRequestSchema.safeParse({
      ...project,
      shots: [{ ...project.shots[0], assetId: undefined }],
    }).success,
    false,
  );
  assert.equal(
    filmRequestSchema.safeParse({ ...project, titles: [{ ...project.titles[0], end: 1 }] }).success,
    false,
  );
  assert.equal(
    filmRequestSchema.safeParse({ ...project, audio: [{ ...project.audio[0], sourceEnd: 0.4 }] })
      .success,
    false,
  );
});

test('film manifests resolve by output hash and interrupted assembly is retained as failed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-film-test-'));
  const source = JSON.parse(
    await readFile(new URL('../examples/portal/render.json', import.meta.url), 'utf8'),
  ) as Render;
  const film: Film = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'An interrupted film',
    state: 'assembling',
    createdAt: new Date().toISOString(),
    aspect: 'landscape',
    duration: 1,
    shots: [],
  };
  const bytes = Buffer.from('local output identity fixture');
  await mkdir(path.join(directory, 'films'));
  await mkdir(path.join(directory, 'outputs'));
  await writeFile(path.join(directory, 'films', `${film.id}.json`), JSON.stringify(film));
  await writeFile(path.join(directory, 'outputs', `${source.id}.mp4`), bytes);
  source.state = 'succeeded';
  source.output = `/outputs/${source.id}.mp4`;
  const app = express();
  app.use(express.json());
  app.use(
    '/films',
    await filmRouter(directory, directory, process.execPath, new Map([[source.id, source]])),
  );
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error.message });
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/films`;
  try {
    const saved = (await fetch(url).then((r) => r.json())) as Film[];
    assert.equal(saved[0].state, 'failed');
    assert.match(saved[0].error || '', /interrupted/);
    const manifest = {
      format: 'aftertake-film/1',
      name: 'A restored film',
      aspect: 'portrait',
      shots: [
        {
          renderId: '00000000-0000-4000-8000-000000000002',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          start: 0.25,
          end: 1.25,
        },
      ],
    };
    const post = (body: unknown) =>
      fetch(url + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const response = await post(manifest);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).shots, [
      { renderId: source.id, start: 0.25, end: 1.25 },
    ]);
    manifest.shots[0].sha256 = '0'.repeat(64);
    assert.equal((await post(manifest)).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-film-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('imported film projects resolve media and voice tracks by bytes and reject changed source files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-film-assets-'));
  const assetFolder = path.join(directory, 'films', 'assets');
  await mkdir(assetFolder, { recursive: true });
  const id = '00000000-0000-4000-8000-000000000001',
    voiceId = '00000000-0000-4000-8000-000000000002';
  const bytes = Buffer.from('original source fixture'),
    voice = Buffer.from('recorded narration fixture');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  for (const asset of [
    { id, name: 'Capture', kind: 'image', extension: '.png', duration: 30, sha256: hash(bytes) },
    {
      id: voiceId,
      name: 'Narration',
      kind: 'audio',
      extension: '.wav',
      duration: 4,
      sha256: hash(voice),
    },
  ]) {
    await writeFile(
      path.join(assetFolder, `${asset.id}.json`),
      JSON.stringify({
        ...asset,
        url: `/films/assets/${asset.id}/media`,
        createdAt: new Date().toISOString(),
      }),
    );
    await writeFile(
      path.join(assetFolder, asset.id + asset.extension),
      asset.kind === 'audio' ? voice : bytes,
    );
  }
  const app = express();
  app.use(express.json());
  app.use('/films', await filmRouter(directory, directory, process.execPath, new Map()));
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error.message });
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/films`;
  try {
    const project = {
      format: 'aftertake-film/2',
      name: 'Restored locally',
      aspect: 'portrait',
      sourceVolume: 0.2,
      shots: [
        {
          assetId: voiceId,
          start: 0,
          end: 5,
          sha256: hash(bytes),
          dissolve: 0.25,
          framing: { zoom: 1.25, endZoom: 1.8, x: 0.4, y: 0.6 },
        },
      ],
      titles: [
        {
          id,
          text: 'Made here',
          start: 1,
          end: 3,
          style: 'headline',
          position: 'center',
          animation: 'fade',
          fontWeight: 500,
          stroke: false,
          align: 'right',
          color: '#d5e991',
        },
      ],
      audio: [
        {
          assetId: id,
          start: 1,
          sourceStart: 0.5,
          sourceEnd: 3.5,
          volume: 0.8,
          sha256: hash(voice),
        },
      ],
    };
    const post = () =>
      fetch(url + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
    const response = await post();
    assert.equal(response.status, 200);
    const restored = await response.json();
    assert.deepEqual(restored.shots, [
      { assetId: id, start: 0, end: 5, dissolve: 0.25, framing: project.shots[0].framing },
    ]);
    assert.deepEqual(restored.audio, [
      { assetId: voiceId, start: 1, sourceStart: 0.5, sourceEnd: 3.5, volume: 0.8 },
    ]);
    assert.deepEqual(restored.titles, project.titles);
    assert.equal(restored.sourceVolume, 0.2);
    assert.deepEqual(
      Buffer.from(await (await fetch(url + `/assets/${voiceId}/media`)).arrayBuffer()),
      voice,
    );
    await writeFile(path.join(assetFolder, `${id}.png`), 'changed on disk');
    assert.equal((await post()).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-film-assets-'));
    await rm(directory, { recursive: true, force: true });
  }
});
