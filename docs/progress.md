# Build evidence

Aftertake connects a local creative editor to the official Comfy SDK. The
examples include actual outputs, source-bound recipes, executed workflow graphs
and model manifests. These receipts establish what ran; visual quality still
requires reviewing the moving result.

## Painted and timed edits

A cue describes both the region and the interval to change. The generation
workflow uses that direction, and the finishing pass uses the same cue to
composite the result onto its source. Tracking, a reviewed anchor, temporal
fades, feathering and optional boundary color matching are saved in the recipe.
Unchanged source pixels are retained before lossy video encoding.

The [coastal transformation](../examples/coastal-kingdom/) is one reproducible
example. It includes the source, edited reference, result and executed graph.
Its current output is 768 × 432; it does not establish general high-resolution
generation quality. [More recorded examples](../examples/README.md) cover
different inputs and directions.

## Native character replacement

SAM3 selects and tracks a whole person. Native H3 Character Swap uses the source
performance, the tracked person and an appearance reference. The
[high-resolution bridge example](../examples/character-h3-high/) retains the
original source aspect and produces 73 frames at 24 fps, 1536 × 640, without
audio. The bundle includes the comparison source, lossless mask, moving overlay,
source-bound recipe, native operation records and executed graphs.

The fictional reference is shared with the earlier
[H3 example](../examples/character-h3/). The earlier files remain available for
projects bound to their original hashes. Facial articulation is generative;
exact mouth poses, identity, hands and occlusions need review for each new shot.
This is not an audio-driven viseme system. The separate LivePortrait/head
utilities are experimental comparisons, rather than the native H3 workflow.

## Text-to-video and generated sound

**Create video** samples native LTX-2.5 video/audio latents from text. It exposes
2–5 second shots, landscape/portrait/square canvases, draft/final resolution,
optional generated sound, prompt-based camera/lens/light direction and grading.

The [text-to-video bundle](../examples/text-video/) records actual native jobs on
an RTX 5080 with 16 GB VRAM and 32 GB host RAM: a 73-frame landscape draft with
sound (79.92 seconds engine time), a 73-frame final portrait with sound
(82.68 seconds), and a 49-frame silent square draft (61.13 seconds). These are
individual observations, not performance guarantees. The portrait was started
from the studio UI. The separate square job was created, rejoined, inspected
and imported into Film through MCP.

Before importing a completed take, the server verifies its embedded request
and graph, decoded dimensions, frame count, zero-origin 24 fps clock and selected
sound. Generated audio is padded/cropped to the picture duration. Recipes restore
the actual settings, and Film import reuses verified bytes.

Product proportions and exposure can drift between independent takes. These
examples do not demonstrate product-identity locking, long-form generation or
geometric camera control. Generated sound may be quiet or unsuitable and needs
listening review.

## Editing, narration and agent access

Film accepts existing footage, stills and finished takes. Its native CPU renderer
fits media to the selected canvas, assembles frame-based cuts/dissolves, renders
editable typography and mixes source audio with imported or local narration.
Kokoro supplies local speech with measured word timing for the follow-voice
effect. A timeline check or waveform comparison does not replace listening.

The [example films](../examples/README.md) include portable projects, narration
receipts and source-file hashes. MCP agents can inspect footage, save paired
picture/voice plans, export through the same renderer and inspect finished films.
Content checks and idempotency keys allow reconnecting to recorded jobs without
silently starting another operation.

## Engineering checks

The repository includes formatting checks, Node build/tests on Windows and
Linux, and a separate CPU Python media-test job in
[CI](https://github.com/ItsSNOWMOBILE/aftertake/actions/workflows/ci.yml).
The source includes server error/admission/cancellation checks, MCP effect-hint
checks, native graph contracts, film timing tests and asset/hash validation.

Model downloads pin revisions, file sizes and SHA-256 hashes. The browser editor
uses recorded examples; new inference, imports and Film export use the local
studio. Model licenses and media attribution apply separately from the MIT app
license. See the [studio guide](studio-guide.md),
[feature benchmark](higgsfield-benchmark.md) and
[media attribution](media-attribution.md) for setup and limits.
