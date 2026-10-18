"""Install optional local narration in a separate CPU environment."""
import hashlib
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv

root = Path(__file__).resolve().parents[1]
environment = root / '.runtime/voice-venv'
python = environment / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
if not python.exists():
    venv.create(environment, with_pip=True)
subprocess.run([str(python), '-m', 'pip', 'install', 'kokoro-onnx==0.6.1', 'soundfile==0.14.0'], check=True)
models = root / '.runtime/narration-models'
models.mkdir(parents=True, exist_ok=True)
for name, digest in [('kokoro-v1.0.onnx', 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a'),
                     ('voices-v1.0.bin', 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d')]:
    target = models / name
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        temporary = target.with_suffix('.download')
        request = urllib.request.Request('https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/' + name,
            headers={'User-Agent': 'Aftertake-narration-setup/1'})
        with urllib.request.urlopen(request, timeout=180) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
            temporary.unlink()
            raise RuntimeError('Downloaded narration weights failed their SHA-256 check.')
        temporary.replace(target)
print('Local Kokoro narration is ready. Restart Aftertake if it is running.')
