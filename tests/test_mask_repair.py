from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import av
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_mask_repair', ROOT / 'scripts/repair-character-mask.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)

HEIGHT, WIDTH, FRAMES = 64, 96, 48


def person(frame):
    """A disk moving one and a half pixels a frame, standing in for a tracked person."""
    ys, xs = np.mgrid[:HEIGHT, :WIDTH]
    return (ys - 32) ** 2 + (xs - 14 - 1.5 * frame) ** 2 <= 12 ** 2


def write(path, frames, codec, pix_fmt):
    with av.open(str(path), 'w') as container:
        stream = container.add_stream(codec, rate=24)
        stream.width, stream.height, stream.pix_fmt = WIDTH, HEIGHT, pix_fmt
        for index, pixels in enumerate(frames):
            frame = av.VideoFrame.from_ndarray(pixels, format='gray' if pix_fmt == 'gray' else 'rgb24')
            frame.pts, frame.time_base = index, Fraction(1, 24)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def read(path):
    with av.open(str(path)) as container:
        return np.stack([frame.to_ndarray(format='gray') > 127 for frame in container.decode(video=0)])


class MaskRepairTest(unittest.TestCase):
    def run_repair(self, masks):
        folder = Path(self.enterContext(tempfile.TemporaryDirectory()))
        write(folder / 'mask.mkv', [mask.astype(np.uint8) * 255 for mask in masks], 'ffv1', 'gray')
        write(folder / 'source.mp4', [np.full((HEIGHT, WIDTH, 3), 90, np.uint8)] * len(masks), 'libx264', 'yuv420p')
        job = {'mask': str(folder / 'mask.mkv'), 'source': str(folder / 'source.mp4'),
               'maskOut': str(folder / 'repaired.mkv'), 'previewOut': str(folder / 'preview.mp4'),
               'request': {'format': 'aftertake-character-selection/1'}}
        result = repair.repair(job)
        repaired = read(folder / 'repaired.mkv') if result['changed'] else None
        return result, repaired, folder

    def test_lost_frames_follow_the_motion_and_flicker_is_restored(self):
        truth = np.stack([person(frame) for frame in range(FRAMES)])
        masks = truth.copy()
        masks[10:15] = False  # tracking lost the person for five frames
        masks[30, :, :] &= ~(np.mgrid[:HEIGHT, :WIDTH][0] < 32)  # top half drops out for one frame
        result, repaired, folder = self.run_repair(masks)
        self.assertTrue(result['changed'])
        self.assertEqual(result['repair']['framesRecovered'], [10, 11, 12, 13, 14])
        self.assertEqual(result['selection']['emptyFrames'], [])
        for frame in range(10, 15):
            overlap = (repaired[frame] & truth[frame]).sum() / truth[frame].sum()
            self.assertGreater(overlap, .97, frame)
        # Pixels covered on both sides of the dropout come back.
        hole = truth[30] & ~masks[30]
        both = hole & truth[29] & truth[31]
        self.assertTrue(repaired[30][both].all())
        self.assertGreater(result['repair']['restoredPixels'], 0)
        # Repair only ever adds to the mask.
        self.assertTrue((repaired | masks == repaired).all())
        with open(folder / 'repaired.mkv', 'rb') as file:
            import hashlib
            self.assertEqual(hashlib.sha256(file.read()).hexdigest(), result['selection']['maskSha256'])
        with av.open(str(folder / 'preview.mp4')) as preview:
            recipe = json.loads(preview.metadata['comment'])['recipe']
            self.assertEqual(recipe['repair']['framesRecovered'], [10, 11, 12, 13, 14])
            self.assertEqual(preview.streams.video[0].frames or FRAMES, FRAMES)

    def test_a_long_loss_stays_lost_and_is_reported(self):
        masks = np.stack([person(frame) for frame in range(FRAMES)])
        masks[5:5 + repair.MAX_GAP + 1] = False
        masks[40:43] = False
        result, repaired, _ = self.run_repair(masks)
        self.assertEqual(result['repair']['framesRecovered'], [40, 41, 42])
        self.assertEqual(result['selection']['emptyFrames'], list(range(5, 5 + repair.MAX_GAP + 1)))
        self.assertFalse(repaired[5:5 + repair.MAX_GAP + 1].any())

    def test_a_clean_mask_is_left_alone(self):
        result, repaired, _ = self.run_repair(np.stack([person(frame) for frame in range(FRAMES)]))
        self.assertEqual(result, {'changed': False})
        self.assertIsNone(repaired)

    def test_a_mask_lost_everywhere_needs_new_tracking(self):
        with self.assertRaisesRegex(ValueError, 'every frame'):
            self.run_repair(np.zeros((FRAMES, HEIGHT, WIDTH), bool))


if __name__ == '__main__':
    unittest.main()
