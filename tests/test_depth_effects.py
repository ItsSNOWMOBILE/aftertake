"""Depth post-processing uses real numeric fields; no model inference in unit tests."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zlib

import numpy as np
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('depth_effect_worker', ROOT / 'scripts/depth-effects.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def settings(**changes):
    return {'focus': .35, 'blur': 0, 'haze': 0, 'hazeColor': '#ffffff',
            'lightAzimuth': -45, 'lightElevation': 45, 'lightStrength': 0, **changes}


class DepthEffectsTests(unittest.TestCase):
    def setUp(self):
        self.depth = np.tile(np.linspace(1, 10, 96, dtype=np.float32), (64, 1))
        self.source = np.zeros((64, 96, 3), np.uint8)
        self.source[:, ::2] = 200

    def test_no_effects_preserve_source_pixels_and_depth_bounds(self):
        output, bounds = worker.apply_effects(self.source, self.depth, settings())
        np.testing.assert_array_equal(output, self.source)
        self.assertLess(bounds[0], bounds[1])
        for invalid in [np.zeros_like(self.depth), np.full_like(self.depth, np.nan), np.ones_like(self.depth)]:
            with self.assertRaises(ValueError): worker.apply_effects(self.source, invalid, settings())

    def test_haze_follows_measured_depth_and_focus_blur_preserves_canvas(self):
        black = np.zeros_like(self.source)
        haze, _ = worker.apply_effects(black, self.depth, settings(haze=.8))
        self.assertLess(haze[30, 2, 0], haze[30, 90, 0])
        self.assertEqual(haze[30, 0, 0], 0)
        blurred, _ = worker.apply_effects(self.source, self.depth, settings(blur=20, focus=0))
        self.assertEqual(blurred.shape, self.source.shape)
        self.assertLess(blurred[:, 70:].std(), self.source[:, 70:].std())
        lit, _ = worker.apply_effects(np.full_like(self.source, 120), self.depth, settings(lightStrength=1))
        other, _ = worker.apply_effects(np.full_like(self.source, 120), self.depth, settings(lightStrength=1, lightAzimuth=45))
        self.assertFalse(np.array_equal(lit, other))

    def test_real_png_lossless_payload_roundtrip_and_hash_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source = folder / 'source.png'
            Image.fromarray(self.source).save(source)
            request = {'format': 'aftertake-depth-effect/1', 'name': 'A field', 'clip': {
                'kind': 'image', 'width': 96, 'height': 64, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()},
                'settings': settings(haze=.3)}
            raw = self.depth.astype('<f4').tobytes()
            receipt = {'format': 'aftertake-raw-depth/1', 'encoding': 'zlib-base64-f32le',
                'request': request, 'width': 96, 'height': 64, 'modelSha256': worker.MODEL_SHA,
                'inferenceDtype': 'bfloat16', 'device': 'cuda:0', 'workflow': {'synthetic-unit-test': True},
                'rawSha256': hashlib.sha256(raw).hexdigest(), 'data': base64.b64encode(zlib.compress(raw)).decode()}
            meta = PngImagePlugin.PngInfo(); meta.add_itxt('aftertake_depth', json.dumps(receipt))
            depth = folder / 'depth.png'; Image.fromarray(np.zeros((64, 96), np.uint8)).save(depth, pnginfo=meta)
            work = {'source': str(source), 'depth': str(depth), 'raw': str(folder / 'raw.npz'),
                'output': str(folder / 'output.png'), 'request': request, 'model': {'sha256': worker.MODEL_SHA}}
            result = worker.run(work)
            self.assertEqual(result['rawSha256'], receipt['rawSha256'])
            with np.load(work['raw'], allow_pickle=False) as saved:
                np.testing.assert_array_equal(saved['depth'], self.depth)
            with Image.open(work['output']) as image:
                self.assertEqual(json.loads(image.info['aftertake_depth_effect'])['scope'], 'still-image')
            request['clip']['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'changed'): worker.run(work)


if __name__ == '__main__': unittest.main()
