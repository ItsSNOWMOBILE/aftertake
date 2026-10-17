"""Resumable, SHA-256-verified downloads. Model metadata is retained for provenance."""
from __future__ import annotations
import concurrent.futures
import hashlib
import http.client
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import sys

ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT / '.runtime' / 'ComfyUI' / 'models'
MANIFEST = ROOT / 'docs' / ('models-frame-editor.json' if '--frame-edit' in sys.argv else 'models-motion-track.json' if '--motion' in sys.argv else 'models-ltx25-experimental.json' if '--ltx25' in sys.argv else 'model-receipts.json')
FILES = [
    ('Kijai/LTXV2_comfy', 'diffusion_models/ltx-2-19b-distilled_Q4_K_M.gguf', 'diffusion_models'),
    ('Kijai/LTXV2_comfy', 'VAE/LTX2_video_vae_bf16.safetensors', 'vae'),
    ('Kijai/LTXV2_comfy', 'text_encoders/ltx-2-19b-embeddings_connector_distill_bf16.safetensors', 'text_encoders'),
    ('Comfy-Org/LTX-2', 'split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors', 'text_encoders'),
    ('Lightricks/LTX-2-19b-IC-LoRA-Canny-Control', 'ltx-2-19b-ic-lora-canny-control.safetensors', 'loras'),
]

def json_url(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)

def download(item):
    repo, remote, category = item
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8-sig'))
    pinned = next(entry for entry in manifest if entry['repository'] == repo and entry['path'] == remote)
    info = json_url(f'https://huggingface.co/api/models/{repo}/revision/{pinned["revision"]}')
    revision = info['sha']
    folder, _, name = remote.rpartition('/')
    entries = json_url(f'https://huggingface.co/api/models/{repo}/tree/{revision}/{folder}?expand=true')
    meta = next(entry for entry in entries if entry['path'] == remote)
    expected_size = meta['size']
    expected_hash = meta.get('lfs', {}).get('oid')
    if expected_hash != pinned['sha256'] or expected_size != pinned['size']:
        raise RuntimeError(f'Metadata differs from the checked-in model manifest: {remote}')
    if not expected_hash:
        raise RuntimeError(f'No LFS SHA-256 available: {remote}')
    target = MODEL_ROOT / category / name
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + '.part')
    print(f'{name}: {expected_size / 1e9:.2f} GB @ {revision[:12]}', flush=True)
    if not target.exists():
        for attempt in range(6):
            offset = partial.stat().st_size if partial.exists() else 0
            if offset == expected_size:
                break
            request = urllib.request.Request(
                f'https://huggingface.co/{repo}/resolve/{revision}/{urllib.parse.quote(remote)}',
                headers={'Range': f'bytes={offset}-'} if offset else {},
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    if offset and response.status != 206:
                        raise OSError('Server did not honor resume range')
                    with partial.open('ab' if offset else 'wb') as output:
                        last_report = time.monotonic()
                        while chunk := response.read(8 * 1024 * 1024):
                            output.write(chunk)
                            offset += len(chunk)
                            if time.monotonic() - last_report > 20:
                                print(f'{name}: {offset / expected_size:.0%}', flush=True)
                                last_report = time.monotonic()
                if partial.stat().st_size != expected_size:
                    raise OSError('Incomplete response; keeping the partial file for resume')
                break
            except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
                if attempt == 5:
                    raise
                print(f'{name}: resume after {type(error).__name__}', flush=True)
                time.sleep(min(2 ** attempt, 30))
        candidate = partial
    else:
        candidate = target
    digest = hashlib.sha256()
    with candidate.open('rb') as stream:
        while chunk := stream.read(16 * 1024 * 1024):
            digest.update(chunk)
    if candidate.stat().st_size != expected_size or digest.hexdigest() != expected_hash:
        raise RuntimeError(f'Integrity verification failed: {name}')
    if candidate == partial:
        partial.replace(target)
    receipt = {'repository': repo, 'revision': revision, 'path': remote,
               'size': expected_size, 'sha256': expected_hash, 'license': info.get('cardData', {}).get('license')}
    receipts = ROOT / '.runtime' / 'receipts'
    receipts.mkdir(exist_ok=True)
    (receipts / f'{name}.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(f'{name}: verified', flush=True)
    return receipt

if __name__ == '__main__':
    if any(flag in sys.argv for flag in ['--ltx25', '--motion', '--frame-edit']):
        FILES = [(entry['repository'], entry['path'], entry['category']) for entry in json.loads(MANIFEST.read_text(encoding='utf-8-sig'))]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(download, FILES))
