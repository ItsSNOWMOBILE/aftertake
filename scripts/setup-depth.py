"""Install local depth for foreground protection on this computer's accelerator.

Installs one ONNX Runtime package into this Python (the media runtime) and the
pinned Depth Anything V2 Small model (99 MB, Apache-2.0):

    Apple silicon         Core ML, which runs on the Neural Engine and GPU
    Intel Core Ultra      OpenVINO, which runs on the Intel NPU
    Snapdragon Windows    QNN, which runs on the Qualcomm NPU
    other Windows PCs     DirectML, on any DirectX 12 GPU
    everything else       the CPU

    python scripts/setup-depth.py [--provider=coreml|openvino|qnn|directml|cpu]

The launcher runs this for you: node scripts/aftertake.mjs setup-npu
"""
from pathlib import Path
import hashlib
import platform
import subprocess
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from depth_runtime import MODEL, MODEL_PATH  # noqa: E402

PACKAGES = {
    'coreml': ['onnxruntime==1.30.0'],
    'cpu': ['onnxruntime==1.30.0'],
    'qnn': ['onnxruntime-qnn==2.6.0'],
    # Windows loads OpenVINO's own libraries from the openvino package.
    'openvino': ['onnxruntime-openvino==1.24.1'] + (['openvino==2025.4.1'] if sys.platform == 'win32' else []),
    'directml': ['onnxruntime-directml==1.24.4'],
}
# The variants all provide the onnxruntime module, so only one may be installed.
VARIANTS = ['onnxruntime', 'onnxruntime-qnn', 'onnxruntime-openvino', 'onnxruntime-directml', 'onnxruntime-gpu']


def cpu_name():
    try:
        if sys.platform == 'win32':
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DESCRIPTION\System\CentralProcessor\0')
            return winreg.QueryValueEx(key, 'ProcessorNameString')[0]
        if sys.platform == 'darwin':
            return subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'], capture_output=True, text=True).stdout
        for line in Path('/proc/cpuinfo').read_text().splitlines():
            if line.startswith('model name'):
                return line.split(':', 1)[1]
    except Exception:
        pass
    return platform.processor()


def automatic(system=None, machine=None, cpu=None, version=None):
    """The accelerator to install for this computer, or None when depth cannot run here."""
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    version = version or sys.version_info[:2]
    if system == 'Darwin':
        return 'coreml' if machine == 'arm64' else None
    if machine in ('arm64', 'aarch64'):
        return 'qnn' if system == 'Windows' else 'cpu'
    # Core Ultra processors carry an Intel NPU; OpenVINO's wheels stop at Python 3.13.
    if 'ultra' in (cpu if cpu is not None else cpu_name()).lower() and version < (3, 14):
        return 'openvino'
    return 'directml' if system == 'Windows' else 'cpu'


def pip(*args):
    subprocess.run([sys.executable, '-m', 'pip', *args], check=True)


def download_model():
    if MODEL_PATH.is_file() and MODEL_PATH.stat().st_size == MODEL['size']:
        with open(MODEL_PATH, 'rb') as file:
            if hashlib.file_digest(file, 'sha256').hexdigest() == MODEL['sha256']:
                print(f'{MODEL["name"]} is already installed.')
                return
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    url = f'https://huggingface.co/{MODEL["repository"]}/resolve/{MODEL["revision"]}/{MODEL["path"]}'
    partial = MODEL_PATH.with_suffix('.part')
    print(f'Downloading {MODEL["name"]} ({MODEL["size"] / 1e6:.0f} MB)...')
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=60) as response, open(partial, 'wb') as file:
        while chunk := response.read(1 << 20):
            digest.update(chunk)
            file.write(chunk)
    if partial.stat().st_size != MODEL['size'] or digest.hexdigest() != MODEL['sha256']:
        partial.unlink(missing_ok=True)
        raise SystemExit('The downloaded depth model did not match its pinned checksum. Run this again.')
    partial.replace(MODEL_PATH)


def main():
    chosen = next((arg.split('=', 1)[1] for arg in sys.argv[1:] if arg.startswith('--provider=')), 'auto')
    provider = automatic() if chosen == 'auto' else chosen
    if provider is None:
        raise SystemExit('Local depth needs Apple silicon, Windows or Linux. Intel Macs are not supported.')
    if provider not in PACKAGES:
        raise SystemExit(f'Choose --provider= one of: {", ".join(PACKAGES)}.')
    if provider == 'openvino' and sys.version_info >= (3, 14):
        raise SystemExit('OpenVINO needs Python 3.13 or older. Use --provider=directml or --provider=cpu.')
    print(f'Installing depth for: {provider}')
    subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', *VARIANTS], capture_output=True)
    pip('install', *PACKAGES[provider])
    download_model()
    result = subprocess.run([sys.executable, str(Path(__file__).with_name('depth_runtime.py')), '--status'],
                            capture_output=True, text=True, check=True)
    print(f'Depth is ready: {result.stdout.strip()}')


if __name__ == '__main__':
    main()
