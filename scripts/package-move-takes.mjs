// Maintainer utility: copy each camera move's preview take into examples/camera-moves.
// usage: node scripts/package-move-takes.mjs WORKSPACE
// Takes are Animate a frame renders named "Camera move: <label>", all from one still;
// the newest finished take of each move is kept. scripts/build-move-previews.py then
// cuts the gallery loops from them.
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.resolve(root, process.argv[2] || '');
if (!process.argv[2]) throw Error('usage: node scripts/package-move-takes.mjs WORKSPACE');
// Only moves the studio still offers; a renamed move's older takes stay behind.
const cinema = await readFile(path.join(root, 'src/cinema.ts'), 'utf8');
const offered = new Set(
  cinema
    .slice(cinema.indexOf('export const cameraMovements = ['), cinema.indexOf('] as const;'))
    .match(/'[a-z0-9-]+'/g)
    .map((move) => move.slice(1, -1)),
);
const takes = new Map();
for (const name of await readdir(path.join(data, 'renders'))) {
  if (!name.endsWith('.json')) continue;
  const take = JSON.parse(await readFile(path.join(data, 'renders', name), 'utf8'));
  const move = take.recipe?.cinema?.movement;
  if (take.state !== 'succeeded' || !String(take.recipe?.name).startsWith('Camera move:')) continue;
  if (!offered.has(move)) continue;
  if (!takes.has(move) || takes.get(move).createdAt < take.createdAt) takes.set(move, take);
}
for (const [move, take] of takes) {
  const folder = path.join(root, 'examples/camera-moves', move);
  await mkdir(folder, { recursive: true });
  await copyFile(path.join(data, 'outputs', `${take.id}.mp4`), path.join(folder, 'take.mp4'));
  // The graded take is what the gallery shows; its ungraded copy stays out of the repository.
  const { rawOutput: _raw, ...record } = take;
  await writeFile(path.join(folder, 'take.json'), JSON.stringify(record, null, 2) + '\n');
}
console.log(`Copied ${takes.size} camera move takes to examples/camera-moves.`);
