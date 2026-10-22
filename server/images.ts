import { cancelAndRefresh } from './job-cancel.js';
import { Router } from 'express';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { EngineClient, EngineJob } from './sdk-port.js';
import type { Engine } from '../src/domain.js';
import {
  imageBusy,
  imageDimensions,
  imageRequestSchema,
  imageTerminal,
  type ImageGeneration,
} from '../src/image-generation.js';
import { buildImageWorkflow } from './image-workflow.js';
import { inspectFramePng } from './frame-edits.js';
import { submissionRejected } from './submission.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { JobTargetError, type JobTarget } from './job-target.js';
import {
  localSetupError,
  newJobRoute,
  recordRoute,
  type CloudRoutes,
  type EngineRoute,
} from './cloud-runtime.js';

export async function imageRouter(context: {
  data: string;
  client: EngineClient;
  target: JobTarget;
  uiUrl: string;
  engine: () => Promise<Engine>;
  /** Present when Comfy Cloud can take new image jobs and rejoin its own. */
  cloud?: CloudRoutes;
  takeBusy: () => boolean;
  setAdmitting: (value: boolean) => void;
}) {
  const { data, client, target } = context,
    local: EngineRoute = { provider: 'local', client, target },
    routeOf = (image: ImageGeneration) => recordRoute(image, local, context.cloud),
    router = Router(),
    folder = path.join(data, 'images'),
    clips = path.join(data, 'clips');
  await Promise.all([folder, clips].map((folder) => mkdir(folder, { recursive: true })));
  const images = new Map<string, ImageGeneration>(),
    active = new Set<string>(),
    handles = new Map<string, EngineJob>();
  async function persist(image: ImageGeneration) {
    image.updatedAt = new Date().toISOString();
    const target = path.join(folder, image.id + '.json'),
      temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(image, null, 2));
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function targetMatches(image: ImageGeneration) {
    const issue = routeOf(image);
    if (typeof issue !== 'string') return true;
    const state = image.jobId ? 'connection_lost' : 'submission_unknown';
    if (image.state !== state || image.error !== issue) {
      const blocked = { ...image, state, error: issue };
      try {
        await persist(blocked);
        Object.assign(image, blocked);
      } catch {
        console.warn('Could not persist the blocked job target state. No engine request was made.');
      }
    }
    return false;
  }
  async function track(image: ImageGeneration, initial?: EngineJob) {
    if (active.has(image.id)) return;
    const route = routeOf(image);
    if (typeof route === 'string') {
      await targetMatches(image);
      return;
    }
    active.add(image.id);
    const controller = new AbortController();
    let progress: number | null = null;
    try {
      const job = initial || (await route.client.jobs.get(image.jobId!));
      handles.set(image.id, job);
      void (async () => {
        for await (const event of job.events(controller.signal))
          if (event.kind === 'progress') {
            progress = event.currentNode && event.value < 1 ? event.value : null;
            image.stage =
              (
                {
                  '5': 'Reading your direction',
                  '17': 'Imagining the scene',
                  '19': 'Decoding image',
                  '21': 'Saving image',
                } as Record<string, string>
              )[event.currentNode || ''] || 'Preparing image generation';
          }
      })().catch(() => {});
      for (;;) {
        await job.refresh();
        const status = job.status;
        image.state = status === 'succeeded' ? 'finalizing' : status;
        image.progress = progress;
        delete image.error;
        if (status === 'succeeded') {
          image.stage = 'Downloading generated image';
          await persist(image);
          const output = job.getOutputs('21')[0];
          if (!output) throw Error('The workflow finished without an image.');
          const target = path.join(clips, `${image.id}.png`),
            temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await output.toFile(temporary);
            const bytes = await readFile(temporary),
              png = inspectFramePng(bytes, { workflowOptional: route.provider === 'comfy-cloud' }),
              [width, height] = imageDimensions(image.request.aspect, image.request.resolution);
            if (png.width !== width || png.height !== height)
              throw Error('The generated image has unexpected dimensions.');
            const expected = buildImageWorkflow(image.request),
              executed = png.workflow;
            // Comfy Cloud may strip PNG text; its record keeps the graph it submitted.
            for (const id of executed ? Object.keys(expected) : []) {
              const node = executed![id] as { class_type?: string; inputs?: unknown } | undefined;
              if (
                node?.class_type !== expected[id].class_type ||
                !isDeepStrictEqual(node.inputs, expected[id].inputs)
              )
                throw Error('The image metadata does not match its requested workflow.');
            }
            image.workflow = png.workflow ?? image.workflow;
            await rename(temporary, target);
            const clip = {
              id: image.id,
              name: image.request.name,
              kind: 'image' as const,
              width,
              height,
              duration: 1,
              hasAudio: false,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              url: `/media/${image.id}.png`,
            };
            const metadata = path.join(clips, `${image.id}.json`),
              metaTemp = `${metadata}.${randomUUID()}.tmp`;
            await writeFile(metaTemp, JSON.stringify(clip, null, 2));
            await rename(metaTemp, metadata);
            image.clip = clip;
          } finally {
            await unlink(temporary).catch(() => {});
          }
          image.state = 'succeeded';
          image.progress = 1;
          image.stage = 'Ready to edit or animate';
          if (route.provider === 'local')
            try {
              const queue = (await fetch(`${context.uiUrl}/queue`, {
                signal: AbortSignal.timeout(3000),
              }).then((r) => r.json())) as { queue_running?: unknown[]; queue_pending?: unknown[] };
              if (queue.queue_running?.length === 0 && queue.queue_pending?.length === 0)
                await fetch(`${context.uiUrl}/free`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ unload_models: true, free_memory: true }),
                  signal: AbortSignal.timeout(3000),
                });
            } catch {
              /* Image completion does not depend on releasing an idle cache. */
            }
        } else if (status === 'failed') image.error = JSON.stringify(job.error);
        await persist(image);
        if (imageTerminal.has(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const job = handles.get(image.id),
        failed = {
          ...image,
          state: job && imageTerminal.has(job.status) ? 'output_error' : 'connection_lost',
          error: error instanceof Error ? error.message : String(error),
        };
      await persist(failed);
      Object.assign(image, failed);
    } finally {
      controller.abort();
      active.delete(image.id);
      handles.delete(image.id);
    }
  }
  async function submit(image: ImageGeneration) {
    const route = routeOf(image);
    if (typeof route === 'string') throw new JobTargetError(route);
    if (!image.workflow)
      throw Error(
        'The original image workflow is missing. Keep this record for review and create a deliberate new image.',
      );
    const job = await route.client.submit(
      route.client.workflows.fromJson(structuredClone(image.workflow)),
      { idempotencyKey: image.id },
    );
    image.jobId = job.id;
    image.state = job.status === 'succeeded' ? 'finalizing' : job.status;
    await persist(image);
    void track(image, job);
  }
  function submissionMessage(image: ImageGeneration, error: unknown) {
    const route = routeOf(image);
    return (
      (typeof route !== 'string' && route.provider === 'comfy-cloud'
        ? context.cloud?.refused(error)
        : undefined) ?? (error instanceof Error ? error.message : String(error))
    );
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const image = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as ImageGeneration;
      image.request = imageRequestSchema.parse(image.request);
      images.set(image.id, image);
      if (imageBusy(image) && !(await targetMatches(image))) continue;
      if (image.jobId && imageBusy(image)) void track(image);
      else if (image.state === 'submitting') {
        image.state = 'submission_unknown';
        await persist(image);
      }
    } catch (error) {
      console.error('Could not read saved image generation:', name, error);
    }
  }
  router.get('/', (_req, res) => {
    for (const image of images.values())
      if (image.jobId && imageBusy(image) && !active.has(image.id)) void track(image);
    res.json([...images.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.post('/', async (req, res) => {
    const request = imageRequestSchema.parse(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), request, images.values());
    if (admission.conflict) return void res.status(409).json({ error: generationKeyConflict });
    if (admission.existing)
      return void res.status(imageBusy(admission.existing) ? 202 : 200).json(admission.existing);
    if (context.takeBusy() || [...images.values()].some(imageBusy))
      return void res.status(409).json({
        error: 'A generation is already active. Finish or cancel it before creating an image.',
      });
    context.setAdmitting(true);
    try {
      const { route, engine } = await newJobRoute(
        'image-gen',
        local,
        context.engine,
        context.cloud,
      );
      if (!engine.ready)
        return void res.status(409).json({
          error:
            route.provider === 'comfy-cloud'
              ? engine.message
              : localSetupError(
                  'Install the optional Z-Image Turbo weights and start the local engine.',
                  'image-gen',
                  context.cloud,
                ),
        });
      const image: ImageGeneration = {
        jobTarget: route.target.binding,
        id: randomUUID(),
        ...admission.identity,
        request,
        workflow: buildImageWorkflow(request),
        state: 'submitting',
        progress: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await persist(image);
      images.set(image.id, image);
      try {
        await submit(image);
        res.status(201).json(image);
      } catch (error) {
        image.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        image.error = submissionMessage(image, error);
        await persist(image);
        res.status(502).json({ error: image.error, image });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.post('/:id/cancel', async (req, res) => {
    const image = images.get(req.params.id);
    if (!image?.jobId || !imageBusy(image) || image.state === 'finalizing')
      return void res.status(409).json({ error: 'No active image job can be canceled.' });
    const route = routeOf(image);
    if (typeof route === 'string') throw new JobTargetError(route);
    const job = handles.get(image.id) || (await route.client.jobs.get(image.jobId));
    await cancelAndRefresh(job);
    if (job.status !== 'succeeded') image.state = job.status;
    await persist(image);
    res.json(image);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const image = images.get(req.params.id);
    if (!image || !['submission_unknown', 'connection_lost', 'output_error'].includes(image.state))
      return void res.status(409).json({ error: 'This image does not need recovery.' });
    const route = routeOf(image);
    if (typeof route === 'string') throw new JobTargetError(route);
    if (image.jobId) {
      void track(image);
      return void res.json(image);
    }
    if (
      context.takeBusy() ||
      [...images.values()].some((other) => other.id !== image.id && imageBusy(other))
    )
      return void res
        .status(409)
        .json({ error: 'Another generation is active. Rejoin this same image after it finishes.' });
    context.setAdmitting(true);
    try {
      try {
        await submit(image);
        res.json(image);
      } catch (error) {
        image.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        image.error = submissionMessage(image, error);
        await persist(image);
        res.status(502).json({ error: image.error, image });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.get('/:id/recipe', (req, res) => {
    const image = images.get(req.params.id);
    if (!image) return void res.sendStatus(404);
    res.attachment('aftertake-image-recipe.json').json({
      format: 'aftertake-image/1',
      request: image.request,
      workflow: image.workflow,
      output: image.clip,
      jobId: image.jobId,
    });
  });
  return { router, busy: () => [...images.values()].some(imageBusy) };
}
