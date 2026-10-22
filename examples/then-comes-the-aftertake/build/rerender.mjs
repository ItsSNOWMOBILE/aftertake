// Re-render the seven scene projects with sharpened plates, then join them over a soundtrack.
//   node rerender.mjs ../work/sharp path/to/soundtrack.wav
// Reads ../work/plates.json and ../work/replace.json from build/sharpen.py. Each
// scene keeps its shots, timing, titles and graphics; only the plate files change.
// The soundtrack is the released film's audio, already placed and mixed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asset, render } from './api.mjs';

const FILM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = process.env.AFTERTAKE_FILM_WORK || path.join(FILM, 'work');
const [OUT, soundtrack] = process.argv.slice(2);
if (!OUT || !soundtrack) throw Error('Usage: node rerender.mjs OUTPUT_FOLDER SOUNDTRACK');
const plates = JSON.parse(readFileSync(`${WORK}/plates.json`, 'utf8'));
const replace = JSON.parse(readFileSync(`${WORK}/replace.json`, 'utf8'));
const idFor = async (sha) => {
  const file = replace[sha] || plates[sha];
  return (await asset(file, path.basename(file))).id;
};
const frames = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString());
mkdirSync(OUT, { recursive: true });
const scenes = [];
for (const n of ['01', '02', '03', '04', '05', '06', '07']) {
  const project = JSON.parse(readFileSync(`${FILM}/project/scene-${n}.json`, 'utf8'));
  const shots = [];
  for (const { title, sha256, asset: info, ...shot } of project.shots)
    shots.push({ ...shot, assetId: await idFor(sha256 || info.sha256) });
  const graphics = [];
  for (const { sha256, ...graphic } of project.graphics || [])
    graphics.push(graphic.assetId ? { ...graphic, assetId: await idFor(sha256) } : graphic);
  const file = `${OUT}/${n}.mp4`;
  await render({
    name: project.name, aspect: project.aspect, resolution: project.resolution, shots, titles: project.titles,
    ...(graphics.length ? { graphics } : {}), audio: [], sourceVolume: project.sourceVolume,
    normalizeAudio: project.normalizeAudio,
  }, `${project.name.replace(/\W+/g, '-')}-${Date.now()}`, file);
  const expected = Math.round(project.duration * 24);
  if (frames(file) !== expected) throw Error(`${project.name}: ${frames(file)} frames, expected ${expected}`);
  scenes.push(file);
}
const shots = [];
for (const file of scenes)
  shots.push({ assetId: (await asset(file, path.basename(file))).id, start: 0, end: frames(file) / 24 });
const total = shots.reduce((sum, shot) => sum + Math.round(shot.end * 24), 0) / 24;
const audio = await asset(soundtrack, 'soundtrack.wav');
await render({
  name: 'Then comes the Aftertake', aspect: 'landscape', resolution: '1080p', shots, sourceVolume: 0,
  normalizeAudio: false,
  audio: [{ assetId: audio.id, start: 0, sourceStart: 0, sourceEnd: Math.min(audio.duration, total), volume: 1 }],
}, `master-${Date.now()}`, `${OUT}/then-comes-the-aftertake.mp4`);
