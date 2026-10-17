// Maintainer utility: package only these reviewed renders, never the whole library.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.join(root, 'examples');
const python = path.join(root, '.runtime/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const cases = [
  { slug: 'reclaimed', title: 'Reclaimed', renderId: 'ca56f918-ba61-4935-86ca-13814f22d56c', credit: 'Original procedural source by Aftertake contributors', license: 'MIT source; model terms apply to generated results' },
  { slug: 'portal', title: 'An opening elsewhere', renderId: '2a7c74eb-8313-499e-8276-6d598b0ac6d1', credit: 'Curtis Adams / Pexels', sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/', license: 'Pexels License; model terms also apply to generated results' },
  { slug: 'golden-falls', title: 'The golden falls', renderId: 'c729f8fb-5919-4152-be2c-8eeb56c3ffcf', credit: 'Mikhail Nilov / Pexels', sourceUrl: 'https://www.pexels.com/video/waterfall-in-the-middle-of-the-forest-6989026/', license: 'Pexels License; model terms also apply to generated results' },
  { slug: 'quiet-approach', title: 'A quiet approach', renderId: 'ade9d68a-6a3f-431d-8970-2b37f482aa4f', workspace: '.data-demo', studio: 'http://127.0.0.1:4312', credit: 'Curtis Adams / Pexels; still extracted from the licensed room source', sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/', license: 'Pexels License; model terms also apply to generated results' },
  { slug: 'guided-pullback', title: 'Beyond the frame', renderId: '4d104079-d530-47dd-936f-dade1212be0b', workspace: '.data-demo', studio: 'http://127.0.0.1:4312', credit: 'Curtis Adams / Pexels; still extracted from the licensed room source', sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/', license: 'Pexels License; model terms also apply to generated results' },
  { slug: 'reference-portal', title: 'An image to follow', renderId: '49b0792c-855f-43ed-b656-403351bb0976', workspace: '.runtime/showcase-data', studio: 'http://127.0.0.1:4314', credit: 'Curtis Adams / Pexels; edited reference extracted from the earlier Aftertake portal render', sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/', license: 'Pexels License; model terms also apply to generated results and the edited reference' },
];
const manifest = { format: 'aftertake-examples/1', featuredRenderId: cases[1].renderId, cases: [], files: [] };
const seen = new Set();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
async function asset(file, target) {
  if (seen.has(target)) return;
  seen.add(target);
  const bytes = await readFile(file);
  manifest.files.push({ source: path.relative(examples, file).split(path.sep).join('/'), target, sha256: digest(bytes), size: bytes.length });
}
for (const item of cases) {
  const folder = path.join(examples, item.slug);
  await mkdir(folder, { recursive: true });
  const data = path.join(root, item.workspace || '.data');
  const render = JSON.parse(await readFile(path.join(data, 'renders', `${item.renderId}.json`), 'utf8'));
  if (render.state !== 'succeeded' || !render.output) throw new Error(`${item.slug} is not a completed render`);
  const clip = render.recipe.clip;
  const source = path.join(data, 'clips', path.basename(clip.url));
  if (digest(await readFile(source)) !== clip.sha256) throw new Error(`${item.slug} source hash mismatch`);
  const sourceName = clip.kind === 'image' ? 'source.png' : 'source.mp4';
  await copyFile(source, path.join(folder, sourceName));
  await json(path.join(folder, 'clip.json'), clip);
  await json(path.join(folder, 'recipe.json'), render.recipe);
  let referenceName;
  if (render.recipe.editReference) {
    const reference = render.recipe.editReference;
    const original = path.join(data, 'clips', path.basename(reference.url));
    if (digest(await readFile(original)) !== reference.sha256) throw new Error(`${item.slug} reference hash mismatch`);
    referenceName = 'edited-first-frame.png';
    await copyFile(original, path.join(folder, referenceName));
    await json(path.join(folder, 'reference.json'), reference);
    await asset(path.join(folder, referenceName), `clips/${path.basename(reference.url)}`);
    await asset(path.join(folder, 'reference.json'), `clips/${reference.id}.json`);
    const key = digest(`thumbnail/1:${reference.sha256}:0`), target = `previews/${key}.jpg`;
    if (!seen.has(target)) {
      const response = await fetch(`${item.studio || 'http://127.0.0.1:4310'}/api/thumbnails/${reference.id}?time=0`);
      if (!response.ok || !response.headers.get('content-type')?.includes('image/jpeg')) throw new Error('Reference thumbnail generation failed');
      const file = path.join(examples, target); await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(await response.arrayBuffer())); await asset(file, target);
    }
  }
  for (const [field, name, suffix] of [['output', 'result.mp4', ''], ['rawOutput', 'raw.mp4', '-raw'], ['coarseOutput', 'coarse.mp4', '-coarse'], ['guideOutput', 'guide.mp4', '-guide']]) {
    if (!render[field]) continue;
    const destination = path.join(folder, name);
    await copyFile(path.join(data, 'outputs', path.basename(render[field])), destination);
    await asset(destination, `outputs/${render.id}${suffix}.mp4`);
  }
  // Preserve the graph actually recorded by ComfyUI in the generated MP4.
  const meta = JSON.parse(execFileSync(python, ['-c', 'import av,json,sys\nwith av.open(sys.argv[1]) as c: print(c.metadata["comment"])', path.join(folder, 'result.mp4')], { encoding: 'utf8', maxBuffer: 2 ** 20 }));
  if (/[A-Za-z]:[\\/]/.test(JSON.stringify(meta))) throw new Error('Refusing to package machine-specific paths');
  render.workflow = meta.workflow;
  execFileSync(python, [path.join(root, 'scripts/make-poster.py'), path.join(folder, 'result.mp4'), path.join(folder, 'poster.jpg')]);
  await asset(path.join(folder, 'poster.jpg'), `posters/${item.slug}.jpg`);
  await json(path.join(folder, 'workflow-api.json'), meta.workflow);
  await json(path.join(folder, 'render.json'), render);
  await asset(path.join(folder, sourceName), `clips/${path.basename(clip.url)}`);
  await asset(path.join(folder, 'clip.json'), `clips/${clip.id}.json`);
  await asset(path.join(folder, 'render.json'), `renders/${render.id}.json`);
  // Cache every 24-fps source position so trim and quality changes also work
  // without Python. These are tiny JPEGs, not additional video decoders.
  const durations = [Math.min(49, Math.floor((clip.duration * 16 - 1) / 8) * 8 + 1) / 16,
    Math.min(97, Math.floor((clip.duration * 24 - 1) / 8) * 8 + 1) / 24];
  const times = [Math.min(1, clip.duration / 2), ...durations.flatMap(duration => Array.from({ length: 10 }, (_, i) => duration * i / 10)),
    ...Array.from({ length: Math.ceil(clip.duration * 24) }, (_, i) => i / 24)];
  for (const requested of times) {
    const time = clip.kind === 'image' ? 0 : Math.round(Math.max(0, Math.min(clip.duration - .05, requested)) * 24) / 24;
    const key = digest(`thumbnail/1:${clip.sha256}:${time}`);
    const target = `previews/${key}.jpg`;
    if (seen.has(target)) continue;
    const response = await fetch(`${item.studio || process.env.AFTERTAKE_STUDIO_URL || 'http://127.0.0.1:4310'}/api/thumbnails/${clip.id}?time=${requested}`);
    if (!response.ok || !response.headers.get('content-type')?.includes('image/jpeg')) throw new Error('Thumbnail generation failed');
    const file = path.join(examples, target);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    await asset(file, target);
  }
  const { workspace, studio, ...publicItem } = item;
  manifest.cases.push({ ...publicItem, source: `${item.slug}/${sourceName}`, result: `${item.slug}/result.mp4`, poster: `${item.slug}/poster.jpg`, ...(referenceName ? { reference: `${item.slug}/${referenceName}` } : {}), recipe: `${item.slug}/recipe.json`, workflow: `${item.slug}/workflow-api.json` });
}
await json(path.join(examples, 'manifest.json'), manifest);
console.log(`Packaged ${cases.length} reviewed examples: ${(manifest.files.reduce((sum, f) => sum + f.size, 0) / 2 ** 20).toFixed(1)} MiB.`);
