"""CPU graph-contract checks; no H3 installation, models or inference required."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('character_workflow_tests', ROOT / 'scripts/character-workflow.py')
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)


def replacement_graph(request=None):
    # The installed Relay recipe is deliberately absent on CPU CI. These are its
    # adapter-facing slots, not a second implementation of the model workflow.
    recipe = {name: workflow.node(kind) for name, kind in {
        'source': 'LoadVideo', 'prepare': 'H3RelayPrepareSource',
        'video_vae': 'VAELoader', 'adapter': 'LoraLoaderModelOnly',
        'reference': 'LoadImage', 'reference_conditioning': 'MiniMaxH3ReferenceToVideo',
        'plan': 'H3RelayWindowPlan', 'sampling_memory': 'H3RelaySamplingMemory',
        'finish': 'H3RelayFinishWindows', 'video': 'SaveVideo',
    }.items()}
    recipe['reference_conditioning']['inputs']['ref_images.ref_image_0']=['reference',0]
    with tempfile.TemporaryDirectory(prefix='aftertake-character-graph-') as directory:
        root = Path(directory)
        installed = root / '.runtime/ComfyUI/custom_nodes/h3-relay/h3_relay/workflows.py'
        installed.parent.mkdir(parents=True)
        installed.write_text('def character_swap_graph(**kwargs):\n    return ' + repr(recipe) + '\n')
        with patch.object(workflow, 'ROOT', root):
            return workflow.build({
                'id': 'test-result', 'kind': 'replacement', 'prompt': 'Replace the selected person.',
                'request': request or {'selectionId': 'test-selection', 'seed': 42},
                'selectionRequest': {'resolution': '768', 'trimStart': 2},
            })


def render_export_path(graph, prepared, generated, raw_mask, count):
    """Evaluate only native pixel primitives, with model outputs supplied as fixtures.

    This checks graph wiring behavior: bypassing the composite, reversing source
    and destination, or using the padded conditioning timeline must fail.
    """
    values = {('prepare', 0): prepared, ('prepare', 5): count,
              ('finish', 0): generated, ('raw_mask', 0): raw_mask,
              ('aligned_mask', 0): np.concatenate([raw_mask, np.repeat(raw_mask[-1:], 7, axis=0)])}

    def resolve(value):
        return output(*value) if isinstance(value, list) else value

    def output(name, index=0):
        if (name, index) in values:
            return values[name, index]
        entry = graph[name]
        args = {key: resolve(value) for key, value in entry['inputs'].items()}
        kind = entry['class_type']
        if kind == 'ImageFromBatch':
            value = args['image'][args['batch_index']:args['batch_index'] + args['length']]
        elif kind == 'GrowMask':
            value = args['mask']
            radius = args['expand']
            assert not args['tapered_corners']
            for axis in [1, 2]:
                padding = [(0, 0)] * 3
                padding[axis] = (radius, radius)
                value = np.lib.stride_tricks.sliding_window_view(
                    np.pad(value, padding), 2 * radius + 1, axis=axis).max(axis=-1)
        elif kind == 'MaskToImage':
            value = np.repeat(args['mask'][..., None], 3, axis=-1)
        elif kind == 'ImageBlur':
            # Match the native node's finite, normalized Gaussian kernel. The
            # assertions below concern exact zero/one regions and frame clocks.
            radius = args['blur_radius']
            coordinates = np.linspace(-1, 1, 2 * radius + 1)
            weights = np.exp(-coordinates ** 2 / (2 * args['sigma'] ** 2))
            weights /= weights.sum()
            value = args['image']
            for axis in [1, 2]:
                padding = [(0, 0)] * 4
                padding[axis] = (radius, radius)
                windows = np.lib.stride_tricks.sliding_window_view(
                    np.pad(value, padding, mode='reflect'), len(weights), axis=axis)
                value = np.sum(windows * weights, axis=-1)
        elif kind == 'ImageToMask':
            value = args['image'][..., ['red', 'green', 'blue'].index(args['channel'])]
        elif kind == 'ImageCompositeMasked':
            assert (args['x'], args['y'], args['resize_source']) == (0, 0, False)
            alpha = args['mask'][..., None]
            assert args['source'].shape == args['destination'].shape
            assert alpha.shape[:-1] == args['source'].shape[:-1]
            value = args['destination'] * (1 - alpha) + args['source'] * alpha
        else:
            raise AssertionError('Unexpected export-path node: ' + kind)
        values[name, index] = value
        return value

    return resolve(graph['save']['inputs']['images']), values


class CharacterWorkflowTests(unittest.TestCase):
    def test_cli_preserves_utf8_requests_and_prompts_with_cp1252_stdio(self):
        selection = {
            'format': 'aftertake-character-selection/1',
            'clip': {'id': '00000000-0000-4000-8000-000000000001',
                     'name': 'Bridge — café 中文.mp4', 'width': 1280, 'height': 534,
                     'duration': 5.125, 'sha256': 'a' * 64, 'hasAudio': True,
                     'url': '/media/00000000-0000-4000-8000-000000000001.mp4'},
            'trimStart': 1, 'duration': 73 / 24, 'positive': [{'x': .35, 'y': .45}],
            'negative': [], 'resolution': '768',
        }
        prompt = 'Preserve the source — lumière, café, 中文 character.'
        replacement = {'format': 'aftertake-character/1', 'name': 'Character — Zoë 中文',
                       'selectionId': '00000000-0000-4000-8000-000000000002',
                       'reference': {'width': 768, 'height': 1152}, 'seed': 42,
                       'prompt': prompt}

        def invoke(script, payload):
            env = {**os.environ, 'PYTHONIOENCODING': 'cp1252', 'PYTHONUTF8': '0'}
            result = subprocess.run([sys.executable, str(script)],
                                    input=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                    capture_output=True, timeout=30, env=env)
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            return json.loads(result.stdout.decode('utf-8'))

        with self.subTest(kind='selection'):
            graph = invoke(ROOT / 'scripts/character-workflow.py',
                           {'id': 'test-selection', 'kind': 'selection', 'request': selection})
            self.assertEqual(json.loads(graph['selection']['inputs']['request_json']), selection)

        # Run the exact CLI bytes in a temporary project root. Only the external
        # Relay recipe is a fixture, so this tests the real stdio/main boundary
        # on CPU CI without requiring the installed node pack or any inference.
        with self.subTest(kind='replacement'), tempfile.TemporaryDirectory(prefix='aftertake-character-cli-') as directory:
            root = Path(directory)
            script = root / 'scripts/character-workflow.py'
            script.parent.mkdir()
            script.write_bytes((ROOT / 'scripts/character-workflow.py').read_bytes())
            installed = root / '.runtime/ComfyUI/custom_nodes/h3-relay/h3_relay/workflows.py'
            installed.parent.mkdir(parents=True)
            recipe = {name: workflow.node(kind) for name, kind in {
                'source': 'LoadVideo', 'prepare': 'H3RelayPrepareSource',
                'video_vae': 'VAELoader', 'adapter': 'LoraLoaderModelOnly',
                'reference': 'LoadImage', 'reference_conditioning': 'MiniMaxH3ReferenceToVideo',
                'plan': 'H3RelayWindowPlan', 'sampling_memory': 'H3RelaySamplingMemory',
                'finish': 'H3RelayFinishWindows', 'video': 'SaveVideo',
            }.items()}
            installed.write_text('def character_swap_graph(**kwargs):\n    return ' + repr(recipe) + '\n', encoding='utf-8')
            graph = invoke(script, {'id': 'test-result', 'kind': 'replacement',
                                   'request': replacement, 'selectionRequest': selection, 'prompt': prompt})
            self.assertEqual(json.loads(graph['save']['inputs']['recipe_json'])['request'], replacement)
            self.assertEqual(graph['reference_conditioning']['inputs']['prompt'], prompt)

    def test_independent_photos_bind_separate_contiguous_pictures_with_and_without_primary_focus(self):
        primary={'width':960,'height':1280}
        supporting=[
            {'reference':{'width':640,'height':960}},
            {'reference':{'width':1000,'height':800},'faceBox':{'x':.2,'y':.1,'width':.4,'height':.5}},
            {'reference':{'width':200,'height':300}},
        ]
        for focus in [None,{'x':.3,'y':.1,'width':.4,'height':.3}]:
            with self.subTest(primary_focus=bool(focus)):
                request={'selectionId':'test-selection','seed':42,'reference':primary,'identityReferences':supporting}
                if focus:request['faceBox']=focus
                graph=replacement_graph(request)
                inputs=graph['reference_conditioning']['inputs']
                count=1+bool(focus)+len(supporting)
                self.assertEqual(sorted(key for key in inputs if key.startswith('ref_images.')),
                                 [f'ref_images.ref_image_{index}' for index in range(count)])
                self.assertEqual(inputs['ref_images.ref_image_0'],['reference',0])
                if focus:self.assertEqual(inputs['ref_images.ref_image_1'],['face_reference',0])
                for index,photo in enumerate(supporting):
                    self.assertEqual(graph[f'identity_reference_{index}'],workflow.node('LoadImage',image=f'IDENTITY_{index+1}.png'))
                    crop=graph[f'identity_face_{index}']['inputs']
                    self.assertEqual(crop['images'],[f'identity_reference_{index}',0])
                    self.assertEqual(inputs[f'ref_images.ref_image_{index+1+bool(focus)}'],[f'identity_face_{index}',0])
                    self.assertLessEqual(crop['target_width'],512)
                    self.assertAlmostEqual(crop['target_height'],crop['target_width']*crop['height']/crop['width'],delta=.5)
                self.assertEqual(graph['identity_face_0']['inputs']['target_height'],768)
                crop=graph['identity_face_1']['inputs']
                self.assertEqual((crop['x'],crop['y'],crop['width'],crop['height']),(200,80,400,400))
                self.assertEqual((crop['target_width'],crop['target_height']),(400,400))
                self.assertEqual(graph['identity_face_2']['inputs']['target_width'],200)
                self.assertEqual(json.loads(graph['save']['inputs']['recipe_json'])['request'],request)

    def test_maximum_supporting_photos_fit_nine_native_slots_and_empty_refs_keep_legacy_graph(self):
        request={'selectionId':'test-selection','seed':42,'reference':{'width':960,'height':1280},
                 'faceBox':{'x':.3,'y':.1,'width':.4,'height':.3}}
        legacy=replacement_graph(request)
        empty=replacement_graph({**request,'identityReferences':[]})
        # The embedded request must record the caller's empty list, while all
        # native nodes, links and the old primary crop stay unchanged.
        empty['save']['inputs']['recipe_json']=legacy['save']['inputs']['recipe_json']
        self.assertEqual(empty,legacy)
        maximum=replacement_graph({**request,'identityReferences':[
            {'reference':{'width':640,'height':960}} for _ in range(7)]})
        slots=maximum['reference_conditioning']['inputs']
        self.assertEqual(sum(key.startswith('ref_images.') for key in slots),9)
        self.assertEqual(slots['ref_images.ref_image_8'],['identity_face_6',0])

    def test_export_graph_has_valid_links_and_uses_the_unpadded_reviewed_mask(self):
        graph = replacement_graph()
        json.dumps(graph, allow_nan=False)
        for name, entry in graph.items():
            for value in entry['inputs'].values():
                if isinstance(value, list):
                    self.assertEqual(len(value), 2, name)
                    self.assertIn(value[0], graph, name)
                    self.assertIsInstance(value[1], int, name)
        save = graph['save']['inputs']
        composite = graph[save['images'][0]]
        self.assertEqual(composite['class_type'], 'ImageCompositeMasked')
        self.assertEqual(composite['inputs']['source'], ['finish', 0])
        destination = graph[composite['inputs']['destination'][0]]
        self.assertEqual(destination['inputs']['length'], ['prepare', 5])
        self.assertEqual(graph['composite_expand_mask']['inputs']['mask'], ['raw_mask', 0])
        self.assertEqual(graph['composite_blur']['inputs']['blur_radius'], 3)
        self.assertEqual(graph['composite_blur']['inputs']['sigma'], 1.5)
        self.assertEqual(save['fps'], 24)

    def test_generated_person_survives_while_source_outside_the_mask_and_73_frame_clock_are_preserved(self):
        graph = replacement_graph()
        count, height, width = 73, 96, 128
        prepared = np.broadcast_to(np.arange(80)[:, None, None, None] / 100,
                                   (80, height, width, 3)).copy()
        generated = np.broadcast_to(.8 + np.arange(count)[:, None, None, None] / 1000,
                                    (count, height, width, 3)).copy()
        mask = np.zeros((count, height, width))
        for frame in range(count):
            mask[frame, 40:56, 46 + frame % 12:62 + frame % 12] = 1
        result, values = render_export_path(graph, prepared, generated, mask, count)
        alpha = values['composite_mask', 0]
        self.assertEqual(result.shape, (count, height, width, 3))
        self.assertEqual(alpha.shape[0], count)
        self.assertTrue(np.any((alpha > 0) & (alpha < 1)), 'The mask must have a soft edge.')
        np.testing.assert_allclose(result[mask == 1], generated[mask == 1], atol=1e-12)
        np.testing.assert_array_equal(result[alpha == 0], prepared[:count][alpha == 0])
        self.assertNotEqual(float(result[0, 0, 0, 0]), float(result[-1, 0, 0, 0]))


if __name__ == '__main__':
    unittest.main()
