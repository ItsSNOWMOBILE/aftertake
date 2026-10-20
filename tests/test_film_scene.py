"""Isolated native groups, planar projection and sampled shutter; CPU only."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import av
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scene_test_renderer', ROOT / 'scripts/render-film.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
scene = renderer.film_scene
motion = renderer.film_motion

RED = '11111111-1111-4111-8111-111111111111'
GREEN = '22222222-2222-4222-8222-222222222222'
GROUP = '33333333-3333-4333-8333-333333333333'


def key(at, **values):
    return {'at': at, **motion.IDENTITY, 'easing': 'linear', **values}


def graphic(identifier=RED, **values):
    return {'id': identifier, 'name': 'Marker', 'kind': 'rect', 'start': 0, 'end': 1,
            'x': .5, 'y': .5, 'width': .2, 'height': .2, 'color': '#ff2010', 'opacity': 1, **values}


def group(**values):
    return {'id': GROUP, 'name': 'Card', 'start': 0, 'end': 1, 'pivot': {'x': .5, 'y': .5},
            'children': [{'kind': 'graphic', 'id': RED}], **values}


def world(parent=None, extra=None):
    return {'groups': [parent or group()], 'order': [{'kind': 'group', 'id': GROUP}, *(extra or [])]}


def depth(**values):
    return {'perspective': 3, 'keys': [{'at': 0, 'yaw': 0, 'pitch': 0, 'z': 0},
                                      {'at': 1, 'yaw': 0, 'pitch': 0, 'z': 0, **values}]}


class FilmSceneTest(unittest.TestCase):
    def test_binding_validation_rejects_missing_shared_duplicate_and_unordered_layers(self):
        valid = world()
        self.assertEqual(scene.validate_scene(valid, [graphic()], [], 160, 90, motion), valid)
        invalid = []
        value = copy.deepcopy(valid); value['order'] = []; invalid.append(value)
        value = copy.deepcopy(valid); value['order'] *= 2; invalid.append(value)
        value = copy.deepcopy(valid); value['groups'][0]['children'] *= 2; invalid.append(value)
        value = copy.deepcopy(valid); value['groups'][0]['children'][0]['id'] = GREEN; invalid.append(value)
        value = copy.deepcopy(valid); value['groups'][0]['children'][0]['kind'] = 'group'; invalid.append(value)
        value = copy.deepcopy(valid); value['groups'][0]['end'] = .5; invalid.append(value)
        value = copy.deepcopy(valid); value['groups'][0]['pivot']['x'] = math.nan; invalid.append(value)
        value = copy.deepcopy(valid); value['groups'][0]['shutter'] = {'samples': True, 'exposure': 1}; invalid.append(value)
        value = copy.deepcopy(valid); value['groups'][0]['depth'] = depth(yaw=36); invalid.append(value)
        value = copy.deepcopy(valid); value['source'] = 'unexpected'; invalid.append(value)
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                scene.validate_scene(value, [graphic()], [], 160, 90, motion)
        with self.assertRaisesRegex(ValueError, 'unique'):
            scene.validate_scene(valid, [graphic(), graphic()], [], 160, 90, motion)
        with self.assertRaisesRegex(ValueError, 'unique'):
            scene.validate_scene(world(), [graphic()], [{'id': RED}], 160, 90, motion)
        with self.assertRaisesRegex(ValueError, 'unique'):
            scene.validate_scene(world(group(id=RED)), [graphic()], [], 160, 90, motion)

    def test_fractional_quarter_second_intervals_match_shared_schema(self):
        child = graphic(start=.1, end=.35)
        parent = group(start=.1, end=.35)
        value = world(parent)
        self.assertEqual(scene.validate_scene(value, [child], [], 160, 90, motion), value)

    def test_unsafe_intermediate_projection_is_rejected_before_starting_an_encoder(self):
        unsafe = group(pivot={'x': 0, 'y': 0}, depth={'perspective': 1.5, 'keys': [
            {'at': 0, 'yaw': 35, 'pitch': 35, 'z': .2}, {'at': 1, 'yaw': -35, 'pitch': -35, 'z': .2}]})
        with tempfile.TemporaryDirectory() as temporary:
            settings = {'output': str(Path(temporary) / 'bad.mp4'), 'width': 90, 'height': 160,
                        'shots': [], 'graphics': [graphic()], 'titles': [], 'motionScene': world(unsafe)}
            with patch.object(renderer.subprocess, 'Popen') as process, patch.object(renderer.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'camera plane'):
                    renderer.assemble(settings)
                process.assert_not_called(); run.assert_not_called()

    def test_fractional_phase_easing_shutter_endpoints_and_exact_disabled_sample(self):
        self.assertEqual(scene.phase({'start': .13, 'end': 1.15}, 4), 0)
        self.assertEqual(scene.phase({'start': .13, 'end': 1.15}, 27), 1)
        self.assertAlmostEqual(scene.phase({'start': .13, 'end': 1.15}, 12.5), 8.5 / 23)
        parent = group(shutter={'samples': 5, 'exposure': 1})
        np.testing.assert_allclose(scene.sample_frames(parent, 0), [0, 0, 0, .2, .4])
        np.testing.assert_allclose(scene.sample_frames(parent, 23), [22.6, 22.8, 23, 23, 23])
        self.assertEqual(scene.sample_frames(group(shutter={'samples': 5, 'exposure': 0}), 10), [10.0])
        curved = depth(yaw=32, pitch=-16, z=.2, easing='ease-in')
        pose = scene.depth_at(curved, .5, motion)
        self.assertEqual((pose['yaw'], pose['pitch'], pose['z']), (4, -2, .025))

    def test_projection_order_matches_direct_pitch_yaw_then_2d_transform(self):
        parent = group(pivot={'x': .35, 'y': .7}, depth=depth(yaw=24, pitch=-17, z=.12),
            motion={'keys': [key(0, x=.1, y=-.15, scale=1.2, scaleX=.8, scaleY=1.1, rotation=27),
                             key(1, x=.1, y=-.15, scale=1.2, scaleX=.8, scaleY=1.1, rotation=27)]})
        matrix, opacity = scene.group_matrix(parent, 23, 320, 180, motion)
        self.assertEqual(opacity, 1)
        for x, y in [(0, 0), (320, 0), (320, 180), (0, 180), (112, 126)]:
            u, v = x - 112, y - 126
            p, a, r = map(math.radians, [-17, 24, 27])
            xx = math.cos(a) * u + math.sin(a) * math.sin(p) * v
            yy = math.cos(p) * v
            zz = -math.sin(a) * u + math.cos(a) * math.sin(p) * v + .12 * 320
            factor = 960 / (960 - zz)
            xx *= factor * 1.2 * .8; yy *= factor * 1.2 * 1.1
            expected = (112 + 32 + math.cos(r) * xx - math.sin(r) * yy,
                        126 - 27 + math.sin(r) * xx + math.cos(r) * yy)
            mapped = matrix @ [x, y, 1]
            np.testing.assert_allclose(mapped[:2] / mapped[2], expected, atol=1e-10)
        identity, _ = scene.group_matrix(group(), 10, 320, 180, motion)
        np.testing.assert_allclose(identity, np.eye(3), atol=1e-12)

    def test_group_opacity_is_applied_once_after_child_occlusion_and_root_order_is_explicit(self):
        layers = [graphic(), graphic(GREEN, color='#00ff00')]
        parent = group(children=[{'kind': 'graphic', 'id': RED}, {'kind': 'graphic', 'id': GREEN}],
            motion={'keys': [key(0, opacity=.5), key(1, opacity=.5)]})
        def render(kind, layer, frame):
            image = Image.new('RGBA', (100, 100))
            ImageDraw.Draw(image).rectangle((25, 25, 75, 75), fill=layer['color'])
            return image
        compositor = scene.SceneRenderer(world(parent), layers, [], 100, 100, motion, render)
        pixel = compositor.frame(4).getpixel((50, 50))
        self.assertEqual(pixel, (0, 255, 0, 128))
        # An ungrouped root drawn later covers the completed group.
        parent['children'] = [{'kind': 'graphic', 'id': RED}]
        compositor = scene.SceneRenderer(world(parent, [{'kind': 'graphic', 'id': GREEN}]), layers, [], 100, 100, motion, render)
        self.assertEqual(compositor.frame(4).getpixel((50, 50)), (0, 255, 0, 255))

    def test_shutter_samples_completed_occlusion_with_premultiplied_edges_not_each_child_independently(self):
        parent = group(children=[{'kind': 'graphic', 'id': RED}, {'kind': 'graphic', 'id': GREEN}],
                       shutter={'samples': 3, 'exposure': 1})
        calls = []
        def render(kind, layer, frame):
            calls.append((layer['id'], frame))
            image = Image.new('RGBA', (120, 80))
            left = round(40 + (frame - 10) * 30)
            ImageDraw.Draw(image).rectangle((left, 25, left + 8, 55), fill='#ff0000' if layer['id'] == RED else '#00ff00')
            return image
        moving = {'keys': [key(0, x=-.3), key(1, x=.3)]}
        compositor = scene.SceneRenderer(world(parent), [graphic(motion=moving), graphic(GREEN, motion=moving)], [], 120, 80, motion, render)
        values = np.asarray(compositor.frame(10))
        visible = values[:, :, 3] > 0
        self.assertEqual(len(calls), 6)
        self.assertEqual([clock for _, clock in calls[::2]], [clock for _, clock in calls[1::2]])
        self.assertEqual(int(values[:, :, 0].max()), 0)  # rear red is occluded at EVERY sample
        self.assertTrue(np.all(values[:, :, 1][visible] == 255))
        self.assertTrue(np.any((values[:, :, 3] > 0) & (values[:, :, 3] < 255)))
        self.assertGreater(len(set(clock for _, clock in calls)), 1)
        # A stationary group does not acquire blur, dark edges or alpha changes.
        parent['children'] = [{'kind': 'graphic', 'id': RED}]
        for color in [(255, 90, 10, 128), (171, 93, 37, 200), (171, 93, 37, 17)]:
            still = lambda kind, layer, frame: Image.new('RGBA', (120, 80), color)
            parent['shutter']['exposure'] = 1
            sampled = scene.SceneRenderer(world(parent), [graphic()], [], 120, 80, motion, still).frame(10)
            parent['shutter']['exposure'] = 0
            sharp = scene.SceneRenderer(world(parent), [graphic()], [], 120, 80, motion, still).frame(10)
            np.testing.assert_array_equal(np.asarray(sampled), np.asarray(sharp))

    def test_group_transform_is_bounded_and_clips_children_before_parent_translation(self):
        sizes = []
        original = Image.Image.transform
        def checked(image, size, *arguments, **kwargs):
            sizes.append(size)
            return original(image, size, *arguments, **kwargs)
        parent = group(motion={'keys': [key(0, scale=4, scaleX=4, scaleY=4), key(1, scale=4, scaleX=4, scaleY=4)]},
                       depth=depth(yaw=30, pitch=-20, z=.2))
        with patch.object(Image.Image, 'transform', checked):
            result = scene.transform_group(Image.new('RGBA', (320, 180), '#ffffff'), parent, 23, motion)
        self.assertEqual(result.size, (320, 180))
        self.assertTrue(all(size == (320, 180) for size in sizes))
        # Content omitted outside the pre-transform surface cannot reappear.
        parent = group(motion={'keys': [key(0, x=.25), key(1, x=.25)]})
        image = Image.new('RGBA', (100, 100)); ImageDraw.Draw(image).rectangle((-20, 20, 5, 40), fill='red')
        moved = scene.transform_group(image, parent, 0, motion)
        self.assertEqual(moved.getpixel((15, 30))[3], 0)
        self.assertGreater(moved.getpixel((28, 30))[3], 200)

    def test_static_group_memo_is_bounded_and_invalidates_for_motion_active_child_and_animated_type(self):
        calls = []
        def render(kind, layer, frame):
            calls.append((kind, layer['id'], frame))
            return Image.new('RGBA', (100, 100), '#10ff20')
        parent = group(shutter={'samples': 5, 'exposure': 1})
        compositor = scene.SceneRenderer(world(parent), [graphic()], [], 100, 100, motion, render)
        original = np.asarray(compositor.frame(4)).copy()
        compositor.frame(5); compositor.frame(6)
        self.assertEqual(len(calls), 1)  # identical sub-samples and held output reuse one completed group
        np.testing.assert_array_equal(np.asarray(compositor.frame(7)), original)
        self.assertLessEqual(compositor.memo_bytes, 64 * 1024 * 1024)
        calls.clear()
        moving = {'keys': [key(0, x=-.1), key(1, x=.1)]}
        compositor = scene.SceneRenderer(world(parent), [graphic(motion=moving)], [], 100, 100, motion, render)
        compositor.frame(4); compositor.frame(5)
        self.assertEqual(len(calls), 10)
        calls.clear()
        compositor = scene.SceneRenderer(world(parent), [graphic(start=.25)], [], 100, 100, motion, render)
        self.assertEqual(compositor.frame(3).getbbox(), None)
        self.assertIsNotNone(compositor.frame(8).getbbox())
        self.assertEqual(len(calls), 1)
        title = {'id': GREEN, 'text': 'TYPE', 'start': 0, 'end': 1, 'style': 'headline', 'position': 'center',
                 'animation': 'typewriter', 'color': '#ffffff'}
        parent['children'] = [{'kind': 'title', 'id': GREEN}]
        calls.clear()
        compositor = scene.SceneRenderer(world(parent), [], [title], 100, 100, motion, render)
        compositor.frame(4); compositor.frame(5)
        self.assertEqual(len(calls), 10)
        self.assertEqual(compositor.memo_bytes, 0)

    def test_standalone_scene_font_and_timeline_limits_reject_before_encoding(self):
        title = {'id': GREEN, 'text': 'TYPE', 'start': 0, 'end': 1, 'style': 'headline', 'position': 'center',
                 'animation': 'none', 'color': '#ffffff', 'fontSize': 100000}
        value = world(extra=[{'kind': 'title', 'id': GREEN}])
        with self.assertRaisesRegex(ValueError, 'font size'):
            scene.validate_scene(value, [graphic()], [title], 160, 90, motion)
        for shots in [[], [{'start': 0, 'end': math.inf}], [{'start': 0, 'end': 1, 'dissolve': True}],
                      [{'start': 0, 'end': 600}] * 2]:
            with self.subTest(shots=shots), self.assertRaises(ValueError):
                renderer.film_frame_count(shots)

    def test_actual_native_export_moves_card_and_title_together_across_cut_and_dissolve(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-scene-export-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (320, 180), '#101820').save(folder / 'background.png')
            panel = graphic(width=.45, height=.55, color='#ff2010')
            title = {'id': GREEN, 'text': 'CARD', 'start': 0, 'end': 1, 'style': 'headline',
                     'position': 'center', 'animation': 'none', 'color': '#20ff10', 'fontSize': 96, 'stroke': False}
            parent = group(children=[{'kind': 'graphic', 'id': RED}, {'kind': 'title', 'id': GREEN}],
                motion={'keys': [key(0, x=-.2), key(.6, x=.2, easing='ease-out'), key(1, x=.2, easing='hold')]},
                shutter={'samples': 3, 'exposure': .25})
            settings = {'width': 320, 'height': 180, 'graphics': [panel], 'titles': [title], 'motionScene': world(parent),
                'audio': [], 'sourceVolume': 0, 'fonts': str(ROOT / 'public/fonts'),
                'manifest': {'format': 'aftertake-film/4', 'motionScene': world(parent)}}
            for dissolve in (False, True):
                settings['shots'] = [{'source': str(folder / 'background.png'), 'kind': 'image', 'start': 0, 'end': .5},
                    {'source': str(folder / 'background.png'), 'kind': 'image', 'start': 0,
                     'end': .625 if dissolve else .5, **({'dissolve': .125} if dissolve else {})}]
                settings['output'] = str(folder / f'scene-{dissolve}.mp4')
                renderer.assemble(settings)
                with av.open(settings['output']) as movie:
                    self.assertEqual(json.loads(movie.metadata['comment']), settings['manifest'])
                    frames = list(movie.decode(video=0))
                self.assertEqual(len(frames), 24)
                centers = []
                reference_renderer = renderer.scene_renderer(world(parent), [panel], [title], 320, 180, settings['fonts'])
                for index, frame in enumerate(frames):
                    self.assertAlmostEqual(frame.time, index / 24, places=6)
                    values = frame.to_ndarray(format='rgb24')
                    red = (values[:, :, 0] > 170) & (values[:, :, 1] < 100)
                    green = (values[:, :, 1] > 170) & (values[:, :, 0] < 100)
                    ry, rx = np.where(red); gy, gx = np.where(green)
                    self.assertGreater(len(rx), 1000); self.assertGreater(len(gx), 25)
                    centers.append(float(rx.mean()))
                    expected_picture = Image.new('RGBA', (320, 180), '#101820')
                    expected_picture.alpha_composite(reference_renderer.frame(index))
                    expected = np.asarray(expected_picture)
                    # Weighted chroma survives yuv420 edge quantization; an
                    # unweighted hard threshold overweights faint blur tails.
                    def weighted_x(image, channel):
                        image = image.astype(float)
                        weight = np.maximum(0, image[:, :, channel] - np.max(np.delete(image[:, :, :3], channel, axis=2), axis=2) - 40)
                        return float((weight * np.arange(320)).sum() / weight.sum())
                    for channel in (0, 1):
                        self.assertAlmostEqual(weighted_x(values, channel), weighted_x(expected, channel),
                            delta=2, msg=f'{dissolve=}, {index=}, {channel=}')
                self.assertLess(centers[0], centers[8]); self.assertLess(centers[8], centers[14])
                self.assertAlmostEqual(centers[14], centers[23], delta=1)

    def test_old_projects_never_enter_scene_path(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-scene-legacy-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (160, 90), '#123456').save(folder / 'picture.png')
            settings = {'width': 160, 'height': 90, 'output': str(folder / 'legacy.mp4'),
                'shots': [{'source': str(folder / 'picture.png'), 'kind': 'image', 'start': 0, 'end': .25}],
                'titles': [], 'audio': [], 'sourceVolume': 0, 'fonts': str(ROOT / 'public/fonts'), 'manifest': {}}
            with patch.object(renderer, 'animate_scene', side_effect=AssertionError('Legacy entered scene path')):
                renderer.assemble(settings)
            with av.open(settings['output']) as movie:
                self.assertEqual(len(list(movie.decode(video=0))), 6)


if __name__ == '__main__':
    unittest.main()
