import importlib.util
import unittest
from pathlib import Path
import torch

spec = importlib.util.spec_from_file_location('aftertake', Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake/__init__.py')
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)

class CueTests(unittest.TestCase):
    def cue(self):
        return {'start': .5, 'end': 2.5, 'fade': .5, 'feather': .02,
                'strokes': [{'radius': .1, 'points': [{'x': .2, 'y': .5}, {'x': .8, 'y': .5}]}]}

    def test_continuous_capsule_and_temporal_envelope(self):
        mask = nodes.build_cue_mask(128, 64, 49, 16, self.cue())
        self.assertEqual(tuple(mask.shape), (49, 64, 128))
        self.assertEqual(mask[0].sum(), 0)
        self.assertEqual(mask[-1].sum(), 0)
        self.assertEqual(mask[8].sum(), 0)
        self.assertEqual(mask[24, 32, 64], 1)
        self.assertEqual(mask[24, 2, 64], 0)
        self.assertAlmostEqual(mask[12, 32, 64].item(), .5)
        self.assertTrue(torch.all(mask[24, 32, 30:100] == 1))

    def test_composite_preserves_unedited_pixels_exactly(self):
        mask = nodes.build_cue_mask(128, 64, 49, 16, self.cue())
        source = torch.rand(49, 64, 128, 3)
        generated = torch.rand_like(source)
        composite = nodes.AftertakeComposite().execute(source, generated, mask)[0]
        self.assertTrue(torch.equal(composite[mask == 0], source[mask == 0]))
        self.assertTrue(torch.allclose(composite[mask == 1], generated[mask == 1], atol=1e-7))
        self.assertTrue(torch.equal(composite[0], source[0]))
        self.assertTrue(torch.equal(composite[-1], source[-1]))

    def test_mismatched_frames_fail_instead_of_damaging_timing(self):
        with self.assertRaises(ValueError):
            nodes.AftertakeComposite().execute(torch.zeros(5, 64, 64, 3), torch.zeros(4, 64, 64, 3), torch.zeros(5, 64, 64))

    def test_single_point_stroke_works(self):
        cue = self.cue()
        cue['strokes'][0]['points'] = [{'x': .5, 'y': .5}]
        mask = nodes.build_cue_mask(128, 64, 49, 16, cue)
        self.assertEqual(mask[24, 32, 64], 1)
        self.assertEqual(mask[24, 32, 0], 0)

    def test_inpaint_conditioning_region_is_present_even_before_the_effect_cue(self):
        cue = self.cue()
        edit, preserve, spatial = nodes.AftertakeCueMask().execute(128, 64, 49, 16, __import__('json').dumps(cue))
        self.assertEqual(edit[0, 32, 64], 0)
        self.assertEqual(preserve[0, 32, 64], 1)
        self.assertEqual(spatial[0, 32, 64], 1)
        self.assertTrue(torch.equal(spatial[0], spatial[-1]))

    def test_motion_tracking_follows_texture_in_both_directions_from_anchor(self):
        torch.manual_seed(11)
        texture = torch.rand(64, 128, 3)
        images = torch.stack([torch.roll(texture, shifts=i * 2, dims=1) for i in range(9)])
        cue = self.cue()
        cue.update(start=0, end=2, fade=0, tracking='flow', anchor=4 / 16)
        cue['strokes'] = [{'radius': .1, 'points': [{'x': .5, 'y': .5}]}]
        mask = nodes.build_cue_mask(128, 64, 9, 16, cue, images)
        xs = torch.arange(128)[None, :]
        centers = [(frame * xs).sum().item() / frame.sum().item() for frame in mask]
        for index, center in enumerate(centers):
            self.assertAlmostEqual(center, 63.5 + (index - 4) * 2, delta=1.5)
        with self.assertRaises(ValueError): nodes.build_cue_mask(128, 64, 9, 16, cue)

    def test_eraser_protects_source_and_later_paint_can_restore_the_region(self):
        cue = self.cue()
        cue['strokes'].append({'mode': 'erase', 'radius': .06, 'points': [{'x': .5, 'y': .5}]})
        mask = nodes.build_cue_mask(128, 64, 49, 16, cue)
        self.assertEqual(mask[24, 32, 64], 0)
        self.assertEqual(mask[24, 32, 40], 1)
        source = torch.rand(49, 64, 128, 3)
        composite = nodes.AftertakeComposite().execute(source, torch.ones_like(source), mask)[0]
        self.assertTrue(torch.equal(composite[24, 32, 64], source[24, 32, 64]))
        cue['strokes'].append({'radius': .04, 'points': [{'x': .5, 'y': .5}]})
        self.assertEqual(nodes.build_cue_mask(128, 64, 49, 16, cue)[24, 32, 64], 1)

if __name__ == '__main__': unittest.main()
