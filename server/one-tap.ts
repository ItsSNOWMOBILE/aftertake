import { Router, type Response } from 'express';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { replaceFile } from './replace-file.js';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Clip, Engine, Render } from '../src/domain.js';
import type { Film, FilmAsset } from '../src/film.js';
import { defaultFinishingSettings, type FinishingJob } from '../src/finishing.js';
import {
  judgeClip,
  nextSeed,
  oneTapBusy,
  oneTapDuration,
  oneTapFilm,
  oneTapMusicSchema,
  oneTapPresetSchema,
  oneTapRequestSchema,
  oneTapTakeSeconds,
  type CheckResult,
  type ClipCheck,
  type OneTapJob,
  type OneTapMusic,
  type OneTapPreset,
} from '../src/one-tap.js';
import { RequestError } from './http-errors.js';
import { jobEta } from '../src/job-eta.js';
import { estimate, estimateKey, type TimedJob } from '../src/render-estimate.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';

const exec = promisify(execFile);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const terminalTake = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
// The studio's single-GPU admission refuses a second job; these mean "wait your turn".
const gpuTaken = /already active|already being submitted|another generation/i;
const filmBusy = /already being assembled/i;
const finishingBusy = /current finishing operation/i;

/** UUIDs that repeat for the same cut, so a resumed export keeps its idempotency key. */
export function stableIds(seed: string) {
  let count = 0;
  return () => {
    const hex = createHash('sha256').update(`${seed}:${count++}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
}

export type PresetLibrary = {
  presets: OneTapPreset[];
  music: OneTapMusic[];
  /** Files that failed validation, so an author sees why a preset is missing. */
  problems: { file: string; error: string }[];
};

async function readJsonFolder(folder: string) {
  const names = await readdir(folder).catch(() => [] as string[]);
  return Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map(async (name) => {
        try {
          return { name, value: JSON.parse(await readFile(path.join(folder, name), 'utf8')) };
        } catch (error) {
          return { name, error: error instanceof Error ? error.message : String(error) };
        }
      }),
  );
}
function issue(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues
      .map((item) => `${item.path.join('.') || 'preset'}: ${item.message}`)
      .join('; ');
  return error instanceof Error ? error.message : String(error);
}

/** Load presets/one-tap and presets/music. A preset is one JSON file; no code changes. */
export async function loadPresetLibrary(root: string): Promise<PresetLibrary> {
  const problems: PresetLibrary['problems'] = [],
    music: OneTapMusic[] = [],
    presets: OneTapPreset[] = [];
  for (const file of await readJsonFolder(path.join(root, 'presets/music'))) {
    try {
      if ('error' in file) throw Error(file.error);
      const track = oneTapMusicSchema.parse(file.value);
      if (`${track.id}.json` !== file.name) throw Error(`Name the file ${track.id}.json.`);
      music.push(track);
    } catch (error) {
      problems.push({ file: `presets/music/${file.name}`, error: issue(error) });
    }
  }
  const tracks = new Map(music.map((track) => [track.id, track]));
  for (const file of await readJsonFolder(path.join(root, 'presets/one-tap'))) {
    try {
      if ('error' in file) throw Error(file.error);
      const preset = oneTapPresetSchema.parse(file.value);
      if (`${preset.id}.json` !== file.name) throw Error(`Name the file ${preset.id}.json.`);
      const track = preset.music && tracks.get(preset.music.track);
      if (preset.music && !track) throw Error(`music.track: no song named ${preset.music.track}.`);
      if (track && preset.music!.start + oneTapDuration(preset) > track.duration)
        throw Error(`music.start: ${track.title} ends before this effect does.`);
      presets.push(preset);
    } catch (error) {
      problems.push({ file: `presets/one-tap/${file.name}`, error: issue(error) });
    }
  }
  presets.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { presets, music, problems };
}

/**
 * One-tap effects. Each job drives the studio's own routes in order: frame the
 * photo as 9:16, render the move with Animate a frame, check it (re-rendering
 * once with a new seed), then cut it in Film with titles, a song and the mark.
 */
export async function oneTapRouter(context: {
  root: string;
  data: string;
  python: string;
  /** The studio's own loopback address; the steps use its public routes. */
  studio: string;
  engine: (pipeline: 'cinema' | 'motion') => Promise<Engine>;
  /** True while any job holds the GPU; its hardware check then reads busy, not broken. */
  gpuBusy?: () => boolean;
  /** Measures a clip for the output checks; tests replace the Python probe. */
  measure?: (file: string, expected: number) => Promise<CheckResult>;
}) {
  const { root, data, python } = context,
    router = Router(),
    folder = path.join(data, 'one-tap');
  await mkdir(folder, { recursive: true });
  const jobs = new Map<string, OneTapJob>(),
    driving = new Set<string>(),
    cancels = new Set<string>(),
    line: string[] = [];
  // For the time left: each running effect's step and when it began, what it waits on, and
  // when its run started. Kept in memory only; after a restart the times are measured again.
  const steps = new Map<string, { step: number; at: number }>(),
    waits = new Map<string, 'line' | 'gpu'>(),
    runs = new Map<string, number>();
  const enter = (job: OneTapJob, step: number) => {
    if (steps.get(job.id)?.step !== step) steps.set(job.id, { step, at: Date.now() });
  };
  let timed: { at: number; history: TimedJob[] } = { at: 0, history: [] };
  /** The usual render time of a take: this workspace's earlier takes, else the RTX 5080 runs. */
  async function renderSeconds({ quality, resolution }: OneTapPreset['motion']) {
    if (Date.now() - timed.at > 60000)
      try {
        const response = await fetch(`${context.studio}/api/renders`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) timed = { at: Date.now(), history: (await response.json()) as TimedJob[] };
      } catch {
        // Keep the last history; the estimate falls back to the reference runs.
      }
    return (
      estimate(estimateKey({ recipe: { pipeline: 'cinema', quality, resolution } }), timed.history)
        ?.seconds ?? 100
    );
  }
  /** A job as sent: while it runs, it carries its steps and the time left. */
  async function view(job: OneTapJob): Promise<OneTapJob> {
    if (!oneTapBusy(job)) return job;
    const render = await renderSeconds(job.preset.motion);
    // It may have finished while the history was read.
    if (!oneTapBusy(job)) return job;
    const now = Date.now(),
      at = steps.get(job.id) ?? { step: 0, at: now },
      waiting = waits.get(job.id);
    const plan = [
      { label: 'Frame your photo', seconds: job.frame ? 0 : 4 },
      {
        label: job.attempts.length > 1 ? 'Render again with a new seed' : 'Move the camera',
        seconds: render,
      },
      { label: 'Check the take', seconds: 3 },
      {
        label: 'Cut with titles and music',
        seconds: 10 + (job.preset.cut.stillFinish && !job.still ? 8 : 0),
      },
    ];
    let wait: number | null = 0;
    if (waiting) {
      // The take rendering now finishes first, then one take for each effect ahead.
      const rendering = [...jobs.values()].filter(
        (other) =>
          other.id !== job.id &&
          oneTapBusy(other) &&
          steps.get(other.id)?.step === 1 &&
          !waits.has(other.id),
      );
      wait =
        waiting === 'gpu' && !rendering.length
          ? null
          : rendering.reduce(
              (sum, other) => sum + Math.max(render - (now - steps.get(other.id)!.at) / 1000, 3),
              0,
            ) +
            Math.max(line.indexOf(job.id), 0) * render;
    }
    return {
      ...job,
      eta: jobEta(plan, at.step, {
        inStep: waiting ? 0 : (now - at.at) / 1000,
        total: (now - (runs.get(job.id) ?? Date.parse(job.createdAt))) / 1000,
        wait,
      }),
    };
  }

  async function persist(job: OneTapJob) {
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
    init: { method?: string; body?: unknown; bytes?: Buffer; key?: string } = {},
  ): Promise<{ status: number; value: T }> {
    // The studio answers its own loopback calls; while it restarts or is briefly busy,
    // a refused connection is retried rather than failing the effect.
    for (let attempt = 0; ; attempt++) {
      let response: globalThis.Response;
      try {
        response = await fetch(context.studio + route, {
          method: init.method || (init.body !== undefined || init.bytes ? 'POST' : 'GET'),
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
          signal: AbortSignal.timeout(120000),
        });
      } catch (error) {
        if (attempt >= 20) throw error;
        await pause(3000);
        continue;
      }
      return { status: response.status, value: (await response.json()) as T };
    }
  }
  const failure = (value: unknown, fallback: string) =>
    (value as { error?: string })?.error || fallback;
  function canceled(job: OneTapJob) {
    if (!cancels.has(job.id)) return false;
    job.state = 'canceled';
    job.stage = 'Canceled';
    job.progress = null;
    return true;
  }
  async function stage(job: OneTapJob, text: string, progress: number | null = null) {
    job.stage = text;
    job.progress = progress;
    await persist(job);
  }
  async function measure(file: string, expected: number): Promise<CheckResult> {
    if (context.measure) return context.measure(file, expected);
    const { stdout } = await exec(python, [path.join(root, 'scripts/check-clip.py'), file], {
      timeout: 120000,
      windowsHide: true,
    });
    return judgeClip(JSON.parse(stdout) as ClipCheck, expected);
  }

  /** Crop the source to a 9:16 still and import it as a clip Animate a frame can use. */
  async function frame(job: OneTapJob) {
    if (job.frame) return job.frame;
    const source = job.source,
      ratio = source.width / source.height;
    if (source.kind === 'image' && Math.abs(Math.log(ratio / (9 / 16))) < 0.01) return source;
    enter(job, 0);
    await stage(job, 'Framing your photo');
    const output = path.join(folder, `${job.id}.frame.png`);
    try {
      await exec(
        python,
        [
          path.join(root, 'scripts/one-tap-frame.py'),
          path.join(data, 'clips', path.basename(source.url)),
          String(source.kind === 'image' ? 0 : (job.request.time ?? 0)),
          output,
          String(job.preset.focusY ?? 0.4),
        ],
        { timeout: 60000, windowsHide: true },
      );
      const name = `${job.preset.title} · ${source.name}`.slice(0, 180) + ' 9x16.png';
      const imported = await call<Clip>(`/api/clips?name=${encodeURIComponent(name)}`, {
        bytes: await readFile(output),
      });
      if (imported.status !== 201)
        throw Error(failure(imported.value, 'Could not frame the photo.'));
      return imported.value;
    } finally {
      await unlink(output).catch(() => {});
    }
  }

  /** Take a place in the GPU line; the line keeps the order effects started in. */
  function join(job: OneTapJob) {
    if (line.includes(job.id)) return;
    line.push(job.id);
    line.sort((a, b) => jobs.get(a)!.createdAt.localeCompare(jobs.get(b)!.createdAt));
  }
  const leave = (job: OneTapJob) => {
    if (line.includes(job.id)) line.splice(line.indexOf(job.id), 1);
  };
  /** Wait for this job's turn, then render one take; resolves with the finished take. */
  async function render(job: OneTapJob, attempt: number) {
    const entry = job.attempts[attempt],
      motion = job.preset.motion;
    const recipe = {
      format: 'aftertake/1',
      name: `${job.preset.title} · seed ${entry.seed}`,
      clip: job.frame!,
      prompt: motion.prompt,
      cue: { start: 0, end: 1, fade: 0.25, feather: 0.06, strokes: [] },
      seed: entry.seed,
      quality: motion.quality,
      ...(motion.resolution ? { resolution: motion.resolution } : {}),
      trimStart: 0,
      pipeline: 'cinema',
      cinema: {
        movement: motion.movement,
        lens: motion.lens,
        lighting: motion.lighting,
        palette: motion.palette,
        guidance: motion.guidance || 'prompt',
      },
    };
    if (!entry.renderId) {
      join(job);
      try {
        for (;;) {
          if (canceled(job)) return undefined;
          const ahead = line.indexOf(job.id);
          enter(job, 1);
          if (ahead > 0) {
            waits.set(job.id, 'line');
            await stage(job, `Waiting for the GPU · ${ahead} ahead`);
            await pause(3000);
            continue;
          }
          const started = await call<Render>('/api/renders', {
            body: recipe,
            key: `one-tap-${job.id}-${attempt}`,
          });
          if (started.status === 409 && gpuTaken.test(failure(started.value, ''))) {
            waits.set(job.id, 'gpu');
            await stage(job, 'Waiting for the GPU to finish another render');
            await pause(4000);
            continue;
          }
          if (started.status >= 300)
            throw new RequestError(failure(started.value, 'The render could not start.'), 409);
          entry.renderId = started.value.id;
          waits.delete(job.id);
          steps.set(job.id, { step: 1, at: Date.now() });
          await persist(job);
          break;
        }
      } finally {
        leave(job);
        waits.delete(job.id);
      }
    }
    for (;;) {
      const { status, value: take } = await call<Render>(`/api/renders/${entry.renderId}`);
      if (status !== 200) throw Error(failure(take, 'The take record is missing.'));
      if (terminalTake.has(take.state)) return take;
      if (cancels.has(job.id) && take.jobId && take.state !== 'finalizing')
        await call(`/api/renders/${take.id}/cancel`, { body: {} }).catch(() => undefined);
      // A take that was rendering before a restart is timed from when it was admitted.
      if (steps.get(job.id)?.step !== 1)
        steps.set(job.id, { step: 1, at: Date.parse(take.createdAt) || Date.now() });
      job.stage = job.attempts.length > 1 ? 'Rendering again with a new seed' : 'Moving the camera';
      job.progress = take.progress;
      await persist(job);
      await pause(2000);
    }
  }

  async function asset(name: string, bytes: Buffer, kind: FilmAsset['kind']) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const listed = await call<FilmAsset[]>('/api/films/assets');
    const existing = listed.value.find((item) => item.sha256 === sha256 && item.kind === kind);
    if (existing) return existing;
    const imported = await call<FilmAsset>(`/api/films/assets?name=${encodeURIComponent(name)}`, {
      bytes,
    });
    if (imported.status !== 201) throw Error(failure(imported.value, `Could not import ${name}.`));
    return imported.value;
  }

  /** The held photo, through the preset's Color & finish look when it has one (CPU). */
  async function finishedStill(job: OneTapJob) {
    const look = job.preset.cut.stillFinish;
    if (!look) return job.frame!;
    // A recorded or earlier cut already finished this photo; reuse it.
    if (
      job.still &&
      (await stat(path.join(data, 'clips', path.basename(job.still.url))).catch(() => null))
    )
      return job.still;
    enter(job, 3);
    await stage(job, 'Finishing the photo');
    let started: { status: number; value: FinishingJob };
    for (;;) {
      started = await call<FinishingJob>('/api/finishing', {
        body: {
          format: 'aftertake-finishing/1',
          name: `${job.preset.title} · before`,
          clip: job.frame,
          settings: { ...defaultFinishingSettings, ...look },
        },
        key: `one-tap-${job.id}-still`,
      });
      // One finishing job runs at a time; wait for another visitor's to end.
      if (started.status !== 409 || !finishingBusy.test(failure(started.value, ''))) break;
      await pause(2000);
    }
    if (started.status >= 300) throw Error(failure(started.value, 'Could not finish the photo.'));
    let finished = started.value;
    while (['queued', 'running', 'canceling'].includes(finished.state)) {
      await pause(1000);
      finished = (await call<FinishingJob>(`/api/finishing/${finished.id}`)).value;
    }
    if (finished.state !== 'succeeded' || !finished.clip)
      throw Error(finished.error || 'Could not finish the photo.');
    job.still = finished.clip;
    await persist(job);
    return finished.clip;
  }

  /** Cut the checked take in Film; CPU only, so changing the watermark never re-renders. */
  async function cut(job: OneTapJob, watermark: boolean) {
    const variant = watermark ? 'watermark' : 'clean';
    if (job.exports[variant]?.check?.ok) return;
    const take = job.attempts.at(-1)!,
      preset = job.preset;
    enter(job, 3);
    await stage(job, watermark ? 'Cutting with titles and music' : 'Cutting without the watermark');
    const photo = preset.cut.layout === 'motion' ? undefined : await finishedStill(job);
    const still =
      photo &&
      (await asset(
        `${preset.id}-photo.png`,
        await readFile(path.join(data, 'clips', path.basename(photo.url))),
        'image',
      ));
    const track = preset.music
      ? (await loadPresetLibrary(root)).music.find((item) => item.id === preset.music!.track)
      : undefined;
    if (preset.music && !track) throw Error(`The song ${preset.music.track} is missing.`);
    const song = track
      ? await asset(
          track.file,
          await readFile(path.join(root, 'presets/music', track.file)),
          'audio',
        )
      : undefined;
    const mark = watermark
      ? await asset(
          'aftertake-watermark.png',
          await readFile(path.join(root, 'presets/watermark.png')),
          'image',
        )
      : undefined;
    const draft = oneTapFilm({
      preset,
      renderId: take.renderId!,
      frameAssetId: still?.id,
      musicAssetId: song?.id,
      watermark: mark && { assetId: mark.id, width: mark.width!, height: mark.height! },
      title: job.request.title,
      ids: stableIds(`${job.id}:${variant}:${job.attempts.length}`),
    });
    let film: Film | undefined;
    for (;;) {
      if (canceled(job)) return;
      const started = await call<Film>('/api/films', {
        body: draft,
        key: `one-tap-${job.id}-${variant}-${job.attempts.length}`,
      });
      if (started.status === 409 && filmBusy.test(failure(started.value, ''))) {
        await stage(job, 'Waiting for another film export');
        await pause(2000);
        continue;
      }
      if (started.status >= 300) throw Error(failure(started.value, 'The cut could not start.'));
      film = started.value;
      break;
    }
    while (film.state === 'assembling') {
      await pause(1500);
      const listed = await call<Film[]>('/api/films');
      film = listed.value.find((item) => item.id === film!.id) || film;
    }
    if (film.state !== 'ready') throw Error(film.error || 'The cut failed.');
    const check = await measure(path.join(data, 'films', `${film.id}.mp4`), oneTapDuration(preset));
    job.exports[variant] = { filmId: film.id, check };
    if (!check.ok) throw Error(`The finished clip failed its check: ${check.problems.join(' ')}`);
  }

  async function drive(job: OneTapJob) {
    if (driving.has(job.id)) return;
    driving.add(job.id);
    runs.set(job.id, Date.now());
    // Hold a place before the first await, so framing a photo never loses it.
    if (!job.attempts.some((attempt) => attempt.renderId && !attempt.check)) join(job);
    try {
      job.state = 'running';
      job.frame = await frame(job);
      await persist(job);
      // One render, and one automatic re-render with a new seed when a check fails.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!job.attempts[attempt])
          job.attempts.push({ seed: attempt ? nextSeed(job.attempts[0].seed) : job.request.seed! });
        const entry = job.attempts[attempt];
        if (!entry.check) {
          const take = await render(job, attempt);
          if (!take || canceled(job)) return await persist(job);
          if (take.state === 'succeeded' && take.output) {
            enter(job, 2);
            await stage(job, 'Checking the take');
            entry.check = await measure(
              path.join(data, 'outputs', `${take.id}.mp4`),
              oneTapTakeSeconds(job.preset.motion.quality),
            );
          } else
            entry.check = {
              ok: false,
              problems: [take.error ? `The render failed: ${take.error}` : 'The render failed.'],
              measured: {
                duration: 0,
                frames: 0,
                width: 0,
                height: 0,
                meanLuma: 0,
                lumaSpread: 0,
                motion: 0,
              },
            };
          await persist(job);
        }
        if (entry.check.ok) break;
      }
      const last = job.attempts.at(-1)!;
      if (!last.check?.ok) {
        job.state = 'failed';
        job.error = `Both takes failed their checks. ${last.check?.problems.join(' ') || ''} Try Again with a new seed or another photo.`;
        job.stage = 'Failed its checks';
        return await persist(job);
      }
      await cut(job, job.watermark);
      if (canceled(job)) return await persist(job);
      job.state = 'ready';
      job.stage = 'Ready to share';
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
      leave(job);
      driving.delete(job.id);
      steps.delete(job.id);
      waits.delete(job.id);
      runs.delete(job.id);
    }
  }

  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as OneTapJob;
      jobs.set(job.id, job);
    } catch (error) {
      console.error('Could not read a saved one-tap effect:', name, error);
    }
  }

  const send = async (res: Response, job: OneTapJob, status = 200) =>
    void res.status(status).json(await view(job));
  router.get('/presets', async (_req, res) => {
    const library = await loadPresetLibrary(root);
    // The usual time from Make it to a finished clip, for beside the button.
    const seconds = Object.fromEntries(
      await Promise.all(
        library.presets.map(async (preset) => [
          preset.id,
          Math.round((await renderSeconds(preset.motion)) + 17 + (preset.cut.stillFinish ? 8 : 0)),
        ]),
      ),
    );
    res.json({
      presets: library.presets,
      music: library.music.map(({ id, title, duration }) => ({ id, title, duration })),
      problems: library.problems,
      seconds,
    });
  });
  router.get('/', async (_req, res) => {
    const sorted = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(await Promise.all(sorted.map(view)));
  });
  router.get('/:id', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return void res.status(404).json({ error: 'Effect not found.' });
    await send(res, job);
  });
  router.post('/', async (req, res) => {
    const request = oneTapRequestSchema.parse(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), request, jobs.values());
    if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
    if (admission.existing) return void (await send(res, admission.existing, 200));
    const preset = (await loadPresetLibrary(root)).presets.find(
      (item) => item.id === request.preset,
    );
    if (!preset) throw new RequestError('Choose one of the effects in the gallery.', 404);
    const source = await readFile(path.join(data, 'clips', `${request.clipId}.json`), 'utf8')
      .then((text) => JSON.parse(text) as Clip)
      .catch(() => {
        throw new RequestError('Choose a photo or clip in this workspace.', 404);
      });
    const kind = source.kind === 'image' ? 'image' : 'video';
    if (!preset.accepts.includes(kind))
      throw new RequestError(`${preset.title} starts from a ${preset.accepts.join(' or ')}.`);
    if (kind === 'video' && (request.time ?? 0) > source.duration)
      throw new RequestError('Choose a moment inside the clip.');
    // A busy GPU fails the memory preflight; the take route checks again when its turn comes.
    const engine = context.gpuBusy?.()
      ? undefined
      : await context.engine(preset.motion.guidance === 'tracks' ? 'motion' : 'cinema');
    if (engine && !engine.ready)
      throw new RequestError(
        'One-tap effects need the camera-move models on this computer. Check Render setup.',
        409,
      );
    const now = new Date().toISOString();
    const job: OneTapJob = {
      id: randomUUID(),
      ...admission.identity,
      request: { ...request, seed: request.seed ?? Math.floor(Math.random() * 2 ** 32) },
      preset,
      source,
      state: 'queued',
      stage: 'Starting',
      progress: null,
      attempts: [],
      exports: {},
      watermark: request.watermark,
      createdAt: now,
      updatedAt: now,
    };
    await persist(job);
    jobs.set(job.id, job);
    void drive(job);
    await send(res, job, 202);
  });
  /** Show or download the result with or without the watermark; a missing cut is made on the CPU. */
  router.post('/:id/export', async (req, res) => {
    const { watermark } = z.object({ watermark: z.boolean() }).strict().parse(req.body);
    const job = jobs.get(req.params.id);
    if (!job) throw new RequestError('Effect not found.', 404);
    if (job.state !== 'ready') throw new RequestError('Wait for the effect to finish.', 409);
    // A just-finished effect releases its driver a moment after it reads as ready.
    for (let wait = 0; driving.has(job.id) && wait < 50; wait++) await pause(100);
    if (driving.has(job.id)) throw new RequestError('This effect is already being cut.', 409);
    driving.add(job.id);
    try {
      await cut(job, watermark);
      job.watermark = watermark;
      job.stage = 'Ready to share';
      await persist(job);
    } finally {
      driving.delete(job.id);
    }
    await send(res, job);
  });
  router.post('/:id/cancel', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || !oneTapBusy(job)) throw new RequestError('No running effect to cancel.', 409);
    cancels.add(job.id);
    if (!driving.has(job.id)) {
      canceled(job);
      await persist(job);
    }
    await send(res, job);
  });
  router.get('/:id/video', (req, res) => {
    const job = jobs.get(req.params.id),
      variant =
        req.query.watermark === '0'
          ? 'clean'
          : req.query.watermark === '1'
            ? 'watermark'
            : undefined,
      chosen =
        job &&
        (variant
          ? job.exports[variant]
          : job.watermark
            ? job.exports.watermark
            : job.exports.clean);
    if (!job || !chosen) return void res.sendStatus(404);
    if (req.query.download === '1')
      res.attachment(`aftertake-${job.preset.id}-${job.attempts.at(-1)?.seed ?? 0}.mp4`);
    res.sendFile(`${chosen.filmId}.mp4`, { root: path.join(data, 'films') });
  });
  return {
    router,
    busy: () => [...jobs.values()].some(oneTapBusy),
    /** Call once the studio listens: unfinished effects rejoin the line in the order they started. */
    resume() {
      for (const job of [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        if (oneTapBusy(job)) void drive(job);
    },
  };
}
