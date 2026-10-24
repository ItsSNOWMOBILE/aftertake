// Maintainer utility: record reviewed storyboards as examples.
// usage: node scripts/package-storyboard-examples.mjs WORKSPACE SLUG=STORYBOARD_ID...
// Copies the storyboard, its shots (Create video records and clips), its song, the
// Film assets its project uses and the exported film into examples/storyboards/SLUG,
// and lists them in examples/manifest.json, so Open in Film works in --examples.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [workspace, ...pairs] = process.argv.slice(2);
if (!workspace || !pairs.length)
  throw Error('usage: node scripts/package-storyboard-examples.mjs WORKSPACE SLUG=ID...');
const data = path.resolve(root, workspace);
const examples = path.join(root, 'examples');
const manifestFile = path.join(examples, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const files = new Map(manifest.files.map((file) => [file.target, file]));
const read = async (relative) => JSON.parse(await readFile(path.join(data, relative), 'utf8'));

/** Copy one workspace file into examples and list it at the same workspace path. */
async function add(source, target) {
  const destination = path.join(examples, source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(data, target), destination);
  const written = await readFile(destination);
  files.set(target, {
    source,
    target,
    sha256: createHash('sha256').update(written).digest('hex'),
    size: written.length,
  });
}

for (const pair of pairs) {
  const [slug, id] = pair.split('=');
  const job = await read(`storyboards/${id}.json`);
  if (job.state !== 'ready' || !job.filmId) throw Error(`${slug} is not a finished storyboard.`);
  const folder = `storyboards/${slug}`;
  for (const [index, shot] of job.shots.entries()) {
    const name = path.basename(shot.clip.url);
    await add(`${folder}/shot-${index + 1}.mp4`, `clips/${name}`);
    await add(`${folder}/shot-${index + 1}.clip.json`, `clips/${shot.clip.id}.json`);
    await add(`${folder}/shot-${index + 1}.video.json`, `videos/${shot.videoId}.json`);
    // The browser trial shows each source by the studio's own first-frame thumbnail.
    const thumbnail = `${createHash('sha256').update(`thumbnail/1:${shot.clip.sha256}:0`).digest('hex')}.jpg`;
    await add(`previews/${thumbnail}`, `previews/${thumbnail}`);
  }
  const song = job.song.enhancementId;
  await add(`${folder}/song.json`, `enhancements/${song}.json`);
  await add(`${folder}/song.flac`, `enhancements/${song}.flac`);
  // The Film project opens on these assets: each shot and the song.
  for (const assetId of [...job.shots.map((shot) => shot.assetId), job.song.assetId]) {
    const asset = await read(`films/assets/${assetId}.json`);
    const role =
      asset.kind === 'audio'
        ? 'song'
        : `shot-${job.shots.findIndex((shot) => shot.assetId === assetId) + 1}`;
    await add(`${folder}/${role}.asset.json`, `films/assets/${assetId}.json`);
    // Film assets hold the same bytes as the shot clips and the song, so they share files.
    await add(
      asset.kind === 'audio' ? `${folder}/song.flac` : `${folder}/${role}.mp4`,
      `films/assets/${assetId}${asset.extension}`,
    );
  }
  await add(`${folder}/film.mp4`, `films/${job.filmId}.mp4`);
  await add(`${folder}/film.json`, `films/${job.filmId}.json`);
  await add(`${folder}/storyboard.json`, `storyboards/${job.id}.json`);
  console.log(`${slug}: ${job.shots.length} shots, film ${job.filmId}`);
}
manifest.files = [...files.values()];
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifest lists ${manifest.files.length} files.`);
