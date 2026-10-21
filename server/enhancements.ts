import { cancelAndRefresh } from './job-cancel.js';
import { Router } from 'express';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { promisify, isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type { EngineClient, EngineJob } from './sdk-port.js';
import type { Engine } from '../src/domain.js';
import {
  enhanceOutput,
  enhanceRequestSchema,
  enhancementBusy,
  enhancementTerminal,
  songRequestSchema,
  type EnhanceRequest,
  type Enhancement,
  type SongRequest,
} from '../src/enhance.js';
import {
  buildEnhanceWorkflow,
  enhanceOutputNode,
  type EnhanceFeature,
} from './enhance-workflow.js';
import { resolveClipAsset } from './assets.js';
import { readVideoMetadata } from './video-metadata.js';
import { submissionRejected } from './submission.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { assertJobTarget, jobTargetIssue, type JobTarget } from './job-target.js';
import { RequestError } from './http-errors.js';

const exec = promisify(execFile),
  sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function parseEnhancementRequest(value: unknown): EnhanceRequest | SongRequest {
  const format = (value as { format?: unknown } | null)?.format;
  if (format === 'aftertake-song/1') return songRequestSchema.parse(value);
  if (format === 'aftertake-enhance/1') return enhanceRequestSchema.parse(value);
  throw new RequestError('Send an aftertake-enhance/1 or aftertake-song/1 request.', 400);
}
export function enhancementFeature(request: EnhanceRequest | SongRequest): EnhanceFeature {
  return request.format === 'aftertake-song/1' ? 'song' : request.operation;
}

/**
 * Upscaling, frame interpolation and songs: native Comfy jobs that make a new
 * studio clip or a song without changing their source. They follow the same
 * admission, recovery and job-target rules as the other generators.
 */
export async function enhancementRouter(context: {
  data: string;
  root: string;
  python: string;
  client: EngineClient;
  target: JobTarget;
  uiUrl: string;
  engine: (feature: EnhanceFeature) => Promise<Engine>;
  takeBusy: () => boolean;
  setAdmitting: (value: boolean) => void;
}) {
  const { data, client, target } = context,
    router = Router(),
    folder = path.join(data, 'enhancements'),
    clips = path.join(data, 'clips');
  await Promise.all([folder, clips].map((dir) => mkdir(dir, { recursive: true })));
  const jobs = new Map<string, Enhancement>(),
    active = new Set<string>(),
    handles = new Map<string, EngineJob>();
  async function persist(job: Enhancement) {
    job.updatedAt = new Date().toISOString();
    const dest = path.join(folder, job.id + '.json'),
      temporary = `${dest}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(job, null, 2));
      await rename(temporary, dest);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function targetMatches(job: Enhancement) {
    const issue = jobTargetIssue(job, target);
    if (!issue) return true;
    const state = job.jobId ? 'connection_lost' : 'submission_unknown';
    if (job.state !== state || job.error !== issue) {
      const blocked = { ...job, state, error: issue };
      try {
        await persist(blocked);
        Object.assign(job, blocked);
      } catch {
        console.warn('Could not persist the blocked job target state. No engine request was made.');
      }
    }
    return false;
  }
  async function probe(file: string) {
    const { stdout } = await exec(
      context.python,
      [path.join(context.root, 'scripts/probe-film-asset.py'), file],
      { timeout: 60000, windowsHide: true },
    );
    return JSON.parse(stdout) as {
      kind: string;
      duration: number;
      width?: number;
      height?: number;
    };
  }
  /** Check the downloaded file is this request's result, then publish it. */
  async function finish(job: Enhancement, downloaded: string) {
    const bytes = await readFile(downloaded);
    if (job.request.format === 'aftertake-song/1') {
      const media = await probe(downloaded);
      if (media.kind !== 'audio' || Math.abs(media.duration - job.request.seconds) > 1.5)
        throw Error('The song does not have the requested length.');
      await rename(downloaded, path.join(folder, `${job.id}.flac`));
      job.audio = { sha256: sha(bytes), duration: media.duration, bytes: bytes.length };
      return;
    }
    const metadata = readVideoMetadata(bytes);
    if (
      metadata.recipe?.format !== 'aftertake-enhance-output/1' ||
      !isDeepStrictEqual(metadata.recipe.request, JSON.parse(JSON.stringify(job.request)))
    )
      throw Error('The downloaded video belongs to a different request.');
    const expected = enhanceOutput(job.request),
      media = await probe(downloaded);
    if (media.width !== expected.width || media.height !== expected.height)
      throw Error('The enhanced video does not have the expected size.');
    job.workflow = metadata.workflow;
    await rename(downloaded, path.join(clips, `${job.id}.mp4`));
    job.clip = {
      id: job.id,
      name: job.request.name,
      kind: 'video',
      width: media.width,
      height: media.height,
      duration: media.duration,
      hasAudio: expected.sound,
      sha256: sha(bytes),
      url: `/media/${job.id}.mp4`,
    };
    const meta = path.join(clips, `${job.id}.json`),
      temporary = `${meta}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(job.clip, null, 2));
    await rename(temporary, meta);
  }
  async function track(job: Enhancement, initial?: EngineJob) {
    if (active.has(job.id)) return;
    if (jobTargetIssue(job, target)) {
      await targetMatches(job);
      return;
    }
    active.add(job.id);
    const controller = new AbortController();
    let progress: number | null = null;
    try {
      const engineJob = initial || (await client.jobs.get(job.jobId!));
      handles.set(job.id, engineJob);
      void (async () => {
        for await (const event of engineJob.events(controller.signal))
          if (event.kind === 'progress')
            progress = event.currentNode && event.value < 1 ? event.value : null;
      })().catch(() => {});
      for (;;) {
        await engineJob.refresh();
        const status = engineJob.status;
        job.state = status === 'succeeded' ? 'finalizing' : status;
        job.progress = progress;
        job.stage =
          status === 'succeeded'
            ? 'Downloading the result'
            : job.request.format === 'aftertake-song/1'
              ? 'Composing the song'
              : job.request.operation === 'upscale'
                ? 'Upscaling every frame'
                : 'Making the in-between frames';
        delete job.error;
        if (status === 'succeeded') {
          await persist(job);
          const output = engineJob.getOutputs(enhanceOutputNode(job.request))[0];
          if (!output) throw Error('The workflow finished without its result.');
          const downloaded = path.join(folder, `${job.id}.${randomUUID()}.download`);
          try {
            await output.toFile(downloaded);
            await finish(job, downloaded);
          } finally {
            await unlink(downloaded).catch(() => {});
          }
          job.state = 'succeeded';
          job.progress = 1;
          job.stage =
            job.request.format === 'aftertake-song/1' ? 'Ready to add to Film' : 'Ready to use';
          try {
            await fetch(`${context.uiUrl}/free`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ unload_models: true, free_memory: true }),
              signal: AbortSignal.timeout(3000),
            });
          } catch {
            /* Completion does not depend on releasing an idle cache. */
          }
        } else if (status === 'failed') job.error = JSON.stringify(engineJob.error);
        await persist(job);
        if (enhancementTerminal.has(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const engineJob = handles.get(job.id);
      const failed = {
        ...job,
        state:
          engineJob && enhancementTerminal.has(engineJob.status)
            ? 'output_error'
            : 'connection_lost',
        error: error instanceof Error ? error.message : String(error),
      };
      await persist(failed);
      Object.assign(job, failed);
    } finally {
      controller.abort();
      active.delete(job.id);
      handles.delete(job.id);
    }
  }
  async function submit(job: Enhancement) {
    assertJobTarget(job, target);
    const workflow = client.workflows.fromJson(structuredClone(job.workflow));
    if (job.request.format === 'aftertake-enhance/1') {
      const clip = await resolveClipAsset(job.request.clip, clips, 'source clip');
      workflow.setInput(
        '1',
        'filename',
        client.assets.fromFile(path.join(clips, path.basename(clip.url))),
      );
    }
    const engineJob = await client.submit(workflow, { idempotencyKey: job.id });
    job.jobId = engineJob.id;
    job.state = engineJob.status === 'succeeded' ? 'finalizing' : engineJob.status;
    await persist(job);
    void track(job, engineJob);
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as Enhancement;
      job.request = parseEnhancementRequest(job.request);
      jobs.set(job.id, job);
      if (enhancementBusy(job) && !(await targetMatches(job))) continue;
      if (job.jobId && enhancementBusy(job)) void track(job);
      else if (job.state === 'submitting') {
        job.state = 'submission_unknown';
        await persist(job);
      }
    } catch (error) {
      console.error('Could not read a saved enhancement:', name, error);
    }
  }
  router.get('/', (_req, res) => {
    for (const job of jobs.values())
      if (job.jobId && enhancementBusy(job) && !active.has(job.id)) void track(job);
    res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.post('/', async (req, res) => {
    const request = parseEnhancementRequest(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), request, jobs.values());
    if (admission.conflict) return void res.status(409).json({ error: generationKeyConflict });
    if (admission.existing)
      return void res
        .status(enhancementBusy(admission.existing) ? 202 : 200)
        .json(admission.existing);
    if (context.takeBusy() || [...jobs.values()].some(enhancementBusy))
      return void res.status(409).json({
        error: 'A generation is already active. Finish or cancel it before starting another.',
      });
    context.setAdmitting(true);
    try {
      const feature = enhancementFeature(request);
      if (!(await context.engine(feature)).ready)
        return void res.status(409).json({
          error: `Install the ${feature} model profile and start the local engine: node scripts/aftertake.mjs setup-gpu --${feature}`,
        });
      if (request.format === 'aftertake-enhance/1')
        await resolveClipAsset(request.clip, clips, 'source clip');
      const id = randomUUID(),
        job: Enhancement = {
          jobTarget: target.binding,
          id,
          ...admission.identity,
          request,
          workflow: buildEnhanceWorkflow(id, request),
          state: 'submitting',
          progress: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      await persist(job);
      jobs.set(job.id, job);
      try {
        await submit(job);
        res.status(201).json(job);
      } catch (error) {
        job.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        job.error = error instanceof Error ? error.message : String(error);
        await persist(job);
        res.status(502).json({ error: job.error, enhancement: job });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.get('/:id/audio', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job?.audio) return void res.status(404).json({ error: 'This song is not ready.' });
    res.type('audio/flac').sendFile(`${job.id}.flac`, { root: folder, dotfiles: 'deny' });
  });
  router.get('/:id/recipe', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return void res.sendStatus(404);
    res.attachment('aftertake-enhancement-recipe.json').json({
      format: job.request.format,
      request: job.request,
      workflow: job.workflow,
      output: job.clip || job.audio,
      jobId: job.jobId,
    });
  });
  router.post('/:id/cancel', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job?.jobId || !enhancementBusy(job) || job.state === 'finalizing')
      return void res.status(409).json({ error: 'No active job can be canceled.' });
    assertJobTarget(job, target);
    const engineJob = handles.get(job.id) || (await client.jobs.get(job.jobId));
    await cancelAndRefresh(engineJob);
    if (engineJob.status !== 'succeeded') job.state = engineJob.status;
    await persist(job);
    res.json(job);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || !['submission_unknown', 'connection_lost', 'output_error'].includes(job.state))
      return void res.status(409).json({ error: 'This job does not need recovery.' });
    assertJobTarget(job, target);
    if (job.jobId) {
      void track(job);
      return void res.json(job);
    }
    if (
      context.takeBusy() ||
      [...jobs.values()].some((other) => other.id !== job.id && enhancementBusy(other))
    )
      return void res
        .status(409)
        .json({ error: 'Another generation is active. Rejoin this job after it finishes.' });
    context.setAdmitting(true);
    try {
      try {
        await submit(job);
        res.json(job);
      } catch (error) {
        job.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        job.error = error instanceof Error ? error.message : String(error);
        await persist(job);
        res.status(502).json({ error: job.error, enhancement: job });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  return { router, busy: () => [...jobs.values()].some(enhancementBusy) };
}
