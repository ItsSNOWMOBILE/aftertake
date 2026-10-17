import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmRequestSchema } from '../src/film.js';
import express from 'express';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { filmRouter } from '../server/films.js';
import type { Film } from '../src/film.js';
import type { Render } from '../src/domain.js';

test('film exports require bounded, ordered trims of finished render identities', () => {
  const shot = { renderId: 'ca56f918-ba61-4935-86ca-13814f22d56c', start: .5, end: 2 };
  const film = { name: 'The next scene', aspect: 'landscape', shots: [shot, { ...shot, start: 0, end: 1 }] };
  assert.equal(filmRequestSchema.parse(film).shots[0].start, .5);
  for (const invalid of [{ ...film, shots: [] }, { ...film, shots: Array(9).fill(shot) },
    { ...film, shots: [{ ...shot, start: 2 }] }, { ...film, shots: [{ ...shot, renderId: '../outputs/private' }] },
    { ...film, shots: [{ ...shot, end: 100 }] }]) assert.equal(filmRequestSchema.safeParse(invalid).success, false);
});

test('film manifests resolve by output hash and interrupted assembly is retained as failed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-film-test-'));
  const source = JSON.parse(await readFile(new URL('../examples/portal/render.json', import.meta.url), 'utf8')) as Render;
  const film: Film = { id: '00000000-0000-4000-8000-000000000001', name: 'An interrupted film', state: 'assembling',
    createdAt: new Date().toISOString(), aspect: 'landscape', duration: 1, shots: [] };
  const bytes = Buffer.from('local output identity fixture');
  await mkdir(path.join(directory, 'films')); await mkdir(path.join(directory, 'outputs'));
  await writeFile(path.join(directory, 'films', `${film.id}.json`), JSON.stringify(film));
  await writeFile(path.join(directory, 'outputs', `${source.id}.mp4`), bytes);
  source.state = 'succeeded'; source.output = `/outputs/${source.id}.mp4`;
  const app = express(); app.use(express.json());
  app.use('/films', await filmRouter(directory, directory, process.execPath, new Map([[source.id, source]])));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/films`;
  try {
    const saved = await fetch(url).then(r => r.json()) as Film[];
    assert.equal(saved[0].state, 'failed'); assert.match(saved[0].error || '', /interrupted/);
    const manifest = { format: 'aftertake-film/1', name: 'A restored film', aspect: 'portrait', shots: [
      { renderId: '00000000-0000-4000-8000-000000000002', sha256: createHash('sha256').update(bytes).digest('hex'), start: .25, end: 1.25 }] };
    const post = (body: unknown) => fetch(url + '/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await post(manifest); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).shots, [{ renderId: source.id, start: .25, end: 1.25 }]);
    manifest.shots[0].sha256 = '0'.repeat(64); assert.equal((await post(manifest)).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-film-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
