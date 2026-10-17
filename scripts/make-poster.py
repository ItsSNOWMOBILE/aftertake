"""Extract an actual output frame for the built-in recipe library."""
from pathlib import Path
import sys
import av

with av.open(sys.argv[1]) as container:
    image = None
    for frame in container.decode(video=0):
        image = frame.to_image()
        if float(frame.time or 0) >= 1.5:
            break
    if image is None:
        raise ValueError('No output frame for the recipe preview')
    image.thumbnail((640, 360))
    image.save(Path(sys.argv[2]), format='JPEG', quality=86)
