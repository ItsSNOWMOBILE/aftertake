// Render candidate soundtracks with open-weight ACE-Step 1.5 on Comfy Cloud.
// Needs COMFY_API_KEY (read by the Comfy SDK). Writes ../work/songs/seed-N.mp3
// and a beat analysis for each; it spends Comfy Cloud credits per seed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Comfy } from '@comfyorg/sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const WORK = process.env.AFTERTAKE_FILM_WORK || path.resolve(HERE, '../work');
const out = path.join(WORK, 'songs');
await mkdir(out, { recursive: true });
if (!process.env.COMFY_API_KEY) throw Error('Set COMFY_API_KEY as an environment secret first.');

const song = JSON.parse(await readFile(path.join(HERE, 'song.json'), 'utf8'));
const graph = JSON.parse(await readFile(path.join(HERE, 'ace-step-1.5-xl-turbo.json'), 'utf8'));
const python = process.env.AFTERTAKE_PYTHON || 'python3';
const client = new Comfy({ timeoutMs: 60_000 });
const seeds = process.argv.slice(2).map(Number).filter(Number.isInteger);

for (const seed of seeds.length ? seeds : song.seeds) {
  const workflow = client.workflows.fromJson(structuredClone(graph));
  workflow.setInput('94', 'tags', song.tags);
  workflow.setInput('94', 'lyrics', song.lyrics);
  workflow.setInput('94', 'bpm', song.bpm);
  workflow.setInput('94', 'duration', song.seconds);
  workflow.setInput('94', 'keyscale', song.keyscale);
  workflow.setInput('98', 'seconds', song.seconds);
  workflow.setInput('109', 'value', seed);
  workflow.setInput('111', 'filename_prefix', `audio/aftertake-seed-${seed}`);
  const started = Date.now();
  const job = await client.run(workflow, { idempotencyKey: `aftertake-song-${seed}-${song.bpm}-${song.seconds}` });
  const [audio] = job.getOutputs('111');
  if (!audio) throw Error(`Seed ${seed}: the job returned no audio.`);
  const file = path.join(out, `seed-${seed}.mp3`);
  await audio.toFile(file);
  const beats = execFileSync(python, [path.join(ROOT, 'scripts/detect-beats.py'), file]).toString();
  await writeFile(file.replace(/\.mp3$/, '.beats.json'), beats);
  const { tempo, duration } = JSON.parse(beats);
  console.log(`seed ${seed}: ${((Date.now() - started) / 1000).toFixed(0)}s, ${tempo} BPM, ${duration.toFixed(1)}s → ${file}`);
}
