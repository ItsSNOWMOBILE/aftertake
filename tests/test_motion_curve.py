"""Custom cubic-Bezier easing in the native renderer; CPU only, no models."""
import copy
from fractions import Fraction
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import av
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('curve_film_renderer', ROOT / 'scripts/render-film.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
motion = renderer.film_motion
scene = renderer.film_scene
PARITY = json.loads((ROOT / 'tests/motion-curve-parity.json').read_text(encoding='utf-8'))
EXPO_OUT = {'x1': .16, 'y1': 1, 'x2': .3, 'y2': 1}
SPEED_RAMP = {'x1': .1, 'y1': .6, 'x2': .9, 'y2': .4}
RED = '11111111-1111-4111-8111-111111111111'
GREEN = '22222222-2222-4222-8222-222222222222'
GROUP = '33333333-3333-4333-8333-333333333333'


def key(at, **values):
    return {'at': at, **motion.IDENTITY, **values}


def curved(at, curve, **values):
    return key(at, easing='custom', bezier=dict(curve), **values)


def graphic(identifier=RED, **values):
    return {'id': identifier, 'name': 'Marker', 'kind': 'rect', 'start': 0, 'end': 1, 'x': .5, 'y': .78,
            'width': .08, 'height': .12, 'color': '#ff2010', 'opacity': 1, **values}


def exact_amount(progress, curve, steps=120):
    """Independent rational reference: bisect the exact polynomial far past double precision."""
    t = min(Fraction(1), max(Fraction(0), Fraction(progress)))
    x1, y1, x2, y2 = (Fraction(curve[name]) for name in ('x1', 'y1', 'x2', 'y2'))
    def coordinate(u, first, second):
        return 3 * u * (1 - u) ** 2 * first + 3 * u * u * (1 - u) * second + u ** 3
    low, high = Fraction(0), Fraction(1)
    for _ in range(steps):
        middle = (low + high) / 2
        if coordinate(middle, x1, x2) < t:
            low = middle
        else:
            high = middle
    return coordinate((low + high) / 2, y1, y2)


class MotionCurveTest(unittest.TestCase):
    def test_native_evaluator_reproduces_the_shared_parity_fixture_exactly(self):
        for name, curve in PARITY['curves'].items():
            for progress, expected in zip(PARITY['progress'], PARITY['amounts'][name]):
                self.assertEqual(motion.curve_amount(progress, curve), expected, name)
        track = motion.validate_motion(PARITY['track'])
        interval = PARITY['interval']
        for frame, expected in zip(PARITY['frames'], PARITY['poses']):
            pose = motion.motion_at(track, motion.motion_progress(interval['start'], interval['end'], frame))
            self.assertEqual([pose[field] for field in PARITY['poseFields']], expected, frame)
        depth = scene.validate_depth(copy.deepcopy(PARITY['depth']), motion)
        for progress, expected in zip(PARITY['depthProgress'], PARITY['depthPoses']):
            pose = scene.depth_at(depth, progress, motion)
            self.assertEqual([pose['yaw'], pose['pitch'], pose['z']], expected)

    def test_bisection_inverts_x_against_an_exact_rational_reference(self):
        samples = [1e-9, .001, .05, 1 / 3, .5, .61803398875, .9, .999999]
        slack = Fraction(2e-15)
        for name, curve in PARITY['curves'].items():
            for progress in samples:
                with self.subTest(curve=name, progress=progress):
                    value = motion.curve_amount(progress, curve)
                    # Backward stable everywhere: the exact curve at a time within
                    # 2e-15 of the request, even at a vertical tangent where
                    # x'(u) = 0 makes the inversion itself ill-conditioned.
                    low = exact_amount(Fraction(progress) - slack, curve) - slack
                    high = exact_amount(Fraction(progress) + slack, curve) + slack
                    self.assertTrue(low <= Fraction(value) <= high)
                    if name in ('standard', 'sine-in-out', 'quint-in-out', 'expo-out', 'expo-in', 'speed-ramp'):
                        # The shipped presets are well conditioned: a few ulps forward error.
                        self.assertAlmostEqual(value, float(exact_amount(progress, curve)), delta=1e-15)

    def test_named_easing_values_are_unchanged_and_exactly_expressible_as_curves(self):
        third = 1 / 3
        equivalents = {'linear': (third, third, 2 * third, 2 * third), 'ease-in': (third, 0, 2 * third, 0),
                       'ease-out': (third, 1, 2 * third, 1), 'ease-in-out': (third, 0, 2 * third, 1)}
        legacy = {'linear': lambda t: t, 'ease-in': lambda t: t ** 3, 'ease-out': lambda t: 1 - (1 - t) ** 3,
                  'ease-in-out': lambda t: t * t * (3 - 2 * t)}
        for name, values in equivalents.items():
            curve = dict(zip(motion.CURVE_FIELDS, values))
            for index in range(401):
                t = index / 400
                self.assertEqual(motion.eased(t, name), legacy[name](t))
                self.assertAlmostEqual(motion.eased(t, 'custom', curve), legacy[name](t), delta=1e-15)
        self.assertEqual(motion.eased(math.nextafter(1, 0), 'hold'), 0)
        legacy_track = motion.validate_motion({'keys': [key(0), key(.5, x=1, easing='hold'), key(1, x=2)]})
        self.assertTrue(all('bezier' not in item for item in legacy_track['keys']))
        self.assertEqual([item['easing'] for item in legacy_track['keys']], ['linear', 'hold', 'linear'])

    def test_custom_endpoints_land_on_authored_keys_and_keep_signed_rotation(self):
        track = motion.validate_motion({'keys': [key(0, rotation=350, scaleX=.5),
            curved(.4, EXPO_OUT, x=.3, rotation=90, opacity=.5),
            curved(1, SPEED_RAMP, x=1, scale=3, scaleY=4, rotation=-350, opacity=0)]})
        linear = motion.validate_motion({'keys': [key(0, rotation=350, scaleX=.5),
            key(.4, x=.3, rotation=90, opacity=.5), key(1, x=1, scale=3, scaleY=4, rotation=-350, opacity=0)]})
        for progress in (0, .4, 1):
            self.assertEqual(motion.motion_at(track, progress), motion.motion_at(linear, progress))
        self.assertEqual(motion.motion_at(track, motion.motion_progress(1, 2, 47)), motion.motion_at(linear, 1))
        self.assertEqual(motion.motion_at(track, motion.motion_progress(1, 2, 24)), motion.motion_at(linear, 0))
        self.assertEqual((motion.curve_amount(0, EXPO_OUT), motion.curve_amount(1, EXPO_OUT)), (0, 1))
        for index in range(1, 100):
            progress = .4 + .6 * index / 100
            amount = motion.curve_amount((progress - .4) / .6, SPEED_RAMP)
            pose = motion.motion_at(track, progress)
            self.assertEqual(pose['rotation'], 90 + (-350 - 90) * amount)
            self.assertTrue(-350 <= pose['rotation'] <= 90)
            self.assertTrue(0 <= pose['opacity'] <= .5 and 1 <= pose['scale'] <= 3)

    def test_invalid_curves_are_rejected_before_any_encoder_starts(self):
        invalid = [
            key(1, easing='custom'), key(1, bezier=dict(EXPO_OUT)), key(1, easing='linear', bezier=dict(EXPO_OUT)),
            key(1, easing='cubic-bezier(0.16, 1, 0.3, 1)'), curved(1, {**EXPO_OUT, 'x1': -.01}),
            curved(1, {**EXPO_OUT, 'x2': 1.01}), curved(1, {**EXPO_OUT, 'y1': 1.5}), curved(1, {**EXPO_OUT, 'y2': -.2}),
            curved(1, {**EXPO_OUT, 'x1': math.nan}), curved(1, {**EXPO_OUT, 'y1': math.inf}),
            curved(1, {**EXPO_OUT, 'x1': True}), curved(1, {**EXPO_OUT, 'x1': '0.1'}),
            curved(1, {**EXPO_OUT, 'x3': .5}), key(1, easing='custom', bezier={'x1': .1, 'y1': .2, 'x2': .3}),
            key(1, easing='custom', bezier=[.16, 1, .3, 1]), key(1, easing='custom', bezier=None),
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                motion.validate_motion({'keys': [key(0), value]})
            depth = {'perspective': 3, 'keys': [{'at': 0, 'yaw': 0, 'pitch': 0, 'z': 0},
                {'at': 1, 'yaw': 0, 'pitch': 0, 'z': 0, **{name: value[name] for name in ('easing', 'bezier') if name in value}}]}
            with self.subTest(depth=value), self.assertRaises(ValueError):
                scene.validate_depth(depth, motion)
        with self.assertRaisesRegex(ValueError, 'bezier curve'):
            motion.eased(.5, 'custom')
        with tempfile.TemporaryDirectory() as temporary:
            for layer in ({'titles': [{'motion': {'keys': [key(0), curved(1, {**EXPO_OUT, 'y2': 2})]}}]},
                          {'graphics': [graphic(motion={'keys': [key(0), key(1, easing='custom')]})], 'titles': []}):
                settings = {'output': str(Path(temporary) / 'bad.mp4'), 'width': 320, 'height': 180, 'shots': [], **layer}
                with patch.object(renderer.subprocess, 'Popen') as process, patch.object(renderer.subprocess, 'run') as run:
                    with self.assertRaises(ValueError):
                        renderer.assemble(settings)
                    process.assert_not_called()
                    run.assert_not_called()

    def test_decoded_graphic_and_title_follow_custom_curves_across_a_cut(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-curve-export-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (320, 180), '#101820').save(folder / 'background.png')
            marker = graphic(motion={'keys': [key(0, x=-.3), curved(1, EXPO_OUT, x=.3)]})
            title = {'text': 'CURVE', 'start': 0, 'end': 1, 'style': 'headline', 'position': 'top',
                     'animation': 'none', 'fontSize': 80, 'fontWeight': 500, 'stroke': False, 'color': '#40ff20',
                     'motion': {'keys': [key(0, x=-.2), curved(1, SPEED_RAMP, x=.2)]}}
            settings = {'output': str(folder / 'curve.mp4'), 'width': 320, 'height': 180,
                        'shots': [{'source': str(folder / 'background.png'), 'kind': 'image', 'start': 0, 'end': .5}] * 2,
                        'titles': [title], 'graphics': [marker], 'audio': [], 'sourceVolume': 0,
                        'fonts': str(ROOT / 'public/fonts'), 'manifest': {'titles': [title], 'graphics': [marker]}}
            renderer.assemble(settings)
            with av.open(settings['output']) as movie:
                self.assertEqual(json.loads(movie.metadata['comment']), settings['manifest'])
                frames = list(movie.decode(video=0))
            self.assertEqual(len(frames), 24)
            green_centers = []
            for index, frame in enumerate(frames):
                self.assertAlmostEqual(frame.time, index / 24, places=6)
                values = frame.to_ndarray(format='rgb24').astype(float)
                red = (values[:, :, 0] > 180) & (values[:, :, 1] < 90)
                green = (values[:, :, 1] > 170) & (values[:, :, 0] < 140)
                ry, rx = np.where(red)
                gy, gx = np.where(green)
                self.assertGreater(len(rx), 200)
                self.assertGreater(len(gx), 100)
                amount = motion.curve_amount(index / 23, EXPO_OUT)
                self.assertAlmostEqual(float(rx.mean()), (.2 + .6 * amount) * 320, delta=2, msg=index)
                green_centers.append(float(gx.mean()))
            # Expo-out covers most of its path early; linear would still be at 13%.
            self.assertGreater(motion.curve_amount(3 / 23, EXPO_OUT), .55)
            first_center = green_centers[0]
            for index, center in enumerate(green_centers):
                expected = first_center + .4 * motion.curve_amount(index / 23, SPEED_RAMP) * 320
                self.assertAlmostEqual(center, expected, delta=3, msg=index)

    def test_group_motion_depth_and_shutter_share_curves_in_the_native_scene_path(self):
        third = 1 / 3
        smooth = {'x1': third, 'y1': 0, 'x2': 2 * third, 'y2': 1}
        cubic = {'x1': third, 'y1': 0, 'x2': 2 * third, 'y2': 0}
        def group(motion_easing, depth_easing):
            return {'id': GROUP, 'name': 'Card', 'start': 0, 'end': 1, 'pivot': {'x': .4, 'y': .6},
                    'children': [{'kind': 'graphic', 'id': RED}],
                    'motion': {'keys': [key(0, x=-.2, rotation=40), {**key(1, x=.2, scale=1.3, rotation=-20, opacity=.6), **motion_easing}]},
                    'depth': {'perspective': 2.5, 'keys': [{'at': 0, 'yaw': -20, 'pitch': 10, 'z': -.1},
                              {'at': 1, 'yaw': 25, 'pitch': -12, 'z': .15, **depth_easing}]},
                    'shutter': {'samples': 3, 'exposure': .5}}
        named = group({'easing': 'ease-in-out'}, {'easing': 'ease-in'})
        custom = group({'easing': 'custom', 'bezier': smooth}, {'easing': 'custom', 'bezier': cubic})
        layers = [graphic(y=.5, width=.4, height=.4)]
        world = lambda parent: {'groups': [parent], 'order': [{'kind': 'group', 'id': GROUP}]}
        named = scene.validate_scene(world(named), layers, [], 320, 180, motion)['groups'][0]
        custom = scene.validate_scene(world(custom), layers, [], 320, 180, motion)['groups'][0]
        for frame in [0, 3.5, 7, 11.25, 16, 23]:
            np.testing.assert_allclose(scene.group_matrix(custom, frame, 320, 180, motion)[0],
                                       scene.group_matrix(named, frame, 320, 180, motion)[0], rtol=0, atol=1e-9)
        # A shaped depth curve stays inside its keys, so the authored clearance still holds.
        shaped = copy.deepcopy(custom)
        shaped['depth']['keys'][1]['bezier'] = dict(EXPO_OUT)
        for index in range(101):
            pose = scene.depth_at(shaped['depth'], index / 100, motion)
            self.assertTrue(-20 - 1e-12 <= pose['yaw'] <= 25 + 1e-12)
            self.assertTrue(-.1 - 1e-12 <= pose['z'] <= .15 + 1e-12)
        with tempfile.TemporaryDirectory(prefix='aftertake-curve-scene-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (320, 180), '#101820').save(folder / 'background.png')
            parent = copy.deepcopy(shaped)
            parent['motion']['keys'][1]['bezier'] = dict(SPEED_RAMP)
            settings = {'output': str(folder / 'scene.mp4'), 'width': 320, 'height': 180,
                        'shots': [{'source': str(folder / 'background.png'), 'kind': 'image', 'start': 0, 'end': 1}],
                        'graphics': layers, 'titles': [], 'motionScene': world(parent), 'audio': [], 'sourceVolume': 0,
                        'fonts': str(ROOT / 'public/fonts'), 'manifest': {'format': 'aftertake-film/4', 'motionScene': world(parent)}}
            renderer.assemble(settings)
            with av.open(settings['output']) as movie:
                self.assertEqual(json.loads(movie.metadata['comment']), settings['manifest'])
                frames = list(movie.decode(video=0))
            self.assertEqual(len(frames), 24)
            reference = renderer.scene_renderer(world(parent), layers, [], 320, 180, settings['fonts'])
            def weighted_x(image):
                image = image.astype(float)
                weight = np.maximum(0, image[:, :, 0] - np.max(image[:, :, 1:3], axis=2) - 40)
                return float((weight * np.arange(320)).sum() / weight.sum())
            for index, frame in enumerate(frames):
                expected = Image.new('RGBA', (320, 180), '#101820')
                expected.alpha_composite(reference.frame(index))
                self.assertAlmostEqual(weighted_x(frame.to_ndarray(format='rgb24')),
                                       weighted_x(np.asarray(expected)), delta=2, msg=index)


if __name__ == '__main__':
    unittest.main()
