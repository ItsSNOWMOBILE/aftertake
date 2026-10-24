import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import {
  judgeClip,
  nextSeed,
  oneTapDuration,
  oneTapFilm,
  oneTapPresetSchema,
  type ClipCheck,
  type OneTapJob,
  type OneTapPreset,
} from '../src/one-tap.js';
import { filmRequestSchema, filmTimeline } from '../src/film.js';
import { handleRequestError } from '../server/http-errors.js';
import { loadPresetLibrary, oneTapRouter, stableIds } from '../server/one-tap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = () => randomUUID();
const library = await loadPresetLibrary(root);
const byId = (id: string) => library.presets.find((preset) => preset.id === id)!;
const good: ClipCheck = {
  duration: 97 / 24,
  frames: 97,
  width: 720,
  height: 1280,
  meanLuma: 110,
  lumaSpread: 52,
  motion: 6,
};

test('every shipped preset and song loads, with a real preview loop and its song file', () => {
  assert.deepEqual(library.problems, []);
  assert.ok(library.presets.length >= 8 && library.presets.length <= 12);
  assert.equal(new Set(library.presets.map((preset) => preset.id)).size, library.presets.length);
  for (const preset of library.presets) {
    for (const extension of ['mp4', 'jpg']) {
      const file = path.join(root, 'public/one-tap', `${preset.id}.${extension}`);
      assert.ok(
        existsSync(file),
        `${preset.id}.${extension} is missing; run scripts/build-one-tap-previews.py`,
      );
      // Every card autoplays at once in the gallery, so each loop stays small.
      assert.ok(statSync(file).size < 400_000, `${preset.id}.${extension} is too large`);
    }
    assert.ok(preset.music, `${preset.id} cuts to a song`);
  }
  for (const track of library.music) {
    const bytes = readFileSync(path.join(root, 'presets/music', track.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), track.sha256, track.id);
    assert.equal(track.recipe.format, 'aftertake-song/1');
  }
  assert.ok(existsSync(path.join(root, 'presets/watermark.png')));
});

test('the preset schema refuses moves, layouts and titles that cannot render', () => {
  const base = structuredClone(byId('punch-in')) as Record<string, any>;
  const refuses = (change: (preset: Record<string, any>) => void, pattern: RegExp) => {
    const preset = structuredClone(base);
    change(preset);
    const result = oneTapPresetSchema.safeParse(preset);
    assert.equal(result.success, false);
    assert.match(result.error!.issues.map((item) => item.message).join(' '), pattern);
  };
  assert.equal(oneTapPresetSchema.safeParse(base).success, true);
  refuses((p) => (p.motion.movement = 'barrel-roll'), /Invalid option/);
  refuses(
    (p) => Object.assign(p.motion, { movement: 'orbit', guidance: 'tracks' }),
    /prompt guidance/,
  );
  refuses((p) => (p.titles[0].end = 9), /must end by 4\.00 s/);
  refuses((p) => (p.cut.still = 1), /hold the photo first/);
  refuses((p) => (p.extra = true), /Unrecognized key/);
  refuses((p) => p.titles.push({ ...p.titles[0], text: 'TWO' }), /at most one title as editable/);
  refuses(
    (p) => Object.assign(p.motion, { quality: 'draft', resolution: '720p' }),
    /Finish quality/,
  );
});

test('effect length follows the Film timeline, including the held photo and its transition', () => {
  assert.equal(oneTapDuration(byId('punch-in')), 4);
  // 1.25 s photo, then a 0.58 s wipe into the 4 s move.
  assert.equal(oneTapDuration(byId('before-after')), (30 + 96 - 14) / 24);
  for (const preset of library.presets) {
    const draft = filmRequestSchema.parse(
      oneTapFilm({
        preset,
        renderId: randomUUID(),
        frameAssetId: randomUUID(),
        musicAssetId: randomUUID(),
        watermark: { assetId: randomUUID(), width: 752, height: 176 },
        ids,
      }),
    );
    assert.equal(draft.aspect, 'portrait');
    assert.ok(Math.abs(filmTimeline(draft.shots).at(-1)!.end - oneTapDuration(preset)) < 1e-9);
    const mark = draft.graphics![0];
    assert.ok(
      mark.x + mark.width / 2 <= 1 && mark.y + mark.height / 2 <= 1,
      'the mark stays on screen',
    );
    const song = draft.audio![0];
    assert.ok(Math.abs(song.sourceEnd - song.sourceStart - oneTapDuration(preset)) < 1e-9);
  }
});

test('the person running an effect can rewrite its editable title and drop the watermark', () => {
  const draft = oneTapFilm({
    preset: byId('punch-in'),
    renderId: randomUUID(),
    title: 'MY TURN',
    ids,
  });
  assert.deepEqual(
    draft.titles!.map((title) => title.text),
    ['MY TURN'],
  );
  assert.equal(draft.graphics, undefined);
  assert.equal(draft.audio, undefined, 'no song asset, no audio track');
  const fixed = oneTapFilm({
    preset: byId('before-after'),
    renderId: randomUUID(),
    frameAssetId: randomUUID(),
    title: 'X',
    ids,
  });
  assert.deepEqual(
    fixed.titles!.map((title) => title.text),
    ['BEFORE', 'AFTER'],
  );
  assert.equal(fixed.shots[1].transition, 'wipe');
});

test('output checks catch blank, frozen and wrong-length clips', () => {
  assert.deepEqual(judgeClip(good, 97 / 24), { ok: true, problems: [], measured: good });
  assert.deepEqual(judgeClip({ ...good, meanLuma: 2 }, 97 / 24).problems, [
    'The picture is blank.',
  ]);
  assert.deepEqual(judgeClip({ ...good, lumaSpread: 1 }, 97 / 24).problems, [
    'The picture is blank.',
  ]);
  assert.deepEqual(judgeClip({ ...good, motion: 0.1 }, 97 / 24).problems, [
    'The picture does not move.',
  ]);
  assert.match(
    judgeClip({ ...good, duration: 2 }, 97 / 24).problems[0],
    /runs 2\.00 s instead of 4\.04 s/,
  );
  assert.equal(judgeClip({ ...good, duration: 4.06 }, 97 / 24).ok, true, 'one frame of slack');
  assert.notEqual(nextSeed(2 ** 32 - 1), 2 ** 32 - 1);
  assert.ok(nextSeed(2 ** 32 - 1) < 2 ** 32);
});

test('stable IDs are valid UUIDs that repeat for the same cut', () => {
  const first = stableIds('job:watermark:1'),
    again = stableIds('job:watermark:1');
  const values = [first(), first(), first()];
  assert.deepEqual(values, [again(), again(), again()]);
  assert.equal(new Set(values).size, 3);
  for (const value of values) assert.equal(z.string().uuid().safeParse(value).success, true);
});

test('a broken preset file is reported by name and the rest still load', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'aftertake-presets-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(path.join(root, 'presets'), path.join(temporary, 'presets'), { recursive: true });
  await writeFile(path.join(temporary, 'presets/one-tap/broken.json'), '{"format":');
  const renamed = { ...byId('noir'), id: 'noir-two' };
  await writeFile(path.join(temporary, 'presets/one-tap/wrong-name.json'), JSON.stringify(renamed));
  const missingSong = {
    ...byId('noir'),
    id: 'no-song',
    music: { ...byId('noir').music!, track: 'silence' },
  };
  await writeFile(
    path.join(temporary, 'presets/one-tap/no-song.json'),
    JSON.stringify(missingSong),
  );
  const loaded = await loadPresetLibrary(temporary);
  assert.equal(loaded.presets.length, library.presets.length);
  assert.deepEqual(
    loaded.problems.map((problem) => problem.file),
    [
      'presets/one-tap/broken.json',
      'presets/one-tap/no-song.json',
      'presets/one-tap/wrong-name.json',
    ],
  );
  assert.match(loaded.problems[1].error, /no song named silence/);
  assert.match(loaded.problems[2].error, /Name the file noir-two\.json/);
});

/** A stand-in studio for the routes a one-tap job drives, recording what it was asked. */
async function fakeStudio() {
  const app = express(),
    renders: { key?: string; recipe: any; id: string }[] = [],
    films: { key?: string; draft: any; id: string }[] = [],
    assets: any[] = [];
  app.post('/api/renders', express.json(), (req, res) => {
    const id = randomUUID();
    renders.push({ key: req.get('Idempotency-Key'), recipe: req.body, id });
    res.status(201).json({ id, state: 'queued', recipe: req.body });
  });
  app.get('/api/renders/:id', (req, res) =>
    res.json({ id: req.params.id, state: 'succeeded', output: `/outputs/${req.params.id}.mp4` }),
  );
  app.get('/api/films/assets', (_req, res) => res.json(assets));
  app.post('/api/films/assets', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
    const asset = {
      id: randomUUID(),
      name: req.query.name,
      kind: /\.png$/.test(String(req.query.name)) ? 'image' : 'audio',
      sha256: createHash('sha256').update(req.body).digest('hex'),
      width: 752,
      height: 176,
    };
    assets.push(asset);
    res.status(201).json(asset);
  });
  app.post('/api/films', express.json(), (req, res) => {
    const id = randomUUID();
    films.push({ key: req.get('Idempotency-Key'), draft: filmRequestSchema.parse(req.body), id });
    res.status(202).json({ id, state: 'assembling' });
  });
  app.get('/api/films', (_req, res) => res.json(films.map(({ id }) => ({ id, state: 'ready' }))));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    renders,
    films,
    close: () => server.close(),
  };
}

async function effectsApp(
  t: test.TestContext,
  measures: (file: string, expected: number) => ClipCheck,
  ready = true,
  saved: (clip: { id: string }) => OneTapJob[] = () => [],
) {
  const studio = await fakeStudio();
  const data = await mkdtemp(path.join(os.tmpdir(), 'aftertake-one-tap-'));
  const clip = {
    id: randomUUID(),
    name: 'portrait.png',
    sha256: '0'.repeat(64),
    width: 720,
    height: 1280,
    duration: 10,
    kind: 'image',
    url: '/media/portrait.png',
  };
  await mkdir(path.join(data, 'clips'), { recursive: true });
  await writeFile(path.join(data, 'clips', `${clip.id}.json`), JSON.stringify(clip));
  await writeFile(path.join(data, 'clips', 'portrait.png'), 'not really a png');
  await mkdir(path.join(data, 'one-tap'), { recursive: true });
  for (const job of saved(clip))
    await writeFile(path.join(data, 'one-tap', `${job.id}.json`), JSON.stringify(job));
  const checked: number[] = [];
  const effects = await oneTapRouter({
    root,
    data,
    python: 'python-is-not-used',
    studio: studio.base,
    engine: async () => ({ connected: true, ready, missing: [], message: '' }),
    measure: async (file, expected) => {
      checked.push(expected);
      return judgeClip(measures(file, expected), expected);
    },
  });
  effects.resume();
  const app = express();
  app.use(express.json());
  app.use('/api/one-tap', effects.router);
  app.use(handleRequestError);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    studio.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(data, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/one-tap`;
  const post = async (route: string, body: unknown) => {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  async function settle(id: string) {
    for (;;) {
      const job = (await (await fetch(`${base}/${id}`)).json()) as OneTapJob;
      if (!['queued', 'running'].includes(job.state)) return job;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return { studio, clip, base, post, settle, checked };
}

test('a blank take renders once more with a new seed, then the effect is cut and checked', async (t) => {
  let call = 0;
  const effects = await effectsApp(t, (_file, expected) =>
    call++ === 0 ? { ...good, meanLuma: 0, lumaSpread: 0 } : { ...good, duration: expected },
  );
  const started = await effects.post('', {
    preset: 'before-after',
    clipId: effects.clip.id,
    seed: 42,
    watermark: true,
  });
  assert.equal(started.status, 202);
  const job = await effects.settle(started.value.id);
  assert.equal(job.state, 'ready', job.error || 'ready');
  assert.deepEqual(
    job.attempts.map((attempt) => attempt.seed),
    [42, nextSeed(42)],
  );
  assert.deepEqual(job.attempts[0].check!.problems, ['The picture is blank.']);
  assert.deepEqual(
    effects.studio.renders.map((render) => [
      render.key,
      render.recipe.seed,
      render.recipe.pipeline,
    ]),
    [
      [`one-tap-${job.id}-0`, 42, 'cinema'],
      [`one-tap-${job.id}-1`, nextSeed(42), 'cinema'],
    ],
  );
  const [render] = effects.studio.renders;
  assert.equal(render.recipe.cinema.movement, byId('before-after').motion.movement);
  assert.equal(render.recipe.resolution, '720p');
  // The take is checked at its rendered length, the finished cut at the effect's.
  assert.deepEqual(effects.checked, [97 / 24, 97 / 24, oneTapDuration(byId('before-after'))]);
  const [film] = effects.studio.films;
  assert.equal(film.draft.shots[1].renderId, effects.studio.renders[1].id);
  assert.equal(film.draft.graphics.length, 1, 'the watermark is on');
  assert.equal(film.draft.audio.length, 1, 'the song is under the cut');

  // Turning the watermark off re-cuts on the CPU: no new render.
  const clean = await effects.post(`/${job.id}/export`, { watermark: false });
  assert.equal(clean.status, 200);
  assert.equal(clean.value.watermark, false);
  assert.equal(effects.studio.renders.length, 2);
  assert.equal(effects.studio.films.length, 2);
  assert.equal(effects.studio.films[1].draft.graphics, undefined);
  // Switching back reuses the first cut.
  await effects.post(`/${job.id}/export`, { watermark: true });
  assert.equal(effects.studio.films.length, 2);
});

test('when both takes fail their checks the effect stops with the reason and no cut', async (t) => {
  const effects = await effectsApp(t, () => ({ ...good, motion: 0 }));
  const started = await effects.post('', {
    preset: 'punch-in',
    clipId: effects.clip.id,
    watermark: true,
  });
  const job = await effects.settle(started.value.id);
  assert.equal(job.state, 'failed');
  assert.match(job.error!, /Both takes failed their checks\. The picture does not move\./);
  assert.equal(effects.studio.renders.length, 2);
  assert.equal(effects.studio.films.length, 0);
  assert.equal((await effects.post(`/${job.id}/export`, { watermark: false })).status, 409);
});

test('effects refuse unknown presets, wrong sources and a missing engine before rendering', async (t) => {
  const effects = await effectsApp(t, () => good, false);
  const unknown = await effects.post('', {
    preset: 'teleport',
    clipId: effects.clip.id,
    watermark: true,
  });
  assert.equal(unknown.status, 404);
  const missing = await effects.post('', { preset: 'noir', clipId: randomUUID(), watermark: true });
  assert.equal(missing.status, 404);
  const offline = await effects.post('', {
    preset: 'noir',
    clipId: effects.clip.id,
    watermark: true,
  });
  assert.equal(offline.status, 409);
  assert.match(offline.value.error, /camera-move models/);
  const extra = await effects.post('', {
    preset: 'noir',
    clipId: effects.clip.id,
    watermark: true,
    prompt: 'x',
  });
  assert.equal(extra.status, 400);
  assert.equal(effects.studio.renders.length, 0);
});

test('Again keeps the source and settings and changes only the seed', async (t) => {
  const effects = await effectsApp(t, (_file, expected) => ({ ...good, duration: expected }));
  const first = await effects.post('', {
    preset: 'punch-in',
    clipId: effects.clip.id,
    seed: 7,
    title: 'HEY',
    watermark: false,
  });
  const done = await effects.settle(first.value.id);
  const again = await effects.post('', { ...done.request, seed: 8 });
  const second = await effects.settle(again.value.id);
  assert.equal(second.state, 'ready');
  assert.deepEqual(
    effects.studio.renders.map((render) => render.recipe.seed),
    [7, 8],
  );
  assert.deepEqual(
    effects.studio.films.map((film) => [film.draft.titles[0].text, film.draft.graphics]),
    [
      ['HEY', undefined],
      ['HEY', undefined],
    ],
  );
  const preset: OneTapPreset = second.preset;
  assert.equal(preset.id, 'punch-in');
});

test('unfinished effects resume after a restart in the order they were started', async (t) => {
  const job = (id: string, seed: number, createdAt: string, clip: { id: string }): OneTapJob => ({
    id,
    request: { preset: 'noir', clipId: clip.id, seed, watermark: true },
    preset: byId('noir'),
    source: { ...(clip as OneTapJob['source']) },
    state: 'running',
    stage: 'Waiting for the GPU',
    progress: null,
    attempts: [],
    exports: {},
    watermark: true,
    createdAt,
    updatedAt: createdAt,
  });
  // File names sort the other way round from the order the effects started.
  const effects = await effectsApp(
    t,
    (_file, expected) => ({ ...good, duration: expected }),
    true,
    (clip) => [
      job('00000000-0000-4000-8000-000000000002', 1, '2026-10-24T10:00:00.000Z', clip),
      job('00000000-0000-4000-8000-000000000001', 2, '2026-10-24T10:05:00.000Z', clip),
    ],
  );
  await effects.settle('00000000-0000-4000-8000-000000000001');
  await effects.settle('00000000-0000-4000-8000-000000000002');
  assert.deepEqual(
    effects.studio.renders.map((render) => render.recipe.seed),
    [1, 2],
  );
});
