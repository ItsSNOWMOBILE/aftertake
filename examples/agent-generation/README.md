# An actual agent creation chain

The official MCP client generated `reference.png` through native Z-Image Turbo,
inspected it, rendered `take.mp4` through the local LTX camera workflow, inspected
four actual video frames, and assembled `result.mp4` through native Film. The
2.5-second square concept has one picture, one editable Follow voice title and
one whole local Kokoro line: “Built for your next move.” Generation used an
RTX 5080; this is recorded output, not a hosted generation service.

`image-request.json` and `take-request.json` retain the exact MCP inputs.
`image-generation.json` and `take-generation.json` retain the completed native
records and executed workflows. Stable image/take requests returned their same
native IDs after reconnection and a native studio restart. `plan.json` retains
the content-bound plan and voice/picture ledger; `evidence.json` records hashes,
dimensions, timestamps, complete-voice correlation and the bounded visual review.
`editor.png` is the actual native UI with this project reopened.

To edit without running any generation model:

1. Start the local studio with the CPU film runtime installed.
2. Import `take.mp4` and `voice.wav` through Film → Import media.
3. Import `project.json` through Film → Import film project.

The portable project maps the exact generated take bytes to Film footage.
`native-project.json` is the matching native export manifest and refers to its
original completed take; that form needs the matching generation workspace.
All five supplied word timings and the voice receipt remain in both forms.
Adjust the wording, trims or timings in Film before exporting another revision.

This fictional, unbranded headphone concept uses no third-party product photo,
stock footage, music or identity cloning. The image, video and generic narration
were generated locally. Z-Image Turbo uses Apache-2.0; LTX and its IC-LoRA use
their publisher's separately applicable model licenses; Kokoro uses Apache-2.0.
The LTX text encoder retains Google's Gemma model terms.
See `docs/models-image-generation.json`, `docs/models-ltx25-experimental.json`,
`docs/models-motion-track.json` and `docs/models-narration.json` for exact sources
and license records. MIT
application code does not replace those model terms.

One reviewed short product shot does not demonstrate arbitrary geometry or
identity consistency. General human motion, long shots and freeform creative
direction still need evaluation. Jay retains final creative and listening review.
