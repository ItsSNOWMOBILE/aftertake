"""Supervise ComfyUI and its official v2 proxy, without exposing either to the LAN."""
from pathlib import Path
import argparse
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

def live(port, route):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/{route}', timeout=2) as response: return response.status == 200
    except OSError: return False

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-dir', help='Use and remember an additional model directory; existing local models stay available')
    parser.add_argument('--ffmpeg-bin', help='Directory containing ffmpeg and ffprobe; applied only to this engine process')
    parser.add_argument('--safe-weight-copies', action='store_true', help='Use the tested PyTorch transfer fallback for Windows host-buffer resource errors')
    parser.add_argument('--no-node-cache', action='store_true', help='Disable Comfy node-result caching to reduce host memory during multi-window video jobs')
    args = parser.parse_args()
    if args.ffmpeg_bin:
        tools=Path(args.ffmpeg_bin).expanduser().resolve()
        if not all((tools/(name+('.exe' if sys.platform=='win32' else ''))).is_file() for name in ('ffmpeg','ffprobe')):
            raise SystemExit('--ffmpeg-bin must contain both ffmpeg and ffprobe.')
        os.environ['PATH']=str(tools)+os.pathsep+os.environ.get('PATH','')
    compatibility=[]
    if args.safe_weight_copies:
        os.environ['AFTERTAKE_SAFE_WEIGHT_COPIES']='1'
        os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
        os.environ.setdefault('OMP_NUM_THREADS','4')
        compatibility=['--disable-fast-disk','--async-offload','1']
    if args.no_node_cache:compatibility.append('--cache-none')
    if not PYTHON.exists(): raise SystemExit('Run python scripts/setup.py first.')
    if live(8188, 'system_stats') or live(8189, 'api/v2/health'):
        raise SystemExit('A ComfyUI engine or proxy already uses ports 8188/8189. Reuse it or stop it before launching this supervisor.')
    models = model_root(args.models_dir)
    extra = [] if models == RUNTIME / 'ComfyUI/models' else ['--extra-model-paths-config', str(extra_model_config(models))]
    shutil.copytree(ROOT / 'custom_nodes/aftertake', RUNTIME / 'ComfyUI/custom_nodes/aftertake', dirs_exist_ok=True)
    commands = [
        [str(PYTHON), str(RUNTIME / 'ComfyUI/main.py'), '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch', '--disable-partner-nodes', '--reserve-vram', '3', '--preview-method', 'none', *extra, *compatibility],
        [str(PYTHON.with_name('comfy-api-proxy.exe' if sys.platform == 'win32' else 'comfy-api-proxy')), 'run', '--comfyui', 'http://127.0.0.1:8188', '--port', '8189', '--comfyui-base-dir', str(RUNTIME / 'ComfyUI'), '--state-dir', str(RUNTIME / 'proxy-state')],
    ]
    children = []
    try:
        for command in commands: children.append(subprocess.Popen(command, cwd=ROOT))
        print('Starting the local engine. Studio URL: http://127.0.0.1:4310', flush=True)
        while all(child.poll() is None for child in children): time.sleep(1)
    except KeyboardInterrupt: pass
    finally:
        for child in children:
            if child.poll() is None: child.terminate()
        for child in children:
            try: child.wait(timeout=15)
            except subprocess.TimeoutExpired: child.kill()
