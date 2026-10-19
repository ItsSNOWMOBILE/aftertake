"""Install the pinned ComfyUI stack and original sample. Run with Python 3.12."""
from pathlib import Path
import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from model_storage import model_root

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
VENV = RUNTIME / 'venv'
PYTHON = VENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
sys.path.insert(0,str(ROOT/'custom_nodes/aftertake'))
from hardware import HardwareConfig, HardwareConfigurationError, validate_preflight_report
REPOS = [
    ('https://github.com/comfyanonymous/ComfyUI.git', RUNTIME / 'ComfyUI', '5cc4b870094c89090db54bd8d12649dcaf89f2ba'),
    ('https://github.com/city96/ComfyUI-GGUF.git', RUNTIME / 'ComfyUI/custom_nodes/ComfyUI-GGUF', '6ea2651e7df66d7585f6ffee804b20e92fb38b8a'),
    ('https://github.com/Lightricks/ComfyUI-LTXVideo.git', RUNTIME / 'ComfyUI/custom_nodes/ComfyUI-LTXVideo', '44c8a36b7c31ee00b4271daed11dc2a4aa481140'),
]
def run(*args): subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    profiles = parser.add_mutually_exclusive_group()
    profiles.add_argument('--inpaint', action='store_true', help='Download the LTX-2.5 profile instead of the original structural profile')
    profiles.add_argument('--motion-transfer', action='store_true', help='Download the Wan Animate 2 profile instead of the original structural profile')
    profiles.add_argument('--image-gen', action='store_true', help='Download the Z-Image Turbo text-to-image profile instead of the original structural profile')
    profiles.add_argument('--character-swap', action='store_true', help='Install the native H3 character replacement and SAM3 profile')
    profiles.add_argument('--depth-effects', action='store_true', help='Install the optional native DA3 Small BF16 still-image depth profile')
    parser.add_argument('--models-dir', help='Download to this disk and remember it for the engine and future downloads')
    parser.add_argument('--skip-models', action='store_true', help='Install runtime and sample only; reuse model files from an existing installation')
    parser.add_argument('--gpu-index', type=int, default=0, help='Validate this currently visible CUDA GPU before downloading models')
    parser.add_argument('--ffmpeg-bin', help='Directory containing FFmpeg and FFprobe for the character profile')
    args = parser.parse_args(argv)
    if sys.version_info[:2] != (3, 12): raise SystemExit('Use Python 3.12 for the pinned runtime.')
    if sys.platform not in ('win32','linux') or platform.machine().lower() not in ('amd64','x86_64'):
        raise SystemExit('The pinned CUDA generation runtime targets Windows/Linux x86-64. Use pnpm demo to explore recorded examples on other devices; CPU diffusion and SAM3 fallbacks are not enabled.')
    if shutil.which('git') is None:raise SystemExit('Install Git and reopen the terminal before running runtime setup.')
    if args.gpu_index < 0:raise SystemExit('--gpu-index must be a non-negative visible CUDA index.')
    if args.ffmpeg_bin:
        tools=Path(args.ffmpeg_bin).expanduser().resolve()
        if not all((tools/(name+('.exe' if sys.platform=='win32' else ''))).is_file() for name in ('ffmpeg','ffprobe')):
            raise SystemExit('--ffmpeg-bin must contain both ffmpeg and ffprobe.')
        os.environ['PATH']=str(tools)+os.pathsep+os.environ.get('PATH','')
    if args.character_swap and not all(shutil.which(name) for name in ('ffmpeg','ffprobe')):
        raise SystemExit('The character profile needs FFmpeg and FFprobe. Install both on PATH or pass --ffmpeg-bin PATH_TO_BIN before downloading the profile; use the same flag when launching the engine.')
    RUNTIME.mkdir(exist_ok=True)
    models_directory = model_root(args.models_dir) if args.models_dir is not None else None
    if not PYTHON.exists(): run(sys.executable, '-m', 'venv', VENV)
    repos = [*REPOS]
    if args.character_swap:
        repos.append(('https://github.com/akatz-ai/h3-relay.git', RUNTIME / 'ComfyUI/custom_nodes/h3-relay', '64341d5c1259f32ab2a780285e1a19accb4dfe07'))
    for url, target, revision in repos:
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
    run(PYTHON, '-m', 'pip', 'check')
    try:
        check=subprocess.run([str(PYTHON),str(ROOT/'scripts/hardware-check.py'),'--gpu-index',str(args.gpu_index),'--json'],
            cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=120)
        report=json.loads(check.stdout)
    except (OSError,subprocess.TimeoutExpired,ValueError,TypeError):
        raise SystemExit('The CUDA runtime preflight could not finish. Check the pinned Python runtime and NVIDIA driver before downloading model weights.')
    try:
        validation_environment={**os.environ,'AFTERTAKE_GPU_DEVICE':'0'}
        validate_preflight_report(report,HardwareConfig.from_environment(validation_environment))
        if check.returncode:raise HardwareConfigurationError('preflight_failed','The CUDA preflight process failed.')
    except HardwareConfigurationError as error:
        raise SystemExit(f'Hardware configuration error [{error.code}]: {error} No model download has started.')
    shutil.copytree(ROOT / 'custom_nodes/aftertake', RUNTIME / 'ComfyUI/custom_nodes/aftertake', dirs_exist_ok=True)
    if not args.skip_models:
        profile = ['--depth-effects'] if args.depth_effects else ['--character-swap'] if args.character_swap else ['--image-gen'] if args.image_gen else ['--motion-transfer'] if args.motion_transfer else ['--ltx25'] if args.inpaint else []
        run(PYTHON, ROOT / 'scripts/download-models.py', *profile, *(['--models-dir', str(models_directory)] if models_directory is not None else []))
    run(PYTHON, ROOT / 'scripts/create-study.py')
    print('Runtime installed. Start it with: python scripts/engine.py')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
