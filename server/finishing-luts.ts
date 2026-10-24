import { Router, raw } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { replaceFile } from './replace-file.js';
import path from 'node:path';
import { lutDescriptorSchema, type LutDescriptor } from '../src/grading.js';
import { parseCube, MAX_CUBE_BYTES } from './cube-lut.js';
import { RequestError } from './http-errors.js';

function assetPath(data: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new RequestError('Use a valid LUT content hash.');
  return path.join(data, 'finishing-luts', `${hash}.cube`);
}
function describe(bytes: Uint8Array): LutDescriptor {
  return lutDescriptorSchema.parse({
    ...parseCube(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    interpolation: 'trilinear',
    colorSpace: 'srgb',
  });
}
export async function resolveFinishingLut(data: string, hash: string): Promise<string> {
  const filename = assetPath(data, hash);
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_CUBE_BYTES) throw Error('Invalid LUT file.');
    const bytes = await readFile(filename);
    if (describe(bytes).sha256 !== hash) throw Error('Changed LUT file.');
    return filename;
  } catch {
    throw new RequestError(
      'Import the matching display-sRGB .cube file. Its content hash must match the saved LUT.',
      409,
    );
  }
}
export async function resolveFinishingLutSettings(
  data: string,
  settings: { lut: LutDescriptor | null; lutStrength: number },
) {
  const resolvedLuts: Record<string, string> = {};
  if (settings.lutStrength && settings.lut) {
    const filename = await resolveFinishingLut(data, settings.lut.sha256);
    const actual = describe(await readFile(filename)),
      expected = settings.lut;
    if (
      actual.title !== expected.title ||
      actual.size !== expected.size ||
      actual.domainMin.some((value, index) => value !== expected.domainMin[index]) ||
      actual.domainMax.some((value, index) => value !== expected.domainMax[index])
    )
      throw new RequestError('The LUT companion does not match the saved descriptor.', 409);
    resolvedLuts[expected.sha256] = filename;
  }
  return resolvedLuts;
}
export async function finishingLutStore(data: string) {
  const folder = path.join(data, 'finishing-luts');
  await mkdir(folder, { recursive: true });
  const router = Router();
  router.post(
    '/',
    raw({ type: 'application/octet-stream', limit: MAX_CUBE_BYTES }),
    async (req, res) => {
      if (req.get('X-LUT-Color-Space') !== 'srgb')
        throw new RequestError('Declare a display-referred sRGB LUT before importing it.');
      if (!Buffer.isBuffer(req.body))
        throw new RequestError('Upload the original .cube bytes as application/octet-stream.');
      let descriptor: LutDescriptor;
      try {
        descriptor = describe(req.body);
      } catch {
        throw new RequestError(
          'Use a valid UTF-8 3D .cube LUT: edge2–64, finite RGB entries, positive input domains and at most16MiB.',
        );
      }
      const target = assetPath(data, descriptor.sha256),
        temporary = path.join(folder, `${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, req.body);
        await replaceFile(temporary, target);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      res.status(201).json(descriptor);
    },
  );
  router.get('/:sha256/info', async (req, res) => {
    const filename = await resolveFinishingLut(data, req.params.sha256);
    res.json(describe(await readFile(filename)));
  });
  router.get('/:sha256', async (req, res) => {
    const filename = await resolveFinishingLut(data, req.params.sha256);
    res.download(filename, `${req.params.sha256}.cube`);
  });
  return { router };
}
