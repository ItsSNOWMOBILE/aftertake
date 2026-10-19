"""Small, actual CPU exports: pixels, source clock, previews and original sound."""
from fractions import Fraction
import importlib.util
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import av
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_finishing', ROOT / 'scripts/finish-media.py')
finishing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finishing)


def video(path, pts=None, rate=Fraction(24), time_base=Fraction(1, 24000)):
    pts = pts if pts is not None else [index * 1000 for index in range(48)]
    with av.open(str(path), 'w') as container:
        stream = container.add_stream('libx264', rate=rate)
        stream.width, stream.height, stream.pix_fmt = 96, 64, 'yuv420p'
        stream.time_base = stream.codec_context.time_base = time_base
        stream.options = {'crf': '10', 'bf': '0'}
        for index, tick in enumerate(pts):
            pixels = np.zeros((64, 96, 3), dtype=np.uint8)
            pixels[:] = [30 + index % 100, 70, 110]
            pixels[:, (index * 3) % 80:(index * 3) % 80 + 12, :] = [210, 120, 40]
            frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
            frame.pts, frame.time_base = tick, time_base
            if index + 1 < len(pts):
                frame.duration = pts[index + 1] - tick
            else:
                frame.duration = int((1 / rate) / time_base)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def describe(path):
    with av.open(str(path)) as movie:
        stream = movie.streams.video[0]
        frames = list(movie.decode(video=0))
        origin = Fraction(frames[0].pts) * frames[0].time_base
        last = frames[-1]
        duration = Fraction(last.pts) * last.time_base - origin + Fraction(last.duration) * last.time_base
        return dict(id='d0c86952-104a-4ca6-9636-89b876dc952b', name='Source', kind='video',
                    width=stream.width, height=stream.height, duration=float(duration),
                    sha256=finishing.file_hash(path), hasAudio=bool(movie.streams.audio),
                    url='/media/source.mp4')


def request(clip, **settings):
    return {'format': 'aftertake-finishing/1', 'name': 'Finished', 'clip': clip,
            'settings': {**finishing.DEFAULTS, **settings}}


def run(source, output, req, **options):
    return finishing.process({'source': str(source), 'output': str(output), 'request': req, **options})


class FinishingTest(unittest.TestCase):
    def test_old_settings_keep_the_pre_optics_pixels_and_missing_defaults(self):
        pixels = np.random.default_rng(5).integers(0, 256, (48, 64, 3), dtype=np.uint8)
        legacy = {key: value for key, value in finishing.DEFAULTS.items()
                  if key not in finishing.OPTICAL_DEFAULTS}
        legacy.update(exposureEV=.4, contrast=.2, saturation=-.15, temperature=.3,
                      tint=-.2, preset='warm-film', lookStrength=.6, sharpen=.4,
                      grain=.45, vignette=.3, seed=31)
        image = Image.fromarray(pixels)
        old = finishing.apply_finishing(image, legacy)
        normalized = finishing.apply_finishing(image, {**legacy, **finishing.OPTICAL_DEFAULTS})
        self.assertEqual(old.tobytes(), normalized.tobytes())
        # Golden pixels from the processor before optical effects were added.
        self.assertEqual(sha256(old.tobytes()).hexdigest(),
                         '16cdc56928c173d533988351dec5446cc1beb81931df8632f446e5f8638f7580')
        self.assertTrue(finishing.is_identity({**finishing.DEFAULTS, 'glowRadius': 32,
                                             'halationRadius': 32, 'chromaticOffset': 8}))

    def test_glow_and_halation_follow_highlights_without_edge_wrap(self):
        pixels = np.full((48, 64, 3), 40, dtype=np.uint8)
        pixels[18:30, 26:38] = 255
        image = Image.fromarray(pixels)
        glow = np.asarray(finishing.apply_finishing(image, {**finishing.DEFAULTS,
                           'glowStrength': 1, 'glowRadius': 4}))
        self.assertTrue(np.all(glow[23, 24] > pixels[23, 24]))
        halo = np.asarray(finishing.apply_finishing(image, {**finishing.DEFAULTS,
                           'halationStrength': 1, 'halationRadius': 4}))
        self.assertGreater(int(halo[23, 24, 0]), int(halo[23, 24, 1]))
        self.assertGreater(int(halo[23, 24, 1]), int(halo[23, 24, 2]))
        np.testing.assert_array_equal(halo[23, 31], pixels[23, 31])
        dark = Image.fromarray(np.full_like(pixels, 80))
        for key in ('glowStrength', 'halationStrength'):
            np.testing.assert_array_equal(np.asarray(finishing.apply_finishing(
                dark, {**finishing.DEFAULTS, key: 1})), np.asarray(dark))
        pixels[:] = 40
        pixels[:, :6] = 255
        edge = np.asarray(finishing.apply_finishing(Image.fromarray(pixels),
                          {**finishing.DEFAULTS, 'glowStrength': 1, 'glowRadius': 4}))
        np.testing.assert_array_equal(edge[:, -1], pixels[:, -1])
        white = Image.fromarray(np.full_like(pixels, 255))
        np.testing.assert_array_equal(np.asarray(finishing.apply_finishing(white,
            {**finishing.DEFAULTS, 'glowStrength': 1, 'glowRadius': 32,
             'halationStrength': 1, 'halationRadius': 32})), np.asarray(white))

    def test_chromatic_sampling_is_subpixel_and_clamps_instead_of_wrapping(self):
        channel = np.tile(np.arange(8, dtype=np.float32) / 8, (3, 1))
        shifted = finishing.displace_channel(channel, 1.5)
        self.assertAlmostEqual(float(shifted[0, 4]), float((channel[0, 2] + channel[0, 3]) / 2))
        self.assertEqual(float(shifted[0, 0]), float(channel[0, 0]))
        pixels = np.zeros((12, 20, 3), dtype=np.uint8)
        pixels[:, :3] = 255
        result = np.asarray(finishing.apply_finishing(Image.fromarray(pixels),
                            {**finishing.DEFAULTS, 'chromaticStrength': 1, 'chromaticOffset': 1.5}))
        self.assertTrue(np.any(result[..., 0] != result[..., 2]))
        np.testing.assert_array_equal(result[:, -1], pixels[:, -1])
        np.testing.assert_array_equal(result[..., 1], pixels[..., 1])
        tiny = Image.fromarray(np.full((1, 1, 3), 93, dtype=np.uint8))
        np.testing.assert_array_equal(np.asarray(finishing.apply_finishing(tiny,
            {**finishing.DEFAULTS, 'chromaticStrength': 1, 'chromaticOffset': 8})), np.asarray(tiny))

    def test_optical_bounds_reject_nonfinite_boolean_and_excessive_values(self):
        for name, maximum in {'glowStrength': 1, 'glowRadius': 32, 'halationStrength': 1,
                              'halationRadius': 32, 'chromaticStrength': 1, 'chromaticOffset': 8}.items():
            for invalid in (True, float('nan'), float('inf'), -.1, maximum + .01):
                with self.subTest(name=name, value=invalid), self.assertRaises(ValueError):
                    finishing.validate_settings({**finishing.DEFAULTS, name: invalid})

    def test_controls_make_visible_bounded_changes_without_resizing(self):
        pixels = np.zeros((32, 48, 3), dtype=np.uint8)
        pixels[:] = [80, 120, 160]
        image = Image.fromarray(pixels)
        bright = np.asarray(finishing.apply_finishing(image, {**finishing.DEFAULTS, 'exposureEV': 1}))
        self.assertTrue(np.all(bright > pixels))
        mono = np.asarray(finishing.apply_finishing(image, {**finishing.DEFAULTS, 'saturation': -1}))
        np.testing.assert_array_equal(mono[:, :, 0], mono[:, :, 1])
        np.testing.assert_array_equal(mono[:, :, 1], mono[:, :, 2])
        for preset in finishing.PRESETS - {'clean'}:
            result = np.asarray(finishing.apply_finishing(image, {**finishing.DEFAULTS,
                'preset': preset, 'lookStrength': 1}))
            self.assertEqual(result.shape, pixels.shape)
            self.assertFalse(np.array_equal(result, pixels))

    def test_zero_controls_preserve_pixels_and_original_file_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            pixels = np.random.default_rng(4).integers(0, 256, (31, 43, 3), dtype=np.uint8)
            source = folder / 'picture.jpg'
            Image.fromarray(pixels).save(source, quality=93)
            clip = dict(id='d0c86952-104a-4ca6-9636-89b876dc952b', name='Source', kind='image',
                        width=43, height=31, duration=1, sha256=finishing.file_hash(source),
                        url='/media/source.jpg', hasAudio=False)
            exported = folder / 'copy.jpg'
            receipt = run(source, exported, request(clip))
            self.assertEqual(source.read_bytes(), exported.read_bytes())
            self.assertTrue(receipt['identity'])
            preview = folder / 'preview.png'
            run(source, preview, request(clip), mode='preview', time=0)
            with Image.open(source) as original, Image.open(preview) as actual:
                np.testing.assert_array_equal(np.asarray(original.convert('RGB')), np.asarray(actual))

    def test_preview_and_export_use_identical_processing_including_seeded_grain(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source = folder / 'picture.png'
            Image.fromarray(np.random.default_rng(5).integers(0, 256, (48, 64, 3), dtype=np.uint8)).save(source)
            clip = dict(id='d0c86952-104a-4ca6-9636-89b876dc952b', name='Source', kind='image',
                        width=64, height=48, duration=1, sha256=finishing.file_hash(source),
                        url='/media/source.png', hasAudio=False)
            req = request(clip, exposureEV=.4, contrast=.2, saturation=-.15, temperature=.3,
                          tint=-.2, preset='warm-film', lookStrength=.6, sharpen=.4,
                          grain=.45, vignette=.3, seed=31, glowStrength=.3, glowRadius=5,
                          halationStrength=.4, halationRadius=4, chromaticStrength=.3, chromaticOffset=1.5)
            run(source, folder / 'final.png', req)
            run(source, folder / 'preview.png', req, mode='preview', time=0)
            self.assertEqual((folder / 'final.png').read_bytes(), (folder / 'preview.png').read_bytes())
            with Image.open(source) as image:
                a = np.asarray(finishing.apply_finishing(image, req['settings'], 8))
                b = np.asarray(finishing.apply_finishing(image, req['settings'], 9))
                self.assertFalse(np.array_equal(a, b), 'Grain is repeatable per source frame, not frozen over time.')

    def test_fractional_and_variable_frame_clocks_survive_real_export(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            cases = [('fractional', [i * 1001 for i in range(12)], Fraction(24000, 1001)),
                     ('variable', [0, 1000, 2500, 3500, 5500, 6500, 7500], Fraction(24))]
            for name, pts, rate in cases:
                with self.subTest(name=name):
                    source, target = folder / f'{name}.mp4', folder / f'{name}-out.mp4'
                    video(source, pts, rate)
                    req = request(describe(source), exposureEV=.3, saturation=.2,
                                  glowStrength=.2, halationStrength=.2, chromaticStrength=.3)
                    receipt = run(source, target, req)
                    finishing.verify_output_clock(target, receipt['clock'])
                    with av.open(str(source)) as original, av.open(str(target)) as finished:
                        before = [Fraction(f.pts) * f.time_base for f in original.decode(video=0)]
                        after = [Fraction(f.pts) * f.time_base for f in finished.decode(video=0)]
                    self.assertEqual([t - before[0] for t in before], [t - after[0] for t in after])
                    self.assertEqual(receipt['clock']['frames'], len(pts))

    def test_video_preview_selects_first_frame_at_or_after_time_and_actual_grain_index(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source = folder / 'source.mp4'
            video(source)
            req = request(describe(source), grain=.8, seed=73, exposureEV=.2)
            real_open, decoded = av.open, []
            class CountDecode:
                def __init__(self, *args, **kwargs):
                    self.container = real_open(*args, **kwargs)
                    self.streams = self.container.streams
                def __enter__(self):
                    return self
                def __exit__(self, *args):
                    self.container.close()
                def decode(self, stream):
                    for frame in self.container.decode(stream):
                        decoded.append(frame.pts)
                        yield frame
            with patch.object(finishing.av, 'open', CountDecode):
                run(source, folder / 'preview.png', req, mode='preview', time=.51)
            self.assertEqual(len(decoded), 14, 'An early preview must not decode the remaining source tail.')
            with av.open(str(source)) as movie:
                selected = next((index, frame) for index, frame in enumerate(movie.decode(video=0))
                                if float(frame.time) + 1e-6 >= .51)
                expected = finishing.apply_finishing(finishing.oriented_image(selected[1]), req['settings'], selected[0])
            with Image.open(folder / 'preview.png') as actual:
                np.testing.assert_array_equal(np.asarray(actual), np.asarray(expected))

    def test_original_audio_is_once_at_original_time_and_level(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source, target = folder / 'source.mp4', folder / 'finished.mp4'
            video(source)
            rate = 48000
            t = np.arange(2 * rate) / rate
            left = .22 * np.sin(2 * np.pi * (370 * t + 730 * t*t)) * (.7 + .3 * np.sin(2 * np.pi * 3.7 * t))
            right = .17 * np.sin(2 * np.pi * (220 * t + 330 * t*t))
            from media_utils import mux_generated_audio
            mux_generated_audio(source, {'waveform': np.array([[left, right]], dtype=np.float32),
                                         'sample_rate': rate}, 2)
            req = request(describe(source), preset='cool-film', lookStrength=.5,
                          glowStrength=.3, halationStrength=.2, chromaticStrength=.25)
            receipt = run(source, target, req)
            self.assertTrue(receipt['hasAudio'])
            def decode_audio(path):
                with av.open(str(path)) as movie:
                    self.assertEqual(len(movie.streams.audio), 1)
                    return np.concatenate([frame.to_ndarray() for frame in movie.decode(audio=0)], axis=1)
            original, actual = decode_audio(source), decode_audio(target)
            first, last = round(.2 * rate), round(1.8 * rate)
            for channel in range(2):
                reference = original[channel, first:last].astype(float)
                result = actual[channel, first:last].astype(float)
                correlation = np.dot(reference, result) / np.sqrt(np.dot(reference, reference) * np.dot(result, result))
                gain = np.dot(reference, result) / np.dot(reference, reference)
                self.assertGreater(float(correlation), .995)
                self.assertAlmostEqual(float(gain), 1, delta=.01)
            identity = folder / 'identity.mp4'
            run(source, identity, request(req['clip']))
            self.assertEqual(source.read_bytes(), identity.read_bytes())

    def test_changed_source_invalid_settings_and_outside_preview_fail_before_export(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source, target = folder / 'source.mp4', folder / 'out.mp4'
            video(source)
            clip = describe(source)
            for settings in ({'exposureEV': float('nan')}, {'grain': 2}, {'seed': True}):
                with self.assertRaises(ValueError):
                    run(source, target, request(clip, **settings))
                self.assertFalse(target.exists())
            for time in (-1, clip['duration'], float('inf')):
                with self.assertRaises(ValueError):
                    run(source, target, request(clip), mode='preview', time=time)
                self.assertFalse(target.exists())
            with self.assertRaisesRegex(ValueError, 'original media changed'):
                run(source, target, request({**clip, 'sha256': '0' * 64}))
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
