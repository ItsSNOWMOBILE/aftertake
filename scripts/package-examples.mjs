// Maintainer utility: package only these reviewed renders, never the whole library.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.join(root, 'examples');
const python = path.join(
  root,
  '.runtime/venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const cases = [
  {
    slug: 'reclaimed',
    title: 'Reclaimed',
    renderId: 'ca56f918-ba61-4935-86ca-13814f22d56c',
    credit: 'Original procedural source by Aftertake contributors',
    license: 'MIT source; model terms apply to generated results',
  },
  {
    slug: 'portal',
    title: 'An opening elsewhere',
    renderId: '2a7c74eb-8313-499e-8276-6d598b0ac6d1',
    credit: 'Curtis Adams / Pexels',
    sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/',
    license: 'Pexels License; model terms also apply to generated results',
  },
  {
    slug: 'golden-falls',
    title: 'The golden falls',
    renderId: 'c729f8fb-5919-4152-be2c-8eeb56c3ffcf',
    credit: 'Mikhail Nilov / Pexels',
    sourceUrl: 'https://www.pexels.com/video/waterfall-in-the-middle-of-the-forest-6989026/',
    license: 'Pexels License; model terms also apply to generated results',
  },
  {
    slug: 'quiet-approach',
    title: 'A quiet approach',
    renderId: 'ade9d68a-6a3f-431d-8970-2b37f482aa4f',
    workspace: '.data-demo',
    studio: 'http://127.0.0.1:4312',
    credit: 'Curtis Adams / Pexels; still extracted from the licensed room source',
    sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/',
    license: 'Pexels License; model terms also apply to generated results',
  },
  {
    slug: 'guided-pullback',
    title: 'Beyond the frame',
    renderId: '4d104079-d530-47dd-936f-dade1212be0b',
    workspace: '.data-demo',
    studio: 'http://127.0.0.1:4312',
    credit: 'Curtis Adams / Pexels; still extracted from the licensed room source',
    sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/',
    license: 'Pexels License; model terms also apply to generated results',
  },
  {
    slug: 'reference-portal',
    title: 'An image to follow',
    renderId: '49b0792c-855f-43ed-b656-403351bb0976',
    workspace: '.runtime/showcase-data',
    studio: 'http://127.0.0.1:4314',
    credit:
      'Curtis Adams / Pexels; edited reference extracted from the earlier Aftertake portal render',
    sourceUrl: 'https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/',
    license: 'Pexels License; model terms also apply to generated results and the edited reference',
  },
  {
    slug: 'crystal-forest',
    title: 'The forest keeps a secret',
    renderId: 'bbe90566-782e-49c2-b308-43a1643103d9',
    frameEditId: '5009120d-9816-41d2-9733-032b32541a1f',
    workspace: '.runtime/showcase-v3-data',
    studio: 'http://127.0.0.1:4314',
    credit: 'Mikhail Nilov / Pexels; appearance edited locally with Qwen-Image-Edit-2511',
    sourceUrl: 'https://www.pexels.com/video/waterfall-in-the-middle-of-the-forest-6989026/',
    license: 'Pexels License; Qwen and LTX model terms apply to generated results',
  },
];
cases.push(
  {
    slug: 'signal',
    title: 'Signal — a new character',
    renderId: 'd18450f0-a9ca-4a2b-9d24-fd75d00664c6',
    frameEditId: '729c2e07-8881-4a36-8125-3f86ddd26efe',
    workspace: '.runtime/showcase-v4-data',
    studio: 'http://127.0.0.1:4314',
    credit:
      'Original robot animation by Aftertake contributors; appearance created locally with Qwen-Image-Edit-2511',
    license: 'MIT source; Qwen and Wan model terms apply to generated results',
  },
  {
    slug: 'crystal-transition',
    title: 'Between falling water and crystal',
    renderId: '373aeb55-1569-411f-a541-7a7367617ec3',
    frameEditId: '5009120d-9816-41d2-9733-032b32541a1f',
    workspace: '.runtime/showcase-v4-data',
    studio: 'http://127.0.0.1:4314',
    credit: 'Mikhail Nilov / Pexels; ending image created locally with Qwen-Image-Edit-2511',
    sourceUrl: 'https://www.pexels.com/video/waterfall-in-the-middle-of-the-forest-6989026/',
    license: 'Pexels License; Qwen and LTX model terms apply to generated results',
  },
  {
    slug: 'coastal-kingdom',
    title: 'The coast becomes a kingdom',
    renderId: 'a1bad2db-e904-4e76-a9a3-90d467dffcd9',
    frameEditId: 'b1262e85-c2ba-4334-bc61-8faa573b106d',
    credit: 'Dean Diemert / Pexels; castle appearance edited locally with Qwen-Image-Edit-2511',
    sourceUrl:
      'https://www.pexels.com/video/a-lighthouse-is-seen-from-above-on-the-coast-20730898/',
    license: 'Pexels License; Qwen and LTX model terms apply to generated results',
  },
  {
    slug: 'castle-pullback',
    title: 'The tide keeps a secret',
    renderId: 'f15f0f87-510a-4ecb-9ef5-393fec7ea8e8',
    credit: 'Dean Diemert / Pexels; castle starting frame edited locally with Qwen-Image-Edit-2511',
    sourceUrl:
      'https://www.pexels.com/video/a-lighthouse-is-seen-from-above-on-the-coast-20730898/',
    license: 'Pexels License; Qwen and LTX model terms apply to generated results',
  },
  {
    slug: 'winter-valley',
    title: 'A season in a moment',
    renderId: '034b4b2f-2664-4636-8c17-44d64debe1c8',
    frameEditId: '1d1ed4f9-60f9-4ddb-91e6-6ba718c93fab',
    credit: 'Florian Delée / Pexels; winter appearance edited locally with Qwen-Image-Edit-2511',
    sourceUrl:
      'https://www.pexels.com/video/drone-captures-misty-mountains-in-france-at-sunrise-32651075/',
    license: 'Pexels License; Qwen and LTX model terms apply to generated results',
  },
  {
    slug: 'observatory',
    title: 'Above the clouds',
    renderId: '8abae2a5-bd8a-4f45-8d36-8f024635c8cf',
    imageGenerationId: '3fe583c9-b872-4995-985e-39085d87ab80',
    workspace: '.runtime/kinetic-review-data',
    credit:
      'Original scene generated locally from text with Z-Image Turbo, then animated with LTX-2.5',
    license: 'Z-Image Turbo Apache-2.0; LTX model terms apply to generated results',
  },
);
const manifest = {
  format: 'aftertake-examples/1',
  featuredRenderId: cases[1].renderId,
  cases: [],
  files: [],
};
const seen = new Set();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
};
const previous = JSON.parse(await readFile(path.join(examples, 'manifest.json'), 'utf8'));
const priorHashes = new Map(previous.files.map((item) => [item.source, item.sha256]));
async function thumbnail(clip, time, data) {
  const target = `previews/${digest(`thumbnail/1:${clip.sha256}:${time}`)}.jpg`;
  if (seen.has(target)) return;
  const file = path.join(examples, target);
  const cached = await readFile(file).catch(() => null);
  if (!cached || digest(cached) !== priorHashes.get(target)) {
    const source = path.join(data, 'clips', path.basename(clip.url));
    if (digest(await readFile(source)) !== clip.sha256)
      throw Error('Thumbnail source hash mismatch');
    await mkdir(path.dirname(file), { recursive: true });
    execFileSync(python, [path.join(root, 'scripts/thumbnail.py'), source, file, String(time)]);
  }
  await asset(file, target);
}
async function asset(file, target) {
  if (seen.has(target)) return;
  seen.add(target);
  const bytes = await readFile(file);
  manifest.files.push({
    source: path.relative(examples, file).split(path.sep).join('/'),
    target,
    sha256: digest(bytes),
    size: bytes.length,
  });
}
for (const item of cases) {
  const folder = path.join(examples, item.slug);
  await mkdir(folder, { recursive: true });
  const data = path.join(root, item.workspace || '.data');
  const render = JSON.parse(
    await readFile(path.join(data, 'renders', `${item.renderId}.json`), 'utf8'),
  );
  if (render.state !== 'succeeded' || !render.output)
    throw new Error(`${item.slug} is not a completed render`);
  const clip = render.recipe.clip;
  const source = path.join(data, 'clips', path.basename(clip.url));
  if (digest(await readFile(source)) !== clip.sha256)
    throw new Error(`${item.slug} source hash mismatch`);
  const sourceName = clip.kind === 'image' ? 'source.png' : 'source.mp4';
  await copyFile(source, path.join(folder, sourceName));
  await json(path.join(folder, 'clip.json'), clip);
  await json(path.join(folder, 'recipe.json'), render.recipe);
  let referenceName, frameRecipeName, imageRecipeName;
  const reference =
    render.recipe.pipeline === 'cinema'
      ? render.recipe.endFrame
      : render.recipe.pipeline === 'motion-transfer'
        ? render.recipe.transfer?.reference
        : render.recipe.editReference;
  if (reference) {
    const original = path.join(data, 'clips', path.basename(reference.url));
    if (digest(await readFile(original)) !== reference.sha256)
      throw new Error(`${item.slug} reference hash mismatch`);
    referenceName =
      render.recipe.pipeline === 'cinema'
        ? 'ending-frame.png'
        : render.recipe.pipeline === 'motion-transfer'
          ? 'appearance.png'
          : 'edited-first-frame.png';
    await copyFile(original, path.join(folder, referenceName));
    await json(path.join(folder, 'reference.json'), reference);
    await asset(path.join(folder, referenceName), `clips/${path.basename(reference.url)}`);
    await asset(path.join(folder, 'reference.json'), `clips/${reference.id}.json`);
    await thumbnail(reference, 0, data);
  }
  if (item.frameEditId) {
    const edit = JSON.parse(
      await readFile(path.join(data, 'frame-edits', `${item.frameEditId}.json`), 'utf8'),
    );
    if (
      edit.state !== 'succeeded' ||
      edit.clip?.sha256 !== reference?.sha256 ||
      edit.request.clip.sha256 !== clip.sha256 ||
      edit.request.trimStart !== render.recipe.trimStart
    )
      throw new Error('Frame-edit provenance does not match the video recipe');
    if (/[A-Za-z]:[\\/]/.test(JSON.stringify(edit)))
      throw new Error('Refusing to package machine-specific frame-edit paths');
    await json(path.join(folder, 'frame-edit.json'), edit);
    await asset(path.join(folder, 'frame-edit.json'), `frame-edits/${edit.id}.json`);
    frameRecipeName = 'frame-recipe.json';
    await json(path.join(folder, frameRecipeName), {
      format: 'aftertake-frame-edit/1',
      request: edit.request,
      workflow: edit.workflow,
      output: edit.clip,
      jobId: edit.jobId,
    });
    await asset(path.join(folder, frameRecipeName), `frame-recipes/${render.id}.json`);
  }
  if (item.imageGenerationId) {
    const image = JSON.parse(
      await readFile(path.join(data, 'images', `${item.imageGenerationId}.json`), 'utf8'),
    );
    if (
      image.state !== 'succeeded' ||
      image.clip?.sha256 !== clip.sha256 ||
      image.request.format !== 'aftertake-image/1'
    )
      throw Error('Image-generation provenance does not match the video source');
    const actual = JSON.parse(
      execFileSync(
        python,
        [
          '-c',
          'from PIL import Image\nimport sys\nwith Image.open(sys.argv[1]) as image: print(image.info["prompt"])',
          source,
        ],
        { encoding: 'utf8' },
      ),
    );
    if (JSON.stringify(actual) !== JSON.stringify(image.workflow))
      throw Error('Image metadata differs from the executed generation graph');
    if (/[A-Za-z]:[\\/]/.test(JSON.stringify(image)))
      throw Error('Refusing to package machine-specific image-generation paths');
    await json(path.join(folder, 'image-generation.json'), image);
    await asset(path.join(folder, 'image-generation.json'), `images/${image.id}.json`);
    imageRecipeName = 'image-recipe.json';
    await json(path.join(folder, imageRecipeName), {
      format: 'aftertake-image/1',
      request: image.request,
      workflow: image.workflow,
      output: image.clip,
      jobId: image.jobId,
    });
    await asset(path.join(folder, imageRecipeName), `image-recipes/${render.id}.json`);
  }
  for (const [field, name, suffix] of [
    ['output', 'result.mp4', ''],
    ['rawOutput', 'raw.mp4', '-raw'],
    ['coarseOutput', 'coarse.mp4', '-coarse'],
    ['guideOutput', 'guide.mp4', '-guide'],
  ]) {
    if (!render[field]) continue;
    const original = path.join(data, 'outputs', path.basename(render[field]));
    const sameResult =
      field !== 'output' &&
      digest(await readFile(original)) === digest(await readFile(path.join(folder, 'result.mp4')));
    const destination = path.join(folder, sameResult ? 'result.mp4' : name);
    if (!sameResult) await copyFile(original, destination);
    await asset(destination, `outputs/${render.id}${suffix}.mp4`);
  }
  // Preserve the graph actually recorded by ComfyUI in the generated MP4.
  const meta = JSON.parse(
    execFileSync(
      python,
      [
        '-c',
        'import av,json,sys\nwith av.open(sys.argv[1]) as c: print(c.metadata["comment"])',
        path.join(folder, 'result.mp4'),
      ],
      { encoding: 'utf8', maxBuffer: 2 ** 20 },
    ),
  );
  if (/[A-Za-z]:[\\/]/.test(JSON.stringify(meta)))
    throw new Error('Refusing to package machine-specific paths');
  render.workflow = meta.workflow;
  execFileSync(python, [
    path.join(root, 'scripts/make-poster.py'),
    path.join(folder, 'result.mp4'),
    path.join(folder, 'poster.jpg'),
  ]);
  await asset(path.join(folder, 'poster.jpg'), `posters/${item.slug}.jpg`);
  await json(path.join(folder, 'workflow-api.json'), meta.workflow);
  await json(path.join(folder, 'render.json'), render);
  await asset(path.join(folder, sourceName), `clips/${path.basename(clip.url)}`);
  await asset(path.join(folder, 'clip.json'), `clips/${clip.id}.json`);
  await asset(path.join(folder, 'render.json'), `renders/${render.id}.json`);
  // Cache every 24-fps source position so trim and quality changes also work
  // without Python. These are tiny JPEGs, not additional video decoders.
  const durations = [
    Math.min(49, Math.floor((clip.duration * 16 - 1) / 8) * 8 + 1) / 16,
    Math.min(97, Math.floor((clip.duration * 24 - 1) / 8) * 8 + 1) / 24,
  ];
  const times = [
    Math.min(1, clip.duration / 2),
    ...durations.flatMap((duration) => Array.from({ length: 10 }, (_, i) => (duration * i) / 10)),
    ...Array.from({ length: Math.ceil(clip.duration * 24) }, (_, i) => i / 24),
  ];
  for (const requested of times) {
    const time =
      clip.kind === 'image'
        ? 0
        : Math.round(Math.max(0, Math.min(clip.duration - 0.05, requested)) * 24) / 24;
    await thumbnail(clip, time, data);
  }
  const { workspace, studio, frameEditId, imageGenerationId, ...publicItem } = item;
  manifest.cases.push({
    ...publicItem,
    source: `${item.slug}/${sourceName}`,
    result: `${item.slug}/result.mp4`,
    poster: `${item.slug}/poster.jpg`,
    ...(referenceName ? { reference: `${item.slug}/${referenceName}` } : {}),
    ...(frameRecipeName ? { frameRecipe: `${item.slug}/${frameRecipeName}` } : {}),
    ...(imageRecipeName ? { imageRecipe: `${item.slug}/${imageRecipeName}` } : {}),
    recipe: `${item.slug}/recipe.json`,
    workflow: `${item.slug}/workflow-api.json`,
  });
}
// Separately reviewed native text-to-video fixtures keep their own request/job
// records. Preserve their explicit manifest entries when repackaging the VFX set.
for (const item of previous.files.filter((item) => item.source.startsWith('text-video/')))
  await asset(path.join(examples, ...item.source.split('/')), item.target);
await json(path.join(examples, 'manifest.json'), manifest);
console.log(
  `Packaged ${cases.length} reviewed examples: ${(manifest.files.reduce((sum, f) => sum + f.size, 0) / 2 ** 20).toFixed(1)} MiB.`,
);
