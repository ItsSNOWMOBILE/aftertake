# Media provenance

## Included procedural study

`scripts/create-study.py` renders an original concrete room and a camera move.
The code is MIT licensed. No stock footage, AI image API or external texture
is used to make that source. Model-generated derivatives remain subject to
the model license as well as the source code's license.

## Open film footage

Tears of Steel (2012), Blender Foundation / mango.blender.org.
Downloaded from https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov
for technical VFX testing. Any extracted research clips are silent: the separate
soundtrack has CC BY-ND terms and is not remixed or distributed here.

Before distributing a film-derived example, retain the film's attribution,
verify the applicable CC BY terms for the chosen source, and identify the
changes made (crop, trim, generated VFX). Do not imply an actor endorses the app.

Primary source for the technical-demo use of original footage:
https://mango.blender.org/production/4-tb-original-4k-footage-available-as-cc-by/

The full research download stays ignored under `.runtime/sources/`. Short silent
bridge excerpts supply the bridge character examples. That public character
workflow uses native SAM3 tracking and H3 Character Swap V1.5 with an original
fictional reference generated locally by Z-Image Turbo and an optional crop of
its actual head. The recorded example under `examples/character-h3/` retains
the source, prepared comparison canvas, reference and its generation receipt,
tracked mask, recipe and executed graphs. Its
[`ATTRIBUTION.txt`](../examples/character-h3/ATTRIBUTION.txt) records the film's
CC BY 3.0 credit, modifications and separate H3, adapter and SAM3 model terms.
H3 Relay is installed separately and retains its GPL-3.0/Apache notices; model
weights are downloaded separately. The narrated film credits Blender Foundation
and CC BY 3.0 beside the scene and in its closing card. The film's original
soundtrack is excluded. No actor or creator endorsement is implied.

The earlier Wan-based study remains under `examples/character-replacement/`
with its source, generated human reference and appearance, frame/video recipes
and executed graphs. Its `ATTRIBUTION.txt` identifies the film, license, edits
and reference origin.

`examples/head-performance/` reuses the silent excerpt and brown-jacket base
plate. Its aligned fictional portrait was cropped from frame zero of an actual
Wan Animate focus study. The SDK job, recipe and executed graph are retained in
`portrait-provenance.json`. LivePortrait adds relative head motion and lip
expression, followed by SAM head contours and local fill where the old head is
exposed. The source CC BY 3.0 attribution remains with the example. No original
actor identity or creator endorsement is claimed.

## Licensed demo candidates

Downloaded through Pexels' normal browser download on October 17, 2026.
The [Pexels license](https://www.pexels.com/license/) permits free use and
modification, including in apps and promotional videos. No endorsement is implied.
The app's MIT license does not relicense these clips. Keep author credits in
the demo and alongside any distributed excerpt.

- Curtis Adams, [Empty room with ceiling fan and carpet](https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/).
  Original download SHA-256 and size are retained locally in
  `.runtime/sources/pexels-downloads.json`. Test excerpt: first 101 frames at
  24 fps, resized to 768 × 432 and made silent. Excerpt SHA-256:
  `f734904d279124904dcacb17a9879f3467302fd35a1df41ca9fa9303ce74bad2`.
- Mikhail Nilov, [Waterfall in the middle of the forest](https://www.pexels.com/video/waterfall-in-the-middle-of-the-forest-6989026/).
  Test excerpt: starts at 12 seconds, 101 frames at 24 fps, resized to
  768 × 432 and made silent. Excerpt SHA-256:
  `b56ae4820886f0e33e118604e107b6fcfc34c38c51b732203f52285476912a57`.

Generated derivatives add localized model-generated VFX and temporal blending.
Reviewed source excerpts and generated results are now included under
`examples/portal` and `examples/golden-falls`, with license/credit notes in
`examples/README.md` and a SHA-256 manifest. The bridge character study is
separate from the thirteen-example interactive library and has its own credits.

## Edited-first-frame example

`examples/reference-portal/` uses the same licensed Curtis Adams / Pexels room
source as `portal/`. Its `edited-first-frame.png` is a normalized still extracted
from frame 36 of the earlier Aftertake portal output. The image therefore also
carries the applicable LTX model terms. No closed model or external image-editing
service was used to create this reference. The source recipe and executed graph
are included with the new output.
### Crystal forest / local appearance editing

The seventh example uses the same Mikhail Nilov / Pexels waterfall source as
**The golden falls**. Its turquoise crystal frame was produced locally with
Qwen-Image-Edit-2511 Q4_K_M, the Qwen2.5-VL encoder and the four-step Lightning
adapter; the video was generated with LTX-2.5 and the native inpainting adapter.
The optional Qwen profile's repositories, immutable revisions, hashes and
Apache-2.0 license metadata are recorded in `models-frame-editor.json`.
No new third-party image or closed image API supplied the crystal. The image
recipe, generated PNG, video recipe and actual workflows are included under
`examples/crystal-forest/`. The local ruby-red two-reference test is evidence
only and is not part of the packaged example library.

## Motion-transfer studies

`scripts/create-motion-study.py` draws the articulated blue robot, its joints,
studio background and gesture from original code under the project's MIT
license. The 576 × 768 framing retains the whole gesture. A local audio test
adds an original, quiet synthetic sine tone. No actor footage or external motion
pack supplies these tests.

Mint knitted-bear appearance frames were generated locally with the pinned
Qwen-Image-Edit-2511 profile. Motion was generated locally with the pinned
Wan Animate 2 distilled profile. Their model licenses remain applicable.
The complete Signal workflow is included under `examples/signal/`, and the
first/last-frame forest transition is included under `examples/crystal-transition/`.
Both carry their input images, actual graphs and Qwen frame recipes. The
mirrored-driver comparison and audio-bearing timed variant remain local build
evidence and appeared in an earlier diagnostic demo cut.

The 24-second portrait teaser uses the same reviewed Signal, portal, golden
falls and Reclaimed assets. It scales their displayed frames into captioned
1080 × 1920 layouts; that canvas size does not represent native generation
resolution. It introduces no outside footage, image model or soundtrack.
Pexels and original-robot credits are retained in its closing card and metadata.

## Narrated submission film

The refreshed cinematic candidates also use:

- Dean Diemert, [A lighthouse is seen from above on the coast](https://www.pexels.com/video/a-lighthouse-is-seen-from-above-on-the-coast-20730898/).
  A 4.208-second excerpt starting at three seconds, resized to 768 × 432,
  supplies `coastal-kingdom`. Local Qwen editing creates its castle reference;
  `castle-pullback` animates that edited reference with LTX-2.5 framing tracks.
- Florian Delée, [Drone captures misty mountains in France at sunrise](https://www.pexels.com/video/drone-captures-misty-mountains-in-france-at-sunrise-32651075/).
  A 4.208-second excerpt resized to 768 × 432 supplies `winter-valley`.
  Qwen creates the winter reference; a native LTX masked edit and Aftertake's
  tracked temporal composite produce the green-to-snow-to-green result.

Both sources use the [Pexels License](https://www.pexels.com/license/).
The app excerpts, appearance frames, source hashes, recipes and actual executed
graphs are retained with their examples. Model terms apply separately. These
are demonstrations using credited excerpts and generated derivatives; no
creator endorsement is implied.

The narrated film uses actual Aftertake UI captures, the
credited Pexels coffee and coastal excerpts and the silent Tears of Steel bridge excerpt
with generated VFX. Its titles, cuts and audio mix are exported by Aftertake's
Film editor. The editable project and
original voice clips and their actual model receipts are bound by content hash in `examples/judges-film/project.json`; `examples/submission-film/` provides the same final project for compatibility.

Narration is a generic synthetic preset (`af_heart`) generated locally with
[hexgrad/Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M), whose weights
are Apache-2.0, via the MIT-licensed
[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) CPU runtime. The
conversion release, checksums and runtime version are pinned in
`models-narration.json`. No outside voice recording, identity clone, closed
inference API or music track is used. The transcript and per-clip receipts
remain with the project. Existing model/source terms still apply to the images
and videos. App typography uses the bundled OFL fonts with their license files.

`observatory/source.png` is an original scene generated locally from text with
the public Apache-2.0 [Z-Image Turbo](https://huggingface.co/Comfy-Org/z_image_turbo)
profile. Its prompt, seed 5090, image recipe, PNG metadata and actual SDK job
record are included. LTX-2.5 then generates the guided camera video from that
image; LTX's model terms remain applicable. No outside photograph supplies it.

The vertical **Slow Mornings** concept ads use three matching Michael Burrows
clips under the [Pexels License](https://www.pexels.com/license/):
[coffee pour](https://www.pexels.com/video/pouring-black-coffee-into-a-cup-7118100/),
[coffee grounds](https://www.pexels.com/video/putting-coffee-powder-into-a-paper-filter-7118095/)
and [brewing](https://www.pexels.com/video/pouring-hot-water-into-a-coffee-dripper-7118104/).
Silent ten-second sources are scaled to 720 × 1280 and 24 fps. Source URLs,
original and prepared checksums, editable projects and local narration remain
in `examples/social-ad/`. Slow Mornings is a fictional concept with no real
commercial offer or creator endorsement. Its two hooks are manually prepared
creative variants, not measured ad-performance results.

The earlier Wan-based left-character study uses an original fictional human
reference generated locally with Z-Image Turbo, a detailed Qwen frame edit,
and Wan Animate 2 motion transfer. It replaced the earlier silver-character
demonstration before the native H3 workflow. The reference generation and
normalized import are included in
`examples/character-replacement/character-reference-origin.json` and
`character-reference-import.json`. The original film's CC BY 3.0 attribution
still applies to the resulting scene.

That Wan-based character composite uses local segmentation from the public
Apache-2.0 `facebook/sam2.1-hiera-tiny` model, pinned in `models-matting.json`.
The matte combines the replacement silhouettes and protects the original
woman's foreground hand. Annotations, original raw generation and the matte
receipt are included with the example; model weights are downloaded separately.

The separate performer-focus study in `examples/performer-focus/` reuses that
same silent Tears of Steel excerpt and fictional generated identity. Its
appearance PNG is a normalized import with unchanged decoded pixels. Wan sees
matching cropped driver/reference frames; the generated crop is restored to the
original scene before a newly tracked SAM matte protects the other performer.
The original CC BY 3.0 credit and model licenses still apply. Executed and
portable annotation requests differ only in their relative input paths; source
hashes and annotations match. Research media remains in the full source ZIPs.

The `examples/agent-generation/` headphone concept uses a locally generated
Z-Image Turbo reference and LTX camera take, plus generic local Kokoro narration.
It contains no third-party product photo, stock footage, music or real identity.
Original request seeds, executed graphs, source hashes and model receipts are
included. The image, LTX/IC-LoRA and voice model terms remain separately
applicable; the MIT app license does not replace them.

`examples/script-draft/` reuses the Michael Burrows / Pexels coffee sources
already attributed in `examples/social-ad/ATTRIBUTION.txt`. Its local Qwen3-4B
proposal and two authored wording edits are retained with the result. The
separately downloaded OpenVINO conversion and original Qwen model use Apache-2.0;
exact files are pinned in `models-script.json`. Local Kokoro voices retain their
own receipts. No music, real offer, endorsement or identity cloning is included.

`examples/face-performance/` further refines the lower face of the same silent
Tears of Steel replacement scene using a local video-driven LivePortrait pass.
The source acting, original CC BY 3.0 credit, generated fictional identity,
SAM matte and protected foreground remain applicable. The optional profile pins
official MIT LivePortrait code and six public model files; it excludes InsightFace
detection weights. Model and code revisions are in `models-face-performance.json`.
No narration is used to animate the actor's mouth, and no endorsement is implied.

## Hotel Lobby demonstration

`examples/hotel-lobby/` uses a short excerpt of
[Quavo & Takeoff — HOTEL LOBBY | A COLORS SHOW](https://www.youtube.com/watch?v=x9yop0nYR9g),
published by COLORS on June 17, 2022. The source excerpt is silent in the public
demonstration. SAM3 tracks the performer on the left; H3 changes that performer,
and a tracked-mask postpass restores the surrounding source scene. The
26-second walkthrough adds local generic Kokoro narration and editable type.

The appearance comes from a portrait supplied for this demonstration, rather
than the fictional generated identity used in the bridge examples. Its face
crop is visible in the walkthrough's actual UI captures. The original portrait
file and separate private upload tests are not distributed. The bundled recipe
explains how to substitute your own reference for regeneration.

The COLORS excerpt is credited third-party footage; it is not identified as
Pexels or CC BY footage and is not relicensed under MIT. Source rights and model
terms remain separate. No performer, COLORS or model publisher endorsement is
implied. See the [example notes](../examples/hotel-lobby/README.md) for the exact
source range, preparation, compositing graphs and review limits.

## One-tap effects

The sample photos in `examples/one-tap/photos` were generated in Aftertake with
Z-Image Turbo; each keeps its Create image record with the prompt and seed. The
people in them are fictional, and the products are unbranded. The five songs in
`presets/music` were composed with ACE-Step 1.5 in Aftertake's Song studio, and
each JSON file beside its audio holds the exact Song request. The watermark in
`presets/watermark.png` is drawn from Aftertake's own wordmark. The recorded
effects and the gallery's preview loops in `public/one-tap` were made from these
with LTX-2.5 and the Film renderer on an RTX 5080. No third-party footage, music
or photography is used.
