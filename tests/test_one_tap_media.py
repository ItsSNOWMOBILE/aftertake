"""The one-tap effect media steps: measuring a clip for checks and framing a photo as 9:16."""
import importlib.util
from fractions import Fraction
from pathlib import Path
import tempfile
import unittest
import av
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check = load('check_clip', 'check-clip.py')
framing = load('one_tap_frame', 'one-tap-frame.py')


def write_video(path, pictures, rate=24):
    with av.open(str(path), 'w') as container:
        stream = container.add_stream('libx264', rate=rate)
        stream.width, stream.height = pictures[0].size
        stream.pix_fmt = 'yuv420p'
        for index, picture in enumerate(pictures):
            frame = av.VideoFrame.from_image(picture)
            frame.pts, frame.time_base = index, Fraction(1, rate)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def textured(offset, size=(96, 160)):
    """A gradient with a bright square that moves with offset."""
    pixels = np.tile(np.linspace(40, 200, size[0], dtype=np.uint8), (size[1], 1))
    pixels[60:90, offset:offset + 24] = 250
    return Image.fromarray(pixels).convert('RGB')


class OneTapMediaTests(unittest.TestCase):
    def test_measures_length_brightness_and_motion(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-check-') as folder:
            moving, frozen, black = (Path(folder) / name for name in ('moving.mp4', 'frozen.mp4', 'black.mp4'))
            write_video(moving, [textured(index) for index in range(48)])
            write_video(frozen, [textured(10)] * 48)
            write_video(black, [Image.new('RGB', (96, 160))] * 24)
            measured = check.measure(moving)
            self.assertEqual((measured['frames'], measured['width'], measured['height']), (48, 96, 160))
            self.assertAlmostEqual(measured['duration'], 2.0)
            self.assertGreater(measured['lumaSpread'], 20)
            self.assertGreater(measured['motion'], 1)
            self.assertLess(check.measure(frozen)['motion'], 0.35)
            dark = check.measure(black)
            self.assertLess(dark['meanLuma'], 6)
            self.assertLess(dark['lumaSpread'], 3)

    def test_frames_a_wide_photo_from_its_centre_and_a_tall_one_at_the_focus(self):
        wide = Image.new('RGB', (1600, 900), (0, 0, 0))
        wide.paste((255, 0, 0), (700, 0, 900, 900))
        framed = framing.portrait(wide, 0.4)
        self.assertEqual(framed.size, (506, 900))
        self.assertEqual(framed.getpixel((253, 450)), (255, 0, 0))
        tall = Image.new('RGB', (900, 2400), (0, 0, 0))
        tall.paste((0, 255, 0), (0, 0, 900, 200))
        top = framing.portrait(tall, 0)
        self.assertEqual(top.getpixel((10, 10)), (0, 255, 0))
        self.assertEqual(framing.portrait(tall, 1).getpixel((10, 10)), (0, 0, 0))
        self.assertEqual(top.size[1], 1600)
        huge = framing.portrait(Image.new('RGB', (3000, 6000)), 0.5)
        self.assertEqual(huge.size, (1080, 1920))

    def test_takes_the_frame_of_a_clip_at_the_chosen_moment(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-frame-') as folder:
            clip = Path(folder) / 'clip.mp4'
            write_video(clip, [Image.new('RGB', (160, 96), (0, 0, 0))] * 24 + [Image.new('RGB', (160, 96), (255, 255, 255))] * 24)
            early = framing.source_picture(clip, 0.2)
            late = framing.source_picture(clip, 1.5)
            self.assertLess(np.asarray(early).mean(), 20)
            self.assertGreater(np.asarray(late).mean(), 235)


if __name__ == '__main__':
    unittest.main()
