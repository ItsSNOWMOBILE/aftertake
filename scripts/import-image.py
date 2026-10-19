"""Normalize bounded phone photos to an oriented, at-most-4K RGB PNG."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

MAX_INPUT_PIXELS = 64_000_000
MAX_INPUT_DIMENSION = 16_384
MIN_EDGE = 64
OUTPUT_LONG_EDGE = 3840
OUTPUT_SHORT_EDGE = 2160


def normalize(source, destination):
    with Image.open(source) as original:
        # Check the header before EXIF transpose/convert can decode all pixels.
        if (original.width * original.height > MAX_INPUT_PIXELS
                or max(original.size) > MAX_INPUT_DIMENSION
                or min(original.size) < MIN_EDGE):
            raise ValueError('Use a photo with at least 64 pixels on each side, '
                             'at most 64 megapixels and no side above 16384 pixels.')
        image = ImageOps.exif_transpose(original).convert('RGB')
        bounds = ((OUTPUT_LONG_EDGE, OUTPUT_SHORT_EDGE) if image.width >= image.height
                  else (OUTPUT_SHORT_EDGE, OUTPUT_LONG_EDGE))
        # Thumbnail never enlarges the source and preserves its oriented aspect.
        image.thumbnail(bounds, Image.Resampling.LANCZOS, reducing_gap=3.0)
        if min(image.size) < MIN_EDGE:
            raise ValueError('Use a less extreme photo aspect ratio so both normalized '
                             'sides remain at least 64 pixels.')
        image.load()
        image.info.clear()
        image.save(destination, format='PNG')
        return {'width': image.width, 'height': image.height, 'duration': 1, 'kind': 'image'}


if __name__ == '__main__':
    source, destination = map(Path, sys.argv[1:3])
    print(json.dumps(normalize(source, destination)))
