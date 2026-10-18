// Read-only integration check against the running ComfyUI node schema.
import { readFile } from 'node:fs/promises';
import { buildWorkflow } from '../server/workflow.ts';
import { defaultCinema } from '../src/cinema.ts';
import { buildFrameEditWorkflow } from '../server/frame-workflow.ts';
import { buildCharacterWorkflow } from '../server/character-workflow.ts';
import { characterRequirements } from '../server/character-profile.ts';
import { buildVideoWorkflow, videoRequirements } from '../server/video-workflow.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = process.env.COMFY_UI_URL || 'http://127.0.0.1:8188';
const response = await fetch(`${origin}/object_info`, { signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error('Start the local engine before checking its node contract.');
const schema = await response.json();
const sample = JSON.parse(
  await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
);
const reference = JSON.parse(
  await readFile(new URL('../examples/quiet-approach/clip.json', import.meta.url), 'utf8'),
);
const failures = [];
function check(label, graph) {
  for (const [id, node] of Object.entries(graph)) {
    const definition = schema[node.class_type];
    if (!definition) {
      failures.push(`${label}: missing ${node.class_type}`);
      continue;
    }
    for (const name of Object.keys(definition.input?.required || {})) {
      if (!(name in node.inputs))
        failures.push(`${label}: ${node.class_type} ${id} requires ${name}`);
    }
    for (const [name, input] of Object.entries(node.inputs)) {
      if (
        !Array.isArray(input) ||
        input.length !== 2 ||
        typeof input[0] !== 'string' ||
        !Number.isInteger(input[1])
      )
        continue;
      const source = graph[input[0]];
      if (!source || input[1] >= (schema[source.class_type]?.output?.length || 0))
        failures.push(`${label}: ${id}.${name} has an invalid output link`);
    }
  }
}
for (const profile of [
  'structure',
  'inpaint',
  'cinema',
  'motion',
  'inpaint-reference',
  'cinema-ending',
  'motion-ending',
  'motion-transfer-frame',
  'motion-transfer-cue',
])
  for (const quality of ['draft', 'final']) {
    const pipeline = profile.startsWith('motion-transfer')
      ? 'motion-transfer'
      : ['motion', 'cinema-ending', 'motion-ending'].includes(profile)
        ? 'cinema'
        : profile === 'inpaint-reference'
          ? 'inpaint'
          : profile;
    const graph = buildWorkflow({
      ...sample,
      pipeline,
      quality,
      editReference: profile === 'inpaint-reference' ? reference : undefined,
      endFrame: profile.endsWith('-ending') ? { ...reference, kind: 'image' } : undefined,
      transfer:
        pipeline === 'motion-transfer'
          ? {
              reference: { ...reference, kind: 'image' },
              scope: profile.endsWith('cue') ? 'cue' : 'frame',
              motionCaption: 'A character waves.',
            }
          : undefined,
      cinema: { ...defaultCinema, guidance: profile.startsWith('motion') ? 'tracks' : 'prompt' },
    });
    check(`${profile}/${quality}`, graph);
  }
for (const mode of ['fast', 'detail'])
  for (const subject of [undefined, { ...reference, kind: 'image' }])
    check(
      `frame-edit/${mode}/${subject ? 'subject' : 'source-only'}`,
      buildFrameEditWorkflow({
        format: 'aftertake-frame-edit/1',
        clip: sample.clip,
        trimStart: 0,
        prompt: 'Replace the selected object, preserving the surrounding scene.',
        seed: 731,
        mode,
        subject,
      }),
    );
let characterVariants = 0;
let textVideoVariants = 0;
for (const aspect of ['landscape', 'portrait', 'square'])
  for (const quality of ['draft', 'final'])
    for (const sound of [false, true]) {
      const graph = buildVideoWorkflow({
        format: 'aftertake-text-video/1',
        name: 'Contract only',
        prompt: 'Steam rises from a coffee cup.',
        seed: 5090,
        aspect,
        quality,
        seconds: 3,
        sound,
      });
      check(`text-video/${aspect}/${quality}/${sound}`, graph);
      const required = new Set(videoRequirements().nodes);
      for (const node of Object.values(graph))
        if (!required.has(node.class_type))
          failures.push(`Text video preflight omits ${node.class_type}`);
      textVideoVariants++;
    }
if (process.argv.includes('--character')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const python =
    process.env.AFTERTAKE_PYTHON ||
    path.join(
      root,
      '.runtime/venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
  for (const resolution of ['480', '768']) {
    const selection = {
      format: 'aftertake-character-selection/1',
      clip: sample.clip,
      trimStart: 0,
      duration: 2,
      positive: [{ x: 0.5, y: 0.5 }],
      negative: [],
      resolution,
    };
    const graphs = [
      [
        'character/selection',
        await buildCharacterWorkflow(root, python, {
          id: 'contract-only',
          kind: 'selection',
          request: selection,
        }),
      ],
    ];
    for (const faceBox of [undefined, { x: 0.3, y: 0.1, width: 0.4, height: 0.3 }])
      for (const wardrobe of ['source', 'reference']) {
        const request = {
          format: 'aftertake-character/1',
          name: 'Read-only contract',
          selectionId: '00000000-0000-4000-8000-000000000000',
          reference: { ...reference, kind: 'image' },
          faceBox,
          wardrobe,
          seed: 509101,
          prompt: 'Keep the cup.',
        };
        graphs.push([
          `character/${faceBox ? 'face' : 'photo'}/${wardrobe}`,
          await buildCharacterWorkflow(root, python, {
            id: 'contract-only',
            kind: 'replacement',
            request,
            selectionRequest: selection,
          }),
        ]);
      }
    for (const [label, graph] of graphs) {
      check(`${label}/${resolution}`, graph);
      const required = new Set(characterRequirements(label === 'character/selection').nodes);
      if (graph.prepare.inputs.resolution !== resolution)
        failures.push(`${label}: does not retain the reviewed ${resolution} canvas`);
      for (const node of Object.values(graph))
        if (!required.has(node.class_type))
          failures.push(`${label}: preflight omits ${node.class_type}`);
      characterVariants++;
    }
  }
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(
  `All ${22 + characterVariants + textVideoVariants} workflow variants satisfy the live required-input and output-link contracts. No jobs submitted.`,
);
