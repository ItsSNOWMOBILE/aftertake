"""Normalize an uploaded still to an oriented RGB PNG for repeatable conditioning."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

source, destination = map(Path, sys.argv[1:3])
with Image.open(source) as original:
    if original.width * original.height > 3840 * 2160 or min(original.size) < 64:
        raise ValueError('Use an image at least 64 pixels on each side, up to 4K.')
    image = ImageOps.exif_transpose(original).convert('RGB')
    image.load()
    image.save(destination, format='PNG')
    print(json.dumps({'width': image.width, 'height': image.height, 'duration': 1, 'kind': 'image'}))
