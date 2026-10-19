import { GenerationCoordinator } from './generation-coordinator.js';
import express from 'express';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EngineJob } from './sdk-port.js';
import { createIsolatedClient } from './sdk-client.js';
import { handleRequestError, RequestError } from './http-errors.js';
import { loadWorkspaceEnvironment } from './environment.js';
import { cancelAndRefresh } from './job-cancel.js';
import {
  recipeSchema,
  projectSchema,
  renderDimensions,
  type Clip,
  type Engine,
  type Render,
} from '../src/domain.js';
import { buildWorkflow } from './workflow.js';
import { cuePreviewSettings } from '../src/cue-target.js';
import { createCueRuntime } from './cue-runtime.js';
import { resolveMediaRuntime } from './media-runtime.js';
import { evaluateEngineCompatibility } from './engine-compatibility.js';
import { submissionRejected } from './submission.js';
import { filmRouter } from './films.js';
import { templateRouter } from './templates.js';
import { resolveClipAsset, resolveRecipeAssets, RecipeAssetError } from './assets.js';
import { frameEditorRouter } from './frame-edits.js';
import { imageRouter } from './images.js';
import { inspectVideoMetadata } from './video-metadata.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { scriptDraftRouter } from './script-drafts.js';
import { characterRouter } from './characters.js';
import { videoRouter } from './videos.js';
import { computeRouter } from './compute.js';
import { subjectEffectsRouter } from './subject-effects.js';
import { finishingRouter } from './finishing.js';
import { recompositionRouter } from './recompositions.js';
import { resolveFinishingLutSettings } from './finishing-luts.js';
import { layerStackRouter } from './layer-stack.js';
import { computeFeatures, type ComputeFeature } from '../src/compute.js';
import { depthEffectsRouter } from './depth-effects.js';
import {
  assertJobTarget,
  canonicalNativeBaseUrl,
  createJobTarget,
  jobTargetIssue,
} from './job-target.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await loadWorkspaceEnvironment(root);
const sdkBaseUrl = canonicalNativeBaseUrl(process.env.COMFY_BASE_URL || 'http://127.0.0.1:8189');
const uiUrl = canonicalNativeBaseUrl(process.env.COMFY_UI_URL || 'http://127.0.0.1:8188');
const data = path.resolve(root, process.env.AFTERTAKE_DATA_DIR || '.data');
const clipDir = path.join(data, 'clips');
const renderDir = path.join(data, 'renders');
const outputDir = path.join(data, 'outputs');
const previewDir = path.join(data, 'previews');
await Promise.all(
  [clipDir, renderDir, outputDir, previewDir].map((dir) => mkdir(dir, { recursive: true })),
);
const pythonSuffix = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
const enginePython = path.join(root, '.runtime/venv', pythonSuffix);
const python = await resolveMediaRuntime({
  root,
  filmPython: path.join(root, '.runtime/film-venv', pythonSuffix),
  enginePython,
});
const cueRuntime = createCueRuntime({ root, enginePython, mediaPython: python });
const exec = promisify(execFile);
const renders = new Map<string, Render>();
const handles = new Map<string, EngineJob>();
const active = new Set<string>();
const generation = new GenerationCoordinator();
let previewBusy = false;
let thumbnailQueue = Promise.resolve();
const jobTarget = createJobTarget({
  sdkBaseUrl,
  uiBaseUrl: uiUrl,
  allowLegacyLoopback: true,
});
const client = await createIsolatedClient({
  baseUrl: sdkBaseUrl,
  apiKey: process.env.COMFY_API_KEY?.trim() || undefined,
  readRoots: [data],
  writeRoots: [data],
});
const terminal = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
// A browser's unresolved request must not be silently replayed into another
// studio process when its original durable record cannot be found.
const admissionScope = randomUUID();
generation.register('take', () =>
  [...renders.values()].some((render) => !terminal.has(render.state)),
);

const idPattern = /^[0-9a-f-]{36}$/;
const bundledTitles = Object.fromEntries(
  (
    JSON.parse(await readFile(path.join(root, 'examples/manifest.json'), 'utf8')).cases as {
      renderId: string;
      title: string;
    }[]
  ).map((item) => [item.renderId, item.title]),
);

async function persist(render: Render) {
  render.updatedAt = new Date().toISOString();
  const dest = path.join(renderDir, `${render.id}.json`);
  const temp = `${dest}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(render, null, 2));
    await rename(temp, dest);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
for (const filename of await readdir(renderDir)) {
  if (!filename.endsWith('.json')) continue;
  try {
    const render = JSON.parse(await readFile(path.join(renderDir, filename), 'utf8')) as Render;
    renders.set(render.id, render);
  } catch (error) {
    console.error(`Could not read saved render ${filename}:`, error);
  }
}
const healthCache = new Map<string, { until: number; value: Engine }>();
async function engine(pipeline: ComputeFeature = 'structure'): Promise<Engine> {
  if (!client.available)
    return {
      connected: false,
      ready: false,
      missing: [],
      message: 'The SDK connection stopped. Restart the studio to reconnect saved jobs.',
    };
  const cached = healthCache.get(pipeline);
  if (cached && cached.until > Date.now()) return cached.value;
  let result: Engine;
  try {
    const responses = await Promise.all([
      fetch(`${uiUrl}/object_info`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${uiUrl}/system_stats`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${sdkBaseUrl}/api/v2/health`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${uiUrl}/aftertake/runtime?profile=${encodeURIComponent(pipeline)}`, {
        signal: AbortSignal.timeout(15000),
      }).catch(() => null),
    ]);
    if (responses.slice(0, 3).some((r) => !r?.ok))
      throw new Error('ComfyUI or the v2 proxy is unavailable');
    const nodes: unknown = await responses[0].json();
    const stats = (await responses[1].json()) as {
      devices?: { name: string }[];
      system?: { os?: string };
    };
    const compatibility = evaluateEngineCompatibility({
      feature: pipeline,
      objectInfo: nodes,
      systemStats: stats,
      hardwareInfo: responses[3]?.ok ? await responses[3].json().catch(() => null) : null,
    });
    const missing = compatibility.missing;
    result = {
      connected: true,
      ready: compatibility.compatible,
      gpu: stats.devices?.[0]?.name,
      missing,
      message: missing.length
        ? 'Engine connected. Check the workflow hardware and required components.'
        : 'Local ComfyUI · open-weight workflow',
    };
  } catch {
    result = {
      connected: false,
      ready: false,
      missing: [],
      message:
        'Start ComfyUI and the Comfy v2 proxy to render. You can edit and export recipes now.',
    };
  }
  healthCache.set(pipeline, { until: Date.now() + 3000, value: result });
  return result;
}

async function targetMatches(render: Render) {
  const issue = jobTargetIssue(render, jobTarget);
  if (!issue) return true;
  const state = render.jobId ? 'connection_lost' : 'submission_unknown';
  if (render.state !== state || render.error !== issue) {
    const blocked = { ...render, state, error: issue };
    try {
      await persist(blocked);
      Object.assign(render, blocked);
    } catch {
      console.warn('Could not persist the blocked job target state. No engine request was made.');
    }
  }
  return false;
}
async function track(render: Render, initial?: EngineJob) {
  if (active.has(render.id)) return;
  if (jobTargetIssue(render, jobTarget)) {
    await targetMatches(render);
    return;
  }
  active.add(render.id);
  const eventsController = new AbortController();
  let streamedProgress: number | null = null;
  try {
    const job = initial || (await client.jobs.get(render.jobId!));
    handles.set(render.id, job);
    // Stream real sampler progress; polling remains authoritative for completion.
    void (async () => {
      for await (const event of job.events(eventsController.signal)) {
        if (event.kind === 'progress') {
          // Some local proxy events omit the current node and report 100% for
          // intermediate operations. An indeterminate indicator is honest here.
          streamedProgress = event.currentNode && event.value < 1 ? event.value : null;
          const stages: Record<string, string> = {
            '5': 'Reading direction',
            '6': 'Reading direction',
            '8': 'Reading source',
            '9': 'Tracking cue',
            '12': 'Encoding guides',
            '17': 'Sampling video',
            '19': 'Decoding frames',
            '20': 'Compositing',
            '21': 'Saving video',
            '22': 'Saving video',
            '30': 'Encoding refinement',
            '33': 'Refining video',
            '34': 'Decoding refined frames',
            '35': 'Blending boundaries',
            '45': 'Reading edited frame',
            '46': 'Conditioning appearance',
            '47': 'Reading edited frame',
            '48': 'Refining appearance',
          };
          const nodeClass = (render.workflow?.[event.currentNode || ''] as { class_type?: unknown })
            ?.class_type;
          render.stage =
            stages[event.currentNode || ''] ||
            (typeof nodeClass === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(nodeClass)
              ? nodeClass
              : 'Processing workflow');
        }
      }
    })().catch(() => {});
    while (true) {
      await job.refresh();
      const status = job.status;
      render.state = status === 'succeeded' ? 'finalizing' : status;
      render.progress = streamedProgress;
      delete render.error;
      if (status === 'succeeded') {
        render.stage = 'Downloading outputs';
        const output = job.getOutputs('21')[0];
        const raw = job.getOutputs('22')[0];
        const coarse = job.getOutputs('40')[0];
        const guide = job.getOutputs('44')[0];
        const focused = job.getOutputs('55')[0];
        if (!output) throw new Error('The workflow finished without a composite video.');
        await output.toFile(path.join(outputDir, `${render.id}.mp4`));
        // Export the graph embedded by the executing native nodes, including
        // resolved asset names, rather than the pre-upload placeholder graph.
        render.workflow = inspectVideoMetadata(
          await readFile(path.join(outputDir, `${render.id}.mp4`)),
          render.recipe,
        ).workflow;
        if (raw) await raw.toFile(path.join(outputDir, `${render.id}-raw.mp4`));
        if (coarse) await coarse.toFile(path.join(outputDir, `${render.id}-coarse.mp4`));
        if (guide) await guide.toFile(path.join(outputDir, `${render.id}-guide.mp4`));
        if (focused) await focused.toFile(path.join(outputDir, `${render.id}-focused.mp4`));
        render.output = `/outputs/${render.id}.mp4`;
        if (raw) render.rawOutput = `/outputs/${render.id}-raw.mp4`;
        if (coarse) render.coarseOutput = `/outputs/${render.id}-coarse.mp4`;
        if (guide) render.guideOutput = `/outputs/${render.id}-guide.mp4`;
        if (focused) render.focusOutput = `/outputs/${render.id}-focused.mp4`;
        render.progress = 1;
        render.stage = 'Complete';
        render.state = 'succeeded';
      } else if (status === 'failed') {
        render.error = JSON.stringify(job.error);
      }
      if (terminal.has(status)) {
        // Release idle caches after cancellation/failure as well as success,
        // so browser video decoders can recover their VRAM on 16 GB cards.
        try {
          const queue = (await fetch(`${uiUrl}/queue`, { signal: AbortSignal.timeout(3000) }).then(
            (r) => r.json(),
          )) as { queue_running?: unknown[]; queue_pending?: unknown[] };
          if (queue.queue_running?.length === 0 && queue.queue_pending?.length === 0) {
            await fetch(`${uiUrl}/free`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ unload_models: true, free_memory: true }),
              signal: AbortSignal.timeout(3000),
            });
          }
        } catch (error) {
          console.warn('Could not release idle GPU cache:', error);
        }
      }
      await persist(render);
      if (terminal.has(status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    // A poll failure says nothing about whether GPU work stopped. Retain the id.
    const job = handles.get(render.id);
    const failed = {
      ...render,
      state: job && terminal.has(job.status) ? 'output_error' : 'connection_lost',
      error: error instanceof Error ? error.message : String(error),
    };
    await persist(failed);
    // Publish recovery only when persistence is complete; cleanup below is synchronous.
    Object.assign(render, failed);
  } finally {
    eventsController.abort();
    handles.delete(render.id);
    active.delete(render.id);
  }
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const hostname = req.headers.host?.split(':')[0];
  if (!hostname || !['127.0.0.1', 'localhost'].includes(hostname))
    return void res.status(403).json({ error: 'Use the local studio address.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`)
      return void res.status(403).json({ error: 'Cross-origin writes are disabled.' });
  }
  next();
});
app.use('/media', express.static(clipDir, { dotfiles: 'deny' }));
app.use('/outputs', express.static(outputDir, { dotfiles: 'deny' }));
app.get('/previews/:name', (req, res) => {
  if (!/^[a-f0-9]{64}\.png$/.test(req.params.name)) return void res.sendStatus(404);
  res.sendFile(req.params.name, { root: previewDir, dotfiles: 'deny' });
});
app.get('/api/engine', async (req, res) => {
  const pipeline = computeFeatures.find((value) => value === req.query.pipeline) || 'structure';
  res.json(await engine(pipeline));
});
app.get('/api/workspace', (_req, res) => {
  res.json({
    generationProtocol: 1,
    compositeRegionProtocol: 1,
    admissionScope,
    textVideoProtocol: 1,
    examples: process.env.AFTERTAKE_EXAMPLES === '1',
    exampleCount: Number(process.env.AFTERTAKE_EXAMPLE_COUNT || 3),
    exampleNames: { ...bundledTitles, ...JSON.parse(process.env.AFTERTAKE_EXAMPLE_TITLES || '{}') },
    featuredRenderId: process.env.AFTERTAKE_FEATURED_RENDER || null,
  });
});
app.get('/api/thumbnails/:id', async (req, res) => {
  if (!idPattern.test(req.params.id)) return void res.sendStatus(404);
  const clip = JSON.parse(
    await readFile(path.join(clipDir, `${req.params.id}.json`), 'utf8'),
  ) as Clip;
  const requested = Number(req.query.time || 0);
  if (!Number.isFinite(requested)) return void res.sendStatus(400);
  const time =
    clip.kind === 'image'
      ? 0
      : Math.round(Math.max(0, Math.min(clip.duration - 0.05, requested)) * 24) / 24;
  const key = createHash('sha256').update(`thumbnail/1:${clip.sha256}:${time}`).digest('hex');
  const filename = `${key}.jpg`;
  const task = thumbnailQueue.then(async () => {
    if (await stat(path.join(previewDir, filename)).catch(() => null)) return;
    if (!(await stat(python).catch(() => null))) {
      throw new RequestError('Install the Python runtime to generate thumbnails.', 409);
    }
    await exec(
      python,
      [
        path.join(root, 'scripts/thumbnail.py'),
        path.join(clipDir, path.basename(clip.url)),
        path.join(previewDir, filename),
        String(time),
      ],
      { timeout: 30000 },
    );
  });
  thumbnailQueue = task.catch(() => {});
  await task;
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(filename, { root: previewDir, dotfiles: 'deny' });
});
app.get('/api/clips', async (_req, res) => {
  const clips: Clip[] = [];
  for (const file of await readdir(clipDir)) {
    if (file.endsWith('.json'))
      clips.push(JSON.parse(await readFile(path.join(clipDir, file), 'utf8')));
  }
  res.json(clips);
});
app.get('/api/clips/:id/frame', async (req, res) => {
  if (!idPattern.test(req.params.id)) return void res.sendStatus(404);
  if (!(await stat(python).catch(() => null)))
    return void res
      .status(409)
      .json({ error: 'Install the Python runtime to export a source frame.' });
  const clip = JSON.parse(
    await readFile(path.join(clipDir, `${req.params.id}.json`), 'utf8'),
  ) as Clip;
  const requested = Number(req.query.time || 0);
  if (!Number.isFinite(requested))
    return void res.status(400).json({ error: 'Choose a valid source time.' });
  const time = clip.kind === 'image' ? 0 : Math.max(0, Math.min(clip.duration - 0.05, requested));
  const key = createHash('sha256').update(`source-frame/1:${clip.sha256}:${time}`).digest('hex');
  const filename = `frame-${key}.png`,
    target = path.join(previewDir, filename);
  const task = thumbnailQueue.then(async () => {
    if (await stat(target).catch(() => null)) return;
    await exec(
      python,
      [
        path.join(root, 'scripts/extract-frame.py'),
        path.join(clipDir, path.basename(clip.url)),
        target,
        String(time),
      ],
      { timeout: 30000 },
    );
  });
  thumbnailQueue = task.catch(() => {});
  await task;
  res.attachment('aftertake-starting-frame.png').sendFile(filename, { root: previewDir });
});
app.post(
  '/api/clips',
  express.raw({ type: 'application/octet-stream', limit: '100mb' }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      return void res.status(400).json({ error: 'Choose a video file.' });
    if (!(await stat(python).catch(() => null)))
      return void res.status(409).json({
        error:
          'Install the Python runtime before importing new clips. You can explore the included examples now.',
      });
    const name = path.basename(String(req.query.name || 'source.mp4')).slice(0, 200);
    const extension = path.extname(name).toLowerCase();
    const image = ['.png', '.jpg', '.jpeg', '.webp'].includes(extension);
    if (!image && !['.mp4', '.mov', '.webm', '.mkv', '.m4v'].includes(extension))
      return void res
        .status(400)
        .json({ error: 'Use an MP4, MOV, WebM or MKV video, or a PNG, JPEG or WebP image.' });
    const id = randomUUID();
    const filename = `${id}${extension}`;
    const dest = path.join(clipDir, filename);
    await writeFile(dest, req.body);
    try {
      const normalized = path.join(clipDir, `${id}.normalized.png`);
      const { stdout } = await exec(
        python,
        image
          ? [path.join(root, 'scripts/import-image.py'), dest, normalized]
          : [path.join(root, 'scripts/probe.py'), dest],
        { timeout: 30000 },
      );
      const meta = JSON.parse(stdout);
      if (meta.duration < 1) throw new Error('Use a clip at least one second long.');
      if (image) {
        await unlink(dest);
        await rename(normalized, path.join(clipDir, `${id}.png`));
      }
      const bytes = image ? await readFile(path.join(clipDir, `${id}.png`)) : req.body;
      const clip: Clip = {
        id,
        name,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(image ? { originalSha256: createHash('sha256').update(req.body).digest('hex') } : {}),
        ...meta,
        url: `/media/${image ? `${id}.png` : filename}`,
      };
      await writeFile(path.join(clipDir, `${id}.json`), JSON.stringify(clip, null, 2));
      res.status(201).json(clip);
    } catch {
      await Promise.all(
        [dest, path.join(clipDir, `${id}.png`), path.join(clipDir, `${id}.normalized.png`)].map(
          (file) => unlink(file).catch(() => {}),
        ),
      );
      res.status(422).json({
        error:
          'Could not read this source. Use a video from 1 second to 10 minutes, up to 4K, or a still photo up to 64 MP and 16,384 pixels per side. Photos are resized to fit 4K.',
      });
    }
  },
);
app.use(express.json({ limit: '2mb' }));
app.use('/api/compute', computeRouter({ localEngine: engine }));
app.use('/api/script-drafts', await scriptDraftRouter({ root, data }));
const frameEdits = await frameEditorRouter({
  target: jobTarget,
  data,
  client,
  uiUrl,
  engine: () => engine('frame-edit'),
  ...generation.forWorker('frameEdits'),
});
generation.register('frameEdits', frameEdits.busy);
app.use('/api/frame-edits', frameEdits.router);
const images = await imageRouter({
  target: jobTarget,
  data,
  client,
  uiUrl,
  engine: () => engine('image-gen'),
  ...generation.forWorker('images'),
});
generation.register('images', images.busy);
app.use('/api/images', images.router);
const characters = await characterRouter({
  target: jobTarget,
  root,
  data,
  python,
  client,
  uiUrl,
  engine: (selection) => engine(selection ? 'character-selection' : 'character-swap'),
  ...generation.forWorker('characters'),
});
generation.register('characters', characters.busy);
app.use('/api/characters', characters.router);
app.use(
  '/api/subject-effects',
  await subjectEffectsRouter({
    root,
    data,
    python,
    resolveSelection: characters.resolveReviewedSelection,
  }),
);
const finishing = await finishingRouter({ root, data, python });
app.use('/api/finishing', finishing.router);
const recompositions = await recompositionRouter({
  root,
  data,
  python: () => cueRuntime.ready(),
  renders,
  resolveClipAsset: (clip) => resolveClipAsset(clip, clipDir, 'source'),
  onRender: persist,
});
app.use('/api/recompositions', recompositions.router);
const layerStacks = await layerStackRouter({
  root,
  data,
  python,
  resolveFinishingSettings: (settings) => resolveFinishingLutSettings(data, settings),
});
app.use('/api/layer-stacks', layerStacks.router);
const depthEffects = await depthEffectsRouter({
  target: jobTarget,
  root,
  data,
  python,
  client,
  engine: () => engine('depth'),
  ...generation.forWorker('depthEffects'),
});
generation.register('depthEffects', depthEffects.busy);
app.use('/api/depth-effects', depthEffects.router);
const videos = await videoRouter({
  target: jobTarget,
  root,
  data,
  python,
  client,
  uiUrl,
  engine: () => engine('text-video'),
  ...generation.forWorker('videos'),
});
generation.register('videos', videos.busy);
app.use('/api/videos', videos.router);
app.use('/api/templates', await templateRouter(root, data, renders));
app.use('/api/films', await filmRouter(root, data, python, renders));
app.post('/api/cue-preview', async (req, res) => {
  if (characters.busy() || videos.busy() || depthEffects.busy())
    return void res.status(409).json({
      error: 'Wait for the character job to finish before computing another motion preview.',
    });
  if (previewBusy)
    return void res
      .status(409)
      .json({ error: 'A motion preview is already being computed. Try again in a moment.' });
  previewBusy = true;
  try {
    const recipe = projectSchema.parse(req.body);
    const clip = JSON.parse(
      await readFile(path.join(clipDir, `${recipe.clip.id}.json`), 'utf8'),
    ) as Clip;
    if (clip.sha256 !== recipe.clip.sha256)
      throw new RequestError('The source clip does not match this recipe.');
    const target = req.body.previewTarget ?? 'generation';
    if (target !== 'generation' && target !== 'composite')
      throw new RequestError('Choose the generation context or final blend area for this preview.');
    if (target === 'composite' && !recipe.compositeRegion)
      throw new RequestError('Enable a separate final blend area before previewing it.');
    const settings = cuePreviewSettings({ ...recipe, clip }, target);
    if (!settings.cue.strokes.some((stroke) => stroke.mode !== 'erase'))
      throw new RequestError('Paint the selected area before previewing its motion.');
    const { clip: _source, cue: _cue, trimStart: _trim, ...dims } = settings;
    // Version the cached pixels when tracking changes, keeping CPU previews
    // aligned with the masks computed by the current generation nodes.
    const key = createHash('sha256')
      .update('cue-preview/2:')
      .update(JSON.stringify(settings))
      .digest('hex');
    const existing = await stat(path.join(previewDir, `${key}.png`)).catch(() => null);
    if (!existing) {
      await writeFile(path.join(previewDir, `${key}.json`), JSON.stringify(settings));
      const cuePython = await cueRuntime.ready();
      await exec(cuePython, [path.join(root, 'scripts/preview-cue.py'), key], { timeout: 60000 });
    }
    res.json({ url: `/previews/${key}.png`, ...dims });
  } finally {
    previewBusy = false;
  }
});
app.get('/api/renders', (_req, res) => {
  res.json([...renders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});
app.get('/api/renders/:id', (req, res) => {
  const render = renders.get(req.params.id);
  if (!render) return void res.status(404).json({ error: 'Render not found.' });
  if (render.jobId && !terminal.has(render.state) && !active.has(render.id)) void track(render);
  res.json(render);
});
app.post('/api/workflow', (req, res) => {
  res.json(buildWorkflow(recipeSchema.parse(req.body)));
});
async function submitTake(render: Render) {
  assertJobTarget(render, jobTarget);
  if (!render.workflow)
    throw Error(
      'The original generation workflow is missing. Keep this record for review and create a deliberate new take.',
    );
  const recipe = render.recipe,
    storedClip = recipe.clip;
  const wf = client.workflows.fromJson(structuredClone(render.workflow));
  wf.setInput(
    '8',
    'filename',
    client.assets.fromFile(path.join(clipDir, path.basename(storedClip.url))),
  );
  if (recipe.pipeline === 'inpaint' && recipe.editReference) {
    const image = client.assets.fromFile(
      path.join(clipDir, path.basename(recipe.editReference.url)),
    );
    wf.setInput('45', 'filename', image);
    if (recipe.quality === 'final') wf.setInput('47', 'filename', image);
  }
  if (recipe.pipeline === 'cinema' && recipe.endFrame)
    wf.setInput(
      '45',
      'filename',
      client.assets.fromFile(path.join(clipDir, path.basename(recipe.endFrame.url))),
    );
  if (recipe.pipeline === 'motion-transfer' && recipe.transfer?.reference)
    wf.setInput(
      '45',
      'filename',
      client.assets.fromFile(path.join(clipDir, path.basename(recipe.transfer.reference.url))),
    );
  if (recipe.pipeline === 'motion-transfer' && recipe.transfer?.finish) {
    wf.setInput(
      '19',
      'filename',
      client.assets.fromFile(
        path.join(clipDir, path.basename(recipe.transfer.finish.generation.url)),
      ),
    );
    wf.setInput(
      '49',
      'filename',
      client.assets.fromFile(path.join(clipDir, path.basename(recipe.transfer.finish.matte.url))),
    );
  }
  const job = await client.submit(wf, { idempotencyKey: render.id });
  render.jobId = job.id;
  render.state = job.status === 'succeeded' ? 'finalizing' : job.status;
  await persist(render);
  void track(render, job);
}
app.post('/api/renders', async (req, res) => {
  const input = recipeSchema.parse(req.body),
    admission = generationAdmission(req.get('Idempotency-Key'), input, renders.values());
  if (admission.conflict) return void res.status(409).json({ error: generationKeyConflict });
  if (admission.existing)
    return void res
      .status(terminal.has(admission.existing.state) ? 200 : 202)
      .json(admission.existing);
  const requestedScope = req.get('X-Aftertake-Admission-Scope');
  if (requestedScope !== undefined && requestedScope !== admissionScope)
    return void res.status(409).json({
      code: 'admission_scope_changed',
      error: 'The studio restarted. Check the original request before starting another take.',
    });
  if (generation.admitting)
    return void res.status(409).json({ error: 'A take is already being submitted.' });
  if (generation.busy('take') || [...renders.values()].some((r) => !terminal.has(r.state)))
    return void res.status(409).json({
      error:
        'A generation is already active. Let it finish, cancel it, or reconcile its submission before starting another.',
    });
  generation.admitting = true;
  try {
    let recipe = input;
    if (
      !(
        await engine(
          recipe.pipeline === 'cinema' && recipe.cinema?.guidance === 'tracks'
            ? 'motion'
            : recipe.pipeline,
        )
      ).ready
    )
      return void res
        .status(409)
        .json({ error: 'The selected local workflow is not ready. Check the engine panel.' });
    try {
      recipe = await resolveRecipeAssets(recipe, clipDir);
    } catch (error) {
      if (error instanceof RecipeAssetError)
        return void res.status(409).json({ error: error.message });
      throw error;
    }
    const render: Render = {
      jobTarget: jobTarget.binding,
      id: randomUUID(),
      ...admission.identity,
      recipe,
      state: 'submitting',
      progress: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    render.workflow = buildWorkflow(recipe);
    await persist(render);
    renders.set(render.id, render);
    try {
      await submitTake(render);
      res.status(201).json(render);
    } catch (error) {
      // A submit may reach the server before a network failure. Never retry it blindly.
      render.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
      render.error = error instanceof Error ? error.message : String(error);
      await persist(render);
      res.status(502).json({ error: render.error, render });
    }
  } finally {
    generation.admitting = false;
  }
});
app.post('/api/renders/:id/cancel', async (req, res) => {
  const render = renders.get(req.params.id);
  if (!render?.jobId || terminal.has(render.state) || render.state === 'finalizing')
    return void res.status(409).json({ error: 'No active take can be canceled.' });
  assertJobTarget(render, jobTarget);
  const job = handles.get(render.id) || (await client.jobs.get(render.jobId));
  await cancelAndRefresh(job);
  if (job.status !== 'succeeded') render.state = job.status;
  await persist(render);
  res.json(render);
});
app.post('/api/renders/:id/reconcile', async (req, res) => {
  const render = renders.get(req.params.id);
  if (!render || !['submission_unknown', 'connection_lost', 'output_error'].includes(render.state))
    return void res.status(409).json({ error: 'This take does not need recovery.' });
  assertJobTarget(render, jobTarget);
  if (render.jobId) {
    void track(render);
    return void res.json(render);
  }
  if (
    generation.busy('take') ||
    [...renders.values()].some((other) => other.id !== render.id && !terminal.has(other.state))
  )
    return void res
      .status(409)
      .json({ error: 'Another generation is active. Rejoin this same take after it finishes.' });
  generation.admitting = true;
  try {
    // Preserve the original graph and SDK key after an unobserved admission.
    render.recipe = await resolveRecipeAssets(render.recipe, clipDir);
    try {
      await submitTake(render);
      res.json(render);
    } catch (error) {
      render.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
      render.error = error instanceof Error ? error.message : String(error);
      await persist(render);
      res.status(502).json({ error: render.error, render });
    }
  } finally {
    generation.admitting = false;
  }
});

const httpServer = createServer(app);
httpServer.once('close', () => void client.close());
if (process.argv.includes('--production')) app.use(express.static(path.join(root, 'dist')));
else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    server: { middlewareMode: true, ws: { server: httpServer } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
app.use(handleRequestError);
const port = Number(process.env.PORT || 4310);
httpServer.listen(port, '127.0.0.1', () =>
  console.log(`Aftertake studio: http://127.0.0.1:${port}`),
);
for (const render of renders.values()) {
  if (!terminal.has(render.state) && !(await targetMatches(render))) continue;
  if (render.jobId && !terminal.has(render.state)) void track(render);
  else if (render.state === 'submitting') {
    render.state = 'submission_unknown';
    await persist(render);
  }
}
