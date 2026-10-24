// Maintainer utility: record reviewed sets of takes as examples.
// usage: node scripts/package-take-examples.mjs WORKSPACE SLUG=TAKE_SET_ID...
// Copies each set and every take's studio record and media into examples/takes/SLUG
// and lists them in examples/manifest.json, so the comparison opens in --examples,
// the shared copy and the browser trial.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [workspace, ...pairs] = process.argv.slice(2);
if (!workspace || !pairs.length)
  throw Error('usage: node scripts/package-take-examples.mjs WORKSPACE SLUG=ID...');
const data = path.resolve(root, workspace);
const examples = path.join(root, 'examples');
const manifestFile = path.join(examples, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const files = new Map(manifest.files.map((file) => [file.target, file]));
const read = async (relative) => JSON.parse(await readFile(path.join(data, relative), 'utf8'));

/** Copy one workspace file (or the given bytes) into examples at the same workspace path. */
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
/** A source clip with the studio thumbnail the browser trial shows for it. */
async function clip(folder, name, record) {
  await add(`${folder}/${name}${path.extname(record.url)}`, `clips/${path.basename(record.url)}`);
  await add(`${folder}/${name}.clip.json`, `clips/${record.id}.json`);
  const thumbnail = `${createHash('sha256').update(`thumbnail/1:${record.sha256}:0`).digest('hex')}.jpg`;
  await add(`previews/${thumbnail}`, `previews/${thumbnail}`);
}

for (const pair of pairs) {
  const [slug, id] = pair.split('=');
  const set = await read(`take-sets/${id}.json`);
  if (set.state !== 'ready') throw Error(`${slug} is not a finished set of takes.`);
  const folder = `takes/${slug}`;
  if (set.kind === 'frame') await clip(folder, 'source', set.request.clip);
  for (const [index, take] of set.takes.entries()) {
    if (take.state !== 'succeeded') continue;
    const name = `take-${index + 1}`;
    if (set.kind === 'frame') {
      // The graded take is what the comparison plays; its ungraded copy stays out.
      const { rawOutput: _raw, ...render } = await read(`renders/${take.id}.json`);
      await add(
        `${folder}/${name}.json`,
        `renders/${take.id}.json`,
        Buffer.from(JSON.stringify(render, null, 2) + '\n'),
      );
      await add(`${folder}/${name}.mp4`, `outputs/${take.id}.mp4`);
    } else {
      const studio = set.kind === 'image' ? 'images' : 'videos';
      const record = await read(`${studio}/${take.id}.json`);
      await add(`${folder}/${name}.json`, `${studio}/${take.id}.json`);
      await clip(folder, name, record.clip);
    }
  }
  await add(`${folder}/set.json`, `take-sets/${set.id}.json`);
  console.log(`${slug}: ${set.kind}, ${set.takes.length} takes${set.kept ? ', one kept' : ''}`);
}
manifest.files = [...files.values()];
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifest lists ${manifest.files.length} files.`);
