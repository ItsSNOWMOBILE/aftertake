import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { replaceFile } from './replace-file.js';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Engine } from '../src/domain.js';
import {
  depthModel,
  depthEffectBusy,
  depthEffectTerminal,
  depthEffectRequestSchema,
  type DepthEffectJob,
} from '../src/depth-effects.js';
import type { EngineClient, EngineJob } from './sdk-port.js';
import { resolveClipAsset } from './assets.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { assertJobTarget, jobTargetIssue, type JobTarget } from './job-target.js';
import { RequestError } from './http-errors.js';
import { submissionRejected } from './submission.js';
import { cancelAndRefresh } from './job-cancel.js';
import { buildDepthWorkflow } from './depth-workflow.js';
export { depthRequirements, buildDepthWorkflow } from './depth-workflow.js';

const execute = promisify(execFile);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function depthEffectsRouter(context: {
  root: string;
  data: string;
  python: string;
  client: EngineClient;
  target: JobTarget;
  engine: () => Promise<Engine>;
  takeBusy: () => boolean;
  setAdmitting: (value: boolean) => void;
}) {
  const router = Router(),
    folder = path.join(context.data, 'depth-effects'),
    clips = path.join(context.data, 'clips');
  await Promise.all([folder, clips].map((directory) => mkdir(directory, { recursive: true })));
  const jobs = new Map<string, DepthEffectJob>(),
    active = new Set<string>(),
    handles = new Map<string, EngineJob>();
  async function atomic(filename: string, value: unknown) {
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2));
      await replaceFile(temporary, filename);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function persist(job: DepthEffectJob) {
    job.updatedAt = new Date().toISOString();
    await atomic(path.join(folder, job.id + '.json'), job);
  }
  async function targetMatches(job: DepthEffectJob) {
    const issue = jobTargetIssue(job, context.target);
    if (!issue) return true;
    job.state = job.jobId ? 'connection_lost' : 'submission_unknown';
    job.error = issue;
    await persist(job);
    return false;
  }
  async function finish(job: DepthEffectJob, native: EngineJob) {
    const depthFile = path.join(folder, job.id + '.depth.png'),
      raw = path.join(folder, job.id + '.depth.npz');
    const output = path.join(clips, job.id + '.png'),
      temporary = output + '.tmp.png';
    const work = path.join(folder, job.id + '.work.json');
    const delivered = native.getOutputs('2')[0];
    if (!delivered) throw Error('The native depth stage returned no lossless depth result.');
    await delivered.toFile(depthFile);
    const source = await resolveClipAsset(job.request.clip, clips, 'depth source image');
    await atomic(work, {
      request: job.request,
      model: {
        repository: depthModel.repository,
        revision: depthModel.revision,
        sha256: depthModel.sha256,
        license: depthModel.license,
      },
      source: path.join(clips, path.basename(source.url)),
      depth: depthFile,
      raw,
      output: temporary,
    });
    try {
      const { stdout } = await execute(
        context.python,
        [path.join(context.root, 'scripts/depth-effects.py'), work],
        { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
      const info = JSON.parse(stdout),
        bytes = await readFile(temporary);
      if (
        info.sha256 !== hash(bytes) ||
        info.width !== source.width ||
        info.height !== source.height ||
        info.modelSha256 !== depthModel.sha256 ||
        info.depthSha256 !== hash(await readFile(depthFile)) ||
        !/^[a-f0-9]{64}$/.test(info.rawSha256)
      )
        throw Error('The depth output does not match its source and model receipt.');
      await replaceFile(temporary, output);
      job.depth = {
        sha256: info.depthSha256,
        rawSha256: info.rawSha256,
        width: info.width,
        height: info.height,
        modelSha256: depthModel.sha256,
      };
      job.clip = {
        id: job.id,
        name: job.request.name,
        kind: 'image',
        width: info.width,
        height: info.height,
        duration: 1,
        hasAudio: false,
        sha256: info.sha256,
        url: `/media/${job.id}.png`,
      };
      job.workflow = info.workflow;
      await atomic(path.join(clips, job.id + '.json'), job.clip);
    } finally {
      await unlink(temporary).catch(() => {});
      await unlink(work).catch(() => {});
    }
  }
  async function track(job: DepthEffectJob, initial?: EngineJob) {
    if (active.has(job.id)) return;
    active.add(job.id);
    try {
      if (!(await targetMatches(job))) return;
      const native = initial || (await context.client.jobs.get(job.jobId!));
      handles.set(job.id, native);
      for (;;) {
        await native.refresh();
        job.state = native.status === 'succeeded' ? 'finalizing' : native.status;
        job.progress = null;
        delete job.error;
        job.stage =
          native.status === 'succeeded'
            ? 'Applying depth effects'
            : 'Estimating still-image depth with DA3 Small';
        await persist(job);
        if (native.status === 'succeeded') {
          await finish(job, native);
          job.state = 'succeeded';
          job.progress = 1;
          job.stage = 'Still image ready to edit or animate';
        } else if (native.status === 'failed')
          job.error = native.error?.message || 'The native depth stage failed.';
        await persist(job);
        if (depthEffectTerminal.has(native.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      job.state =
        handles.get(job.id) && depthEffectTerminal.has(handles.get(job.id)!.status)
          ? 'output_error'
          : 'connection_lost';
      if (job.state === 'output_error') {
        console.error('Depth output validation or finishing failed:', error);
        job.error =
          'The native depth result could not be validated or finished. Keep this recipe and check the submitted job before starting another attempt.';
      } else
        job.error = error instanceof Error ? error.message : 'The depth effect could not complete.';
      await persist(job).catch(() =>
        console.warn(
          'Could not persist the interrupted depth job. Keep its original record for recovery.',
        ),
      );
    } finally {
      active.delete(job.id);
      handles.delete(job.id);
    }
  }
  async function submit(job: DepthEffectJob) {
    assertJobTarget(job, context.target);
    const source = await resolveClipAsset(job.request.clip, clips, 'depth source image');
    const workflow = context.client.workflows.fromJson(structuredClone(job.workflow));
    workflow.setInput(
      '1',
      'filename',
      context.client.assets.fromFile(path.join(clips, path.basename(source.url))),
    );
    const native = await context.client.submit(workflow, { idempotencyKey: job.id });
    job.jobId = native.id;
    job.state = native.status === 'succeeded' ? 'finalizing' : native.status;
    await persist(job);
    void track(job, native);
  }
  for (const filename of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(filename)) continue;
    try {
      const job = JSON.parse(await readFile(path.join(folder, filename), 'utf8')) as DepthEffectJob;
      job.request = depthEffectRequestSchema.parse(job.request);
      jobs.set(job.id, job);
      if (!depthEffectBusy(job)) continue;
      if (!(await targetMatches(job))) continue;
      if (job.jobId) void track(job);
      else if (job.state === 'submitting') {
        job.state = 'submission_unknown';
        await persist(job);
      }
    } catch {
      console.warn('Could not read saved depth effect:', filename);
    }
  }
  const list = () => [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const jobFor = (id: string) => {
    const job = jobs.get(id);
    if (!job) throw new RequestError('Depth effect not found.', 404);
    return job;
  };
  router.get('/', (_req, res) => {
    for (const job of jobs.values())
      if (job.jobId && depthEffectBusy(job) && !active.has(job.id)) void track(job);
    res.json(list());
  });
  router.post('/', async (req, res) => {
    const input = depthEffectRequestSchema.parse(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), input, jobs.values());
    if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
    if (admission.existing)
      return void res
        .status(depthEffectBusy(admission.existing) ? 202 : 200)
        .json(admission.existing);
    if (context.takeBusy() || [...jobs.values()].some(depthEffectBusy))
      throw new RequestError(
        'A GPU generation is already active. Wait or cancel it before estimating depth.',
        409,
      );
    context.setAdmitting(true);
    try {
      const engine = await context.engine();
      if (!engine.ready)
        throw new RequestError(
          engine.missing[0] ||
            engine.message ||
            'Install the optional depth profile and start ComfyUI.',
          409,
        );
      const clip = await resolveClipAsset(input.clip, clips, 'depth source image');
      const request = depthEffectRequestSchema.parse({ ...input, clip });
      const now = new Date().toISOString(),
        job: DepthEffectJob = {
          id: randomUUID(),
          request,
          state: 'submitting',
          progress: null,
          createdAt: now,
          updatedAt: now,
          jobTarget: context.target.binding,
          ...admission.identity,
          workflow: buildDepthWorkflow(request),
        };
      await persist(job);
      jobs.set(job.id, job);
      try {
        await submit(job);
        res.status(201).json(job);
      } catch (error) {
        job.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        job.error = (error as Error).message;
        await persist(job);
        res.status(502).json({ error: job.error, depthEffect: job });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.get('/:id', async (req, res) => {
    const job = jobFor(req.params.id);
    if (job.jobId && depthEffectBusy(job) && !active.has(job.id)) void track(job);
    res.json(job);
  });
  router.post('/:id/cancel', async (req, res) => {
    const job = jobFor(req.params.id);
    assertJobTarget(job, context.target);
    if (!job.jobId || !depthEffectBusy(job) || job.state === 'finalizing')
      throw new RequestError('No active depth job can be canceled.', 409);
    const native = handles.get(job.id) || (await context.client.jobs.get(job.jobId));
    await cancelAndRefresh(native);
    if (native.status !== 'succeeded') job.state = native.status;
    await persist(job);
    res.json(job);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const job = jobFor(req.params.id);
    assertJobTarget(job, context.target);
    if (!['submission_unknown', 'connection_lost', 'output_error'].includes(job.state))
      throw new RequestError('This depth job does not need recovery.', 409);
    if (job.jobId) {
      void track(job);
      return void res.json(job);
    }
    if (
      context.takeBusy() ||
      [...jobs.values()].some((other) => other.id !== job.id && depthEffectBusy(other))
    )
      throw new RequestError('Another GPU job is active. Rejoin this job after it finishes.', 409);
    context.setAdmitting(true);
    try {
      try {
        await submit(job);
        res.json(job);
      } catch (error) {
        job.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        job.error = (error as Error).message;
        await persist(job);
        res.status(502).json({ error: job.error, depthEffect: job });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.get('/:id/recipe', (req, res) => {
    const job = jobFor(req.params.id);
    res.json({
      format: 'aftertake-depth-effect-recipe/1',
      request: job.request,
      model: {
        repository: depthModel.repository,
        revision: depthModel.revision,
        sha256: depthModel.sha256,
        license: depthModel.license,
      },
      output: job.clip,
    });
  });
  router.get('/:id/depth', (req, res) => {
    const job = jobFor(req.params.id);
    if (!job.depth) throw new RequestError('Depth is not available yet.', 409);
    res.download(job.id + '.depth.npz', 'aftertake-model-depth.npz', {
      root: folder,
      dotfiles: 'deny',
    });
  });
  router.get('/:id/depth-preview', (req, res) => {
    const job = jobFor(req.params.id);
    if (!job.depth) throw new RequestError('Depth is not available yet.', 409);
    res.sendFile(job.id + '.depth.png', { root: folder, dotfiles: 'deny' });
  });
  return { router, busy: () => [...jobs.values()].some(depthEffectBusy) };
}
