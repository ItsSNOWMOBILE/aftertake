"""Tempo and beat estimates on synthetic music with known beat times."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('detect_beats', ROOT / 'scripts/detect-beats.py')
beats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(beats)


def track(path, bpm, seconds=16, offset=.31, alternate=True):
    rate = 44100
    signal = np.random.default_rng(bpm).normal(0, .02, rate * seconds)
    times = np.arange(offset, seconds - .1, 60 / bpm)
    for index, time in enumerate(times):
        first, count = int(time * rate), int(.05 * rate)
        envelope = np.exp(-np.arange(count) / 400) * (1 if index % 4 == 0 else .6)
        # Alternating low kicks and bright snares tempt a half-tempo estimate.
        pitch = 60 if alternate and index % 2 == 0 else 2000
        signal[first:first + count] += envelope * np.sin(2 * np.pi * pitch * np.arange(count) / rate)
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes((np.clip(signal, -1, 1) * 32767).astype('<i2').tobytes())
    return times


class DetectBeatsTest(unittest.TestCase):
    def test_tempo_and_beats_match_known_clicks(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-beats-') as temporary:
            for bpm, alternate in [(90, False), (128, True), (150, False)]:
                path = Path(temporary) / f'{bpm}.wav'
                expected = track(path, bpm, alternate=alternate)
                result = beats.analyse(path)
                self.assertEqual(result['method'], 'spectral-flux-dp/1')
                self.assertAlmostEqual(result['tempo'], bpm, delta=bpm * .03, msg=f'{bpm} BPM')
                found = np.array(result['beats'])
                for time in expected:
                    self.assertLess(np.min(np.abs(found - time)), .035, f'{bpm} BPM beat at {time:.3f}s')
                self.assertTrue(set(result['downbeats']) <= set(result['beats']))
                self.assertAlmostEqual(result['duration'], 16, places=2)

    def test_silence_and_missing_audio_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-beats-') as temporary:
            path = Path(temporary) / 'short.wav'
            with wave.open(str(path), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(b'\0\0' * 1000)
            with self.assertRaises(ValueError):
                beats.analyse(path)


if __name__ == '__main__':
    unittest.main()
