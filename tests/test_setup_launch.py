"""Bounded installer ordering tests; commands are recorded, never executed."""
from contextlib import ExitStack, redirect_stdout
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
      patch('subprocess.run', side_effect=AssertionError('Import must not install or run anything.')),
      patch('shutil.copytree', side_effect=AssertionError('Import must not copy node files.'))):
    SPEC = importlib.util.spec_from_file_location('aftertake_setup_launch_tests', ROOT / 'scripts/setup.py')
    setup = importlib.util.module_from_spec(SPEC)
    sys.modules[SPEC.name] = setup
    SPEC.loader.exec_module(setup)
    from hardware import HardwareFacts


GIB = 1024 ** 3


class SetupLaunchTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='aftertake-setup-launch-')))
        self.runtime = self.root / '.runtime'
        self.venv = self.runtime / 'venv'
        self.python = self.venv / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
        self.python.parent.mkdir(parents=True)
        self.python.touch()
        self.commands = []
        self.events = []
        self.probes = []
        self.missing_tools = set()
        self.report = {
            'format': 'aftertake-hardware-preflight/1', 'ready': True,
            'facts': HardwareFacts(
                backend='cuda', name='Installer CUDA fixture', device_index=0,
                total_vram_bytes=24 * GIB, free_vram_bytes=20 * GIB,
                compute_capability=(8, 6), native_bf16=True, native_fp8=False,
                kernel_probes=('bf16-matmul-and-optimized-sdpa',),
            ).as_dict(),
            'modelWeightsAllocated': False, 'cpuInference': False, 'float32Fallback': False,
        }
        self.probe_stdout = None
        self.probe_returncode = 0
        self.stack.enter_context(redirect_stdout(io.StringIO()))
        self.stack.enter_context(patch.dict(os.environ, {'PATH': 'fixture-tools', 'CUDA_VISIBLE_DEVICES': '2,GPU-selected'}, clear=True))
        self.stack.enter_context(patch.multiple(setup, ROOT=self.root, RUNTIME=self.runtime,
                                               VENV=self.venv, PYTHON=self.python, REPOS=[]))
        self.stack.enter_context(patch.object(setup.platform, 'machine', return_value='x86_64'))
        self.which = self.stack.enter_context(patch.object(setup.shutil, 'which', side_effect=self.find_tool))
        self.models = self.stack.enter_context(patch.object(setup, 'model_root', side_effect=lambda value: Path(value).expanduser().resolve()))
        self.copy = self.stack.enter_context(patch.object(setup.shutil, 'copytree', side_effect=lambda *a, **k: self.events.append('copy')))
        self.run = self.stack.enter_context(patch.object(setup, 'run', side_effect=self.record_command))
        self.probe = self.stack.enter_context(patch.object(setup.subprocess, 'run', side_effect=self.run_probe))
        self.stack.enter_context(patch.object(setup.subprocess, 'check_output', side_effect=AssertionError('No real Git invocation expected.')))

    def find_tool(self, name):
        return None if name in self.missing_tools else 'fixture-' + name

    def record_command(self, *arguments):
        command = [str(value) for value in arguments]
        self.commands.append(command)
        if command[1:] == ['-m', 'pip', 'check']:
            self.events.append('dependency-check')
        elif len(command) > 1 and command[1].endswith('download-models.py'):
            self.events.append('download')
        elif len(command) > 1 and command[1].endswith('create-study.py'):
            self.events.append('sample')

    def run_probe(self, command, **options):
        self.events.append('preflight')
        self.probes.append((list(command), options, dict(os.environ)))
        return SimpleNamespace(returncode=self.probe_returncode,
                               stdout=json.dumps(self.report) if self.probe_stdout is None else self.probe_stdout,
                               stderr='fixture preflight diagnostic')

    def downloads(self):
        return [command for command in self.commands if len(command) > 1 and command[1].endswith('download-models.py')]

    def assert_no_models(self):
        self.assertEqual(self.downloads(), [])
        self.copy.assert_not_called()
        self.assertNotIn('sample', self.events)

    def test_pinned_cuda_dependencies_are_checked_before_probe_and_models(self):
        self.assertEqual(setup.main(['--image-gen', '--models-dir', str(self.root / 'model-disk')]), 0)
        torch_install = next(command for command in self.commands if 'torch==2.11.0' in command)
        self.assertEqual(torch_install[:4], [str(self.python), '-m', 'pip', 'install'])
        self.assertIn('torchvision==0.26.0', torch_install)
        self.assertIn('torchaudio==2.11.0', torch_install)
        self.assertEqual(torch_install[-2:], ['--index-url', 'https://download.pytorch.org/whl/cu130'])
        self.assertIn([str(self.python), '-m', 'pip', 'install', '-r', str(self.root / 'requirements-runtime.txt')], self.commands)
        self.assertEqual(self.events, ['dependency-check', 'preflight', 'copy', 'download', 'sample'])
        self.assertEqual(self.downloads(), [[str(self.python), str(self.root / 'scripts/download-models.py'),
                                           '--image-gen', '--models-dir', str(self.root / 'model-disk')]])
        command, options, _ = self.probes[0]
        self.assertEqual(command[:2], [str(self.python), str(self.root / 'scripts/hardware-check.py')])
        self.assertGreater(options['timeout'], 0)
        self.assertLessEqual(options['timeout'], 120)

    def test_skip_models_still_performs_hardware_preflight(self):
        self.assertEqual(setup.main(['--skip-models']), 0)
        self.assertEqual(self.events, ['dependency-check', 'preflight', 'copy', 'sample'])
        self.assertEqual(self.downloads(), [])
        self.probe.assert_called_once()

    def test_failed_preflight_blocks_copy_and_model_download(self):
        self.report = {'format': 'aftertake-hardware-preflight/1', 'ready': False,
                       'code': 'native_bf16_required', 'error': 'Fixture GPU does not have native BF16.'}
        self.probe_returncode = 2
        with self.assertRaises(SystemExit) as captured:
            setup.main([])
        self.assertIn('native_bf16_required', str(captured.exception))
        self.assertEqual(self.events, ['dependency-check', 'preflight'])
        self.assert_no_models()

    def test_malformed_failed_process_or_timed_out_preflight_blocks_models(self):
        cases = [('malformed-json', None), ('nonzero-exit', None),
                 ('runtime-error', OSError('fixture cannot start')),
                 ('timeout', setup.subprocess.TimeoutExpired('fixture', 120))]
        for label, error in cases:
            with self.subTest(case=label):
                self.probe_stdout = 'not-json' if label == 'malformed-json' else None
                self.probe_returncode = 2 if label == 'nonzero-exit' else 0
                self.probe.side_effect = error if error is not None else self.run_probe
                with self.assertRaises(SystemExit):
                    setup.main([])
                self.assert_no_models()

    def test_platform_git_gpu_and_character_tools_fail_before_install(self):
        with patch.object(setup.sys, 'platform', 'darwin'):
            with self.assertRaises(SystemExit):
                setup.main([])
        with patch.object(setup.platform, 'machine', return_value='arm64'):
            with self.assertRaises(SystemExit):
                setup.main([])
        self.missing_tools = {'git'}
        with self.assertRaises(SystemExit):
            setup.main([])
        self.missing_tools = set()
        with self.assertRaises(SystemExit):
            setup.main(['--gpu-index', '-1'])
        self.missing_tools = {'ffprobe'}
        with self.assertRaises(SystemExit) as captured:
            setup.main(['--character-swap'])
        self.assertIn('FFprobe', str(captured.exception))
        self.run.assert_not_called()
        self.probe.assert_not_called()
        self.assert_no_models()

    def test_gpu_index_reaches_cli_and_report_is_validated_as_logical_zero(self):
        os.environ['AFTERTAKE_GPU_DEVICE'] = '1'
        self.assertEqual(setup.main(['--gpu-index', '1', '--skip-models']), 0)
        command, _, environment = self.probes[0]
        self.assertEqual(command[command.index('--gpu-index') + 1], '1')
        self.assertEqual(environment['CUDA_VISIBLE_DEVICES'], '2,GPU-selected')
        self.assertEqual(environment['AFTERTAKE_GPU_DEVICE'], '1')
        self.assertEqual(self.report['facts']['device_index'], 0)

    def test_existing_profile_download_flags_are_preserved(self):
        for argument, download_flag in [('--inpaint', '--ltx25'), ('--motion-transfer', '--motion-transfer'),
                                        ('--character-swap', '--character-swap')]:
            with self.subTest(argument=argument):
                self.commands.clear()
                self.events.clear()
                self.copy.reset_mock()
                self.assertEqual(setup.main([argument]), 0)
                self.assertEqual(self.downloads(), [[str(self.python), str(self.root / 'scripts/download-models.py'), download_flag]])
                self.assertLess(self.events.index('preflight'), self.events.index('download'))

    def test_dependency_check_failure_stops_before_hardware_probe(self):
        def failed_check(*arguments):
            self.record_command(*arguments)
            if list(map(str, arguments))[1:] == ['-m', 'pip', 'check']:
                raise setup.subprocess.CalledProcessError(1, list(arguments))

        self.run.side_effect = failed_check
        with self.assertRaises(setup.subprocess.CalledProcessError):
            setup.main([])
        self.probe.assert_not_called()
        self.assert_no_models()

    def test_relative_model_directory_survives_different_downloader_working_directory(self):
        spec = importlib.util.spec_from_file_location('setup_real_model_storage', ROOT / 'scripts/model_storage.py')
        storage = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(storage)
        caller = self.root / 'different caller directory'
        caller.mkdir()
        config = self.runtime / 'model-storage.json'
        previous = Path.cwd()
        try:
            with (patch.object(storage, 'ROOT', self.root), patch.object(storage, 'CONFIG', config),
                  patch.object(setup, 'model_root', storage.model_root)):
                os.chdir(caller)
                self.assertEqual(setup.main(['--models-dir', 'weights disk']), 0)
                command = self.downloads()[0]
                forwarded = command[command.index('--models-dir') + 1]
                expected = (caller / 'weights disk').resolve()
                self.assertTrue(Path(forwarded).is_absolute())
                self.assertEqual(Path(forwarded), expected)
                # The real downloader starts in ROOT, unlike the caller. Its
                # storage resolver must keep the same disk and remembered path.
                os.chdir(self.root)
                self.assertEqual(storage.model_root(forwarded), expected)
                self.assertEqual(Path(json.loads(config.read_text(encoding='utf-8'))['directory']), expected)
                self.assertFalse((self.root / 'weights disk').exists())
        finally:
            os.chdir(previous)


if __name__ == '__main__':
    unittest.main()
