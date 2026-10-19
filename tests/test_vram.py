import importlib.util
from enum import Enum
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

import torch


spec = importlib.util.spec_from_file_location(
    'aftertake_vram_tests', Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake/vram.py')
vram = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = vram
spec.loader.exec_module(vram)


class MemoryPolicyTests(unittest.TestCase):
    def test_auto_uses_native_eviction_through_16_gib_without_changing_compute(self):
        for size in (8, 12, 16):
            policy = vram.resolve_memory_policy(total_vram_bytes=size * vram.GIB)
            self.assertEqual(policy.effective_mode, 'sequential')
            self.assertEqual(policy.comfy_args, ('--disable-smart-memory', '--cache-none'))
            for forbidden in ('--lowvram', '--novram', '--cpu', '--cpu-vae', '--disable-dynamic-vram',
                              '--fp16-unet', '--bf16-unet', '--supports-fp8-compute'):
                self.assertNotIn(forbidden, policy.comfy_args)
        for size in (None, 24 * vram.GIB, 16 * vram.GIB + 1):
            policy = vram.resolve_memory_policy(total_vram_bytes=size)
            self.assertEqual(policy.effective_mode, 'balanced')
            self.assertEqual(policy.comfy_args, ())

    def test_explicit_modes_override_the_residency_heuristic(self):
        self.assertEqual(vram.resolve_memory_policy('balanced', 12 * vram.GIB).comfy_args, ())
        self.assertEqual(vram.resolve_memory_policy('sequential', 48 * vram.GIB).comfy_args,
                         ('--disable-smart-memory', '--cache-none'))

    def test_safe_weight_copies_are_only_an_explicit_choice(self):
        self.assertFalse(vram.resolve_memory_policy().safe_weight_copies)
        policy = vram.resolve_memory_policy('balanced', safe_weight_copies=True)
        self.assertEqual(policy.comfy_args, ('--disable-fast-disk', '--async-offload', '1'))
        self.assertTrue(policy.safe_weight_copies)
        with self.assertRaises(AttributeError):
            policy.effective_mode = 'sequential'

    def test_bad_policy_inputs_do_not_create_silent_fallbacks(self):
        for mode in ('cpu', 'lowvram', '', None):
            with self.assertRaises(ValueError):
                vram.resolve_memory_policy(mode)
        for size in (0, -1, True, 1.5, '16'):
            with self.assertRaises(ValueError):
                vram.resolve_memory_policy(total_vram_bytes=size)
        with self.assertRaises(ValueError):
            vram.resolve_memory_policy(safe_weight_copies='yes')


class NativeResidencyPolicyTests(unittest.TestCase):
    class NativeState(Enum):
        NORMAL_VRAM = 3
        HIGH_VRAM = 4

    def management(self):
        forbidden = Mock(side_effect=AssertionError('Placement verification must not alter residency.'))
        return types.SimpleNamespace(
            args=types.SimpleNamespace(cache_none=True, gpu_only=False, highvram=False),
            DISABLE_SMART_MEMORY=True,
            VRAMState=self.NativeState,
            vram_state=self.NativeState.NORMAL_VRAM,
            intermediate_device=Mock(return_value=torch.device('cpu')),
            free_memory=forbidden, unload_all_models=forbidden, soft_empty_cache=forbidden,
        )

    def verify(self, management, mode='auto', total_gib=16):
        policy = vram.resolve_memory_policy(mode, total_gib * vram.GIB)
        return vram.verify_native_residency(policy, management)

    def assert_policy_error(self, code, management):
        with self.assertRaises(vram.ResidencyPolicyError) as raised:
            self.verify(management)
        self.assertEqual(raised.exception.code, code)
        self.assertIn('Aftertake launcher', str(raised.exception))

    def test_effective_sequential_reports_actual_native_storage_without_mutation(self):
        for mode, size in (('auto', 12), ('auto', 16), ('sequential', 24)):
            with self.subTest(mode=mode, size=size):
                management = self.management()
                original_args = vars(management.args).copy()
                facts = self.verify(management, mode, size)
                self.assertEqual(facts.as_dict(), {
                    'requested_mode': mode, 'effective_mode': 'sequential',
                    'intermediate_device': 'cpu', 'cpu_intermediate_storage': True,
                    'native_smart_memory_disabled': True, 'node_result_cache_disabled': True,
                    'high_vram_residency': False,
                })
                facts.as_dict()['intermediate_device'] = 'cuda:0'
                self.assertEqual(facts.intermediate_device, 'cpu')
                with self.assertRaises(AttributeError):
                    facts.intermediate_device = 'cuda:0'
                self.assertEqual(vars(management.args), original_args)
                self.assertEqual(management.vram_state, self.NativeState.NORMAL_VRAM)
                management.intermediate_device.assert_called_once_with()
                management.free_memory.assert_not_called()

    def test_sequential_rejects_each_high_residency_contradiction(self):
        for contradiction in ('state', 'gpu_only', 'highvram'):
            with self.subTest(contradiction=contradiction):
                management = self.management()
                if contradiction == 'state':
                    management.vram_state = self.NativeState.HIGH_VRAM
                else:
                    setattr(management.args, contradiction, True)
                self.assert_policy_error('sequential_residency_conflict', management)

    def test_sequential_requires_cpu_intermediate_storage(self):
        for device in ('cuda:1', 'cuda', 'meta'):
            with self.subTest(device=device):
                management = self.management()
                management.intermediate_device.return_value = torch.device(device)
                self.assert_policy_error('cpu_intermediate_storage_required', management)

    def test_sequential_rejects_unavailable_or_unknown_placement_facts(self):
        for unknown in ('state', 'state_enum', 'device', 'device_query'):
            with self.subTest(unknown=unknown):
                management = self.management()
                expected = 'sequential_residency_conflict'
                if unknown == 'state':
                    management.vram_state = object()
                elif unknown == 'state_enum':
                    del management.VRAMState
                elif unknown == 'device':
                    management.intermediate_device.return_value = object()
                    expected = 'cpu_intermediate_storage_required'
                else:
                    management.intermediate_device.side_effect = RuntimeError('Native placement unavailable')
                    expected = 'cpu_intermediate_storage_required'
                self.assert_policy_error(expected, management)

    def test_sequential_requires_actual_eviction_and_result_cache_flags(self):
        for flag in ('DISABLE_SMART_MEMORY', 'cache_none'):
            for value in (False, None, 1, 'true'):
                with self.subTest(flag=flag, value=value):
                    management = self.management()
                    owner = management if flag == 'DISABLE_SMART_MEMORY' else management.args
                    if value is None:
                        delattr(owner, flag)
                    else:
                        setattr(owner, flag, value)
                    self.assert_policy_error('sequential_native_flags_required', management)

    def test_effective_balanced_preserves_explicit_native_gpu_storage(self):
        for mode, size in (('balanced', 12), ('auto', 24)):
            with self.subTest(mode=mode, size=size):
                management = self.management()
                management.args.cache_none = False
                management.args.gpu_only = True
                management.DISABLE_SMART_MEMORY = False
                management.vram_state = self.NativeState.HIGH_VRAM
                management.intermediate_device.return_value = torch.device('cuda:1')
                facts = self.verify(management, mode, size)
                self.assertEqual(facts.effective_mode, 'balanced')
                self.assertEqual(facts.intermediate_device, 'cuda:1')
                self.assertFalse(facts.cpu_intermediate_storage)
                self.assertFalse(facts.native_smart_memory_disabled)
                self.assertFalse(facts.node_result_cache_disabled)
                self.assertTrue(facts.high_vram_residency)
                self.assertTrue(management.args.gpu_only)
                management.free_memory.assert_not_called()

    def test_balanced_reports_unknown_facts_without_inventing_active_placement(self):
        policy = vram.resolve_memory_policy('balanced')
        facts = vram.verify_native_residency(policy, object())
        self.assertEqual(facts.intermediate_device, 'unknown')
        self.assertIsNone(facts.cpu_intermediate_storage)
        self.assertIsNone(facts.high_vram_residency)
        self.assertIsNone(facts.node_result_cache_disabled)
        self.assertIsNone(facts.native_smart_memory_disabled)

    def test_placement_check_requires_a_resolved_policy(self):
        with self.assertRaises(vram.ResidencyPolicyError) as raised:
            vram.verify_native_residency(types.SimpleNamespace(effective_mode='balanced'), self.management())
        self.assertEqual(raised.exception.code, 'invalid_memory_policy')


class NativeDecoderContractTests(unittest.TestCase):
    def native_class(self, **overrides):
        def forbidden_constructor(*_args, **_kwargs):
            raise AssertionError('Contract inspection must not construct or allocate a model.')

        def decode(self, latent, output_buffer=None):
            raise AssertionError('Contract inspection must not decode a tensor.')

        def decode_output_shape(self, input_shape):
            raise AssertionError('Contract inspection must not run decoder methods.')

        members = {'__new__': forbidden_constructor, '__init__': forbidden_constructor,
                   'comfy_has_chunked_io': True, 'decode': decode,
                   'decode_output_shape': decode_output_shape}
        members.update(overrides)
        return type('TinyDecoderApiOnly', (), members)

    def verify(self, profile, native_class=None):
        native_class = self.native_class() if native_class is None else native_class
        importer = Mock(return_value=types.SimpleNamespace(
            MiniMaxH3VideoVAE=native_class, VideoVAE=native_class))
        return vram.verify_native_decoder_contract(profile, importer=importer), importer

    def test_video_profiles_check_exact_native_class_without_instantiation(self):
        for profile in ('character-swap', 'structure', 'motion', 'inpaint', 'cinema', 'text-video'):
            with self.subTest(profile=profile):
                facts, importer = self.verify(profile)
                is_h3 = profile == 'character-swap'
                module = ('comfy.ldm.minimax.vae' if is_h3 else
                          'comfy.ldm.lightricks.vae.causal_video_autoencoder')
                self.assertEqual(facts.as_dict(), {
                    'architecture': 'MiniMaxH3VideoVAE' if is_h3 else 'VideoVAE',
                    'module': module, 'comfy_has_chunked_io': True, 'decode_output_buffer': True,
                })
                importer.assert_called_once_with(module)
                facts.as_dict()['comfy_has_chunked_io'] = False
                self.assertTrue(facts.comfy_has_chunked_io)
                with self.assertRaises(AttributeError):
                    facts.architecture = 'OtherDecoder'

    def test_nonvideo_profiles_do_not_import_or_claim_wan_decoder_support(self):
        importer = Mock(side_effect=AssertionError('No decoder import for non-video profiles.'))
        for profile in ('character-selection', 'sam3', 'SAM3', 'frame-edit', 'image-gen', 'motion-transfer'):
            self.assertIsNone(vram.verify_native_decoder_contract(profile, importer=importer))
        importer.assert_not_called()

    def test_missing_import_or_class_has_actionable_pinned_runtime_error(self):
        for importer in (Mock(side_effect=ImportError('Native module missing')),
                         Mock(return_value=types.SimpleNamespace()),
                         Mock(return_value=types.SimpleNamespace(VideoVAE=object()))):
            with self.subTest(importer=importer):
                with self.assertRaises(vram.ResidencyPolicyError) as raised:
                    vram.verify_native_decoder_contract('structure', importer=importer)
                self.assertEqual(raised.exception.code, 'native_decoder_contract_unavailable')
                self.assertIn('pinned ComfyUI runtime and custom nodes', str(raised.exception))

    def test_chunked_flag_and_output_methods_must_match_native_api(self):
        invalid = [self.native_class(comfy_has_chunked_io=value) for value in (False, None, 1, 'true')]
        invalid.extend(self.native_class(**{method: None}) for method in ('decode', 'decode_output_shape'))
        for native_class in invalid:
            with self.subTest(native_class=native_class):
                with self.assertRaises(vram.ResidencyPolicyError) as raised:
                    self.verify('character-swap', native_class)
                self.assertEqual(raised.exception.code, 'native_decoder_contract_unavailable')

    def test_decode_must_accept_optional_keyword_output_buffer_and_latent(self):
        def no_canvas(self, latent):
            pass

        def required_canvas(self, latent, output_buffer):
            pass

        def wrong_default(self, latent, output_buffer=False):
            pass

        def positional_canvas(self, latent, output_buffer=None, /):
            pass

        def no_latent(self, output_buffer=None):
            pass

        def additional_required(self, latent, extra, output_buffer=None):
            pass

        def generic_kwargs(self, latent, **kwargs):
            pass

        for decode in (no_canvas, required_canvas, wrong_default, positional_canvas,
                       no_latent, additional_required, generic_kwargs):
            with self.subTest(decode=decode.__name__):
                with self.assertRaises(vram.ResidencyPolicyError):
                    self.verify('structure', self.native_class(decode=decode))

        def keyword_canvas(self, latent, *, output_buffer=None):
            raise AssertionError('Never called')

        facts, _ = self.verify('structure', self.native_class(decode=keyword_canvas))
        self.assertTrue(facts.decode_output_buffer)

    def test_unknown_profile_does_not_silently_bypass_decoder_check(self):
        importer = Mock(side_effect=AssertionError('Unknown profiles must not import native code.'))
        with self.assertRaises(vram.ResidencyPolicyError) as raised:
            vram.verify_native_decoder_contract('character-swap-typo', importer=importer)
        self.assertEqual(raised.exception.code, 'native_decoder_contract_unavailable')
        importer.assert_not_called()


class ReclaimableResidencyTests(unittest.TestCase):
    def wrapper(self, amount, *, device='cuda:0', underlying=None):
        module = object() if underlying is None else underlying
        return types.SimpleNamespace(
            device=device, model=types.SimpleNamespace(model=module),
            model_loaded_memory=Mock(return_value=amount),
            model_memory=Mock(side_effect=AssertionError('Checkpoint size is not resident VRAM.')),
        )

    def management(self, wrappers):
        forbidden = Mock(side_effect=AssertionError('Residency inspection must never evict or flush.'))
        return types.SimpleNamespace(current_loaded_models=wrappers, free_memory=forbidden,
                                     unload_all_models=forbidden, soft_empty_cache=forbidden)

    def inspect(self, management, **overrides):
        values = {'idle': True, 'device': 'cuda:0', 'max_bytes': 8 * vram.GIB}
        values.update(overrides)
        return vram.managed_reclaimable_vram_bytes(management, **values)

    def test_idle_cached_native_weights_are_counted_without_eviction(self):
        wrapper = self.wrapper(3 * vram.GIB)
        management = self.management([wrapper])
        self.assertEqual(self.inspect(management), 3 * vram.GIB)
        wrapper.model_loaded_memory.assert_called_once_with()
        wrapper.model_memory.assert_not_called()
        management.free_memory.assert_not_called()

    def test_busy_or_unknown_queue_state_contributes_nothing(self):
        wrapper = self.wrapper(3 * vram.GIB)
        management = self.management([wrapper])
        for idle in (False, None, 1, 'idle', []):
            self.assertEqual(self.inspect(management, idle=idle), 0)
        wrapper.model_loaded_memory.assert_not_called()

    def test_only_the_exact_selected_gpu_contributes(self):
        first = self.wrapper(3 * vram.GIB, device=FakeDevice('cuda:0'))
        second = self.wrapper(2 * vram.GIB, device=FakeDevice('cuda:1'))
        cpu = self.wrapper(7 * vram.GIB, device='cpu')
        management = self.management([first, second, cpu])
        self.assertEqual(self.inspect(management, device=FakeDevice('cuda:1')), 2 * vram.GIB)
        first.model_loaded_memory.assert_not_called()
        cpu.model_loaded_memory.assert_not_called()
        self.assertEqual(self.inspect(self.management([first]), device='cuda:1'), 0)

    def test_cloned_patchers_share_one_resident_model_measurement(self):
        underlying = object()
        wrappers = [self.wrapper(3 * vram.GIB, underlying=underlying) for _ in range(3)]
        self.assertEqual(self.inspect(self.management(wrappers)), 3 * vram.GIB)
        wrappers.append(self.wrapper(2 * vram.GIB, underlying=underlying))
        self.assertEqual(self.inspect(self.management(wrappers)), 2 * vram.GIB)
        wrappers.append(self.wrapper(0, underlying=underlying))
        self.assertEqual(self.inspect(self.management(wrappers)), 0)

    def test_measurement_never_exceeds_validated_total_minus_raw_free_bound(self):
        management = self.management([self.wrapper(3 * vram.GIB), self.wrapper(4 * vram.GIB)])
        total, raw_free = 16 * vram.GIB, 12 * vram.GIB
        self.assertEqual(self.inspect(management, max_bytes=total - raw_free), 4 * vram.GIB)
        self.assertEqual(raw_free, 12 * vram.GIB)

    def test_bad_facts_dead_wrappers_and_unknown_residency_are_conservative(self):
        wrapper = self.wrapper(3 * vram.GIB)
        for bound in (0, -1, True, None, 1.5, '1024'):
            self.assertEqual(self.inspect(self.management([wrapper]), max_bytes=bound), 0)
        for device in ('cpu', 'cuda', 'cuda:-1', 'cuda:1.5', None, object()):
            self.assertEqual(self.inspect(self.management([wrapper]), device=device), 0)
        self.assertEqual(self.inspect(types.SimpleNamespace(current_loaded_models=None)), 0)
        self.assertEqual(self.inspect(object()), 0)
        bad = [self.wrapper(value) for value in (True, -1, 1.5, '1024', None)]
        broken = self.wrapper(1)
        broken.model_loaded_memory.side_effect = RuntimeError('Residency unavailable')
        dead = types.SimpleNamespace(device='cuda:0', model=None)
        self.assertEqual(self.inspect(self.management([*bad, broken, dead, object()])), 0)
        self.assertEqual(self.inspect(self.management([*bad, wrapper])), 3 * vram.GIB)


class CpuActivationStoreTests(unittest.TestCase):
    def test_tiny_roundtrip_preserves_values_shape_and_precision(self):
        for dtype in (torch.bfloat16, torch.float16, torch.float32, torch.float64, torch.int64, torch.bool):
            tensor = torch.arange(12).reshape(3, 4).to(dtype)
            original = tensor.clone()
            with vram.ActivationStore(256, device='cpu') as store:
                ticket = store.stage(tensor)
                tensor.fill_(0)
                restored = store.restore(ticket)
                self.assertEqual(restored.dtype, dtype)
                self.assertEqual(restored.shape, original.shape)
                self.assertTrue(torch.equal(restored, original))
                restored.fill_(0)
                self.assertTrue(torch.equal(store.restore(ticket), original))
                with store.borrow_host(ticket) as host:
                    self.assertEqual(host.dtype, dtype)
                    self.assertTrue(torch.equal(host, original))
                self.assertEqual(store.stored_bytes, original.numel() * original.element_size())

    def test_budget_prevents_allocation_and_release_reclaims_it(self):
        tensor = torch.ones(8, dtype=torch.bfloat16)
        with vram.ActivationStore(16, device='cpu') as store:
            ticket = store.stage(tensor)
            with patch.object(torch, 'empty_like', side_effect=AssertionError('Allocation after budget failure')):
                with self.assertRaises(MemoryError):
                    store.stage(tensor)
            self.assertEqual(store.stored_count, 1)
            self.assertTrue(store.release(ticket))
            self.assertFalse(store.release(ticket))
            self.assertEqual(store.stored_bytes, 0)
            next_ticket = store.stage(tensor)
            self.assertNotEqual(next_ticket, ticket)
            with self.assertRaises(KeyError):
                store.restore(ticket)

    def test_invalid_tensors_and_foreign_tickets_are_rejected(self):
        with vram.ActivationStore(128, device='cpu') as store, vram.ActivationStore(128, device='cpu') as other:
            for tensor in (torch.ones(3, requires_grad=True), torch.nn.Parameter(torch.ones(3)),
                           torch.ones(3, 4).t(), torch.empty(0), 'not a tensor'):
                with self.assertRaises(ValueError):
                    store.stage(tensor)
            foreign = other.stage(torch.ones(1))
            with self.assertRaises(ValueError):
                store.restore(foreign)
            with self.assertRaises(ValueError):
                store.release(foreign)

    def test_context_cleanup_is_reliable_on_cancellation(self):
        store = vram.ActivationStore(128, device='cpu')
        with self.assertRaisesRegex(RuntimeError, 'canceled'):
            with store:
                ticket = store.stage(torch.ones(8))
                raise RuntimeError('canceled')
        self.assertEqual(store.stored_bytes, 0)
        self.assertEqual(store.stored_count, 0)
        with self.assertRaisesRegex(RuntimeError, 'closed'):
            store.restore(ticket)
        store.close()

    def test_cpu_encoder_boundary_borrows_without_an_unnecessary_copy(self):
        tensor = torch.arange(6).reshape(2, 3).to(torch.bfloat16).t()
        with patch.object(torch, 'empty_like', side_effect=AssertionError('CPU data needs no transfer')):
            with vram.host_tensor(tensor, max_bytes=16) as host:
                self.assertIs(host, tensor)
                self.assertEqual(host.dtype, torch.bfloat16)
        with self.assertRaises(ValueError):
            with vram.host_tensor(torch.ones(3, requires_grad=True)):
                pass

    def test_borrowed_storage_cannot_be_released_during_encoding(self):
        with vram.ActivationStore(32, device='cpu') as store:
            ticket = store.stage(torch.ones(4))
            with self.assertRaisesRegex(RuntimeError, 'encoding interrupted'):
                with store.borrow_host(ticket):
                    with self.assertRaisesRegex(RuntimeError, 'Finish encoding'):
                        store.release(ticket)
                    self.assertEqual(store.stored_bytes, 16)
                    raise RuntimeError('encoding interrupted')
            self.assertTrue(store.release(ticket))
            self.assertEqual(store.stored_bytes, 0)


class FakeDevice:
    def __init__(self, value):
        if isinstance(value, FakeDevice):
            self.type, self.index = value.type, value.index
        else:
            parts = str(value).split(':')
            self.type, self.index = parts[0], int(parts[1]) if len(parts) == 2 else None

    def __eq__(self, other):
        return isinstance(other, FakeDevice) and (self.type, self.index) == (other.type, other.index)


class FakeTensor:
    def __init__(self, owner, values, device='cuda:1', dtype='bfloat16', contiguous=True):
        self.owner, self.values = owner, list(values)
        self.device, self.dtype = FakeDevice(device), dtype
        self.requires_grad, self.layout = False, 'strided'
        self._contiguous = contiguous

    def is_contiguous(self):
        return self._contiguous

    def contiguous(self):
        self.owner.log.append(('contiguous', self.device.type, self.device.index))
        return FakeTensor(self.owner, self.values, self.device, self.dtype)

    def numel(self):
        return len(self.values)

    def element_size(self):
        return 2

    def copy_(self, source, non_blocking=False):
        self.owner.log.append(('copy', source.device.type, self.device.type, non_blocking, self.dtype))
        if self.owner.fail_copy:
            self.owner.fail_copy = False
            raise RuntimeError('copy interrupted')
        self.values = list(source.values)
        return self

    def record_stream(self, stream):
        self.owner.log.append(('record_tensor', self.device.type, stream.name))

    def clone(self):
        return FakeTensor(self.owner, self.values, self.device, self.dtype)


class FakeStream:
    def __init__(self, cuda, name, device):
        self.cuda, self.name, self.device = cuda, name, device

    def wait_stream(self, stream):
        self.cuda.owner.log.append(('wait_stream', self.name, stream.name))

    def wait_event(self, event):
        self.cuda.owner.log.append(('wait_event', self.name, event.number))

    def synchronize(self):
        self.cuda.owner.log.append(('sync_stream', self.name))

    def __enter__(self):
        self.cuda.owner.log.append(('enter_stream', self.name))

    def __exit__(self, *_):
        self.cuda.owner.log.append(('exit_stream', self.name))


class FakeEvent:
    def __init__(self, cuda, number):
        self.cuda, self.number, self.complete = cuda, number, False

    def record(self, stream):
        self.cuda.owner.log.append(('record_event', self.number, stream.name))
        if self.cuda.fail_record_on == self.number:
            raise RuntimeError('event interrupted')

    def query(self):
        return self.complete

    def synchronize(self):
        self.cuda.owner.log.append(('sync_event', self.number))
        self.complete = True


class FakeCuda:
    def __init__(self, owner):
        self.owner, self.streams, self.events = owner, [], []
        self.available, self.fail_record_on = True, None
        self.current = FakeStream(self, 'producer-consumer', FakeDevice('cuda:1'))

    def is_available(self):
        return self.available

    def device_count(self):
        return 2

    def Stream(self, device):
        stream = FakeStream(self, 'transfer-' + str(len(self.streams)), device)
        self.streams.append(stream)
        self.owner.log.append(('new_stream', stream.name, device.type, device.index))
        return stream

    def current_stream(self, device):
        self.owner.log.append(('current_stream', device.type, device.index))
        return self.current

    def stream(self, stream):
        return stream

    def Event(self):
        event = FakeEvent(self, len(self.events))
        self.events.append(event)
        return event


class FakeTorch:
    Tensor, strided = FakeTensor, 'strided'
    nn = types.SimpleNamespace(Parameter=type('FakeParameter', (FakeTensor,), {}))
    device = FakeDevice

    def __init__(self):
        self.log, self.fail_copy = [], False
        self.cuda = FakeCuda(self)

    def empty_like(self, tensor, device, pin_memory=False):
        target = FakeDevice(device)
        self.log.append(('allocate', target.type, target.index, pin_memory, tensor.dtype))
        return FakeTensor(self, [0] * tensor.numel(), target, tensor.dtype)


class CudaStagingContractTests(unittest.TestCase):
    def test_selected_streams_pinned_storage_precision_and_release_order(self):
        fake = FakeTorch()
        with patch.dict(sys.modules, {'torch': fake}):
            with vram.ActivationStore(64, device='cuda:1') as store:
                tensor = FakeTensor(fake, [0.125, -2.0, 3.25])
                ticket = store.stage(tensor)
                self.assertIn(('allocate', 'cpu', None, True, 'bfloat16'), fake.log)
                self.assertIn(('wait_stream', 'transfer-0', 'producer-consumer'), fake.log)
                self.assertIn(('wait_event', 'producer-consumer', 0), fake.log)
                restored = store.restore(ticket)
                self.assertEqual(restored.device, FakeDevice('cuda:1'))
                self.assertEqual(restored.dtype, tensor.dtype)
                self.assertEqual(restored.values, tensor.values)
                self.assertIn(('wait_event', 'transfer-1', 0), fake.log)
                self.assertIn(('wait_event', 'producer-consumer', 1), fake.log)
                self.assertIn(('record_tensor', 'cuda', 'producer-consumer'), fake.log)
                self.assertEqual(store.stored_bytes, 6)
                self.assertTrue(store.release(ticket))
                self.assertEqual(fake.log[-2:], [('sync_event', 0), ('sync_event', 1)])
                self.assertEqual(store.stored_bytes, 0)
            self.assertTrue(all(stream.device == FakeDevice('cuda:1') for stream in fake.cuda.streams))

    def test_pending_restore_lifetimes_are_bounded_and_host_borrow_waits(self):
        fake = FakeTorch()
        with patch.dict(sys.modules, {'torch': fake}):
            with vram.ActivationStore(64, device='cuda:1', max_inflight_restores=2) as store:
                ticket = store.stage(FakeTensor(fake, [1, 2]))
                for _ in range(3):
                    store.restore(ticket)
                self.assertIn(('sync_event', 1), fake.log)
                self.assertEqual(len(store._entries[ticket._number].restores), 2)
                with store.borrow_host(ticket) as host:
                    self.assertEqual(host.values, [1, 2])
                    self.assertEqual(fake.log[-1], ('sync_event', 0))
                    self.assertEqual(store.stored_bytes, 4)
            self.assertEqual(store.stored_bytes, 0)
            self.assertIn(('sync_event', 3), fake.log)

    def test_copy_and_restore_errors_wait_before_reclaiming_pinned_memory(self):
        fake = FakeTorch()
        with patch.dict(sys.modules, {'torch': fake}):
            with vram.ActivationStore(64, device='cuda:1') as store:
                fake.fail_copy = True
                with self.assertRaisesRegex(RuntimeError, 'copy interrupted'):
                    store.stage(FakeTensor(fake, [1, 2]))
                self.assertIn(('sync_stream', 'transfer-0'), fake.log)
                self.assertEqual(store.stored_bytes, 0)
                ticket = store.stage(FakeTensor(fake, [1, 2]))
                fake.cuda.fail_record_on = 1
                with self.assertRaisesRegex(RuntimeError, 'event interrupted'):
                    store.restore(ticket)
                self.assertIn(('sync_stream', 'transfer-1'), fake.log)
                self.assertEqual(store.stored_bytes, 4)

    def test_unavailable_or_wrong_devices_never_fall_back_to_cpu(self):
        fake = FakeTorch()
        with patch.dict(sys.modules, {'torch': fake}):
            fake.cuda.available = False
            with self.assertRaisesRegex(RuntimeError, 'CPU fallback is disabled'):
                vram.ActivationStore(64, device='cuda:1')
            self.assertEqual(fake.cuda.streams, [])
            fake.cuda.available = True
            with vram.ActivationStore(64, device='cuda:1') as store:
                with self.assertRaises(ValueError):
                    store.stage(FakeTensor(fake, [1], device='cuda:0'))
            for device in ('cuda', 'cuda:2', 'mps'):
                with self.assertRaises(ValueError):
                    vram.ActivationStore(64, device=device)

    def test_encoder_boundary_only_materializes_one_exact_dtype_frame(self):
        fake = FakeTorch()
        with patch.dict(sys.modules, {'torch': fake}):
            tensor = FakeTensor(fake, [1, 2, 3], contiguous=False)
            with vram.host_tensor(tensor, max_bytes=6) as host:
                self.assertEqual(host.device.type, 'cpu')
                self.assertEqual(host.dtype, tensor.dtype)
                self.assertEqual(host.values, tensor.values)
                self.assertIn(('sync_event', 0), fake.log)
            self.assertEqual(fake.log[-1], ('sync_event', 0))
            count = len(fake.log)
            with self.assertRaises(MemoryError):
                with vram.host_tensor(tensor, max_bytes=5):
                    pass
            self.assertEqual(len(fake.log), count, 'Reject the budget before copying on either device.')


if __name__ == '__main__':
    unittest.main()
