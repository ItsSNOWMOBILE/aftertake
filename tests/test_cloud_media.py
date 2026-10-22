from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

import av
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_cloud_media', ROOT / 'scripts/cloud-media.py')
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


def write_video(path, frames, fps, codec='libx264', audio_seconds=None):
    """Frames whose level encodes their index; optional sine sound."""
    with av.open(str(path), 'w') as container:
        stream = container.add_stream(codec, rate=Fraction(str(fps)))
        stream.height, stream.width = frames[0].shape[:2]
        stream.pix_fmt = 'yuv420p'
        if codec == 'libx264':
            stream.options = {'crf': '0'}
        sound = None
        if audio_seconds:
            sound = container.add_stream('aac', rate=48000)
            sound.layout = 'mono'
        for index, pixels in enumerate(frames):
            frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
            frame.pts, frame.time_base = index, Fraction(1) / Fraction(str(fps))
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        if sound:
            write_sine(container, sound, audio_seconds)


def write_sine(container, stream, seconds):
    samples = (np.sin(np.arange(int(48000 * seconds)) / 48000 * 2 * np.pi * 440) * 8000).astype(np.int16)
    for start in range(0, len(samples), 1024):
        chunk = samples[start:start + 1024][None]
        frame = av.AudioFrame.from_ndarray(chunk, format='s16', layout='mono')
        frame.sample_rate, frame.pts = 48000, start
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)


def read(path):
    with av.open(str(path)) as container:
        video = container.streams.video[0]
        frames = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
        return {
            'frames': frames,
            'fps': float(video.average_rate),
            'comment': container.metadata.get('comment'),
            'audio': bool(container.streams.audio),
            'audio_seconds': (float(container.streams.audio[0].duration * container.streams.audio[0].time_base)
                              if container.streams.audio and container.streams.audio[0].duration else None),
        }


def levels(count, height=48, width=64):
    return [np.full((height, width, 3), 8 + index * 6, np.uint8) for index in range(count)]


class CloudMediaTest(unittest.TestCase):
    def folder(self):
        return Path(self.enterContext(tempfile.TemporaryDirectory()))

    def test_prepare_puts_the_source_on_the_clip_loaders_frame_clock(self):
        folder = self.folder()
        write_video(folder / 'source.mp4', levels(40), 30)
        result = cloud.prepare({'source': str(folder / 'source.mp4'), 'output': str(folder / 'prepared.mp4'),
                                'width': 32, 'height': 24, 'frames': 24, 'fps': 24, 'trim_start': 0})
        self.assertEqual(result, {'frames': 24, 'width': 32, 'height': 24})
        prepared = read(folder / 'prepared.mp4')
        self.assertEqual(len(prepared['frames']), 24)
        self.assertEqual(prepared['fps'], 24)
        self.assertEqual(prepared['frames'][0].shape, (24, 32, 3))
        expected = cloud.select_frames(folder / 'source.mp4', 32, 24, 24, 24.0, 0.0)
        source = [frame[0, 0].astype(int) for frame in read(folder / 'source.mp4')['frames']]
        shown = [min(range(len(source)), key=lambda i: np.abs(source[i] - frame[0, 0].astype(int)).sum())
                 for frame in expected]
        # 30 fps onto 24 fps: frame k shows the first source frame at or after k/24 s.
        self.assertEqual(shown[:6], [0, 2, 3, 4, 5, 7])
        for actual, wanted in zip(prepared['frames'], expected):
            self.assertLess(np.abs(actual.astype(int) - wanted.astype(int)).max(), 4)
        self.assertFalse(prepared['audio'])

    def test_finish_grades_adds_generated_sound_and_records_the_recipe(self):
        folder = self.folder()
        colour = np.zeros((48, 64, 3), np.uint8)
        colour[:] = (120, 120, 120)
        write_video(folder / 'frames.webm', [colour] * 12, 24, codec='libvpx-vp9')
        with av.open(str(folder / 'sound.flac'), 'w') as container:
            write_sine(container, self.flac(container), 0.3)
        comment = {'recipe': {'format': 'aftertake-text-video/1', 'seed': 7}, 'workflow': {'1': {'class_type': 'UNETLoader'}}}
        result = cloud.finish({'frames': str(folder / 'frames.webm'), 'output': str(folder / 'out.mp4'), 'fps': 24,
                               'palette': 'warm', 'frame_count': 12, 'comment': comment,
                               'generated_audio': str(folder / 'sound.flac')})
        self.assertEqual(result, {'frames': 12, 'width': 64, 'height': 48})
        out = read(folder / 'out.mp4')
        self.assertEqual(len(out['frames']), 12)
        self.assertEqual(out['fps'], 24)
        self.assertEqual(json.loads(out['comment']), comment)
        red, _, blue = out['frames'][6][24, 32].astype(int)
        self.assertGreater(red, 124)  # warm lifts red and its shadows
        self.assertLess(blue, 116)    # and cools nothing: blue drops
        self.assertTrue(out['audio'])
        # The short track is padded to the video clock.
        self.assertAlmostEqual(out['audio_seconds'], 0.5, delta=0.03)

    def test_finish_keeps_source_sound_and_checks_what_cloud_returned(self):
        folder = self.folder()
        write_video(folder / 'source.mp4', levels(24), 24, audio_seconds=1.0)
        write_video(folder / 'frames.webm', levels(24), 24, codec='libvpx-vp9')
        job = {'frames': str(folder / 'frames.webm'), 'output': str(folder / 'out.mp4'), 'fps': 24,
               'comment': {'recipe': {}, 'workflow': {}}, 'source_audio': {'path': str(folder / 'source.mp4'), 'start': 0}}
        cloud.finish(job)
        out = read(folder / 'out.mp4')
        self.assertEqual(len(out['frames']), 24)
        self.assertTrue(out['audio'])
        self.assertAlmostEqual(out['audio_seconds'], 1.0, delta=0.03)
        with self.assertRaisesRegex(ValueError, 'instead of 30'):
            cloud.finish({**job, 'frame_count': 30})
        with self.assertRaisesRegex(ValueError, 'film grade'):
            cloud.finish({**job, 'palette': 'sepia'})
        with self.assertRaisesRegex(ValueError, 'either source sound or generated audio'):
            cloud.finish({**job, 'generated_audio': 'sound.flac'})

    def test_the_grades_match_the_native_film_grade(self):
        pixels = np.array([[[200, 100, 50]]], np.uint8)
        image = pixels.astype(np.float32) / 255
        luma = float((image * [.2126, .7152, .0722]).sum())
        self.assertTrue(np.array_equal(cloud.grade(pixels, 'source'), pixels))
        mono = cloud.grade(pixels, 'monochrome')[0, 0]
        self.assertEqual(len(set(mono.tolist())), 1)
        self.assertEqual(int(mono[0]), round(luma * 255))
        cool = cloud.grade(pixels, 'cool')[0, 0]
        self.assertEqual(int(cool[0]), round(200 / 255 * .92 * 255))
        self.assertEqual(int(cool[2]), round(min(1, 50 / 255 * 1.04 + .02 * (1 - luma)) * 255))

    @staticmethod
    def flac(container):
        stream = container.add_stream('flac', rate=48000)
        stream.layout = 'mono'
        return stream


if __name__ == '__main__':
    unittest.main()
