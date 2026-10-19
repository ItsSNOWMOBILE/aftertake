import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures, type ComputeFeature } from '../src/compute.js';
import { evaluateEngineCompatibility } from '../server/engine-compatibility.js';
import { requirements } from '../server/workflow.js';

type Node = {
  input: { required: Record<string, unknown>; optional: Record<string, unknown> };
  output: string[];
};
function fixture(feature: ComputeFeature) {
  const needed = requirements(feature);
  const nodes: Record<string, Node> = Object.fromEntries(
    needed.nodes.map((name) => [name, { input: { required: {}, optional: {} }, output: [] }]),
  );
  for (const [name, input, filename] of needed.menus) {
    const definition = (nodes[name].input.required[input] ??= [[]]) as [string[]];
    definition[0].push(filename);
  }
  if (nodes.AftertakeLoadClip) nodes.AftertakeLoadClip.output = ['IMAGE', 'STRING'];
  if (nodes.AftertakeCueMask) nodes.AftertakeCueMask.output = ['MASK', 'MASK', 'MASK'];
  if (nodes.AftertakeSaveVideo) nodes.AftertakeSaveVideo.input.optional.generated_audio = ['AUDIO'];
  if (nodes.AftertakeRuntimeInfo) {
    nodes.AftertakeRuntimeInfo.input.required.ffmpeg_tools = [['ready']];
    nodes.AftertakeRuntimeInfo.input.required.weight_copy_backend = [['pytorch']];
  }
  return nodes;
}
const systemStats = { system: { os: 'win32' } };
const evaluate = (feature: ComputeFeature, objectInfo: unknown, stats: unknown = systemStats) =>
  evaluateEngineCompatibility({ feature, objectInfo, systemStats: stats });

test('declared metadata contracts cover all ten workflows without mutating or returning engine documents', () => {
  for (const feature of computeFeatures) {
    const nodes = fixture(feature);
    nodes.PrivateNode = {
      input: { required: { private: ['/private/photo.png'] }, optional: {} },
      output: [],
    };
    const before = structuredClone(nodes);
    const result = evaluate(feature, nodes);
    assert.equal(result.compatible, true, feature);
    assert.deepEqual(result.missing, []);
    assert.ok(result.checks.length > 0);
    assert.ok(result.checks.every((item) => item.state === 'pass'));
    assert.equal(JSON.stringify(result).includes('/private/photo.png'), false);
    assert.deepEqual(nodes, before);
  }
});

test('model menus fail closed when absent, malformed or missing the pinned filename', () => {
  for (const invalid of [
    undefined,
    null,
    {},
    'model',
    [],
    ['not-a-combo'],
    [null],
    [[123]],
    [['other-private-model']],
  ]) {
    const nodes = fixture('image-gen');
    nodes.UNETLoader.input.required.unet_name = invalid;
    const result = evaluate('image-gen', nodes);
    assert.equal(result.compatible, false, JSON.stringify(invalid));
    assert.ok(result.missing.some((message) => message.startsWith('Model: ')));
    assert.equal(JSON.stringify(result).includes('other-private-model'), false);
  }
});

test('modern COMBO option signatures retain all workflow models and reject malformed options', () => {
  for (const feature of computeFeatures) {
    const nodes = fixture(feature);
    for (const [name, input] of requirements(feature).menus) {
      const signature = nodes[name].input.required[input] as unknown[];
      if (Array.isArray(signature[0]))
        nodes[name].input.required[input] = ['COMBO', { options: signature[0] }];
    }
    if (nodes.AftertakeRuntimeInfo) {
      nodes.AftertakeRuntimeInfo.input.required.ffmpeg_tools = ['COMBO', { options: ['ready'] }];
      nodes.AftertakeRuntimeInfo.input.required.weight_copy_backend = [
        'COMBO',
        { options: ['pytorch'] },
      ];
    }
    assert.equal(evaluate(feature, nodes).compatible, true, feature);
  }
  for (const invalid of [
    undefined,
    null,
    [],
    {},
    { options: null },
    { options: 'private' },
    { options: [] },
    { options: ['private-model'] },
  ]) {
    const nodes = fixture('image-gen');
    nodes.UNETLoader.input.required.unet_name = ['COMBO', invalid];
    assert.equal(evaluate('image-gen', nodes).compatible, false);
  }
  const nodes = fixture('image-gen');
  const filename = requirements('image-gen').menus[0][2];
  nodes.UNETLoader.input.required.unet_name = ['COMBO', Object.create({ options: [filename] })];
  assert.equal(evaluate('image-gen', nodes).compatible, false);
});

test('missing or malformed native output ports cannot certify source audio or spatial masks', () => {
  for (const feature of ['structure', 'inpaint', 'frame-edit', 'character-swap'] as const) {
    for (const output of [
      undefined,
      null,
      {},
      'IMAGE,STRING',
      [],
      ['IMAGE'],
      ['IMAGE', null],
      ['IMAGE', 'AUDIO'],
    ]) {
      const nodes = fixture(feature) as Record<string, any>;
      nodes.AftertakeLoadClip.output = output;
      assert.equal(
        evaluate(feature, nodes).compatible,
        false,
        `${feature}: ${JSON.stringify(output)}`,
      );
    }
  }
  for (const output of [
    undefined,
    null,
    {},
    'MASK,MASK,MASK',
    [],
    ['MASK'],
    ['MASK', 'MASK'],
    ['MASK', 'MASK', null],
    ['IMAGE', 'MASK', 'MASK'],
  ]) {
    const nodes = fixture('inpaint') as Record<string, any>;
    nodes.AftertakeCueMask.output = output;
    assert.equal(evaluate('inpaint', nodes).compatible, false, JSON.stringify(output));
  }
});

test('only own node and port objects count as installed capability metadata', () => {
  for (const invalid of [undefined, null, [], 'installed']) {
    const nodes = fixture('image-gen') as Record<string, unknown>;
    nodes.UNETLoader = invalid;
    assert.equal(evaluate('image-gen', nodes).compatible, false);
  }
  const nodes = fixture('image-gen');
  const inherited = Object.assign(Object.create({ UNETLoader: nodes.UNETLoader }), nodes);
  delete inherited.UNETLoader;
  assert.equal(evaluate('image-gen', inherited).compatible, false);
  nodes.UNETLoader.input.required = Object.create(nodes.UNETLoader.input.required);
  assert.equal(evaluate('image-gen', nodes).compatible, false);
  for (const invalid of [undefined, null, [], 'private metadata']) {
    assert.equal(evaluate('image-gen', invalid).compatible, false);
  }
});

test('generated audio needs its actual AUDIO port and characters need known OS and native runtime flags', () => {
  const audioOptions = fixture('text-video');
  audioOptions.AftertakeSaveVideo.input.optional.generated_audio = ['AUDIO', { forceInput: true }];
  assert.equal(evaluate('text-video', audioOptions).compatible, true);
  for (const invalid of [undefined, null, {}, 'AUDIO', [], ['STRING']]) {
    const nodes = fixture('text-video');
    nodes.AftertakeSaveVideo.input.optional.generated_audio = invalid;
    assert.equal(evaluate('text-video', nodes).compatible, false);
  }
  for (const feature of ['character-selection', 'character-swap'] as const) {
    for (const stats of [
      undefined,
      null,
      {},
      { system: {} },
      { system: { os: 1 } },
      { system: { os: 'private-unknown-os' } },
    ]) {
      const result = evaluateEngineCompatibility({
        feature,
        objectInfo: fixture(feature),
        systemStats: stats,
      });
      assert.equal(result.compatible, false);
      assert.ok(
        result.checks.some(
          (item) => item.id === 'character-operating-system' && item.state === 'blocked',
        ),
      );
      assert.equal(JSON.stringify(result).includes('private-unknown-os'), false);
    }
    const nodes = fixture(feature);
    nodes.AftertakeRuntimeInfo.input.required.weight_copy_backend = [['native']];
    assert.equal(evaluate(feature, nodes).compatible, false);
    assert.equal(evaluate(feature, nodes, { system: { os: 'posix' } }).compatible, true);
    nodes.AftertakeRuntimeInfo.input.required.ffmpeg_tools = [['missing']];
    assert.equal(evaluate(feature, nodes, { system: { os: 'posix' } }).compatible, false);
  }
});
