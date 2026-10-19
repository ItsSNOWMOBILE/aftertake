"""Admission and metadata tests; no model loading or GPU inference."""
import asyncio
from dataclasses import replace
import importlib.util
import inspect
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_runtime_tests', ROOT / 'custom_nodes/aftertake/__init__.py')
nodes = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = nodes
spec.loader.exec_module(nodes)
character = sys.modules[spec.name + '.character_nodes']
hardware = importlib.import_module(spec.name + '.hardware')
GIB = 1024 ** 3


def facts(free=12 * GIB):
    return hardware.HardwareFacts(backend='cuda', device_index=0, name='Synthetic CUDA device',
        total_vram_bytes=16 * GIB, free_vram_bytes=free, compute_capability=(8, 6),
        native_bf16=True, native_fp8=False, torch_version='test', cuda_version='test',
        kernel_probes=('bf16-matmul-and-optimized-sdpa',))


def native_management():
    return types.SimpleNamespace(current_loaded_models=[], DISABLE_SMART_MEMORY=True,
        args=types.SimpleNamespace(cache_none=True, gpu_only=False, highvram=False),
        VRAMState=types.SimpleNamespace(HIGH_VRAM='high', NORMAL_VRAM='normal'), vram_state='normal',
        intermediate_device=lambda: torch.device('cpu'))


class RuntimeHardwareTests(unittest.TestCase):
    def test_native_output_signatures_are_unchanged_and_validation_uses_only_json(self):
        self.assertEqual(set(nodes.AftertakeSaveVideo.INPUT_TYPES()['required']),
            {'images', 'fps', 'filename_prefix', 'recipe_json'})
        self.assertEqual(set(character.AftertakeSaveCharacterSelection.INPUT_TYPES()['required']),
            {'images', 'masks', 'filename_prefix', 'request_json'})
        self.assertEqual(nodes.AftertakeSaveVideo.RETURN_TYPES, ())
        self.assertEqual(character.AftertakeSaveCharacterSelection.RETURN_TYPES, ())
        self.assertEqual(list(inspect.signature(nodes.AftertakeSaveVideo.VALIDATE_INPUTS).parameters), ['recipe_json'])
        self.assertEqual(list(inspect.signature(character.AftertakeSaveCharacterSelection.VALIDATE_INPUTS).parameters), ['request_json'])
        self.assertEqual(set(character.AftertakeRuntimeInfo.INPUT_TYPES()['required']),
            {'weight_copy_backend', 'ffmpeg_tools'})

    def test_generation_validation_blocks_before_outputs_run_and_keeps_exact_profile(self):
        cases = [
            ({'format': 'aftertake/1'}, 'structure'),
            ({'format': 'aftertake/1', 'pipeline': 'inpaint'}, 'inpaint'),
            ({'format': 'aftertake/1', 'pipeline': 'cinema', 'cinema': {'guidance': 'tracks'}}, 'motion'),
            ({'format': 'aftertake-text-video/1'}, 'text-video'),
            ({'format': 'aftertake-character-output/1'}, 'character-swap'),
        ]
        blocked = {'ready': False, 'checks': [{'state': 'blocked', 'message': 'CUDA BF16 is required.'}]}
        with patch.object(character, 'runtime_hardware_report', return_value=blocked) as report:
            with patch.object(nodes.AftertakeSaveVideo, 'execute', side_effect=AssertionError('Output must not execute')):
                for recipe, profile in cases:
                    self.assertEqual(nodes.AftertakeSaveVideo.VALIDATE_INPUTS(json.dumps(recipe)), 'CUDA BF16 is required.')
                    report.assert_called_with(profile)
            self.assertEqual(character.AftertakeSaveCharacterSelection.VALIDATE_INPUTS(
                '{"format":"aftertake-character-selection/1"}'), 'CUDA BF16 is required.')
            report.assert_called_with('character-selection')
        with patch.object(character, 'runtime_hardware_report', return_value={'ready': True}):
            self.assertIs(nodes.AftertakeSaveVideo.VALIDATE_INPUTS('{"format":"aftertake/1"}'), True)

    def test_cpu_media_and_existing_frame_composites_do_not_request_generation_hardware(self):
        with patch.object(character, 'runtime_hardware_report', side_effect=AssertionError('No inference preflight for CPU media')):
            for recipe in [{}, {'format': 'aftertake-film/2'},
                    {'format': 'aftertake/1', 'pipeline': 'motion-transfer', 'transfer': {'finish': {'generation': 'existing'}}}]:
                self.assertIs(nodes.AftertakeSaveVideo.VALIDATE_INPUTS(json.dumps(recipe)), True)
            self.assertIs(character.AftertakeSaveCharacterSelection.VALIDATE_INPUTS('{}'), True)
        for invalid in ['{', 'null', '[]', '"private contents"']:
            result = nodes.AftertakeSaveVideo.VALIDATE_INPUTS(invalid)
            self.assertIsInstance(result, str)
            self.assertNotIn('private contents', result)

    def test_comfy_selected_device_and_forced_precision_flags_cannot_bypass_cuda_policy(self):
        comfy = types.ModuleType('comfy')
        management = types.ModuleType('comfy.model_management')
        cli = types.ModuleType('comfy.cli_args')
        comfy.model_management = management
        config = hardware.HardwareConfig()
        with patch.dict(sys.modules, {'comfy': comfy, 'comfy.model_management': management, 'comfy.cli_args': cli}):
            cli.args = types.SimpleNamespace()
            for device in [torch.device('cpu'), torch.device('cuda:1')]:
                management.get_torch_device = lambda: device
                with self.assertRaises(hardware.HardwareConfigurationError):
                    character._runtime_device_policy(config)
            management.get_torch_device = lambda: torch.device('cuda:0')
            management.vae_device = lambda: torch.device('cuda:0')
            management.text_encoder_device = lambda: torch.device('cuda:0')
            self.assertEqual(character._runtime_device_policy(config), (management, torch.device('cuda:0')))
            for flag in ['force_fp32', 'fp32_unet', 'fp32_text_enc', 'fp32_vae']:
                cli.args = types.SimpleNamespace(**{flag: True})
                with self.assertRaises(hardware.HardwareConfigurationError):
                    character._runtime_device_policy(config)

    def test_cpu_stage_overrides_are_feature_aware_and_cpu_offload_is_allowed(self):
        comfy = types.ModuleType('comfy')
        management = types.ModuleType('comfy.model_management')
        cli = types.ModuleType('comfy.cli_args')
        comfy.model_management = management
        config = hardware.HardwareConfig()
        management.get_torch_device = lambda: torch.device('cuda:0')
        management.vae_device = lambda: torch.device('cpu') if cli.args.cpu_vae else torch.device('cuda:0')
        management.text_encoder_device = lambda: torch.device('cpu') if cli.args.novram else torch.device('cuda:0')
        management.resolve_gpu_device_option = lambda option: torch.device('cuda:0') if option == 'gpu:0' else None
        # Native CPU weight storage, initial placement and decoded-frame output
        # do not imply that a neural stage executes on the CPU.
        management.unet_offload_device = lambda: torch.device('cpu')
        management.vae_offload_device = lambda: torch.device('cpu')
        management.text_encoder_offload_device = lambda: torch.device('cpu')
        management.intermediate_device = lambda: torch.device('cpu')
        with patch.dict(sys.modules, {'comfy': comfy, 'comfy.model_management': management, 'comfy.cli_args': cli}):
            cli.args = types.SimpleNamespace(cpu_vae=False, novram=False)
            for profile in character.GENERATION_PROFILES:
                self.assertEqual(character._runtime_device_policy(config, profile),
                    (management, torch.device('cuda:0')))
            cli.args.cpu_vae = True
            for profile in character.GENERATION_PROFILES - {'character-selection', 'depth'}:
                with self.assertRaisesRegex(hardware.HardwareConfigurationError, 'VAE'):
                    character._runtime_device_policy(config, profile)
            self.assertEqual(character._runtime_device_policy(config, 'character-selection'),
                (management, torch.device('cuda:0')), 'SAM3 selection has no VAE execution stage.')
            self.assertEqual(character._runtime_device_policy(config, 'depth'),
                (management, torch.device('cuda:0')), 'DA3 depth has no VAE execution stage.')
            cli.args.cpu_vae = False
            cli.args.novram = True
            for profile in character.GENERATION_PROFILES - {'character-swap', 'depth'}:
                with self.assertRaisesRegex(hardware.HardwareConfigurationError, 'text encoder'):
                    character._runtime_device_policy(config, profile)
            self.assertEqual(character._runtime_device_policy(config, 'character-swap'),
                (management, torch.device('cuda:0')), 'H3 uses its explicit native CUDA CLIP selection.')
            cli.args.fp32_text_enc = True
            self.assertEqual(character._runtime_device_policy(config, 'depth'),
                (management, torch.device('cuda:0')), 'DA3 depth has no text encoder execution stage.')

    def test_each_execution_stage_must_match_the_selected_gpu_without_inferred_device_indices(self):
        comfy = types.ModuleType('comfy')
        management = types.ModuleType('comfy.model_management')
        cli = types.ModuleType('comfy.cli_args')
        cli.args = types.SimpleNamespace()
        comfy.model_management = management
        config = hardware.HardwareConfig()
        getters = ['get_torch_device', 'vae_device', 'text_encoder_device']
        with patch.dict(sys.modules, {'comfy': comfy, 'comfy.model_management': management, 'comfy.cli_args': cli}):
            for getter in getters:
                for bad in [torch.device('cuda:1'), torch.device('cuda'), torch.device('cpu')]:
                    for name in getters:
                        setattr(management, name, lambda: torch.device('cuda:0'))
                    setattr(management, getter, lambda: bad)
                    with self.assertRaises(hardware.HardwareConfigurationError):
                        character._runtime_device_policy(config, 'text-video')
            for name in getters:
                setattr(management, name, lambda: torch.device('cuda:0'))
            for bad in [None, torch.device('cuda:1'), torch.device('cpu')]:
                management.resolve_gpu_device_option = lambda option: bad
                with self.assertRaisesRegex(hardware.HardwareConfigurationError, 'H3 reference encoder'):
                    character._runtime_device_policy(config, 'character-swap')

    def test_runtime_capacity_counts_only_idle_residency_and_preserves_raw_free_bytes(self):
        measured = facts(free=2 * GIB)
        config = hardware.HardwareConfig(required_workspace_gib=6)
        model = types.SimpleNamespace(model=object(), load_device=torch.device('cuda:0'))
        loaded = types.SimpleNamespace(model=model, device=torch.device('cuda:0'),
            model_loaded_memory=lambda: 8 * GIB)
        management = native_management()
        management.current_loaded_models = [loaded]
        allowances = []
        class Backend:
            def __init__(self, selected): self.config = selected
            def inspect(self): return measured
            def preflight(self, reclaimable_vram_bytes=0):
                allowances.append(reclaimable_vram_bytes)
                return hardware.validate_hardware(replace(measured,
                    reclaimable_vram_bytes=reclaimable_vram_bytes), self.config)
        with patch.object(hardware.HardwareConfig, 'from_environment', return_value=config), \
                patch.object(hardware, 'NvidiaExecutionBackend', Backend), \
                patch.object(character, '_runtime_device_policy', return_value=(management, torch.device('cuda:0'))), \
                patch.object(character, '_engine_idle', return_value=False):
            busy = character.runtime_hardware_report('character-selection')
        self.assertFalse(busy['ready'])
        self.assertEqual(allowances, [0])
        with patch.object(hardware.HardwareConfig, 'from_environment', return_value=config), \
                patch.object(hardware, 'NvidiaExecutionBackend', Backend), \
                patch.object(character, '_runtime_device_policy', return_value=(management, torch.device('cuda:0'))), \
                patch.object(character, '_engine_idle', return_value=True), \
                patch.object(character, 'verify_native_decoder_contract', return_value=types.SimpleNamespace(
                    as_dict=lambda: {'architecture': 'MiniMaxH3VideoVAE', 'comfy_has_chunked_io': True})), \
                patch.object(character, '_kitchen_attention_probe', return_value='comfy-kitchen-int8-attention') as attention:
            ready = character.runtime_hardware_report('character-swap')
        self.assertTrue(ready['ready'])
        self.assertEqual(ready['facts']['free_vram_bytes'], 2 * GIB)
        self.assertEqual(ready['facts']['reclaimable_vram_bytes'], 8 * GIB)
        self.assertIn('comfy-kitchen-int8-attention', ready['facts']['kernel_probes'])
        self.assertEqual(ready['policy'], {'cpuInference': False, 'float32Fallback': False})
        self.assertEqual(ready['memoryPolicy']['effective_mode'], 'sequential')
        self.assertIs(ready['memoryPolicy']['cpu_output_staging'], True)
        self.assertIs(ready['memoryPolicy']['denoiser_activation_offload'], False)
        attention.assert_called_once()

    def test_runtime_rejects_inactive_sequential_policy_before_decoder_or_attention(self):
        class Backend:
            def __init__(self, _): pass
            def inspect(self): return facts()
            def preflight(self, **_): return facts()
        management = native_management()
        management.args.cache_none = False
        with patch.object(hardware.HardwareConfig, 'from_environment', return_value=hardware.HardwareConfig()), \
                patch.object(hardware, 'NvidiaExecutionBackend', Backend), \
                patch.object(character, '_runtime_device_policy', return_value=(management, torch.device('cuda:0'))), \
                patch.object(character, 'verify_native_decoder_contract', side_effect=AssertionError('No decoder check after rejected placement')), \
                patch.object(character, '_kitchen_attention_probe', side_effect=AssertionError('No attention probe after rejected placement')):
            report = character.runtime_hardware_report('character-swap')
        self.assertFalse(report['ready'])
        self.assertIsNone(report['memoryPolicy'])
        self.assertEqual(report['checks'][-1]['id'], 'sequential_native_flags_required')
        self.assertIn('--disable-smart-memory --cache-none', report['checks'][-1]['message'])
        self.assertEqual([check['id'] for check in report['checks'] if check['state'] == 'pass'],
            ['cuda', 'native-bf16', 'memory', 'kernel-probe'])

    def test_balanced_runtime_preserves_gpu_intermediates_and_does_not_claim_streaming(self):
        class Backend:
            def __init__(self, _): pass
            def inspect(self): return facts()
            def preflight(self, **_): return facts()
        management = native_management()
        management.DISABLE_SMART_MEMORY = False
        management.args.cache_none = False
        management.args.gpu_only = True
        management.vram_state = 'high'
        management.intermediate_device = lambda: torch.device('cuda:0')
        config = hardware.HardwareConfig(memory_mode='balanced')
        with patch.object(hardware.HardwareConfig, 'from_environment', return_value=config), \
                patch.object(hardware, 'NvidiaExecutionBackend', Backend), \
                patch.object(character, '_runtime_device_policy', return_value=(management, torch.device('cuda:0'))), \
                patch.object(character, 'verify_native_decoder_contract', side_effect=AssertionError('Balanced preserves existing decoder choice')):
            report = character.runtime_hardware_report('text-video')
        self.assertTrue(report['ready'])
        self.assertEqual(report['memoryPolicy']['effective_mode'], 'balanced')
        self.assertFalse(report['memoryPolicy']['cpu_output_staging'])
        self.assertIsNone(report['memoryPolicy']['native_decoder_contract'])
        self.assertTrue(management.args.gpu_only)
        self.assertFalse(management.args.cache_none)

    def test_runtime_report_sanitizes_unexpected_failures_and_does_not_probe_unknown_profiles(self):
        with patch.object(character, '_runtime_device_policy', side_effect=RuntimeError('private path or token')):
            report = character.runtime_hardware_report('image-gen')
        self.assertFalse(report['ready'])
        self.assertNotIn('private path or token', json.dumps(report))
        with self.assertRaises(ValueError):
            character.runtime_hardware_report('unknown-private-profile')

    def test_runtime_route_is_read_only_profiled_and_registered_once(self):
        handlers = {}
        class Routes:
            def get(self, path):
                def register(handler):
                    self.assert_new(path)
                    handlers[path] = handler
                    return handler
                return register
            def assert_new(self, path):
                if path in handlers: raise AssertionError('Duplicate route registration')
        instance = types.SimpleNamespace(routes=Routes(), prompt_queue=types.SimpleNamespace(
            get_current_queue=lambda: ([], [])))
        server = types.ModuleType('server')
        server.PromptServer = types.SimpleNamespace(instance=instance)
        aiohttp = types.ModuleType('aiohttp')
        aiohttp.web = types.SimpleNamespace(json_response=lambda data, **kwargs: (data, kwargs))
        with patch.dict(sys.modules, {'server': server, 'aiohttp': aiohttp}):
            character.install_runtime_hardware_route()
            character.install_runtime_hardware_route()
            self.assertTrue(character._engine_idle())
            instance.prompt_queue.get_current_queue = lambda: ([object()], [])
            self.assertFalse(character._engine_idle())
            with patch.object(character, 'runtime_hardware_report', return_value={'ready': False}) as report:
                response, options = asyncio.run(handlers['/aftertake/runtime'](
                    types.SimpleNamespace(query={'profile': 'character-swap'})))
                self.assertEqual(response, {'ready': False})
                self.assertEqual(options['headers'], {'Cache-Control': 'no-store'})
                report.assert_called_once_with('character-swap')
                response, options = asyncio.run(handlers['/aftertake/runtime'](
                    types.SimpleNamespace(query={'profile': 'private-unknown'})))
                self.assertEqual(options['status'], 400)
                self.assertEqual(report.call_count, 1)
                self.assertNotIn('private-unknown', json.dumps(response))


if __name__ == '__main__':
    unittest.main()
