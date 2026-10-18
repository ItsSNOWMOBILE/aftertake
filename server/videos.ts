import { Router } from 'express';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Comfy, Job } from '@comfyorg/sdk';
import type { Engine } from '../src/domain.js';
import { videoBusy, videoRequestSchema, videoTerminal, type VideoGeneration } from '../src/video-generation.js';
import { buildVideoWorkflow } from './video-workflow.js';
import {verifyGeneratedVideo} from './video-output.js';
import { submissionRejected } from './submission.js';
import {generationAdmission,generationKeyConflict} from './generation-admission.js';

export async function videoRouter(context: { data: string; client: Comfy; uiUrl: string; root:string; python:string; inspect?:Parameters<typeof verifyGeneratedVideo>[3]; engine: () => Promise<Engine>;
  takeBusy: () => boolean; setAdmitting: (value: boolean) => void }) {
  const { data, client } = context, router = Router(), folder = path.join(data, 'videos'), clips = path.join(data, 'clips');
  await Promise.all([folder, clips].map(folder => mkdir(folder, { recursive: true })));
  const videos = new Map<string, VideoGeneration>(), active = new Set<string>(), handles = new Map<string, Job>();
  async function persist(video: VideoGeneration) {
    video.updatedAt = new Date().toISOString();
    const target = path.join(folder, video.id + '.json'), temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(video, null, 2)); await rename(temporary, target);
  }
  async function track(video: VideoGeneration, initial?: Job) {
    if (active.has(video.id)) return;
    active.add(video.id); const controller = new AbortController(); let progress: number | null = null;
    try {
      const job = initial || await client.jobs.get(video.jobId!); handles.set(video.id, job);
      void (async () => {
        for await (const event of job.events(controller.signal)) if (event.kind === 'progress') {
          progress = event.currentNode && event.value < 1 ? event.value : null;
          video.stage = ({ '5': 'Reading your direction', '17': 'Generating motion and sound', '19': 'Decoding frames', '21': 'Saving video' } as Record<string, string>)[event.currentNode || ''] || 'Preparing video generation';
        }
      })().catch(() => {});
      for (;;) {
        await job.refresh(); video.state = job.status === 'succeeded' ? 'finalizing' : job.status; video.progress = progress; delete video.error;
        if (job.status === 'succeeded') {
          video.stage = 'Downloading generated video'; await persist(video);
          const output = job.getOutputs('21')[0]; if (!output) throw Error('The workflow finished without a video.');
          const target = path.join(clips, `${video.id}.mp4`), temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await output.toFile(temporary);
            const bytes=await readFile(temporary);
            const media=await verifyGeneratedVideo(bytes,video.request,temporary,context.inspect,{root:context.root,python:context.python});
            video.workflow=media.workflow; await rename(temporary,target);
            const clip={id:video.id,name:video.request.name,kind:'video' as const,width:media.width,height:media.height,duration:media.duration,hasAudio:media.hasAudio,
              sha256:createHash('sha256').update(bytes).digest('hex'),url:`/media/${video.id}.mp4`};
            const metadata = path.join(clips, `${video.id}.json`), metaTemp = `${metadata}.${randomUUID()}.tmp`;
            await writeFile(metaTemp, JSON.stringify(clip, null, 2)); await rename(metaTemp, metadata); video.clip = clip;
          } finally { await unlink(temporary).catch(() => {}); }
          video.state = 'succeeded'; video.progress = 1; video.stage = 'Ready to add to Film';
          try {
            const queue = await fetch(`${context.uiUrl}/queue`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
            if (queue.queue_running?.length === 0 && queue.queue_pending?.length === 0)
              await fetch(`${context.uiUrl}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(3000) });
          } catch { /* Video completion does not depend on releasing an idle cache. */ }
        } else if (job.status === 'failed') video.error = JSON.stringify(job.error);
        await persist(video); if (videoTerminal.has(job.status)) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const job = handles.get(video.id); video.state = job && videoTerminal.has(job.status) ? 'output_error' : 'connection_lost';
      video.error = error instanceof Error ? error.message : String(error); await persist(video);
    } finally { controller.abort(); active.delete(video.id); handles.delete(video.id); }
  }
  async function submit(video: VideoGeneration) {
    if (!video.workflow) throw Error('The original video workflow is missing. Keep this record for review and create a deliberate new video.');
    const job = await client.submit(client.workflows.fromJson(structuredClone(video.workflow)), { idempotencyKey: video.id });
    video.jobId = job.id; video.state = job.status === 'succeeded' ? 'finalizing' : job.status;
    await persist(video); void track(video, job);
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const video = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as VideoGeneration;
      video.request = videoRequestSchema.parse(video.request); videos.set(video.id, video);
      if (video.jobId && videoBusy(video)) void track(video);
      else if (video.state === 'submitting') { video.state = 'submission_unknown'; await persist(video); }
    } catch (error) { console.error('Could not read saved video generation:', name, error); }
  }
  router.get('/', (_req, res) => { for (const video of videos.values()) if (video.jobId && videoBusy(video) && !active.has(video.id)) void track(video);
    res.json([...videos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); });
  router.post('/', async (req, res) => {
    const request=videoRequestSchema.parse(req.body),admission=generationAdmission(req.get('Idempotency-Key'),request,videos.values());
    if(admission.conflict)return void res.status(409).json({error:generationKeyConflict});
    if(admission.existing)return void res.status(videoBusy(admission.existing)?202:200).json(admission.existing);
    if (context.takeBusy() || [...videos.values()].some(videoBusy)) return void res.status(409).json({ error: 'A generation is already active. Finish or cancel it before creating a video.' });
    context.setAdmitting(true);
    try {
      if (!(await context.engine()).ready) return void res.status(409).json({ error: 'Install the text-to-video model profile and start the local engine.' });
      const video: VideoGeneration = { id: randomUUID(), ...admission.identity, request, workflow: buildVideoWorkflow(request), state: 'submitting', progress: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      videos.set(video.id, video); await persist(video);
      try { await submit(video); res.status(201).json(video); }
      catch (error) { video.state = submissionRejected(error) ? 'failed' : 'submission_unknown'; video.error = error instanceof Error ? error.message : String(error); await persist(video); res.status(502).json({ error: video.error, video }); }
    } finally { context.setAdmitting(false); }
  });
  router.post('/:id/cancel', async (req, res) => {
    const video = videos.get(req.params.id); if (!video?.jobId || !videoBusy(video) || video.state === 'finalizing') return void res.status(409).json({ error: 'No active video job can be canceled.' });
    const job = handles.get(video.id) || await client.jobs.get(video.jobId); await job.cancel(); video.state = job.status; await persist(video); res.json(video);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const video = videos.get(req.params.id); if (!video || !['submission_unknown', 'connection_lost', 'output_error'].includes(video.state)) return void res.status(409).json({ error: 'This video does not need recovery.' });
    if (video.jobId) { void track(video); return void res.json(video); }
    if (context.takeBusy() || [...videos.values()].some(other => other.id !== video.id && videoBusy(other)))
      return void res.status(409).json({ error: 'Another generation is active. Rejoin this same video after it finishes.' });
    context.setAdmitting(true);
    try {
      try { await submit(video); res.json(video); }
      catch (error) { video.state = submissionRejected(error) ? 'failed' : 'submission_unknown'; video.error = error instanceof Error ? error.message : String(error); await persist(video); res.status(502).json({ error: video.error, video }); }
    } finally { context.setAdmitting(false); }
  });
  router.get('/:id/recipe', (req, res) => { const video = videos.get(req.params.id); if (!video) return void res.sendStatus(404);
    res.attachment('aftertake-video-recipe.json').json({ format: 'aftertake-text-video/1', request: video.request, workflow: video.workflow, output: video.clip, jobId: video.jobId }); });
  return { router, busy: () => [...videos.values()].some(videoBusy) };
}
