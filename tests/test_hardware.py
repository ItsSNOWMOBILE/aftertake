"""Hardware admission tests run on CPU CI, without importing torch or models."""
from contextlib import contextmanager, nullcontext
from dataclasses import replace
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('aftertake_hardware_tests', ROOT / 'custom_nodes/aftertake/hardware.py')
hardware = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = hardware
SPEC.loader.exec_module(hardware)


def facts(**overrides):
    value = hardware.HardwareFacts(
        backend='cuda', device_index=0, name='RTX 3090 fixture',
        total_vram_bytes=24 * hardware.GIB, free_vram_bytes=20 * hardware.GIB,
        compute_capability=(8, 6), native_bf16=True, native_fp8=False,
        cuda_version='13.0', torch_version='2.11.0+cu130', device_uuid='GPU-3090-test',
    )
    return replace(value, **overrides)


class FakeCuda:
    def __init__(self, devices):
        self.devices = devices
        self.selected = 0
        self.native_bf16_queries = []
        self.memory_queries = []
        self.synchronizations = []

    def is_available(self):
        return bool(self.devices)

    def device_count(self):
        return len(self.devices)

    @contextmanager
    def device(self, index):
        previous = self.selected
        self.selected = index
        try:
            yield
        finally:
            self.selected = previous

    def get_device_properties(self, index):
        device = self.devices[index]
        return SimpleNamespace(name=device.name, major=device.compute_capability[0],
                               minor=device.compute_capability[1], uuid=device.device_uuid)

    def is_bf16_supported(self, *, including_emulation):
        self.native_bf16_queries.append((self.selected, including_emulation))
        return self.devices[self.selected].native_bf16 or including_emulation

    def mem_get_info(self, index):
        self.memory_queries.append(index)
        device = self.devices[index]
        return device.free_vram_bytes, device.total_vram_bytes

    def synchronize(self, index):
        self.synchronizations.append(index)


class FakeTorch:
    def __init__(self, devices=None, *, hip=None, cuda='13.0'):
        self.__version__ = '2.11.0+cu130'
        self.version = SimpleNamespace(hip=hip, cuda=cuda)
        self.cuda = FakeCuda([facts()] if devices is None else devices)
        self.float8_e4m3fn = 'float8_e4m3fn'

    def inference_mode(self):
        return nullcontext()


class CountingBackend(hardware.NvidiaExecutionBackend):
    """Probe seam counts tiny allocations without requiring CUDA on CI."""
    def __init__(self, *args, fail_probe=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.bf16_probes = []
        self.fp8_probes = []
        self.fail_probe = fail_probe

    def _run_bf16_probe(self, torch, device):
        self.bf16_probes.append(device)
        if self.fail_probe:
            raise RuntimeError('fixture: compiled kernel unavailable')

    def _run_fp8_probe(self, torch, device):
        self.fp8_probes.append(device)
        if self.fail_probe:
            raise RuntimeError('fixture: compiled FP8 kernel unavailable')


class ProbeScalar:
    def __init__(self, value):
        self.value = value

    def all(self):
        return self

    def item(self):
        return self.value


class ProbeTensor:
    def __init__(self, value=1, device_index=0):
        self.value = value
        self.dtype = 'bf16'
        self.device = SimpleNamespace(type='cuda', index=device_index)

    def __matmul__(self, other):
        return ProbeTensor(16, self.device.index)

    def __eq__(self, other):
        return ProbeScalar(self.value == other)


def operator_probe_torch():
    forbidden = MagicMock(side_effect=AssertionError('Global SDPA dispatch must never change during a probe.'))
    operators = SimpleNamespace(**{
        name: SimpleNamespace(default=MagicMock(return_value=(ProbeTensor(),)))
        for name in ('_scaled_dot_product_flash_attention', '_scaled_dot_product_efficient_attention',
                     '_scaled_dot_product_cudnn_attention')
    })
    torch = SimpleNamespace(
        bfloat16='bf16', ones=MagicMock(side_effect=lambda *a, **k: ProbeTensor()),
        isfinite=lambda result: ProbeScalar(True), ops=SimpleNamespace(aten=operators),
        nn=SimpleNamespace(attention=SimpleNamespace(sdpa_kernel=forbidden),
                           functional=SimpleNamespace(scaled_dot_product_attention=forbidden)),
        backends=SimpleNamespace(cuda=SimpleNamespace(**{name: forbidden for name in (
            'enable_flash_sdp', 'enable_mem_efficient_sdp', 'enable_math_sdp', 'enable_cudnn_sdp', 'sdp_kernel')})),
    )
    return torch, operators, forbidden


class HardwareTests(unittest.TestCase):
    def setUp(self):
        hardware._PROBE_CACHE.clear()

    def assert_code(self, code, callback):
        with self.assertRaises(hardware.HardwareConfigurationError) as captured:
            callback()
        self.assertEqual(captured.exception.code, code)
        return str(captured.exception)

    def test_module_import_does_not_import_torch(self):
        with patch.object(hardware.importlib, 'import_module', side_effect=AssertionError('unexpected torch import')):
            config = hardware.HardwareConfig()
            backend = hardware.NvidiaExecutionBackend(config)
            self.assertEqual(backend.config, config)
            self.assertIs(hardware.validate_hardware(facts(), config).native_bf16, True)

    def test_3090_supports_bf16_without_native_fp8(self):
        result = hardware.validate_hardware(facts(), hardware.HardwareConfig())
        self.assertEqual(result.compute_capability, (8, 6))
        self.assertFalse(result.native_fp8)

    def test_3090_rejects_an_explicit_native_fp8_path(self):
        message = self.assert_code('native_fp8_required', lambda: hardware.validate_hardware(
            facts(), hardware.HardwareConfig(require_native_fp8=True)))
        self.assertIn('will not expand the model into FP32', message)

    def test_ada_supports_explicit_native_fp8(self):
        value = facts(compute_capability=(8, 9), native_fp8=True)
        self.assertIs(hardware.validate_hardware(value, hardware.HardwareConfig(require_native_fp8=True)), value)

    def test_older_gpu_cannot_pass_with_emulated_bf16(self):
        self.assert_code('native_bf16_required', lambda: hardware.validate_hardware(
            facts(compute_capability=(7, 5), native_bf16=True), hardware.HardwareConfig()))

    def test_native_bf16_must_be_verified_even_on_a_new_gpu(self):
        self.assert_code('native_bf16_required', lambda: hardware.validate_hardware(
            facts(compute_capability=(12, 0), native_bf16=False), hardware.HardwareConfig()))

    def test_precision_fact_types_cannot_turn_false_text_into_support(self):
        for key in ('native_bf16', 'native_fp8'):
            for value in ('false', 'true', 0, 1, None):
                with self.subTest(key=key, value=value):
                    self.assert_code('invalid_hardware_facts', lambda: hardware.validate_hardware(
                        facts(**{key: value}), hardware.HardwareConfig()))

    def test_no_cpu_mps_or_rocm_backend(self):
        for backend in ('cpu', 'mps', 'rocm', 'auto'):
            with self.subTest(backend=backend):
                self.assert_code('unsupported_backend', lambda: hardware.HardwareConfig(backend=backend))
        self.assert_code('unsupported_backend', lambda: hardware.validate_hardware(
            facts(backend='cpu'), hardware.HardwareConfig()))

    def test_invalid_memory_configuration_is_explicit(self):
        for value in (-1, float('nan'), float('inf'), True, '3'):
            with self.subTest(value=value):
                self.assert_code('invalid_memory_budget', lambda: hardware.HardwareConfig(reserve_vram_gib=value))
                self.assert_code('invalid_memory_budget', lambda: hardware.HardwareConfig(required_workspace_gib=value))

    def test_explicit_workspace_is_separate_from_headroom(self):
        config = hardware.HardwareConfig(reserve_vram_gib=3, required_workspace_gib=6)
        for free in (8 * hardware.GIB, 9 * hardware.GIB):
            self.assert_code('insufficient_vram', lambda: hardware.validate_hardware(facts(free_vram_bytes=free), config))
        self.assertEqual(hardware.validate_hardware(facts(free_vram_bytes=9 * hardware.GIB + 1), config).free_vram_bytes,
                         9 * hardware.GIB + 1)

    def test_no_universal_vram_floor_is_invented(self):
        small = facts(total_vram_bytes=4 * hardware.GIB, free_vram_bytes=3 * hardware.GIB + 1)
        self.assertIs(hardware.validate_hardware(small, hardware.HardwareConfig()), small)
        self.assert_code('insufficient_vram', lambda: hardware.validate_hardware(
            small, hardware.HardwareConfig(required_workspace_gib=1)))

    def test_explicit_verified_model_residency_can_satisfy_workspace_budget(self):
        value = facts(total_vram_bytes=16 * hardware.GIB, free_vram_bytes=2 * hardware.GIB,
                      reclaimable_vram_bytes=8 * hardware.GIB)
        config = hardware.HardwareConfig(required_workspace_gib=6)
        result = hardware.validate_hardware(value, config)
        self.assertEqual(result.free_vram_bytes, 2 * hardware.GIB)
        self.assertEqual(result.reclaimable_vram_bytes, 8 * hardware.GIB)
        self.assertEqual(result.as_dict()['free_vram_bytes'], 2 * hardware.GIB)

    def test_reclaimable_residency_cannot_overcount_occupied_memory(self):
        for value in (-1, 5 * hardware.GIB, True, 1.0):
            with self.subTest(value=value):
                self.assert_code('invalid_hardware_facts', lambda: hardware.validate_hardware(
                    facts(free_vram_bytes=20 * hardware.GIB, reclaimable_vram_bytes=value), hardware.HardwareConfig()))

    def test_startup_never_implicitly_assumes_other_gpu_memory_is_reclaimable(self):
        torch = FakeTorch([facts(total_vram_bytes=16 * hardware.GIB, free_vram_bytes=2 * hardware.GIB)])
        backend = CountingBackend(hardware.HardwareConfig(required_workspace_gib=6), torch_module=torch)
        self.assert_code('insufficient_vram', backend.preflight)
        self.assertEqual(backend.bf16_probes, [])
        result = backend.preflight(reclaimable_vram_bytes=8 * hardware.GIB)
        self.assertEqual(result.free_vram_bytes, 2 * hardware.GIB)
        self.assertEqual(result.reclaimable_vram_bytes, 8 * hardware.GIB)
        self.assertEqual(backend.bf16_probes, ['cuda:0'])
        # A previous explicit allowance never leaks into a later default call.
        self.assert_code('insufficient_vram', backend.preflight)

    def test_invalid_reclaimable_bytes_are_rejected_before_kernel_probes(self):
        backend = CountingBackend(torch_module=FakeTorch())
        self.assert_code('invalid_hardware_facts', lambda: backend.preflight(reclaimable_vram_bytes=5 * hardware.GIB))
        self.assertEqual(backend.bf16_probes, [])

    def test_invalid_memory_telemetry_and_device_mismatch_rejected(self):
        self.assert_code('invalid_hardware_facts', lambda: hardware.validate_hardware(
            facts(free_vram_bytes=-1), hardware.HardwareConfig()))
        self.assert_code('invalid_hardware_facts', lambda: hardware.validate_hardware(
            facts(free_vram_bytes=25 * hardware.GIB), hardware.HardwareConfig()))
        self.assert_code('device_mismatch', lambda: hardware.validate_hardware(
            facts(device_index=1), hardware.HardwareConfig()))

    def test_environment_configuration_is_strict(self):
        config = hardware.HardwareConfig.from_environment({
            'AFTERTAKE_EXECUTION_BACKEND': 'cuda', 'AFTERTAKE_GPU_DEVICE': '1',
            'AFTERTAKE_MEMORY_MODE': 'sequential', 'AFTERTAKE_RESERVE_VRAM_GIB': '2.5',
            'AFTERTAKE_REQUIRED_WORKSPACE_GIB': '6', 'AFTERTAKE_REQUIRE_NATIVE_FP8': '1',
        })
        self.assertEqual(config, hardware.HardwareConfig(device_index=1, memory_mode='sequential',
                         reserve_vram_gib=2.5, required_workspace_gib=6, require_native_fp8=True))
        self.assertEqual(hardware.HardwareConfig.from_environment({}), hardware.HardwareConfig(required_workspace_gib=6))
        cases = [
            ('AFTERTAKE_GPU_DEVICE', '-1', 'invalid_device'),
            ('AFTERTAKE_GPU_DEVICE', '0.0', 'invalid_device'),
            ('AFTERTAKE_MEMORY_MODE', 'lowvram', 'invalid_memory_mode'),
            ('AFTERTAKE_RESERVE_VRAM_GIB', 'oops', 'invalid_memory_budget'),
            ('AFTERTAKE_RESERVE_VRAM_GIB', 'nan', 'invalid_memory_budget'),
            ('AFTERTAKE_REQUIRE_NATIVE_FP8', 'true', 'invalid_precision_requirement'),
            ('AFTERTAKE_EXECUTION_BACKEND', 'cpu', 'unsupported_backend'),
            ('AFTERTAKE_RESERVE_VRAM_GIB', '', 'invalid_environment'),
        ]
        for name, value, code in cases:
            with self.subTest(name=name, value=value):
                self.assert_code(code, lambda: hardware.HardwareConfig.from_environment({name: value}))

    def test_visible_device_map_preserves_order_uuid_and_mig(self):
        self.assertEqual(hardware.visible_device_token(2, {}), '2')
        self.assertEqual(hardware.visible_device_token(1, {'CUDA_VISIBLE_DEVICES': '3, 1'}), '1')
        tokens = 'GPU-a1b2,MIG-GPU-c3d4/1/0,MIG-e5f6'
        self.assertEqual(hardware.visible_device_token(0, {'CUDA_VISIBLE_DEVICES': tokens}), 'GPU-a1b2')
        self.assertEqual(hardware.visible_device_token(1, {'CUDA_VISIBLE_DEVICES': tokens}), 'MIG-GPU-c3d4/1/0')
        self.assertEqual(hardware.visible_device_token(2, {'CUDA_VISIBLE_DEVICES': tokens}), 'MIG-e5f6')

    def test_gpu_remapping_only_returns_overrides_without_mutating_environment(self):
        environment = {'CUDA_VISIBLE_DEVICES': 'GPU-a1b2,GPU-c3d4', 'CUDA_DEVICE_ORDER': 'PCI_BUS_ID', 'OTHER': 'preserved'}
        original = dict(environment)
        self.assertEqual(hardware.selected_device_environment(1, environment), {'CUDA_VISIBLE_DEVICES': 'GPU-c3d4'})
        self.assertEqual(environment, original)

    def test_invalid_or_hidden_device_maps_never_select_another_gpu(self):
        for value in ('', ' ', '-1'):
            self.assert_code('cuda_devices_hidden', lambda: hardware.visible_device_token(0, {'CUDA_VISIBLE_DEVICES': value}))
        for value in ('0,,1', '0,0', 'all', 'GPU-a\nGPU-b', '../0'):
            self.assert_code('invalid_visible_devices', lambda: hardware.visible_device_token(0, {'CUDA_VISIBLE_DEVICES': value}))
        self.assert_code('invalid_device', lambda: hardware.visible_device_token(2, {'CUDA_VISIBLE_DEVICES': '3,1'}))
        for index in (-1, True, '0'):
            self.assert_code('invalid_device', lambda: hardware.visible_device_token(index, {}))

    def test_inspection_uses_selected_gpu_and_excludes_bf16_emulation(self):
        torch = FakeTorch([facts(native_bf16=False), facts(device_index=1, name='selected GPU', device_uuid='GPU-selected')])
        backend = hardware.NvidiaExecutionBackend(hardware.HardwareConfig(device_index=1), torch_module=torch)
        result = backend.validate()
        self.assertEqual(result.name, 'selected GPU')
        self.assertEqual(result.device_index, 1)
        self.assertEqual(result.device_uuid, 'GPU-selected')
        self.assertEqual(torch.cuda.native_bf16_queries, [(1, False)])
        self.assertEqual(torch.cuda.memory_queries, [1])
        self.assertEqual(torch.cuda.selected, 0)

    def test_cpu_only_or_rocm_torch_is_rejected_without_probing(self):
        for torch, code in [(FakeTorch([], cuda=None), 'cuda_runtime_unavailable'),
                            (FakeTorch(hip='7.0'), 'unsupported_backend')]:
            backend = CountingBackend(torch_module=torch)
            self.assert_code(code, backend.preflight)
            self.assertEqual(backend.bf16_probes, [])

    def test_missing_runtime_import_raises_configuration_error(self):
        with patch.object(hardware.importlib, 'import_module', side_effect=ImportError('fixture missing torch')):
            self.assert_code('cuda_runtime_unavailable', hardware.NvidiaExecutionBackend().inspect)

    def test_driver_initialization_errors_are_configuration_errors(self):
        for call in ('is_available', 'device_count', 'mem_get_info'):
            with self.subTest(call=call):
                torch = FakeTorch()
                with patch.object(torch.cuda, call, side_effect=RuntimeError('fixture: driver initialization failed')):
                    self.assert_code('cuda_inspection_failed', lambda: hardware.NvidiaExecutionBackend(torch_module=torch).inspect())

    def test_memory_rejection_happens_before_any_kernel_allocation(self):
        backend = CountingBackend(torch_module=FakeTorch([facts(free_vram_bytes=2 * hardware.GIB)]))
        self.assert_code('insufficient_vram', backend.preflight)
        self.assertEqual(backend.bf16_probes, [])
        self.assertEqual(backend.fp8_probes, [])

    def test_native_fp8_rejection_happens_before_any_kernel_allocation(self):
        backend = CountingBackend(hardware.HardwareConfig(require_native_fp8=True), torch_module=FakeTorch())
        self.assert_code('native_fp8_required', backend.preflight)
        self.assertEqual(backend.bf16_probes, [])
        self.assertEqual(backend.fp8_probes, [])

    def test_kernel_probe_is_cached_but_memory_telemetry_is_refreshed(self):
        torch = FakeTorch()
        backend = CountingBackend(torch_module=torch)
        first = backend.preflight()
        second = backend.preflight()
        self.assertEqual(first.kernel_probes, ('bf16-matmul-and-optimized-sdpa',))
        self.assertEqual(second.kernel_probes, first.kernel_probes)
        self.assertEqual(backend.bf16_probes, ['cuda:0'])
        self.assertEqual(torch.cuda.memory_queries, [0, 0, 0, 0])
        torch.cuda.devices[0] = facts(free_vram_bytes=hardware.GIB)
        self.assert_code('insufficient_vram', backend.preflight)
        self.assertEqual(backend.bf16_probes, ['cuda:0'])

    def test_kernel_initialization_cannot_leave_a_stale_memory_admission(self):
        torch = FakeTorch()
        backend = CountingBackend(torch_module=torch)

        def consume_workspace(_torch, _device):
            torch.cuda.devices[0] = facts(free_vram_bytes=hardware.GIB)

        with patch.object(backend, '_run_bf16_probe', side_effect=consume_workspace):
            self.assert_code('insufficient_vram', backend.preflight)
        self.assertEqual(torch.cuda.memory_queries, [0, 0])

    def test_probe_cache_is_per_selected_device(self):
        torch = FakeTorch([facts(), facts(device_index=1, device_uuid='GPU-second')])
        first = CountingBackend(torch_module=torch)
        second = CountingBackend(hardware.HardwareConfig(device_index=1), torch_module=torch)
        first.preflight()
        second.preflight()
        self.assertEqual(first.bf16_probes, ['cuda:0'])
        self.assertEqual(second.bf16_probes, ['cuda:1'])

    def test_fp8_is_probed_only_when_explicitly_required(self):
        torch = FakeTorch([facts(compute_capability=(8, 9), native_fp8=True)])
        basic = CountingBackend(torch_module=torch)
        basic.preflight()
        self.assertEqual(basic.fp8_probes, [])
        fp8 = CountingBackend(hardware.HardwareConfig(require_native_fp8=True), torch_module=torch)
        self.assertEqual(fp8.preflight().kernel_probes, ('bf16-matmul-and-optimized-sdpa', 'native-fp8-scaled-matmul'))
        fp8.preflight()
        self.assertEqual(fp8.bf16_probes, [])
        self.assertEqual(fp8.fp8_probes, ['cuda:0'])

    def test_kernel_probe_failure_is_explicit_and_not_cached_as_success(self):
        backend = CountingBackend(torch_module=FakeTorch(), fail_probe=True)
        message = self.assert_code('cuda_kernel_probe_failed', backend.preflight)
        self.assertIn('No CPU or FP32 fallback was attempted', message)
        backend.fail_probe = False
        backend.preflight()
        self.assertEqual(backend.bf16_probes, ['cuda:0', 'cuda:0'])

    def test_probe_rejects_unexpected_execution_dtype_or_device(self):
        backend = hardware.NvidiaExecutionBackend(torch_module=FakeTorch())
        torch = SimpleNamespace(bfloat16='bf16')
        with self.assertRaises(RuntimeError):
            backend._check_result(SimpleNamespace(dtype='float32', device=SimpleNamespace(type='cuda')), torch, 'fixture')
        with self.assertRaises(RuntimeError):
            backend._check_result(SimpleNamespace(dtype='bf16', device=SimpleNamespace(type='cpu')), torch, 'fixture')

    def test_direct_attention_probe_never_uses_global_sdpa_context_or_setters(self):
        torch, operators, forbidden = operator_probe_torch()
        backend = hardware.NvidiaExecutionBackend(torch_module=torch)
        backend._run_bf16_probe(torch, 'cuda:0')
        operators._scaled_dot_product_flash_attention.default.assert_called_once()
        operators._scaled_dot_product_efficient_attention.default.assert_not_called()
        forbidden.assert_not_called()
        self.assertTrue(all(call.kwargs['dtype'] == 'bf16' and call.kwargs['device'] == 'cuda:0'
                            for call in torch.ones.call_args_list))

    def test_direct_probe_can_use_another_compiled_optimized_cuda_operator(self):
        for available in ('efficient', 'cudnn'):
            with self.subTest(available=available):
                torch, operators, forbidden = operator_probe_torch()
                operators._scaled_dot_product_flash_attention.default.side_effect = RuntimeError('Not compiled.')
                if available == 'cudnn':
                    operators._scaled_dot_product_efficient_attention.default.side_effect = RuntimeError('Not supported.')
                backend = hardware.NvidiaExecutionBackend(torch_module=torch)
                self.assertEqual(backend._run_optimized_sdpa_probe(torch, ProbeTensor()), available)
                forbidden.assert_not_called()

    def test_direct_probe_fails_without_optimized_cuda_kernels_instead_of_math_fallback(self):
        torch, operators, forbidden = operator_probe_torch()
        for operator in vars(operators).values():
            operator.default.side_effect = RuntimeError()
        backend = hardware.NvidiaExecutionBackend(torch_module=torch)
        with self.assertRaisesRegex(RuntimeError, 'No compiled optimized BF16 CUDA attention operator'):
            backend._run_optimized_sdpa_probe(torch, ProbeTensor())
        forbidden.assert_not_called()

    def test_direct_probe_rejects_wrong_device_or_values_without_trying_another_backend(self):
        for result in (ProbeTensor(device_index=1), ProbeTensor(value=0)):
            with self.subTest(device=result.device.index, value=result.value):
                torch, operators, forbidden = operator_probe_torch()
                operators._scaled_dot_product_flash_attention.default.return_value = (result,)
                backend = hardware.NvidiaExecutionBackend(torch_module=torch)
                with self.assertRaises(RuntimeError):
                    backend._run_optimized_sdpa_probe(torch, ProbeTensor())
                operators._scaled_dot_product_efficient_attention.default.assert_not_called()
                forbidden.assert_not_called()

    def preflight_report(self, **fact_overrides):
        value = facts(kernel_probes=('bf16-matmul-and-optimized-sdpa',), **fact_overrides)
        return json.loads(json.dumps({
            'format': 'aftertake-hardware-preflight/1', 'ready': True, 'facts': value.as_dict(),
            'cpuInference': False, 'float32Fallback': False, 'modelWeightsAllocated': False,
        }))

    def test_preflight_report_reconstructs_facts_without_mutating_json(self):
        report = self.preflight_report()
        original = json.dumps(report)
        result = hardware.validate_preflight_report(report, hardware.HardwareConfig())
        self.assertEqual(result.compute_capability, (8, 6))
        self.assertEqual(result.kernel_probes, ('bf16-matmul-and-optimized-sdpa',))
        self.assertEqual(json.dumps(report), original)

    def test_preflight_failure_preserves_actionable_configuration_error(self):
        report = {'format': 'aftertake-hardware-preflight/1', 'ready': False,
                  'code': 'native_bf16_required', 'error': 'Fixture GPU has no native BF16.'}
        message = self.assert_code('native_bf16_required', lambda: hardware.validate_preflight_report(
            report, hardware.HardwareConfig()))
        self.assertEqual(message, report['error'])

    def test_malformed_or_incomplete_preflight_report_cannot_admit_generation(self):
        invalid = [None, [], 'ready', {'ready': True}, {'format': 'other-format', 'ready': True}]
        for ready in (None, 'true', 1):
            report = self.preflight_report()
            report['ready'] = ready
            invalid.append(report)
        for flag in ('cpuInference', 'float32Fallback', 'modelWeightsAllocated'):
            for value in (True, 'false', 0, None):
                report = self.preflight_report()
                report[flag] = value
                invalid.append(report)
        for change in ({'compute_capability': '8.6'}, {'kernel_probes': 'bf16-matmul-and-optimized-sdpa'},
                       {'kernel_probes': []}, {'kernel_probes': [1]}, {'unknown': True}):
            report = self.preflight_report()
            report['facts'].update(change)
            invalid.append(report)
        for report in invalid:
            with self.subTest(report=report):
                self.assert_code('invalid_preflight_report', lambda: hardware.validate_preflight_report(
                    report, hardware.HardwareConfig()))

    def test_preflight_report_revalidates_memory_native_precision_and_fp8_probe(self):
        for overrides, code in (({'free_vram_bytes': 1}, 'insufficient_vram'),
                                ({'native_bf16': False}, 'native_bf16_required'),
                                ({'native_bf16': 'false'}, 'invalid_hardware_facts')):
            report = self.preflight_report(**overrides)
            self.assert_code(code, lambda: hardware.validate_preflight_report(report, hardware.HardwareConfig()))
        report = self.preflight_report(compute_capability=(8, 9), native_fp8=True)
        self.assert_code('invalid_preflight_report', lambda: hardware.validate_preflight_report(
            report, hardware.HardwareConfig(require_native_fp8=True)))
        report['facts']['kernel_probes'].append('native-fp8-scaled-matmul')
        self.assertTrue(hardware.validate_preflight_report(
            report, hardware.HardwareConfig(require_native_fp8=True)).native_fp8)

    def test_standalone_report_cannot_claim_native_engine_model_residency(self):
        report = self.preflight_report(free_vram_bytes=2 * hardware.GIB, reclaimable_vram_bytes=8 * hardware.GIB)
        self.assert_code('invalid_preflight_report', lambda: hardware.validate_preflight_report(
            report, hardware.HardwareConfig(required_workspace_gib=6)))


if __name__ == '__main__':
    unittest.main()
