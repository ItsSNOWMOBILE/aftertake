# Hardware setup and execution policy

The recorded browser editor and local example workspace need no GPU. New video
generation and SAM3 tracking use the NVIDIA CUDA backend. They never fall back
to CPU inference or expand lower-precision models into unquantized FP32.

The pinned generation installer targets **Windows/Linux x86-64 and Python 3.12**.
It installs the pinned CUDA PyTorch stack, checks dependency consistency, and
validates CUDA before downloading model weights. A compatible NVIDIA driver is
required. Other devices can use `pnpm demo`; film editing has its separate CPU
runtime, installed with `python scripts/setup-film.py`.

## Check before downloading models

```sh
python scripts/setup.py --skip-models
python scripts/engine.py --check-only
```

The check runs in Aftertake's virtual environment. It inspects the selected GPU,
native BF16 capability, CUDA runtime, free VRAM and explicit workspace budget,
then executes tiny BF16 matrix multiplication and compiled CUDA attention probes.
The probes call pinned optimized operators directly; they do not change
process-wide attention settings or the model's attention dispatch.
It loads no model weights and starts neither ComfyUI nor a generation.

For the character profile, install FFmpeg and FFprobe on PATH, or provide their
directory to both setup and launch:

```sh
python scripts/setup.py --character-swap --ffmpeg-bin PATH_TO_BIN
python scripts/engine.py --ffmpeg-bin PATH_TO_BIN
```

Use `python scripts/hardware-check.py --json` with the installed runtime's Python
for a machine-readable standalone report. The engine runs that same check
automatically before starting its children. Invalid configuration, missing CUDA,
unsupported precision, failed kernels and insufficient workspace stop setup or
launch with an explicit error.

## GPU selection and memory

```sh
python scripts/engine.py --gpu-index 1 --memory-mode auto
```

The index refers to currently visible GPUs. Existing `CUDA_VISIBLE_DEVICES`
ordinal, UUID and MIG mappings are preserved. The chosen device becomes
`cuda:0` inside the engine, so existing graphs and custom nodes keep their
original device contracts. This selects one GPU per engine; VRAM is not pooled
and no model-parallel execution is claimed.

| Mode | Residency policy |
| --- | --- |
| `auto` | Sequential native eviction through 16 GiB; balanced above it. This is a placement heuristic, not hardware certification. |
| `balanced` | Keep Comfy's dynamic VRAM and asynchronous weight transfer defaults. |
| `sequential` | Release inactive models through native memory management and disable node-result caching. |

Sequential mode uses `--disable-smart-memory --cache-none`. It keeps CUDA model
execution, dynamic VRAM, checkpoint precision and optimized kernels. It does not
enable Comfy's `--lowvram` option, whose non-dynamic path can move text encoding
to the CPU. Transfer overhead can increase on constrained devices; equal
throughput across different GPUs or offload modes is not promised.

Native generation admission also checks that sequential mode is actually active:
aggressive eviction and disabled result caching, CPU intermediate storage, and
no conflicting `--gpu-only` or `--highvram` setting. A manual Comfy launch with
contradictory settings fails explicitly. Balanced mode, including `auto` above
16 GiB, preserves the existing native placement and cache choices.

`--reserve-vram` defaults to 3 GiB and `--workspace-vram` to 6 GiB. The latter is
an explicit admission budget, matching the existing H3 sampling-workspace setting;
it is **not** a measured minimum or a guarantee that every model, duration or
resolution fits. Checks distinguish raw free VRAM from the native engine's
verified, idle, reclaimable model residency. Readiness checks never evict models
or clear the allocator cache. Busy or unknown residency contributes no allowance.

Completed mask/frame encoding can stage CUDA tensors through a bounded pinned
host buffer without changing their dtype or values. The staging utility also
supports transfer back to the selected CUDA device. This bounds stage-transfer
workspace; it does not partition internal attention/UNet activations or release
a full batch still retained by the native graph.

For H3 and LTX video profiles, sequential admission verifies the expected native
VAE's chunked output-buffer API without constructing a model. Native CUDA decoding
can then write finalized chunks into CPU output storage and release the completed
GPU chunks. The native decoder, its overlap handling and kernels remain unchanged.
This uses the pinned engine's existing streaming path; it is separate from the
bounded encoding transfers above. The report describes an expected class API,
not a claim that a particular checkpoint is already loaded.

**Internal denoiser activation offloading is not implemented.** Its live residual
tensors have no safe ownership hook in this pinned engine. Adding that requires a
separately validated upstream integration. Streamed decoder output does not reduce
those internal attention/MLP activation peaks or guarantee that a whole job fits.

## Precision follows execution, not filenames

Native BF16 requires compute capability 8.0 or newer. Native per-tensor FP8
requires 8.9 or newer, with a working runtime/kernel combination. These are
hardware capabilities, not a promise that a particular workflow fits. See
[NVIDIA's datatype matrix](https://nvidia.github.io/TransformerEngine/support_matrix.html).

A 3090 is eligible for the BF16 validation path; requesting
`--require-native-fp8` rejects its unsupported FP8 execution path. The pinned H3
encoder stores NVFP4 weights but explicitly requests BF16 matrix multiplication.
Its filename does not require Blackwell FP4 GEMM. Character generation separately
checks the actual compiled Comfy Kitchen INT8 attention backend. Unsupported
required kernels fail instead of silently selecting a different implementation.

No flags force FP32, disable attention acceleration or rewrite quantization
metadata. Existing FP32 accumulators, scale tensors, audio VAE and compositing
math retain their intended behavior; those are distinct from model fallbacks.

Windows safe weight copies remain an explicit `--safe-weight-copies` option for
the known host-buffer issue. Native transfers remain the default. The opt-in
checks the pinned transfer-hook signature before installing its compatibility
wrapper and preserves tensor bytes, quantization metadata and model math.

## Validation scope

The development host is an RTX 5080 with 16 GB VRAM and 32 GB system RAM.
Tiny native BF16, optimized SDPA, FP8 and H3 INT8 attention probes pass there.
An unmodified native H3 temporal decode loop with a tiny tensor-only test backbone
also confirms that CPU output values match its GPU-canvas result and completed
GPU chunks are released before the next chunk. This loads no neural weights and
is not a full-size memory or image-quality benchmark.
Mocked-device tests cover Ampere/BF16, unsupported native FP8, GPU remapping,
memory pressure, cached residency and failed initialization.

A clean Windows source archive, in a path with spaces and launched from another
folder, has also been checked with a newly installed Python runtime and a separate
frozen frontend dependency install. Dependency consistency, CUDA preflight, the
web build and all 13 recorded examples passed. Model weights were deliberately
excluded. Linux dependency metadata and CPU CI do not certify Linux GPU inference.

**No 3090 or 12 GB end-to-end generation certification is claimed.** Validate
the intended model, dimensions and duration on that device. Hardware preflight
also runs at native Aftertake generation validation; CPU film/compositing jobs
remain separate. Exported workflow schemas, node input/output signatures and
compositing rules are unchanged.
