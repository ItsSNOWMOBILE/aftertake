"""CPU-only launch contracts: no subprocess, package install, model or GPU runs."""
from contextlib import ExitStack, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
with (patch.object(sys, 'path', [str(ROOT / 'scripts'), *sys.path]),
      patch('subprocess.run', side_effect=AssertionError('Import must not run a process.')),
      patch('subprocess.Popen', side_effect=AssertionError('Import must not launch a child.')),
      patch('shutil.copytree', side_effect=AssertionError('Import must not copy node files.'))):
    SPEC = importlib.util.spec_from_file_location('aftertake_engine_launch_tests', ROOT / 'scripts/engine.py')
    engine = importlib.util.module_from_spec(SPEC)
    sys.modules[SPEC.name] = engine
    SPEC.loader.exec_module(engine)
    CHECK_SPEC = importlib.util.spec_from_file_location('aftertake_hardware_check_tests', ROOT / 'scripts/hardware-check.py')
    hardware_check = importlib.util.module_from_spec(CHECK_SPEC)
    sys.modules[CHECK_SPEC.name] = hardware_check
    CHECK_SPEC.loader.exec_module(hardware_check)
    from hardware import HardwareFacts


GIB = 1024 ** 3
UNSAFE_FLAGS = {
    '--cpu', '--cpu-vae', '--force-fp32', '--force-fp16', '--fp32-unet', '--fp32-vae',
    '--fp32-text-enc', '--fp16-unet', '--bf16-unet', '--fp8_e4m3fn-unet', '--fp8_e5m2-unet',
    '--fp8_e8m0fnu-unet', '--fp8_e4m3fn-text-enc', '--fp8_e5m2-text-enc', '--supports-fp8-compute',
    '--lowvram', '--novram', '--disable-dynamic-vram', '--disable-async-offload',
    '--use-split-cross-attention', '--use-quad-cross-attention', '--use-pytorch-cross-attention',
    '--use-flash-attention', '--use-sage-attention', '--disable-xformers', '--highvram', '--gpu-only',
}


def ready_report(total_vram_bytes=16 * GIB):
    facts = HardwareFacts(
        backend='cuda', name='CUDA fixture GPU', device_index=0,
        total_vram_bytes=total_vram_bytes, free_vram_bytes=min(12 * GIB, total_vram_bytes - GIB),
        compute_capability=(8, 6), native_bf16=True, native_fp8=False,
        cuda_version='13.0', torch_version='2.11.0+cu130',
        kernel_probes=('bf16-matmul-and-optimized-sdpa',),
    )
    return {
        'format': 'aftertake-hardware-preflight/1', 'ready': True,
        'facts': facts.as_dict(),
        'modelWeightsAllocated': False, 'cpuInference': False, 'float32Fallback': False,
    }


class StoppedProcess:
    def __init__(self):
        self.returncode = 0
        self.terminated = False
        self.waited = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        self.waited = True
        return self.returncode

    def kill(self):
        raise AssertionError('A stopped fixture child must not be killed.')


class EngineLaunchTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory(prefix='aftertake-engine-launch-'))
        self.root = Path(directory)
        self.runtime = self.root / '.runtime'
        self.python = self.runtime / 'venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
        self.python.parent.mkdir(parents=True)
        self.python.touch()
        self.events = []
        self.probes = []
        self.children = []
        self.report = ready_report()
        self.probe_returncode = 0
        self.probe_stdout = None
        self.output = self.stack.enter_context(redirect_stdout(io.StringIO()))
        self.environment = {'PATH': 'fixture-path', 'CUDA_VISIBLE_DEVICES': 'GPU-first,GPU-second', 'UNCHANGED': 'yes'}
        self.stack.enter_context(patch.dict(os.environ, self.environment, clear=True))
        self.stack.enter_context(patch.multiple(engine, ROOT=self.root, RUNTIME=self.runtime, PYTHON=self.python))
        self.live = self.stack.enter_context(patch.object(engine, 'live', return_value=False))
        self.models = self.stack.enter_context(patch.object(engine, 'model_root', side_effect=self.resolve_models))
        self.extra = self.stack.enter_context(patch.object(engine, 'extra_model_config', side_effect=self.resolve_extra))
        self.copy = self.stack.enter_context(patch.object(engine.shutil, 'copytree', side_effect=self.copy_nodes))
        self.run = self.stack.enter_context(patch.object(engine.subprocess, 'run', side_effect=self.run_preflight))
        self.popen = self.stack.enter_context(patch.object(engine.subprocess, 'Popen', side_effect=self.launch_child))
        self.sleep = self.stack.enter_context(patch.object(engine.time, 'sleep', side_effect=AssertionError('No fixture polling sleep expected.')))

    def resolve_models(self, requested):
        self.events.append('model-paths')
        return self.runtime / 'ComfyUI/models'

    def resolve_extra(self, models):
        self.events.append('extra-model-config')
        return self.root / 'extra-model-paths.yaml'

    def copy_nodes(self, *args, **kwargs):
        self.events.append('copy-nodes')

    def run_preflight(self, command, **kwargs):
        self.events.append('preflight')
        self.probes.append((list(command), {**kwargs, 'env': dict(kwargs['env'])}))
        return SimpleNamespace(
            returncode=self.probe_returncode,
            stdout=json.dumps(self.report) if self.probe_stdout is None else self.probe_stdout,
            stderr='fixture preflight diagnostic',
        )

    def launch_child(self, command, **kwargs):
        self.events.append('launch-child')
        child = StoppedProcess()
        self.children.append((list(command), {**kwargs, 'env': dict(kwargs['env'])}, child))
        return child

    def assert_no_mutation_or_launch(self):
        self.models.assert_not_called()
        self.extra.assert_not_called()
        self.copy.assert_not_called()
        self.popen.assert_not_called()
        self.assertEqual(self.children, [])

    def test_probe_uses_venv_before_model_paths_node_copy_or_children(self):
        self.assertEqual(engine.main([]), 0)
        self.assertEqual(self.events, ['preflight', 'model-paths', 'copy-nodes', 'launch-child', 'launch-child'])
        command, options = self.probes[0]
        self.assertEqual(command, [str(self.python), str(self.root / 'scripts/hardware-check.py'), '--json'])
        self.assertEqual(options['cwd'], self.root)
        self.assertTrue(options['capture_output'])
        self.assertTrue(options['text'])
        self.assertEqual(options['encoding'], 'utf-8')
        self.assertGreater(options['timeout'], 0)
        self.assertLessEqual(options['timeout'], 120)
        self.assertEqual(self.children[0][0][:2], [str(self.python), str(self.runtime / 'ComfyUI/main.py')])
        self.assertTrue(all(child.waited for _, _, child in self.children))

    def test_selected_visible_gpu_maps_identically_in_probe_comfy_and_proxy(self):
        self.assertEqual(engine.main(['--gpu-index', '1']), 0)
        expected = self.probes[0][1]['env']
        self.assertEqual(expected['CUDA_VISIBLE_DEVICES'], 'GPU-second')
        self.assertEqual(expected['AFTERTAKE_GPU_DEVICE'], '0')
        self.assertEqual(expected['UNCHANGED'], 'yes')
        for _, options, _ in self.children:
            self.assertEqual(options['env'], expected)
        self.assertEqual(dict(os.environ), self.environment)

    def test_existing_ordinal_and_mig_maps_are_preserved(self):
        for mapping, selected in [('3,1', '1'), ('GPU-first,MIG-GPU-second/2/0', 'MIG-GPU-second/2/0')]:
            with self.subTest(mapping=mapping):
                os.environ['CUDA_VISIBLE_DEVICES'] = mapping
                self.assertEqual(engine.main(['--gpu-index', '1', '--check-only']), 0)
                self.assertEqual(self.probes[-1][1]['env']['CUDA_VISIBLE_DEVICES'], selected)
        self.assert_no_mutation_or_launch()

    def test_hidden_or_unavailable_visible_gpu_does_not_launch_or_probe(self):
        for mapping in ('', '-1', 'GPU-first'):
            with self.subTest(mapping=mapping):
                os.environ['CUDA_VISIBLE_DEVICES'] = mapping
                with self.assertRaises(SystemExit) as captured:
                    engine.main(['--gpu-index', '1'])
                self.assertIn('Hardware configuration error', str(captured.exception))
        self.run.assert_not_called()
        self.assert_no_mutation_or_launch()

    def test_constrained_vram_uses_only_native_residency_flags(self):
        for capacity in (12, 16):
            with self.subTest(capacity=capacity):
                self.report = ready_report(capacity * GIB)
                self.assertEqual(engine.main([]), 0)
                command = self.children[-2][0]
                self.assertIn('--disable-smart-memory', command)
                self.assertIn('--cache-none', command)
                self.assertFalse(UNSAFE_FLAGS.intersection(command))
                self.assertNotIn('--disable-fast-disk', command)
                self.assertNotIn('--async-offload', command)
                self.assertNotIn('AFTERTAKE_SAFE_WEIGHT_COPIES', self.children[-2][1]['env'])

    def test_larger_gpu_keeps_balanced_native_defaults(self):
        self.report = ready_report(24 * GIB)
        self.assertEqual(engine.main([]), 0)
        command = self.children[0][0]
        self.assertNotIn('--disable-smart-memory', command)
        self.assertNotIn('--cache-none', command)
        self.assertNotIn('--async-offload', command)
        self.assertFalse(UNSAFE_FLAGS.intersection(command))

    def test_explicit_balanced_mode_is_respected_on_small_gpu(self):
        self.assertEqual(engine.main(['--memory-mode', 'balanced']), 0)
        command = self.children[0][0]
        self.assertNotIn('--disable-smart-memory', command)
        self.assertNotIn('--cache-none', command)
        self.assertEqual(self.probes[0][1]['env']['AFTERTAKE_MEMORY_MODE'], 'balanced')

    def test_safe_weight_copies_require_explicit_configuration(self):
        self.assertEqual(engine.main(['--safe-weight-copies']), 0)
        command, options, _ = self.children[0]
        self.assertIn('--disable-fast-disk', command)
        self.assertEqual(command[command.index('--async-offload') + 1], '1')
        self.assertEqual(options['env']['AFTERTAKE_SAFE_WEIGHT_COPIES'], '1')
        self.assertFalse(UNSAFE_FLAGS.intersection(command))

    def test_explicit_safe_copy_environment_is_shared_with_probe_and_children(self):
        os.environ['AFTERTAKE_SAFE_WEIGHT_COPIES'] = '1'
        self.assertEqual(engine.main([]), 0)
        self.assertEqual(self.probes[0][1]['env']['AFTERTAKE_SAFE_WEIGHT_COPIES'], '1')
        for command, options, _ in self.children:
            self.assertEqual(options['env']['AFTERTAKE_SAFE_WEIGHT_COPIES'], '1')
        self.assertIn('--disable-fast-disk', self.children[0][0])

    def test_explicit_workspace_headroom_and_fp8_reach_preflight(self):
        self.report['facts'].update(compute_capability=(8, 9), native_fp8=True,
                                    kernel_probes=('bf16-matmul-and-optimized-sdpa', 'native-fp8-scaled-matmul'))
        self.assertEqual(engine.main(['--reserve-vram', '2.5', '--workspace-vram', '4', '--require-native-fp8']), 0)
        environment = self.probes[0][1]['env']
        self.assertEqual(environment['AFTERTAKE_RESERVE_VRAM_GIB'], '2.5')
        self.assertEqual(environment['AFTERTAKE_REQUIRED_WORKSPACE_GIB'], '4.0')
        self.assertEqual(environment['AFTERTAKE_REQUIRE_NATIVE_FP8'], '1')
        command = self.children[0][0]
        self.assertEqual(command[command.index('--reserve-vram') + 1], '2.5')
        self.assertFalse(UNSAFE_FLAGS.intersection(command))

    def test_check_only_is_read_only_even_with_models_directory_argument(self):
        self.assertEqual(engine.main(['--check-only', '--models-dir', str(self.root / 'external-models')]), 0)
        self.assertEqual(self.events, ['preflight'])
        self.assert_no_mutation_or_launch()
        self.live.assert_not_called()
        self.assertFalse((self.root / 'external-models').exists())
        self.assertTrue(json.loads(self.output.getvalue())['ready'])

    def test_failed_preflight_never_writes_models_copies_nodes_or_launches(self):
        self.report = {'format': 'aftertake-hardware-preflight/1', 'ready': False,
                       'code': 'native_bf16_required', 'error': 'Native BF16 is required.'}
        self.probe_returncode = 2
        with self.assertRaises(SystemExit) as captured:
            engine.main([])
        self.assertIn('native_bf16_required', str(captured.exception))
        self.assert_no_mutation_or_launch()

    def test_nonzero_probe_exit_cannot_be_overridden_by_ready_json(self):
        self.probe_returncode = 2
        with self.assertRaises(SystemExit):
            engine.main([])
        self.assert_no_mutation_or_launch()

    def test_malformed_probe_json_never_launches(self):
        self.probe_stdout = 'fixture: CUDA could not initialize'
        with self.assertRaises(SystemExit) as captured:
            engine.main([])
        self.assertIn('preflight', str(captured.exception).lower())
        self.assert_no_mutation_or_launch()

    def test_preflight_runtime_error_or_timeout_never_launches(self):
        for error in (OSError('fixture: runtime cannot start'), engine.subprocess.TimeoutExpired('fixture', 120)):
            with self.subTest(error=type(error).__name__):
                self.run.side_effect = error
                with self.assertRaises(SystemExit) as captured:
                    engine.main([])
                self.assertIn('preflight', str(captured.exception).lower())
                self.assert_no_mutation_or_launch()

    def test_unexpected_report_shapes_never_launch(self):
        for report in (None, [], 'ready', {'ready': True},
                       {'format': 'other-format', 'ready': True},
                       {'format': 'aftertake-hardware-preflight/1', 'ready': 'true'}):
            with self.subTest(report=report):
                self.report = report
                with self.assertRaises(SystemExit):
                    engine.main([])
                self.assert_no_mutation_or_launch()

    def test_missing_malformed_or_incompatible_hardware_facts_never_launch(self):
        changes = [
            {'total_vram_bytes': -1}, {'total_vram_bytes': '16'}, {'device_index': 1},
            {'free_vram_bytes': GIB}, {'native_bf16': False}, {'native_bf16': 'false'},
            {'compute_capability': [7, 5]}, {'kernel_probes': []},
            {'free_vram_bytes': 2 * GIB, 'reclaimable_vram_bytes': 8 * GIB},
        ]
        for change in changes:
            with self.subTest(change=change):
                self.report = ready_report()
                self.report['facts'].update(change)
                with self.assertRaises(SystemExit):
                    engine.main([])
                self.assert_no_mutation_or_launch()
        self.report = ready_report()
        del self.report['facts']
        with self.assertRaises(SystemExit):
            engine.main([])
        self.assert_no_mutation_or_launch()

    def test_fallback_or_unprobed_fp8_reports_cannot_launch(self):
        for override in ({'cpuInference': True}, {'float32Fallback': True}):
            with self.subTest(override=override):
                self.report = ready_report()
                self.report.update(override)
                with self.assertRaises(SystemExit):
                    engine.main([])
                self.assert_no_mutation_or_launch()
        self.report = ready_report()
        self.report['facts'].update(compute_capability=(8, 9), native_fp8=True)
        with self.assertRaises(SystemExit):
            engine.main(['--require-native-fp8'])
        self.assert_no_mutation_or_launch()

    def test_no_cache_flag_is_not_duplicated(self):
        self.assertEqual(engine.main(['--no-node-cache']), 0)
        self.assertEqual(self.children[0][0].count('--cache-none'), 1)

    def test_missing_venv_rejects_before_preflight_or_launch(self):
        self.python.unlink()
        with self.assertRaises(SystemExit) as captured:
            engine.main([])
        self.assertIn('setup.py', str(captured.exception))
        self.run.assert_not_called()
        self.assert_no_mutation_or_launch()

    def test_existing_owner_engine_is_not_disturbed(self):
        self.live.return_value = True
        with self.assertRaises(SystemExit) as captured:
            engine.main([])
        self.assertIn('already uses ports', str(captured.exception))
        self.run.assert_not_called()
        self.assert_no_mutation_or_launch()

    def test_ffmpeg_directory_only_affects_probe_and_child_environment(self):
        tools = self.root / 'ffmpeg bin'
        tools.mkdir()
        suffix = '.exe' if sys.platform == 'win32' else ''
        for name in ('ffmpeg', 'ffprobe'):
            (tools / (name + suffix)).touch()
        self.assertEqual(engine.main(['--ffmpeg-bin', str(tools)]), 0)
        expected_path = str(tools.resolve()) + os.pathsep + self.environment['PATH']
        self.assertEqual(self.probes[0][1]['env']['PATH'], expected_path)
        self.assertTrue(all(options['env']['PATH'] == expected_path for _, options, _ in self.children))
        self.assertEqual(os.environ['PATH'], self.environment['PATH'])

    def test_launch_does_not_mutate_workflow_or_profile_sources(self):
        paths = [*sorted((ROOT / 'server').glob('*workflow.ts')),
                 ROOT / 'scripts/character-workflow.py', *sorted((ROOT / 'docs').glob('models-*.json'))]
        before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
        self.assertEqual(engine.main([]), 0)
        after = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
        self.assertEqual(before, after)
        self.assertEqual(len(self.probes), 1)
        self.assertEqual(len(self.children), 2)
        self.copy.assert_called_once_with(
            self.root / 'custom_nodes/aftertake', self.runtime / 'ComfyUI/custom_nodes/aftertake', dirs_exist_ok=True)


class HardwareCheckCliTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {'CUDA_VISIBLE_DEVICES': '3,GPU-selected'}, clear=True))
        self.output = self.stack.enter_context(redirect_stdout(io.StringIO()))
        self.backend_type = self.stack.enter_context(patch.object(hardware_check, 'NvidiaExecutionBackend'))
        self.backend = self.backend_type.return_value
        self.backend.preflight.return_value = HardwareFacts(
            backend='cuda', device_index=0, name='GPU fixture', total_vram_bytes=16 * GIB,
            free_vram_bytes=12 * GIB, compute_capability=(8, 6), native_bf16=True, native_fp8=False,
            kernel_probes=('bf16-matmul-and-optimized-sdpa',),
        )

    def test_cli_remaps_before_backend_construction_without_model_loading(self):
        self.assertEqual(hardware_check.main(['--gpu-index', '1', '--json']), 0)
        config = self.backend_type.call_args.args[0]
        self.assertEqual(config.device_index, 0)
        self.assertEqual(config.required_workspace_gib, 6)
        self.backend.preflight.assert_called_once_with()
        report = json.loads(self.output.getvalue())
        self.assertEqual(report['selectedDevice'], 'GPU-selected')
        self.assertFalse(report['modelWeightsAllocated'])
        self.assertFalse(report['cpuInference'])
        self.assertFalse(report['float32Fallback'])
        self.assertFalse(report['memoryFitGuaranteed'])
        self.assertEqual(report['memoryPolicy']['effective_mode'], 'sequential')
        self.assertFalse(UNSAFE_FLAGS.intersection(report['memoryPolicy']['comfy_args']))

    def test_cli_configuration_failure_is_json_and_never_constructs_backend(self):
        self.assertEqual(hardware_check.main(['--gpu-index', '2', '--json']), 2)
        report = json.loads(self.output.getvalue())
        self.assertFalse(report['ready'])
        self.assertEqual(report['code'], 'invalid_device')
        self.backend_type.assert_not_called()

    def test_cli_native_kernel_failure_is_explicit_without_fallback(self):
        self.backend.preflight.side_effect = hardware_check.HardwareConfigurationError(
            'cuda_kernel_probe_failed', 'Fixture compiled CUDA kernel is unavailable.')
        self.assertEqual(hardware_check.main(['--json']), 2)
        report = json.loads(self.output.getvalue())
        self.assertFalse(report['ready'])
        self.assertEqual(report['code'], 'cuda_kernel_probe_failed')
        self.assertFalse(report['modelWeightsAllocated'])
        self.assertFalse(report['cpuInference'])
        self.assertFalse(report['float32Fallback'])


if __name__ == '__main__':
    unittest.main()
