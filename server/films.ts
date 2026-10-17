import { Router } from 'express';
import { mkdir, readFile, readdir, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { filmGeometry, filmRequestSchema, filmManifestSchema, type Film } from '../src/film.js';
import { renderDimensions, type Render } from '../src/domain.js';

export async function filmRouter(root: string, data: string, python: string, renders: Map<string, Render>) {
  const router = Router(), folder = path.join(data, 'films');
  await mkdir(folder, { recursive: true });
  const films = new Map<string, Film>();
  let admitting = false;
  async function save(film: Film) {
    const target = path.join(folder, `${film.id}.json`), temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(film, null, 2)); await rename(temporary, target);
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const film = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as Film;
    if (film.state === 'assembling') {
      film.state = 'failed'; film.error = 'Assembly was interrupted. Your shot list is saved; export it again.'; await save(film);
    }
    films.set(film.id, film);
  }
  router.get('/', (_req, res) => { res.json([...films.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); });
  router.post('/resolve', async (req, res) => {
    const manifest = filmManifestSchema.parse(req.body), shots = [];
    const candidates = [...renders.values()].filter(take => take.state === 'succeeded' && take.output);
    const hashes = new Map<string, string>();
    for (const shot of manifest.shots) {
      let match: Render | undefined;
      for (const take of [...candidates].sort((a, b) => Number(b.id === shot.renderId) - Number(a.id === shot.renderId))) {
        let hash = hashes.get(take.id);
        if (!hash) {
          const bytes = await readFile(path.join(data, 'outputs', `${take.id}.mp4`)).catch(() => null);
          if (!bytes) continue;
          hash = createHash('sha256').update(bytes).digest('hex');
          hashes.set(take.id, hash);
        }
        if (hash === shot.sha256) { match = take; break; }
      }
      if (!match) throw new Error('This manifest needs its original finished takes in this workspace. Its recipes are included for regeneration.');
      if (shot.end > renderDimensions(match.recipe).duration + .001) throw new Error('A manifest trim ends after its matching take.');
      shots.push({ renderId: match.id, start: shot.start, end: shot.end });
    }
    res.json({ name: manifest.name, aspect: manifest.aspect, shots });
  });
  router.get('/:id/video', (req, res) => {
    const film = films.get(req.params.id);
    if (film?.state !== 'ready') return void res.sendStatus(404);
    res.sendFile(`${film.id}.mp4`, { root: folder });
  });
  router.get('/:id/manifest', (req, res) => {
    const film = films.get(req.params.id);
    if (!film) return void res.sendStatus(404);
    res.attachment('aftertake-film.json').json({ format: 'aftertake-film/1', ...film });
  });
  router.post('/', async (req, res) => {
    if (admitting || [...films.values()].some(film => film.state === 'assembling')) return void res.status(409).json({ error: 'A film is already being assembled.' });
    admitting = true;
    try {
      const draft = filmRequestSchema.parse(req.body);
      if (!(await stat(python).catch(() => null))) return void res.status(409).json({ error: 'Install the local Python runtime to assemble films.' });
      const shots: Film['shots'] = [], inputs = [];
      for (const shot of draft.shots) {
        const take = renders.get(shot.renderId);
        if (!take?.output || take.state !== 'succeeded') throw new Error('Every film shot must be a finished local take.');
        if (shot.end > renderDimensions(take.recipe).duration + .001) throw new Error('Trim ends after its take.');
        const source = path.join(data, 'outputs', `${take.id}.mp4`);
        const sha256 = createHash('sha256').update(await readFile(source)).digest('hex');
        const start = Math.round(shot.start * 24) / 24, end = Math.min(Math.round(shot.end * 24), Math.floor(renderDimensions(take.recipe).duration * 24)) / 24;
        shots.push({ ...shot, start, end, title: take.recipe.name, sha256, recipe: take.recipe, workflow: take.workflow });
        inputs.push({ source, start, end });
      }
      const film: Film = { id: randomUUID(), name: draft.name, aspect: draft.aspect, shots,
        state: 'assembling', duration: shots.reduce((sum, shot) => sum + shot.end - shot.start, 0), createdAt: new Date().toISOString() };
      films.set(film.id, film); await save(film);
      const workfile = path.join(folder, `${film.id}.work.json`);
      const [width, height] = filmGeometry[film.aspect];
      await writeFile(workfile, JSON.stringify({ output: path.join(folder, `${film.id}.mp4`), width, height, shots: inputs,
        manifest: { format: 'aftertake-film/1', name: film.name, aspect: film.aspect, shots: film.shots } }));
      void promisify(execFile)(python, [path.join(root, 'scripts/assemble-film.py'), workfile], { timeout: 300000, maxBuffer: 1024 * 1024 })
        .then(async () => { film.state = 'ready'; film.output = `/api/films/${film.id}/video`; await save(film); })
        .catch(async error => { console.error('Film assembly failed:', error); film.state = 'failed'; film.error = 'Film assembly failed. Check the runtime and the source takes, then export again.'; await save(film); })
        .finally(() => unlink(workfile).catch(() => {}));
      res.status(202).json(film);
    } finally { admitting = false; }
  });
  return router;
}
