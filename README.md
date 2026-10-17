# Aftertake

**Direct where the impossible happens. And when.**

Aftertake is an open-source VFX studio for short video clips. Paint a region,
set a temporal cue, describe a transformation, and render a remixable take with
open-weight models through the official Comfy SDK.

Open **Recipes** to browse five reviewed effects and camera examples. Search
by direction or tag, play the original and result, inspect the actual settings,
then explore the recorded take or apply its direction to your own source.
Region effects keep your painted cue and timing. Camera recipes keep your scene
description. Previews are actual renders; opening an example requires no Python,
GPU or inference service. Applying a recipe prepares an editable new take.

**Animate a frame** creates a new shot from a photo or a selected video frame.
Choose camera movement, lens character, lighting and palette; save a named film
look and apply it to another source. Camera, lens and lighting use inspectable
prompt instructions to LTX-2.5; camera adherence is currently unreliable. Color
grading is applied consistently after generation. The input frame is
conditioned directly into the video latent. No inpainting adapter is needed
for this mode.

For stronger framing guidance, enable **Guide framing with tracks**. The app
shows the exact screen-space trajectories that enter LTX's motion-control
IC-LoRA and saves its rendered guide alongside the output. Pullback and static
framing have been visually checked; this remains experimental and does not
reconstruct a 3D camera. Add the public 327 MB adapter after installing the
native runtime:

```sh
python scripts/download-models.py --motion
```

Optional motion tracking advects the painted region from an anchor frame using
dense optical flow. A CPU-only preview shows the actual per-frame render mask
before spending GPU time. This is experimental: occlusions, large motion and
untextured surfaces can cause drift. Clear and repaint to choose a new anchor.

The cue releases structural guidance inside the effect region, or supplies a
consistent masked plate to native inpainting. Its temporal envelope controls
the final composite. Outside the cue, source pixels are preserved exactly
**before lossy video encoding**. Paint adds to the region; erase protects detail.

This is an early competition build. Native inpainting and structural guidance
have completed real local renders, including 768-pixel takes. Five examples
include source media, recipes and executed graphs. Visual quality remains
experimental, and competition submission is still outstanding. See
[build evidence](docs/progress.md) and the [Higgsfield feature benchmark](docs/higgsfield-benchmark.md).
New region-edit exports preserve source sound at the selected trim point. Frame
animation is silent. Rotated and mirrored phone footage uses the same upright
orientation in the browser, cue preview and render.

The film desk joins up to eight finished takes with editable cuts. Export a
720p landscape, portrait or square MP4 and a portable shot manifest containing
the source recipes, actual workflows and output hashes. Original sound carries
through; silent takes receive silence. Import a manifest to restore its cut list
when the matching finished takes are present. Assembly needs the Python runtime,
but no GPU or additional model downloads.

## Try the examples first

```sh
pnpm install
pnpm demo
```

Open http://127.0.0.1:4312 to explore five real, pre-rendered examples in a
separate workspace. No Python, GPU or model download is needed for this
walkthrough. You can inspect the cues and export editable recipes and graphs.
Generating new takes requires the runtime below. See
[example provenance and remixing instructions](examples/README.md).

## Run locally

Requirements: Node 22.12+, pnpm, Git, Python 3.12, an NVIDIA CUDA GPU. Current
development machine: RTX 5080 (16 GB) and 32 GB system RAM. The intended
workflow uses memory offloading; the minimum supported hardware is not yet
established. Allow approximately 60 GB disk for the native profile, plus
package caches. Its public artifacts are approximately 41 GB, plus the
1.31 GB inpainting adapter.

```sh
pnpm install
python scripts/setup.py --inpaint
```

Complete the adapter access/download and importer step below before the first
masked edit. Frame animation uses the public weights and can run without that
adapter. For the older structural method, run `python scripts/setup.py`
without `--inpaint` and choose **LTX-2 · structure guidance** in Shot direction.
That profile downloads approximately 28 GB of weights and needs around 45 GB
for runtime and weights.

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

New projects use LTX-2.5 masked edits. If you installed the original LTX-2
profile first, add the native profile's public artifacts with:

```sh
python scripts/download-models.py --ltx25
```

`setup.py --inpaint` avoids downloading the original LTX-2 weights.
`setup.py --skip-models` installs just the runtime and original source study
when you already have the model artifacts.

The dedicated [inpainting adapter](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting)
requires the publisher's Hugging Face access flow. Download its safetensors
file, then install it with:

```sh
python scripts/import-adapter.py /path/to/ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors
```

The importer verifies its published hash. Draft performs a single coarse pass;
Finish adds the two-stage refinement path. Both have completed actual local
inference. Visual quality is still experimental: the model can ignore a prompt
or invent content. The app disables rendering while required files are missing.
For masked edits, describe what belongs inside the painted region.

The native guide uses the spatial mask throughout the clip; easing is applied
when compositing. This avoids fading the green conditioning plate. Finish uses
a 512-pixel coarse pass, a pyramid blend, resize/re-encode and two Euler refinement
steps. Coarse and raw outputs are retained alongside the final take for diagnosis.
The local engine releases its idle model cache after completion so the browser
can recover video-decoding memory on a 16 GB card. The next render may load again.

To use an existing ComfyUI installation, install the `custom_nodes/aftertake`
folder, ComfyUI-GGUF and ComfyUI-LTXVideo, and use the model filenames in
`server/workflow.ts`. Run `comfy-api-proxy` alongside it. Copy `.env.example` to
`.env` to change the engine endpoints. The browser never receives an API key.
Install `av==19.0.1`, `Pillow==12.3.0` and `imageio-ffmpeg==0.6.0` in that engine's
Python environment for orientation and source-audio export. Restart the engine
after updating the custom nodes. The supplied setup installs these dependencies.

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
- Experimental [LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5), its
  [Unsloth GGUF conversion](https://huggingface.co/unsloth/LTX-2.5-GGUF), and
  [in/outpainting adapter](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting)
  retain their respective model licenses. The Gemma 4 encoder retains Google's
  model terms. Download manifests pin the exact revisions and hashes.
- [Gemma 3](https://ai.google.dev/gemma/terms), distributed in a Comfy-compatible
  quantization by [Comfy-Org](https://huggingface.co/Comfy-Org/LTX-2).
- [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) and
  [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF).
- DM Sans and Manrope fonts are bundled locally from Google Fonts under the
  SIL Open Font License; license texts are in `public/fonts/`. The editor does
  not need a font-service connection. Font receipts retain source URLs and hashes.

See [competition evidence](docs/competition.md) for submission gates.
