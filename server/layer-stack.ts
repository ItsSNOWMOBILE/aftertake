import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { clipSchema, type Clip } from '../src/domain.js';
import {
  layerStackRequestSchema,
  layerStackRecipeSchema,
  layerStackSources,
  type LayerStackRequest,
  type LayerStackRecipe,
  type LayerStackJob,
  type LayerImageRef,
} from '../src/layer-stack.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { RequestError } from './http-errors.js';
import type { FinishingSettings } from '../src/finishing.js';

const processor = 'aftertake-cpu-layer-stack/1' as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const assetSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal('image'),
    name: z.string(),
    sha256: sha,
    extension: z.enum(['.png', '.jpg', '.jpeg', '.webp']),
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  })
  .passthrough()
  .refine((asset) => asset.width * asset.height <= 16777216);
const infoSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: sha,
});
const receiptSchema = z.object({
  processor: z.literal(processor),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: sha,
  sources: z.array(z.object({ assetId: z.string().uuid(), sha256: sha })),
});
const jobSchema = z
  .object({
    id: z.string().uuid(),
    request: layerStackRequestSchema,
    media: layerStackRecipeSchema.shape.media,
    state: z.enum(['queued', 'running', 'succeeded', 'failed', 'interrupted']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    requestKey: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
    requestDigest: sha.optional(),
    clip: clipSchema.optional(),
    error: z.string().optional(),
  })
  .strict()
  .refine((job) => job.state !== 'succeeded' || job.clip?.id === job.id);
type Worker = (args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;
type BoundAsset = LayerImageRef & { path: string; width: number; height: number; filename: string };
async function hash(file: string) {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
function inputIdentity(request: LayerStackRequest) {
  return {
    ...request,
    layers: request.layers.map((layer) => ({
      ...layer,
      ...(layer.type === 'image' ? { source: { sha256: layer.source.sha256 } } : {}),
      ...(layer.mask?.kind === 'image'
        ? { mask: { ...layer.mask, source: { sha256: layer.mask.source.sha256 } } }
        : {}),
    })),
  };
}
function pngDimensions(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    bytes.readUInt32BE(8) !== 13
  )
    throw Error('Invalid composited PNG.');
  let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset),
      end = offset + length + 12;
    if (end > bytes.length) throw Error('Incomplete composited PNG.');
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IEND') {
      ended = length === 0 && end === bytes.length;
      break;
    }
    offset = end;
  }
  if (!ended) throw Error('Incomplete composited PNG.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export async function layerStackRouter(context: {
  root: string;
  data: string;
  python: string;
  assetFolder?: string;
  clipFolder?: string;
  resolveLut?: (sha256: string) => Promise<string>;
  resolveFinishingSettings?: (settings: FinishingSettings) => Promise<Record<string, string>>;
  worker?: Worker;
}) {
  const router = Router(),
    folder = path.join(context.data, 'layer-stacks'),
    assets = path.resolve(context.assetFolder || path.join(context.data, 'films', 'assets')),
    clips = path.resolve(context.clipFolder || path.join(context.data, 'clips')),
    script = path.join(context.root, 'scripts', 'layer-stack.py');
  await Promise.all([
    mkdir(folder, { recursive: true }),
    mkdir(assets, { recursive: true }),
    mkdir(clips, { recursive: true }),
  ]);
  const assetsReal = await realpath(assets),
    exec = promisify(execFile);
  const worker: Worker =
    context.worker ||
    ((args, options) =>
      exec(context.python, args, {
        ...options,
        windowsHide: true,
        maxBuffer: 64 * 1024,
        encoding: 'utf8',
      }));
  const jobs = new Map<string, LayerStackJob>();
  let operation: string | undefined,
    tail: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  }
  async function atomic(file: string, value: unknown) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2));
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function persist(job: LayerStackJob) {
    job.updatedAt = new Date().toISOString();
    await atomic(path.join(folder, job.id + '.json'), job);
  }
  async function assetFile(name: string) {
    const file = await realpath(path.join(assets, name));
    if (!file.startsWith(assetsReal + path.sep))
      throw new RequestError('Image assets must stay inside this workspace.', 409);
    const info = await stat(file);
    if (!info.isFile() || info.size > 100 * 1024 ** 2)
      throw new RequestError('Use a still image below 100 MB.', 413);
    return file;
  }
  async function readAsset(id: string) {
    if (!z.string().uuid().safeParse(id).success)
      throw new RequestError('That image asset was not found.', 404);
    const meta = assetSchema.parse(
      JSON.parse(await readFile(await assetFile(id + '.json'), 'utf8')),
    );
    if (meta.id !== id) throw new RequestError('That image asset was not found.', 404);
    return meta;
  }
  async function preflight() {
    try {
      const value = JSON.parse((await worker([script, '--check'], { timeout: 20000 })).stdout);
      if (value.ready !== true || value.processor !== processor) throw Error();
    } catch {
      throw new RequestError(
        'Still layers need Python, Pillow, NumPy and the local finishing runtime. Run Aftertake setup.',
        503,
      );
    }
  }
  async function bind(ref: LayerImageRef): Promise<BoundAsset> {
    let meta;
    try {
      meta = await readAsset(ref.assetId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new RequestError('Import this original still into Film media first.', 404);
      throw error;
    }
    const file = await assetFile(meta.id + meta.extension);
    if (meta.sha256 !== ref.sha256 || (await hash(file)) !== ref.sha256)
      throw new RequestError(
        'A source or mask image changed. Import the exact original bytes.',
        409,
      );
    let info;
    try {
      info = infoSchema.parse(
        JSON.parse((await worker([script, '--inspect', file], { timeout: 30000 })).stdout),
      );
    } catch {
      throw new RequestError('The still image could not be decoded within its safe bounds.', 422);
    }
    if (info.width !== meta.width || info.height !== meta.height || info.sha256 !== ref.sha256)
      throw new RequestError('The image dimensions or bytes differ from its saved metadata.', 409);
    return {
      ...ref,
      path: file,
      width: info.width,
      height: info.height,
      filename:
        path
          .basename(meta.name)
          .replace(/[\\/:]/g, '_')
          .slice(0, 190) || 'image' + meta.extension,
    };
  }
  async function prepare(request: LayerStackRequest) {
    await preflight();
    const bound = [];
    for (const ref of layerStackSources(request)) bound.push(await bind(ref));
    const resolvedLuts: Record<string, string> = {};
    for (const layer of request.layers)
      if (layer.type === 'adjustment' && layer.visible && layer.opacity > 0) {
        const settings = layer.settings as typeof layer.settings & {
          lut?: { sha256: string } | null;
          lutStrength?: number;
        };
        if (settings.lut && (settings.lutStrength || 0) > 0) {
          if (context.resolveFinishingSettings) {
            Object.assign(resolvedLuts, await context.resolveFinishingSettings(layer.settings));
            continue;
          }
          if (!context.resolveLut)
            throw new RequestError(
              'Import the matching LUT before compositing this adjustment.',
              409,
            );
          resolvedLuts[settings.lut.sha256] = await context.resolveLut(settings.lut.sha256);
        }
      }
    return { bound, resolvedLuts };
  }
  function getJob(id: string) {
    const job = jobs.get(id);
    if (!job) throw new RequestError('That layer project was not found.', 404);
    return job;
  }
  function recipe(job: LayerStackJob): LayerStackRecipe {
    return layerStackRecipeSchema.parse({
      format: 'aftertake-layer-stack-recipe/1',
      processor,
      request: job.request,
      media: job.media,
      ...(job.clip ? { output: job.clip } : {}),
    });
  }
  async function renderFile(
    request: LayerStackRequest,
    prepared: Awaited<ReturnType<typeof prepare>>,
    token: string,
  ) {
    const output = path.join(folder, token + '.png'),
      work = path.join(folder, token + '.work.json'),
      receipt = path.join(folder, token + '.receipt.json');
    try {
      await atomic(work, {
        request,
        assets: prepared.bound,
        resolvedLuts: prepared.resolvedLuts,
        output,
        receipt,
      });
      await worker([script, work], { timeout: 600000 });
      const result = receiptSchema.parse(JSON.parse(await readFile(receipt, 'utf8'))),
        bytes = await readFile(output),
        dimensions = pngDimensions(bytes);
      if (
        result.width !== request.canvas.width ||
        result.height !== request.canvas.height ||
        dimensions.width !== result.width ||
        dimensions.height !== result.height ||
        result.sha256 !== (await hash(output)) ||
        JSON.stringify(result.sources) !==
          JSON.stringify(prepared.bound.map(({ assetId, sha256 }) => ({ assetId, sha256 })))
      )
        throw Error('The layer receipt did not match its request.');
      for (const asset of prepared.bound)
        if ((await hash(asset.path)) !== asset.sha256)
          throw Error('Source changed during composition.');
      for (const [sha256, file] of Object.entries(prepared.resolvedLuts))
        if ((await hash(file)) !== sha256) throw Error('Finishing LUT changed during composition.');
      return { output, result, bytes };
    } catch (error) {
      await unlink(output).catch(() => {});
      throw error;
    } finally {
      await Promise.all([unlink(work).catch(() => {}), unlink(receipt).catch(() => {})]);
    }
  }
  async function runJob(job: LayerStackJob, prepared: Awaited<ReturnType<typeof prepare>>) {
    const token = job.id + '.' + randomUUID(),
      target = path.join(clips, job.id + '.png');
    let promoted = false;
    try {
      job.state = 'running';
      await persist(job);
      const result = await renderFile(job.request, prepared, token);
      const clip: Clip = {
        id: job.id,
        name: job.request.name,
        kind: 'image',
        sha256: result.result.sha256,
        width: job.request.canvas.width,
        height: job.request.canvas.height,
        duration: 30,
        hasAudio: false,
        url: '/media/' + job.id + '.png',
      };
      await rename(result.output, target);
      promoted = true;
      await atomic(path.join(clips, job.id + '.json'), clip);
      job.clip = clip;
      job.state = 'succeeded';
      delete job.error;
      await persist(job);
    } catch {
      if (promoted)
        await Promise.all([
          unlink(target).catch(() => {}),
          unlink(path.join(clips, job.id + '.json')).catch(() => {}),
        ]);
      delete job.clip;
      job.state = 'failed';
      job.error =
        'The still-layer composition did not complete. Check the source images and local finishing runtime.';
      await persist(job).catch(() =>
        console.warn('Could not persist a layer composition failure.'),
      );
    } finally {
      if (operation === job.id) operation = undefined;
    }
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job = jobSchema.parse(JSON.parse(await readFile(path.join(folder, name), 'utf8')));
      if (name !== job.id + '.json') continue;
      if (job.state === 'queued' || job.state === 'running') {
        job.state = 'interrupted';
        job.error =
          'The server restarted. This saved request was not executed again. Review it and use a new request key to retry.';
        delete job.clip;
        await Promise.all([
          unlink(path.join(clips, job.id + '.png')).catch(() => {}),
          unlink(path.join(clips, job.id + '.json')).catch(() => {}),
        ]);
        await persist(job);
      }
      jobs.set(job.id, job);
    } catch {
      console.warn('Skipped an invalid layer project record.');
    }
  }
  router.get('/', (_req, res) =>
    res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  );
  router.get('/runtime', async (_req, res) => {
    try {
      await preflight();
      res.json({
        ready: true,
        processor,
        stillOnly: true,
        busy: !!operation,
        maxLayers: 8,
        maxCanvasPixels: 4194304,
      });
    } catch {
      res.json({
        ready: false,
        processor,
        stillOnly: true,
        busy: !!operation,
        message: 'Run Aftertake setup to install the CPU image finishing runtime.',
      });
    }
  });
  router.post('/resolve', async (req, res) => {
    const saved = layerStackRecipeSchema.parse(req.body);
    await preflight();
    const matching = new Map<string, LayerImageRef>();
    for (const ref of layerStackSources(saved.request)) {
      let found: LayerImageRef | undefined;
      for (const name of await readdir(assets)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        try {
          const meta = await readAsset(name.slice(0, -5));
          if (meta.sha256 === ref.sha256) {
            await bind({ assetId: meta.id, sha256: meta.sha256 });
            found = { assetId: meta.id, sha256: meta.sha256 };
            break;
          }
        } catch {
          /* unrelated or missing media is not a match */
        }
      }
      if (!found)
        throw new RequestError(
          'Import every matching original layer and mask image into Film media before restoring this recipe.',
          409,
        );
      matching.set(ref.assetId, found);
    }
    res.json(
      layerStackRequestSchema.parse({
        ...saved.request,
        layers: saved.request.layers.map((layer) => ({
          ...layer,
          ...(layer.type === 'image' ? { source: matching.get(layer.source.assetId) } : {}),
          ...(layer.mask?.kind === 'image'
            ? { mask: { ...layer.mask, source: matching.get(layer.mask.source.assetId) } }
            : {}),
        })),
      }),
    );
  });
  router.post('/preview', async (req, res) => {
    const request = layerStackRequestSchema.parse(req.body),
      token = 'preview-' + randomUUID();
    const prepared = await exclusive(async () => {
      if (operation) throw new RequestError('Wait for the active layer composition.', 409);
      operation = token;
      try {
        return await prepare(request);
      } catch (error) {
        operation = undefined;
        throw error;
      }
    });
    let output: string | undefined;
    try {
      const result = await renderFile(request, prepared, token);
      output = result.output;
      res.set('Cache-Control', 'no-store').type('png').send(result.bytes);
    } catch {
      throw new RequestError(
        'The real layer preview could not be composed. Check the imported still images.',
        422,
      );
    } finally {
      if (output) await unlink(output).catch(() => {});
      if (operation === token) operation = undefined;
    }
  });
  router.post('/', async (req, res) => {
    const request = layerStackRequestSchema.parse(req.body);
    const result = await exclusive(async () => {
      const admission = generationAdmission(
        req.get('Idempotency-Key'),
        inputIdentity(request),
        jobs.values(),
      );
      if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
      if (admission.existing) return { job: admission.existing, existing: true };
      if (operation) throw new RequestError('Wait for the active layer composition.', 409);
      const prepared = await prepare(request),
        id = randomUUID(),
        now = new Date().toISOString();
      const job: LayerStackJob = {
        id,
        request,
        state: 'queued',
        media: prepared.bound.map(({ assetId, sha256, filename }) => ({
          assetId,
          sha256,
          filename,
        })),
        createdAt: now,
        updatedAt: now,
        ...admission.identity,
      };
      await persist(job);
      jobs.set(id, job);
      operation = id;
      void runJob(job, prepared);
      return { job, existing: false };
    });
    res.status(result.existing ? 200 : 202).json(result.job);
  });
  router.get('/:id/recipe', (req, res) =>
    res.attachment('aftertake-layer-stack.json').json(recipe(getJob(req.params.id))),
  );
  router.get('/:id/media', async (req, res) => {
    const job = getJob(req.params.id);
    if (job.state !== 'succeeded' || !job.clip)
      throw new RequestError('This layer project has no completed image.', 409);
    const file = path.join(clips, job.id + '.png');
    if ((await hash(file)) !== job.clip.sha256)
      throw new RequestError('The saved layer image changed.', 409);
    res.type('png').sendFile(job.id + '.png', { root: clips, dotfiles: 'deny' });
  });
  router.get('/:id', (req, res) => res.json(getJob(req.params.id)));
  return { router, busy: () => !!operation };
}
