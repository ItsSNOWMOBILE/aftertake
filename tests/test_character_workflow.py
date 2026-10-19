"""CPU graph-contract checks; no H3 installation, models or inference required."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('character_workflow_tests', ROOT / 'scripts/character-workflow.py')
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)


def replacement_graph():
    # The installed Relay recipe is deliberately absent on CPU CI. These are its
    # adapter-facing slots, not a second implementation of the model workflow.
    recipe = {name: workflow.node(kind) for name, kind in {
        'source': 'LoadVideo', 'prepare': 'H3RelayPrepareSource',
        'video_vae': 'VAELoader', 'adapter': 'LoraLoaderModelOnly',
        'reference': 'LoadImage', 'reference_conditioning': 'MiniMaxH3ReferenceToVideo',
        'plan': 'H3RelayWindowPlan', 'sampling_memory': 'H3RelaySamplingMemory',
        'finish': 'H3RelayFinishWindows', 'video': 'SaveVideo',
    }.items()}
    with tempfile.TemporaryDirectory(prefix='aftertake-character-graph-') as directory:
        root = Path(directory)
        installed = root / '.runtime/ComfyUI/custom_nodes/h3-relay/h3_relay/workflows.py'
        installed.parent.mkdir(parents=True)
        installed.write_text('def character_swap_graph(**kwargs):\n    return ' + repr(recipe) + '\n')
        with patch.object(workflow, 'ROOT', root):
            return workflow.build({
                'id': 'test-result', 'kind': 'replacement', 'prompt': 'Replace the selected person.',
                'request': {'selectionId': 'test-selection', 'seed': 42},
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
