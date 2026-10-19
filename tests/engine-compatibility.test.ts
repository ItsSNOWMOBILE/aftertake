import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures, type ComputeFeature } from '../src/compute.js';
import { evaluateEngineCompatibility } from '../server/engine-compatibility.js';
import { requirements } from '../server/workflow.js';
import { cudaSystemStats, hardwareFixture } from './hardware-fixture.js';

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
const systemStats = cudaSystemStats;
const evaluate = (feature: ComputeFeature, objectInfo: unknown, stats: unknown = systemStats) =>
  evaluateEngineCompatibility({
    feature,
    objectInfo,
    systemStats: stats,
    hardwareInfo: hardwareFixture(feature),
  });

test('declared metadata contracts cover every workflow without mutating or returning engine documents', () => {
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
    assert.equal(
      evaluate(feature, nodes).compatible,
      true,
      'Windows keeps native weight transfer unless safe copies were explicitly selected.',
    );
    nodes.AftertakeRuntimeInfo.input.required.weight_copy_backend = [['pytorch']];
    assert.equal(evaluate(feature, nodes).compatible, true);
    for (const invalid of [
      undefined,
      null,
      [],
      [['unknown']],
      [['native', 'pytorch']],
      ['native'],
    ]) {
      nodes.AftertakeRuntimeInfo.input.required.weight_copy_backend = invalid;
      assert.equal(evaluate(feature, nodes).compatible, false);
    }
    nodes.AftertakeRuntimeInfo.input.required.weight_copy_backend = [['native']];
    assert.equal(
      evaluate(feature, nodes, { ...systemStats, system: { os: 'posix' } }).compatible,
      true,
    );
    nodes.AftertakeRuntimeInfo.input.required.ffmpeg_tools = [['missing']];
    assert.equal(
      evaluate(feature, nodes, { ...systemStats, system: { os: 'posix' } }).compatible,
      false,
    );
  }
});

test('CUDA hardware reports fail closed for missing, malformed, wrong-profile and CPU metadata', () => {
  const feature = 'image-gen';
  const nodes = fixture(feature);
  for (const hardwareInfo of [
    undefined,
    null,
    {},
    true,
    'ready',
    hardwareFixture('text-video'),
    { ...hardwareFixture(feature), ready: 'true' },
    { ...hardwareFixture(feature), policy: { cpuInference: true, float32Fallback: false } },
  ]) {
    assert.equal(
      evaluateEngineCompatibility({ feature, objectInfo: nodes, systemStats, hardwareInfo })
        .compatible,
      false,
    );
  }
  for (const devices of [undefined, [], [{ type: 'cpu', index: 0 }], [{ type: 'cuda', index: 1 }]])
    assert.equal(
      evaluateEngineCompatibility({
        feature,
        objectInfo: nodes,
        systemStats: { system: { os: 'linux' }, devices },
        hardwareInfo: hardwareFixture(feature),
      }).compatible,
      false,
    );
  const valid = hardwareFixture(feature);
  assert.equal(
    evaluateEngineCompatibility({ feature, objectInfo: nodes, systemStats, hardwareInfo: valid })
      .compatible,
    true,
    'Ampere BF16 can pass without native FP8.',
  );
  for (const field of [
    'native_bf16',
    'kernel_probes',
    'free_vram_bytes',
    'reclaimable_vram_bytes',
  ]) {
    const invalid = structuredClone(valid) as any;
    invalid.facts[field] = field === 'kernel_probes' ? [] : field === 'native_bf16' ? false : -1;
    assert.equal(
      evaluateEngineCompatibility({
        feature,
        objectInfo: nodes,
        systemStats,
        hardwareInfo: invalid,
      }).compatible,
      false,
      field,
    );
  }
});

test('malformed hardware capability and memory fields cannot throw or certify generation', () => {
  const feature = 'image-gen';
  for (const capability of [
    [8],
    [8, undefined],
    [8, -1],
    [8, NaN],
    Object.assign(Array(2), { 0: 8 }),
  ]) {
    const invalid = hardwareFixture(feature) as any;
    invalid.facts.compute_capability = capability;
    assert.equal(
      evaluateEngineCompatibility({
        feature,
        objectInfo: fixture(feature),
        systemStats,
        hardwareInfo: invalid,
      }).compatible,
      false,
    );
  }
  for (const memoryMode of [{}, Object.create(null), true]) {
    const invalid = hardwareFixture(feature) as any;
    invalid.config.memory_mode = memoryMode;
    assert.equal(
      evaluateEngineCompatibility({
        feature,
        objectInfo: fixture(feature),
        systemStats,
        hardwareInfo: invalid,
      }).compatible,
      false,
    );
  }
});

test('configured workspace uses bounded idle residency and does not imply that every model fits', () => {
  const feature = 'image-gen';
  const hardwareInfo = hardwareFixture(feature);
  hardwareInfo.facts.free_vram_bytes = 2 * 1024 ** 3;
  const evaluateReport = () =>
    evaluateEngineCompatibility({
      feature,
      objectInfo: fixture(feature),
      systemStats,
      hardwareInfo,
    });
  assert.equal(evaluateReport().compatible, false);
  hardwareInfo.facts.reclaimable_vram_bytes = 7 * 1024 ** 3;
  assert.equal(
    evaluateReport().compatible,
    false,
    'The exact configured budget leaves no additional capacity.',
  );
  hardwareInfo.facts.reclaimable_vram_bytes = 8 * 1024 ** 3;
  assert.equal(evaluateReport().compatible, true);
  hardwareInfo.facts.reclaimable_vram_bytes = 15 * 1024 ** 3;
  assert.equal(
    evaluateReport().compatible,
    false,
    'Never claim more reclaimable bytes than occupied VRAM.',
  );
});

test('H3 needs both the exact attention menu and actual compiled-kernel proof, independently of FP8 storage', () => {
  const feature = 'character-swap';
  const nodes = fixture(feature);
  const hardwareInfo = hardwareFixture(feature);
  const evaluateReport = () =>
    evaluateEngineCompatibility({ feature, objectInfo: nodes, systemStats, hardwareInfo });
  assert.equal(evaluateReport().compatible, true);
  nodes.ModelAttentionBackend.input.required.attention = [['pytorch attention']];
  assert.equal(evaluateReport().compatible, false);
  nodes.ModelAttentionBackend.input.required.attention = [['comfy kitchen attention']];
  hardwareInfo.facts.kernel_probes = ['bf16-matmul-and-optimized-sdpa'];
  assert.equal(evaluateReport().compatible, false);
});

test('an explicitly requested native FP8 path needs its own device capability and kernel probe', () => {
  const feature = 'image-gen';
  const hardwareInfo = hardwareFixture(feature);
  hardwareInfo.config.require_native_fp8 = true;
  const evaluateReport = () =>
    evaluateEngineCompatibility({
      feature,
      objectInfo: fixture(feature),
      systemStats,
      hardwareInfo,
    });
  assert.equal(evaluateReport().compatible, false);
  hardwareInfo.facts.compute_capability = [8, 9];
  hardwareInfo.facts.native_fp8 = true;
  assert.equal(evaluateReport().compatible, false);
  hardwareInfo.facts.kernel_probes.push('native-fp8-scaled-matmul');
  assert.equal(evaluateReport().compatible, true);
});

test('sequential admission requires actual native eviction, cache and CPU storage facts', () => {
  const feature = 'character-swap';
  const original = hardwareFixture(feature);
  const changes = [
    (value: any) => {
      delete value.memoryPolicy;
    },
    (value: any) => {
      value.memoryPolicy.effective_mode = 'balanced';
    },
    (value: any) => {
      value.memoryPolicy.native_smart_memory_disabled = false;
    },
    (value: any) => {
      value.memoryPolicy.node_result_cache_disabled = false;
    },
    (value: any) => {
      value.memoryPolicy.intermediate_device = 'cuda:0';
    },
    (value: any) => {
      value.memoryPolicy.cpu_output_staging = false;
    },
    (value: any) => {
      value.memoryPolicy.high_vram_residency = true;
    },
    (value: any) => {
      value.memoryPolicy.denoiser_activation_offload = true;
    },
    (value: any) => {
      value.checks = value.checks.filter((item: any) => item.id !== 'native-memory');
    },
  ];
  for (const mutate of changes) {
    const hardwareInfo = structuredClone(original);
    mutate(hardwareInfo);
    const result = evaluateEngineCompatibility({
      feature,
      objectInfo: fixture(feature),
      systemStats,
      hardwareInfo,
    });
    assert.equal(result.compatible, false);
    assert.ok(
      result.checks.some(
        (item) => item.id === 'hardware-native-residency' && item.state === 'blocked',
      ),
    );
  }
});

test('sequential video admission needs the expected native decoder output-buffer contract', () => {
  for (const feature of ['character-swap', 'text-video'] as const) {
    const original = hardwareFixture(feature);
    for (const field of [
      'architecture',
      'module',
      'comfy_has_chunked_io',
      'decode_output_buffer',
    ]) {
      const hardwareInfo = structuredClone(original) as any;
      delete hardwareInfo.memoryPolicy.native_decoder_contract[field];
      const result = evaluateEngineCompatibility({
        feature,
        objectInfo: fixture(feature),
        systemStats,
        hardwareInfo,
      });
      assert.equal(result.compatible, false);
      assert.ok(
        result.checks.some(
          (item) => item.id === 'hardware-native-decoder-staging' && item.state === 'blocked',
        ),
      );
    }
  }
});

test('balanced residency preserves explicit GPU intermediates while auto on 16 GiB requires sequential', () => {
  const feature = 'text-video';
  const hardwareInfo = hardwareFixture(feature) as any;
  hardwareInfo.config.memory_mode = 'balanced';
  Object.assign(hardwareInfo.memoryPolicy, {
    requested_mode: 'balanced',
    effective_mode: 'balanced',
    intermediate_device: 'cuda:0',
    cpu_intermediate_storage: false,
    cpu_output_staging: false,
    native_smart_memory_disabled: false,
    node_result_cache_disabled: false,
    high_vram_residency: true,
    native_decoder_contract: null,
  });
  const evaluateReport = () =>
    evaluateEngineCompatibility({
      feature,
      objectInfo: fixture(feature),
      systemStats,
      hardwareInfo,
    });
  const saved = structuredClone(hardwareInfo);
  assert.equal(evaluateReport().compatible, true);
  assert.deepEqual(hardwareInfo, saved, 'Admission only observes native placement.');
  hardwareInfo.config.memory_mode = hardwareInfo.memoryPolicy.requested_mode = 'auto';
  hardwareInfo.facts.total_vram_bytes = 24 * 1024 ** 3;
  assert.equal(evaluateReport().compatible, true);
  hardwareInfo.facts.total_vram_bytes = 16 * 1024 ** 3;
  assert.equal(evaluateReport().compatible, false);
});

test('a later residency failure does not mislabel successful native precision probes', () => {
  const feature = 'text-video';
  const hardwareInfo = hardwareFixture(feature) as any;
  hardwareInfo.ready = false;
  hardwareInfo.memoryPolicy = null;
  hardwareInfo.checks = hardwareInfo.checks.filter(
    (item: any) => !['native-memory', 'native-decoder-staging'].includes(item.id),
  );
  hardwareInfo.checks.push({
    id: 'sequential_native_flags_required',
    state: 'blocked',
    message: 'Enable native sequential placement.',
  });
  const result = evaluateEngineCompatibility({
    feature,
    objectInfo: fixture(feature),
    systemStats,
    hardwareInfo,
  });
  assert.equal(result.compatible, false);
  assert.equal(result.checks.find((item) => item.id === 'hardware-kernel-probes')?.state, 'pass');
  assert.equal(
    result.checks.find((item) => item.id === 'hardware-runtime-ready')?.state,
    'blocked',
  );
  assert.equal(
    result.checks.find((item) => item.id === 'hardware-native-residency')?.state,
    'blocked',
  );
  assert.ok(
    !result.missing.includes(
      'The selected GPU must pass the tiny native BF16 and optimized CUDA attention probes before generation.',
    ),
  );
});
