"""Make the 9:16 still a one-tap effect starts from: a photo, or one frame of a clip.

usage: one-tap-frame.py SOURCE SECONDS OUTPUT.png FOCUS_Y
The picture fills the frame: a wider source is cropped at its centre, a taller one
at FOCUS_Y (0 keeps the top, 1 the bottom). Nothing is stretched or padded.
"""
import json
import sys
from pathlib import Path
import av
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake'))
from media_utils import oriented_image  # noqa: E402

LONG_EDGE = 1920
IMAGES = {'.png', '.jpg', '.jpeg', '.webp'}


def source_picture(source, seconds):
    if source.suffix.lower() in IMAGES:
        with Image.open(source) as opened:
            return ImageOps.exif_transpose(opened).convert('RGB')
    with av.open(str(source)) as container:
        stream = container.streams.video[0]
        picture = None
        if seconds > 0 and stream.time_base:
            container.seek(int(seconds / stream.time_base), stream=stream, backward=True)
        for frame in container.decode(video=0):
            picture = oriented_image(frame)
            if frame.time is None or frame.time >= seconds - 1 / 48:
                break
        if picture is None:
            raise ValueError('The clip has no frame at that time.')
        return picture.convert('RGB')


def portrait(picture, focus_y):
    width, height = picture.size
    if width * 16 > height * 9:
        crop_width = round(height * 9 / 16)
        left = (width - crop_width) // 2
        box = (left, 0, left + crop_width, height)
    else:
        crop_height = round(width * 16 / 9)
        top = round((height - crop_height) * min(1, max(0, focus_y)))
        box = (0, top, width, top + crop_height)
    framed = picture.crop(box)
    if framed.height > LONG_EDGE:
        framed = framed.resize((round(LONG_EDGE * 9 / 16), LONG_EDGE), Image.Resampling.LANCZOS)
    return framed


if __name__ == '__main__':
    source, seconds, output, focus = Path(sys.argv[1]), float(sys.argv[2]), Path(sys.argv[3]), float(sys.argv[4])
    framed = portrait(source_picture(source, seconds), focus)
    framed.save(output, format='PNG')
    print(json.dumps({'width': framed.width, 'height': framed.height}))
