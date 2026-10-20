"""Real CPU cutout transforms, bounded video clocks and source-audio checks."""
from pathlib import Path
from fractions import Fraction
import importlib.util
import json
import subprocess
import tempfile
import unittest

import av
import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('subject_effects', ROOT / 'scripts/subject-effects.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def copy(**changes):
    return {'x': .25, 'y': 0, 'scale': 1, 'opacity': 1, **changes}


def write_video(path, masks=False, frames=24, width=96, height=64):
    with av.open(str(path), 'w') as container:
        stream = container.add_stream('ffv1' if masks else 'libx264', rate=24)
        stream.width, stream.height = width, height
        stream.pix_fmt = 'gray' if masks else 'yuv420p'
        for index in range(frames):
            pixels = np.zeros((height, width), np.uint8)
            pixels[16:48, 12 + index // 4:28 + index // 4] = 255
            rgb = np.zeros((height, width, 3), np.uint8)
            rgb[:] = [30, 50, 70]
            rgb[pixels > 0] = [220, 90, 40]
            frame = av.VideoFrame.from_ndarray(pixels if masks else rgb, format='gray' if masks else 'rgb24')
            frame.pts, frame.time_base = index, Fraction(1, 24)
            for packet in stream.encode(frame): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)


class SubjectEffectTests(unittest.TestCase):
    def test_moving_person_is_copied_without_wrapping_or_changing_other_pixels(self):
        for left in [8, 12, 18]:
            source = np.full((64, 96, 3), 30, np.uint8)
            mask = np.zeros((64, 96), np.uint8)
            mask[20:40, left:left + 12] = 255
            source[mask > 0] = [240, 70, 20]
            output = worker.composite_frame(source, mask, [copy()], feather=0, anchor=(14, 30))
            expected = source.copy(); expected[20:40, left + 24:left + 36] = [240, 70, 20]
            np.testing.assert_array_equal(output, expected)
            off_left = worker.composite_frame(source, mask, [copy(x=-.25)], feather=0)
            np.testing.assert_array_equal(off_left[:, 80:], source[:, 80:])
            np.testing.assert_array_equal(worker.composite_frame(source, mask, [copy(x=0)], feather=5, grow=3), source)

    def test_scale_flip_opacity_and_rotation_use_premultiplied_edges(self):
        source = np.full((64, 96, 3), 255, np.uint8)
        mask = np.zeros((64, 96), np.uint8); mask[20:36, 12:28] = 255
        source[mask > 0] = [255, 0, 0]
        rotated = worker.composite_frame(source, mask, [copy(x=.5, scale=1.6, rotation=33)], feather=1, anchor=(20, 28))
        # A red cutout over white must never acquire a dark/black resize halo.
        self.assertTrue(np.all(rotated[10:60, 45:95, 0] == 255))
        half = worker.composite_frame(source, mask, [copy(opacity=.5)], feather=0)
        np.testing.assert_array_equal(half[25, 40], [255, 128, 128])
        asymmetric = source.copy(); asymmetric[20:36, 12:20] = [0, 0, 255]
        flipped = worker.composite_frame(asymmetric, mask, [copy(flipX=True)], feather=0)
        np.testing.assert_array_equal(flipped[25, 38], [255, 0, 0])
        np.testing.assert_array_equal(flipped[25, 48], [0, 0, 255])

    def test_focus_uses_current_mask_and_excludes_actor_color_from_background_blur(self):
        for left in [12, 28]:
            source = np.full((64, 96, 3), 255, np.uint8)
            mask = np.zeros((64, 96), np.uint8); mask[16:48, left:left + 16] = 255
            source[mask > 0] = [255, 0, 0]
            output = worker.composite_frame(source, mask, [], background_blur=8, background_exposure=-1)
            np.testing.assert_array_equal(output[mask == 255], source[mask == 255])
            background = output[mask == 0]
            self.assertTrue(np.all(background[:, 0] == background[:, 1]))
            self.assertTrue(np.all(background[:, 1] == background[:, 2]))
            self.assertTrue(np.all(background < 255))
            np.testing.assert_array_equal(worker.composite_frame(source, mask, [], background_blur=0, background_exposure=0), source)

    def test_invalid_transforms_and_canvas_mismatches_fail(self):
        for request in [{'copies': [copy(scale=4)]}, {'copies': [copy(x=float('nan'))]},
                        {'copies': [copy(rotation=181)]}, {'copies': [copy()] * 5},
                        {'copies': [], 'backgroundBlur': 33},
                        {'copies': [copy(color='red')]},
                        {'copies': [copy(color='#ff123456')]},
                        {'copies': [copy(behindSubject=1)]}]:
            with self.assertRaises(ValueError): worker.validate_settings(request)
        with self.assertRaises(ValueError):
            worker.composite_frame(np.zeros((32, 64, 3), np.uint8), np.zeros((32, 32), np.uint8), [])

    def test_colored_echo_uses_moving_alpha_and_keeps_original_person_in_front(self):
        for left in (18, 30):
            source = np.full((64, 96, 3), [30, 50, 70], np.uint8)
            mask = np.zeros((64, 96), np.uint8)
            mask[12:48, left:left + 20] = 255
            mask[18:30, left + 20:left + 28] = 255
            source[mask > 0] = [210, 170, 130]
            output = worker.composite_frame(source, mask, [
                copy(x=.25, color='#ff783e', behindSubject=True),
                copy(x=.125, color='#ff2a96', behindSubject=True),
            ], anchor=(28, 30))
            np.testing.assert_array_equal(output[mask == 255], source[mask == 255])
            np.testing.assert_array_equal(output[40, left + 25], [255, 42, 150])
            np.testing.assert_array_equal(output[40, left + 40], [255, 120, 62])
            np.testing.assert_array_equal(output[:10], source[:10])
            # The arm follows the actual alpha shape, not a translated box.
            np.testing.assert_array_equal(output[22, left + 49], [255, 120, 62])
            np.testing.assert_array_equal(output[40, left + 49], source[40, left + 49])

    def test_silhouette_zero_offset_can_fill_original_and_opacity_is_applied_once(self):
        source = np.full((64, 96, 3), 255, np.uint8)
        mask = np.zeros((64, 96), np.uint8); mask[20:40, 12:28] = 255
        source[mask > 0] = [255, 0, 0]
        color = worker.composite_frame(source, mask, [copy(x=0, color='#0000ff')])
        np.testing.assert_array_equal(color[25, 18], [0, 0, 255])
        half = worker.composite_frame(source, mask, [copy(color='#0000ff', opacity=.5)])
        np.testing.assert_array_equal(half[25, 40], [128, 128, 255])
        protected = worker.composite_frame(source, mask, [copy(x=0, color='#0000ff', behindSubject=True)])
        np.testing.assert_array_equal(protected, source)

    def test_video_export_keeps_frame_clock_and_trims_source_audio_once(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-subject-') as temp:
            folder = Path(temp)
            prepared, mask, original, output = [folder / name for name in ('prepared.mp4', 'mask.mkv', 'original.mp4', 'result.mp4')]
            write_video(prepared); write_video(mask, masks=True)
            binary = imageio_ffmpeg.get_ffmpeg_exe()
            subprocess.run([binary, '-v', 'error', '-y', '-stream_loop', '1', '-i', str(prepared),
                '-f', 'lavfi', '-i', 'aevalsrc=0.12*sin(2*PI*(330*t+170*t*t)):s=48000:d=2',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', '2', str(original)], check=True, capture_output=True)
            info = worker.inspect_media(mask, 'mask')
            settings = {'request': {'copies': [copy(color='#ff2a96', behindSubject=True)], 'feather': 1}, 'selection': info,
                'source': str(original), 'prepared': str(prepared), 'mask': str(mask),
                'hashes': {'source': worker.digest(original), 'prepared': worker.digest(prepared), 'mask': worker.digest(mask)},
                'trimStart': .5, 'output': str(output), 'recipe': {'format': 'test-subject-recipe'}}
            result = worker.render(settings)
            self.assertEqual((result['frames'], result['fps'], result['hasAudio']), (24, 24, True))
            with av.open(str(output)) as container:
                decoded = list(container.decode(video=0))
                self.assertEqual(len(decoded), 24)
                self.assertTrue(all(abs(float(frame.pts * frame.time_base) - i / 24) < 1e-5 for i, frame in enumerate(decoded)))
                self.assertEqual(json.loads(container.metadata['comment'])['renderer'], 'aftertake-local-subject-compositor/1')
            def audio(file, start):
                args = [binary, '-v', 'error', '-i', str(file), '-ss', str(start), '-t', '1', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1']
                return np.frombuffer(subprocess.check_output(args), '<i2').astype(np.float32) / 32768
            actual, expected = audio(output, 0), audio(original, .5)
            self.assertEqual(len(actual), 48000)
            self.assertLess(float(np.mean((actual - expected) ** 2)), .0002)
            self.assertAlmostEqual(float(np.sqrt(np.mean(actual ** 2)) / np.sqrt(np.mean(expected ** 2))), 1, delta=.03)
            broken = {**settings, 'output': str(folder / 'should-not-exist.mp4'), 'hashes': {**settings['hashes'], 'mask': '0' * 64}}
            with self.assertRaises(ValueError): worker.render(broken)
            self.assertFalse(Path(broken['output']).exists())
            short_mask = folder / 'short.mkv'; write_video(short_mask, masks=True, frames=23)
            with self.assertRaises(ValueError): worker.inspect_media(short_mask, 'mask')


if __name__ == '__main__': unittest.main()
