// Maintainer utility: record reviewed one-tap effects as examples.
// usage: node scripts/package-one-tap-examples.mjs WORKSPACE [--photos=CLIP_ID,...] JOB_ID...
// Copies each effect's finished clip, Film record, generated take and photo into
// examples/one-tap, and lists them in examples/manifest.json so --examples, the
// shared copy and the browser trial open with them.
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [workspace, ...rest] = process.argv.slice(2);
// Extra sample photos for visitors to try, beyond those the effects used.
const photos =
  rest
    .find((arg) => arg.startsWith('--photos='))
    ?.slice(9)
    .split(',') ?? [];
const jobIds = rest.filter((arg) => !arg.startsWith('--'));
if (!workspace || !jobIds.length)
  throw Error('usage: node scripts/package-one-tap-examples.mjs WORKSPACE JOB_ID...');
const data = path.resolve(root, workspace);
const examples = path.join(root, 'examples');
const manifestFile = path.join(examples, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const read = async (relative) => JSON.parse(await readFile(path.join(data, relative), 'utf8'));
const files = new Map(manifest.files.map((file) => [file.target, file]));

/** Copy one workspace file into examples and list it at the same workspace path. */
async function add(source, target, bytes) {
  const destination = path.join(examples, source);
  await mkdir(path.dirname(destination), { recursive: true });
  if (bytes) await writeFile(destination, bytes);
  else await copyFile(path.join(data, target), destination);
  const written = await readFile(destination);
  files.set(target, {
    source,
    target,
    sha256: createHash('sha256').update(written).digest('hex'),
    size: written.length,
  });
}
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
async function photo(clip) {
  const name = path.basename(clip.url);
  await add(`one-tap/photos/${name}`, `clips/${name}`);
  await add(`one-tap/photos/${clip.id}.json`, `clips/${clip.id}.json`);
  // A generated photo keeps its Create image record, so its recipe travels with it.
  if (await stat(path.join(data, `images/${clip.id}.json`)).catch(() => null))
    await add(`one-tap/photos/${clip.id}.image.json`, `images/${clip.id}.json`);
}
for (const id of photos) await photo(await read(`clips/${id}.json`));

for (const id of jobIds) {
  const job = await read(`one-tap/${id}.json`);
  if (job.state !== 'ready' || !job.exports.watermark)
    throw Error(`${job.preset.id} is not a finished effect with its watermark cut.`);
  const folder = `one-tap/${job.preset.id}`;
  // The example opens on the shared cut; a visitor's own toggle re-cuts on the CPU.
  const recorded = { ...job, watermark: true, exports: { watermark: job.exports.watermark } };
  for (const clip of [job.source, job.frame, ...(job.still ? [job.still] : [])]) await photo(clip);
  for (const attempt of job.attempts) {
    // The graded take is all an effect cuts; its ungraded copy stays out of the repository.
    const { rawOutput: _raw, ...take } = await read(`renders/${attempt.renderId}.json`);
    await add(`${folder}/take-${attempt.seed}.json`, `renders/${take.id}.json`, json(take));
    await add(`${folder}/take-${attempt.seed}.mp4`, `outputs/${take.id}.mp4`);
  }
  const filmId = job.exports.watermark.filmId;
  await add(`${folder}/result.mp4`, `films/${filmId}.mp4`);
  await add(`${folder}/film.json`, `films/${filmId}.json`);
  await add(`${folder}/effect.json`, `one-tap/${job.id}.json`, json(recorded));
  console.log(`${job.preset.id}: ${job.attempts.length} take(s), film ${filmId}`);
}
manifest.files = [...files.values()];
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifest lists ${manifest.files.length} files.`);
