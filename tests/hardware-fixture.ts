import type { ComputeFeature } from '../src/compute.js';

export const cudaSystemStats = {
  system: { os: 'win32' },
  devices: [{ name: 'Synthetic CUDA device', type: 'cuda', index: 0, vram_total: 16 * 1024 ** 3 }],
};

// Saved metadata for validator tests; this is never evidence of real execution.
export function hardwareFixture(profile: ComputeFeature) {
  return {
    format: 'aftertake-hardware-status/1',
    profile,
    ready: true,
    backend: 'cuda',
    facts: {
      backend: 'cuda',
      device_index: 0,
      name: 'Synthetic CUDA device',
      total_vram_bytes: 16 * 1024 ** 3,
      free_vram_bytes: 12 * 1024 ** 3,
      reclaimable_vram_bytes: 0,
      compute_capability: [8, 6],
      native_bf16: true,
      native_fp8: false,
      kernel_probes: [
        'bf16-matmul-and-optimized-sdpa',
        ...(profile === 'character-swap' ? ['comfy-kitchen-int8-attention'] : []),
      ],
    },
    config: {
      backend: 'cuda',
      device_index: 0,
      memory_mode: 'auto',
      reserve_vram_gib: 3,
      required_workspace_gib: 6,
      require_native_fp8: false,
    },
    checks: [
      ...[
        'cuda',
        'native-bf16',
        'memory',
        'kernel-probe',
        ...(profile === 'character-swap' ? ['h3-attention'] : []),
      ].map((id) => ({ id, state: 'pass', message: 'Synthetic passing metadata.' })),
    ],
    policy: { cpuInference: false, float32Fallback: false },
  };
}
