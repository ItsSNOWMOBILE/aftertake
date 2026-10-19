import type { ComputeFeature } from '../src/compute.js';
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

/** Metadata checks only: no network, SDK work, GPU claim or deployment approval. */
export function evaluateEngineCompatibility({
  feature,
  objectInfo,
  systemStats,
}: EngineCompatibilityInput): EngineCompatibilityResult {
  const needed = requirements(feature);
  const checks: EngineCompatibilityCheck[] = [];
  const check = (id: string, pass: boolean, message: string) => {
    checks.push({ id, state: pass ? 'pass' : 'blocked', message });
  };
  for (const name of needed.nodes) {
    check(`node:${name}`, record(own(objectInfo, name)), `Node: ${name}`);
  }
  for (const [name, input, filename] of needed.menus) {
    const definition = port(own(objectInfo, name), 'required', input);
    const options = comboOptions(definition);
    check(
      `model:${name}.${input}:${filename}`,
      strings(options) && options.includes(filename),
      `Model: ${filename}`,
    );
  }
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
        strings(backends) && backends.includes('pytorch'),
        'Restart the tested Windows character engine with --safe-weight-copies',
      );
    }
  }
  const missing = checks.filter((item) => item.state === 'blocked').map((item) => item.message);
  return { compatible: missing.length === 0, missing, checks };
}
