import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  clipSchema,
  displayDimensions,
  recipeSchema,
  renderDimensions,
  supportsCompositeRegion,
  type Clip,
  type Render,
} from '../src/domain.js';
import {
  recompositionBusy,
  recompositionJobSchema,
  recompositionProvenanceSchema,
  recompositionReceiptSchema,
  recompositionRecipe,
  recompositionRecipeContent,
  recompositionRequestSchema,
  sameRecompositionGeneration,
  type RecompositionJob,
  type RecompositionProvenance,
  type RecompositionRequest,
} from '../src/recomposition.js';
import { contentDigest } from './edit-plan.js';
import { finishingWorker, type FinishingWorker } from './finishing.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { RequestError } from './http-errors.js';
import { inspectVideoMetadata } from './video-metadata.js';

export type RecompositionWorker = FinishingWorker;
type RecomposedRender = Render & { recomposition?: RecompositionProvenance };
const processor = 'aftertake-cpu-recomposition/1' as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const rawUrl = /^\/outputs\/([a-f0-9-]{36})-raw\.mp4$/;

async function hashFile(file: string) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

/** A separate CPU queue: this never submits a Comfy graph or acquires a GPU lease. */
export async function recompositionRouter(context: {
  root: string;
  data: string;
  python: string | (() => Promise<string>);
  renders: Map<string, Render>;
  resolveClipAsset?: (clip: Clip) => Promise<Clip>;
  worker?: RecompositionWorker;
  onRender?: (render: Render) => void | Promise<void>;
}) {
  const router = Router(),
    folder = path.join(context.data, 'recompositions'),
    outputs = path.join(context.data, 'outputs'),
    renderFolder = path.join(context.data, 'renders'),
    clips = path.join(context.data, 'clips'),
    script = path.join(context.root, 'scripts', 'recompose-take.py'),
    jobs = new Map<string, RecompositionJob>(),
    controllers = new Map<string, AbortController>();
  for (const directory of [folder, outputs, renderFolder])
    await mkdir(directory, { recursive: true });
  let operation: string | undefined,
    tail: Promise<unknown> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  async function atomicJson(file: string, value: unknown) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2));
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function persist(job: RecompositionJob) {
    job.updatedAt = new Date().toISOString();
    await atomicJson(path.join(folder, `${job.id}.json`), job);
  }
  async function removePartial(id: string) {
    // Only files reserved by this durable CPU job are eligible for cleanup.
    const existing = context.renders.get(id) as RecomposedRender | undefined;
    if (existing && existing.recomposition?.jobId !== id) return;
    await unlink(path.join(outputs, `${id}.mp4`)).catch(() => {});
    await unlink(path.join(renderFolder, `${id}.json`)).catch(() => {});
    if (existing?.recomposition?.jobId === id) context.renders.delete(id);
  }
  for (const file of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    try {
      const job = recompositionJobSchema.parse(
        JSON.parse(await readFile(path.join(folder, file), 'utf8')),
      );
      if (file !== `${job.id}.json` || job.requestDigest !== contentDigest(job.request)) continue;
      if (recompositionBusy(job)) {
        await removePartial(job.id);
        job.state = 'interrupted';
        job.error =
          'The CPU blend stopped when the server restarted. Review this attempt before starting a new blend.';
        delete job.renderId;
        delete job.receipt;
        await persist(job);
      }
      jobs.set(job.id, job);
    } catch {
      console.warn('An invalid saved CPU blend record was skipped.');
    }
  }

  function getJob(id: string) {
    const job = jobs.get(id);
    if (!job) throw new RequestError('That CPU blend was not found.', 404);
    return job;
  }
  async function sourcePath(recipe: RecompositionJob['originalRecipe']) {
    try {
      const bound = context.resolveClipAsset
        ? await context.resolveClipAsset(recipe.clip)
        : recipe.clip;
      const stored = clipSchema.parse(
        JSON.parse(await readFile(path.join(clips, `${bound.id}.json`), 'utf8')),
      );
      // Metadata is never allowed to supply arbitrary paths, URLs, query strings or shares.
      if (
        stored.id !== bound.id ||
        stored.sha256 !== recipe.clip.sha256 ||
        stored.kind === 'image' ||
        !/^\/media\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,8}$/.test(stored.url)
      )
        throw new Error('Invalid source binding.');
      const source = path.join(clips, path.basename(stored.url));
      if ((await hashFile(source)) !== recipe.clip.sha256) throw new Error('Changed source.');
      return source;
    } catch {
      throw new RequestError(
        'The original source changed or is missing. Import its original file before blending this take.',
        409,
      );
    }
  }
  async function resolve(request: RecompositionRequest) {
    const parent = context.renders.get(request.renderId) as RecomposedRender | undefined;
    if (!parent) throw new RequestError('That saved take was not found.', 404);
    if (parent.state !== 'succeeded' || !parent.output || !supportsCompositeRegion(parent.recipe))
      throw new RequestError(
        'Choose a successful saved region VFX or masked edit to blend on CPU.',
        409,
      );
    const match = rawUrl.exec(parent.rawOutput || '');
    if (!match || !uuid.test(match[1]))
      throw new RequestError(
        'This take has no saved raw generation. Generate a new take with raw output before using CPU blend.',
        409,
      );
    const saved = parent.recomposition
        ? recompositionProvenanceSchema.parse(parent.recomposition)
        : undefined,
      workingRecipe = recipeSchema.parse(structuredClone(parent.recipe)),
      newRecipe = recompositionRecipe(recipeSchema.parse(structuredClone(parent.recipe)), request),
      originalGenerationWorkflow = structuredClone(
        saved?.originalGenerationWorkflow || parent.workflow,
      ),
      raw = path.join(outputs, `${match[1]}-raw.mp4`),
      source = await sourcePath(workingRecipe);
    let originalRecipe: RecompositionJob['originalRecipe'];
    let rawSha256: string;
    try {
      const bytes = await readFile(raw),
        metadata = inspectVideoMetadata(bytes);
      originalRecipe = metadata.recipe;
      rawSha256 = createHash('sha256').update(bytes).digest('hex');
      if (
        !originalGenerationWorkflow ||
        contentDigest(metadata.workflow) !== contentDigest(originalGenerationWorkflow) ||
        !sameRecompositionGeneration(originalRecipe, newRecipe) ||
        (!saved &&
          recompositionRecipeContent(originalRecipe, true) !==
            recompositionRecipeContent(workingRecipe, true)) ||
        (saved &&
          (rawSha256 !== saved.rawSha256 ||
            saved.sourceSha256 !== originalRecipe.clip.sha256 ||
            contentDigest(saved.originalRecipe) !== contentDigest(originalRecipe)))
      )
        throw new Error('The saved generation provenance changed.');
    } catch {
      throw new RequestError(
        'This historical or changed raw take has no matching executed generation metadata. Keep the original raw output and workflow, or generate a new supported take.',
        409,
      );
    }
    return {
      source,
      raw,
      rawOutput: parent.rawOutput!,
      rawSha256,
      originalRecipe,
      newRecipe,
      originalGenerationWorkflow: originalGenerationWorkflow!,
      generationRenderId: saved?.generationRenderId || parent.id,
    };
  }
  async function preflight() {
    try {
      const worker =
        context.worker ||
        finishingWorker(
          typeof context.python === 'function' ? await context.python() : context.python,
        );
      await worker([script, '--check'], { timeout: 20_000 });
      return worker;
    } catch {
      throw new RequestError(
        'CPU blend needs Python, PyTorch CPU transforms, OpenCV, Kornia, PyAV, Pillow and FFmpeg. Run Aftertake setup before trying again.',
        503,
      );
    }
  }

  async function compose(
    job: RecompositionJob,
    source: string,
    raw: string,
    controller: AbortController,
    worker: RecompositionWorker,
  ) {
    const token = randomUUID(),
      output = path.join(folder, `${job.id}.${token}.mp4`),
      work = path.join(folder, `${job.id}.${token}.work.json`),
      receipt = path.join(folder, `${job.id}.${token}.receipt.json`),
      target = path.join(outputs, `${job.id}.mp4`);
    let committed = false;
    try {
      if (controller.signal.aborted) throw new Error('Canceled.');
      job.state = 'running';
      await persist(job);
      const d = renderDimensions(job.originalRecipe),
        display = displayDimensions(job.originalRecipe);
      await atomicJson(work, {
        format: 'aftertake-recompose-work/1',
        source,
        raw,
        output,
        receipt,
        expected: { sourceSha256: job.sourceSha256, rawSha256: job.rawSha256 },
        originalRecipe: job.originalRecipe,
        newRecipe: job.newRecipe,
        dimensions: {
          width: d.width,
          height: d.height,
          frames: d.frames,
          fps: d.fps,
          displayWidth: display.width,
          displayHeight: display.height,
        },
        originalGenerationWorkflow: job.originalGenerationWorkflow,
      });
      await worker([script, work], { signal: controller.signal, timeout: 60 * 60_000 });
      if (controller.signal.aborted) throw new Error('Canceled.');
      const result = recompositionReceiptSchema.parse(JSON.parse(await readFile(receipt, 'utf8')));
      if (
        result.sourceSha256 !== job.sourceSha256 ||
        result.rawSha256 !== job.rawSha256 ||
        result.outputSha256 !== (await hashFile(output)) ||
        result.width !== display.width ||
        result.height !== display.height ||
        result.frames !== d.frames ||
        result.fps !== d.fps ||
        contentDigest(result.originalRecipe) !== contentDigest(job.originalRecipe) ||
        contentDigest(result.newRecipe) !== contentDigest(job.newRecipe) ||
        contentDigest(result.originalGenerationWorkflow) !==
          contentDigest(job.originalGenerationWorkflow) ||
        (job.newRecipe.clip.hasAudio !== undefined &&
          result.hasAudio !== job.newRecipe.clip.hasAudio)
      )
        throw new Error('The CPU blend receipt did not match its inputs.');
      await exclusive(async () => {
        if (
          controller.signal.aborted ||
          (await hashFile(source)) !== job.sourceSha256 ||
          (await hashFile(raw)) !== job.rawSha256
        )
          throw new Error('The inputs changed or the operation was canceled.');
        const now = new Date().toISOString();
        const render: RecomposedRender = {
          id: job.id,
          recipe: structuredClone(job.newRecipe),
          state: 'succeeded',
          progress: 1,
          stage: 'Recomposed on CPU',
          createdAt: now,
          updatedAt: now,
          output: `/outputs/${job.id}.mp4`,
          rawOutput: job.rawOutput,
          recomposition: {
            format: 'aftertake-recomposition/1',
            jobId: job.id,
            sourceRenderId: job.sourceRenderId,
            generationRenderId: job.generationRenderId,
            sourceSha256: job.sourceSha256,
            rawSha256: job.rawSha256,
            originalRecipe: structuredClone(job.originalRecipe),
            originalGenerationWorkflow: structuredClone(job.originalGenerationWorkflow),
            receipt: result,
          },
        };
        // The original take and raw file are never overwritten. Publication and
        // cancellation serialize here; a canceled worker cannot publish a take.
        await rename(output, target);
        await atomicJson(path.join(renderFolder, `${job.id}.json`), render);
        const completed: RecompositionJob = {
          ...job,
          state: 'succeeded',
          renderId: render.id,
          receipt: result,
        };
        delete completed.error;
        await persist(completed);
        context.renders.set(render.id, render);
        Object.assign(job, completed);
        delete job.error;
        committed = true;
      });
      if (context.onRender) {
        try {
          await context.onRender(context.renders.get(job.id)!);
        } catch {
          console.warn(
            'A CPU blend notification could not be delivered. The saved take is available.',
          );
        }
      }
    } catch {
      if (!committed) {
        await removePartial(job.id);
        delete job.renderId;
        delete job.receipt;
        job.state = controller.signal.aborted ? 'canceled' : 'failed';
        job.error = controller.signal.aborted
          ? 'The CPU blend was canceled.'
          : 'CPU blend could not complete. Check the original source and raw take, then review the blend settings before trying again.';
        await persist(job).catch(() =>
          console.warn('Could not persist the terminal CPU blend state.'),
        );
      }
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
  router.get('/by-key/:key', (req, res) => {
    generationAdmission(req.params.key, {}, []);
    const job = [...jobs.values()].find((candidate) => candidate.requestKey === req.params.key);
    if (!job) throw new RequestError('That CPU blend admission was not found.', 404);
    res.json(job);
  });
  router.post('/', async (req, res) => {
    const input = recompositionRequestSchema.parse(req.body),
      key = req.get('Idempotency-Key');
    const result = await exclusive(async () => {
      const admission = generationAdmission(key, input, jobs.values());
      if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
      if (admission.existing) return { job: admission.existing, existing: true };
      if (operation) throw new RequestError('Wait for the current CPU blend to finish.', 409);
      const bound = await resolve(input);
      const worker = await preflight();
      const id = randomUUID(),
        now = new Date().toISOString();
      const job: RecompositionJob = {
        id,
        request: input,
        sourceRenderId: input.renderId,
        generationRenderId: bound.generationRenderId,
        sourceSha256: bound.originalRecipe.clip.sha256,
        rawSha256: bound.rawSha256,
        rawOutput: bound.rawOutput,
        originalRecipe: bound.originalRecipe,
        newRecipe: bound.newRecipe,
        originalGenerationWorkflow: bound.originalGenerationWorkflow,
        state: 'queued',
        createdAt: now,
        updatedAt: now,
        ...admission.identity,
        requestDigest: contentDigest(input),
      };
      recompositionJobSchema.parse(job);
      await persist(job);
      jobs.set(id, job);
      operation = id;
      const controller = new AbortController();
      controllers.set(id, controller);
      void compose(job, bound.source, bound.raw, controller, worker);
      return { job, existing: false };
    });
    res.status(result.existing ? 200 : 202).json(result.job);
  });
  router.get('/:id/status', (req, res) => res.json(getJob(req.params.id)));
  router.post('/:id/cancel', async (req, res) => {
    const job = getJob(req.params.id);
    await exclusive(async () => {
      if (!recompositionBusy(job)) return;
      const controller = controllers.get(job.id);
      if (!controller)
        throw new RequestError('This CPU blend is not controlled by the current server.', 409);
      job.state = 'canceling';
      await persist(job);
      controller.abort();
    });
    res.status(recompositionBusy(job) ? 202 : 200).json(job);
  });
  router.get('/:id', (req, res) => res.json(getJob(req.params.id)));
  return { router, busy: () => operation !== undefined };
}
