import importlib.util
import unittest
import sys
from pathlib import Path
import torch

spec = importlib.util.spec_from_file_location('aftertake', Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake/__init__.py')
nodes = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = nodes
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

    def test_focused_motion_restores_position_and_preserves_every_outside_pixel_and_frame(self):
        source=torch.rand(5,32,64,3);original=source.clone()
        crop=nodes.AftertakeCropRegion().execute(source,8,0,24,32,48,64)[0]
        self.assertEqual(tuple(crop.shape),(5,64,48,3))
        generated=torch.zeros_like(crop)
        for i in range(5):generated[i,:,:,i%3]=(i+1)/5
        restored=nodes.AftertakeRestoreRegion().execute(source,generated,8,0,24,32)[0]
        self.assertTrue(torch.equal(source,original))
        self.assertTrue(torch.equal(restored[:,:,:8],source[:,:,:8]))
        self.assertTrue(torch.equal(restored[:,:,32:],source[:,:,32:]))
        for i in range(5):self.assertTrue(torch.allclose(restored[i,:,8:32,i%3],torch.full((32,24),(i+1)/5),atol=1e-6))
        with self.assertRaises(ValueError):nodes.AftertakeRestoreRegion().execute(source,generated[:4],8,0,24,32)
        with self.assertRaises(ValueError):nodes.AftertakeCropRegion().execute(source,48,0,24,32,48,64)

    def test_boundary_color_match_removes_cast_without_erasing_new_detail_or_protected_pixels(self):
        source=torch.full((3,64,96,3),.4)
        target=source+torch.tensor([-.03,0,.06])
        target[:,20:44,40:56,0]+=.22
        spatial=torch.zeros(3,64,96);spatial[:,8:56,24:72]=1
        alpha=spatial*torch.tensor([0,.5,1])[:,None,None]
        corrected=nodes.AftertakeComposite().execute(source,target,alpha,True,spatial)[0]
        self.assertTrue(torch.equal(corrected[alpha==0],source[alpha==0]))
        self.assertLess(float((corrected[2,10:15,30:60]-source[2,10:15,30:60]).abs().max()),.005)
        self.assertGreater(float(corrected[2,30,48,0]-corrected[2,12,48,0]),.20)
        self.assertTrue(torch.allclose(corrected[1]-source[1],(corrected[2]-source[2])*.5,atol=1e-6))

    def test_video_presentation_geometry_is_independent_of_latent_grid(self):
        import av,json,tempfile,types
        with tempfile.TemporaryDirectory(prefix='aftertake-display-') as folder:
            previous=sys.modules.get('folder_paths')
            sys.modules['folder_paths']=types.SimpleNamespace(get_output_directory=lambda:folder,
                get_save_image_path=lambda *_:(folder,'display',1,'',None))
            try:
                images=torch.zeros(4,64,96,3);images[:,16:48,24:72,1]=1
                nodes.AftertakeSaveVideo().execute(images,16,'display','{}',display_width=96,display_height=54)
                with av.open(str(Path(folder)/'display_00001_.mp4')) as c:
                    frames=list(c.decode(video=0))
                    self.assertEqual((frames[0].width,frames[0].height),(96,54))
                    self.assertEqual(len(frames),4)
                    self.assertEqual(json.loads(c.metadata['comment'])['recipe'],{})
            finally:
                if previous is None:del sys.modules['folder_paths']
                else:sys.modules['folder_paths']=previous

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

    def test_camera_motion_keeps_low_detail_room_cue_and_erased_detail_aligned(self):
        import cv2
        import numpy as np
        import json
        root = Path(__file__).resolve().parents[1]
        width, height, count, anchor = 256, 144, 17, 8
        source = (nodes.decode_clip(root / 'examples/portal/source.mp4', width, height, 1, 16, 0)[0].numpy() * 255).round().astype(np.uint8)
        cue = json.loads((root / 'examples/portal/recipe.json').read_text())['cue']
        cue.update(start=0, end=2, fade=0)
        spatial = nodes.build_cue_mask(width, height, 1, 16, cue)[0]
        for motion in ['pan', 'zoom-roll']:
            with self.subTest(motion=motion):
                frames, expected = [], []
                for index in range(count):
                    t = (index - anchor) / anchor
                    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), t * (3 if motion == 'zoom-roll' else 0), 1 + t * (.1 if motion == 'zoom-roll' else 0))
                    matrix[:, 2] += [t * 48, t * (12 if motion == 'zoom-roll' else 0)]
                    frames.append(cv2.warpAffine(source, matrix, (width, height), borderMode=cv2.BORDER_REFLECT_101))
                    expected.append(cv2.warpAffine(spatial.numpy(), matrix, (width, height)))
                tracked = nodes.track_spatial_mask(spatial, torch.from_numpy(np.stack(frames)).float() / 255, anchor).numpy()
                overlap = []
                for actual, target in zip(tracked, expected):
                    a, b = actual > .5, target > .5
                    overlap.append((a & b).sum() / (a | b).sum())
                self.assertGreater(float(np.mean(overlap)), .97)
                self.assertGreater(min(overlap), .95)

    def test_foreground_motion_remains_independent_of_camera_prior(self):
        import cv2
        import numpy as np
        rng = np.random.default_rng(188)
        height, width, count, anchor = 144, 256, 17, 8
        background = cv2.GaussianBlur(rng.integers(0, 256, (height, width, 3), dtype=np.uint8), (3, 3), 0)
        foreground = cv2.GaussianBlur(rng.integers(0, 256, (72, 72, 3), dtype=np.uint8), (3, 3), 0)
        cue = {'start': 0, 'end': 2, 'fade': 0, 'feather': .02,
               'strokes': [{'radius': .13, 'points': [{'x': .5, 'y': .5}]}]}
        spatial = nodes.build_cue_mask(width, height, 1, 16, cue)[0]
        for camera_step in [0, 1]:
            with self.subTest(camera_step=camera_step):
                frames, expected = [], []
                for index in range(count):
                    shift = (index - anchor) * 2
                    frame = cv2.warpAffine(background, np.float32([[1, 0, (index - anchor) * camera_step], [0, 1, 0]]), (width, height), borderMode=cv2.BORDER_REFLECT_101)
                    left, top = width // 2 - 36 + shift, height // 2 - 36
                    frame[top:top + 72, left:left + 72] = foreground
                    frames.append(frame)
                    expected.append(cv2.warpAffine(spatial.numpy(), np.float32([[1, 0, shift], [0, 1, 0]]), (width, height)))
                tracked = nodes.track_spatial_mask(spatial, torch.from_numpy(np.stack(frames)).float() / 255, anchor).numpy()
                for actual, target in zip(tracked, expected):
                    a, b = actual > .5, target > .5
                    self.assertGreater((a & b).sum() / (a | b).sum(), .98)

    def test_textureless_source_uses_dense_fallback_without_a_false_camera_estimate(self):
        import numpy as np
        blank = np.full((64, 128), 120, dtype=np.uint8)
        yy, xx = np.mgrid[0:64, 0:128].astype(np.float32)
        self.assertIsNone(nodes.camera_flow(blank, blank, xx, yy))
        cue = self.cue()
        spatial = nodes.build_cue_mask(128, 64, 49, 16, cue)[24]
        images = torch.full((9, 64, 128, 3), 120 / 255)
        tracked = nodes.track_spatial_mask(spatial, images, 4)
        self.assertTrue(torch.equal(tracked, spatial.unsqueeze(0).expand(9, -1, -1)))

if __name__ == '__main__': unittest.main()
