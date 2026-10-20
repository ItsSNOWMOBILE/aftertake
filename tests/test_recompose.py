"""CPU-only native recomposition, integrity, audio and reference-math checks."""
import ast
from copy import deepcopy
from fractions import Fraction
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import av
import numpy as np
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recompose_worker', ROOT / 'scripts/recompose-take.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def write_video(path, frames, width, height, fps, metadata=None):
    with av.open(str(path), 'w') as movie:
        if metadata:
            movie.metadata['comment'] = json.dumps(metadata)
        stream = movie.add_stream('libx264', rate=fps)
        stream.width, stream.height, stream.pix_fmt = width, height, 'yuv420p'
        stream.options = {'crf': '17', 'preset': 'fast', 'threads': '2'}
        for index in range(frames):
            pixels = np.full((height, width, 3), (58, 83, 105), dtype=np.uint8)
            if metadata:
                pixels[:] = (218, 75 + index, 40)
            else:
                pixels[:, width // 2:, 1] += 20
            frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
            frame.pts, frame.time_base = index, Fraction(1, fps)
            for packet in stream.encode(frame):
                movie.mux(packet)
        for packet in stream.encode():
            movie.mux(packet)


def fixture(folder, quality='draft', pipeline='structure', with_audio=True, resolution=None):
    fps = 16 if quality == 'draft' else 24
    source = folder / 'source.mp4'
    trim = 4 / fps
    source_width, source_height = (1280, 720) if resolution == '720p' else (128, 72)
    write_video(source, 21, source_width, source_height, fps)
    if with_audio:
        # A ramped tone makes the selected trim distinguishable from time zero.
        count = round(21 / fps * 48000)
        t = np.arange(count) / 48000
        signal = (.04 + .10 * t / t[-1]) * np.sin(2 * np.pi * 440 * t)
        from media_utils import mux_generated_audio
        mux_generated_audio(source, {'waveform': signal.astype(np.float32)[None, None], 'sample_rate': 48000}, 21 / fps)
    digest = worker.file_hash(source)
    cue = {'start': 0, 'end': 2, 'fade': 0, 'feather': .02,
        'strokes': [{'radius': .25, 'points': [{'x': .5, 'y': .5}]}]}
    original = {'format': 'aftertake/1', 'name': 'Verified native take',
        'clip': {'id': '11111111-2222-4333-8444-555555555555', 'name': 'Source',
            'sha256': digest, 'width': source_width, 'height': source_height, 'duration': 21 / fps,
            'url': '/media/source.mp4', 'kind': 'video'},
        'prompt': 'A restrained test effect', 'cue': cue, 'seed': 5090,
        'quality': quality, 'trimStart': trim, 'pipeline': pipeline}
    if resolution:
        original['resolution'] = resolution
    revised = deepcopy(original)
    revised['compositeRegion'] = {'feather': .01,
        'strokes': [{'radius': .10, 'points': [{'x': .5, 'y': .5}]}]}
    dimensions = worker.expected_dimensions(original)
    graph = {'1': {'class_type': 'AftertakeSaveVideo', 'inputs': {'fps': fps}}}
    raw = folder / 'raw.mp4'
    write_video(raw, dimensions['frames'], dimensions.get('rawWidth', dimensions['width']), dimensions.get('rawHeight', dimensions['height']), fps,
        {'recipe': original, 'workflow': graph})
    return {'format': 'aftertake-recompose-work/1', 'source': str(source), 'raw': str(raw),
        'output': str(folder / 'result.mp4'), 'receipt': str(folder / 'receipt.json'),
        'expected': {'sourceSha256': digest, 'rawSha256': worker.file_hash(raw)},
        'originalRecipe': original, 'newRecipe': revised, 'dimensions': dimensions,
        'originalGenerationWorkflow': graph}


class RecompositionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def test_large_graph_receipt_is_complete_while_subprocess_output_stays_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            work = fixture(folder, with_audio=False)
            # Saved native graphs can readily exceed the finishing worker's
            # 64KiB diagnostic budget. They belong in the receipt, not stdout.
            graph = work['originalGenerationWorkflow']
            graph['large-evidence'] = {'class_type': 'RecordedOnly',
                'inputs': {'saved_graph_data': 'x' * (96 * 1024)}}
            request = folder / 'work.json'
            request.write_text(json.dumps(work), encoding='utf-8')
            completed = subprocess.run([sys.executable, str(ROOT / 'scripts/recompose-take.py'), str(request)],
                capture_output=True, timeout=60, check=True)
            self.assertLess(len(completed.stdout) + len(completed.stderr), 64 * 1024)
            result = json.loads(completed.stdout)
            receipt = json.loads(Path(work['receipt']).read_text(encoding='utf-8'))
            self.assertEqual(receipt['originalGenerationWorkflow'], graph)
            self.assertGreater(Path(work['receipt']).stat().st_size, 64 * 1024)
            self.assertEqual(result['outputSha256'], worker.file_hash(work['output']))
            self.assertEqual(result['outputSha256'], receipt['outputSha256'])
            self.assertTrue(result['noModelInvocation'])
            self.assertTrue(result['noComfyGraphExecution'])
            self.assertNotIn('originalGenerationWorkflow', result)

    def test_hd_recompose_crops_native_padding_without_resizing_raw_or_source_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = fixture(Path(temporary), quality='final', with_audio=False, resolution='720p')
            self.assertEqual(work['dimensions'], dict(width=1280, height=720, frames=17, fps=24,
                displayWidth=1280, displayHeight=720, rawWidth=1280, rawHeight=736))
            with av.open(work['raw']) as movie:
                decoded = next(movie.decode(video=0)).to_ndarray(format='rgb24')
            cropped = next(worker.checked_raw_frames(work['raw'], work['dimensions']))
            self.assertTrue(torch.equal(cropped, torch.from_numpy(decoded[8:728].copy()).float() / 255))
            with patch.object(torch.cuda, 'init', side_effect=AssertionError('HD CPU blend initialized CUDA')):
                result = worker.run(work)
            self.assertEqual((result['width'], result['height'], result['frames'], result['fps']), (1280, 720, 17, 24))
            self.assertTrue(result['allProtectedPixelsExactBeforeEncoding'])
            self.assertNotIn('display-bicubic', result['stages'])
            with av.open(work['output']) as movie:
                frames = list(movie.decode(video=0))
            self.assertEqual(len(frames), 17)
            self.assertEqual((frames[0].width, frames[0].height), (1280, 720))
            for index, frame in enumerate(frames):
                self.assertEqual(frame.pts * frame.time_base, Fraction(index, 24))

    def test_only_final_controls_can_change_and_bad_inputs_fail_before_encoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = fixture(Path(temporary), with_audio=False)
            for field, value in [('prompt', 'A changed generation'), ('seed', 9), ('trimStart', .5),
                                  ('quality', 'final'), ('cue', {**work['newRecipe']['cue'], 'fade': .1})]:
                changed = deepcopy(work)
                changed['newRecipe'][field] = value
                with self.subTest(field=field), patch.object(worker.av, 'open') as opened:
                    with self.assertRaisesRegex(ValueError, 'Only compositeRegion'):
                        worker.run(changed)
                    opened.assert_not_called()
            changed = deepcopy(work)
            changed['expected']['rawSha256'] = 'a' * 64
            with self.assertRaisesRegex(ValueError, 'changed on disk'):
                worker.run(changed)
            changed = deepcopy(work)
            changed['dimensions']['frames'] += 8
            with self.assertRaisesRegex(ValueError, 'geometry'):
                worker.run(changed)
            changed = deepcopy(work)
            changed['originalGenerationWorkflow'] = {}
            with self.assertRaisesRegex(ValueError, 'workflow'):
                worker.run(changed)
            self.assertFalse(Path(work['output']).exists())

    def test_real_export_has_exact_clock_new_region_provenance_and_trimmed_source_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = fixture(Path(temporary))
            with patch.object(torch.cuda, 'init', side_effect=AssertionError('CPU recomposition initialized CUDA')):
                result = worker.run(work)
            self.assertEqual(result['format'], worker.PROCESSOR)
            self.assertTrue(result['hasAudio'])
            self.assertTrue(result['allProtectedPixelsExactBeforeEncoding'])
            self.assertEqual(result['protectedPixelsReference'], 'display-grid-source')
            self.assertEqual(result['originalGenerationWorkflow'], work['originalGenerationWorkflow'])
            self.assertTrue(result['noModelInvocation'])
            self.assertTrue(result['noComfyGraphExecution'])
            self.assertEqual(result['outputSha256'], worker.file_hash(work['output']))
            self.assertEqual(json.loads(Path(work['receipt']).read_text()), result)
            self.assertFalse(any(name in result for name in ('source', 'raw', 'output', 'receipt', 'workflow')))
            with av.open(work['output']) as movie:
                comment = json.loads(movie.metadata['comment'])
                self.assertNotIn('workflow', comment)
                self.assertEqual(comment['recipe'], work['newRecipe'])
                frames = list(movie.decode(video=0))
            self.assertEqual(len(frames), work['dimensions']['frames'])
            for index, frame in enumerate(frames):
                self.assertEqual(frame.pts * frame.time_base, Fraction(index, 16))
                values = frame.to_ndarray(format='rgb24').astype(int)
                self.assertGreater(values[144, 256, 0], 190)
                self.assertLess(values[144, 196, 0], 80)
            def samples(path):
                with av.open(str(path)) as movie:
                    return np.concatenate([frame.to_ndarray()[0] for frame in movie.decode(audio=0)])
            original_audio, output_audio = samples(work['source']), samples(work['output'])
            offset = round(work['newRecipe']['trimStart'] * 48000)
            length = min(len(output_audio), len(original_audio) - offset)
            self.assertGreater(np.corrcoef(original_audio[offset + 1000:offset + length - 1000],
                output_audio[1000:length - 1000])[0, 1], .98)
            expected_level = np.sqrt(np.mean(original_audio[offset + 1000:offset + length - 1000] ** 2))
            actual_level = np.sqrt(np.mean(output_audio[1000:length - 1000] ** 2))
            self.assertAlmostEqual(actual_level, expected_level, delta=.003)

    def test_content_bound_workspace_rebinding_changes_addresses_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = fixture(Path(temporary), with_audio=False)
            original = work['originalRecipe']
            reference = {**original['clip'], 'kind': 'image', 'name': 'Original reference'}
            original.update(editReference=deepcopy(reference), endFrame=deepcopy(reference),
                transfer={'reference': deepcopy(reference), 'finish': {'generation': deepcopy(reference),
                    'matte': deepcopy(reference)}})
            revised = deepcopy(original)
            roles = [revised['clip'], revised['editReference'], revised['endFrame'],
                revised['transfer']['reference'], revised['transfer']['finish']['generation'],
                revised['transfer']['finish']['matte']]
            for index, role in enumerate(roles):
                role['id'] = f'rebound-role-{index}'
                role['url'] = f'/media/rebound-role-{index}.mp4'
                role['name'] = f'Workspace display name {index}'
                role['originalSha256'] = 'd' * 64
                role['hasAudio'] = True
            self.assertEqual(worker.generation_identity(original), worker.generation_identity(revised))
            self.assertNotEqual(original['clip']['id'], revised['clip']['id'])
            for key, value in [('sha256', 'b' * 64), ('width', 999), ('duration', 2), ('kind', 'image')]:
                changed = deepcopy(revised)
                changed['clip'][key] = value
                with self.subTest(key=key):
                    self.assertNotEqual(worker.generation_identity(original), worker.generation_identity(changed))
            changed = deepcopy(revised)
            changed['transfer']['finish']['matte']['sha256'] = 'c' * 64
            self.assertNotEqual(worker.generation_identity(original), worker.generation_identity(changed))
            # The actual supported source-only path accepts a rebound workspace
            # while preserving the earliest native recipe in its output receipt.
            work = fixture(Path(temporary), with_audio=False)
            work['newRecipe']['clip']['id'] = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            work['newRecipe']['clip']['url'] = '/media/new-workspace-source.mp4'
            work['newRecipe']['clip']['name'] = 'Same bytes imported under a new display name'
            del work['newRecipe']['clip']['kind']
            result = worker.run(work)
            self.assertEqual(result['originalRecipe'], work['originalRecipe'])
            self.assertEqual(result['newRecipe'], work['newRecipe'])

    def test_raw_extra_missing_or_offclock_frames_never_publish_an_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = fixture(Path(temporary), with_audio=False)
            for count in (work['dimensions']['frames'] - 1, work['dimensions']['frames'] + 1):
                write_video(Path(work['raw']), count, 512, 288, 16,
                    {'recipe': work['originalRecipe'], 'workflow': work['originalGenerationWorkflow']})
                work['expected']['rawSha256'] = worker.file_hash(work['raw'])
                with self.subTest(count=count), self.assertRaises(ValueError):
                    worker.run(work)
                self.assertFalse(Path(work['output']).exists())
            write_video(Path(work['raw']), work['dimensions']['frames'], 512, 288, 15,
                {'recipe': work['originalRecipe'], 'workflow': work['originalGenerationWorkflow']})
            work['expected']['rawSha256'] = worker.file_hash(work['raw'])
            with self.assertRaisesRegex(ValueError, 'clock'):
                worker.run(work)
            self.assertFalse(Path(work['output']).exists())

    def test_static_chunk_and_bidirectional_flow_masks_match_the_shared_native_math(self):
        from composite_math import decode_clip, build_cue_mask
        with tempfile.TemporaryDirectory() as temporary:
            work = fixture(Path(temporary), with_audio=False)
            cue = worker.final_cue(work['newRecipe'])
            cue.update(tracking='flow', anchor=8 / 16)
            images = decode_clip(work['source'], 128, 72, 17, 16, .25)
            expected = build_cue_mask(128, 72, 17, 16, cue, images, apply_envelope=False)
            actual = worker.spatial_mask(work['source'], 128, 72, 17, 16, .25, cue)
            self.assertTrue(torch.equal(actual, expected))
            complete = decode_clip(work['source'], 128, 72, 17, 16, .25)
            chunks = torch.cat([decode_clip(work['source'], 128, 72, min(8, 17 - start), 16,
                .25 + start / 16) for start in range(0, 17, 8)])
            self.assertTrue(torch.equal(complete, chunks))

    def test_final_inpaint_replays_native_pyramid_or_explicit_color_match_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = fixture(Path(temporary), quality='final', pipeline='inpaint', with_audio=False)
            with patch.object(worker, 'pyramid_blend', wraps=worker.pyramid_blend) as blend:
                result = worker.run(work)
            self.assertEqual(blend.call_count, math.ceil(work['dimensions']['frames'] / 8))
            self.assertIn('final-inpaint-laplacian-blend', result['stages'])
            self.assertNotIn('boundary-color-match', result['stages'])
            self.assertEqual((result['width'], result['height']), (768, 432))
            self.assertTrue(result['allProtectedPixelsExactBeforeEncoding'])
            self.assertFalse(result['hasAudio'])
            with av.open(work['output']) as movie:
                frames = list(movie.decode(video=0))
            self.assertEqual(len(frames), work['dimensions']['frames'])
            self.assertEqual((frames[0].width, frames[0].height), (768, 432))
            # Native matchSourceColor deliberately bypasses the pyramid and
            # corrects the saved raw plate against the final spatial matte.
            work['newRecipe']['matchSourceColor'] = True
            with patch.object(worker, 'pyramid_blend', side_effect=AssertionError('Color match ran the pyramid')):
                matched = worker.run(work)
            self.assertNotIn('final-inpaint-laplacian-blend', matched['stages'])
            self.assertIn('boundary-color-match', matched['stages'])
            self.assertTrue(matched['allProtectedPixelsExactBeforeEncoding'])

    def test_standard_pyramid_wrapper_matches_separately_installed_native_reference_exactly(self):
        reference = Path(os.environ.get('AFTERTAKE_LTX_PYRAMID_REFERENCE',
            ROOT / '.runtime/ComfyUI/custom_nodes/ComfyUI-LTXVideo/pyramid_blending.py'))
        if not reference.is_file():
            self.skipTest('Separately installed LTX reference is not present.')
        # Validation-only extraction prevents Comfy's module-level GPU imports.
        # Production never reads, copies or executes extension source code.
        from kornia.geometry.transform.pyramid import (PyrUp, build_laplacian_pyramid,
            build_pyramid, find_next_powerof_two, is_powerof_two)
        functions = {'_pad_for_laplacian', '_gaussian_pyramid', '_resize_preserving_aspect_ratio',
            '_apply_low_res_mask_dilation', '_pyramid_blend_chunk', '_pyramid_blend'}
        module = ast.parse(reference.read_text(encoding='utf-8'))
        namespace = dict(torch=torch, F=F, math=math, Tensor=torch.Tensor, PyrUp=PyrUp,
            build_laplacian_pyramid=build_laplacian_pyramid, build_pyramid=build_pyramid,
            find_next_powerof_two=find_next_powerof_two, is_powerof_two=is_powerof_two,
            _MASK_LOW_RES_LONG_SIDE=64, _CHUNK_SIZE=8)
        exec(compile(ast.Module(body=[node for node in module.body
            if isinstance(node, ast.FunctionDef) and node.name in functions], type_ignores=[]),
            str(reference), 'exec'), namespace)
        torch.manual_seed(5090)
        for height, width in [(64, 128), (96, 160), (448, 768)]:
            with self.subTest(size=(width, height)):
                a = torch.rand(2, height, width, 3)
                b = torch.rand_like(a)
                region = torch.zeros(2, height, width)
                region[:, height // 4:3 * height // 4, width // 3:2 * width // 3] = .8
                expected = namespace['_pyramid_blend'](a.movedim(-1, 1), b.movedim(-1, 1),
                    namespace['_apply_low_res_mask_dilation'](region[:, None], 6)).movedim(1, -1)
                actual = worker.pyramid_blend(a, b, region)
                self.assertTrue(torch.equal(actual, expected))


if __name__ == '__main__':
    unittest.main()
