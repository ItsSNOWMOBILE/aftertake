"""Native motion geometry, alpha and decoded export clocks; no GPU or models."""
import importlib.util
import hashlib
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
spec = importlib.util.spec_from_file_location('motion_film_renderer', ROOT / 'scripts/render-film.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
motion = renderer.film_motion


def key(at, **values):
    return {'at': at, **motion.IDENTITY, **values}


def track(**values):
    return {'keys': [key(0), key(1, **values)]}


def graphic(**values):
    return {'id': '11111111-2222-4333-8444-555555555555', 'name': 'Native marker',
            'kind': 'rect', 'start': 0, 'end': 1, 'x': .5, 'y': .5,
            'width': .2, 'height': .2, 'color': '#ff2010', 'opacity': 1, **values}


class FilmMotionTest(unittest.TestCase):
    def test_destination_easing_and_signed_rotation_use_exact_endpoint_poses(self):
        expected = {'linear': .25, 'ease-in': .25 ** 3, 'ease-out': 1 - .75 ** 3,
                    'ease-in-out': .25 ** 2 * (3 - 2 * .25), 'hold': 0}
        for easing, amount in expected.items():
            curve = motion.validate_motion({'keys': [key(0, rotation=300),
                key(1, x=1, y=-1, scale=2, rotation=-300, opacity=0, easing=easing)]})
            result = motion.motion_at(curve, .25)
            self.assertAlmostEqual(result['x'], amount)
            self.assertAlmostEqual(result['y'], -amount)
            self.assertAlmostEqual(result['scale'], 1 + amount)
            self.assertAlmostEqual(result['rotation'], 300 - 600 * amount)
            self.assertAlmostEqual(result['opacity'], 1 - amount)
            self.assertEqual(motion.motion_at(curve, 0)['rotation'], 300)
            self.assertEqual(motion.motion_at(curve, 1)['rotation'], -300)
        default = motion.validate_motion(track(x=1))
        self.assertEqual(motion.motion_at(default, .25)['x'], .25)
        held = motion.validate_motion({'keys': [key(0), key(.5, x=1, easing='hold'), key(1, x=2)]})
        self.assertEqual(motion.motion_at(held, math.nextafter(.5, 0))['x'], 0)
        self.assertEqual(motion.motion_at(held, .5)['x'], 1)

    def test_absolute_frame_phase_reaches_last_visible_frame_without_restarting_at_a_cut(self):
        self.assertEqual(motion.motion_progress(.13, 1.15, 3), 0)
        self.assertEqual(motion.motion_progress(.13, 1.15, 4), 0)
        self.assertEqual(motion.motion_progress(.13, 1.15, 27), 1)
        self.assertEqual(motion.motion_progress(.13, 1.15, 28), 1)
        self.assertAlmostEqual(motion.motion_progress(.13, 1.15, 12), 8 / 23)
        almost = math.nextafter(12 / 24, 0)
        self.assertEqual(motion.motion_progress(almost, 1, 12), 0)
        self.assertEqual(motion.motion_progress(almost, 1, 23), 1)

    def test_invalid_standalone_motion_is_rejected_before_encoding(self):
        invalid = [None, {}, {'keys': []}, {'keys': [key(0), key(.9)]},
                   {'keys': [key(0), key(0), key(1)]}, {'keys': [key(0), key(1, scale=math.nan)]},
                   {'keys': [key(0), key(1, x=True)]}, {'keys': [key(0), key(1, easing='bounce')]},
                   {'keys': [key(0), key(1, source='unexpected.png')]},
                   {'keys': [key(0), key(1)], 'duration': 1}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                motion.validate_motion(value)
        with tempfile.TemporaryDirectory() as temporary:
            settings = {'output': str(Path(temporary) / 'bad.mp4'), 'width': 320, 'height': 180,
                        'shots': [], 'titles': [{'motion': track(scale=math.inf)}]}
            with patch.object(renderer.subprocess, 'Popen') as process, patch.object(renderer.subprocess, 'run') as run:
                with self.assertRaises(ValueError):
                    renderer.assemble(settings)
                process.assert_not_called()
                run.assert_not_called()

    def test_affine_interpolates_associated_color_without_a_black_edge_fringe(self):
        picture = Image.new('RGBA', (160, 90))
        ImageDraw.Draw(picture).rectangle((55, 30, 105, 60), fill=(255, 40, 10, 128))
        result = motion.transform_title(picture, {**motion.IDENTITY, 'rotation': 17, 'scale': 1.2, 'opacity': .5})
        values = np.asarray(result)
        visible = values[:, :, 3] >= 20
        self.assertGreater(int(visible.sum()), 1000)
        self.assertLessEqual(int(values[:, :, 3].max()), 70)
        self.assertGreater(int(values[:, :, 0][visible].min()), 245)

    def test_duplicate_graphic_identifiers_are_rejected_before_encoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            settings = {'output': str(Path(temporary) / 'bad.mp4'), 'width': 320, 'height': 180,
                        'shots': [], 'titles': [], 'graphics': [graphic(), graphic(x=.8)]}
            with patch.object(renderer.subprocess, 'Popen') as process, patch.object(renderer.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'unique'):
                    renderer.assemble(settings)
                process.assert_not_called()
                run.assert_not_called()

    def test_rotated_graphics_stay_on_the_canvas_and_preserve_authored_layer_opacity(self):
        layer = motion.graphic_layout(graphic(width=3, height=3, opacity=.5,
            motion={'keys': [key(0, scale=4, rotation=90, opacity=.5), key(1, scale=4, rotation=90, opacity=.5)]}), 320, 180)
        self.assertLessEqual(layer['tile'].width, 320)
        self.assertLessEqual(layer['tile'].height, 180)
        picture = motion.graphic_frame(layer, 0)
        self.assertEqual(picture.size, (320, 180))
        self.assertAlmostEqual(picture.getpixel((160, 90))[3], 64, delta=1)
        self.assertIsNone(motion.graphic_frame(layer, 24).getbbox())
        for width, height in [(3840, 2160), (2160, 3840), (320, 180)]:
            self.assertEqual(motion.canvas_size(width, height), (width, height))
        for width, height in [(3841, 2160), (3840, 3840), (True, 180)]:
            with self.assertRaises(ValueError):
                motion.canvas_size(width, height)

    def test_independent_axes_and_outline_fill_alpha_preserve_their_own_contracts(self):
        curve = motion.validate_motion({'keys': [key(0), key(1, scale=2, scaleX=3, scaleY=.5)]})
        self.assertEqual(motion.motion_at(curve, 1)['scaleX'], 3)
        self.assertEqual(motion.motion_at(curve, 1)['scaleY'], .5)
        outline = graphic(width=.4, height=.4, fillOpacity=0, strokeColor='#ffffff', strokeWidth=16,
            motion={'keys': [key(0, scaleX=1.5, scaleY=.5), key(1, scaleX=1.5, scaleY=.5)]})
        values = np.asarray(motion.graphic_frame(motion.graphic_layout(outline, 320, 180), 0))
        self.assertEqual(int(values[90, 160, 3]), 0)
        ys, xs = np.where(values[:, :, 3] > 100)
        self.assertAlmostEqual(xs.max() - xs.min(), .4 * 320 * 1.5, delta=10)
        self.assertAlmostEqual(ys.max() - ys.min(), .4 * 180 * .5, delta=5)
        self.assertGreater(len(xs), 200)
        picture = Image.new('RGBA', (160, 90))
        ImageDraw.Draw(picture).rectangle((70, 40, 90, 50), fill='white')
        transformed = motion.transform_title(picture, {**motion.IDENTITY, 'scaleX': 2, 'scaleY': .5})
        ys, xs = np.where(np.asarray(transformed)[:, :, 3] > 100)
        self.assertAlmostEqual(xs.max() - xs.min(), 40, delta=2)
        self.assertAlmostEqual(ys.max() - ys.min(), 5, delta=2)

    def test_optional_stroke_color_defaults_to_the_white_outline_shown_in_preview(self):
        # The public schema and UI allow changing width without first changing
        # the white color picker. Rendering must preserve that visible outline.
        layer = graphic(width=.4, height=.4, fillOpacity=0, strokeWidth=16)
        frame = motion.graphic_frame(motion.graphic_layout(layer, 320, 180), 0)
        values = np.asarray(frame)
        visible = values[:, :, 3] > 100
        self.assertGreater(int(visible.sum()), 200)
        self.assertEqual(int(values[90, 160, 3]), 0)
        np.testing.assert_array_equal(values[:, :, :3][visible],
            np.full((int(visible.sum()), 3), 255, dtype=np.uint8))

    def test_png_contain_cover_rounding_and_intrinsic_alpha_are_retained(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'wide.png'
            image = Image.new('RGBA', (120, 40), (255, 20, 10, 128))
            image.save(source)
            common = graphic(kind='image', assetId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                source=str(source), width=.5, height=.8)
            fitted = motion.graphic_frame(motion.graphic_layout({**common, 'fit': 'contain'}, 320, 180), 12)
            covered = motion.graphic_frame(motion.graphic_layout({**common, 'fit': 'cover', 'radius': .3}, 320, 180), 12)
            self.assertEqual(fitted.getpixel((160, 40))[3], 0)
            self.assertAlmostEqual(covered.getpixel((160, 40))[3], 128, delta=1)
            self.assertAlmostEqual(fitted.getpixel((160, 90))[3], 128, delta=1)
            self.assertGreater(fitted.getpixel((160, 90))[0], 250)
            self.assertEqual(covered.getpixel((80, 18))[3], 0)
            framed = motion.graphic_frame(motion.graphic_layout({**common, 'fit': 'cover',
                'fillOpacity': .25, 'opacity': .8, 'strokeColor': '#ffffff', 'strokeWidth': 16}, 320, 180), 12)
            self.assertAlmostEqual(framed.getpixel((160, 90))[3], 26, delta=1)
            self.assertGreater(framed.getpixel((80, 90))[3], 190)
            for change in [{'x': math.inf}, {'opacity': True}, {'width': 10}, {'radius': .6}]:
                with self.assertRaises(ValueError):
                    motion.graphic_layout({**common, **change}, 320, 180)
            unsupported = Path(temporary) / 'fake.png'
            Image.new('RGB', (20, 20)).save(unsupported, format='GIF')
            with self.assertRaises(ValueError):
                motion.graphic_layout({**common, 'source': str(unsupported)}, 320, 180)

    def test_image_hash_is_checked_before_decode_and_standalone_sources_are_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'logo.png'
            Image.new('RGBA', (16, 16), '#ff2010').save(source)
            common = graphic(kind='image', assetId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                source=str(source), sha256=hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertIsNotNone(motion.graphic_layout(common, 320, 180)['tile'].getbbox())
            Image.new('RGBA', (16, 16), '#1020ff').save(source)
            with patch.object(motion.Image, 'open', side_effect=AssertionError('Mismatched bytes reached decoder')):
                with self.assertRaisesRegex(ValueError, 'content hash'):
                    motion.graphic_layout(common, 320, 180)
            with source.open('wb') as handle:
                handle.seek(100 * 1024 * 1024)
                handle.write(b'x')
            with patch.object(motion.Image, 'open', side_effect=AssertionError('Oversize bytes reached decoder')):
                with self.assertRaisesRegex(ValueError, '100 MiB'):
                    motion.graphic_layout(common, 320, 180)

    def test_actual_jpeg_and_webp_exports_retain_orientation_alpha_and_default_white_stroke(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-motion-still-formats-') as temporary:
            folder = Path(temporary)
            background = folder / 'background.png'
            Image.new('RGB', (320, 180), '#101820').save(background)
            for extension, format in [('jpg', 'JPEG'), ('webp', 'WEBP')]:
                with self.subTest(format=format):
                    source = folder / f'portrait.{extension}'
                    image = Image.new('RGBA', (80, 40), (240, 20, 10, 128))
                    ImageDraw.Draw(image).rectangle((40, 0, 79, 39), fill=(10, 30, 240, 128))
                    exif = image.getexif()
                    exif[274] = 6
                    picture = image.convert('RGB') if format == 'JPEG' else image
                    picture.save(source, format=format, exif=exif.tobytes())
                    layer = graphic(kind='image', start=0, end=.25, width=.25, height=.8,
                        assetId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', source=str(source),
                        sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                        strokeWidth=16, fit='contain')
                    native = motion.graphic_frame(motion.graphic_layout(layer, 320, 180), 0)
                    self.assertGreater(native.getpixel((160, 45))[0], 200)
                    self.assertGreater(native.getpixel((160, 135))[2], 200)
                    self.assertAlmostEqual(native.getpixel((160, 45))[3], 255 if format == 'JPEG' else 128, delta=1)
                    output = folder / f'{extension}.mp4'
                    renderer.assemble({'output': str(output), 'width': 320, 'height': 180,
                        'shots': [{'source': str(background), 'kind': 'image', 'start': 0, 'end': .25}],
                        'titles': [], 'graphics': [layer], 'audio': [], 'sourceVolume': 0,
                        'fonts': str(ROOT / 'public/fonts'), 'manifest': {}})
                    with av.open(str(output)) as movie:
                        frames = list(movie.decode(video=0))
                    self.assertEqual(len(frames), 6)
                    values = frames[0].to_ndarray(format='rgb24').astype(int)
                    self.assertGreater(int(values[45, 160, 0] - values[45, 160, 2]), 80)
                    self.assertGreater(int(values[135, 160, 2] - values[135, 160, 0]), 80)
                    self.assertGreater(int(values[90, 120].min()), 210)
                    if format == 'WEBP':
                        self.assertLess(int(values[45, 160, 0]), 160)

    def test_decoded_graphics_and_static_animation_title_move_across_a_cut_on_one_clock(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-motion-export-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (320, 180), '#101820').save(folder / 'background.png')
            moving = {'keys': [key(0, x=-.3), key(1, x=.3)]}
            marker = graphic(y=.78, width=.08, height=.12, motion=moving)
            title = {'text': 'MOVE', 'start': 0, 'end': 1, 'style': 'headline', 'position': 'center',
                     'animation': 'none', 'fontSize': 96, 'fontWeight': 500, 'stroke': False,
                     'color': '#40ff20', 'motion': {'keys': [key(0, x=-.2), key(1, x=.2)]}}
            background = graphic(id='11111111-2222-4333-8444-555555555556',
                kind='ellipse', width=.7, height=.7, color='#203060', opacity=.8)
            output = folder / 'motion.mp4'
            settings = {'output': str(output), 'width': 320, 'height': 180,
                        'shots': [{'source': str(folder / 'background.png'), 'kind': 'image', 'start': 0, 'end': .5}] * 2,
                        'titles': [title], 'graphics': [background, marker], 'audio': [], 'sourceVolume': 0,
                        'fonts': str(ROOT / 'public/fonts'), 'manifest': {'titles': [title], 'graphics': [background, marker]}}
            renderer.assemble(settings)
            with av.open(str(output)) as movie:
                self.assertEqual(json.loads(movie.metadata['comment']), settings['manifest'])
                decoded = list(movie.decode(video=0))
            self.assertEqual(len(decoded), 24)
            for index, frame in enumerate(decoded):
                self.assertAlmostEqual(frame.time, index / 24, places=6)
                values = frame.to_ndarray(format='rgb24').astype(float)
                red = (values[:, :, 0] > 180) & (values[:, :, 1] < 90)
                green = (values[:, :, 1] > 170) & (values[:, :, 0] < 140)
                ry, rx = np.where(red)
                gy, gx = np.where(green)
                self.assertGreater(len(rx), 200)
                self.assertGreater(len(gx), 100)
                self.assertAlmostEqual(float(rx.mean()), (0.2 + .6 * index / 23) * 320, delta=2)
                self.assertAlmostEqual(float(gx.mean()), 160 + (-.2 + .4 * index / 23) * 320, delta=3)
                # Green text remains on top of the blue graphic, not underneath it.
                self.assertGreater(float(values[:, :, 1][green].mean()), 200)
            self.assertGreater(decoded[12].time, decoded[11].time)
            # Both sides of a dissolve must sample the same absolute pose.
            settings['output'] = str(folder / 'dissolved-motion.mp4')
            settings['shots'] = [
                {'source': str(folder / 'background.png'), 'kind': 'image', 'start': 0, 'end': .5},
                {'source': str(folder / 'background.png'), 'kind': 'image', 'start': 0, 'end': .625, 'dissolve': .125}]
            renderer.assemble(settings)
            with av.open(settings['output']) as movie:
                dissolved = list(movie.decode(video=0))
            self.assertEqual(len(dissolved), 24)
            for index in [8, 9, 10, 11, 12, 23]:
                values = dissolved[index].to_ndarray(format='rgb24')
                red = (values[:, :, 0] > 180) & (values[:, :, 1] < 90)
                ys, xs = np.where(red)
                self.assertAlmostEqual(float(xs.mean()), (0.2 + .6 * index / 23) * 320, delta=2)

    def test_absent_graphics_and_explicit_empty_graphics_preserve_decoded_legacy_output(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-motion-legacy-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (160, 90), '#123456').save(folder / 'picture.png')
            title = {'text': 'LEGACY', 'start': 0, 'end': .5, 'style': 'headline', 'position': 'center',
                     'animation': 'none', 'color': '#ffffff'}
            base = {'width': 160, 'height': 90, 'shots': [{'source': str(folder / 'picture.png'),
                'kind': 'image', 'start': 0, 'end': .5}], 'titles': [title], 'audio': [],
                'sourceVolume': 0, 'fonts': str(ROOT / 'public/fonts'), 'manifest': {}}
            movies = []
            for index in range(2):
                settings = {**base, 'output': str(folder / f'legacy-{index}.mp4')}
                if index:
                    settings['graphics'] = []
                with patch.object(motion, 'transform_title', side_effect=AssertionError('Legacy title entered motion path')):
                    renderer.assemble(settings)
                with av.open(settings['output']) as movie:
                    movies.append([frame.to_ndarray(format='rgb24') for frame in movie.decode(video=0)])
            self.assertEqual(len(movies[0]), 12)
            for first, second in zip(*movies):
                np.testing.assert_array_equal(first, second)

    def test_actual_4k_export_keeps_canvas_fraction_motion_and_exact_frame_count(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-motion-4k-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (160, 90), '#101820').save(folder / 'picture.png')
            layer = graphic(start=0, end=.25, width=.06, height=.1,
                motion={'keys': [key(0, x=-.35), key(1, x=.35)]})
            target = folder / '4k.mp4'
            renderer.assemble({'output': str(target), 'width': 3840, 'height': 2160,
                'shots': [{'source': str(folder / 'picture.png'), 'kind': 'image', 'start': 0, 'end': .25}],
                'titles': [], 'graphics': [layer], 'audio': [], 'sourceVolume': 0,
                'fonts': str(ROOT / 'public/fonts'), 'manifest': {'graphics': [layer]}})
            count = 0
            with av.open(str(target)) as movie:
                self.assertEqual((movie.streams.video[0].width, movie.streams.video[0].height), (3840, 2160))
                for index, frame in enumerate(movie.decode(video=0)):
                    self.assertAlmostEqual(frame.time, index / 24, places=6)
                    count += 1
                    if index not in (0, 5):
                        continue
                    values = frame.to_ndarray(format='rgb24')
                    red = (values[:, :, 0] > 180) & (values[:, :, 1] < 90)
                    ys, xs = np.where(red)
                    self.assertGreater(len(xs), 40000)
                    self.assertAlmostEqual(float(xs.mean()), (.15 if index == 0 else .85) * 3840, delta=2)
                    self.assertAlmostEqual(float(ys.mean()), 1080, delta=2)
            self.assertEqual(count, 6)


if __name__ == '__main__':
    unittest.main()
