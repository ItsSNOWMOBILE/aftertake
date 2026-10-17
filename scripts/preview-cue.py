"""Render the exact Comfy-node mask into a compact RGBA sprite sheet, on CPU."""
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
key = sys.argv[1]
if not re.fullmatch('[a-f0-9]{64}', key): raise ValueError('Invalid preview key')
folder = root / '.data/previews'
settings = json.loads((folder / f'{key}.json').read_text(encoding='utf-8'))
spec = importlib.util.spec_from_file_location('aftertake_preview', root / 'custom_nodes/aftertake/__init__.py')
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)
width, height, frames, fps = [settings[k] for k in ['width', 'height', 'frames', 'fps']]
images = nodes.decode_clip(root / '.data/clips' / Path(settings['clip']['url']).name,
                           width, height, frames, fps, settings['trimStart'])
mask = nodes.build_cue_mask(width, height, frames, fps, settings['cue'], images).numpy()
sheet = Image.new('RGBA', (width * 8, height * math.ceil(frames / 8)))
for index, frame in enumerate(mask):
    pixels = np.empty((height, width, 4), dtype=np.uint8)
    pixels[..., :3] = [215, 232, 145]
    pixels[..., 3] = np.round(frame * 255).astype(np.uint8)
    sheet.paste(Image.fromarray(pixels), ((index % 8) * width, (index // 8) * height))
temp = folder / f'{key}.tmp.png'
sheet.save(temp)
temp.replace(folder / f'{key}.png')
print(json.dumps({'url': f'/previews/{key}.png', 'width': width, 'height': height, 'frames': frames, 'fps': fps}))
