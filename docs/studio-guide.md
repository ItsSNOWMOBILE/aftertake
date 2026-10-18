# Studio guide

[← Back to Aftertake](../README.md)

[Try the browser editor](https://aftertake-studio.right-bard-9761.chatgpt.site/studio/) ·
[Review the 44-second ads + VFX demo](https://aftertake-studio.right-bard-9761.chatgpt.site/) ·
[Watch the 72-second tools + workflow review](https://aftertake-studio.right-bard-9761.chatgpt.site/judges/) ·
[Review the native H3 character replacement](https://aftertake-studio.right-bard-9761.chatgpt.site/cast/h3.html) ·
[Watch the narrated-cut workflow](https://aftertake-studio.right-bard-9761.chatgpt.site/ads/workflow.html) ·
[Build evidence](progress.md)

**Your next ad. Your next impossible take.**

Aftertake is an open-source creative studio for short-form ads, product stories
and impossible scenes. Cut footage in portrait, square or landscape; add editable
kinetic typography and local narration. Paint a timed region or direct a
character transformation with open-weight models through the official Comfy SDK.

**Agent creation and editing:** the [local MCP interface](mcp.md) generates
images, edits reference frames, renders native video recipes, inspects actual
results, and assembles measured narration and editable type through Film.
Twenty-seven typed tools retain native operation keys across reconnect and restart.
Editing existing footage works with the small CPU film runtime; new image/video
generation uses the local Comfy engine. Complete recorded examples are in
`examples/agent-edit/` and `examples/agent-generation/`.
[Watch the recorded MCP edit](https://aftertake-studio.right-bard-9761.chatgpt.site/agent/).
[Review the generated product shot and narrated export](https://aftertake-studio.right-bard-9761.chatgpt.site/agent/generate.html).

[Two narrated vertical ads](https://aftertake-studio.right-bard-9761.chatgpt.site/ads/)
show the short-form workflow using matching licensed coffee footage. Their
editable projects, original voice clips and source receipts are included in
`examples/social-ad/`. The opening hooks are manually prepared variants; no
automatic ad optimization or campaign performance is claimed.

**Create a video from words:** the [text-to-video studio](text-video.md)
uses native LTX-2.5 joint video/audio sampling, with 2–5 second shots, three
canvas shapes, draft/final resolution and optional generated sound. Review the
take, reuse its exact settings, export its native graph, or add it to Film.
[See the recorded product shot](https://aftertake-studio.right-bard-9761.chatgpt.site/create/).

**Draft from a brief:** the optional [local script model](script-draft.md)
suggests one short spoken line per described picture and retains an explicit
closing line. Review and edit its suggestions before using the same narrated-cut
builder. It runs on the CPU with open weights; no hosted language-model account
is needed. [Review the actual brief-assisted cut](https://aftertake-studio.right-bard-9761.chatgpt.site/ads/script.html).

**Optional mouth-performance finish:** a separate [local utility](face-performance.md)
uses the original driving video to refine a tracked lower-face region after
character generation. It retains the current head pose and writes a matte and
hash-bound receipt. [Compare the actual candidate](https://aftertake-studio.right-bard-9761.chatgpt.site/cast/performance.html).
This experimental command-line pass is separate from the UI and MCP tools;
head-turn repair and audio-driven dialogue remain incomplete.

**Stable portrait candidate:** the separate [head-performance utility](head-performance.md)
uses a fixed aligned portrait, relative driving-video pose, direct lip expression
and explicit SAM head masks. Its [bridge example](../examples/head-performance/)
retains the body plate and includes both subject arrays and a processing receipt.
This is an experimental local finish requiring visual review, with no audio-driven
dialogue or general head-turn guarantee. It is not yet in the judge-film export.

The **[browser editor](https://aftertake-studio.right-bard-9761.chatgpt.site/studio/)** opens
thirteen real, recorded examples without installation. Paint and erase cues,
change their timing, compare source and result, review edited frames, and
download recipes, portable workflows or the original recorded files. Changes
affect the exported recipe; recorded results stay unchanged. Importing new media,
generation, optical-flow tracking and film export require the local studio below.
The public trial has no inference endpoint and uploads no user media.

## Replace character

Replace character uses a separate native H3 workflow. Pick a person in a
continuous source shot, track their whole body with SAM3, and inspect the moving
selection before generating. Supply the original identity photo, optionally
focus its real head, and choose whether to use its clothing or retain the source
outfit. H3 Character Swap V1.5 receives that photo, the source performance,
tracked latent edit mask and continuation history directly. The frame editor
does not redraw the identity first. Source audio is retained at 24 fps.

The character workspace includes take history, source/result review, reusable
recipes, MP4 downloads and a Film handoff. **Continue in ComfyUI** exports the
actual executed API graph, lossless tracked mask and prepared source; supply
matching original photo/audio files when moving that graph to another engine.
Likeness, fingers, overlapping people and articulation still require visual
review. This feature runs in the local studio; public recorded examples retain
the workflow identified in their receipts.

**Working resolution** is chosen before person tracking. Standard uses H3's
480 preset (up to 0.5 megapixels); High uses its 768 preset (up to 1 megapixel).
Both retain the source aspect ratio with a small crop to the native 32-pixel
grid. Already aligned sources within the selected budget can retain their
original dimensions. The selection preview reports the actual canvas size.
High uses more memory and takes longer; it is a higher generation resolution,
not a guarantee of sharper identity or correct articulation. Changing this
setting requires new tracking, and generation uses that reviewed selection's
resolution. Recipe import, reuse and the MCP selection request retain it.

Install the optional 43.9 GB profile with Python 3.12:

```sh
python scripts/setup.py --character-swap --models-dir /path/to/model-disk
python scripts/engine.py --safe-weight-copies --no-node-cache --ffmpeg-bin /path/to/ffmpeg/bin
```

For an existing character runtime, `python scripts/download-models.py
--character-swap` verifies or resumes just the model downloads. The pinned
[character manifest](models-character-swap.json) includes SAM3, H3, its
encoder/VAEs and both adapters. FFmpeg and FFprobe must be available to the
engine. `--ffmpeg-bin` is optional when both are already on PATH.
`--safe-weight-copies` selects the PyTorch copy fallback for Windows file-backed
host-buffer failures. `--no-node-cache` reduces host memory for native loop jobs;
it can increase execution time. The H3 path is CUDA-based; no NPU inference is
claimed. H3 Relay is installed separately at a pinned revision and retains its
GPL-3.0/Apache notices. Model terms remain separate from Aftertake's MIT code:
[H3](https://huggingface.co/Comfy-Org/MiniMax-H3),
[Character Swap](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA),
[Turbo](https://huggingface.co/lightx2v/Minimax-h3-Turbo),
[SAM3](https://huggingface.co/Comfy-Org/sam3.1).

Open **Recipes** to browse thirteen reviewed effects, camera and motion examples. Search
by direction or tag, play the original and result, inspect the actual settings,
then explore the recorded take or apply its direction to your own source.
Region effects keep your painted cue and timing. Camera recipes keep your scene
description. Previews are actual renders; opening an example requires no Python,
GPU or inference service. Applying a recipe prepares an editable new take.

## Create image

Create image starts from words with local Z-Image Turbo. Choose a landscape,
square or portrait frame, a prompt style and a reproducible seed. The eight-step
workflow uses an empty latent. Styles add inspectable wording to the actual
prompt. Review the generated PNG, download its executed image recipe, or choose
**Animate this image** to bring it into Cinema. That handoff restores the exact
generated image and starts no video job. Import an image recipe to reuse its
prompt, format, look and seed.

The optional public Apache-2.0 profile adds 20.7 GB of pinned model weights:

```sh
python scripts/download-models.py --image-gen
```

For a fresh runtime, use `python scripts/setup.py --image-gen` instead. Model
revisions, sizes and SHA-256 values are in [the image manifest](models-image-generation.json).
Image generation uses the official Comfy SDK and shares the video/frame-edit
admission guard. Uncertain admissions retain their original idempotency key;
output is published as a source clip only after its size and executed PNG graph
match the request. **Above the clouds** includes a real text-generated scene,
its image recipe and the subsequent guided LTX video.

**Edited first frame** guides a masked edit with a full-frame appearance reference.
Export the selected starting frame, edit it while keeping the shot's composition,
then upload the result or choose an imported image. LTX conditions the reference
in both native generation stages; your painted region and temporal cue still
control the final composite. The source video supplies motion and original sound.
This is experimental and does not guarantee arbitrary character/object identity.
Enable **Match source color at boundary** when a generated region has a broad
color cast. It blends that offset into the original scene while keeping fine
generated detail. Review the entire moving boundary, including temporal fades.
Finished videos restore the source aspect ratio after model-grid processing.
The sixth example includes its edited reference, source, result and actual graph.
Share the source **and** edited image with a reference-guided recipe. Both are
bound by content hashes and checked against local bytes before generation.
Changing the source range or choosing a new effect clears the old reference.

## Create an edited frame

Create an edited frame makes that appearance reference inside the studio
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
[the frame-editor manifest](models-frame-editor.json). The generated PNG
also retains its executed workflow metadata.
The seventh example, **The forest keeps a secret**, includes the frame-edit
recipe and its finished LTX video. Image imports retain the original upload's
hash alongside the normalized image's hash, so a shared generated PNG remains
recognizable after metadata removal. Imported recipes bind to the normalized
local file; rendering verifies that file's actual bytes.

## Transfer motion

Transfer motion animates an appearance image with a driving video using
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

**[Focus on one performer](performer-focus.md)** is an experimental option under **Painted and timed
cue**. Use a scene-matched appearance with the same aspect ratio. Adjust the
box to contain the complete gesture: the source and appearance share that
crop, Wan works at the focused resolution, and the result returns to its
original position before compositing. **Focused model output** downloads the
model crop; **Placed generation for finishing** downloads the full-frame
generation for a tracked-matte finish. Focus settings travel with the recipe
and invalidate a saved generation from another setup. This improves the
reviewed bridge head turn; it does not guarantee facial or motion fidelity.

**Whole frame** generates the entire shot without requiring paint. **Painted
and timed cue** composites the generated motion through the existing spatial
mask, tracking and temporal fades. Source sound is preserved at the selected
trim in either mode. Scene-matched appearance images use the same full-frame
transform as the driver. Other reference shapes are center-cropped to its
aspect ratio; inspect the appearance to preview the crop. Share both the driving video and appearance
image with the recipe: both hashes are checked against the actual local files
before submission. The exported graph uses `INPUT.mp4` and `APPEARANCE.png`.

This separate public model profile adds approximately 25 GB. To install only
the motion-transfer runtime/models, use `python scripts/setup.py --motion-transfer`.
For an existing Aftertake runtime, add the profile, then restart the engine:

```sh
python scripts/download-models.py --motion-transfer
```

Revisions, sizes, licenses and SHA-256 values are pinned in
[the motion-transfer manifest](models-motion-transfer.json). The native
workflow uses distinct appearance and raw driving-video conditions, an int8 draft / int4 Finish
motion cache, ten distilled sampling steps, and reference-token removal before
decoding. It contains no closed pose-estimation or inference API. Controlled
original animation tests changed the waved arm when only the driving video
was mirrored, keeping the appearance image, seed and neutral prompts fixed.
This is evidence for that test, not a guarantee of arbitrary human identity,
facial performance or motion fidelity. Review short takes before finishing.
The eighth example, **Signal — a new character**, includes the original robot
animation, generated appearance, Qwen frame recipe and completed Wan transfer.

For a saved motion take, download **Raw generation for finishing**. Under
**Finish a saved generation with a tracked matte**, import that original MP4
and a grayscale video matte, then choose **Composite saved take**. White
selects generated pixels; black protects the source. This reuses the exact
generation without another sampling job. The raw MP4's embedded receipt must
match the source, appearance, seed and generation settings. Both imported
videos are checked against their actual bytes. A new generation setting clears
the finish pair; cue and boundary-color adjustments can be reviewed separately.

The optional local SAM 2.1 helper creates a matte from explicit subject boxes
and clicks, with separate replacement and protected subjects. It requires the
existing runtime plus `transformers==5.20.1`; it downloads about 156 MB of public
Apache-2.0 weights, verified against [the pinned manifest](models-matting.json).
It uploads no video. To reproduce the reviewed bridge matte:

```sh
.runtime/venv/Scripts/python.exe -m pip install transformers==5.20.1
.runtime/venv/Scripts/python.exe scripts/create-motion-matte.py examples/character-replacement/matte-request.json --output .runtime/bridge-matte.mp4
```

Edit the annotation request for other footage and inspect every frame before
finishing. A broad painted region alone can cut a gesture or overwrite another
person. The included example preserves both the full arm and the original
woman's foreground hand; generated head-turn fidelity is still limited.

## Animate a frame

Animate a frame creates a new shot from a photo or a selected video frame.
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
The ninth example, **Between falling water and crystal**, includes both image
guides, the Qwen ending-frame recipe and the actual generated transition.

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
have completed real local renders, including 768-pixel takes. Thirteen examples
include source media, recipes and executed graphs. Visual quality remains
experimental, and competition submission is still outstanding. See
[build evidence](progress.md) and the [Higgsfield feature benchmark](higgsfield-benchmark.md).
New region-edit exports preserve source sound at the selected trim point. Frame
animation is silent. Rotated and mirrored phone footage uses the same upright
orientation in the browser, cue preview and render.

The film desk joins up to 48 finished takes, imported videos or stills. Trim and
reorder cuts, add timed headline/caption/kicker layers with word builds,
typewriter reveals, impact entrances, wipes, fades or rises,
then mix voiceover clips against the original sound. The draft player previews
cuts, titles and audio. Export a 720p landscape, portrait or square MP4 and an
editable `aftertake-film/2` project containing media hashes, source recipes,
actual workflows, title timing and narration receipts. Existing version-1 film
manifests remain readable. Restore a project after importing its original media;
identity follows content hashes, so local asset IDs can differ.

Choose a title's **Motion**, **Entrance seconds**, **Type size** and color, then
click **Replay motion**. The expanded editor keeps its preview beside the title
controls. Motion follows the film clock when playing or scrubbing and exports
as actual video frames, retaining its phase across cuts. Entrance timing is
editable. These entrance presets use their own rhythm. **Follow voice** instead
uses the generated voice's model word timings, with manual per-word adjustment.
Changing the title wording clears those timings. The editable
[four-preset sample](../examples/kinetic-type/project.json) and its
[12-second export](../examples/kinetic-type/preview.mp4) are included.

**[Make a narrated cut](narrated-cut.md)** pairs one written line with each
selected picture. It measures complete local voices before setting cut lengths,
prepares matching editable captions and shows the result in the main viewer.
Choose quick or relaxed pacing, clean, bold or speech-following typography, and frame-based
dissolves. Short picture coverage is rejected with the required duration.
Apply the reviewed cut or restore the previous one. Exact voices are reused
after reconnecting, and unchanged exports rejoin their recorded jobs.
The UI shares the local MCP's beat compiler. The included portrait ad, alternate
hook and 20-second native walkthrough are under `examples/narrated-cut/`.
The [Follow voice example](https://aftertake-studio.right-bard-9761.chatgpt.site/type/spoken.html)
contains twelve timed words from three complete local voices. Its project and
source receipts are in `examples/spoken-type/`. Timing is estimated and editable;
the same pinned Kokoro model supplies it without an extra runtime download.

The bounded LTX workflows now use native video encode/decode instead of forcing
256-pixel, 32-frame tiles. Controlled same-latent comparisons exposed ghosted
edges and motion pulses from those short chunks. The native codec retains
context and lets Comfy choose a fallback if memory requires it. Three refreshed
examples and the measured limits are in
[generation-motion-evidence.json](generation-motion-evidence.json).
To reproduce a real GPU comparison with the installed models and SDK endpoint:

```sh
node scripts/compare-video-codecs.mjs --case=castle-pullback
```

The script also accepts `observatory` and `coastal-kingdom`. It saves original
job IDs and output hashes under `.runtime/codec-comparisons/`, resumes known
jobs and stops for reconciliation if submission has an unknown outcome.

In Film assembly, **Dissolve in** blends a shot into the preceding one. Zero
keeps a direct cut. Dissolves overlap the trims, so the film becomes shorter;
titles and audio keep their absolute timeline positions. The preview and export
use the same 24 fps clock and limit overlap to half of either neighboring shot.

Import your own recording or install optional local Kokoro narration:

```sh
python scripts/setup-narration.py
```

This installs a separate CPU environment and approximately 354 MB of pinned,
hash-checked open weights. Choose a generic preset voice, enter a script and
click **Voice script**. Its WAV, text, voice, speed and model hashes stay with
the film. No external voice API or voice cloning is used. Film export itself
needs the normal Python runtime and no GPU; narration weights are optional.
See [voice model receipts](models-narration.json).

To edit/export films without installing the full generation engine, use
`python scripts/setup-film.py` before `pnpm demo`. This small CPU-only runtime
can import footage and export the bundled submission project. The studio
automatically uses it when the normal engine Python environment is absent.

To reopen the narrated judges’ cut, start `pnpm demo`, then run:

```sh
python scripts/import-film-project.py examples/judges-film/project.json --url http://127.0.0.1:4312
```

In Film assembly choose **Import film project** and select that `project.json`.
The helper verifies and imports its original media and voices by content hash;
the editor resolves completed takes from the bundled examples. The project
retains all 29 cuts, 44 titles and 21 whole outer narration clips, plus the
three voices in its opening ad. Exporting it uses the local
CPU film runtime; revoicing is optional. The 44-second creative review has a
separate project under `examples/submission-film/`.

Film import also restores the supplied voice scripts, model receipts and word
timings after checking their audio hashes and durations. In a short narrated
cut, **Make a narrated cut → Use this film's narration** recovers its authored
lines and settings. Unchanged lines reuse the WAVs, including when switching
from Follow voice to plain typography. New scripts still need the optional
voice runtime. The actual CPU round-trip proof is in
[voice-roundtrip.json](../examples/spoken-type/voice-roundtrip.json).

## Try the examples first

```sh
pnpm install
pnpm demo
```

Open http://127.0.0.1:4312 to explore thirteen real, pre-rendered examples in a
separate workspace. No Python, GPU or model download is needed for this
walkthrough. You can inspect the cues and export editable recipes and graphs.
Generating new takes requires the runtime below. See
[example provenance and remixing instructions](../examples/README.md).
If an older example workspace contains different records, preserve it and use
`pnpm demo --data-dir=.runtime/examples-v5` to open a fresh example workspace.

## Build the public browser trial

```sh
pnpm install --frozen-lockfile
pnpm build:browser-demo
```

This writes the static editor into `docs/studio/`, alongside the existing
landing page. Generated assets and snapshots are excluded from version control;
the small checked-in entry redirects to the current hosted trial until rebuilt.
Its default recorded media snapshot is pinned to a
published commit. The builder verifies every manifest asset and extracts each
recorded take's executed graph from its MP4. Pass `--media-ref=<published SHA>`
to use another published media revision. Publish that media first: the browser
fetches its source clips and results directly from immutable GitHub URLs.
Keep `licenses.txt` and the bundled notices with the generated files. Normal
`pnpm build` and the local server retain the full studio.

To serve the verified media on the same static host, pass
`--media-base=../examples/` and publish that revision's `examples/` directory
beside `studio/`. The builder still checks its manifest, hashes and recorded
execution graphs; only media addresses change. This exposes no inference engine.
An optional `--out-dir=<directory>` writes the static editor elsewhere inside
this checkout. `python scripts/package-showcase.py --output <directory> --source-ref <SHA>`
then adds the reviewed media, landing page and complete source ZIP parts to an
existing `<directory>/studio/` build made from that SHA with relative media URLs.
For a host that does not support video byte ranges, add `--blob-previews` to the
browser build. It prepares the bounded example videos in browser memory before
opening the editor so timeline seeking works. The showcase packager also adds
playback support to the full demo and portrait-review page.

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
pnpm lint
pnpm build
pnpm test
.runtime/venv/Scripts/python.exe -m unittest discover -s tests -p "test_*.py"
```

`pnpm format` applies the shared Prettier style. `pnpm lint` checks that style.
The build also runs the TypeScript compiler. GitHub Actions runs these checks
and Node tests on Windows and Linux, with Python media tests in a separate CPU
job. Its small test environment installs `scripts/requirements-test.txt` and a
CPU build of PyTorch; it does not download generation models. Live engine
contract checks remain a separate local verification against installed nodes.

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

See [architecture and reproducibility](competition.md) for the challenge build and evidence boundaries.
