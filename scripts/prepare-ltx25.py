"""Resolve public experimental model artifacts to immutable hashes for review."""
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parents[1]
files = [
    ('unsloth/LTX-2.5-GGUF', 'distilled/ltx-2.5-22b-distilled-Q4_K_M.gguf', 'diffusion_models'),
    ('unsloth/LTX-2.5-GGUF', 'text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors', 'text_encoders'),
    ('unsloth/LTX-2.5-GGUF', 'vae/ltx-2.5-video-vae-conv-bf16.safetensors', 'vae'),
]
def get(url):
    with urllib.request.urlopen(url, timeout=60) as response:return json.load(response)
manifest=[]
for repo,remote,category in files:
    info=get(f'https://huggingface.co/api/models/{repo}')
    if info.get('gated'):raise RuntimeError(f'{repo} requires account access; do not download without it.')
    folder=remote.rpartition('/')[0]
    entries=get(f'https://huggingface.co/api/models/{repo}/tree/{info["sha"]}/{folder}?expand=true')
    meta=next(entry for entry in entries if entry['path']==remote)
    manifest.append({'repository':repo,'revision':info['sha'],'path':remote,'category':category,
                     'size':meta['size'],'sha256':meta['lfs']['oid'],'license':info.get('cardData',{}).get('license')})
    print(f'{remote}: {meta["size"]/1e9:.2f} GB',flush=True)
(root/'docs/models-ltx25-experimental.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(f'Total: {sum(x["size"] for x in manifest)/1e9:.2f} GB',flush=True)
