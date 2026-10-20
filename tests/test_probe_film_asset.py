"""Probe actual live WebM bytes without relying on a finalized duration header."""
from fractions import Fraction
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import av
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('film_asset_probe', ROOT / 'scripts/probe-film-asset.py')
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def live_webm(path, video=True, audio=True, video_times=None, live=True, duration=1):
    # The live muxer omits Duration/seek headers, as MediaRecorder does. Only
    # these tiny generated test packets are collected for chronological muxing.
    with av.open(str(path), 'w', format='webm', options={'live': '1'} if live else {}) as output:
        packets = []
        if video:
            stream = output.add_stream('libvpx-vp9', rate=10)
            stream.width, stream.height, stream.pix_fmt = 64, 48, 'yuv420p'
            stream.options = {'deadline': 'realtime', 'cpu-used': '8', 'lag-in-frames': '0'}
            for index in range(round(duration * 10)) if video_times is None else video_times:
                # A changing plate makes a late trim distinguishable from zero.
                pixels = np.full((48, 64, 3), [40 + index % 180, 55, 110], dtype=np.uint8)
                frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
                frame.pts, frame.time_base = index, Fraction(1, 10)
                packets.extend(stream.encode(frame))
            packets.extend(stream.encode())
        if audio:
            stream = output.add_stream('libopus', rate=48000)
            stream.layout = 'mono'
            for index in range(round(duration * 50)):
                clock = (np.arange(960) + index * 960) / 48000
                pcm = (.1 * np.sin(2 * np.pi * (440 * clock + .17 * clock ** 2))).astype(np.float32)[None, :]
                frame = av.AudioFrame.from_ndarray(pcm, format='flt', layout='mono')
                frame.sample_rate = 48000
                frame.pts, frame.time_base = index * 960, Fraction(1, 48000)
                packets.extend(stream.encode(frame))
            packets.extend(stream.encode())
        for packet in sorted(packets, key=lambda value: float(value.dts * value.time_base)):
            output.mux(packet)


class FilmAssetProbeTests(unittest.TestCase):
    def assert_no_duration_header(self, path):
        with av.open(str(path)) as container:
            self.assertIsNone(container.duration)
            self.assertTrue(all(stream.duration is None for stream in container.streams))

    def test_actual_vp9_opus_live_recording_probes_and_keeps_original_bytes(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-live-webm-') as temporary:
            source = Path(temporary) / 'recording.webm'
            live_webm(source)
            self.assert_no_duration_header(source)
            original = hashlib.sha256(source.read_bytes()).hexdigest()
            result = json.loads(subprocess.run(
                [sys.executable, str(ROOT / 'scripts/probe-film-asset.py'), str(source)],
                check=True, capture_output=True, text=True, timeout=25,
            ).stdout)
            self.assertEqual(result['kind'], 'video')
            self.assertEqual((result['width'], result['height']), (64, 48))
            self.assertAlmostEqual(result['duration'], 1, delta=.01)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)

    def test_video_only_and_audio_only_unknown_headers_use_actual_packet_timing(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-live-tracks-') as temporary:
            for video, audio in [(True, False), (False, True)]:
                with self.subTest(video=video):
                    source = Path(temporary) / f'{video}.webm'
                    live_webm(source, video=video, audio=audio)
                    self.assert_no_duration_header(source)
                    result = probe.probe(source)
                    self.assertEqual(result['kind'], 'video' if video else 'audio')
                    self.assertAlmostEqual(result['duration'], 1, delta=.03)

    def test_sparse_overlong_packet_timestamps_are_rejected_without_long_decode(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-live-overlong-') as temporary:
            source = Path(temporary) / 'overlong.webm'
            # Two real frames span over ten minutes; no ten-minute fixture render.
            live_webm(source, audio=False, video_times=[0, 6001])
            self.assert_no_duration_header(source)
            with patch.object(probe, 'validate_frame') as decode:
                with self.assertRaisesRegex(ValueError, 'ten minutes'):
                    probe.probe(source)
                decode.assert_not_called()

    def test_packet_and_time_budgets_bound_unknown_duration_work(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-live-budget-') as temporary:
            source = Path(temporary) / 'recording.webm'
            live_webm(source)
            with patch.object(probe, 'MAX_SCAN_PACKETS', 1):
                with self.assertRaisesRegex(ValueError, 'safe work limit'):
                    probe.probe(source)
            with patch.object(probe, 'MAX_PROBE_SECONDS', 0):
                with self.assertRaisesRegex(ValueError, 'safe work limit'):
                    probe.probe(source)

    def test_finalized_header_keeps_fast_path_and_still_validates_a_frame(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-finalized-probe-') as temporary:
            source = Path(temporary) / 'finished.webm'
            live_webm(source, live=False)
            with av.open(str(source)) as container:
                declared = float(container.duration) / av.time_base
                self.assertGreater(declared, 0)
            with patch.object(probe, 'packet_duration', side_effect=AssertionError('unexpected scan')):
                self.assertAlmostEqual(probe.probe(source)['duration'], declared)

    def test_invalid_media_and_video_above_4k_are_not_admitted(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-invalid-probe-') as temporary:
            source = Path(temporary) / 'invalid.webm'
            source.write_bytes(b'not a recorded video')
            with self.assertRaises((av.FFmpegError, ValueError)):
                probe.probe(source)
        oversized = SimpleNamespace(width=4096, height=2160)
        container = SimpleNamespace(streams=SimpleNamespace(video=[oversized], audio=[]))
        with self.assertRaisesRegex(ValueError, '4K'):
            probe.primary_stream(container)

    def test_missing_timestamps_and_bounded_undecodable_packets_fail_closed(self):
        stream = SimpleNamespace(index=0, type='video')
        packet = SimpleNamespace(size=1, pts=None, dts=None, time_base=Fraction(1, 1000), stream=stream)
        container = SimpleNamespace(streams=[stream], demux=lambda *args: iter([packet]))
        with self.assertRaisesRegex(ValueError, 'packet timestamps'):
            probe.packet_duration(container, stream, float('inf'))
        packet.decode = lambda: []
        container.demux = lambda *args: (packet for _ in range(probe.MAX_DECODE_PACKETS + 1))
        with self.assertRaisesRegex(ValueError, 'safe work limit'):
            probe.validate_frame(container, stream, float('inf'))

    def test_native_film_exports_late_live_webm_trim_with_sound_and_rejects_actual_eof(self):
        render_spec = importlib.util.spec_from_file_location('recording_film_renderer', ROOT / 'scripts/render-film.py')
        renderer = importlib.util.module_from_spec(render_spec)
        render_spec.loader.exec_module(renderer)
        with tempfile.TemporaryDirectory(prefix='aftertake-recording-film-') as temporary:
            folder = Path(temporary)
            source, target = folder / 'recording.webm', folder / 'trim.mp4'
            live_webm(source, duration=90)
            self.assert_no_duration_header(source)
            original = hashlib.sha256(source.read_bytes()).hexdigest()
            first, last = 74.625, 78.125
            settings = {'output': str(target), 'width': 160, 'height': 90,
                'shots': [{'source': str(source), 'start': first, 'end': last}],
                'titles': [], 'audio': [], 'sourceVolume': 1, 'normalizeAudio': False,
                'fonts': str(ROOT / 'public/fonts'), 'manifest': {'recordingTrim': [first, last]}}
            renderer.assemble(settings)
            with av.open(str(target)) as movie:
                self.assertEqual(json.loads(movie.metadata['comment']), settings['manifest'])
                frames = list(movie.decode(video=0))
                self.assertEqual(len(frames), 84)
                self.assertTrue(all(abs(float(frame.time) - index / 24) < 1e-6 for index, frame in enumerate(frames)))
                # The selected late plate is redder than the opening plate.
                self.assertGreater(float(frames[0].to_ndarray(format='rgb24')[:, 40:120, 0].mean()), 60)
            with av.open(str(target)) as movie:
                stream = movie.streams.audio[0]
                self.assertEqual(stream.rate, 48000)
                self.assertAlmostEqual(float(stream.duration * stream.time_base), 3.5, delta=1 / 48000)
                actual = np.concatenate([frame.to_ndarray() for frame in movie.decode(audio=0)], axis=1).mean(axis=0)
            reference = subprocess.run([renderer.imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error',
                '-ss', str(first), '-i', str(source), '-t', '3.5', '-vn', '-ac', '1', '-ar', '48000',
                '-f', 'f32le', '-'], capture_output=True, check=True, timeout=25)
            expected = np.frombuffer(reference.stdout, '<f4')
            a, b = actual[24000:120000], expected[24000:120000]
            correlation = np.dot(a, b) / np.sqrt(np.dot(a, a) * np.dot(b, b))
            self.assertGreater(correlation, .995, 'The recorder soundtrack must retain the selected late trim clock.')
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)
            settings['shots'][0]['end'] = 92
            with patch.object(renderer.subprocess, 'run') as encode:
                with self.assertRaisesRegex(ValueError, 'trim ends after its footage'):
                    renderer.assemble(settings)
                encode.assert_not_called()


if __name__ == '__main__':
    unittest.main()
