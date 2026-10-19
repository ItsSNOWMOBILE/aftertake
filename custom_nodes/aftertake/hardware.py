"""CUDA preflight without model loading or changes to model math.

Storage formats are not execution requirements. For example, the pinned H3
encoder explicitly requests BF16 matrix multiplication for its packed NVFP4
weights. Only an explicitly requested native FP8 execution path requires FP8
tensor cores. This module never converts model weights or chooses a fallback.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import importlib
import math
import os
import re
import threading
from typing import Any, Mapping


GIB = 1024 ** 3


class HardwareConfigurationError(RuntimeError):
    """An actionable configuration failure before allocating model weights."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _device_index(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise HardwareConfigurationError(
            'invalid_device', 'Select a non-negative visible CUDA device index.')
    return value


def _gib(value: float, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise HardwareConfigurationError(
            'invalid_memory_budget', f'{label} must be a finite, non-negative number of GiB.')
    return float(value)


@dataclass(frozen=True)
class HardwareConfig:
    backend: str = 'cuda'
    device_index: int = 0
    memory_mode: str = 'auto'
    reserve_vram_gib: float = 3.0
    required_workspace_gib: float = 0.0
    require_native_fp8: bool = False

    def __post_init__(self):
        if self.backend != 'cuda':
            raise HardwareConfigurationError(
                'unsupported_backend',
                'Video diffusion and SAM3 tracking require the NVIDIA CUDA backend. '
                'CPU, MPS and ROCm inference are not enabled by this profile.')
        _device_index(self.device_index)
        if self.memory_mode not in ('auto', 'balanced', 'sequential'):
            raise HardwareConfigurationError(
                'invalid_memory_mode', 'Memory mode must be auto, balanced or sequential.')
        _gib(self.reserve_vram_gib, 'Reserved VRAM')
        _gib(self.required_workspace_gib, 'Required workspace')
        if not isinstance(self.require_native_fp8, bool):
            raise HardwareConfigurationError(
                'invalid_precision_requirement', 'The native FP8 requirement must be true or false.')

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None) -> 'HardwareConfig':
        """Read explicit execution settings; malformed values never use defaults."""
        environment = os.environ if environ is None else environ

        def setting(name: str, default: str) -> str:
            value = environment.get(name, default)
            if not isinstance(value, str) or not value.strip():
                raise HardwareConfigurationError('invalid_environment', f'{name} must have an explicit value.')
            return value.strip()

        index = setting('AFTERTAKE_GPU_DEVICE', '0')
        if not re.fullmatch(r'[0-9]+', index):
            raise HardwareConfigurationError('invalid_device', 'AFTERTAKE_GPU_DEVICE must be a non-negative visible CUDA index.')
        precision = setting('AFTERTAKE_REQUIRE_NATIVE_FP8', '0')
        if precision not in ('0', '1'):
            raise HardwareConfigurationError('invalid_precision_requirement', 'AFTERTAKE_REQUIRE_NATIVE_FP8 must be 0 or 1.')
        try:
            reserve = float(setting('AFTERTAKE_RESERVE_VRAM_GIB', '3'))
            # This is the launcher's configured reservation, not a universal
            # minimum or a claim that every workload fits above this amount.
            workspace = float(setting('AFTERTAKE_REQUIRED_WORKSPACE_GIB', '6'))
        except ValueError as error:
            raise HardwareConfigurationError(
                'invalid_memory_budget', 'VRAM headroom and workspace settings must be finite, non-negative GiB values.') from error
        return cls(
            backend=setting('AFTERTAKE_EXECUTION_BACKEND', 'cuda'), device_index=int(index),
            memory_mode=setting('AFTERTAKE_MEMORY_MODE', 'auto'), reserve_vram_gib=reserve,
            required_workspace_gib=workspace, require_native_fp8=precision == '1',
        )


@dataclass(frozen=True)
class HardwareFacts:
    backend: str
    device_index: int
    name: str
    total_vram_bytes: int
    free_vram_bytes: int
    compute_capability: tuple[int, int]
    native_bf16: bool
    native_fp8: bool
    cuda_version: str | None = None
    torch_version: str | None = None
    device_uuid: str | None = None
    reclaimable_vram_bytes: int = 0
    kernel_probes: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_hardware(facts: HardwareFacts, config: HardwareConfig) -> HardwareFacts:
    """Validate facts and an explicit workspace budget without tensor allocation.

    A successful check is not a promise that every resolution or model fits.
    Required workspace is a caller-supplied budget, separate from OS headroom.
    """
    if facts.backend != 'cuda':
        raise HardwareConfigurationError(
            'unsupported_backend', 'This generation profile requires NVIDIA CUDA; CPU inference is disabled.')
    if facts.device_index != config.device_index:
        raise HardwareConfigurationError(
            'device_mismatch', 'The inspected CUDA device does not match the selected execution device.')
    capability = facts.compute_capability
    if (not isinstance(capability, tuple) or len(capability) != 2 or
            any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in capability)):
        raise HardwareConfigurationError('invalid_hardware_facts', 'CUDA compute capability could not be verified.')
    if not isinstance(facts.native_bf16, bool) or not isinstance(facts.native_fp8, bool):
        raise HardwareConfigurationError('invalid_hardware_facts', 'Native precision support must be verified boolean facts.')
    if capability < (8, 0) or not facts.native_bf16:
        raise HardwareConfigurationError(
            'native_bf16_required',
            f'{facts.name} needs native BF16 tensor cores (CUDA compute capability 8.0 or newer). '
            'Emulated BF16 and unquantized FP32 fallback are not permitted.')
    if config.require_native_fp8 and (capability < (8, 9) or not facts.native_fp8):
        raise HardwareConfigurationError(
            'native_fp8_required',
            f'{facts.name} cannot execute the requested native FP8 path. '
            'Select a CUDA device with native FP8 tensor cores (compute capability 8.9 or newer); '
            'the app will not expand the model into FP32.')
    if (isinstance(facts.total_vram_bytes, bool) or not isinstance(facts.total_vram_bytes, int) or
            isinstance(facts.free_vram_bytes, bool) or not isinstance(facts.free_vram_bytes, int) or
            facts.total_vram_bytes <= 0 or not 0 <= facts.free_vram_bytes <= facts.total_vram_bytes):
        raise HardwareConfigurationError('invalid_hardware_facts', 'Available CUDA memory could not be verified.')
    if (isinstance(facts.reclaimable_vram_bytes, bool) or not isinstance(facts.reclaimable_vram_bytes, int) or
            not 0 <= facts.reclaimable_vram_bytes <= facts.total_vram_bytes - facts.free_vram_bytes):
        raise HardwareConfigurationError(
            'invalid_hardware_facts', 'Verified reclaimable CUDA residency must be within currently occupied device memory.')
    available = facts.free_vram_bytes + facts.reclaimable_vram_bytes
    required = (config.reserve_vram_gib + config.required_workspace_gib) * GIB
    if available <= required:
        raise HardwareConfigurationError(
            'insufficient_vram',
            f'{facts.name} has {facts.free_vram_bytes / GIB:.2f} GiB free plus '
            f'{facts.reclaimable_vram_bytes / GIB:.2f} GiB of verified reclaimable model residency, '
            'but this configuration needs '
            f'more than {config.reserve_vram_gib:.2f} GiB of reserved headroom plus '
            f'{config.required_workspace_gib:.2f} GiB of explicit workspace. '
            'Free GPU memory or choose an appropriate workspace and offload configuration before loading models.')
    return facts


def validate_preflight_report(value: Any, config: HardwareConfig) -> HardwareFacts:
    """Validate the fresh venv subprocess report before launch or downloads.

    This is shared by setup and the supervisor so a partially initialized,
    outdated or malformed runtime cannot bypass native-precision admission.
    """
    def invalid(message: str):
        return HardwareConfigurationError('invalid_preflight_report', message)

    if not isinstance(value, dict) or value.get('format') != 'aftertake-hardware-preflight/1':
        raise invalid('The CUDA runtime returned an unsupported preflight report. Update the runtime before generation.')
    if value.get('ready') is False:
        code = value.get('code', 'preflight_failed')
        message = value.get('error', 'CUDA preflight failed.')
        if (not isinstance(code, str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', code) or
                not isinstance(message, str) or not message.strip()):
            raise invalid('The CUDA runtime returned a malformed preflight failure. Check its diagnostic output.')
        raise HardwareConfigurationError(code, message)
    if value.get('ready') is not True:
        raise invalid('The CUDA runtime did not explicitly confirm a successful preflight.')
    if any(value.get(flag) is not False for flag in ('cpuInference', 'float32Fallback', 'modelWeightsAllocated')):
        raise invalid('The CUDA preflight must verify no model allocation, CPU inference or FP32 fallback before generation.')
    try:
        if not isinstance(value['facts'], dict):
            raise TypeError('Hardware facts must be an object.')
        fields = dict(value['facts'])
        capability, probes = fields['compute_capability'], fields['kernel_probes']
        if not isinstance(capability, (tuple, list)) or not isinstance(probes, (tuple, list)):
            raise TypeError('CUDA capability and kernel probes must be sequences.')
        if len(probes) > 16 or any(not isinstance(item, str) or len(item) > 64 for item in probes):
            raise TypeError('Kernel probe identifiers must be bounded strings.')
        fields['compute_capability'] = tuple(capability)
        fields['kernel_probes'] = tuple(probes)
        facts = HardwareFacts(**fields)
    except (KeyError, TypeError, ValueError) as error:
        raise invalid('The CUDA preflight did not provide complete, valid hardware facts. Update the runtime.') from error
    if facts.reclaimable_vram_bytes != 0:
        raise invalid('A standalone CUDA preflight cannot claim reclaimable Comfy model residency from another process.')
    validate_hardware(facts, config)
    required = {'bf16-matmul-and-optimized-sdpa'}
    if config.require_native_fp8:
        required.add('native-fp8-scaled-matmul')
    if not required.issubset(facts.kernel_probes):
        raise invalid('The CUDA preflight did not execute every required native precision and optimized attention probe.')
    return facts


_VISIBLE_TOKEN = re.compile(r'(?:[0-9]+|GPU-[A-Za-z0-9-]+|MIG-[A-Za-z0-9/-]+)\Z')


def visible_device_token(device_index: int, environ: Mapping[str, str] | None = None) -> str:
    """Resolve an existing visible index without losing UUID/MIG/environment maps."""
    index = _device_index(device_index)
    environment = os.environ if environ is None else environ
    visible = environment.get('CUDA_VISIBLE_DEVICES')
    if visible is None:
        return str(index)
    if not isinstance(visible, str) or not visible.strip() or visible.strip() == '-1':
        raise HardwareConfigurationError(
            'cuda_devices_hidden', 'CUDA_VISIBLE_DEVICES currently hides all CUDA devices.')
    tokens = [token.strip() for token in visible.split(',')]
    if any(not _VISIBLE_TOKEN.fullmatch(token) for token in tokens) or len(set(tokens)) != len(tokens):
        raise HardwareConfigurationError(
            'invalid_visible_devices', 'CUDA_VISIBLE_DEVICES must contain distinct CUDA ordinals, GPU UUIDs or MIG identifiers.')
    if index >= len(tokens):
        raise HardwareConfigurationError(
            'invalid_device', f'Visible CUDA device {index} is outside CUDA_VISIBLE_DEVICES ({len(tokens)} devices).')
    return tokens[index]


def selected_device_environment(device_index: int, environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return child-process overrides only; the selected GPU becomes cuda:0.

    The caller copies its environment and applies these overrides before torch
    or ComfyUI import. This does not mutate this process or promise VRAM pooling.
    """
    return {'CUDA_VISIBLE_DEVICES': visible_device_token(device_index, environ)}


_PROBE_CACHE: dict[tuple[Any, ...], set[str]] = {}
_PROBE_LOCK = threading.RLock()


class NvidiaExecutionBackend:
    """Inspect the selected GPU and probe tiny kernels once per device/runtime.

    Inspection is refreshed for every preflight. Successful kernel probes are
    cached separately; changing the free-memory situation never reuses a stale
    memory admission. Kernel probes do not load any model or change its dtype.
    """

    def __init__(self, config: HardwareConfig | None = None, *, torch_module: Any = None):
        self.config = config or HardwareConfig()
        self._torch_module = torch_module

    def _torch(self):
        if self._torch_module is None:
            try:
                self._torch_module = importlib.import_module('torch')
            except (ImportError, OSError, RuntimeError) as error:
                raise HardwareConfigurationError(
                    'cuda_runtime_unavailable',
                    'The pinned CUDA PyTorch runtime could not be loaded. Run the runtime setup before starting generation.') from error
        return self._torch_module

    def inspect(self) -> HardwareFacts:
        torch = self._torch()
        try:
            if getattr(torch.version, 'hip', None):
                raise HardwareConfigurationError(
                    'unsupported_backend', 'This profile requires the NVIDIA CUDA build of PyTorch; ROCm execution is not enabled.')
            if not getattr(torch.version, 'cuda', None) or not torch.cuda.is_available():
                raise HardwareConfigurationError(
                    'cuda_runtime_unavailable',
                    'NVIDIA CUDA is unavailable. Install the pinned CUDA runtime and a compatible NVIDIA driver; '
                    'video diffusion and SAM3 will not run on the CPU.')
            index = self.config.device_index
            if index >= torch.cuda.device_count():
                raise HardwareConfigurationError(
                    'invalid_device', f'Visible CUDA device {index} does not exist. Check your GPU selection and CUDA_VISIBLE_DEVICES.')
            with torch.cuda.device(index):
                properties = torch.cuda.get_device_properties(index)
                capability = (int(properties.major), int(properties.minor))
                native_bf16 = bool(torch.cuda.is_bf16_supported(including_emulation=False))
                free, total = torch.cuda.mem_get_info(index)
        except HardwareConfigurationError:
            raise
        except (RuntimeError, TypeError, AttributeError, OSError) as error:
            raise HardwareConfigurationError(
                'cuda_inspection_failed',
                'Could not inspect the selected CUDA device with native BF16 validation. '
                'Use the pinned PyTorch runtime and check the NVIDIA driver.') from error
        raw_uuid = getattr(properties, 'uuid', None)
        identity = None if raw_uuid is None else str(raw_uuid)
        return HardwareFacts(
            backend='cuda', device_index=index, name=str(properties.name),
            total_vram_bytes=int(total), free_vram_bytes=int(free), compute_capability=capability,
            native_bf16=native_bf16,
            native_fp8=capability >= (8, 9) and hasattr(torch, 'float8_e4m3fn'),
            cuda_version=str(torch.version.cuda), torch_version=str(torch.__version__), device_uuid=identity,
        )

    def validate(self, facts: HardwareFacts | None = None) -> HardwareFacts:
        return validate_hardware(self.inspect() if facts is None else facts, self.config)

    def _probe_key(self, facts: HardwareFacts) -> tuple[Any, ...]:
        return (id(self._torch()), facts.device_index, facts.device_uuid or facts.name,
                facts.compute_capability, facts.torch_version, facts.cuda_version)

    def _check_result(self, result: Any, torch: Any, label: str, *, expected_device: Any = None):
        if result.dtype != torch.bfloat16 or result.device.type != 'cuda':
            raise RuntimeError(f'{label} did not preserve BF16 execution on CUDA.')
        if expected_device is not None and result.device != expected_device:
            raise RuntimeError(f'{label} did not execute on the selected CUDA device.')
        if not bool(torch.isfinite(result).all().item()):
            raise RuntimeError(f'{label} returned non-finite values.')

    def _run_optimized_sdpa_probe(self, torch: Any, query: Any) -> str:
        # Call compiled operators directly: sdpa_kernel and enable_*_sdp alter
        # process-global flags, including while a different native job runs.
        # These pinned ATen signatures select only this tiny operation and do
        # not change the application's Flash/Sage/Kitchen/SDPA dispatch.
        operators = (
            ('flash', lambda: torch.ops.aten._scaled_dot_product_flash_attention.default(
                query, query, query, 0.0, False, False)),
            ('efficient', lambda: torch.ops.aten._scaled_dot_product_efficient_attention.default(
                query, query, query, None, False, 0.0, False)),
            ('cudnn', lambda: torch.ops.aten._scaled_dot_product_cudnn_attention.default(
                query, query, query, None, False, 0.0, False, False)),
        )
        unavailable = []
        for name, execute in operators:
            try:
                result = execute()[0]
            except (RuntimeError, TypeError, AttributeError) as error:
                detail = (str(error).splitlines() or [type(error).__name__])[0][:160]
                unavailable.append(f'{name}: {detail}')
                continue
            self._check_result(result, torch, f'Compiled {name} BF16 attention', expected_device=query.device)
            if not bool((result == 1).all().item()):
                raise RuntimeError(f'Compiled {name} BF16 attention did not preserve the all-ones probe value.')
            return name
        raise RuntimeError('No compiled optimized BF16 CUDA attention operator was available. ' + '; '.join(unavailable))

    def _run_bf16_probe(self, torch: Any, device: str):
        matrix = torch.ones((16, 16), device=device, dtype=torch.bfloat16)
        self._check_result(matrix @ matrix, torch, 'BF16 tensor-core matrix multiplication', expected_device=matrix.device)
        query = torch.ones((1, 2, 16, 64), device=device, dtype=torch.bfloat16)
        self._run_optimized_sdpa_probe(torch, query)

    def _run_fp8_probe(self, torch: Any, device: str):
        matrix = torch.ones((16, 16), device=device, dtype=torch.bfloat16)
        operand = matrix.to(dtype=torch.float8_e4m3fn)
        # FP8 scaled GEMM requires FP32 scalar scales. These are not expanded
        # model weights or a replacement FP32 execution path.
        scale = torch.ones((), device=device, dtype=torch.float32)
        result = torch._scaled_mm(operand, operand.t(), scale_a=scale, scale_b=scale, out_dtype=torch.bfloat16)
        self._check_result(result, torch, 'Native FP8 scaled matrix multiplication', expected_device=matrix.device)

    def probe(self, facts: HardwareFacts | None = None) -> HardwareFacts:
        facts = self.validate(facts)
        torch = self._torch()
        with _PROBE_LOCK:
            key = self._probe_key(facts)
            completed = _PROBE_CACHE.setdefault(key, set())
            try:
                with torch.cuda.device(facts.device_index), torch.inference_mode():
                    device = f'cuda:{facts.device_index}'
                    if 'bf16-matmul-and-optimized-sdpa' not in completed:
                        self._run_bf16_probe(torch, device)
                        torch.cuda.synchronize(facts.device_index)
                        completed.add('bf16-matmul-and-optimized-sdpa')
                    if self.config.require_native_fp8 and 'native-fp8-scaled-matmul' not in completed:
                        self._run_fp8_probe(torch, device)
                        torch.cuda.synchronize(facts.device_index)
                        completed.add('native-fp8-scaled-matmul')
            except (RuntimeError, TypeError, AttributeError, OSError) as error:
                raise HardwareConfigurationError(
                    'cuda_kernel_probe_failed',
                    f'The selected GPU ({facts.name}) could not execute the required CUDA precision or optimized attention kernel. '
                    'Check the pinned PyTorch/CUDA packages and NVIDIA driver. No CPU or FP32 fallback was attempted.') from error
            return replace(facts, kernel_probes=tuple(sorted(completed)))

    def preflight(self, reclaimable_vram_bytes: int = 0) -> HardwareFacts:
        """Admit against fresh memory and caller-verified idle model residency.

        A native engine may explicitly supply its own inactive loaded-model
        bytes. Startup and other callers default to zero. This is accounting,
        not permission to evict models or infer that other apps can be freed.
        """
        probed = self.probe(replace(self.inspect(), reclaimable_vram_bytes=reclaimable_vram_bytes))
        # CUDA libraries may retain a small workspace after their first call.
        # Admit model allocation against current memory, not the pre-probe value.
        current = self.validate(replace(self.inspect(), reclaimable_vram_bytes=reclaimable_vram_bytes))
        return replace(current, kernel_probes=probed.kernel_probes)
