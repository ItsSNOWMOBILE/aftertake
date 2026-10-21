import { execFileSync } from 'node:child_process';
import { asset, render } from './api.mjs';
import { scenes, files, resolveShots, nativeGraphic, nativeTitle, T } from './edit.mjs';
const OUT = process.argv[2];
const only = process.argv.slice(3);
const assets = {}, durations = {};
for (const [key, file] of Object.entries(files)) {
  if (key === 'uiFilm' && !only.includes('06')) continue;
  assets[key] = await asset(file, `${key}${file.slice(file.lastIndexOf('.'))}`);
  durations[key] = /\.(png|jpg)$/.test(file) ? 600 : Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', file]).toString().trim() || assets[key].duration);
}
for (const sc of scenes) {
  if (only.length && !only.some((id) => sc.name.startsWith(id))) continue;
  const expectedFrames = Math.round(T(sc.b) * 24) - Math.round(T(sc.a) * 24);
  const fit = (layer) => ({ ...layer, end: Math.min(layer.end, expectedFrames / 24) });
  sc.titles = sc.titles.map(fit);
  sc.graphics = sc.graphics.map(fit);
  const draft = {
    name: sc.name, aspect: 'landscape', resolution: '1080p', sourceVolume: 0, normalizeAudio: false,
    shots: resolveShots(sc, assets, durations),
    titles: sc.titles.map(nativeTitle),
    ...(sc.graphics.length ? { graphics: sc.graphics.map((g) => nativeGraphic(g, assets)) } : {}),
  };
  const expected = Math.round(T(sc.b) * 24) - Math.round(T(sc.a) * 24);
  console.log(`${sc.name}: ${draft.shots.length} shots, ${draft.titles.length} titles, ${expected} frames expected`);
  await render(draft, `${sc.name.replace(/\W+/g, '-')}-${Date.now()}`, `${OUT}/${sc.name.slice(0, 2)}.mp4`);
  const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', `${OUT}/${sc.name.slice(0, 2)}.mp4`]).toString());
  if (frames !== expected) console.warn(`  ! ${sc.name} has ${frames} frames, expected ${expected}`);
}
