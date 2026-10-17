import express from 'express';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Comfy, type Job } from '@comfyorg/sdk';
import { ZodError } from 'zod';
import { recipeSchema, renderDimensions, type Clip, type Engine, type Render } from '../src/domain.js';
import { buildWorkflow, requirements } from './workflow.js';
import { submissionRejected } from './submission.js';
import { filmRouter } from './films.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile && await stat(path.join(root, '.env')).then(() => process.loadEnvFile('.env')).catch(() => {});
process.env.COMFY_BASE_URL ||= 'http://127.0.0.1:8189';
const uiUrl = process.env.COMFY_UI_URL || 'http://127.0.0.1:8188';
const data = path.resolve(root, process.env.AFTERTAKE_DATA_DIR || '.data');
const clipDir = path.join(data, 'clips');
const renderDir = path.join(data, 'renders');
const outputDir = path.join(data, 'outputs');
const previewDir = path.join(data, 'previews');
await Promise.all([clipDir, renderDir, outputDir, previewDir].map(dir => mkdir(dir, { recursive: true })));
const python = process.env.AFTERTAKE_PYTHON || path.join(root, '.runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const exec = promisify(execFile);
const renders = new Map<string, Render>();
const handles = new Map<string, Job>();
const active = new Set<string>();
let admittingRender = false;
let previewBusy = false;
let thumbnailQueue = Promise.resolve();
const client = new Comfy();
const terminal = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
const idPattern = /^[0-9a-f-]{36}$/;

async function persist(render: Render) {
  render.updatedAt = new Date().toISOString();
  const dest = path.join(renderDir, `${render.id}.json`);
  const temp = `${dest}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(render, null, 2));
  await rename(temp, dest);
}
for (const filename of await readdir(renderDir)) {
  if (!filename.endsWith('.json')) continue;
  try {
    const render = JSON.parse(await readFile(path.join(renderDir, filename), 'utf8')) as Render;
    renders.set(render.id, render);
  } catch (error) { console.error(`Could not read saved render ${filename}:`, error); }
}
const healthCache = new Map<string, { until: number; value: Engine }>();
async function engine(pipeline: 'structure' | 'inpaint' | 'cinema' | 'motion' = 'structure'): Promise<Engine> {
  const cached = healthCache.get(pipeline);
  if (cached && cached.until > Date.now()) return cached.value;
  let result: Engine;
  try {
    const responses = await Promise.all([
      fetch(`${uiUrl}/object_info`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${uiUrl}/system_stats`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${process.env.COMFY_BASE_URL}/api/v2/health`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (responses.some(r => !r.ok)) throw new Error('ComfyUI or the v2 proxy is unavailable');
    const nodes = await responses[0].json() as Record<string, any>;
    const stats = await responses[1].json() as { devices?: { name: string }[] };
    const needed = requirements(pipeline);
    const missing = needed.nodes.filter(name => !nodes[name]).map(name => `Node: ${name}`);
    if (nodes.AftertakeLoadClip && nodes.AftertakeLoadClip.output?.length !== 2) missing.push('Update Aftertake nodes and restart the engine for source audio');
    if (pipeline === 'inpaint' && nodes.AftertakeCueMask?.output?.length < 3) missing.push('Update Aftertake nodes and restart the engine');
    const menus = needed.menus;
    for (const [node, input, filename] of menus) {
      const options = nodes[node]?.input?.required?.[input]?.[0];
      if (Array.isArray(options) && !options.includes(filename)) missing.push(`Model: ${filename}`);
    }
    result = { connected: true, ready: missing.length === 0, gpu: stats.devices?.[0]?.name, missing,
      message: missing.length ? 'Engine connected. Required components are still being installed.' : 'Local ComfyUI · open-weight workflow' };
  } catch {
    result = { connected: false, ready: false, missing: [], message: 'Start ComfyUI and the Comfy v2 proxy to render. You can edit and export recipes now.' };
  }
  healthCache.set(pipeline, { until: Date.now() + 3000, value: result });
  return result;
}

async function track(render: Render, initial?: Job) {
  if (active.has(render.id)) return;
  active.add(render.id);
  const eventsController = new AbortController();
  let streamedProgress: number | null = null;
  try {
    const job = initial || await client.jobs.get(render.jobId!);
    handles.set(render.id, job);
    // Stream real sampler progress; polling remains authoritative for completion.
    void (async () => {
      for await (const event of job.events(eventsController.signal)) {
        if (event.kind === 'progress') {
          // Some local proxy events omit the current node and report 100% for
          // intermediate operations. An indeterminate indicator is honest here.
          streamedProgress = event.currentNode && event.value < 1 ? event.value : null;
          const stages: Record<string, string> = { '5': 'Reading direction', '6': 'Reading direction', '8': 'Reading source', '9': 'Tracking cue', '12': 'Encoding guides', '17': 'Sampling video', '19': 'Decoding frames', '20': 'Compositing', '21': 'Saving video', '22': 'Saving video', '30': 'Encoding refinement', '33': 'Refining video', '34': 'Decoding refined frames', '35': 'Blending boundaries' };
          render.stage = stages[event.currentNode || ''] || event.currentNodeClass || event.message || 'Processing workflow';
        }
      }
    })().catch(() => {});
    while (true) {
      await job.refresh();
      render.state = job.status === 'succeeded' ? 'finalizing' : job.status;
      render.progress = streamedProgress;
      delete render.error;
      if (job.status === 'succeeded') {
        render.stage = 'Downloading outputs';
        const output = job.getOutputs('21')[0];
        const raw = job.getOutputs('22')[0];
        const coarse = job.getOutputs('40')[0];
        const guide = job.getOutputs('44')[0];
        if (!output) throw new Error('The workflow finished without a composite video.');
        await output.toFile(path.join(outputDir, `${render.id}.mp4`));
        if (raw) await raw.toFile(path.join(outputDir, `${render.id}-raw.mp4`));
        if (coarse) await coarse.toFile(path.join(outputDir, `${render.id}-coarse.mp4`));
        if (guide) await guide.toFile(path.join(outputDir, `${render.id}-guide.mp4`));
        render.output = `/outputs/${render.id}.mp4`;
        if (raw) render.rawOutput = `/outputs/${render.id}-raw.mp4`;
        if (coarse) render.coarseOutput = `/outputs/${render.id}-coarse.mp4`;
        if (guide) render.guideOutput = `/outputs/${render.id}-guide.mp4`;
        // Release the model cache when the engine is idle so browser video
        // decoders can recover their VRAM after a generation on 16 GB cards.
        try {
          const queue = await fetch(`${uiUrl}/queue`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
          if (queue.queue_running?.length === 0 && queue.queue_pending?.length === 0) {
            await fetch(`${uiUrl}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(3000) });
          }
        } catch (error) { console.warn('Could not release idle GPU cache:', error); }
        render.progress = 1;
        render.stage = 'Complete';
        render.state = 'succeeded';
      } else if (job.status === 'failed') {
        render.error = JSON.stringify(job.error);
      }
      await persist(render);
      if (terminal.has(job.status)) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    // A poll failure says nothing about whether GPU work stopped. Retain the id.
    const job = handles.get(render.id);
    render.state = job && terminal.has(job.status) ? 'output_error' : 'connection_lost';
    render.error = error instanceof Error ? error.message : String(error);
    await persist(render);
  } finally { eventsController.abort(); handles.delete(render.id); active.delete(render.id); }
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const hostname = req.headers.host?.split(':')[0];
  if (!hostname || !['127.0.0.1', 'localhost'].includes(hostname)) return void res.status(403).json({ error: 'Use the local studio address.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return void res.status(403).json({ error: 'Cross-origin writes are disabled.' });
  }
  next();
});
app.use('/media', express.static(clipDir, { dotfiles: 'deny' }));
app.use('/outputs', express.static(outputDir, { dotfiles: 'deny' }));
app.get('/previews/:name', (req, res) => {
  if (!/^[a-f0-9]{64}\.png$/.test(req.params.name)) return void res.sendStatus(404);
  res.sendFile(req.params.name, { root: previewDir, dotfiles: 'deny' });
});
app.get('/api/engine', async (req, res) => { res.json(await engine(req.query.pipeline === 'motion' ? 'motion' : req.query.pipeline === 'cinema' ? 'cinema' : req.query.pipeline === 'inpaint' ? 'inpaint' : 'structure')); });
app.get('/api/workspace', (_req, res) => {
  res.json({ examples: process.env.AFTERTAKE_EXAMPLES === '1', exampleCount: Number(process.env.AFTERTAKE_EXAMPLE_COUNT || 3),
    exampleNames: JSON.parse(process.env.AFTERTAKE_EXAMPLE_TITLES || '{}'), featuredRenderId: process.env.AFTERTAKE_FEATURED_RENDER || null });
});
app.get('/api/thumbnails/:id', async (req, res) => {
  if (!idPattern.test(req.params.id)) return void res.sendStatus(404);
  const clip = JSON.parse(await readFile(path.join(clipDir, `${req.params.id}.json`), 'utf8')) as Clip;
  const requested = Number(req.query.time || 0);
  if (!Number.isFinite(requested)) return void res.sendStatus(400);
  const time = clip.kind === 'image' ? 0 : Math.round(Math.max(0, Math.min(clip.duration - .05, requested)) * 24) / 24;
  const key = createHash('sha256').update(`thumbnail/1:${clip.sha256}:${time}`).digest('hex');
  const filename = `${key}.jpg`;
  const task = thumbnailQueue.then(async () => {
    if (await stat(path.join(previewDir, filename)).catch(() => null)) return;
    await exec(python, [path.join(root, 'scripts/thumbnail.py'), path.join(clipDir, path.basename(clip.url)), path.join(previewDir, filename), String(time)], { timeout: 30000 });
  });
  thumbnailQueue = task.catch(() => {});
  await task;
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(filename, { root: previewDir, dotfiles: 'deny' });
});
app.get('/api/clips', async (_req, res) => {
  const clips: Clip[] = [];
  for (const file of await readdir(clipDir)) {
    if (file.endsWith('.json')) clips.push(JSON.parse(await readFile(path.join(clipDir, file), 'utf8')));
  }
  res.json(clips);
});
app.post('/api/clips', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return void res.status(400).json({ error: 'Choose a video file.' });
  if (!(await stat(python).catch(() => null))) return void res.status(409).json({ error: 'Install the Python runtime before importing new clips. You can explore the included examples now.' });
  const name = path.basename(String(req.query.name || 'source.mp4')).slice(0, 200);
  const extension = path.extname(name).toLowerCase();
  const image = ['.png', '.jpg', '.jpeg', '.webp'].includes(extension);
  if (!image && !['.mp4', '.mov', '.webm', '.mkv', '.m4v'].includes(extension)) return void res.status(400).json({ error: 'Use an MP4, MOV, WebM or MKV video, or a PNG, JPEG or WebP image.' });
  const id = randomUUID();
  const filename = `${id}${extension}`;
  const dest = path.join(clipDir, filename);
  await writeFile(dest, req.body);
  try {
    const normalized = path.join(clipDir, `${id}.normalized.png`);
    const { stdout } = await exec(python, image ? [path.join(root, 'scripts/import-image.py'), dest, normalized] : [path.join(root, 'scripts/probe.py'), dest], { timeout: 30000 });
    const meta = JSON.parse(stdout);
    if (meta.duration < 1) throw new Error('Use a clip at least one second long.');
    if (image) { await unlink(dest); await rename(normalized, path.join(clipDir, `${id}.png`)); }
    const bytes = image ? await readFile(path.join(clipDir, `${id}.png`)) : req.body;
    const clip: Clip = { id, name, sha256: createHash('sha256').update(bytes).digest('hex'), ...meta, url: `/media/${image ? `${id}.png` : filename}` };
    await writeFile(path.join(clipDir, `${id}.json`), JSON.stringify(clip, null, 2));
    res.status(201).json(clip);
  } catch {
    await Promise.all([dest, path.join(clipDir, `${id}.png`), path.join(clipDir, `${id}.normalized.png`)].map(file => unlink(file).catch(() => {})));
    res.status(422).json({ error: 'Could not read this source. Use a valid video from 1 second to 10 minutes, or a still image, up to 4K.' });
  }
});
app.use(express.json({ limit: '2mb' }));
app.use('/api/films', await filmRouter(root, data, python, renders));
app.post('/api/cue-preview', async (req, res) => {
  if (!(await stat(python).catch(() => null))) return void res.status(409).json({ error: 'Install the local runtime to compute motion previews. See the engine panel.' });
  if (previewBusy) return void res.status(409).json({ error: 'A motion preview is already being computed. Try again in a moment.' });
  previewBusy = true;
  try {
    const recipe = recipeSchema.parse(req.body);
    const clip = JSON.parse(await readFile(path.join(clipDir, `${recipe.clip.id}.json`), 'utf8')) as Clip;
    if (clip.sha256 !== recipe.clip.sha256) throw new Error('The source clip does not match this recipe.');
    const dims = renderDimensions({ ...recipe, clip });
    const settings = { ...dims, clip, cue: recipe.cue, trimStart: recipe.trimStart };
    const key = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    const existing = await stat(path.join(previewDir, `${key}.png`)).catch(() => null);
    if (!existing) {
      await writeFile(path.join(previewDir, `${key}.json`), JSON.stringify(settings));
      await exec(python, [path.join(root, 'scripts/preview-cue.py'), key], { timeout: 60000 });
    }
    res.json({ url: `/previews/${key}.png`, ...dims });
  } finally { previewBusy = false; }
});
app.get('/api/renders', (_req, res) => { res.json([...renders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); });
app.get('/api/renders/:id', (req, res) => {
  const render = renders.get(req.params.id);
  if (!render) return void res.status(404).json({ error: 'Render not found.' });
  if (render.jobId && !terminal.has(render.state) && !active.has(render.id)) void track(render);
  res.json(render);
});
app.post('/api/workflow', (req, res) => { res.json(buildWorkflow(recipeSchema.parse(req.body))); });
app.post('/api/renders', async (req, res) => {
  if (admittingRender) return void res.status(409).json({ error: 'A take is already being submitted.' });
  admittingRender = true;
  try {
  const recipe = recipeSchema.parse(req.body);
  if (!(await engine(recipe.pipeline === 'cinema' && recipe.cinema?.guidance === 'tracks' ? 'motion' : recipe.pipeline)).ready) return void res.status(409).json({ error: 'The selected local workflow is not ready. Check the engine panel.' });
  if ([...renders.values()].some(r => !terminal.has(r.state))) return void res.status(409).json({ error: 'A take is already active. Let it finish, cancel it, or reconcile its submission before starting another.' });
  const storedClip = JSON.parse(await readFile(path.join(clipDir, `${recipe.clip.id}.json`), 'utf8')) as Clip;
  if (storedClip.sha256 !== recipe.clip.sha256) return void res.status(409).json({ error: 'This recipe needs its original source clip. Import it before rendering.' });
  recipe.clip = storedClip;
  recipeSchema.parse(recipe);
  const render: Render = { id: randomUUID(), recipe, state: 'submitting', progress: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  render.workflow = buildWorkflow(recipe);
  renders.set(render.id, render);
  await persist(render);
  try {
    const wf = client.workflows.fromJson(structuredClone(render.workflow));
    wf.setInput('8', 'filename', client.assets.fromFile(path.join(clipDir, path.basename(storedClip.url))));
    const job = await client.submit(wf, { idempotencyKey: render.id });
    render.jobId = job.id;
    render.state = job.status === 'succeeded' ? 'finalizing' : job.status;
    await persist(render);
    void track(render, job);
    res.status(201).json(render);
  } catch (error) {
    // A submit may reach the server before a network failure. Never retry it blindly.
    render.state = submissionRejected(error) ? 'failed' : 'submission_unknown';
    render.error = error instanceof Error ? error.message : String(error);
    await persist(render);
    res.status(502).json({ error: render.error, render });
  }
  } finally { admittingRender = false; }
});
app.post('/api/renders/:id/cancel', async (req, res) => {
  const render = renders.get(req.params.id);
  if (!render?.jobId) return void res.status(404).json({ error: 'No submitted job was found.' });
  const job = handles.get(render.id) || await client.jobs.get(render.jobId);
  await job.cancel();
  render.state = job.status;
  await persist(render);
  res.json(render);
});

const httpServer = createServer(app);
if (process.argv.includes('--production')) app.use(express.static(path.join(root, 'dist')));
else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ server: { middlewareMode: true, ws: { server: httpServer } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof ZodError ? error.issues[0]?.message || 'Check the project settings.' : error instanceof Error ? error.message : 'Request failed.';
  console.error(message);
  res.status(400).json({ error: message });
});
const port = Number(process.env.PORT || 4310);
httpServer.listen(port, '127.0.0.1', () => console.log(`Aftertake studio: http://127.0.0.1:${port}`));
for (const render of renders.values()) {
  if (render.jobId && !terminal.has(render.state)) void track(render);
  else if (render.state === 'submitting') { render.state = 'submission_unknown'; await persist(render); }
}
