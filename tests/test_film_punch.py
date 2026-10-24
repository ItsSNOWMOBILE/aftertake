"""Punch typography and styled transitions in actual native exports."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import av
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / 'public/fonts'
spec = importlib.util.spec_from_file_location('film_renderer_punch', ROOT / 'scripts/render-film.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def title(**patch):
    return {'id': 'title', 'text': 'YOUR KEY, NO MIDDLEMAN', 'start': 0, 'end': 2, 'style': 'headline',
        'position': 'center', 'animation': 'slam', 'color': '#ff6a2b', 'motionDuration': .6, **patch}


class FilmPunchTest(unittest.TestCase):
    def test_motion_matches_the_browser_preview_reference_values(self):
        # tests/film-punch.test.ts asserts the same numbers for title-motion.ts.
        self.assertEqual([renderer.motion_hash(value) for value in [0, 1, 7, 12345, -3]],
            [0, 0.6180339867714792, 0.32623790740035474, 0.6295666939113289, 0.14589803968556225])
        self.assertEqual(renderer.slam_motion(.05, .6)['scale'], 2.530555555555556)
        self.assertEqual(renderer.slam_motion(.24, .6)['scale'], 1)
        self.assertEqual(renderer.slam_motion(.3, .6)['x'], -0.010303671216445097)
        self.assertEqual(renderer.pop_word(1, 3, .1, .6), {'scale': 0, 'opacity': 0})
        self.assertEqual(renderer.pop_word(1, 3, .3, .6)['scale'], 1.0876975)
        self.assertEqual(renderer.reveal_word(0, 1, .6, .6), {'visible': True, 'offset': 0})
        glitch = renderer.glitch_motion(.1, .6)
        self.assertEqual((glitch['split'], glitch['jitter']), (-0.013888888888888886, 0.008094662257159747))
        words, shown, seen = 'NO MIDDLEMAN'.split(), [], 0
        for word in words:
            shown += renderer.scramble_characters(word, .3, .6, seen, 11)
            seen += len(word)
        self.assertEqual(shown, ['N', 'O', 'M', '=', 'Z', 'I', '9', 'S', 'C', '3', 'M'])

    def test_fonts_boxes_and_tilt_change_the_rendered_title(self):
        plain = np.asarray(renderer.title_image(title(), 640, 360, FONTS))
        for patch in [{'font': 'display'}, {'font': 'condensed'}, {'font': 'mono'}, {'box': 'stamp'},
                {'box': 'underline'}, {'tilt': -6}]:
            changed = np.asarray(renderer.title_image(title(**patch), 640, 360, FONTS))
            self.assertFalse(np.array_equal(plain, changed), patch)
        highlight = np.asarray(renderer.title_image(title(box='highlight', stroke=False), 640, 360, FONTS))
        filled = np.all(highlight[:, :, :3] == (255, 106, 43), axis=2) & (highlight[:, :, 3] == 255)
        self.assertGreater(int(filled.sum()), 5000, 'A highlight paints a solid box in the title colour.')
        self.assertTrue(np.any(np.all(highlight[:, :, :3] == (11, 15, 10), axis=2)), 'Highlighted text is dark.')
        tilted = renderer.title_image(title(box='stamp', tilt=10), 640, 360, FONTS).getbbox()
        level = renderer.title_image(title(box='stamp'), 640, 360, FONTS).getbbox()
        self.assertGreater(tilted[3] - tilted[1], level[3] - level[1], 'Tilt rotates the stamp box.')
        for invalid in [{'tilt': 21}, {'tilt': float('nan')}, {'tilt': '5'}, {'font': 'comic'}, {'box': 'circle'}]:
            with self.assertRaises(ValueError):
                renderer.title_image(title(**invalid), 640, 360, FONTS)

    def test_punch_animations_enter_settle_and_leave(self):
        for animation in ['slam', 'pop', 'reveal', 'glitch', 'scramble']:
            item = title(animation=animation, tilt=4, box='underline')
            layout = renderer.title_image(item, 640, 360, FONTS, layout=True)
            settled = np.asarray(renderer.title_motion_frame(item, layout, 1.2))
            reference = np.asarray(renderer.title_image(item, 640, 360, FONTS))
            difference = np.abs(settled.astype(int) - reference.astype(int))
            self.assertLess(float(difference.mean()), 1, f'{animation} settles on the static title')
            early = np.asarray(renderer.title_motion_frame(item, layout, .05))
            self.assertFalse(np.array_equal(early, settled), f'{animation} animates its entrance')
            gone = np.asarray(renderer.title_motion_frame(item, layout, 1.999))
            self.assertLess(int(gone[:, :, 3].max()), 20, f'{animation} fades out at the end')

    def test_export_plays_styled_transitions_and_punch_titles_on_the_film_clock(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-film-punch-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (640, 360), '#d24a1c').save(folder / 'a.png')
            gradient = np.tile(np.linspace(0, 255, 640, dtype=np.uint8), (360, 1))
            Image.fromarray(np.dstack([gradient, gradient, np.full_like(gradient, 200)])).save(folder / 'b.png')
            titles = [title(start=.2, end=1.6, animation='slam', box='stamp', tilt=-6, font='display'),
                title(id='second', start=1.8, end=3.2, animation='scramble', font='mono', style='caption')]
            outputs = {}
            for kind in ['dissolve', 'whip', 'glitch']:
                target = folder / f'{kind}.mp4'
                shots = [{'source': str(folder / 'a.png'), 'kind': 'image', 'start': 0, 'end': 2},
                    {'source': str(folder / 'b.png'), 'kind': 'image', 'start': 0, 'end': 2, 'dissolve': .5,
                     'transition': kind}]
                renderer.assemble({'output': str(target), 'width': 640, 'height': 360, 'shots': shots, 'titles': titles,
                    'audio': [], 'sourceVolume': 0, 'fonts': str(FONTS), 'manifest': {'titles': titles, 'shots': shots}})
                with av.open(str(target)) as movie:
                    self.assertEqual(json.loads(movie.metadata['comment'])['shots'][1]['transition'], kind)
                    outputs[kind] = [frame.to_ndarray(format='rgb24') for frame in movie.decode(video=0)]
                self.assertEqual(len(outputs[kind]), 84, 'The overlap shortens the film exactly once.')
            middle = 36 + 6
            self.assertGreater(np.abs(outputs['whip'][middle].astype(int) - outputs['dissolve'][middle].astype(int)).mean(), 10)
            # Midway through a whip, the outgoing picture still fills the left side.
            self.assertGreater(int(outputs['whip'][middle][180, 20, 0]), 150)
            self.assertLess(int(outputs['whip'][middle][180, 620, 0]), 150)
            self.assertGreater(np.abs(outputs['glitch'][middle].astype(int) - outputs['dissolve'][middle].astype(int)).mean(), 10)
            # Outside the overlap, every transition leaves the same pixels.
            for frame in [10, 70]:
                self.assertLess(np.abs(outputs['whip'][frame].astype(int) - outputs['dissolve'][frame].astype(int)).mean(), 1)

    def test_wipe_reveals_the_incoming_picture_left_to_right_behind_a_light_edge(self):
        outgoing, incoming = Image.new('RGB', (240, 120), (200, 0, 0)), Image.new('RGB', (240, 120), (0, 0, 200))
        self.assertEqual(renderer.transition_frame('wipe', outgoing, incoming, 0).getpixel((5, 60)), (200, 0, 0))
        middle = renderer.transition_frame('wipe', outgoing, incoming, .5)
        self.assertEqual(middle.getpixel((20, 60)), (0, 0, 200))
        self.assertEqual(middle.getpixel((220, 60)), (200, 0, 0))
        self.assertEqual(middle.getpixel((120, 60)), (255, 255, 255))
        self.assertEqual(renderer.transition_frame('wipe', outgoing, incoming, 1).getpixel((235, 60)), (0, 0, 200))

    def test_unknown_transition_is_rejected_before_encoding(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-film-punch-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (64, 36)).save(folder / 'a.png')
            shot = {'source': str(folder / 'a.png'), 'kind': 'image', 'start': 0, 'end': 1}
            with self.assertRaises(ValueError):
                renderer.assemble({'output': str(folder / 'x.mp4'), 'width': 64, 'height': 36,
                    'shots': [shot, {**shot, 'dissolve': .25, 'transition': 'spiral'}], 'titles': [], 'audio': [],
                    'sourceVolume': 0, 'fonts': str(FONTS), 'manifest': {}})
            self.assertFalse((folder / 'x.mp4').exists())


if __name__ == '__main__':
    unittest.main()
