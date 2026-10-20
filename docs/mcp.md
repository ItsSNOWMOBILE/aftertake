# Local agent creation and editing

Aftertake exposes its real local film workflow through a stdio MCP server.
An MCP client chooses the edit using the user's brief and selected assets.
The server supplies media inspection, measured local narration, a persistent
beat plan, native export and decoded review frames. It contains no LLM and
requires no hosted inference service. Forty typed tools cover native image
creation, reference editing, video generation, tracked-person effects, color
finishing, still-image depth effects and narration-first Film editing.
New generation requires the configured local Comfy engine and its model profile.

## Start the studio

Install the repository's Node dependencies, then the small CPU film runtime and
optional local voice runtime:

```sh
pnpm install
python scripts/setup-film.py
python scripts/setup-narration.py
pnpm demo
```

The film runtime includes pinned PyAV, Pillow, NumPy and bundled FFmpeg. It
does not download video models. Narration uses the separately pinned Kokoro
weights and CPU runtime. ComfyUI is needed to generate new images or video,
while editing existing media and voicing this workflow run on the CPU.
Reusing a saved person mask and color finishing also run on the CPU. Estimating
new depth requires the optional native CUDA BF16 depth profile described below.

Compute settings can store remote configuration for the server session and run
read-only account checks. Cloud generation remains blocked until billing,
workflow compatibility and job routing are verified; these tools currently use
the configured local engine for new inference. Comfy credits do not yet activate
remote execution.

Start the MCP process separately. It communicates over stdin/stdout and does
not open a public server:

```sh
pnpm mcp --url http://127.0.0.1:4310 --media-root /absolute/path/to/your/footage
```

For a client configuration, invoke Node directly so package-manager banners
cannot enter the protocol stream. Replace the paths and keep forward slashes
on Windows too:

```json
{
  "mcpServers": {
    "aftertake": {
      "command": "node",
      "args": [
        "/absolute/path/to/aftertake/node_modules/tsx/dist/cli.mjs",
        "/absolute/path/to/aftertake/server/mcp.ts",
        "--url", "http://127.0.0.1:4310",
        "--media-root", "/absolute/path/to/your/footage"
      ]
    }
  }
}
```

A healthy CPU Film environment is preferred for media processing, with the
engine Python as a fallback. Override it with `--python /absolute/path/to/python`
or `AFTERTAKE_PYTHON` when needed; an explicit selection is authoritative.
`--state-dir` changes where persistent plans and derived review frames live.
Plans are separated by studio URL. Imports stay inside the configured media
root, including resolved symbolic links; remote media URLs are not accepted.

## Tools

| Tool | Actual behavior |
| --- | --- |
| `aftertake_editing_guide` | Describes the workflow, constraints and current plan schema. |
| `aftertake_workspace` | Lists imported film pictures/voices, completed takes and exports with IDs and hashes. |
| `aftertake_import_media` | Imports a selected local video, still or audio file; identical verified bytes are reused. |
| `aftertake_inspect_picture` | Returns decoded source or take frames at requested times before choosing trims. |
| `aftertake_voice` | Generates local Kokoro narration or rejoins an exact cached script, voice and speed. |
| `aftertake_save_plan` | Checks source hashes, measured speech and picture coverage; saves a portable editable project and timing ledger. |
| `aftertake_detect_beats` | Estimates tempo, beats and likely downbeats of an imported music or video asset, cached by content hash, for cutting shots to the beat. |
| `aftertake_save_film_edit` | Saves a complete native Film project with authored camera keyframes, independently timed typography and music; verifies sources and timing without rendering. |
| `aftertake_export_plan` | Exports through the native Film renderer using a persistent idempotency key. |
| `aftertake_plan_status` | Rejoins the recorded plan and reads actual native export states after client reconnection. |
| `aftertake_review_film` | Returns decoded export frames, timestamps, sample audio diagnostics and embedded-project verification. |
| `aftertake_generation_workspace` | Lists canonical studio sources and actual generation records; optionally checks a model profile without starting work. |
| `aftertake_generate_image` | Starts or rejoins the native Z-Image Turbo workflow with a stable operation `requestId`. |
| `aftertake_generate_video` | Starts or rejoins native LTX-2.5 text-to-video with optional generated sound; returns a completed source clip for Film. |
| `aftertake_edit_frame` | Starts or rejoins native Qwen reference editing with its original source bytes. |
| `aftertake_render_take` | Starts or rejoins the same video recipe and Comfy SDK workflow used by the UI. |
| `aftertake_generation_status` | Finds an operation by kind and original request ID after reconnect; optionally returns its saved graph and actual output state. |
| `aftertake_generation_action` | Cancels or reconciles that same native operation; no automatic new revision is created. |
| `aftertake_use_source` | Hash-verifies and brings a canonical source, generated still or text-video clip into Film; reuses an existing verified copy. |
| `aftertake_draft_script` | Requests optional local Qwen3 copy suggestions for described pictures; identical requests rejoin their persisted draft. |
| `aftertake_script_status` | Reads that same draft's actual proposal and model receipt without applying or voicing anything. |
| `aftertake_rejoin_script` | Rejoins an interrupted native script job using its original request and result cache. |
| `aftertake_character_workspace` | Lists actual character profiles, source clips/photos, tracked selections and character takes. |
| `aftertake_track_character` | Starts or rejoins native whole-person SAM3 tracking with a stable `requestId`. |
| `aftertake_replace_character` | Uses the inspected mask hash, primary photo, optional supporting originals and real face crops in native H3 Character Swap V1.5. |
| `aftertake_character_status` | Rejoins a persisted character selection or take by record ID or original request ID. |
| `aftertake_character_action` | Cancels or reconciles that same character operation. |
| `aftertake_inspect_character` | Decodes actual overlay/result frames for identity, limb, occlusion and continuation review. |
| `aftertake_character_recipe` | Returns source-bound settings, mask provenance, executed graph, native job ID and completed output. |
| `aftertake_effects_workspace` | Lists saved subject, finishing, depth and layered-image jobs plus canonical clips and Film image assets. |
| `aftertake_duplicate_subject` | Composites up to four extra copies of the reviewed source person, or applies masked background blur/exposure, using original pixels and sound. |
| `aftertake_finish_media` | Starts or rejoins a CPU color/texture export with source-hash-bound settings and original frame timing/audio. |
| `aftertake_preview_finish` | Returns one actual processed PNG using the same finishing function as final export; creates no finished clip. |
| `aftertake_compose_layers` | Composites up to eight still-image and adjustment layers with masks, transforms, clipping and 27 blend modes; stable request IDs rejoin saved work. |
| `aftertake_preview_layers` | Returns the actual PNG from the same layer processor as export, without saving a finished image. |
| `aftertake_resolve_layers` | Rebinds a portable layer recipe to imported source and mask images by exact SHA256 before preview or export. |
| `aftertake_depth_effect` | Estimates one still's depth with pinned DA3 Small BF16 weights, then applies depth blur, haze or directional shading. |
| `aftertake_effect_status` | Reads a subject, finishing, depth or layer record by ID or stable request ID; observation starts no new generation. |
| `aftertake_depth_action` | Cancels or reconciles the same accepted depth operation without changing its source or settings. |
| `aftertake_effect_recipe` | Returns editable effect settings and their source/model/media bindings. |
| `aftertake_cancel_finishing` | Requests worker cancellation; `canceling` remains busy until the subprocess closes. |
| `aftertake_refine_blend` | Re-composites a saved native region edit with a different final painted area or source color match, using its original raw video and preserving the original take. No model is invoked. |
| `aftertake_blend_status` | Reads that CPU job by record ID or original request ID, including its processing receipt and completed take. |
| `aftertake_cancel_blend` | Cancels the CPU worker without deleting the original take or starting another generation. |

For saved regional takes, [Refine a saved take’s blend](refining-a-take.md)
explains the supported final-area controls, CPU dependencies and provenance.

`aftertake_import_media` defaults to Film. Set `destination: "studio"` to import
a generation source through the native source normalizer. Inspect a canonical
source or generated still with `aftertake_inspect_picture` using `clipId`;
text-to-video results also use `clipId`, while finished reference/editing takes
use `renderId`. Exactly one media role must be selected. Text-to-video status
and actions use `kind: "video"`; check `profile: "text-video"` in the generation
workspace first. New text videos need no source file. See `text-video.md`.

## Character replacement

Install the optional character profile using the setup commands in the README.
Check `aftertake_character_workspace`, then track one continuous source shot
(1–15 seconds). Positive points select a whole-person detection; exclusions
disambiguate other people and are not a mask-erasing brush. Inspect multiple
actual overlay frames with `aftertake_inspect_character`. Missing limbs, a
second selected person or any lost frame require a corrected selection before
generation. Technical success does not establish mask quality.

Pass that selection's `maskSha256` to `aftertake_replace_character`, with a new
stable `requestId` and the original imported reference photo. An optional
normalized `faceBox` crops that same photo; `wardrobe: "reference"` uses its
outfit, while `"source"` retains source clothing. The default is the reference
outfit. Up to seven supporting `identityReferences` accept separate original
photos of that person, each with its own optional `faceBox`; the primary photo
still determines reference clothing. Additional views use more memory and do
not guarantee better likeness. H3 receives identity, source video, source audio,
latent mask and continuation history. No preliminary Qwen appearance redraw is used.

Poll the same record, inspect the resulting frames and continuation joins,
then promote its completed `clipId` and inspected output hash into Film with
`aftertake_use_source`. The Film asset can enter the normal measured voice,
editable typography and export plan. Downloading or reconnecting never creates
a new take. An uncertain submission retains its stored graph and SDK key.
This remains generative editing; reliable articulation and perfect likeness
are not guaranteed by the tool schema.

## Effects using original pixels

For a duplicate-person shot, track and inspect the person first using the
character tools. Pass that exact `selectionId` and inspected `maskSha256` to
`aftertake_duplicate_subject`, with a stable `requestId`. A request uses
`format: "aftertake-subject-effect/1"`, a name and up to four `copies`. Each copy
has normalized canvas offsets `x`/`y`, `scale` and `opacity`, plus optional
`rotation` in clockwise degrees and `flipX`. The original person stays in the
scene; copies reuse that person's actual performance rather than generating
independent action. Later copies draw over earlier ones. Review collisions,
cutout edges and frame boundaries in the completed video.

Set a copy's optional `color` to a six-digit hex value such as `"#ff2a96"`
for a solid silhouette. Set `behindSubject: true` to protect the original
current-frame person from overlapping copies. Three colored copies with offsets
`0.12`, `0.08` and `0.04` produce editable silhouette echoes; no extra tracking,
diffusion or motion interpolation is required. Omitting these fields preserves
the ordinary source-pixel copy behavior.

Optional `grow` and `feather` adjust the copy edge. `backgroundBlur` and
`backgroundExposureEV` affect the background through the reviewed person mask.
An empty `copies` array makes a background-focus edit without additional people.
The output retains the selection's prepared canvas, complete 24 fps frame count
and selected source sound once. This is not a full-resolution source-clock
replacement for H3. Reusing a complete selection requires the CPU film runtime,
not another SAM/H3 run. For another workspace, save the subject recipe and all
three exact companion files: original source, prepared source and lossless mask.
The browser's import flow validates their hashes before restoring the selection.

Color finishing accepts `format: "aftertake-finishing/1"`, a name, an imported
`clip` and complete `settings`. Start from `defaultFinishingSettings` in
`src/finishing.ts`: all effect strengths zero, `preset: "clean"`, `lookStrength: 0`
and `seed: 42`. Available controls are `exposureEV` (−3 to 3), `contrast`,
`saturation`, `temperature` and `tint` (−1 to 1), plus `sharpen`, `vignette`,
`grain` and `lookStrength` (0 to 1). Presets are `clean`, `warm-film`, `cool-film`,
`noir` and `vintage`; the unsigned 32-bit seed fixes grain per source frame.
Optical controls add `glowStrength`, `halationStrength` and `chromaticStrength`
(0 to 1, default zero), `glowRadius` and `halationRadius` (0 to 32 pixels,
default 8 and 6), and `chromaticOffset` (0 to 8 pixels, default 1.5). Missing
optical fields in older recipes default to disabled effects. The pipeline is
linear-light exposure/white balance, contrast/saturation, film look, highlight
glow/halation, RGB displacement, sharpening, vignette, then grain. See
[optical finishing](finishing.md) for the effect boundaries.

Call `aftertake_preview_finish` with the same request and a `time` inside its
source range; stills use time zero. Preview selects the first source frame at
or after that time and uses the exact export pixel function. It does not certify
the rest of the shot. After review, call `aftertake_finish_media` with a stable
`requestId`; inspect `kind: "finishing"` through `aftertake_effect_status`.
Successful jobs expose an ordinary `clip` for source reuse and Film import.
Zero adjustments with a clean or zero-strength look copy the original file
byte-for-byte. Adjusted videos preserve the original rational frame timestamps,
encode H.264 and mux the original sound once as AAC. Supported inputs fit the
4K pixel budget; videos are at most ten minutes/120 fps with one video and at
most one audio track. Adjusted H.264 exports require even canvas dimensions.

Finishing recipes bind to actual source SHA-256, not a local clip ID alone.
Import matching original footage before restoring settings. Server restart
marks unfinished CPU exports `interrupted`; it does not silently rerun them.
Read the terminal state before deliberately choosing a new operation ID.
Cancellation likewise remains `canceling` until the worker has stopped.

## Still-image depth and light

Install the optional pinned DA3 Small profile (approximately 137 MB):

```sh
python scripts/download-models.py --depth-effects
```

For a fresh native runtime, use `python scripts/setup.py --depth-effects`.
Restart the engine after adding the profile. The Apache-2.0 checkpoint revision,
size and SHA-256 are in [the depth manifest](models-depth-effects.json). Native
DA3 inference uses the selected NVIDIA CUDA GPU in BF16; no CPU/NPU inference
or video-depth support is implemented.

`aftertake_depth_effect` accepts `format: "aftertake-depth-effect/1"`, a name,
an image `clip`, and `settings` from `defaultDepthSettings` in
`src/depth-effects.ts`. Stills must be at least 64 pixels per side, no more than
4096 per side, and no more than 4,194,304 pixels. Adjust `focus`, `blur`, `haze`,
`hazeColor`, `lightAzimuth`, `lightElevation` and `lightStrength`. The model
estimates depth; a CPU pixel pass then applies blur, distance-weighted haze and
directional shading derived from depth gradients. This is a 2.5D approximation,
not measured lighting or a repair for generated geometry, seams or identity.

Poll `kind: "depth"` using the original request ID, inspect the actual depth
preview and finished PNG, and save its model-bound recipe. The UI also downloads
the numeric depth field. Reuse the completed image as a source or animation
reference after review. Use `aftertake_depth_action` for uncertain native job
recovery; a timeout is not permission to submit a duplicate generation.

## Generate, inspect, then edit

Check `aftertake_generation_workspace` with the desired profile, then assign
each deliberate operation a stable `requestId`, such as `product-reference-v1`.
The generation tools accept the native image request, frame-edit request or
video recipe schemas. Retain the complete input and use exactly the same ID
and input to rejoin. Changed inputs under the same key are rejected.

Generate and inspect the reference before animating it. Poll actual generation
status, inspect the completed take, then use its `renderId` and inspected hash
in `aftertake_save_plan`. Voice the intended line before choosing picture
coverage. This keeps generation, measured narration, editable type and export
within the real studio. An agent supplies creative decisions; the MCP contains
no built-in agent or campaign optimizer. The optional native script model can
suggest copy through `aftertake_draft_script`; it uses text descriptions and
requires review. Setup and its actual edited proof are in `script-draft.md`.

The native studio persists caller keys and input digests before SDK submission.
An older running backend is rejected until restarted with the current code.
Observation does not cause another admission. If submission is uncertain, use
`aftertake_generation_action` with `action: "reconcile"`, the original kind and
request ID. Recovery retains the saved graph, original source bytes and SDK
idempotency key, and waits for other generation work before resubmission. A
known job resumes observation. A timeout is not evidence that a job failed.
Create a new operation ID only for a deliberate new revision.

Saved projects carry the voice script, model receipts and any word timings
alongside the audio hash. On import, verified audio regains its supplied receipt;
an imported receipt is identified in the UI. Exact requests reuse those WAVs
without a narration runtime. Timed voices can also supply plain typography.
Saving an older MCP plan enriches its portable voice receipts while preserving
the existing edit, layer IDs and export key. It does not start a new render.

Suggested brief: “Use these coffee clips to make a short vertical concept ad.
Inspect the useful action first. Voice three short lines locally, match each
caption to its line, and leave every cut editable. Show me the export for review.”

The agent should inspect media first, generate speech before finalizing trims,
save the paired beats, then export. Each picture and voice is bound by its
actual SHA-256. A beat cannot silently stretch or loop its picture, truncate
speech, or overlap narration across a dissolve. Captions default to the actual
synthetic voice script. Long lines need additional footage or shorter wording.

The consumer **Make a narrated cut** panel uses this same beat compiler. It
measures one voice per selected picture, prepares matched trims and titles,
and stages the result in the main viewer before applying it. Agent plans can
also set optional title `style`, `position` and `captionTail`; the latter bounds
the caption after the full voice ends. Existing plans retain their defaults.
The actual 20-second marketing walkthrough is in
`examples/narrated-cut/workflow-project.json`, with its UI recordings and voices.

For speech-following typography, request `aftertake_voice` with
`timedWords: true`, then use `animation: "spoken"` in that voice's plan beat.
The compiler derives short phrases from its validated model word timings and
requires the caption to match the voice text. These are duration estimates from
Kokoro, with manual word adjustment available in the native Film editor. No
extra alignment model is needed. Missing or mismatched timings reject the plan
with a clean-caption alternative.

The returned `.project.json` imports into **Film assembly → Import film
project** in the matching workspace. It retains editable cuts, dissolves,
typography and whole voice clips. Repeating the same reviewed plan finds the
same plan identity. A changed beat creates a different plan; existing picture
and voice assets remain reusable.

## Layered still images and advanced grading

Import image and mask files with `aftertake_import_media` using its default Film
destination. `aftertake_effects_workspace` exposes their asset IDs and hashes.
Build an `aftertake-layer-stack/1` request with a bounded canvas and up to eight
layers, **bottom first**. An image layer binds `{ assetId, sha256 }`, a transform,
opacity and blend mode; an adjustment layer carries `FinishingSettings`.
Rectangle, ellipse and imported-image masks remain editable. Preview with
`aftertake_preview_layers`, then save with `aftertake_compose_layers` and a stable
`requestId`. Read its status using `kind: "layers"`.

`aftertake_effect_recipe` returns its portable recipe. Import all exact image
and mask companions on another machine, then call `aftertake_resolve_layers`;
it rebinds hashes without starting a composition. An active LUT additionally
needs its exact `.cube` companion imported through **Color & finish** or the
documented LUT asset endpoint. See [the layer contract](layer-stack.md).

Finishing and adjustment layers share `selectiveColor` (red, orange, yellow,
green, aqua, blue, purple and magenta; each with `hueDegrees`, `saturation` and
`lightness`), monotone `curves` (master, red, green and blue), plus a nullable
hash-bound `lut` descriptor and `lutStrength`. Curves contain 2–16 normalized
anchors, with increasing input positions and nondecreasing output values.
Defaults preserve older recipes. See [grading settings and LUT portability](finishing.md).

## Recovery and review

An export's `planId` and `attempt` determine its native idempotency key. Repeat
that request to rejoin the job. A different edit cannot reuse the same key.
Increment `attempt` only after the previous native export is observed as
failed. A client timeout does not prove failure. Client reconnection was
tested during actual export; this is not a claim that an interrupted server
resumes an external FFmpeg process.

Review source/result timing, framing, subject boundaries and all captions;
listen to the full film. Decoded timestamps, sample peaks and selected frames
do not certify creative quality. The MCP exposes no social-publishing or
competition-submission action.

## Recorded proof

`examples/agent-edit/` contains a real 6.5-second, 720 × 1280 / 24 fps native
export, three original local voice clips, source-bound plan, editable project,
timing ledger and decoded review frames. Licensed Michael Burrows / Pexels
footage is reused from `examples/social-ad/media/`; this is a fictional coffee
concept, not generated footage or an actual commercial offer.

Actual official MCP SDK 2.3.1 clients discovered the tools, rejected an
insufficient picture interval, reused exact imported media and narration,
saved a stable plan, rejoined one export rather than duplicating it, and
reconnected to the persisted plan. The project also imported into the actual
Film editor with all three picture, title and sound tracks. Per-line ASR and
whole-recording correlations were checked separately. A second complete run
used a freshly installed CPU film runtime with unavailable Comfy endpoints.
See `docs/agent-edit-evidence.json` for the measured scope.

`examples/agent-generation/` adds a real local creative chain: a 1024-square
Z-Image product reference, its 97-frame LTX camera take and a 2.5-second square
narrated Film export. The official MCP client inspected the image and take,
retained all five Kokoro word timings, and rejoined the same native operations
after both client reconnect and studio restart. The complete voice correlation
exceeds .9999; the embedded native project matches. The companion portable
project uses the exact take bytes as imported footage for a fresh CPU workspace.
Image, video, voice, both project forms and actual workflow receipts are included.
This one short product shot is the live generation proof; mocked router tests
for other branches are protocol tests, not additional generation evidence.

The server uses the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
v2 packages, pinned in `pnpm-lock.yaml`; their Apache-2.0 and retained MIT
license terms remain applicable. No Higgsfield code or skill was installed
or executed. Its public editing-contract patterns were reference material.
