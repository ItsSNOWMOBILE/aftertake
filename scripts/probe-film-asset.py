"""Inspect a film upload before admitting it to the local media library."""
import json
from pathlib import Path
import sys
import av
from PIL import Image, ImageOps

source = Path(sys.argv[1])
if source.suffix.lower() in ['.png', '.jpg', '.jpeg', '.webp']:
    with Image.open(source) as opened:
        if opened.width * opened.height > 3840 * 2160:
            raise ValueError('Use an image up to 4K.')
        image = ImageOps.exif_transpose(opened).convert('RGB')
        image.load()
        print(json.dumps({'kind': 'image', 'width': image.width, 'height': image.height, 'duration': 30}))
else:
    with av.open(str(source)) as container:
        stream = container.streams.video[0] if container.streams.video else container.streams.audio[0]
        duration = float(stream.duration * stream.time_base) if stream.duration else float(container.duration or 0) / av.time_base
        if not .1 <= duration <= 600:
            raise ValueError('Use media between 0.1 seconds and ten minutes.')
        next(container.decode(stream))
        result = {'kind': 'video' if container.streams.video else 'audio', 'duration': duration}
        if container.streams.video:
            if stream.width * stream.height > 3840 * 2160:
                raise ValueError('Use video up to 4K.')
            result.update(width=stream.width, height=stream.height)
        print(json.dumps(result))
