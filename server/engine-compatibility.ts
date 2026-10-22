import { hardwareProfile, type ComputeFeature } from '../src/compute.js';
import { requirements } from './workflow.js';

export type EngineCompatibilityCheck = {
  id: string;
  state: 'pass' | 'blocked';
  message: string;
};
export type EngineCompatibilityInput = {
  feature: ComputeFeature;
  objectInfo: unknown;
  systemStats?: unknown;
  hardwareInfo?: unknown;
};
export type EngineCompatibilityResult = {
  compatible: boolean;
  missing: string[];
  checks: EngineCompatibilityCheck[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function own(value: unknown, name: string): unknown {
  return record(value) && Object.hasOwn(value, name) ? value[name] : undefined;
}
function port(node: unknown, group: string, name: string): unknown {
  return own(own(own(node, 'input'), group), name);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    Array.from({ length: value.length }, (_, index) => index).every(
      (index) =>
        Object.hasOwn(value, index) && typeof value[index] === 'string' && value[index].length > 0,
    )
  );
}
function item(value: unknown, index: number): unknown {
  return Array.isArray(value) && Object.hasOwn(value, index) ? value[index] : undefined;
}
function comboOptions(value: unknown): unknown {
  const type = item(value, 0);
  return type === 'COMBO' ? own(item(value, 1), 'options') : type;
}

/** Required node classes and model menu entries, from an engine's object_info. */
export function componentChecks(
  objectInfo: unknown,
  needed: { nodes: string[]; menus: [string, string, string][] },
): EngineCompatibilityCheck[] {
  const checks: EngineCompatibilityCheck[] = [];
  for (const name of needed.nodes)
    checks.push({
      id: `node:${name}`,
      state: record(own(objectInfo, name)) ? 'pass' : 'blocked',
      message: `Node: ${name}`,
    });
  for (const [name, input, filename] of needed.menus) {
    const options = comboOptions(port(own(objectInfo, name), 'required', input));
    checks.push({
      id: `model:${name}.${input}:${filename}`,
      state: strings(options) && options.includes(filename) ? 'pass' : 'blocked',
      message: `Model: ${filename}`,
    });
  }
  return checks;
}

/** Metadata checks only: no network, SDK work, GPU claim or deployment approval. */
export function evaluateEngineCompatibility({
  feature,
  objectInfo,
  systemStats,
  hardwareInfo,
}: EngineCompatibilityInput): EngineCompatibilityResult {
  const needed = requirements(feature);
  const checks: EngineCompatibilityCheck[] = [];
  const check = (id: string, pass: boolean, message: string) => {
    checks.push({ id, state: pass ? 'pass' : 'blocked', message });
  };
  const hardwareFormat =
    own(hardwareInfo, 'format') === 'aftertake-hardware-status/1' &&
    own(hardwareInfo, 'profile') === hardwareProfile(feature);
  check(
    'hardware-report',
    hardwareFormat,
    'Update the Aftertake node pack and restart ComfyUI to validate this workflow hardware.',
  );
  const facts = own(hardwareInfo, 'facts');
  const config = own(hardwareInfo, 'config');
  const deviceIndex = own(facts, 'device_index');
  const integer = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const memory = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const cudaDevices = own(systemStats, 'devices');
  const configuredDevice =
    integer(deviceIndex) &&
    own(config, 'device_index') === deviceIndex &&
    Array.isArray(cudaDevices) &&
    cudaDevices.some(
      (device) => own(device, 'type') === 'cuda' && own(device, 'index') === deviceIndex,
    );
  const policy = own(hardwareInfo, 'policy');
  check(
    'hardware-cuda-policy',
    hardwareFormat &&
      own(hardwareInfo, 'backend') === 'cuda' &&
      own(facts, 'backend') === 'cuda' &&
      own(config, 'backend') === 'cuda' &&
      configuredDevice &&
      typeof own(config, 'require_native_fp8') === 'boolean' &&
      own(policy, 'cpuInference') === false &&
      own(policy, 'float32Fallback') === false,
    'Select the same NVIDIA CUDA execution device for ComfyUI and Aftertake; CPU generation and FP32 fallback are disabled.',
  );
  const capability = own(facts, 'compute_capability');
  check(
    'hardware-native-bf16',
    hardwareFormat &&
      own(facts, 'native_bf16') === true &&
      Array.isArray(capability) &&
      capability.length === 2 &&
      integer(item(capability, 0)) &&
      integer(item(capability, 1)) &&
      capability[0] >= 8,
    'Generation needs verified native BF16 tensor cores on NVIDIA CUDA compute capability 8.0 or newer.',
  );
  const total = own(facts, 'total_vram_bytes');
  const free = own(facts, 'free_vram_bytes');
  const reserve = own(config, 'reserve_vram_gib');
  const workspace = own(config, 'required_workspace_gib');
  const reclaimable = own(facts, 'reclaimable_vram_bytes');
  const memoryMode = own(config, 'memory_mode');
  check(
    'hardware-vram-budget',
    hardwareFormat &&
      integer(total) &&
      total > 0 &&
      integer(free) &&
      free <= total &&
      integer(reclaimable) &&
      reclaimable <= total - free &&
      memory(reserve) &&
      memory(workspace) &&
      (reserve + workspace) * 1024 ** 3 < free + reclaimable &&
      typeof memoryMode === 'string' &&
      ['auto', 'balanced', 'sequential'].includes(memoryMode),
    'Free VRAM plus verified idle model residency must cover the configured reserve and workspace budget. Close other GPU work or adjust the explicit memory settings.',
  );
  const nativeProbes = own(facts, 'kernel_probes');
  const reportedChecks = own(hardwareInfo, 'checks');
  const passedCheck = (id: string) =>
    Array.isArray(reportedChecks) &&
    reportedChecks.some((item) => own(item, 'id') === id && own(item, 'state') === 'pass');
  const reportPassed =
    Array.isArray(reportedChecks) &&
    reportedChecks.length > 0 &&
    Array.from({ length: reportedChecks.length }, (_, index) => index).every(
      (index) =>
        Object.hasOwn(reportedChecks, index) &&
        record(reportedChecks[index]) &&
        own(reportedChecks[index], 'state') === 'pass',
    );
  check(
    'hardware-runtime-ready',
    hardwareFormat && own(hardwareInfo, 'ready') === true && reportPassed,
    'The engine hardware preflight is not ready. Resolve the reported setup checks and retry.',
  );
  const nativeMemory = own(hardwareInfo, 'memoryPolicy');
  const effectiveMode =
    memoryMode === 'auto' && integer(total)
      ? total <= 16 * 1024 ** 3
        ? 'sequential'
        : 'balanced'
      : memoryMode;
  const sequential = effectiveMode === 'sequential';
  check(
    'hardware-native-residency',
    hardwareFormat &&
      own(nativeMemory, 'requested_mode') === memoryMode &&
      own(nativeMemory, 'effective_mode') === effectiveMode &&
      own(nativeMemory, 'denoiser_activation_offload') === false &&
      passedCheck('native-memory') &&
      (!sequential ||
        (own(nativeMemory, 'intermediate_device') === 'cpu' &&
          own(nativeMemory, 'cpu_intermediate_storage') === true &&
          own(nativeMemory, 'cpu_output_staging') === true &&
          own(nativeMemory, 'native_smart_memory_disabled') === true &&
          own(nativeMemory, 'node_result_cache_disabled') === true &&
          own(nativeMemory, 'high_vram_residency') === false)),
    'The running engine must match its memory policy. For sequential residency, restart through the Aftertake launcher or use --disable-smart-memory --cache-none without --gpu-only or --highvram.',
  );
  const ltxDecoder = ['structure', 'motion', 'inpaint', 'cinema', 'text-video'].includes(feature);
  if (sequential && (ltxDecoder || feature === 'character-swap')) {
    const decoder = own(nativeMemory, 'native_decoder_contract');
    check(
      'hardware-native-decoder-staging',
      own(decoder, 'architecture') === (ltxDecoder ? 'VideoVAE' : 'MiniMaxH3VideoVAE') &&
        own(decoder, 'module') ===
          (ltxDecoder
            ? 'comfy.ldm.lightricks.vae.causal_video_autoencoder'
            : 'comfy.ldm.minimax.vae') &&
        own(decoder, 'comfy_has_chunked_io') === true &&
        own(decoder, 'decode_output_buffer') === true &&
        passedCheck('native-decoder-staging'),
      'Sequential video decoding requires the pinned native chunked output-buffer API. Update the runtime and Aftertake nodes, then restart the engine.',
    );
  }
  check(
    'hardware-kernel-probes',
    hardwareFormat &&
      strings(nativeProbes) &&
      nativeProbes.includes('bf16-matmul-and-optimized-sdpa') &&
      ['cuda', 'native-bf16', 'memory', 'kernel-probe'].every(passedCheck),
    'The selected GPU must pass the tiny native BF16 and optimized CUDA attention probes before generation.',
  );
  if (own(config, 'require_native_fp8') === true)
    check(
      'hardware-requested-native-fp8',
      Array.isArray(capability) &&
        capability.every(integer) &&
        (capability[0] > 8 || (capability[0] === 8 && capability[1] >= 9)) &&
        own(facts, 'native_fp8') === true &&
        strings(nativeProbes) &&
        nativeProbes.includes('native-fp8-scaled-matmul'),
      'The explicitly selected native FP8 execution path needs a successful native FP8 CUDA kernel probe.',
    );
  if (feature === 'character-swap') {
    const backend = comboOptions(
      port(own(objectInfo, 'ModelAttentionBackend'), 'required', 'attention'),
    );
    check(
      'character-native-attention',
      strings(backend) &&
        backend.includes('comfy kitchen attention') &&
        strings(nativeProbes) &&
        nativeProbes.includes('comfy-kitchen-int8-attention') &&
        passedCheck('h3-attention'),
      'H3 needs the installed Comfy Kitchen INT8 attention menu and a successful compiled-kernel probe on the selected GPU.',
    );
  }
  for (const component of componentChecks(objectInfo, needed)) checks.push(component);
  if (needed.nodes.includes('AftertakeLoadClip')) {
    const output = own(own(objectInfo, 'AftertakeLoadClip'), 'output');
    check(
      'source-audio-outputs',
      strings(output) && output.length === 2 && output[0] === 'IMAGE' && output[1] === 'STRING',
      'Update Aftertake nodes and restart the engine for source audio',
    );
  }
  if (feature === 'inpaint') {
    const output = own(own(objectInfo, 'AftertakeCueMask'), 'output');
    check(
      'inpaint-mask-outputs',
      strings(output) && output.length >= 3 && output.slice(0, 3).every((type) => type === 'MASK'),
      'Update Aftertake nodes and restart the engine for spatial masks',
    );
  }
  if (feature === 'text-video') {
    const audio = port(own(objectInfo, 'AftertakeSaveVideo'), 'optional', 'generated_audio');
    check(
      'generated-audio-input',
      item(audio, 0) === 'AUDIO',
      'Update Aftertake nodes and restart the engine for generated sound.',
    );
  }
  if (feature === 'character-selection' || feature === 'character-swap') {
    const runtime = own(objectInfo, 'AftertakeRuntimeInfo');
    const tools = port(runtime, 'required', 'ffmpeg_tools');
    const options = comboOptions(tools);
    check(
      'character-ffmpeg-tools',
      strings(options) && options.includes('ready'),
      'FFmpeg and FFprobe must be on the engine PATH; use python scripts/engine.py --ffmpeg-bin PATH_TO_BIN',
    );
    const os = own(own(systemStats, 'system'), 'os');
    const known =
      typeof os === 'string' && ['nt', 'win32', 'posix', 'linux', 'darwin'].includes(os);
    check(
      'character-operating-system',
      known,
      'Export valid engine system_stats to verify the character runtime operating system.',
    );
    if (known && (os === 'nt' || os === 'win32')) {
      const copies = port(runtime, 'required', 'weight_copy_backend');
      const backends = comboOptions(copies);
      check(
        'character-windows-weight-copies',
        strings(backends) && backends.length === 1 && ['native', 'pytorch'].includes(backends[0]),
        'Update the Aftertake runtime metadata to identify its native or explicitly selected PyTorch weight-transfer backend.',
      );
    }
  }
  const missing = checks.filter((item) => item.state === 'blocked').map((item) => item.message);
  return { compatible: missing.length === 0, missing, checks };
}
