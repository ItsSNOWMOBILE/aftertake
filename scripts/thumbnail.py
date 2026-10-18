"""Decode one source frame for the editor without occupying a video decoder."""
from pathlib import Path
import sys
import av
from PIL import Image, ImageOps
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake'))
from media_utils import oriented_image

source, destination, seconds = Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3])
if source.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}:
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
else:
  with av.open(str(source)) as container:
    stream = container.streams.video[0]
    origin = float(stream.start_time * stream.time_base) if stream.start_time else 0
    container.seek(int((seconds + origin) / stream.time_base), stream=stream, backward=True)
    image = None
    for frame in container.decode(stream):
        image = oriented_image(frame)
        if float(frame.time or 0) - origin + 1e-6 >= seconds:
            break
    if image is None:
        raise ValueError('No thumbnail frame in the requested range')
width = int(sys.argv[4]) if len(sys.argv) > 4 else 320
if not 16 <= width <= 960:
    raise ValueError('Choose a thumbnail width from 16 to 960 pixels')
image.thumbnail((width, round(width * 9 / 16)))
temporary = destination.with_suffix('.tmp')
image.save(temporary, format='JPEG', quality=82)
temporary.replace(destination)
