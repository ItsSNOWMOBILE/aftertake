"""Native Comfy residency choices and explicit, bounded tensor staging. MIT.

Residency changes never change checkpoint bytes, precision, kernels or output
dimensions. ActivationStore is an explicit stage-boundary tool, not an internal
diffusion activation-offload hook. It performs copies only, never inference.
"""
from dataclasses import dataclass, field
from contextlib import contextmanager
import threading
from typing import Any


GIB = 1024 ** 3
MEMORY_MODES = ('auto', 'balanced', 'sequential')


@dataclass(frozen=True)
class MemoryPolicy:
    requested_mode: str
    effective_mode: str
    total_vram_bytes: int | None
    comfy_args: tuple[str, ...]
    reason: str
    safe_weight_copies: bool


def resolve_memory_policy(mode='auto', total_vram_bytes=None, *, safe_weight_copies=False):
    """Choose placement flags, not a hardware compatibility or OOM guarantee.

    Up to 16 GiB uses aggressive native eviction in auto mode. The threshold is
    a residency heuristic, not a minimum supported GPU size. Unknown/high VRAM
    keeps Comfy's default dynamic placement and async transfer configuration.
    Explicit safe copies retain the existing opt-in Windows compatibility flags;
    the caller separately enables AFTERTAKE_SAFE_WEIGHT_COPIES when requested.
    """
    if mode not in MEMORY_MODES:
        raise ValueError('Choose memory mode auto, balanced or sequential.')
    if total_vram_bytes is not None and (
        isinstance(total_vram_bytes, bool) or not isinstance(total_vram_bytes, int)
        or total_vram_bytes <= 0
    ):
        raise ValueError('Total VRAM must be a positive integer byte count, or unknown.')
    if not isinstance(safe_weight_copies, bool):
        raise ValueError('Safe weight copies must be an explicit boolean choice.')
    selected = mode
    if mode == 'auto':
        selected = 'sequential' if total_vram_bytes is not None and total_vram_bytes <= 16 * GIB else 'balanced'
        reason = (
            'Use native eviction and release node results on a device with at most 16 GiB.'
            if selected == 'sequential' else
            'Keep native dynamic VRAM and asynchronous weight offloading defaults.'
        )
    else:
        reason = 'Explicit native sequential residency.' if mode == 'sequential' else 'Explicit native balanced residency.'
    flags = ['--disable-smart-memory', '--cache-none'] if selected == 'sequential' else []
    if safe_weight_copies:
        flags.extend(('--disable-fast-disk', '--async-offload', '1'))
    return MemoryPolicy(mode, selected, total_vram_bytes, tuple(flags), reason, safe_weight_copies)


def _cuda_device_key(device):
    """Require an explicit device; never infer the process's current CUDA index."""
    if isinstance(device, str):
        kind, separator, index = device.partition(':')
        if kind != 'cuda' or not separator or not index.isascii() or not index.isdecimal():
            return None
        return ('cuda', int(index))
    kind, index = getattr(device, 'type', None), getattr(device, 'index', None)
    if kind != 'cuda' or isinstance(index, bool) or not isinstance(index, int) or index < 0:
        return None
    return (kind, index)


def managed_reclaimable_vram_bytes(management, *, idle, device, max_bytes):
    """Observe native cached model residency without changing or evicting it.

    The caller must obtain idle from the native running/pending prompt queues
    and max_bytes from validated selected-device total VRAM minus raw free VRAM.
    Busy or unknown facts return zero. Only Comfy LoadedModel residency on that
    exact device is counted; allocator caches, activation tensors and checkpoint
    file/model sizes are excluded. Native loading retains responsibility for
    eviction/reuse when the next job runs. This is not an OOM guarantee.

    ModelPatcher clones can share one underlying torch module. Count that module
    once, conservatively using the smaller measurement if clones disagree during
    inspection. Keep references alive through the snapshot to avoid identity
    reuse. A dead/unknown wrapper contributes nothing.
    """
    if (
        idle is not True or isinstance(max_bytes, bool) or not isinstance(max_bytes, int)
        or max_bytes <= 0
    ):
        return 0
    try:
        selected = _cuda_device_key(device)
        loaded_models = tuple(management.current_loaded_models)
    except Exception:
        return 0
    if selected is None:
        return 0
    counted = {}
    for loaded in loaded_models:
        try:
            if _cuda_device_key(loaded.device) != selected:
                continue
            patcher = loaded.model
            underlying = patcher.model
            if underlying is None:
                continue
            amount = loaded.model_loaded_memory()
            if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
                continue
            identity = id(underlying)
            previous = counted.get(identity)
            if previous is not None:
                amount = min(amount, previous[1])
            counted[identity] = (underlying, amount)
        except Exception:
            continue
    return min(max_bytes, sum(amount for _, amount in counted.values()))


@dataclass(frozen=True)
class ActivationTicket:
    """Opaque ownership token; it contains no activation data or model state."""
    _owner: object = field(repr=False)
    _number: int


@dataclass
class _StoredActivation:
    host: Any
    byte_count: int
    copied: Any = None
    restores: list[Any] = field(default_factory=list)
    borrows: int = 0


class ActivationStore:
    """Copy completed stage outputs to bounded host storage, then restore them.

    CUDA inputs use pinned CPU storage, dedicated transfer streams on the
    explicitly selected CUDA device, and events that protect both host and GPU
    buffer lifetimes. Restore always returns to that same selected device. CPU
    inputs are supported for already-host-resident data and tiny CPU tests; a
    CUDA store never silently falls back to CPU. Inputs must be nonempty,
    contiguous, dense tensors without autograd or Parameter ownership.

    max_bytes bounds logical live host tensor bytes, including transfers still
    in flight. PyTorch may retain released pinned allocations in its allocator;
    this is not a process RSS cap. Restored tensors belong to the caller and are
    outside this host budget. At most max_inflight_restores transfer events are
    retained per stored tensor. release()/close() wait before reclaiming host
    buffers. Use a context manager or call close(), including on cancellation.

    Legal boundaries include an explicitly released encoder output or completed
    history/window tensor after its producer, with the consumer using restore().
    The caller must drop its original GPU reference to recover residency. This
    class is not automatically wired into H3/LTX and cannot transparently offload
    live internal attention activations, views, model weights or autograd state.
    """

    def __init__(self, max_bytes, *, device, max_inflight_restores=2):
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes <= 0:
            raise ValueError('Activation storage needs a positive integer byte budget.')
        if (
            isinstance(max_inflight_restores, bool) or not isinstance(max_inflight_restores, int)
            or max_inflight_restores <= 0
        ):
            raise ValueError('Use a positive bounded count of restore transfers.')
        import torch
        self._torch = torch
        self.device = torch.device(device)
        if self.device.type not in ('cuda', 'cpu'):
            raise ValueError('Activation storage supports an explicit CUDA device or existing CPU data.')
        if self.device.type == 'cuda':
            if self.device.index is None:
                raise ValueError('Choose an explicit CUDA device index for activation storage.')
            if not torch.cuda.is_available():
                raise RuntimeError('The selected CUDA activation device is unavailable; CPU fallback is disabled.')
            if self.device.index >= torch.cuda.device_count():
                raise ValueError('The selected CUDA activation device does not exist.')
            self._offload_stream = torch.cuda.Stream(device=self.device)
            self._restore_stream = torch.cuda.Stream(device=self.device)
        else:
            self._offload_stream = self._restore_stream = None
        self.max_bytes = max_bytes
        self.max_inflight_restores = max_inflight_restores
        self._owner = object()
        self._next = 0
        self._bytes = 0
        self._entries = {}
        self._closed = False
        self._lock = threading.RLock()

    @property
    def stored_bytes(self):
        with self._lock:
            return self._bytes

    @property
    def stored_count(self):
        with self._lock:
            return len(self._entries)

    def _open(self):
        if self._closed:
            raise RuntimeError('Activation storage is closed.')

    def _ticket_number(self, ticket):
        if not isinstance(ticket, ActivationTicket) or ticket._owner is not self._owner:
            raise ValueError('This activation belongs to a different store.')
        return ticket._number

    def stage(self, tensor):
        """Snapshot an activation without casting, quantizing or running a model.

        Later work on the producer's current CUDA stream waits for the copy.
        Callers remain responsible for synchronizing unrelated external streams
        before modifying a shared tensor, as with ordinary PyTorch operations.
        """
        torch = self._torch
        with self._lock:
            self._open()
            if not isinstance(tensor, torch.Tensor) or isinstance(tensor, torch.nn.Parameter):
                raise ValueError('Stage an activation tensor, not a model parameter.')
            if tensor.device != self.device:
                raise ValueError('Activation staging must use the explicitly selected device.')
            if tensor.requires_grad or tensor.layout != torch.strided or not tensor.is_contiguous():
                raise ValueError('Stage a contiguous dense inference tensor without autograd state.')
            count = tensor.numel() * tensor.element_size()
            if count <= 0:
                raise ValueError('Do not stage empty activations.')
            if count > self.max_bytes - self._bytes:
                raise MemoryError('The activation host-storage budget is exhausted. Release an earlier activation first.')
            host = torch.empty_like(tensor, device='cpu', pin_memory=self.device.type == 'cuda')
            entry = _StoredActivation(host, count)
            if self.device.type == 'cuda':
                stream = self._offload_stream
                producer = torch.cuda.current_stream(self.device)
                try:
                    stream.wait_stream(producer)
                    with torch.cuda.stream(stream):
                        host.copy_(tensor, non_blocking=True)
                        tensor.record_stream(stream)
                        entry.copied = torch.cuda.Event()
                        entry.copied.record(stream)
                    producer.wait_event(entry.copied)
                except BaseException:
                    # A queued copy still owns its pinned destination, even if
                    # recording an event or publishing the ticket failed.
                    stream.synchronize()
                    raise
            else:
                host.copy_(tensor)
            self._next += 1
            ticket = ActivationTicket(self._owner, self._next)
            self._entries[ticket._number] = entry
            self._bytes += count
            return ticket

    def restore(self, ticket):
        """Return a fresh tensor on the original selected device, retaining host data."""
        torch = self._torch
        with self._lock:
            self._open()
            entry = self._entries[self._ticket_number(ticket)]
            if self.device.type == 'cpu':
                return entry.host.clone()
            stream = self._restore_stream
            consumer = torch.cuda.current_stream(self.device)
            entry.restores = [event for event in entry.restores if not event.query()]
            while len(entry.restores) >= self.max_inflight_restores:
                entry.restores[0].synchronize()
                entry.restores.pop(0)
            try:
                stream.wait_event(entry.copied)
                with torch.cuda.stream(stream):
                    restored = torch.empty_like(entry.host, device=self.device)
                    restored.copy_(entry.host, non_blocking=True)
                    done = torch.cuda.Event()
                    done.record(stream)
                consumer.wait_event(done)
                restored.record_stream(consumer)
                entry.restores.append(done)
                return restored
            except BaseException:
                stream.synchronize()
                raise

    @contextmanager
    def borrow_host(self, ticket):
        """Borrow exact CPU values for synchronous encoding after transfer.

        Read the tensor only inside the context. Do not retain or mutate it.
        The store keeps its lock and host reservation while the caller encodes;
        cancellation unwinds the context without releasing an in-flight buffer.
        """
        with self._lock:
            self._open()
            entry = self._entries[self._ticket_number(ticket)]
            if entry.copied is not None:
                entry.copied.synchronize()
            entry.borrows += 1
            try:
                yield entry.host
            finally:
                entry.borrows -= 1

    def release(self, ticket):
        """Wait for copies using a host buffer, then release its budget reservation."""
        with self._lock:
            number = self._ticket_number(ticket)
            entry = self._entries.get(number)
            if entry is None:
                return False
            if entry.borrows:
                raise RuntimeError('Finish encoding the borrowed activation before releasing it.')
            if entry.copied is not None:
                entry.copied.synchronize()
            for event in entry.restores:
                event.synchronize()
            del self._entries[number]
            self._bytes -= entry.byte_count
            return True

    def clear(self):
        with self._lock:
            for number in list(self._entries):
                self.release(ActivationTicket(self._owner, number))

    def close(self):
        with self._lock:
            self.clear()
            self._closed = True

    def __enter__(self):
        self._open()
        return self

    def __exit__(self, *_):
        self.close()


@contextmanager
def host_tensor(tensor, *, max_bytes=64 * 1024 ** 2):
    """Borrow a completed frame on CPU for synchronous encoding, without casting.

    CPU input is already host-resident and is borrowed directly. CUDA input is
    copied through bounded pinned storage on its exact selected device. A dense
    noncontiguous frame is materialized on that device before transfer. The
    caller must encode inside this context or make its own independent output
    array. This does not evict the native graph's original full-batch reference;
    its integration bounds transfer workspace, not internal model activations.
    """
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes <= 0:
        raise ValueError('Activation storage needs a positive integer byte budget.')
    import torch
    if not isinstance(tensor, torch.Tensor) or isinstance(tensor, torch.nn.Parameter):
        raise ValueError('Stage an activation tensor, not a model parameter.')
    if tensor.requires_grad or tensor.layout != torch.strided:
        raise ValueError('Stage a dense inference tensor without autograd state.')
    if tensor.device.type == 'cpu':
        yield tensor
        return
    if tensor.device.type != 'cuda':
        raise ValueError('CPU encoding requires host data or an explicit CUDA transfer; fallback is disabled.')
    # Budget validation precedes a possible contiguous GPU copy.
    if tensor.numel() * tensor.element_size() > max_bytes:
        raise MemoryError('The activation host-storage budget is exhausted.')
    with ActivationStore(max_bytes, device=tensor.device) as store:
        ticket = store.stage(tensor.contiguous())
        with store.borrow_host(ticket) as host:
            yield host
