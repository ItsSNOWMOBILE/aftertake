import av
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake'))
from media_utils import oriented_image

with av.open(sys.argv[1]) as container:
    stream = container.streams.video[0]
    duration = float(stream.duration * stream.time_base) if stream.duration else float(container.duration or 0) / av.time_base
    if not duration or duration > 600 or stream.width * stream.height > 3840 * 2160:
        raise ValueError('Use a video under 10 minutes and no larger than 4K.')
    # Decode one frame to reject corrupt or unsupported media before saving the clip.
    image = oriented_image(next(container.decode(video=0)))
    print(json.dumps({'width': image.width, 'height': image.height, 'duration': duration,
                      'hasAudio': bool(container.streams.audio)}))
