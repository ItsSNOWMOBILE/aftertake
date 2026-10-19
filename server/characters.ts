import { cancelAndRefresh } from './job-cancel.js';
import { RequestError } from './http-errors.js';
import { Router } from 'express';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type { EngineClient, EngineJob } from './sdk-port.js';
import type { Clip, Engine } from '../src/domain.js';
import {
  characterBusy,
  characterRequestSchema,
  parseCharacterSelectionInfo,
  characterSelectionSchema,
  characterTerminal,
  type CharacterJob,
  type CharacterRequest,
  type CharacterSelectionRequest,
} from '../src/character.js';
import { buildCharacterWorkflow } from './character-workflow.js';
import { resolveClipAsset } from './assets.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { submissionRejected } from './submission.js';
import { readVideoMetadata } from './video-metadata.js';
import { assertJobTarget, jobTargetIssue, type JobTarget } from './job-target.js';

const exec = promisify(execFile),
  sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function characterRouter(context: {
  root: string;
  data: string;
  python: string;
  client: EngineClient;
  target: JobTarget;
  uiUrl: string;
  engine: (selectionOnly: boolean) => Promise<Engine>;
  takeBusy: () => boolean;
  setAdmitting: (value: boolean) => void;
}) {
  const { root, data, python, client, target } = context,
    router = Router(),
    folder = path.join(data, 'characters'),
    clips = path.join(data, 'clips');
  await mkdir(folder, { recursive: true });
  await mkdir(clips, { recursive: true });
  const jobs = new Map<string, CharacterJob>(),
    active = new Set<string>(),
    handles = new Map<string, EngineJob>();
  const file = (id: string, suffix: string) => path.join(folder, `${id}-${suffix}`);
  async function persist(record: CharacterJob) {
    record.updatedAt = new Date().toISOString();
    const dest = path.join(folder, record.id + '.json'),
      tmp = dest + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify(record, null, 2));
    await rename(tmp, dest);
  }
  async function inspect(
    filename: string,
    expected: { width: number; height: number; frames: number },
  ) {
    const { stdout } = await exec(
      python,
      [path.join(root, 'scripts/inspect-character-media.py'), filename],
      {
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
      },
    );
    const actual = JSON.parse(stdout);
    if (
      actual.width !== expected.width ||
      actual.height !== expected.height ||
      actual.frames !== expected.frames ||
      actual.fps !== 24 ||
      !actual.regularTimestamps
    )
      throw Error(
        'The downloaded video does not match the selected source clock, canvas and frame count.',
      );
    return actual as {
      width: number;
      height: number;
      frames: number;
      fps: number;
      duration: number;
      hasAudio: boolean;
    };
  }
  async function resolveSelection(id: string) {
    const selection = jobs.get(id);
    if (
      !selection ||
      selection.kind !== 'selection' ||
      selection.state !== 'succeeded' ||
      !selection.selection
    )
      throw new RequestError(
        'Review a completed person selection before replacing a character.',
        409,
      );
    if (selection.selection.emptyFrames.length)
      throw new RequestError(
        `The person was lost in ${selection.selection.emptyFrames.length} frames. Adjust the selection or use a shorter continuous shot.`,
        409,
      );
    const mask = await readFile(file(id, 'mask.mkv')),
      source = await readFile(file(id, 'source.mp4'));
    if (
      sha(mask) !== selection.selection.maskSha256 ||
      sha(source) !== selection.selection.sourceSha256
    )
      throw new RequestError(
        'The reviewed selection changed on disk. Track this person again before generating.',
        409,
      );
    return selection;
  }
  async function resolveReferences(request: CharacterRequest) {
    const [reference, ...supporting] = await Promise.all([
      resolveClipAsset(request.reference, clips, 'character photo'),
      ...(request.identityReferences ?? []).map((identity, index) =>
        resolveClipAsset(identity.reference, clips, `supporting identity photo ${index + 1}`),
      ),
    ]);
    // Re-validate stored image kinds, dimensions, crops and duplicates, rather
    // than trusting the caller's descriptions of the imported media.
    return characterRequestSchema.parse({
      ...request,
      reference,
      ...(request.identityReferences
        ? {
            identityReferences: request.identityReferences.map((identity, index) => ({
              ...identity,
              reference: supporting[index],
            })),
          }
        : {}),
    });
  }
  async function bind(record: CharacterJob) {
    assertJobTarget(record, target);
    const workflow = client.workflows.fromJson(structuredClone(record.workflow));
    if (record.kind === 'selection') {
      const request = record.request as CharacterSelectionRequest;
      const source = await resolveClipAsset(request.clip, clips, 'source video');
      workflow.setInput(
        'source',
        'file',
        client.assets.fromFile(path.join(clips, path.basename(source.url))),
      );
    } else {
      const request = record.request as CharacterRequest,
        selection = await resolveSelection(request.selectionId);
      const sourceRequest = selection.request as CharacterSelectionRequest;
      const [source, references] = await Promise.all([
        resolveClipAsset(sourceRequest.clip, clips, 'source video'),
        resolveReferences(request),
      ]);
      workflow.setInput('source', 'file', client.assets.fromFile(file(selection.id, 'source.mp4')));
      workflow.setInput(
        'mask_video',
        'file',
        client.assets.fromFile(file(selection.id, 'mask.mkv')),
      );
      workflow.setInput(
        record.workflow.body_reference?.class_type === 'LoadImage' ? 'body_reference' : 'reference',
        'image',
        client.assets.fromFile(path.join(clips, path.basename(references.reference.url))),
      );
      for (const [index, identity] of (references.identityReferences ?? []).entries())
        workflow.setInput(
          `identity_reference_${index}`,
          'image',
          client.assets.fromFile(path.join(clips, path.basename(identity.reference.url))),
        );
      workflow.setInput(
        'original_audio',
        'filename',
        client.assets.fromFile(path.join(clips, path.basename(source.url))),
      );
    }
    return workflow;
  }
  function executed(record: CharacterJob, metadata: ReturnType<typeof readVideoMetadata>) {
    const expected =
      record.kind === 'selection'
        ? 'aftertake-character-selection-output/1'
        : 'aftertake-character-output/1';
    if (
      metadata.recipe?.format !== expected ||
      !isDeepStrictEqual(metadata.recipe.request, record.request)
    )
      throw Error('The downloaded result belongs to a different character request.');
    for (const [id, node] of Object.entries(record.workflow)) {
      const actual = metadata.workflow?.[id];
      if (!actual || actual.class_type !== node.class_type)
        throw Error('The result is missing its executed native workflow.');
      for (const [key, value] of Object.entries(node.inputs)) {
        if (
          ['file', 'filename', 'image'].includes(key) &&
          ['LoadVideo', 'LoadImage', 'AftertakeLoadClip'].includes(node.class_type)
        )
          continue;
        if (!isDeepStrictEqual(actual.inputs?.[key], value))
          throw Error(`The executed character workflow differs at ${id}.${key}.`);
      }
    }
    return metadata.workflow;
  }
  async function finalize(record: CharacterJob, job: EngineJob) {
    if (record.kind === 'selection') {
      const masks = job.getOutputs('selection'),
        source = job.getOutputs('source_save')[0];
      if (masks.length !== 2 || !source)
        throw Error('The selection finished without its mask, preview and prepared source.');
      await Promise.all([
        masks[0].toFile(file(record.id, 'mask.mkv')),
        masks[1].toFile(file(record.id, 'preview.mp4')),
        source.toFile(file(record.id, 'source.mp4')),
      ]);
      const metadata = readVideoMetadata(await readFile(file(record.id, 'preview.mp4')));
      record.workflow = executed(record, metadata);
      const info = parseCharacterSelectionInfo(
        metadata.recipe.selection,
        record.request as CharacterSelectionRequest,
      );
      if (sha(await readFile(file(record.id, 'mask.mkv'))) !== info.maskSha256)
        throw Error('The downloaded mask does not match its reviewed preview.');
      await inspect(file(record.id, 'source.mp4'), info);
      await inspect(file(record.id, 'mask.mkv'), info);
      record.selection = {
        ...info,
        sourceSha256: sha(await readFile(file(record.id, 'source.mp4'))),
      };
      record.stage = info.emptyFrames.length
        ? 'Tracking needs correction'
        : 'Selection ready to review';
    } else {
      const output = job.getOutputs('save')[0];
      if (!output) throw Error('H3 finished without a character video.');
      const pending = file(record.id, 'result.mp4');
      await output.toFile(pending);
      const bytes = await readFile(pending),
        metadata = readVideoMetadata(bytes);
      record.workflow = executed(record, metadata);
      const selection = await resolveSelection((record.request as CharacterRequest).selectionId),
        info = selection.selection!;
      const media = await inspect(pending, info),
        dest = path.join(clips, record.id + '.mp4');
      await rename(pending, dest);
      record.clip = {
        id: record.id,
        name: (record.request as CharacterRequest).name,
        kind: 'video',
        sha256: sha(bytes),
        width: media.width,
        height: media.height,
        duration: media.duration,
        hasAudio: media.hasAudio,
        url: `/media/${record.id}.mp4`,
      };
      const tmp = path.join(clips, record.id + '.json.tmp');
      await writeFile(tmp, JSON.stringify(record.clip, null, 2));
      await rename(tmp, path.join(clips, record.id + '.json'));
      record.stage = 'Character replacement ready';
    }
    record.state = 'succeeded';
    record.progress = 1;
  }
  async function targetMatches(record: CharacterJob) {
    const issue = jobTargetIssue(record, target);
    if (!issue) return true;
    const state = record.jobId ? 'connection_lost' : 'submission_unknown';
    if (record.state !== state || record.error !== issue) {
      const blocked = { ...record, state, error: issue };
      try {
        await persist(blocked);
        Object.assign(record, blocked);
      } catch {
        console.warn('Could not persist the blocked job target state. No engine request was made.');
      }
    }
    return false;
  }
  async function track(record: CharacterJob, initial?: EngineJob) {
    if (active.has(record.id)) return;
    if (jobTargetIssue(record, target)) {
      await targetMatches(record);
      return;
    }
    active.add(record.id);
    const controller = new AbortController();
    let progress: number | null = null;
    try {
      const job = initial || (await client.jobs.get(record.jobId!));
      handles.set(record.id, job);
      void (async () => {
        for await (const event of job.events(controller.signal))
          if (event.kind === 'progress') {
            progress = event.value < 1 ? event.value : null;
            const nodeClass = record.workflow[event.currentNode || '']?.class_type;
            const node = (
              typeof nodeClass === 'string' ? nodeClass : String(event.currentNode || '')
            ).toLowerCase();
            record.stage = node.includes('track')
              ? 'Tracking the selected person'
              : node.includes('sampler') || node.includes('sample')
                ? 'Replacing the character'
                : node.includes('referencetovideo') || node.includes('reference_conditioning')
                  ? 'Reading the character reference'
                  : node.includes('history')
                    ? 'Matching continuation history'
                    : node.includes('decode')
                      ? 'Decoding video'
                      : node.includes('save') || node.includes('selection')
                        ? 'Saving video'
                        : record.kind === 'selection'
                          ? 'Tracking the selected person'
                          : 'Applying character and source performance';
          }
      })().catch(() => {});
      for (;;) {
        await job.refresh();
        const status = job.status;
        record.state = status === 'succeeded' ? 'finalizing' : status;
        record.progress = progress;
        delete record.error;
        if (record.state === 'running' && !record.stage)
          record.stage =
            record.kind === 'selection'
              ? 'Tracking the selected person'
              : 'Applying character and source performance';
        if (status === 'succeeded') {
          record.stage = 'Checking the downloaded frames';
          await persist(record);
          await finalize(record, job);
        } else if (status === 'failed')
          record.error = job.error?.message || 'The native character job failed.';
        await persist(record);
        if (characterTerminal.has(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const job = handles.get(record.id);
      const failed = {
        ...record,
        state: job && characterTerminal.has(job.status) ? 'output_error' : 'connection_lost',
        error:
          error instanceof SyntaxError
            ? 'The video finished, but its embedded workflow metadata could not be verified. Keep this record and create a new take.'
            : error instanceof Error
              ? error.message
              : String(error),
      };
      await persist(failed);
      // Publish recovery only when persistence is complete; tracker cleanup starts synchronously.
      Object.assign(record, failed);
    } finally {
      controller.abort();
      active.delete(record.id);
      handles.delete(record.id);
      try {
        const queue = (await fetch(context.uiUrl + '/queue', {
          signal: AbortSignal.timeout(3000),
        }).then((r) => r.json())) as any;
        if (!queue.queue_running?.length && !queue.queue_pending?.length)
          await fetch(context.uiUrl + '/free', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unload_models: true, free_memory: true }),
            signal: AbortSignal.timeout(3000),
          });
      } catch {}
    }
  }
  async function submit(record: CharacterJob) {
    assertJobTarget(record, target);
    const job = await client.submit(await bind(record), { idempotencyKey: record.id });
    record.jobId = job.id;
    record.state = job.status === 'succeeded' ? 'finalizing' : job.status;
    await persist(record);
    void track(record, job);
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const record = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as CharacterJob;
      if (record.kind === 'selection')
        record.request = characterSelectionSchema.parse(record.request);
      else if (record.kind === 'replacement')
        record.request = characterRequestSchema.parse(record.request);
      else continue;
      jobs.set(record.id, record);
      if (characterBusy(record) && !(await targetMatches(record))) continue;
      if (record.jobId && characterBusy(record)) void track(record);
      else if (record.state === 'submitting') {
        record.state = 'submission_unknown';
        await persist(record);
      }
    } catch (error) {
      console.error('Could not read character job:', name, error);
    }
  }
  router.get('/', (_req, res) => {
    for (const record of jobs.values())
      if (record.jobId && characterBusy(record) && !active.has(record.id)) void track(record);
    res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.get('/:id', (req, res) => {
    const record = jobs.get(req.params.id);
    if (!record) return void res.status(404).json({ error: 'Character job not found.' });
    if (record.jobId && characterBusy(record) && !active.has(record.id)) void track(record);
    res.json(record);
  });
  router.get('/:id/preview', (req, res) => {
    const record = jobs.get(req.params.id);
    if (record?.kind !== 'selection' || !record.selection)
      return void res.status(404).json({ error: 'Selection preview is not ready.' });
    res.sendFile(`${record.id}-preview.mp4`, { root: folder, dotfiles: 'deny' });
  });
  router.get('/:id/source', (req, res) => {
    const record = jobs.get(req.params.id);
    if (record?.kind !== 'selection' || !record.selection)
      return void res.status(404).json({ error: 'Prepared source is not ready.' });
    res.sendFile(`${record.id}-source.mp4`, { root: folder, dotfiles: 'deny' });
  });
  router.get('/:id/mask', (req, res) => {
    const record = jobs.get(req.params.id);
    if (record?.kind !== 'selection' || !record.selection)
      return void res.status(404).json({ error: 'Tracked mask is not ready.' });
    res
      .attachment('aftertake-person-mask.mkv')
      .sendFile(`${record.id}-mask.mkv`, { root: folder, dotfiles: 'deny' });
  });
  async function create(kind: 'selection' | 'replacement', req: any, res: any) {
    const input =
      kind === 'selection'
        ? characterSelectionSchema.parse(req.body)
        : characterRequestSchema.parse(req.body);
    const admission = generationAdmission(
      req.get('Idempotency-Key'),
      { kind, request: input },
      jobs.values(),
    );
    if (admission.conflict) return void res.status(409).json({ error: generationKeyConflict });
    if (admission.existing)
      return void res
        .status(characterBusy(admission.existing) ? 202 : 200)
        .json(admission.existing);
    if (context.takeBusy() || [...jobs.values()].some(characterBusy))
      return void res.status(409).json({
        error:
          'Another generation is active. Finish or reconcile it before starting this character job.',
      });
    context.setAdmitting(true);
    try {
      if (!(await context.engine(kind === 'selection')).ready)
        return void res.status(409).json({
          error:
            'Install the character profile and start its local engine. Open the engine details for missing components.',
        });
      let request = input,
        selection: CharacterJob | undefined;
      if (kind === 'selection') {
        const r = input as CharacterSelectionRequest;
        request = characterSelectionSchema.parse({
          ...r,
          clip: await resolveClipAsset(r.clip, clips, 'source video'),
        });
      } else {
        const r = input as CharacterRequest;
        selection = await resolveSelection(r.selectionId);
        request = await resolveReferences(r);
      }
      const id = randomUUID(),
        workflow = await buildCharacterWorkflow(
          root,
          python,
          kind === 'selection'
            ? { id, kind, request: request as CharacterSelectionRequest }
            : {
                id,
                kind,
                request: request as CharacterRequest,
                selectionRequest: selection!.request as CharacterSelectionRequest,
              },
        );
      const record: CharacterJob = {
        jobTarget: target.binding,
        id,
        kind,
        request,
        workflow,
        ...admission.identity,
        state: 'submitting',
        progress: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.set(id, record);
      await persist(record);
      try {
        await submit(record);
        res.status(201).json(record);
      } catch (error) {
        record.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        record.error = error instanceof Error ? error.message : String(error);
        await persist(record);
        res.status(502).json({ error: record.error, character: record });
      }
    } finally {
      context.setAdmitting(false);
    }
  }
  router.post('/selections', (req, res) => create('selection', req, res));
  router.post('/replacements', (req, res) => create('replacement', req, res));
  router.post('/:id/cancel', async (req, res) => {
    const record = jobs.get(req.params.id);
    if (!record?.jobId || !characterBusy(record) || record.state === 'finalizing')
      return void res.status(409).json({ error: 'No active character job can be canceled.' });
    assertJobTarget(record, target);
    const job = handles.get(record.id) || (await client.jobs.get(record.jobId));
    await cancelAndRefresh(job);
    if (job.status !== 'succeeded') record.state = job.status;
    await persist(record);
    res.json(record);
  });
  router.post('/:id/reconcile', async (req, res) => {
    const record = jobs.get(req.params.id);
    if (
      !record ||
      !['submission_unknown', 'connection_lost', 'output_error'].includes(record.state)
    )
      return void res.status(409).json({ error: 'This character job does not need recovery.' });
    assertJobTarget(record, target);
    if (record.jobId) {
      void track(record);
      return void res.json(record);
    }
    if (
      context.takeBusy() ||
      [...jobs.values()].some((other) => other.id !== record.id && characterBusy(other))
    )
      return void res
        .status(409)
        .json({ error: 'Another generation is active. Rejoin this job after it finishes.' });
    context.setAdmitting(true);
    try {
      try {
        await submit(record);
        res.json(record);
      } catch (error) {
        record.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
        record.error = error instanceof Error ? error.message : String(error);
        await persist(record);
        res.status(502).json({ error: record.error, character: record });
      }
    } finally {
      context.setAdmitting(false);
    }
  });
  return { router, busy: () => [...jobs.values()].some(characterBusy) };
}
