import { Router } from 'express';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { clipSchema, type Clip } from '../src/domain.js';
import {
  finishingBusy,
  finishingClockSchema,
  finishingIsIdentity,
  finishingRecipeSchema,
  finishingRequestSchema,
  type FinishingJob,
  type FinishingRequest,
} from '../src/finishing.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { contentDigest } from './edit-plan.js';
import { RequestError } from './http-errors.js';

const processor = 'aftertake-cpu-finishing/1' as const;
const receiptSchema = z
  .object({
    processor: z.literal(processor),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    kind: z.enum(['image', 'video']),
    duration: z.number().positive(),
    hasAudio: z.boolean(),
    identity: z.boolean(),
    clock: finishingClockSchema.optional(),
  })
  .strict();
const storedJobSchema = z
  .object({
    id: z.string().uuid(),
    request: finishingRequestSchema,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum([
      'queued',
      'running',
      'canceling',
      'succeeded',
      'failed',
      'canceled',
      'interrupted',
    ]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    requestKey: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
    requestDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    clip: clipSchema.optional(),
    outputSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    clock: finishingClockSchema.optional(),
    identity: z.boolean().optional(),
    error: z.string().optional(),
  })
  .strict()
  .refine((job) => job.sourceSha256 === job.request.clip.sha256)
  .refine(
    (job) =>
      job.state !== 'succeeded' ||
      (job.clip?.id === job.id &&
        job.outputSha256 === job.clip.sha256 &&
        job.clip.originalSha256 === job.sourceSha256),
  );

/** Injectable only for CPU worker tests. The real runner resolves after process close. */
export type FinishingWorker = (
  args: string[],
  options: { signal?: AbortSignal; timeout: number },
) => Promise<void>;

export function finishingWorker(python: string): FinishingWorker {
  return (args, { signal, timeout }) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Finishing was canceled.'));
        return;
      }
      const child = spawn(python, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      let failed = false,
        outputBytes = 0,
        stopped = false;
      let termination: Promise<void> = Promise.resolve();
      function stop() {
        if (stopped) return;
        stopped = true;
        if (child.pid && process.platform === 'win32') {
          // The worker may have a short-lived FFmpeg child. Stop the whole tree.
          termination = new Promise<void>((done) => {
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
            killer.on('error', () => {
              child.kill();
              done();
            });
            killer.on('close', (code) => {
              if (code) child.kill();
              done();
            });
          });
        } else if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }
      const timer = setTimeout(() => {
        failed = true;
        stop();
      }, timeout);
      const onAbort = () => {
        failed = true;
        stop();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (bytes: Buffer) => {
          outputBytes += bytes.length;
          if (outputBytes > 64 * 1024) {
            failed = true;
            stop();
          }
        });
      child.on('error', () => {
        failed = true;
      });
      child.on('close', async (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        await termination;
        if (!failed && code === 0) resolve();
        else reject(new Error('The CPU finishing worker did not complete.'));
      });
    });
}

async function hashFile(file: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

export async function finishingRouter(context: {
  root: string;
  data: string;
  python: string;
  resolveClipAsset?: (clip: Clip) => Promise<Clip>;
  worker?: FinishingWorker;
}) {
  const router = Router(),
    folder = path.join(context.data, 'finishing'),
    clips = path.join(context.data, 'clips'),
    worker = context.worker || finishingWorker(context.python),
    script = path.join(context.root, 'scripts', 'finish-media.py');
  await mkdir(folder, { recursive: true });
  await mkdir(clips, { recursive: true });
  const jobs = new Map<string, FinishingJob>(),
    controllers = new Map<string, AbortController>();
  let operation: string | undefined,
    tail: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  async function atomicJson(target: string, value: unknown) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2));
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function persist(job: FinishingJob) {
    job.updatedAt = new Date().toISOString();
    await atomicJson(path.join(folder, `${job.id}.json`), job);
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const raw = JSON.parse(await readFile(path.join(folder, name), 'utf8'));
      const job: FinishingJob = storedJobSchema.parse(raw);
      if (name !== `${job.id}.json`) continue;
      // Adding disabled optical controls normalizes an older settings object.
      // Only migrate a stable key after verifying its original accepted content.
      const identity = (request: FinishingRequest) => ({
        name: request.name,
        sourceSha256: request.clip.sha256,
        settings: request.settings,
        format: request.format,
      });
      const verifiedIdentity = Boolean(
        job.requestKey &&
        job.requestDigest &&
        job.requestDigest === contentDigest(identity(raw.request)),
      );
      let changed = false;
      if (verifiedIdentity) {
        const normalizedDigest = contentDigest(identity(job.request));
        if (normalizedDigest !== job.requestDigest) {
          job.requestDigest = normalizedDigest;
          changed = true;
        }
      }
      if (finishingBusy(job)) {
        job.state = 'interrupted';
        job.error = 'Finishing stopped when the server restarted. Start a new finish to retry.';
        // Admission can be interrupted between the media/Clip renames and the
        // durable success receipt. Do not expose such a partial result as a Clip.
        for (const asset of await readdir(clips)) {
          if (
            asset.startsWith(`${job.id}.`) &&
            /^[a-z0-9]{1,8}$/.test(asset.slice(job.id.length + 1))
          )
            await unlink(path.join(clips, asset));
        }
        delete job.clip;
        delete job.outputSha256;
        delete job.clock;
        delete job.identity;
        changed = true;
      }
      if (changed) {
        job.updatedAt = new Date().toISOString();
        try {
          await atomicJson(path.join(folder, `${job.id}.json`), {
            ...job,
            // Unknown identities remain bound to their original request/digest.
            request: verifiedIdentity ? job.request : raw.request,
          });
        } catch {
          // Keep the accepted key in memory even if the disk is unavailable;
          // dropping it would allow an accidental second admission.
          console.warn('Could not persist a restored finishing record.');
        }
      }
      jobs.set(job.id, job);
    } catch {
      console.warn('Skipped an invalid finishing record.');
    }
  }
  async function resolve(request: FinishingRequest) {
    async function storedClip(requested: Clip) {
      const stored = clipSchema.parse(
        JSON.parse(await readFile(path.join(clips, `${requested.id}.json`), 'utf8')),
      );
      if (
        stored.id !== requested.id ||
        stored.sha256 !== requested.sha256 ||
        (await hashFile(path.join(clips, path.basename(stored.url)))) !== stored.sha256
      )
        throw new Error('The original source is unavailable.');
      return stored;
    }
    let clip: Clip | undefined;
    try {
      clip = context.resolveClipAsset
        ? await context.resolveClipAsset(request.clip)
        : await storedClip(request.clip);
    } catch {
      /* Portable recipes can bind the same content under a new local ID. */
    }
    if (!clip) {
      for (const name of await readdir(clips)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        try {
          const candidate = clipSchema.parse(
            JSON.parse(await readFile(path.join(clips, name), 'utf8')),
          );
          if (candidate.sha256 === request.clip.sha256) {
            clip = await storedClip(candidate);
            break;
          }
        } catch {
          /* A missing unrelated asset is not a match. */
        }
      }
    }
    if (!clip || clip.sha256 !== request.clip.sha256)
      throw new RequestError(
        'Import the original finishing source. Its content hash must match the saved recipe.',
        409,
      );
    const source = path.join(clips, path.basename(clip.url));
    try {
      if ((await hashFile(source)) !== clip.sha256) throw new Error('Changed source.');
    } catch {
      throw new RequestError(
        'The original finishing source changed or is missing. Import it again.',
        409,
      );
    }
    return { request: finishingRequestSchema.parse({ ...request, clip }), source };
  }
  async function preflight() {
    try {
      await worker([script, '--check'], { timeout: 20_000 });
    } catch {
      throw new RequestError(
        'CPU finishing needs Python, PyAV, Pillow, NumPy and FFmpeg. Run Aftertake setup, then try again.',
        503,
      );
    }
  }
  function recipe(job: FinishingJob) {
    return finishingRecipeSchema.parse({
      format: 'aftertake-finishing-recipe/1',
      processor,
      request: job.request,
      sourceSha256: job.sourceSha256,
      ...(job.outputSha256 ? { outputSha256: job.outputSha256 } : {}),
      ...(job.clock ? { clock: job.clock } : {}),
    });
  }
  function getJob(id: string) {
    const job = jobs.get(id);
    if (!job) throw new RequestError('That finishing job was not found.', 404);
    return job;
  }
  async function render(job: FinishingJob, source: string, controller: AbortController) {
    const suffix = finishingIsIdentity(job.request.settings)
      ? path.extname(source).toLowerCase()
      : job.request.clip.kind === 'image'
        ? '.png'
        : '.mp4';
    const token = randomUUID(),
      output = path.join(folder, `${job.id}.${token}${suffix}`),
      work = path.join(folder, `${job.id}.${token}.work.json`),
      receipt = path.join(folder, `${job.id}.${token}.receipt.json`),
      target = path.join(clips, `${job.id}${suffix}`);
    let admitted = false;
    try {
      if (controller.signal.aborted) throw new Error('Canceled.');
      job.state = 'running';
      await persist(job);
      await atomicJson(work, { mode: 'finish', source, output, receipt, request: job.request });
      await worker([script, work], { signal: controller.signal, timeout: 60 * 60_000 });
      if (controller.signal.aborted) throw new Error('Canceled.');
      const result = receiptSchema.parse(JSON.parse(await readFile(receipt, 'utf8')));
      if (
        result.sourceSha256 !== job.sourceSha256 ||
        (await hashFile(source)) !== job.sourceSha256 ||
        result.outputSha256 !== (await hashFile(output)) ||
        result.width !== job.request.clip.width ||
        result.height !== job.request.clip.height ||
        result.identity !== finishingIsIdentity(job.request.settings) ||
        result.kind !== (job.request.clip.kind || 'video') ||
        (job.request.clip.hasAudio !== undefined &&
          result.hasAudio !== job.request.clip.hasAudio) ||
        Math.abs(result.duration - job.request.clip.duration) > 0.1 ||
        (result.kind === 'video' && !result.clock) ||
        (result.identity && result.outputSha256 !== job.sourceSha256)
      )
        throw new Error('The finishing receipt did not match its original source.');
      const clip: Clip = {
        id: job.id,
        name: job.request.name,
        sha256: result.outputSha256,
        originalSha256: job.sourceSha256,
        width: result.width,
        height: result.height,
        duration: result.duration,
        kind: result.kind,
        hasAudio: result.hasAudio,
        url: `/media/${job.id}${suffix}`,
      };
      // Cancellation can interleave across each await. Success is published only
      // after admission, never from a worker that has already been canceled.
      if (controller.signal.aborted) throw new Error('Canceled.');
      await rename(output, target);
      admitted = true;
      if (controller.signal.aborted) throw new Error('Canceled.');
      await atomicJson(path.join(clips, `${job.id}.json`), clip);
      if (controller.signal.aborted) throw new Error('Canceled.');
      job.clip = clip;
      job.clock = result.clock;
      job.outputSha256 = result.outputSha256;
      job.identity = result.identity;
      job.state = 'succeeded';
      delete job.error;
      await persist(job);
    } catch {
      if (admitted) {
        await unlink(target).catch(() => {});
        await unlink(path.join(clips, `${job.id}.json`)).catch(() => {});
      }
      delete job.clip;
      delete job.clock;
      delete job.outputSha256;
      delete job.identity;
      job.state = controller.signal.aborted ? 'canceled' : 'failed';
      job.error = controller.signal.aborted
        ? 'Finishing was canceled.'
        : 'CPU finishing could not complete. Check that the original clip is supported and run Aftertake setup before retrying.';
      await persist(job).catch(() => {
        console.warn('Could not persist the terminal finishing state.');
      });
    } finally {
      for (const file of [output, work, receipt]) await unlink(file).catch(() => {});
      controllers.delete(job.id);
      if (operation === job.id) operation = undefined;
    }
  }
  router.get('/', (_req, res) =>
    res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  );
  router.get('/runtime', async (_req, res) => {
    await preflight();
    res.json({ ready: true, processor, device: 'cpu' });
  });
  router.post('/import-recipe', async (req, res) => {
    const saved = finishingRecipeSchema.parse(req.body),
      bound = await resolve(saved.request);
    res.json({ request: bound.request });
  });
  router.post('/preview', async (req, res) => {
    const input = z
      .object({ request: finishingRequestSchema, time: z.number().min(0) })
      .strict()
      .parse(req.body);
    const preview = await exclusive(async () => {
      if (operation)
        throw new RequestError('Wait for the current finishing operation to finish.', 409);
      const bound = await resolve(input.request);
      if (
        input.time >= bound.request.clip.duration ||
        (bound.request.clip.kind === 'image' && input.time !== 0)
      )
        throw new RequestError('Choose a preview time inside the source clip.');
      await preflight();
      const token = randomUUID();
      operation = token;
      return { ...bound, token };
    });
    const output = path.join(folder, `${preview.token}.preview.png`),
      work = path.join(folder, `${preview.token}.preview.work.json`),
      receipt = path.join(folder, `${preview.token}.preview.receipt.json`);
    try {
      await atomicJson(work, {
        mode: 'preview',
        source: preview.source,
        output,
        receipt,
        request: preview.request,
        time: input.time,
      });
      await worker([script, work], { timeout: 5 * 60_000 });
      const result = receiptSchema.parse(JSON.parse(await readFile(receipt, 'utf8')));
      const bytes = await readFile(output);
      if (
        result.sourceSha256 !== preview.request.clip.sha256 ||
        (await hashFile(preview.source)) !== preview.request.clip.sha256 ||
        result.outputSha256 !== createHash('sha256').update(bytes).digest('hex') ||
        result.width !== preview.request.clip.width ||
        result.height !== preview.request.clip.height ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('Invalid preview receipt.');
      res.set('Cache-Control', 'no-store').type('png').send(bytes);
    } catch {
      throw new RequestError(
        'The finishing preview could not be rendered. Check the source clip and run Aftertake setup.',
        422,
      );
    } finally {
      for (const file of [output, work, receipt]) await unlink(file).catch(() => {});
      if (operation === preview.token) operation = undefined;
    }
  });
  router.post('/', async (req, res) => {
    const input = finishingRequestSchema.parse(req.body),
      key = req.get('Idempotency-Key');
    const result = await exclusive(async () => {
      // Content identity excludes local IDs/URLs so imported recipes rejoin safely.
      const admission = generationAdmission(
        key,
        {
          name: input.name,
          sourceSha256: input.clip.sha256,
          settings: input.settings,
          format: input.format,
        },
        jobs.values(),
      );
      if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
      if (admission.existing) return { job: admission.existing, existing: true };
      if (operation)
        throw new RequestError('Wait for the current finishing operation to finish.', 409);
      const bound = await resolve(input);
      await preflight();
      const id = randomUUID(),
        now = new Date().toISOString();
      const job: FinishingJob = {
        id,
        request: bound.request,
        sourceSha256: bound.request.clip.sha256,
        state: 'queued',
        createdAt: now,
        updatedAt: now,
        ...admission.identity,
      };
      await persist(job);
      jobs.set(id, job);
      operation = id;
      const controller = new AbortController();
      controllers.set(id, controller);
      void render(job, bound.source, controller);
      return { job, existing: false };
    });
    res.status(result.existing ? 200 : 202).json(result.job);
  });
  router.get('/:id/recipe', (req, res) => {
    const job = getJob(req.params.id);
    res.attachment(`aftertake-finish-${job.id}.json`).json(recipe(job));
  });
  router.post('/:id/cancel', async (req, res) => {
    const job = getJob(req.params.id);
    await exclusive(async () => {
      if (!finishingBusy(job)) return;
      const controller = controllers.get(job.id);
      if (!controller)
        throw new RequestError('This finishing operation cannot be canceled by this server.', 409);
      job.state = 'canceling';
      await persist(job);
      controller.abort();
    });
    res.status(finishingBusy(job) ? 202 : 200).json(job);
  });
  router.get('/:id', (req, res) => res.json(getJob(req.params.id)));
  return { router, busy: () => operation !== undefined };
}
