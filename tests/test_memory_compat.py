"""Explicit Windows transfer opt-in; no model loading or GPU inference."""
import importlib.util
import inspect
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_memory_compat_tests',
    ROOT / 'custom_nodes/aftertake/memory_compat.py')
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)


def modules(hook):
    comfy = types.ModuleType('comfy')
    memory = types.ModuleType('comfy.memory_management')
    memory.read_tensor_file_slice_into = hook
    comfy.memory_management = memory
    return memory, {'comfy': comfy, 'comfy.memory_management': memory}


class MemoryCompatTests(unittest.TestCase):
    def test_native_transfer_is_untouched_by_default_on_windows_and_on_other_platforms(self):
        def original(tensor, destination, stream=None, destination2=None): return True
        memory, available = modules(original)
        for platform, enabled in [('nt', None), ('nt', '0'), ('nt', 'yes'), ('posix', '1')]:
            with patch.dict(sys.modules, available), patch.object(compat.os, 'name', platform), \
                    patch.dict(compat.os.environ, {}, clear=True):
                if enabled is not None:
                    compat.os.environ['AFTERTAKE_SAFE_WEIGHT_COPIES'] = enabled
                compat.install()
                self.assertIs(memory.read_tensor_file_slice_into, original)

    def test_explicit_opt_in_preserves_native_hook_signature_and_normal_transfer_arguments(self):
        calls = []
        def original(tensor, destination, stream=None, destination2=None):
            calls.append((tensor, destination, stream, destination2))
            return 'native result'
        memory, available = modules(original)
        with patch.dict(sys.modules, available), patch.object(compat.os, 'name', 'nt'), \
                patch.dict(compat.os.environ, {'AFTERTAKE_SAFE_WEIGHT_COPIES': '1'}):
            compat.install()
            wrapped = memory.read_tensor_file_slice_into
            compat.install()
        self.assertIs(memory.read_tensor_file_slice_into, wrapped, 'Repeated opt-in must not stack wrappers.')
        self.assertEqual(inspect.signature(wrapped), inspect.signature(original))
        self.assertTrue(wrapped.aftertake_safe_copies)
        source = torch.tensor([1, 2, 3], dtype=torch.int8)
        destination = torch.empty_like(source)
        stream, destination2 = object(), object()
        self.assertEqual(wrapped(source, destination, stream, destination2), 'native result')
        self.assertEqual(len(calls), 1)
        for actual, expected in zip(calls[0], (source, destination, stream, destination2)):
            self.assertIs(actual, expected)

    def test_file_backed_quantized_bytes_and_metadata_survive_the_explicit_transfer_path(self):
        def original(tensor, destination, stream=None, destination2=None):
            raise AssertionError('The native file reader must be bypassed only for this explicit opt-in.')
        memory, available = modules(original)
        with patch.dict(sys.modules, available), patch.object(compat.os, 'name', 'nt'), \
                patch.dict(compat.os.environ, {'AFTERTAKE_SAFE_WEIGHT_COPIES': '1'}):
            compat.install()
        raw = torch.tensor([-128, -31, 0, 15, 127], dtype=torch.int8)
        raw.untyped_storage()._comfy_tensor_file_slice = object()
        quantization = {'layout': 'native-int8', 'scale': torch.tensor(.25)}
        tensor = types.SimpleNamespace(_qdata=raw, quantization=quantization)
        before = raw.clone()
        destination = torch.empty_like(raw)
        result = memory.read_tensor_file_slice_into(tensor, destination)
        self.assertIs(result, False, 'False selects the existing upstream copy_ transfer, not a dtype conversion.')
        destination.copy_(raw)
        self.assertEqual(destination.dtype, torch.int8)
        self.assertTrue(torch.equal(destination, before))
        self.assertTrue(torch.equal(raw, before))
        self.assertIs(tensor._qdata, raw)
        self.assertIs(tensor.quantization, quantization)
        self.assertEqual(float(quantization['scale']), .25)

    def test_explicit_opt_in_refuses_changed_transfer_signatures_without_patching(self):
        def missing_argument(tensor, destination, stream=None): pass
        def changed_default(tensor, destination, stream=0, destination2=None): pass
        def keyword_only(tensor, destination, *, stream=None, destination2=None): pass
        def added_argument(tensor, destination, stream=None, destination2=None, new_option=None): pass
        def changed_order(destination, tensor, stream=None, destination2=None): pass
        for hook in [missing_argument, changed_default, keyword_only, added_argument, changed_order, None]:
            memory, available = modules(hook)
            with patch.dict(sys.modules, available), patch.object(compat.os, 'name', 'nt'), \
                    patch.dict(compat.os.environ, {'AFTERTAKE_SAFE_WEIGHT_COPIES': '1'}):
                with self.assertRaisesRegex(RuntimeError, 'pinned|unsupported'):
                    compat.install()
                self.assertIs(memory.read_tensor_file_slice_into, hook)


if __name__ == '__main__':
    unittest.main()
