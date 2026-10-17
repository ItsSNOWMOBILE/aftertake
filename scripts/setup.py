"""Install the known ComfyUI stack and original sample. Run with Python 3.12+."""
from pathlib import Path
import argparse
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
VENV = RUNTIME / 'venv'
PYTHON = VENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
REPOS = [
    ('https://github.com/comfyanonymous/ComfyUI.git', RUNTIME / 'ComfyUI', '5cc4b870094c89090db54bd8d12649dcaf89f2ba'),
    ('https://github.com/city96/ComfyUI-GGUF.git', RUNTIME / 'ComfyUI/custom_nodes/ComfyUI-GGUF', '6ea2651e7df66d7585f6ffee804b20e92fb38b8a'),
    ('https://github.com/Lightricks/ComfyUI-LTXVideo.git', RUNTIME / 'ComfyUI/custom_nodes/ComfyUI-LTXVideo', '44c8a36b7c31ee00b4271daed11dc2a4aa481140'),
]
def run(*args): subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inpaint', action='store_true', help='Download the LTX-2.5 profile instead of the original structural profile')
    parser.add_argument('--skip-models', action='store_true', help='Install runtime and sample only; reuse model files from an existing installation')
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12): raise SystemExit('Use Python 3.12 for the pinned runtime.')
    RUNTIME.mkdir(exist_ok=True)
    if not PYTHON.exists(): run(sys.executable, '-m', 'venv', VENV)
    for url, target, revision in REPOS:
        if not (target / '.git').exists():
            target.mkdir(parents=True, exist_ok=True)
            run('git', 'init', target)
            run('git', '-C', target, 'remote', 'add', 'origin', url)
            run('git', '-C', target, 'fetch', '--depth', '1', 'origin', revision)
            run('git', '-C', target, 'checkout', '--detach', 'FETCH_HEAD')
        else:
            actual = subprocess.check_output(['git', '-C', str(target), 'rev-parse', 'HEAD'], text=True).strip()
            if actual != revision: raise SystemExit(f'{target} has a different revision. Preserve it and use a clean runtime directory.')
    run(PYTHON, '-m', 'pip', 'install', '--upgrade', 'pip')
    # Blackwell kernels require the CUDA 13 build in the pinned ComfyUI version.
    run(PYTHON, '-m', 'pip', 'install', 'torch==2.11.0', 'torchvision==0.26.0', 'torchaudio==2.11.0', '--index-url', 'https://download.pytorch.org/whl/cu130')
    run(PYTHON, '-m', 'pip', 'install', '-r', ROOT / 'requirements-runtime.txt')
    shutil.copytree(ROOT / 'custom_nodes/aftertake', RUNTIME / 'ComfyUI/custom_nodes/aftertake', dirs_exist_ok=True)
    if not args.skip_models:
        run(PYTHON, ROOT / 'scripts/download-models.py', *(['--ltx25'] if args.inpaint else []))
    run(PYTHON, ROOT / 'scripts/create-study.py')
    print('Runtime installed. Start it with: python scripts/engine.py')
