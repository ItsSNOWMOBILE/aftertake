# Media provenance

## Included procedural study

`scripts/create-study.py` renders an original concrete room and a camera move.
The code is MIT licensed. No stock footage, AI image API or external texture
is used to make that source. Model-generated derivatives remain subject to
the model license as well as the source code's license.

## Research footage (not bundled with the app)

Tears of Steel (2012), Blender Foundation / mango.blender.org.
Downloaded from https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov
for technical VFX testing. Any extracted research clips are silent: the separate
soundtrack has CC BY-ND terms and is not remixed or distributed here.

Before distributing a film-derived example, retain the film's attribution,
verify the applicable CC BY terms for the chosen source, and identify the
changes made (crop, trim, generated VFX). Do not imply an actor endorses the app.

Primary source for the technical-demo use of original footage:
https://mango.blender.org/production/4-tb-original-4k-footage-available-as-cc-by/

This research footage is ignored under `.runtime/sources/`; it is not a
required installation asset or part of the source repository.

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
`examples/README.md` and a SHA-256 manifest. Research footage with actors is
excluded from that bundle.

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
only and is not part of the packaged seven-example library.

## Motion-transfer studies

`scripts/create-motion-study.py` draws the articulated blue robot, its joints,
studio background and gesture from original code under the project's MIT
license. The 576 × 768 framing retains the whole gesture. A local audio test
adds an original, quiet synthetic sine tone. No actor footage or external motion
pack supplies these tests.

Mint knitted-bear appearance frames were generated locally with the pinned
Qwen-Image-Edit-2511 profile. Motion was generated locally with the pinned
Wan Animate 2 distilled profile. Their model licenses remain applicable.
These motion studies are retained as local build evidence; they are not part
of the published seven-example bundle or the current 97-second public demo.
