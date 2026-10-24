import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { filmRequestSchema, filmTimeline } from '../src/film.js';
import { videoRequestSchema } from '../src/video-generation.js';
import { songRequestSchema } from '../src/enhance.js';
import {
  cutToBeats,
  storyboardFilm,
  storyboardPlanSchema,
  storyboardRenders,
  storyboardRequestSchema,
  storyboardShotRequest,
  storyboardSongRequest,
  templatePlan,
  type StoryboardJob,
  type StoryboardRequest,
} from '../src/storyboard.js';
import { handleRequestError } from '../server/http-errors.js';
import { storyboardRouter } from '../server/storyboards.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const request: StoryboardRequest = storyboardRequestSchema.parse({
  idea: 'A barista opens a tiny seaside café at dawn',
  title: 'Dawn Brew',
  look: 'Soft dawn light, warm wood and sea mist, the same barista in a green apron.',
  aspect: 'portrait',
  shots: [
    { prompt: 'Wide view of the café on the shore at dawn.', movement: 'drone-reveal', seconds: 4 },
    { prompt: 'The barista unlocks the door and flips the sign.', movement: 'truck', seconds: 3 },
    { prompt: 'Close-up of espresso pouring into a cup.', movement: 'zoom-in', seconds: 3 },
    {
      prompt: 'The first customer smiles with the cup as the sun rises.',
      movement: 'pull',
      seconds: 4,
    },
  ],
  song: { tags: 'lo-fi hip hop, mellow electric piano, instrumental', bpm: 84 },
  seed: 11,
});
const ids = () => randomUUID();

test('each shot becomes a valid Create video request with the shared look and its own seed', () => {
  const shots = request.shots.map((_, index) =>
    videoRequestSchema.parse(storyboardShotRequest(request, index)),
  );
  assert.equal(shots[0].prompt, `${request.shots[0].prompt} ${request.look}`);
  assert.deepEqual(
    shots.map((shot) => [shot.seconds, shot.cinema?.movement, shot.aspect, shot.quality]),
    request.shots.map((shot) => [shot.seconds, shot.movement, 'portrait', 'final']),
  );
  assert.equal(new Set(shots.map((shot) => shot.seed)).size, shots.length);
  const song = songRequestSchema.parse(storyboardSongRequest(request));
  assert.equal(song.seconds, 18, 'the song outlasts the 14 s of shots');
  assert.equal(storyboardRenders(request), 5);
});

test('cuts land on the song’s beats without running past a shot or under 1.5 s', () => {
  const beats = Array.from({ length: 40 }, (_, index) => index * (60 / 84));
  const overlaps = [0, 0.5, 0.33, 0.5];
  const lengths = cutToBeats(
    request.shots.map((shot) => ({ target: shot.seconds, available: 97 / 24 })),
    overlaps,
    beats,
  );
  let start = 0;
  lengths.forEach((length, index) => {
    assert.ok(length >= 1.5 && length <= 97 / 24 + 1e-9, `shot ${index + 1} is ${length}`);
    assert.equal(Math.round(length * 24), length * 24, 'whole frames');
    const next = overlaps[index + 1];
    if (next !== undefined) {
      const cut = start + length - next / 2;
      const nearest = Math.min(...beats.map((beat) => Math.abs(beat - cut)));
      assert.ok(nearest < 1 / 24 + 1e-9, `cut ${index + 1} at ${cut} is ${nearest} from a beat`);
    }
    start += length - (next ?? 0);
  });
  assert.deepEqual(
    cutToBeats([{ target: 4, available: 3 }], [0], []),
    [3],
    'without beats a shot keeps its length, within its clip',
  );
});

test('the storyboard opens as a valid Film project with titles, transitions and the song', () => {
  const draft = filmRequestSchema.parse(
    storyboardFilm({
      request,
      shots: request.shots.map(() => ({ assetId: randomUUID(), duration: 97 / 24 })),
      song: { assetId: randomUUID(), beats: Array.from({ length: 40 }, (_, i) => i * (60 / 84)) },
      ids,
    }),
  );
  const duration = filmTimeline(draft.shots).at(-1)!.end;
  assert.equal(draft.aspect, 'portrait');
  assert.deepEqual(
    draft.shots.map((shot) => shot.transition),
    [undefined, 'whip', 'dissolve', 'zoom'],
  );
  assert.deepEqual(
    draft.titles!.map((title) => title.text),
    ['Dawn Brew', 'Dawn Brew'],
  );
  assert.ok(draft.titles!.every((title) => title.end <= duration + 1e-9));
  assert.ok(Math.abs(draft.audio![0].sourceEnd - duration) < 1e-9);
});

test('without the local model, a template plans an opening, a middle and an ending', () => {
  for (const shots of [3, 4, 5]) {
    const plan = storyboardPlanSchema.parse(
      templatePlan({ idea: 'A fox explores a snowy forest at night.', shots, variation: 0 }),
    );
    assert.equal(plan.shots.length, shots);
    assert.equal(plan.planner, 'template');
    assert.equal(plan.shots[0].movement, 'drone-reveal');
    assert.equal(plan.shots.at(-1)!.movement, 'pull');
    assert.ok(
      plan.shots.every((shot) => shot.prompt.includes('A fox explores a snowy forest at night.')),
    );
  }
});

/** A stand-in for the routes a storyboard drives, recording what it was asked. */
async function fakeStudio(data: string) {
  const app = express(),
    videos: any[] = [],
    songs: any[] = [],
    films: any[] = [],
    assets: any[] = [];
  app.post('/api/videos', express.json(), async (req, res) => {
    const id = randomUUID(),
      clip = {
        id,
        name: req.body.name,
        url: `/media/${id}.mp4`,
        duration: 97 / 24,
        width: 576,
        height: 1024,
        sha256: '0'.repeat(64),
      };
    await writeFile(path.join(data, 'clips', `${id}.mp4`), `video ${videos.length}`);
    videos.push({
      id,
      key: req.get('Idempotency-Key'),
      request: req.body,
      state: 'succeeded',
      clip,
    });
    res.status(201).json(videos.at(-1));
  });
  app.get('/api/videos', (_req, res) => res.json(videos));
  app.post('/api/enhancements', express.json(), (req, res) => {
    songs.push({
      id: randomUUID(),
      key: req.get('Idempotency-Key'),
      request: req.body,
      state: 'succeeded',
    });
    res.status(201).json(songs.at(-1));
  });
  app.get('/api/enhancements', (_req, res) => res.json(songs));
  app.get('/api/enhancements/:id/audio', (_req, res) => res.send(Buffer.from('flac bytes')));
  app.get('/api/films/assets', (_req, res) => res.json(assets));
  app.post('/api/films/assets', express.raw({ type: '*/*' }), (req, res) => {
    assets.push({
      id: randomUUID(),
      name: req.query.name,
      kind: /\.flac$/.test(String(req.query.name)) ? 'audio' : 'video',
      sha256: createHash('sha256').update(req.body).digest('hex'),
    });
    res.status(201).json(assets.at(-1));
  });
  app.post('/api/films/assets/:id/beats', (_req, res) =>
    res.json({ beats: Array.from({ length: 40 }, (_, i) => i * 0.5) }),
  );
  app.post('/api/films', express.json(), (req, res) => {
    films.push({
      id: randomUUID(),
      key: req.get('Idempotency-Key'),
      draft: filmRequestSchema.parse(req.body),
      state: 'ready',
    });
    res.status(202).json({ ...films.at(-1), state: 'assembling' });
  });
  app.get('/api/films', (_req, res) => res.json(films));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    videos,
    songs,
    films,
    close: () => server.close(),
  };
}

test('a storyboard renders each shot and its song, then opens as a beat-cut Film project', async (t) => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'aftertake-storyboard-'));
  await mkdir(path.join(data, 'clips'), { recursive: true });
  const studio = await fakeStudio(data);
  let planned = 0;
  const boards = await storyboardRouter({
    root,
    data,
    studio: studio.base,
    planner: async () => {
      planned++;
      return { title: 'Dawn Brew', look: request.look, shots: request.shots };
    },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/storyboards', boards.router);
  app.use(handleRequestError);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    studio.close();
    await rm(data, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/storyboards`;
  const post = async (route: string, body: unknown, key?: string) => {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };

  const plan = await post('/plan', { idea: request.idea, shots: 4 });
  assert.equal(plan.value.planner, 'local-model');
  assert.equal((await post('/plan', { idea: request.idea, shots: 4 })).value.title, 'Dawn Brew');
  assert.equal(planned, 1, 'the same plan is reused, not planned again');

  const started = await post('', request, 'board-1');
  assert.equal(started.status, 202);
  assert.equal((await post('', request, 'board-1')).value.id, started.value.id, 'the key rejoins');
  let job: StoryboardJob;
  for (;;) {
    job = await (await fetch(`${base}/${started.value.id}`)).json();
    if (!['queued', 'running'].includes(job.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(job.state, 'ready', job.error || 'ready');
  assert.deepEqual(
    studio.videos.map((video) => [video.key, video.request.cinema.movement]),
    request.shots.map((shot, index) => [`storyboard-${job.id}-shot-${index}`, shot.movement]),
  );
  assert.equal(studio.songs.length, 1);
  assert.equal(studio.songs[0].request.format, 'aftertake-song/1');
  const [film] = studio.films;
  assert.equal(film.key, `storyboard-${job.id}-film`);
  assert.equal(film.draft.shots.length, 4);
  assert.equal(film.draft.audio.length, 1);
  assert.deepEqual(job.draft, film.draft, 'Open in Film gets the exact exported project');
  assert.equal(job.filmId, film.id);
});

test('a storyboard with too few or too many shots is refused before rendering', () => {
  assert.equal(
    storyboardRequestSchema.safeParse({ ...request, shots: request.shots.slice(0, 2) }).success,
    false,
  );
  assert.equal(
    storyboardRequestSchema.safeParse({ ...request, shots: [...request.shots, ...request.shots] })
      .success,
    false,
  );
  assert.equal(
    storyboardRequestSchema.safeParse({
      ...request,
      shots: [{ ...request.shots[0], seconds: 9 }, ...request.shots.slice(1)],
    }).success,
    false,
  );
});
