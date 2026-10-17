// Read-only integration check against the running ComfyUI node schema.
import { readFile } from 'node:fs/promises';
import { buildWorkflow } from '../server/workflow.ts';
import { defaultCinema } from '../src/cinema.ts';
import { buildFrameEditWorkflow } from '../server/frame-workflow.ts';

const origin = process.env.COMFY_UI_URL || 'http://127.0.0.1:8188';
const response = await fetch(`${origin}/object_info`, { signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error('Start the local engine before checking its node contract.');
const schema = await response.json();
const sample = JSON.parse(await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'));
const reference = JSON.parse(await readFile(new URL('../examples/quiet-approach/clip.json', import.meta.url), 'utf8'));
const failures = [];
function check(label, graph) {
  for (const [id, node] of Object.entries(graph)) {
    const definition = schema[node.class_type];
    if (!definition) { failures.push(`${label}: missing ${node.class_type}`); continue; }
    for (const name of Object.keys(definition.input?.required || {})) {
      if (!(name in node.inputs)) failures.push(`${label}: ${node.class_type} ${id} requires ${name}`);
    }
    for (const [name, input] of Object.entries(node.inputs)) {
      if (!Array.isArray(input) || input.length !== 2 || typeof input[0] !== 'string' || !Number.isInteger(input[1])) continue;
      const source = graph[input[0]];
      if (!source || input[1] >= (schema[source.class_type]?.output?.length || 0)) failures.push(`${label}: ${id}.${name} has an invalid output link`);
    }
  }
}
for (const profile of ['structure', 'inpaint', 'cinema', 'motion', 'inpaint-reference']) for (const quality of ['draft', 'final']) {
  const pipeline = profile === 'motion' ? 'cinema' : profile === 'inpaint-reference' ? 'inpaint' : profile;
  const graph = buildWorkflow({ ...sample, pipeline, quality, editReference: profile === 'inpaint-reference' ? reference : undefined, cinema: { ...defaultCinema, guidance: profile === 'motion' ? 'tracks' : 'prompt' } });
  check(`${profile}/${quality}`, graph);
}
for (const mode of ['fast', 'detail']) for (const subject of [undefined, { ...reference, kind: 'image' }])
  check(`frame-edit/${mode}/${subject ? 'subject' : 'source-only'}`, buildFrameEditWorkflow({ format: 'aftertake-frame-edit/1', clip: sample.clip,
    trimStart: 0, prompt: 'Replace the selected object, preserving the surrounding scene.', seed: 731, mode, subject }));
if (failures.length) throw new Error(failures.join('\n'));
console.log('All fourteen workflow variants satisfy the live required-input and output-link contracts. No jobs submitted.');
