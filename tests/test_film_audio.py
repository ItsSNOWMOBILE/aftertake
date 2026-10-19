"""Verify optional soundtrack fades on actual resampled PCM and native exports."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import wave
from unittest.mock import patch

import av
import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('film_audio_renderer', ROOT / 'scripts/render-film.py')
renderer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(renderer)
RATE = 48000


class FilmAudioTest(unittest.TestCase):
    def make_source(self, folder):
        # Resampling and a fractional trim exercise the source clock; a
        # nonintegral tone frequency makes an unfaded repeat actually click.
        rate = 32000
        clock = np.arange(2 * rate) / rate
        pcm = (.32 * np.sin(2 * np.pi * 997.3 * clock) * 32767).astype('<i2')
        source = folder / 'tone.wav'
        with wave.open(str(source), 'wb') as audio:
            audio.setparams((2, 2, rate, 0, 'NONE', 'not compressed'))
            audio.writeframes(np.column_stack([pcm, pcm]).astype('<i2').tobytes())
        return {'source': str(source), 'start': .25, 'sourceStart': .125, 'sourceEnd': 1.125, 'volume': .6}

    def pcm(self, track):
        chain = renderer.audio_track_filter(track, 0)
        # Use the identical track filter that assemble() installs. Input zero
        # is deliberately unused, matching its position after the film plate.
        completed = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error',
            '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-i', track['source'],
            '-filter_complex', chain, '-map', '[voice0]', '-c:a', 'pcm_f32le',
            '-f', 'f32le', '-'], capture_output=True, check=True)
        return np.frombuffer(completed.stdout, '<f4').reshape(-1, 2)

    def test_actual_48k_pcm_ramps_match_trimmed_linear_envelope_and_preserve_delay(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-audio-fades-') as temporary:
            track = self.make_source(Path(temporary))
            control = self.pcm(track)
            faded = self.pcm({**track, 'fadeIn': .2, 'fadeOut': .3})
            self.assertEqual(control.shape, (60000, 2))
            self.assertEqual(faded.shape, control.shape)
            delay = round(track['start'] * RATE)
            np.testing.assert_array_equal(faded[:delay], 0)
            samples = np.arange(RATE)
            expected_gain = np.minimum(1, samples / 9600) * np.minimum(1, (RATE - samples) / 14400)
            np.testing.assert_allclose(faded[delay:], control[delay:] * expected_gain[:, None], atol=3e-8)
            # Inspect distinct opening, full-gain and tail windows, rather than
            # letting one long average hide a missing fade or shifted clock.
            for first, last in [(0, 960), (19000, 21000), (47040, 48000)]:
                actual = faded[delay + first:delay + last]
                expected = control[delay + first:delay + last] * expected_gain[first:last, None]
                np.testing.assert_allclose(actual, expected, atol=3e-8)
            overlapping = self.pcm({**track, 'fadeIn': .8, 'fadeOut': .8})
            product = np.minimum(1, samples / 38400) * np.minimum(1, (RATE - samples) / 38400)
            np.testing.assert_allclose(overlapping[delay:], control[delay:] * product[:, None], atol=3e-8)

    def test_zero_and_absent_fades_keep_identical_legacy_filter_and_pcm(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-audio-legacy-') as temporary:
            track = self.make_source(Path(temporary))
            legacy = ('[1:a:0]atrim=start=0.125:end=1.125,asetpts=PTS-STARTPTS,'
                'aresample=48000,aformat=channel_layouts=stereo,volume=0.6,adelay=12000S:all=1[voice0]')
            self.assertEqual(renderer.audio_track_filter(track, 0), legacy)
            zero = {**track, 'fadeIn': 0, 'fadeOut': 0}
            self.assertEqual(renderer.audio_track_filter(zero, 0), legacy)
            np.testing.assert_array_equal(self.pcm(track), self.pcm(zero))

    def test_standalone_fades_reject_bad_parameters_before_encoding(self):
        base = {'start': 0, 'sourceStart': 0, 'sourceEnd': 1, 'volume': 1}
        for name in ('fadeIn', 'fadeOut'):
            for value in (-.01, 1.01, 11, float('nan'), float('inf'), '1', None, True):
                track = {**base, name: value}
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    renderer.audio_track_filter(track, 0)
                with patch.object(renderer.imageio_ffmpeg, 'get_ffmpeg_exe') as binary:
                    with self.assertRaises(ValueError):
                        renderer.assemble({'output': 'unused.mp4', 'width': 160, 'height': 90, 'shots': [], 'audio': [track]})
                    binary.assert_not_called()
        self.assertIn('ns=1', renderer.audio_fade_filters({**base, 'fadeIn': 1e-10}))
        self.assertNotIn('ns=0', renderer.audio_fade_filters({**base, 'fadeIn': 1e-10}))

    def test_native_film_retains_envelopes_and_suppresses_restarted_track_click(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-audio-join-') as temporary:
            folder = Path(temporary)
            track = self.make_source(folder)
            Image.new('RGB', (160, 90), '#123456').save(folder / 'plate.png')
            audio = [{**track, 'fadeIn': .2, 'fadeOut': .3},
                {**track, 'start': 1.25, 'fadeIn': .2, 'fadeOut': .3}]
            output = folder / 'joined.mp4'
            manifest = {'audio': [{key: value for key, value in row.items() if key != 'source'} for row in audio]}
            renderer.assemble({'output': str(output), 'width': 160, 'height': 90,
                'shots': [{'source': str(folder / 'plate.png'), 'kind': 'image', 'start': 0, 'end': 2.25}],
                'titles': [], 'fonts': str(ROOT / 'public/fonts'), 'audio': audio,
                'sourceVolume': 0, 'normalizeAudio': False, 'manifest': manifest})
            with av.open(str(output)) as movie:
                self.assertEqual(sum(1 for _ in movie.decode(video=0)), 54)
                self.assertEqual(json.loads(movie.metadata['comment']), manifest)
            with av.open(str(output)) as movie:
                stream = movie.streams.audio[0]
                self.assertEqual(stream.rate, RATE)
                self.assertAlmostEqual(float(stream.duration * stream.time_base), 2.25, delta=1 / RATE)
                sound = np.concatenate([frame.to_ndarray() for frame in movie.decode(audio=0)], axis=1).mean(axis=0)
            plain = self.pcm(track)[12000:, 0]
            faded = self.pcm(audio[0])[12000:, 0]
            self.assertGreater(abs(float(plain[-1] - plain[0])), .05, 'The chosen control must expose a real discontinuity.')
            self.assertLess(abs(float(faded[-1] - faded[0])), .00002)
            join = round(1.25 * RATE)
            self.assertLess(float(np.abs(sound[join - 48:join + 48]).max()), .002)
            self.assertLess(abs(float(sound[join] - sound[join - 1])), .0001)
            # AAC need not be sample-identical, but interior tone phase and
            # gain must remain at the authored clock in both repeated tracks.
            for start in (.25, 1.25):
                first = round((start + .3) * RATE)
                actual = sound[first:first + 4800].astype(float)
                expected = plain[14400:19200].astype(float)
                correlation = np.dot(actual, expected) / np.sqrt(np.dot(actual, actual) * np.dot(expected, expected))
                self.assertGreater(correlation, .995)
                self.assertAlmostEqual(float(np.dot(actual, expected) / np.dot(expected, expected)), 1, delta=.015)


if __name__ == '__main__':
    unittest.main()
