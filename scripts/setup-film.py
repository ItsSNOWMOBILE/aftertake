"""Install only the small CPU runtime needed to edit and export films."""
from pathlib import Path
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[1]
environment = root / '.runtime/film-venv'
python = environment / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
if not python.exists():
    venv.create(environment, with_pip=True)
subprocess.run([str(python), '-m', 'pip', 'install', 'av==19.0.1', 'Pillow==12.3.0', 'imageio-ffmpeg==0.6.0', 'numpy==2.5.2'], check=True)
print('Film editing/export runtime is ready. Restart the local studio if it is running.')
print('Native generation needs the ComfyUI engine and model profiles. Hosted LTX generation uses a Comfy key and credits.')
