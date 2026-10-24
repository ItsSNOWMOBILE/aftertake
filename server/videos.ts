import { cancelAndRefresh } from './job-cancel.js';
import { Router } from 'express';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { replaceFile } from './replace-file.js';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { EngineClient, EngineJob } from './sdk-port.js';
import type { Engine } from '../src/domain.js';
import {
  videoBusy,
  videoDimensions,
  videoRequestSchema,
  videoTerminal,
  type VideoGeneration,
} from '../src/video-generation.js';
import { buildVideoWorkflow } from './video-workflow.js';
import { verifyGeneratedVideo } from './video-output.js';
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
import { buildCloudVideoWorkflow, cloudOutputs } from './cloud-workflow.js';
import { runCloudMedia } from './cloud-media.js';

export async function videoRouter(context: {
  data: string;
  client: EngineClient;
  target: JobTarget;
  uiUrl: string;
  root: string;
  python: string;
  inspect?: Parameters<typeof verifyGeneratedVideo>[3];
  engine: () => Promise<Engine>;
  /** Present when Comfy Cloud can take new videos and rejoin its own. */
  cloud?: CloudRoutes;
  takeBusy: () => boolean;
  setAdmitting: (value: boolean) => void;
}) {
  const { data, client, target } = context,
    local: EngineRoute = { provider: 'local', client, target },
    routeOf = (video: VideoGeneration) => recordRoute(video, local, context.cloud),
    router = Router(),
    folder = path.join(data, 'videos'),
    clips = path.join(data, 'clips');
  await Promise.all([folder, clips].map((folder) => mkdir(folder, { recursive: true })));
  const videos = new Map<string, VideoGeneration>(),
    active = new Set<string>(),
    handles = new Map<string, EngineJob>();
  async function persist(video: VideoGeneration) {
    video.updatedAt = new Date().toISOString();
    const target = path.join(folder, video.id + '.json'),
      temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(video, null, 2));
      await replaceFile(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function targetMatches(video: VideoGeneration) {
    const issue = routeOf(video);
    if (typeof issue !== 'string') return true;
    const state = video.jobId ? 'connection_lost' : 'submission_unknown';
    if (video.state !== state || video.error !== issue) {
      const blocked = { ...video, state, error: issue };
      try {
        await persist(blocked);
        Object.assign(video, blocked);
      } catch {
        console.warn('Could not persist the blocked job target state. No engine request was made.');
      }
    }
    return false;
  }
  async function track(video: VideoGeneration, initial?: EngineJob) {
    if (active.has(video.id)) return;
    const route = routeOf(video);
    if (typeof route === 'string') {
      await targetMatches(video);
      return;
    }
    active.add(video.id);
    const controller = new AbortController();
    let progress: number | null = null;
    try {
      const job = initial || (await route.client.jobs.get(video.jobId!));
      handles.set(video.id, job);
      void (async () => {
        for await (const event of job.events(controller.signal))
          if (event.kind === 'progress') {
            progress = event.currentNode && event.value < 1 ? event.value : null;
            video.stage =
              (
                {
                  '5': 'Reading your direction',
                  '17': 'Generating motion and sound',
                  '19': 'Decoding frames',
                  '21': 'Saving video',
                } as Record<string, string>
              )[event.currentNode || ''] || 'Preparing video generation';
          }
      })().catch(() => {});
      for (;;) {
        await job.refresh();
        const status = job.status;
        video.state = status === 'succeeded' ? 'finalizing' : status;
        video.progress = progress;
        delete video.error;
        if (status === 'succeeded') {
          video.stage = 'Downloading generated video';
          await persist(video);
          const onCloud = route.provider === 'comfy-cloud',
            output = job.getOutputs(onCloud ? cloudOutputs.frames : '21')[0];
          if (!output) throw Error('The workflow finished without a video.');
          const target = path.join(clips, `${video.id}.mp4`),
            temporary = `${target}.${randomUUID()}.tmp`,
            frames = `${temporary}.webm`,
            sound = `${temporary}.flac`;
          try {
            if (onCloud) await finishCloudVideo(video, job, output, { frames, sound, temporary });
            else await output.toFile(temporary);
            const bytes = await readFile(temporary);
            const media = await verifyGeneratedVideo(
              bytes,
              video.request,
              temporary,
              context.inspect,
              {
                root: context.root,
                python: context.python,
                ...(onCloud ? { expected: buildCloudVideoWorkflow(video.request) } : {}),
              },
            );
            video.workflow = media.workflow;
            await replaceFile(temporary, target);
            const clip = {
              id: video.id,
              name: video.request.name,
              kind: 'video' as const,
              width: media.width,
              height: media.height,
              duration: media.duration,
              hasAudio: media.hasAudio,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              url: `/media/${video.id}.mp4`,
            };
            const metadata = path.join(clips, `${video.id}.json`),
              metaTemp = `${metadata}.${randomUUID()}.tmp`;
            await writeFile(metaTemp, JSON.stringify(clip, null, 2));
            await replaceFile(metaTemp, metadata);
            video.clip = clip;
          } finally {
            await Promise.all(
              [temporary, frames, sound].map((file) => unlink(file).catch(() => {})),
            );
          }
          video.state = 'succeeded';
          video.progress = 1;
          video.stage = 'Ready to add to Film';
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
              /* Video completion does not depend on releasing an idle cache. */
            }
        } else if (status === 'failed') video.error = JSON.stringify(job.error);
        await persist(video);
        if (videoTerminal.has(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const job = handles.get(video.id);
      const failed = {
        ...video,
        state: job && videoTerminal.has(job.status) ? 'output_error' : 'connection_lost',
        error: error instanceof Error ? error.message : String(error),
      };
      await persist(failed);
      // Publish recovery only when persistence is complete; cleanup below is synchronous.
      Object.assign(video, failed);
    } finally {
      controller.abort();
      active.delete(video.id);
      handles.delete(video.id);
    }
  }
  /** Grade Cloud's frames, add its sound and write the MP4 the local saver would. */
  async function finishCloudVideo(
    video: VideoGeneration,
    job: EngineJob,
    output: { toFile(file: string): Promise<unknown> },
    files: { frames: string; sound: string; temporary: string },
  ) {
    video.stage = 'Grading and adding sound on this computer';
    await output.toFile(files.frames);
    const audio = video.request.sound ? job.getOutputs(cloudOutputs.sound)[0] : undefined;
    if (video.request.sound && !audio) throw Error('The workflow finished without its sound.');
    if (audio) await audio.toFile(files.sound);
    const d = videoDimensions(video.request);
    await runCloudMedia(
      context,
      'finish',
      {
        frames: files.frames,
        output: files.temporary,
        fps: d.fps,
        frame_count: d.frames,
        palette: video.request.cinema?.palette || 'source',
        comment: { recipe: video.request, workflow: video.workflow },
        ...(audio ? { generated_audio: files.sound } : {}),
      },
      folder,
    );
  }
  async function submit(video: VideoGeneration) {
    const route = routeOf(video);
    if (typeof route === 'string') throw new JobTargetError(route);
    if (!video.workflow)
      throw Error(
        'The original video workflow is missing. Keep this record for review and create a deliberate new video.',
      );
    const job = await route.client.submit(
      route.client.workflows.fromJson(structuredClone(video.workflow)),
      { idempotencyKey: video.id },
    );
    video.jobId = job.id;
    video.state = job.status === 'succeeded' ? 'finalizing' : job.status;
    await persist(video);
    void track(video, job);
  }
  function submissionMessage(video: VideoGeneration, error: unknown) {
    const route = routeOf(video);
    return (
      (typeof route !== 'string' && route.provider === 'comfy-cloud'
        ? context.cloud?.refused(error)
        : undefined) ?? (error instanceof Error ? error.message : String(error))
    );
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const video = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as VideoGeneration;
      video.request = videoRequestSchema.parse(video.request);
      videos.set(video.id, video);
      if (videoBusy(video) && !(await targetMatches(video))) continue;
      if (video.jobId && videoBusy(video)) void track(video);
      else if (video.state === 'submitting') {
        video.state = 'submission_unknown';
        await persist(video);
      }
    } catch (error) {
      console.error('Could not read saved video generation:', name, error);
    }
  }
  router.get('/', (_req, res) => {
    for (const video of videos.values())
      if (video.jobId && videoBusy(video) && !active.has(video.id)) void track(video);
    res.json([...videos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.post('/', async (req, res) => {
    const request = videoRequestSchema.parse(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), request, videos.values());
    if (admission.conflict) return void res.status(409).json({ error: generationKeyConflict });
    if (admission.existing)
      return void res.status(videoBusy(admission.existing) ? 202 : 200).json(admission.existing);
    if (context.takeBusy() || [...videos.values()].some(videoBusy))
      return void res.status(409).json({
        error: 'A generation is already active. Finish or cancel it before creating a video.',
      });
    context.setAdmitting(true);
    try {
      const { route, engine } = await newJobRoute(
        'text-video',
        local,
        context.engine,
        context.cloud,
      );
      if (!engine.ready)
        return void res.status(409).json({
          error:
            route.provider === 'comfy-cloud'
              ? [engine.message, ...engine.missing].join(' ')
              : localSetupError(
                  'Install the text-to-video model profile and start the local engine.',
                  'text-video',
                  context.cloud,
                ),
        });
      const video: VideoGeneration = {
        jobTarget: route.target.binding,
        id: randomUUID(),
        ...admission.identity,
        request,
        workflow:
          route.provider === 'comfy-cloud'
            ? buildCloudVideoWorkflow(request)
            : buildVideoWorkflow(request),
        state: 'submitting',
        progress: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await persist(video);
      videos.set(video.id, video);
      try {
        await submit(video);
        res.status(201).json(video);
      } catch (error) {
        video.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        video.error = submissionMessage(video, error);
        await persist(video);
        res.status(502).json({ error: video.error, video });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.post('/:id/cancel', async (req, res) => {
    const video = videos.get(req.params.id);
    if (!video?.jobId || !videoBusy(video) || video.state === 'finalizing')
      return void res.status(409).json({ error: 'No active video job can be canceled.' });
    const route = routeOf(video);
    if (typeof route === 'string') throw new JobTargetError(route);
    const job = handles.get(video.id) || (await route.client.jobs.get(video.jobId));
    await cancelAndRefresh(job);
    if (job.status !== 'succeeded') video.state = job.status;
    await persist(video);
    res.json(video);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const video = videos.get(req.params.id);
    if (!video || !['submission_unknown', 'connection_lost', 'output_error'].includes(video.state))
      return void res.status(409).json({ error: 'This video does not need recovery.' });
    const route = routeOf(video);
    if (typeof route === 'string') throw new JobTargetError(route);
    if (video.jobId) {
      void track(video);
      return void res.json(video);
    }
    if (
      context.takeBusy() ||
      [...videos.values()].some((other) => other.id !== video.id && videoBusy(other))
    )
      return void res
        .status(409)
        .json({ error: 'Another generation is active. Rejoin this same video after it finishes.' });
    context.setAdmitting(true);
    try {
      try {
        await submit(video);
        res.json(video);
      } catch (error) {
        video.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        video.error = submissionMessage(video, error);
        await persist(video);
        res.status(502).json({ error: video.error, video });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.get('/:id/recipe', (req, res) => {
    const video = videos.get(req.params.id);
    if (!video) return void res.sendStatus(404);
    res.attachment('aftertake-video-recipe.json').json({
      format: 'aftertake-text-video/1',
      request: video.request,
      workflow: video.workflow,
      output: video.clip,
      jobId: video.jobId,
    });
  });
  return { router, busy: () => [...videos.values()].some(videoBusy) };
}
