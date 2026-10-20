import { execFileSync } from 'node:child_process';
import { asset, render } from './api.mjs';
import { scenes, files, T } from './edit.mjs';
const OUT = process.argv[2];
const shots = [];
for (const sc of scenes) {
  const file = `${OUT}/scenes/${sc.name.slice(0, 2)}.mp4`;
  const imported = await asset(file, `scene-${sc.name.slice(0, 2)}.mp4`);
  const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString());
  const expected = Math.round(T(sc.b) * 24) - Math.round(T(sc.a) * 24);
  if (frames !== expected) throw Error(`${sc.name}: ${frames} frames, expected ${expected}`);
  shots.push({ assetId: imported.id, start: 0, end: frames / 24 });
}
const total = shots.reduce((sum, shot) => sum + Math.round(shot.end * 24), 0) / 24;
const music = await asset(files.music, 'music.mp3');
const draft = {
  name: 'Then comes the Aftertake', aspect: 'landscape', resolution: '1080p',
  shots, sourceVolume: 0, normalizeAudio: false,
  audio: [{ assetId: music.id, start: 0, sourceStart: 0, sourceEnd: total, volume: 0.75, fadeOut: 1.6 }],
};
console.log(`master: ${shots.length} scenes, ${total.toFixed(3)}s`);
await render(draft, `master-${Date.now()}`, `${OUT}/then-comes-the-aftertake.mp4`);
