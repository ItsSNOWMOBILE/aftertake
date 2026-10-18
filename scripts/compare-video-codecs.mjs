// Controlled GPU comparison. Uses the installed local Comfy SDK endpoint.
import { Comfy } from '@comfyorg/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7) || 'castle-pullback';
if (!['castle-pullback', 'observatory', 'coastal-kingdom'].includes(slug))
  throw Error('Choose castle-pullback, observatory or coastal-kingdom.');
process.env.COMFY_BASE_URL ||= 'http://127.0.0.1:8189';
const folder = path.join(root, '.runtime', 'codec-comparisons', slug);
await mkdir(folder, { recursive: true });
const original = JSON.parse(
  await readFile(path.join(root, 'examples', slug, 'render.json'), 'utf8'),
);
const graph = structuredClone(original.workflow),
  refinement = original.recipe.pipeline === 'inpaint';
const tiled = (node, encoding = false) => ({
  class_type: encoding ? 'VAEEncodeTiled' : 'VAEDecodeTiled',
  inputs: {
    ...(encoding ? { pixels: node.inputs.pixels } : { samples: node.inputs.samples }),
    vae: node.inputs.vae,
    tile_size: 256,
    overlap: 64,
    temporal_size: 32,
    temporal_overlap: 8,
  },
});
graph['19'] = tiled(graph['19']);
if (refinement) {
  graph['30'] = tiled(graph['30'], true);
  graph['34'] = tiled(graph['34']);
}
// Share loaders, source, guides and the first sampler. Copy only the codec's
// descendants, preventing duplicate model instances on a 32 GB host.
const changed = new Set(
  refinement
    ? [
        '19',
        '28',
        '29',
        '30',
        '33',
        '34',
        '35',
        '20',
        '21',
        '22',
        '40',
        ...(graph['48'] ? ['48'] : []),
      ]
    : ['19', '20', '21', '22'],
);
for (const id of changed) {
  const node = structuredClone(graph[id]);
  for (const [key, value] of Object.entries(node.inputs))
    if (Array.isArray(value) && value.length === 2 && changed.has(value[0]))
      node.inputs[key] = [String(Number(value[0]) + 1000), value[1]];
  if (id === '19' || id === '34') {
    node.class_type = 'VAEDecode';
    node.inputs = { samples: node.inputs.samples, vae: node.inputs.vae };
  } else if (id === '30') {
    node.class_type = 'VAEEncode';
    node.inputs = { pixels: node.inputs.pixels, vae: node.inputs.vae };
  }
  if (node.class_type === 'AftertakeSaveVideo')
    node.inputs.filename_prefix = `aftertake/codec-comparison-${slug}-${id}`;
  graph[String(Number(id) + 1000)] = node;
}
const receipt = path.join(folder, 'job.json');
let state = await readFile(receipt, 'utf8')
  .then(JSON.parse)
  .catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
if (state && !state.jobId)
  throw Error(
    'A prior submission has an uncertain outcome. Inspect its original key in job.json before another submission.',
  );
const c = new Comfy();
let job;
if (state) job = await c.jobs.get(state.jobId);
else {
  state = {
    idempotencyKey: randomUUID(),
    createdAt: new Date().toISOString(),
    case: slug,
    experiment: refinement
      ? 'Same source, references, prompt, seeds and samplers; native video codecs throughout refinement.'
      : 'Same sampled latent decoded with short tiles and native video context.',
  };
  await writeFile(
    path.join(folder, 'requested-workflow.json'),
    JSON.stringify(graph, null, 2) + '\n',
  );
  await writeFile(receipt, JSON.stringify(state, null, 2) + '\n');
  const wf = c.workflows.fromJson(graph);
  wf.setInput(
    '8',
    'filename',
    c.assets.fromFile(
      path.join(
        root,
        'examples',
        slug,
        original.recipe.clip.kind === 'image' ? 'source.png' : 'source.mp4',
      ),
    ),
  );
  if (refinement && original.recipe.editReference)
    for (const id of ['45', '47'])
      if (graph[id])
        wf.setInput(
          id,
          'filename',
          c.assets.fromFile(path.join(root, 'examples', slug, 'edited-first-frame.png')),
        );
  if (original.recipe.endFrame)
    wf.setInput(
      '45',
      'filename',
      c.assets.fromFile(path.join(root, 'examples', slug, 'ending-frame.png')),
    );
  job = await c.submit(wf, { idempotencyKey: state.idempotencyKey });
  state.jobId = job.id;
  await writeFile(receipt, JSON.stringify(state, null, 2) + '\n');
}
let last;
while (true) {
  await job.refresh();
  state.status = job.status;
  state.checkedAt = new Date().toISOString();
  await writeFile(receipt, JSON.stringify(state, null, 2) + '\n');
  if (last !== job.status) {
    console.log(JSON.stringify({ jobId: job.id, status: job.status }));
    last = job.status;
  }
  if (['succeeded', 'failed', 'canceled', 'expired'].includes(job.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
if (job.status !== 'succeeded') {
  state.error = job.error;
  await writeFile(receipt, JSON.stringify(state, null, 2) + '\n');
  throw Error(JSON.stringify(job.error));
}
state.outputs = [];
for (const [node, name] of [
  ['21', 'tiled'],
  ['22', 'tiled-raw'],
  ['1021', 'native'],
  ['1022', 'native-raw'],
]) {
  const target = path.join(folder, `${name}.mp4`);
  await job.getOutputs(node)[0].toFile(target);
  const bytes = await readFile(target);
  state.outputs.push({
    node,
    file: path.basename(target),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
state.finishedAt = new Date().toISOString();
await writeFile(receipt, JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify(state, null, 2));
