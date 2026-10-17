"""Install a manually downloaded, access-approved inpainting adapter by hash."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import urllib.request
from model_storage import model_root

root = Path(__file__).resolve().parents[1]
name = 'ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors'
expected = '73dd0841c0d4f0eb26fb1f017781b841b2752021944ac5ecefe57917f6dae6b5'
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Downloads' / name
digest = hashlib.sha256()
with source.open('rb') as stream:
    while chunk := stream.read(16 * 1024 * 1024): digest.update(chunk)
if digest.hexdigest() != expected: raise SystemExit('Hash mismatch: the file is incomplete or is not the expected published adapter.')
target = model_root() / 'loras' / name
target.parent.mkdir(parents=True, exist_ok=True)
if not target.exists():
    temp = target.with_suffix('.safetensors.importing')
    shutil.copyfile(source, temp)
    temp.replace(target)
elif hashlib.file_digest(target.open('rb'), 'sha256').hexdigest() != expected:
    raise SystemExit('A different file already exists at the model destination. Preserve it before installing this adapter.')
repo = 'Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting'
with urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}') as response: info = json.load(response)
receipt = {'repository': repo, 'revision': info['sha'], 'path': name, 'category': 'loras',
           'size': source.stat().st_size, 'sha256': expected, 'gated': True,
           'license': info.get('cardData', {}).get('license'), 'installation': 'User-approved gated download via browser'}
(root / 'docs/model-inpaint-receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(f'Verified and installed {name} ({source.stat().st_size / 1e9:.2f} GB).')
