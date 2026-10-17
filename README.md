# Aftertake

[Try the browser editor](https://itssnowmobile.github.io/aftertake/studio/) ·
[Watch the 97-second demo](https://itssnowmobile.github.io/aftertake/) ·
[Build evidence](docs/progress.md)

**Direct where the impossible happens. And when.**

Aftertake is an open-source VFX studio for short video clips. Paint a region,
set a temporal cue, describe a transformation, and render a remixable take with
open-weight models through the official Comfy SDK.

The **[browser editor](https://itssnowmobile.github.io/aftertake/studio/)** opens
seven real, recorded examples without installation. Paint and erase cues,
change their timing, compare source and result, review edited frames, and
download recipes, portable workflows or the original recorded files. Changes
affect the exported recipe; recorded results stay unchanged. Importing new media,
generation, optical-flow tracking and film export require the local studio below.
The public trial has no inference endpoint and uploads no user media.

Open **Recipes** to browse seven reviewed effects and camera examples. Search
by direction or tag, play the original and result, inspect the actual settings,
then explore the recorded take or apply its direction to your own source.
Region effects keep your painted cue and timing. Camera recipes keep your scene
description. Previews are actual renders; opening an example requires no Python,
GPU or inference service. Applying a recipe prepares an editable new take.

**Edited first frame** guides a masked edit with a full-frame appearance reference.
Export the selected starting frame, edit it while keeping the shot's composition,
then upload the result or choose an imported image. LTX conditions the reference
in both native generation stages; your painted region and temporal cue still
control the final composite. The source video supplies motion and original sound.
This is experimental and does not guarantee arbitrary character/object identity.
The sixth example includes its edited reference, source, result and actual graph.
Share the source **and** edited image with a reference-guided recipe. Both are
bound by content hashes and checked against local bytes before generation.
Changing the source range or choosing a new effect clears the old reference.

**Create an edited frame** makes that appearance reference inside the studio
with local Qwen-Image-Edit-2511 weights. Describe a change, optionally supply a
subject image, and choose a four-step or twenty-step edit. Review the image
before selecting **Use this edited frame**; creation alone does not replace
your current reference or start video generation. The frame editor retains
its source hash, seed, settings, PNG and actual executed graph. Download
**Frame recipe** alongside the source and optional subject to share the image
edit itself. Choose the matching source/start time and use **Import frame recipe**
inside the frame editor to restore its prompt, seed, quality and subject image.
Importing settings starts no generation. Image consistency is experimental;
inspect the full composition.
Reopening the editor restores the latest frame settings for that source and
starting time. **Reuse these settings** loads a viewed history item's direction,
seed, quality and subject reference without starting a job. If its subject image
is missing, import that matching image before reusing the settings.
This optional profile adds approximately 24 GB of model downloads:

```sh
python scripts/download-models.py --frame-edit
```

Run this after installing the normal runtime. It reuses the same engine and
Comfy SDK. Image and video generation share one admission guard in a studio
workspace. Submitted frame jobs persist across restarts; an ambiguous response
can be checked with its original idempotency key rather than creating a new job.
Weights, revisions, checksums and licenses are pinned in
[the frame-editor manifest](docs/models-frame-editor.json). The generated PNG
also retains its executed workflow metadata.
The seventh example, **The forest keeps a secret**, includes the frame-edit
recipe and its finished LTX video. Image imports retain the original upload's
hash alongside the normalized image's hash, so a shared generated PNG remains
recognizable after metadata removal. Imported recipes bind to the normalized
local file; rendering verifies that file's actual bytes.

**Transfer motion** animates an appearance image with a driving video using
local [Wan Animate 2](https://huggingface.co/Comfy-Org/Wan-Animate-2) distilled
weights. Choose a video source, switch to Transfer motion, then upload/select
an **Appearance image** or create one with the optional Qwen frame editor.
Describe the finished character and scene in **Your direction**. The optional
**Driving motion** caption describes the action in the source. Match pose,
framing and body proportions; leave space for the full gesture.

**Motion strength** adjusts how strongly Wan follows the driving video, from
0.50 to 1.50. The model default is 1.00. Higher values can emphasize a gesture
and also exaggerate details; use a short take to review the tradeoff. **Reset**
restores the default. The value survives sharing/import, changes take matching
and reaches the native workflow. Existing recipes retain their original default.

**Whole frame** generates the entire shot without requiring paint. **Painted
and timed cue** composites the generated motion through the existing spatial
mask, tracking and temporal fades. Source sound is preserved at the selected
trim in either mode. Appearance images are center-cropped to the video's
aspect ratio without stretching; inspect the appearance to preview the crop. Share both the driving video and appearance
image with the recipe: both hashes are checked against the actual local files
before submission. The exported graph uses `INPUT.mp4` and `APPEARANCE.png`.

This separate public model profile adds approximately 25 GB. To install only
the motion-transfer runtime/models, use `python scripts/setup.py --motion-transfer`.
For an existing Aftertake runtime, add the profile, then restart the engine:

```sh
python scripts/download-models.py --motion-transfer
```

Revisions, sizes, licenses and SHA-256 values are pinned in
[the motion-transfer manifest](docs/models-motion-transfer.json). The native
workflow uses distinct appearance and raw driving-video conditions, an int8 draft / int4 Finish
motion cache, ten distilled sampling steps, and reference-token removal before
decoding. It contains no closed pose-estimation or inference API. Controlled
original animation tests changed the waved arm when only the driving video
was mirrored, keeping the appearance image, seed and neutral prompts fixed.
This is evidence for that test, not a guarantee of arbitrary human identity,
facial performance or motion fidelity. Review short takes before finishing.

**Animate a frame** creates a new shot from a photo or a selected video frame.
Choose camera movement, lens character, lighting and palette; save a named film
look and apply it to another source. Camera, lens and lighting use inspectable
prompt instructions to LTX-2.5; camera adherence is currently unreliable. Color
grading is applied consistently after generation. The input frame is
conditioned directly into the video latent. No inpainting adapter is needed
for this mode.

Add an optional **Ending frame** to give the shot a destination. Choose an
imported image, upload a PNG/JPEG/WebP, or **Create an ending frame** with the
local Qwen editor. Review the image before selecting **Use as ending frame**.
The model then generates the motion between the selected starting frame and
the ending image. Use the same aspect ratio and describe the transition. Both
images guide generation; the result can differ from either reference.

First/last conditioning has completed actual draft and 768 × 448 / 97-frame
renders, including a draft with motion tracks. It uses the existing public
LTX-2.5 stack and needs no extra weights. The workflow follows the
[official first/last-frame guide](https://docs.ltx.io/open-source-model/usage-guides/image-to-video/#first-and-last-frame):
two image guides, followed by guide-token removal before video decoding. This
is single-stage generation. Share the starting source and ending image with
the recipe; both are content-bound and checked before a render. A shared
generated PNG remains recognizable after metadata normalization, and the
imported recipe binds to the actual normalized file.

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
have completed real local renders, including 768-pixel takes. Seven examples
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

Open http://127.0.0.1:4312 to explore seven real, pre-rendered examples in a
separate workspace. No Python, GPU or model download is needed for this
walkthrough. You can inspect the cues and export editable recipes and graphs.
Generating new takes requires the runtime below. See
[example provenance and remixing instructions](examples/README.md).

## Build the public browser trial

```sh
pnpm install --frozen-lockfile
pnpm build:browser-demo
```

This writes the static editor into `docs/studio/`, alongside the existing
GitHub Pages landing page. Its seven-example media snapshot is pinned to a
published commit. The builder verifies every manifest asset and extracts each
recorded take's executed graph from its MP4. Pass `--media-ref=<published SHA>`
to use another published media revision. Publish that media first: the browser
fetches its source clips and results directly from immutable GitHub URLs.
Keep `licenses.txt` and the bundled notices with the generated files. Normal
`pnpm build` and the local server retain the full studio.

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

For a separate model disk, add `--models-dir /path/to/models` to setup or a
model download. For example, on Windows:

```sh
python scripts/download-models.py --motion-transfer --models-dir E:/Aftertake-Models
```

The ignored `.runtime/model-storage.json` remembers the absolute directory.
Future downloads, the adapter importer and `python scripts/engine.py` reuse it;
the original ComfyUI model folders remain available too. The engine can also
choose/remember it with `--models-dir`. If the saved disk is unavailable,
reconnect it or select a new directory before starting. No model files are
moved or deleted. Restart the engine after adding a profile or changing disks.

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
`AftertakeLoadClip` filenames with your uploaded source and edited-frame filenames.
New graphs use `INPUT.mp4`, `EDITED_FIRST_FRAME.png`, `ENDING_FRAME.png` or
`APPEARANCE.png` placeholders as appropriate; recorded
executed graphs retain the filenames used by ComfyUI.
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

- [Wan Animate 2](https://huggingface.co/Comfy-Org/Wan-Animate-2) motion-transfer
  artifacts and [Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)
  retain their published Apache-2.0 licenses. Conversion and adapter repositories
  are recorded in the corresponding immutable model manifests.

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
