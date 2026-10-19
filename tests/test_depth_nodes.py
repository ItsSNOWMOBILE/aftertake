"""A new adapter must reject hardware before invoking the native model loader."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_depth_node_tests', ROOT / 'custom_nodes/aftertake/__init__.py')
nodes = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = nodes
spec.loader.exec_module(nodes)
depth = sys.modules[spec.name + '.depth_nodes']


class DepthNodeTests(unittest.TestCase):
    def test_hardware_rejection_precedes_native_loader_import_or_allocation(self):
        image = torch.zeros((1, 64, 96, 3))
        with patch.object(depth, 'depth_preflight', side_effect=RuntimeError('CUDA BF16 blocked')) as preflight:
            with self.assertRaisesRegex(RuntimeError, 'CUDA BF16 blocked'):
                depth.AftertakeEstimateDepth().execute(image, '{}')
            preflight.assert_called_once_with(native_execution=True)
            self.assertEqual(depth.AftertakeEstimateDepth.VALIDATE_INPUTS(json.dumps({
                'format': 'aftertake-depth-effect/1', 'clip': {'kind': 'image'}})), 'CUDA BF16 blocked')

    def test_video_input_is_explicitly_rejected_by_native_validation(self):
        with patch.object(depth, 'depth_preflight', side_effect=AssertionError('No model preparation for video')):
            message = depth.AftertakeEstimateDepth.VALIDATE_INPUTS(json.dumps({
                'format': 'aftertake-depth-effect/1', 'clip': {'kind': 'video'}}))
            self.assertIn('still image', message)
        self.assertIn('AftertakeEstimateDepth', nodes.NODE_CLASS_MAPPINGS)


if __name__ == '__main__': unittest.main()
