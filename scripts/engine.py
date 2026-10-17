"""Supervise ComfyUI and its official v2 proxy, without exposing either to the LAN."""
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
PYTHON = RUNTIME / 'venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')

def live(port, route):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/{route}', timeout=2) as response: return response.status == 200
    except OSError: return False

if __name__ == '__main__':
    if not PYTHON.exists(): raise SystemExit('Run python scripts/setup.py first.')
    if live(8188, 'system_stats') or live(8189, 'api/v2/health'):
        raise SystemExit('A ComfyUI engine or proxy already uses ports 8188/8189. Reuse it or stop it before launching this supervisor.')
    shutil.copytree(ROOT / 'custom_nodes/aftertake', RUNTIME / 'ComfyUI/custom_nodes/aftertake', dirs_exist_ok=True)
    commands = [
        [str(PYTHON), str(RUNTIME / 'ComfyUI/main.py'), '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch', '--disable-partner-nodes', '--reserve-vram', '3', '--preview-method', 'none'],
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
