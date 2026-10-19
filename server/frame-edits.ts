import { cancelAndRefresh } from './job-cancel.js';
import { Router } from 'express';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Comfy, Job } from '@comfyorg/sdk';
import {
  frameEditBusy,
  frameEditRequestSchema,
  frameEditTerminal,
  type FrameEdit,
  type FrameEditRequest,
} from '../src/frame-edit.js';
import type { Clip, Engine } from '../src/domain.js';
import { buildFrameEditWorkflow } from './frame-workflow.js';
import { resolveClipAsset } from './assets.js';
import { submissionRejected } from './submission.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';

export function inspectFramePng(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error('The frame workflow did not return a PNG image.');
  if (bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13)
    throw Error('The generated frame has an invalid PNG header.');
  let workflow: Record<string, unknown> | undefined,
    ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset),
      end = offset + length + 12;
    if (end > bytes.length) throw Error('The generated frame is incomplete.');
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IEND') {
      ended = length === 0;
      break;
    }
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'tEXt') {
      const text = bytes.subarray(offset + 8, offset + 8 + length),
        split = text.indexOf(0);
      if (text.subarray(0, split).toString() === 'prompt')
        workflow = JSON.parse(text.subarray(split + 1).toString('utf8'));
    }
    offset = end;
  }
  if (!ended) throw Error('The generated frame is incomplete.');
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow))
    throw Error('The frame is missing its executed workflow. Enable PNG metadata in ComfyUI.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), workflow };
}

export async function frameEditorRouter(context: {
  data: string;
  client: Comfy;
  engine: () => Promise<Engine>;
  uiUrl: string;
  takeBusy: () => boolean;
  setAdmitting: (value: boolean) => void;
}) {
  const { data, client } = context,
    router = Router();
  const folder = path.join(data, 'frame-edits'),
    clips = path.join(data, 'clips');
  await mkdir(folder, { recursive: true });
  const edits = new Map<string, FrameEdit>(),
    active = new Set<string>(),
    handles = new Map<string, Job>();
  async function persist(edit: FrameEdit) {
    edit.updatedAt = new Date().toISOString();
    const target = path.join(folder, `${edit.id}.json`),
      temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(edit, null, 2));
    await rename(temporary, target);
  }
  async function resolve(request: FrameEditRequest) {
    const clip = await resolveClipAsset(request.clip, clips, 'frame-edit source');
    const subject = request.subject
      ? await resolveClipAsset(request.subject, clips, 'subject reference')
      : undefined;
    return frameEditRequestSchema.parse({ ...request, clip, subject });
  }
  async function track(edit: FrameEdit, initial?: Job) {
    if (active.has(edit.id)) return;
    active.add(edit.id);
    const controller = new AbortController();
    let progress: number | null = null;
    try {
      const job = initial || (await client.jobs.get(edit.jobId!));
      handles.set(edit.id, job);
      void (async () => {
        for await (const event of job.events(controller.signal))
          if (event.kind === 'progress') {
            progress = event.currentNode && event.value < 1 ? event.value : null;
            edit.stage =
              (
                {
                  '8': 'Reading starting frame',
                  '23': 'Reading subject reference',
                  '10': 'Reading edit direction',
                  '11': 'Preparing image guidance',
                  '17': 'Editing frame',
                  '19': 'Decoding image',
                  '21': 'Saving edited frame',
                } as Record<string, string>
              )[event.currentNode || ''] || 'Preparing frame edit';
          }
      })().catch(() => {});
      for (;;) {
        await job.refresh();
        const status = job.status;
        edit.state = status === 'succeeded' ? 'finalizing' : status;
        edit.progress = progress;
        delete edit.error;
        if (status === 'succeeded') {
          edit.stage = 'Downloading edited frame';
          await persist(edit);
          const output = job.getOutputs('21')[0];
          if (!output) throw Error('The workflow finished without an edited frame.');
          const target = path.join(clips, `${edit.id}.png`),
            temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await output.toFile(temporary);
            const bytes = await readFile(temporary),
              png = inspectFramePng(bytes);
            if (png.width !== edit.request.clip.width || png.height !== edit.request.clip.height)
              throw Error('The edited frame does not match the source dimensions.');
            await rename(temporary, target);
            edit.workflow = png.workflow;
            edit.clip = {
              id: edit.id,
              name: `Edited frame · ${edit.request.prompt.slice(0, 70)}`,
              kind: 'image',
              width: png.width,
              height: png.height,
              duration: 1,
              hasAudio: false,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              url: `/media/${edit.id}.png`,
            };
            const metadata = path.join(clips, `${edit.id}.json`),
              metaTemp = `${metadata}.${randomUUID()}.tmp`;
            await writeFile(metaTemp, JSON.stringify(edit.clip, null, 2));
            await rename(metaTemp, metadata);
          } finally {
            await unlink(temporary).catch(() => {});
          }
          edit.state = 'succeeded';
          edit.progress = 1;
          edit.stage = 'Ready to review';
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
          } catch (error) {
            console.warn('Could not release idle frame-edit GPU cache:', error);
          }
        } else if (status === 'failed') edit.error = JSON.stringify(job.error);
        await persist(edit);
        if (frameEditTerminal.has(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const job = handles.get(edit.id);
      const failed = {
        ...edit,
        state: job && frameEditTerminal.has(job.status) ? 'output_error' : 'connection_lost',
        error: error instanceof Error ? error.message : String(error),
      };
      await persist(failed);
      // Publish recovery only when persistence is complete; cleanup below is synchronous.
      Object.assign(edit, failed);
    } finally {
      controller.abort();
      active.delete(edit.id);
      handles.delete(edit.id);
    }
  }
  async function submit(edit: FrameEdit) {
    if (!edit.workflow)
      throw Error(
        'The original frame-edit workflow is missing. Keep this record for review and create a deliberate new edit.',
      );
    const workflow = client.workflows.fromJson(structuredClone(edit.workflow));
    workflow.setInput(
      '8',
      'filename',
      client.assets.fromFile(path.join(clips, path.basename(edit.request.clip.url))),
    );
    if (edit.request.subject)
      workflow.setInput(
        '23',
        'filename',
        client.assets.fromFile(path.join(clips, path.basename(edit.request.subject.url))),
      );
    const job = await client.submit(workflow, { idempotencyKey: edit.id });
    edit.jobId = job.id;
    edit.state = job.status === 'succeeded' ? 'finalizing' : job.status;
    await persist(edit);
    void track(edit, job);
  }
  for (const filename of await readdir(folder)) {
    if (!filename.endsWith('.json')) continue;
    try {
      const edit = JSON.parse(await readFile(path.join(folder, filename), 'utf8')) as FrameEdit;
      edit.request = frameEditRequestSchema.parse(edit.request);
      edits.set(edit.id, edit);
      if (edit.jobId && frameEditBusy(edit)) void track(edit);
      else if (edit.state === 'submitting') {
        edit.state = 'submission_unknown';
        await persist(edit);
      }
    } catch (error) {
      console.error(`Could not read saved frame edit ${filename}:`, error);
    }
  }
  router.get('/', (_req, res) => {
    for (const edit of edits.values())
      if (edit.jobId && frameEditBusy(edit) && !active.has(edit.id)) void track(edit);
    res.json([...edits.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.post('/', async (req, res) => {
    const input = frameEditRequestSchema.parse(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), input, edits.values());
    if (admission.conflict) return void res.status(409).json({ error: generationKeyConflict });
    if (admission.existing)
      return void res
        .status(frameEditBusy(admission.existing) ? 202 : 200)
        .json(admission.existing);
    if (context.takeBusy() || [...edits.values()].some(frameEditBusy))
      return void res.status(409).json({
        error: 'A generation is already active. Finish or cancel it before editing a frame.',
      });
    context.setAdmitting(true);
    try {
      if (!(await context.engine()).ready)
        return void res
          .status(409)
          .json({ error: 'Install the optional frame-editor weights and start the local engine.' });
      const request = await resolve(input);
      const edit: FrameEdit = {
        id: randomUUID(),
        ...admission.identity,
        request,
        workflow: buildFrameEditWorkflow(request),
        state: 'submitting',
        progress: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      edits.set(edit.id, edit);
      await persist(edit);
      try {
        await submit(edit);
        res.status(201).json(edit);
      } catch (error) {
        edit.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        edit.error = error instanceof Error ? error.message : String(error);
        await persist(edit);
        res.status(502).json({ error: edit.error, edit });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.post('/:id/cancel', async (req, res) => {
    const edit = edits.get(req.params.id);
    if (!edit?.jobId || !frameEditBusy(edit) || edit.state === 'finalizing')
      return void res.status(409).json({ error: 'No active frame-edit job can be canceled.' });
    const job = handles.get(edit.id) || (await client.jobs.get(edit.jobId));
    await cancelAndRefresh(job);
    if (job.status !== 'succeeded') edit.state = job.status;
    await persist(edit);
    res.json(edit);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const edit = edits.get(req.params.id);
    if (!edit || !['submission_unknown', 'connection_lost', 'output_error'].includes(edit.state))
      return void res.status(409).json({ error: 'This frame edit does not need recovery.' });
    if (edit.jobId) {
      void track(edit);
      return void res.json(edit);
    }
    if (
      context.takeBusy() ||
      [...edits.values()].some((other) => other.id !== edit.id && frameEditBusy(other))
    )
      return void res.status(409).json({
        error: 'Another generation is active. Rejoin this same frame edit after it finishes.',
      });
    context.setAdmitting(true);
    try {
      // Retain the original graph/key and verify its original source bytes.
      edit.request = await resolve(edit.request);
      try {
        await submit(edit);
        res.json(edit);
      } catch (error) {
        edit.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        edit.error = error instanceof Error ? error.message : String(error);
        await persist(edit);
        res.status(502).json({ error: edit.error, edit });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  router.get('/:id/recipe', (req, res) => {
    const edit = edits.get(req.params.id);
    if (!edit) return void res.sendStatus(404);
    res.attachment('aftertake-frame-recipe.json').json({
      format: 'aftertake-frame-edit/1',
      request: edit.request,
      workflow: edit.workflow,
      output: edit.clip,
      jobId: edit.jobId,
    });
  });
  return { router, busy: () => [...edits.values()].some(frameEditBusy) };
}
