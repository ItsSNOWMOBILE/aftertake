"""Check the selected CUDA execution backend without loading model weights."""
from dataclasses import asdict
from pathlib import Path
import argparse
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
# Import the shared backend without importing/initializing the Comfy node package.
sys.path.insert(0, str(ROOT / 'custom_nodes/aftertake'))
from hardware import HardwareConfig, HardwareConfigurationError, NvidiaExecutionBackend, selected_device_environment
from vram import resolve_memory_policy


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gpu-index', type=int, default=0, help='Index among currently visible GPUs; the selected GPU becomes cuda:0')
    parser.add_argument('--memory-mode', choices=('auto', 'balanced', 'sequential'))
    parser.add_argument('--reserve-vram', type=float, help='GiB reserved for the OS and other applications')
    parser.add_argument('--workspace-vram', type=float, help='Explicit free workspace budget in GiB; not a universal model-fit estimate')
    parser.add_argument('--require-native-fp8', action='store_true', help='Reject devices without the native FP8 execution path')
    parser.add_argument('--json', action='store_true', help='Emit a machine-readable report')
    args = parser.parse_args(argv)
    try:
        os.environ.update(selected_device_environment(args.gpu_index))
        os.environ['AFTERTAKE_GPU_DEVICE'] = '0'
        for key, value in (
            ('AFTERTAKE_MEMORY_MODE', args.memory_mode),
            ('AFTERTAKE_RESERVE_VRAM_GIB', args.reserve_vram),
            ('AFTERTAKE_REQUIRED_WORKSPACE_GIB', args.workspace_vram),
        ):
            if value is not None:
                os.environ[key] = str(value)
        if args.require_native_fp8:
            os.environ['AFTERTAKE_REQUIRE_NATIVE_FP8'] = '1'
        config = HardwareConfig.from_environment()
        facts = NvidiaExecutionBackend(config).preflight()
        policy = resolve_memory_policy(config.memory_mode, facts.total_vram_bytes,
            safe_weight_copies=os.environ.get('AFTERTAKE_SAFE_WEIGHT_COPIES') == '1')
        report = {'format': 'aftertake-hardware-preflight/1', 'ready': True,
            'facts': asdict(facts), 'config': asdict(config), 'memoryPolicy': asdict(policy),
            'selectedDevice': os.environ['CUDA_VISIBLE_DEVICES'],
            'modelWeightsAllocated': False, 'cpuInference': False, 'float32Fallback': False,
            'memoryFitGuaranteed': False}
        if args.json:
            print(json.dumps(report))
        else:
            print(f"CUDA ready: {facts.name}; {facts.free_vram_bytes / 2**30:.2f} GiB free; "
                f"native BF16; {policy.effective_mode} residency.")
            print('Model and resolution compatibility still apply. No model weights were loaded.')
        return 0
    except HardwareConfigurationError as error:
        report = {'format': 'aftertake-hardware-preflight/1', 'ready': False,
            'code': error.code, 'error': str(error), 'modelWeightsAllocated': False,
            'cpuInference': False, 'float32Fallback': False}
        if args.json:
            print(json.dumps(report))
        else:
            print(f'Hardware configuration error [{error.code}]: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
