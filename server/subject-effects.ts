import { Router, raw } from 'express';
import { mkdir, readFile, readdir, writeFile, unlink, stat } from 'node:fs/promises';
import { replaceFile } from './replace-file.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import { RequestError } from './http-errors.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { characterSelectionSchema, parseCharacterSelectionInfo } from '../src/character.js';
import {
  subjectEffectRequestSchema,
  subjectEffectRecipeSchema,
  type SubjectEffectJob,
  type SubjectEffectRecipe,
  type SubjectEffectSelection,
} from '../src/subject-effects.js';

const execute = promisify(execFile);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fileHash(filename: string) {
  const digest = createHash('sha256');
  for await (const part of createReadStream(filename)) digest.update(part);
  return digest.digest('hex');
}
const uuid = z.string().uuid();
const roleSchema = z.enum(['source', 'prepared', 'mask']);
type Role = z.infer<typeof roleSchema>;
type ImportedMedia = {
  id: string;
  role: Role;
  filename: string;
  sha256: string;
  width: number;
  height: number;
  duration: number;
  frames?: number;
  fps?: number;
  hasAudio: boolean;
};

export async function subjectEffectsRouter(context: {
  root: string;
  data: string;
  python: string;
  resolveSelection: (id: string) => Promise<SubjectEffectSelection>;
}) {
  const { root, data, python } = context,
    router = Router();
  const folder = path.join(data, 'subject-effects'),
    uploads = path.join(folder, 'media'),
    selections = path.join(folder, 'selections'),
    clips = path.join(data, 'clips');
  await Promise.all(
    [folder, uploads, selections, clips].map((directory) => mkdir(directory, { recursive: true })),
  );
  const jobs = new Map<string, SubjectEffectJob>();
  let busy = false;
  async function atomic(file: string, value: unknown) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2));
      await replaceFile(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function persist(job: SubjectEffectJob) {
    job.updatedAt = new Date().toISOString();
    await atomic(path.join(folder, job.id + '.json'), job);
  }
  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as SubjectEffectJob;
      subjectEffectRequestSchema.parse(job.request);
      if (job.state === 'queued' || job.state === 'running') {
        job.state = 'failed';
        job.error =
          'The studio stopped during this local composition. Start a deliberate new preview to retry.';
        await persist(job);
      }
      jobs.set(job.id, job);
    } catch (error) {
      console.error('Could not restore a local subject job:', name, error);
    }
  }
  async function checkedMedia(id: string, role: Role) {
    uuid.parse(id);
    const meta = JSON.parse(
      await readFile(path.join(uploads, id + '.json'), 'utf8'),
    ) as ImportedMedia;
    if (meta.id !== id || meta.role !== role)
      throw new RequestError('This file has a different subject-media role.', 409);
    const filename = path.join(uploads, id + '.bin');
    if ((await fileHash(filename)) !== meta.sha256)
      throw new RequestError('Imported subject media changed on disk. Import it again.', 409);
    return { meta, filename };
  }
  async function checkedSelection(id: string): Promise<SubjectEffectSelection> {
    uuid.parse(id);
    let selection: SubjectEffectSelection;
    const importedFile = path.join(selections, id + '.json');
    if (await stat(importedFile).catch(() => null)) {
      const saved = JSON.parse(await readFile(importedFile, 'utf8'));
      const [source, prepared, mask] = await Promise.all([
        checkedMedia(saved.media.sourceId, 'source'),
        checkedMedia(saved.media.preparedId, 'prepared'),
        checkedMedia(saved.media.maskId, 'mask'),
      ]);
      selection = {
        id,
        request: saved.selection.request,
        selection: saved.selection.info,
        originalSourcePath: source.filename,
        preparedSourcePath: prepared.filename,
        maskPath: mask.filename,
      };
    } else selection = await context.resolveSelection(id);
    if (selection.id !== id)
      throw new RequestError('This selection belongs to a different saved record.', 409);
    selection.request = characterSelectionSchema.parse(selection.request);
    const info = parseCharacterSelectionInfo(selection.selection, selection.request);
    if (info.emptyFrames.length || !info.sourceSha256)
      throw new RequestError(
        'Use a complete reviewed person selection with its prepared source.',
        409,
      );
    const [source, prepared, mask] = await Promise.all([
      fileHash(selection.originalSourcePath),
      fileHash(selection.preparedSourcePath),
      fileHash(selection.maskPath),
    ]);
    if (
      source !== selection.request.clip.sha256 ||
      prepared !== info.sourceSha256 ||
      mask !== info.maskSha256
    )
      throw new RequestError(
        'The reviewed source or tracked mask changed. Review or import the original selection again.',
        409,
      );
    return { ...selection, selection: info };
  }
  function recipe(job: SubjectEffectJob): SubjectEffectRecipe {
    return subjectEffectRecipeSchema.parse({
      format: 'aftertake-subject-effect-recipe/1',
      renderer: 'aftertake-local-subject-compositor/1',
      request: job.request,
      selection: job.selection,
      media: {
        source: {
          sha256: job.selection.request.clip.sha256,
          filename:
            'source-original' +
            (['.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(
              path.extname(job.selection.request.clip.url),
            )
              ? path.extname(job.selection.request.clip.url)
              : '.mp4'),
        },
        prepared: { sha256: job.selection.info.sourceSha256, filename: 'prepared-source.mp4' },
        mask: { sha256: job.selection.info.maskSha256, filename: 'person-mask.mkv' },
      },
      ...(job.clip ? { output: job.clip } : {}),
    });
  }
  async function render(job: SubjectEffectJob, selection: SubjectEffectSelection) {
    const work = path.join(folder, job.id + '.work.json'),
      output = path.join(clips, job.id + '.mp4');
    try {
      job.state = 'running';
      await persist(job);
      await atomic(work, {
        request: job.request,
        selection: selection.selection,
        recipe: recipe(job),
        source: selection.originalSourcePath,
        prepared: selection.preparedSourcePath,
        mask: selection.maskPath,
        hashes: {
          source: selection.request.clip.sha256,
          prepared: selection.selection.sourceSha256,
          mask: selection.selection.maskSha256,
        },
        trimStart: selection.request.trimStart,
        output,
      });
      const { stdout } = await execute(
        python,
        [path.join(root, 'scripts/subject-effects.py'), work],
        { timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
      const info = JSON.parse(stdout),
        bytes = await readFile(output);
      if (
        info.sha256 !== hash(bytes) ||
        info.width !== selection.selection.width ||
        info.height !== selection.selection.height ||
        info.frames !== selection.selection.frames ||
        info.fps !== 24 ||
        typeof info.hasAudio !== 'boolean'
      )
        throw Error('The subject output does not match its reviewed source clock.');
      job.clip = {
        id: job.id,
        name: job.request.name,
        kind: 'video',
        sha256: info.sha256,
        width: info.width,
        height: info.height,
        duration: info.frames / 24,
        hasAudio: info.hasAudio,
        url: `/media/${job.id}.mp4`,
      };
      await atomic(path.join(clips, job.id + '.json'), job.clip);
      job.state = 'succeeded';
      await persist(job);
    } catch (error) {
      console.error('Local subject composition failed:', error);
      job.state = 'failed';
      job.error =
        'The local composition failed. Check the source, lossless person mask and CPU media runtime, then start a new preview.';
      await unlink(output).catch(() => {});
      await unlink(path.join(clips, job.id + '.json')).catch(() => {});
      delete job.clip;
      await persist(job);
    } finally {
      busy = false;
      await unlink(work).catch(() => {});
    }
  }
  router.get('/', (_req, res) =>
    res.json([...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  );
  router.post('/duplicates', async (req, res) => {
    const request = subjectEffectRequestSchema.parse(req.body);
    const admission = generationAdmission(req.get('Idempotency-Key'), request, jobs.values());
    if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
    if (admission.existing)
      return void res
        .status(['queued', 'running'].includes(admission.existing.state) ? 202 : 200)
        .json(admission.existing);
    if (busy)
      throw new RequestError(
        'Another local subject composition is running. Wait for its saved result.',
        409,
      );
    busy = true;
    try {
      const selected = await checkedSelection(request.selectionId);
      if (selected.selection.maskSha256 !== request.maskSha256)
        throw new RequestError('This mask differs from the reviewed selection.', 409);
      const now = new Date().toISOString();
      const job: SubjectEffectJob = {
        id: randomUUID(),
        kind: 'subject-effect',
        state: 'queued',
        request,
        selection: { request: selected.request, info: selected.selection },
        createdAt: now,
        updatedAt: now,
        ...admission.identity,
      };
      await persist(job);
      jobs.set(job.id, job);
      void render(job, selected).catch((error) => {
        busy = false;
        console.error('Could not persist the local subject job outcome:', error);
      });
      res.status(201).json(job);
    } catch (error) {
      busy = false;
      throw error;
    }
  });
  router.post(
    '/media',
    raw({ type: 'application/octet-stream', limit: '100mb' }),
    async (req, res) => {
      const role = roleSchema.parse(req.query.role);
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new RequestError('Upload the original subject media as binary bytes.');
      const id = randomUUID(),
        filename = path.join(uploads, id + '.bin');
      await writeFile(filename, req.body, { flag: 'wx' });
      try {
        const { stdout } = await execute(
          python,
          [path.join(root, 'scripts/subject-effects.py'), '--inspect', filename, '--role', role],
          { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true },
        );
        const info = JSON.parse(stdout);
        if (info.sha256 !== hash(req.body)) throw Error('The imported file hash differs.');
        const meta: ImportedMedia = {
          ...info,
          id,
          role,
          filename: path.basename(String(req.query.name || role + '.mkv')).slice(0, 120),
        };
        await atomic(path.join(uploads, id + '.json'), meta);
        res.status(201).json(meta);
      } catch (error) {
        console.error('Subject media import failed:', error);
        await unlink(filename).catch(() => {});
        throw new RequestError(
          'Could not read this subject media. Import the original video and complete lossless 24 fps person mask.',
          422,
        );
      }
    },
  );
  router.post('/imports', async (req, res) => {
    const input = z
      .object({
        recipe: subjectEffectRecipeSchema,
        media: z.object({ sourceId: uuid, preparedId: uuid, maskId: uuid }).strict(),
      })
      .strict()
      .parse(req.body);
    const [source, prepared, mask] = await Promise.all([
      checkedMedia(input.media.sourceId, 'source'),
      checkedMedia(input.media.preparedId, 'prepared'),
      checkedMedia(input.media.maskId, 'mask'),
    ]);
    const bound = { source, prepared, mask };
    for (const role of ['source', 'prepared', 'mask'] as const)
      if (bound[role].meta.sha256 !== input.recipe.media[role].sha256)
        throw new RequestError('A recipe file differs from its saved content hash.', 409);
    const info = parseCharacterSelectionInfo(
      input.recipe.selection.info,
      input.recipe.selection.request,
    );
    for (const item of [prepared.meta, mask.meta])
      if (
        item.width !== info.width ||
        item.height !== info.height ||
        item.frames !== info.frames ||
        item.fps !== 24
      )
        throw new RequestError(
          'Imported source and mask do not match the recipe frame clock.',
          409,
        );
    const id = randomUUID();
    await atomic(path.join(selections, id + '.json'), {
      selection: input.recipe.selection,
      media: input.media,
    });
    res.status(201).json({
      request: { ...input.recipe.request, selectionId: id },
      selection: input.recipe.selection,
    });
  });
  function jobFor(id: string) {
    uuid.parse(id);
    const job = jobs.get(id);
    if (!job) throw new RequestError('Subject effect not found.', 404);
    return job;
  }
  router.get('/:id', (req, res) => res.json(jobFor(req.params.id)));
  router.get('/:id/recipe', (req, res) => res.json(recipe(jobFor(req.params.id))));
  router.get('/:id/media/:role', async (req, res) => {
    const job = jobFor(req.params.id),
      role = roleSchema.parse(req.params.role),
      selected = await checkedSelection(job.request.selectionId);
    const filename = {
      source: selected.originalSourcePath,
      prepared: selected.preparedSourcePath,
      mask: selected.maskPath,
    }[role];
    res.download(filename, recipe(job).media[role].filename);
  });
  return router;
}
