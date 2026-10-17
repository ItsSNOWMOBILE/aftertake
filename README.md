# Aftertake

**Direct where the impossible happens. And when.**

Aftertake is an open-source VFX studio for short video clips. Paint a region,
set a temporal cue, describe a transformation, and render a remixable take with
open-weight models through the official Comfy SDK.

Optional motion tracking advects the painted region from an anchor frame using
dense optical flow. A CPU-only preview shows the actual per-frame render mask
before spending GPU time. This is experimental: occlusions, large motion and
untextured surfaces can cause drift. Clear and repaint to choose a new anchor.

The spatial/temporal cue has two jobs: release structural guidance inside the
effect region, and composite generated pixels onto the source. Outside the
cue, source pixels are preserved exactly **before lossy video encoding**.

This is an early competition build. The original LTX-2 workflow has completed
real local renders, including a tracked 768-pixel take. Visual quality,
installation portability and competition eligibility are still being verified.
It is not yet a finished entry. See [build evidence](docs/progress.md).

## Run locally

Requirements: Node 22+, pnpm, Git, Python 3.12, an NVIDIA CUDA GPU. Current
development machine: RTX 5080 (16 GB) and 32 GB system RAM. The intended
workflow uses memory offloading; the minimum supported hardware is not yet
established. Allow approximately 45 GB disk for runtime and weights, plus
package caches. First setup downloads approximately 28 GB of weights.

```sh
pnpm install
python scripts/setup.py
```

Then, in two terminals:

```sh
python scripts/engine.py
```

```sh
pnpm dev
```

Open http://127.0.0.1:4310. Installation and rendering run locally. The included
room clip is rendered procedurally from original code, with no external media.
Import a short, steady clip, paint a region, set its cue and render a take.

### Experimental native inpainting

LTX-2.5 masked edits are a separate experimental method in Shot direction.
They require approximately 41 GB of additional public model artifacts:

```sh
python scripts/download-models.py --ltx25
```

The dedicated [inpainting adapter](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting)
requires the publisher's Hugging Face access flow. Download its safetensors
file, then install it with:

```sh
python scripts/import-adapter.py /path/to/ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors
```

The importer verifies its published hash. Draft performs a single coarse pass;
Finish adds the two-stage refinement path. Actual LTX-2.5 execution and quality
are still under validation. The app disables rendering while required files
are missing. For masked edits, describe what belongs inside the painted region.

To use an existing ComfyUI installation, install the `custom_nodes/aftertake`
folder, ComfyUI-GGUF and ComfyUI-LTXVideo, and use the model filenames in
`server/workflow.ts`. Run `comfy-api-proxy` alongside it. Copy `.env.example` to
`.env` to change the engine endpoints. The browser never receives an API key.

## Recipes and reproducibility

Share recipe exports a versioned JSON project: source SHA-256, paint paths,
timing, prompt, seed and render quality. Give a collaborator the source clip
as well. Import the source before importing its recipe; matching uses the
content hash. Render history, source files and outputs persist under `.data/`.
Generated MP4 metadata also includes the recipe and executed graph.

Export ComfyUI workflow produces the actual API-format graph. Replace the
`AftertakeLoadClip` filename `INPUT.mp4` with your uploaded source filename.
This export requires the custom nodes and model files; it is not a bundled
model distribution.

## Development

```sh
pnpm build
pnpm test
.runtime/venv/Scripts/python.exe -m unittest discover -s tests -p "test_*.py"
```

The Node server binds to loopback, the official SDK targets the local v2 proxy,
and the workflow contains no partner inference nodes. Runtime and model files
are ignored by Git. Download receipts record resolved revisions and SHA-256.

## Credits and licenses

App and Aftertake nodes: MIT. Model weights and third-party code retain their
own licenses; the app license does not relicense them.

- [ComfyUI](https://github.com/Comfy-Org/ComfyUI) — GPL-3.0.
- [Comfy SDK](https://github.com/Comfy-Org/comfy-typescript-sdk) and
  [API proxy](https://github.com/Comfy-Org/comfy-api-proxy) — MIT.
- [LTX-2](https://huggingface.co/Lightricks/LTX-2) and
  [Canny IC-LoRA](https://huggingface.co/Lightricks/LTX-2-19b-IC-LoRA-Canny-Control)
  — LTX model license; review the model cards for conditions.
- [Kijai LTXV2 conversions](https://huggingface.co/Kijai/LTXV2_comfy).
- [Gemma 3](https://ai.google.dev/gemma/terms), distributed in a Comfy-compatible
  quantization by [Comfy-Org](https://huggingface.co/Comfy-Org/LTX-2).
- [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) and
  [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
- DM Sans and Manrope fonts are loaded from Google Fonts (SIL Open Font License).

See [competition evidence](docs/competition.md) for submission gates.
