import { Router } from 'express';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { replaceFile } from './replace-file.js';
import path from 'node:path';
import { promisify } from 'node:util';
import { cameraMovements } from '../src/cinema.js';
import type { Film, FilmAsset } from '../src/film.js';
import type { Enhancement } from '../src/enhance.js';
import type { VideoGeneration } from '../src/video-generation.js';
import {
  storyboardBusy,
  storyboardFilm,
  storyboardPlanRequestSchema,
  storyboardPlanSchema,
  storyboardRequestSchema,
  storyboardShotRequest,
  storyboardSongRequest,
  templatePlan,
  type StoryboardJob,
  type StoryboardPlan,
} from '../src/storyboard.js';
import { contentDigest } from './edit-plan.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { RequestError } from './http-errors.js';

const exec = promisify(execFile);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const finished = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
// The studio runs one generation at a time; these refusals mean "wait your turn".
const gpuTaken = /already active|already being submitted|another generation|is active/i;
const filmBusy = /already being assembled/i;

/** Deterministic IDs for a cut's titles, so a resumed export keeps its idempotency key. */
function stableIds(seed: string) {
  let count = 0;
  return () => {
    const hex = createHash('sha256').update(`${seed}:${count++}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
}

/**
 * Storyboards: plan 3–5 shots from one idea on the CPU, then render each shot with
 * Create video, compose an ACE-Step song, and cut them in Film on the song's beats.
 * Every step uses the studio's own routes on loopback, so recovery and Cloud
 * routing work exactly as they do in each studio.
 */
export async function storyboardRouter(context: {
  root: string;
  data: string;
  /** The studio's own loopback address. */
  studio: string;
  /** Runs the local language model; absent or failing falls back to the template planner. */
  planner?: (request: object) => Promise<unknown>;
}) {
  const { root, data } = context,
    router = Router(),
    folder = path.join(data, 'storyboards'),
    plans = path.join(folder, 'plans');
  await mkdir(plans, { recursive: true });
  const jobs = new Map<string, StoryboardJob>(),
    driving = new Set<string>(),
    cancels = new Set<string>();
  let planning: Promise<unknown> = Promise.resolve();

  const scriptPython = path.join(
    root,
    '.runtime/script-venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const models = process.env.AFTERTAKE_SCRIPT_MODEL || path.join(root, '.runtime/script-model');
  const localPlanner =
    context.planner ||
    (async (request: object) => {
      if (
        !(await stat(scriptPython).catch(() => null)) ||
        !(await stat(path.join(models, 'openvino_model.bin')).catch(() => null))
      )
        throw Error('The optional local script model is not installed.');
      const file = path.join(plans, `${randomUUID()}.request.json`);
      await writeFile(file, JSON.stringify(request));
      try {
        const { stdout } = await exec(
          scriptPython,
          [path.join(root, 'scripts/plan-shots.py'), file, '--models', models],
          { timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true },
        );
        return JSON.parse(stdout);
      } finally {
        await unlink(file).catch(() => {});
      }
    });

  async function persist(job: StoryboardJob) {
    job.updatedAt = new Date().toISOString();
    const target = path.join(folder, `${job.id}.json`),
      temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(job, null, 2));
      await replaceFile(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function call<T>(
    route: string,
    init: { body?: unknown; bytes?: Buffer; key?: string } = {},
  ): Promise<{ status: number; value: T }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(context.studio + route, {
          method: init.body !== undefined || init.bytes ? 'POST' : 'GET',
          headers: {
            ...(init.bytes ? { 'Content-Type': 'application/octet-stream' } : {}),
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(init.key ? { 'Idempotency-Key': init.key } : {}),
          },
          body: init.bytes
            ? new Uint8Array(init.bytes)
            : init.body === undefined
              ? undefined
              : JSON.stringify(init.body),
          signal: AbortSignal.timeout(180000),
        });
        return { status: response.status, value: (await response.json()) as T };
      } catch (error) {
        // The studio answers its own calls; while it restarts, wait instead of failing.
        if (attempt >= 20) throw error;
        await pause(3000);
      }
    }
  }
  const failure = (value: unknown, fallback: string) =>
    (value as { error?: string })?.error || fallback;
  async function stage(job: StoryboardJob, text: string, progress: number | null = null) {
    job.stage = text;
    job.progress = progress;
    await persist(job);
  }
  function canceled(job: StoryboardJob) {
    if (!cancels.has(job.id)) return false;
    job.state = 'canceled';
    job.stage = 'Canceled';
    return true;
  }
  /** Start one generation through a studio route, waiting while the GPU is taken. */
  async function start<T extends { id: string }>(
    job: StoryboardJob,
    route: string,
    body: unknown,
    key: string,
    label: string,
  ) {
    for (;;) {
      if (canceled(job)) return undefined;
      const started = await call<T>(route, { body, key });
      if (started.status === 409 && gpuTaken.test(failure(started.value, ''))) {
        await stage(job, `${label} · waiting for the GPU`);
        await pause(4000);
        continue;
      }
      if (started.status >= 300) throw Error(failure(started.value, `${label} could not start.`));
      return started.value;
    }
  }
  async function asset(name: string, bytes: Buffer, kind: FilmAsset['kind']) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = (await call<FilmAsset[]>('/api/films/assets')).value.find(
      (item) => item.sha256 === sha256 && item.kind === kind,
    );
    if (existing) return existing;
    const imported = await call<FilmAsset>(`/api/films/assets?name=${encodeURIComponent(name)}`, {
      bytes,
    });
    if (imported.status !== 201) throw Error(failure(imported.value, `Could not import ${name}.`));
    return imported.value;
  }

  async function renderShot(job: StoryboardJob, index: number) {
    const entry = job.shots[index],
      label = `Shot ${index + 1} of ${job.request.shots.length}`;
    if (entry.clip) return true;
    if (!entry.videoId) {
      const video = await start<VideoGeneration>(
        job,
        '/api/videos',
        storyboardShotRequest(job.request, index),
        `storyboard-${job.id}-shot-${index}`,
        label,
      );
      if (!video) return false;
      entry.videoId = video.id;
      await persist(job);
    }
    for (;;) {
      const videos = (await call<VideoGeneration[]>('/api/videos')).value;
      const video = videos.find((item) => item.id === entry.videoId);
      if (!video) throw Error(`${label} is missing from Create video.`);
      if (finished.has(video.state)) {
        if (video.state !== 'succeeded' || !video.clip)
          throw Error(`${label} did not finish: ${video.error || video.state}.`);
        entry.clip = video.clip;
        await persist(job);
        return true;
      }
      if (cancels.has(job.id)) {
        await call(`/api/videos/${video.id}/cancel`, { body: {} }).catch(() => undefined);
        canceled(job);
        return false;
      }
      await stage(job, `${label} · ${video.stage || 'rendering on your GPU'}`, video.progress);
      await pause(2500);
    }
  }
  async function renderSong(job: StoryboardJob) {
    job.song ||= {};
    if (job.song.assetId) return true;
    if (!job.song.enhancementId) {
      const song = await start<Enhancement>(
        job,
        '/api/enhancements',
        storyboardSongRequest(job.request),
        `storyboard-${job.id}-song`,
        'Composing the song',
      );
      if (!song) return false;
      job.song.enhancementId = song.id;
      await persist(job);
    }
    for (;;) {
      const song = (await call<Enhancement[]>('/api/enhancements')).value.find(
        (item) => item.id === job.song!.enhancementId,
      );
      if (!song) throw Error('The song is missing from Enhance.');
      if (finished.has(song.state)) {
        if (song.state !== 'succeeded')
          throw Error(`The song did not finish: ${song.error || song.state}.`);
        break;
      }
      await stage(
        job,
        `Composing the song · ${song.stage || 'ACE-Step on your GPU'}`,
        song.progress,
      );
      await pause(2500);
    }
    const audio = await fetch(`${context.studio}/api/enhancements/${job.song.enhancementId}/audio`);
    if (!audio.ok) throw Error('The finished song could not be read.');
    const imported = await asset(
      `${job.request.title} score.flac`,
      Buffer.from(await audio.arrayBuffer()),
      'audio',
    );
    const beats = await call<{ beats: number[] }>(`/api/films/assets/${imported.id}/beats`, {
      body: {},
    });
    job.song.assetId = imported.id;
    job.song.beats = beats.status === 200 ? beats.value.beats : [];
    await persist(job);
    return true;
  }

  async function drive(job: StoryboardJob) {
    if (driving.has(job.id)) return;
    driving.add(job.id);
    try {
      job.state = 'running';
      for (let index = 0; index < job.request.shots.length; index++)
        if (!(await renderShot(job, index))) return await persist(job);
      if (!(await renderSong(job))) return await persist(job);
      await stage(job, 'Cutting the film to the beat');
      for (const [index, shot] of job.shots.entries())
        if (!shot.assetId) {
          const bytes = await readFile(path.join(data, 'clips', path.basename(shot.clip!.url)));
          shot.assetId = (
            await asset(`${job.request.title} shot ${index + 1}.mp4`, bytes, 'video')
          ).id;
        }
      job.draft = storyboardFilm({
        request: job.request,
        shots: job.shots.map((shot) => ({ assetId: shot.assetId!, duration: shot.clip!.duration })),
        song: { assetId: job.song!.assetId!, beats: job.song!.beats || [] },
        ids: stableIds(job.id),
      });
      await persist(job);
      let film: Film | undefined;
      for (;;) {
        if (canceled(job)) return await persist(job);
        const started = await call<Film>('/api/films', {
          body: job.draft,
          key: `storyboard-${job.id}-film`,
        });
        if (started.status === 409 && filmBusy.test(failure(started.value, ''))) {
          await pause(2000);
          continue;
        }
        if (started.status >= 300) throw Error(failure(started.value, 'The cut could not start.'));
        film = started.value;
        break;
      }
      while (film.state === 'assembling') {
        await pause(1500);
        film =
          (await call<Film[]>('/api/films')).value.find((item) => item.id === film!.id) || film;
      }
      if (film.state !== 'ready') throw Error(film.error || 'The cut failed.');
      job.filmId = film.id;
      job.state = 'ready';
      job.stage = 'Ready to open in Film';
      job.progress = 1;
      await persist(job);
    } catch (error) {
      if (!canceled(job)) {
        job.state = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.stage = 'Failed';
      }
      await persist(job).catch(() => {});
    } finally {
      driving.delete(job.id);
    }
  }

  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as StoryboardJob;
      jobs.set(job.id, job);
    } catch (error) {
      console.error('Could not read a saved storyboard:', name, error);
    }
  }

  /** Plan shots with the local model, or the template when it is not installed or fails. */
  router.post('/plan', async (req, res) => {
    const request = storyboardPlanRequestSchema.parse(req.body),
      cache = path.join(plans, `${contentDigest(request)}.json`);
    const saved = await readFile(cache, 'utf8').catch(() => '');
    if (saved) return void res.json(storyboardPlanSchema.parse(JSON.parse(saved)));
    // One plan at a time: the model uses every CPU core for about twenty seconds.
    const turn = planning.then(async () => {
      try {
        const value = (await localPlanner({ ...request, moves: [...cameraMovements] })) as Record<
          string,
          unknown
        >;
        return storyboardPlanSchema.parse({
          title: value.title,
          look: value.look,
          shots: value.shots,
          planner: 'local-model',
          note: 'Planned by Qwen3-4B on this computer’s CPU.',
        });
      } catch (error) {
        return {
          ...templatePlan(request),
          note:
            (error instanceof Error ? error.message : String(error)).slice(0, 200) +
            ' Planned from a template instead.',
        };
      }
    });
    planning = turn.catch(() => {});
    const plan = await turn;
    if (plan.planner === 'local-model') await writeFile(cache, JSON.stringify(plan));
    res.json(plan satisfies StoryboardPlan);
  });
  router.get('/', (_req, res) => {
    res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.get('/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return void res.status(404).json({ error: 'Storyboard not found.' });
    res.json(job);
  });
  router.post('/', async (req, res) => {
    const request = storyboardRequestSchema.parse(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), request, jobs.values());
    if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
    if (admission.existing) return void res.json(admission.existing);
    const now = new Date().toISOString();
    const job: StoryboardJob = {
      id: randomUUID(),
      ...admission.identity,
      request,
      state: 'queued',
      stage: 'Starting',
      progress: null,
      shots: request.shots.map(() => ({})),
      createdAt: now,
      updatedAt: now,
    };
    await persist(job);
    jobs.set(job.id, job);
    void drive(job);
    res.status(202).json(job);
  });
  router.post('/:id/cancel', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || !storyboardBusy(job))
      throw new RequestError('No running storyboard to cancel.', 409);
    cancels.add(job.id);
    if (!driving.has(job.id)) {
      canceled(job);
      await persist(job);
    }
    res.json(job);
  });
  router.get('/:id/video', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job?.filmId) return void res.sendStatus(404);
    if (req.query.download === '1')
      res.attachment(`aftertake-storyboard-${job.id.slice(0, 8)}.mp4`);
    res.sendFile(`${job.filmId}.mp4`, { root: path.join(data, 'films') });
  });
  return {
    router,
    busy: () => [...jobs.values()].some(storyboardBusy),
    /** Call once the studio listens: unfinished storyboards continue in the order they started. */
    resume() {
      for (const job of [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        if (storyboardBusy(job)) void drive(job);
    },
  };
}
