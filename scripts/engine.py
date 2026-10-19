"""Supervise ComfyUI and its official v2 proxy, without exposing either to the LAN."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from model_storage import model_root, extra_model_config

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
PYTHON = RUNTIME / 'venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
sys.path.insert(0, str(ROOT / 'custom_nodes/aftertake'))
from hardware import HardwareConfig, HardwareConfigurationError, selected_device_environment, validate_preflight_report
from vram import resolve_memory_policy

def live(port, route):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/{route}', timeout=2) as response: return response.status == 200
    except OSError: return False

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-dir', help='Use and remember an additional model directory; existing local models stay available')
    parser.add_argument('--ffmpeg-bin', help='Directory containing ffmpeg and ffprobe; applied only to this engine process')
    parser.add_argument('--safe-weight-copies', action='store_true', help='Use the tested PyTorch transfer fallback for Windows host-buffer resource errors')
    parser.add_argument('--no-node-cache', action='store_true', help='Disable Comfy node-result caching to reduce host memory during multi-window video jobs')
    parser.add_argument('--gpu-index', type=int, default=0, help='Select one currently visible CUDA GPU; all unchanged graphs use it as gpu:0')
    parser.add_argument('--memory-mode', choices=('auto','balanced','sequential'), help='Preserve native CUDA execution with balanced or sequential model residency')
    parser.add_argument('--reserve-vram', type=float, help='GiB to reserve for the OS and other applications (default 3)')
    parser.add_argument('--workspace-vram', type=float, help='Explicit free workspace budget in GiB (default 6; not a universal fit guarantee)')
    parser.add_argument('--require-native-fp8', action='store_true', help='Require native FP8 kernels in addition to native BF16')
    parser.add_argument('--check-only', action='store_true', help='Validate CUDA and memory without launching ComfyUI or loading models')
    args = parser.parse_args(argv)
    environment = os.environ.copy()
    try:
        environment.update(selected_device_environment(args.gpu_index, environment))
        environment['AFTERTAKE_GPU_DEVICE']='0'
        for key,value in (
            ('AFTERTAKE_MEMORY_MODE',args.memory_mode),
            ('AFTERTAKE_RESERVE_VRAM_GIB',args.reserve_vram),
            ('AFTERTAKE_REQUIRED_WORKSPACE_GIB',args.workspace_vram),
        ):
            if value is not None:environment[key]=str(value)
        if args.require_native_fp8:environment['AFTERTAKE_REQUIRE_NATIVE_FP8']='1'
        config=HardwareConfig.from_environment(environment)
    except HardwareConfigurationError as error:
        raise SystemExit(f'Hardware configuration error [{error.code}]: {error}')
    if args.ffmpeg_bin:
        tools=Path(args.ffmpeg_bin).expanduser().resolve()
        if not all((tools/(name+('.exe' if sys.platform=='win32' else ''))).is_file() for name in ('ffmpeg','ffprobe')):
            raise SystemExit('--ffmpeg-bin must contain both ffmpeg and ffprobe.')
        environment['PATH']=str(tools)+os.pathsep+environment.get('PATH','')
    if args.safe_weight_copies:
        environment['AFTERTAKE_SAFE_WEIGHT_COPIES']='1'
        environment.setdefault('OPENBLAS_NUM_THREADS','1')
        environment.setdefault('OMP_NUM_THREADS','4')
    if not PYTHON.exists(): raise SystemExit('Run python scripts/setup.py first.')
    if not args.check_only and (live(8188, 'system_stats') or live(8189, 'api/v2/health')):
        raise SystemExit('A ComfyUI engine or proxy already uses ports 8188/8189. Reuse it or stop it before launching this supervisor.')
    try:
        probe=subprocess.run([str(PYTHON),str(ROOT/'scripts/hardware-check.py'),'--json'],
            cwd=ROOT,env=environment,capture_output=True,text=True,encoding='utf-8',timeout=120)
    except (OSError,subprocess.TimeoutExpired) as error:
        raise SystemExit(f'The CUDA preflight could not finish before engine launch: {error}')
    try:
        report=json.loads(probe.stdout)
    except (ValueError,TypeError):
        raise SystemExit('The CUDA runtime preflight returned an invalid report. Check the Python runtime and NVIDIA driver.\n'+probe.stderr[-2000:])
    try:
        facts=validate_preflight_report(report,config)
        if probe.returncode:raise HardwareConfigurationError('preflight_failed','The CUDA preflight process failed before engine launch.')
    except HardwareConfigurationError as error:
        raise SystemExit(f'Hardware configuration error [{error.code}]: {error}')
    policy=resolve_memory_policy(config.memory_mode,facts.total_vram_bytes,
        safe_weight_copies=environment.get('AFTERTAKE_SAFE_WEIGHT_COPIES')=='1')
    compatibility=list(policy.comfy_args)
    if args.no_node_cache and '--cache-none' not in compatibility:compatibility.append('--cache-none')
    if args.check_only:
        print(json.dumps(report,indent=2))
        return 0
    models = model_root(args.models_dir)
    extra = [] if models == RUNTIME / 'ComfyUI/models' else ['--extra-model-paths-config', str(extra_model_config(models))]
    shutil.copytree(ROOT / 'custom_nodes/aftertake', RUNTIME / 'ComfyUI/custom_nodes/aftertake', dirs_exist_ok=True)
    commands = [
        [str(PYTHON), str(RUNTIME / 'ComfyUI/main.py'), '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch', '--disable-partner-nodes', '--reserve-vram', str(config.reserve_vram_gib), '--preview-method', 'none', *extra, *compatibility],
        [str(PYTHON.with_name('comfy-api-proxy.exe' if sys.platform == 'win32' else 'comfy-api-proxy')), 'run', '--comfyui', 'http://127.0.0.1:8188', '--port', '8189', '--comfyui-base-dir', str(RUNTIME / 'ComfyUI'), '--state-dir', str(RUNTIME / 'proxy-state')],
    ]
    children = []
    try:
        for command in commands: children.append(subprocess.Popen(command, cwd=ROOT,env=environment))
        print(f"CUDA backend: {report['facts']['name']} · {policy.effective_mode} residency; native model precision and attention unchanged.",flush=True)
        print('Starting the local engine. Studio URL: http://127.0.0.1:4310', flush=True)
        while all(child.poll() is None for child in children): time.sleep(1)
    except KeyboardInterrupt: pass
    finally:
        for child in children:
            if child.poll() is None: child.terminate()
        for child in children:
            try: child.wait(timeout=15)
            except subprocess.TimeoutExpired: child.kill()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
