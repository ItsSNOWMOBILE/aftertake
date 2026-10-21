"""Provider-selection receipts without loading a model or accessing any accelerator."""
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import depth_runtime as runtime  # noqa: E402


def fake_runtime(available, broken=(), active=None, run_error=None):
    calls = []

    class Session:
        def __init__(self, model, providers, sess_options, enable_fallback):
            self.name = providers[0][0]
            self.options = sess_options
            calls.append({'providers': providers, 'options': sess_options, 'fallback': enable_fallback})
            if self.name in broken:
                raise RuntimeError(self.name + ' failed to compile')

        def get_providers(self):
            return active if active is not None else [self.name]

        def get_inputs(self):
            return [types.SimpleNamespace(name='pixel_values')]

        def run(self, names, feeds):
            if run_error:
                raise RuntimeError(run_error)
            shape = feeds['pixel_values'].shape
            return [np.ones((1, shape[2], shape[3]), np.float32)]

        def end_profiling(self):
            path = Path(self.options.profile_file_prefix + '.json')
            path.write_text(json.dumps([{'cat': 'Node', 'name': 'depth_kernel_time', 'dur': 1200,
                                        'args': {'provider': self.name, 'op_name': 'DepthSubgraph'}}]))
            return str(path)

    return types.SimpleNamespace(__version__='test', get_available_providers=lambda: available,
                                 InferenceSession=Session, SessionOptions=types.SimpleNamespace,
                                 ExecutionMode=types.SimpleNamespace(ORT_SEQUENTIAL='sequential')), calls


class ProviderSelectionTest(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def depth(self, ort, **kwargs):
        return runtime.Depth(1344, 736, ort=ort, model=Path('unused-model.onnx'), **kwargs)

    def test_forced_unavailable_accelerator_does_not_run_on_cpu(self):
        ort, calls = fake_runtime(['CPUExecutionProvider'])
        with patch.dict(os.environ, {'AFTERTAKE_DEPTH_PROVIDER': 'openvino'}):
            with self.assertRaisesRegex(ValueError, 'openvino is not installed'):
                self.depth(ort)
        self.assertEqual(calls, [])

    def test_forced_compile_failure_preserves_error_and_does_not_retry_cpu(self):
        ort, calls = fake_runtime(['OpenVINOExecutionProvider', 'CPUExecutionProvider'],
                                  broken=['OpenVINOExecutionProvider'])
        with patch.dict(os.environ, {'AFTERTAKE_DEPTH_PROVIDER': 'openvino'}):
            with self.assertRaisesRegex(ValueError, 'OpenVINOExecutionProvider failed to compile'):
                self.depth(ort)
        self.assertEqual(len(calls), 1)
        self.assertFalse(calls[0]['fallback'])

    def test_automatic_cpu_fallback_warns_and_remembers_original_failure(self):
        ort, calls = fake_runtime(['CoreMLExecutionProvider', 'CPUExecutionProvider'],
                                  broken=['CoreMLExecutionProvider'])
        with self.assertWarnsRegex(RuntimeWarning, 'CoreMLExecutionProvider failed to compile'):
            depth = self.depth(ort)
        receipt = depth.diagnostics()
        self.assertEqual(receipt['requestedProvider'], 'auto')
        self.assertEqual(receipt['provider'], 'cpu')
        self.assertTrue(receipt['fallback'])
        self.assertIn('failed to compile', receipt['failedProviders'][0])
        self.assertEqual(len(calls), 2)

    def test_internal_provider_replacement_is_rejected(self):
        ort, calls = fake_runtime(['OpenVINOExecutionProvider', 'CPUExecutionProvider'],
                                  active=['CPUExecutionProvider'])
        with patch.dict(os.environ, {'AFTERTAKE_DEPTH_PROVIDER': 'openvino'}):
            with self.assertRaisesRegex(ValueError, 'but session registered'):
                self.depth(ort)
        self.assertEqual(len(calls), 1)

    def test_directml_uses_required_session_options_and_explicit_adapter(self):
        ort, calls = fake_runtime(['DmlExecutionProvider', 'CPUExecutionProvider'])
        with patch.dict(os.environ, {'AFTERTAKE_DEPTH_PROVIDER': 'directml', 'AFTERTAKE_DEPTH_DML_DEVICE_ID': '1'}):
            depth = self.depth(ort)
        self.assertFalse(calls[0]['options'].enable_mem_pattern)
        self.assertEqual(calls[0]['options'].execution_mode, 'sequential')
        self.assertEqual(calls[0]['providers'][0], ('DmlExecutionProvider', {'device_id': '1'}))
        self.assertEqual(depth.diagnostics()['inputSize'], [658, 364])

    def test_directml_default_adapter_and_invalid_indices(self):
        self.assertEqual(runtime.provider_options('directml', 658, 364), {'device_id': '0'})
        for value in ('-1', 'gpu0', '1.5', ''):
            with self.subTest(value=value), patch.dict(os.environ, {'AFTERTAKE_DEPTH_DML_DEVICE_ID': value}):
                with self.assertRaisesRegex(ValueError, 'nonnegative DXGI adapter'):
                    runtime.provider_options('directml', 658, 364)

    def test_runtime_error_does_not_trigger_a_new_cpu_session(self):
        ort, calls = fake_runtime(['OpenVINOExecutionProvider', 'CPUExecutionProvider'], run_error='NPU execution failed')
        with patch.dict(os.environ, {'AFTERTAKE_DEPTH_PROVIDER': 'openvino'}):
            depth = self.depth(ort)
            with self.assertRaisesRegex(RuntimeError, 'NPU execution failed'):
                depth(np.zeros((736, 1344, 3), np.uint8))
        self.assertEqual(len(calls), 1)
        self.assertFalse(calls[0]['fallback'])

    def test_status_is_explicitly_an_uninitialized_candidate(self):
        ort, calls = fake_runtime(['OpenVINOExecutionProvider', 'CPUExecutionProvider'])
        model = types.SimpleNamespace(is_file=lambda: True,
                                      stat=lambda: types.SimpleNamespace(st_size=runtime.MODEL['size']))
        with patch.object(runtime, 'import_runtime', return_value=ort), patch.object(runtime, 'MODEL_PATH', model):
            status = runtime.status()
        self.assertEqual(status['verification'], 'not-initialized')
        self.assertIn('candidate', status['note'])
        self.assertEqual(calls, [])

    def test_status_does_not_advertise_an_unavailable_forced_provider(self):
        ort, _ = fake_runtime(['CPUExecutionProvider'])
        with patch.object(runtime, 'import_runtime', return_value=ort), patch.dict(os.environ, {'AFTERTAKE_DEPTH_PROVIDER': 'openvino'}):
            status = runtime.status()
        self.assertIsNone(status['accelerator'])
        self.assertIn('not installed', status['fix'])

    def test_profile_records_mixed_node_providers_without_claiming_pure_npu(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'profile.json'
            path.write_text(json.dumps([
                {'cat': 'Node', 'name': 'depth_kernel_time', 'dur': 5000,
                 'args': {'provider': 'OpenVINOExecutionProvider', 'op_name': 'OpenVINO-EP-subgraph'}},
                {'cat': 'Node', 'name': 'shape_kernel_time', 'dur': 3,
                 'args': {'provider': 'CPUExecutionProvider', 'op_name': 'Shape'}},
                {'cat': 'Session', 'name': 'model_run', 'dur': 6000},
                {'cat': 'Node', 'name': 'no-provider_kernel_time', 'args': {}}
            ]))
            result = runtime.summarize_profile(path)
        self.assertEqual(result['status'], 'profiled')
        self.assertEqual(result['providers']['CPUExecutionProvider']['ops'], {'Shape': 1})
        self.assertEqual(result['providers']['OpenVINOExecutionProvider']['kernelMicroseconds'], 5000)
        self.assertEqual(result['unassignedKernelEvents'], 1)
        self.assertIn('not isolated device', result['note'])

    def test_opt_in_profile_can_be_closed_and_included_in_receipt(self):
        ort, calls = fake_runtime(['DmlExecutionProvider', 'CPUExecutionProvider'])
        with tempfile.TemporaryDirectory() as folder:
            depth = self.depth(ort, profile_prefix=str(Path(folder) / 'depth'))
            self.assertTrue(calls[0]['options'].enable_profiling)
            self.assertEqual(depth.diagnostics()['executionEvidence']['status'], 'not-profiled')
            profile = depth.finish_profiling()
            self.assertEqual(profile['status'], 'profiled')
            self.assertEqual(depth.finish_profiling(), profile)
            self.assertEqual(depth.diagnostics()['executionEvidence'], profile)


if __name__ == '__main__':
    unittest.main()
