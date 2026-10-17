# Build evidence — October 17, 2026

Goal remains active: win at least an RTX 5090. No award or completed submission
has been claimed. This is a working prototype with substantial quality work left.

## Verified

- RTX 5080 16 GB / 32 GB RAM, PyTorch 2.11.0 CUDA 13.0, ComfyUI 0.41.0.
- All five original LTX-2 artifacts downloaded and SHA-256 verified.
- Official `@comfyorg/sdk` submits real jobs through the self-hosted v2 proxy.
- Draft renders at 512 × 288 / 49 frames / 16 fps.
- A tracked finish render at 768 × 448 / 97 frames / 24 fps.
- Composite and raw generation files downloaded through the official SDK.
- Brush rasterization, temporal envelope, source preservation, frame mismatch
  rejection and bidirectional optical-flow tracking have automated tests.
- Studio preview opens and plays actual renders. Before/after scrubbing works.
- CPU tracked-mask preview completes in the real editor (the hidden-directory
  `sendFile` issue was fixed and the PNG verified over HTTP).
- Export ComfyUI workflow works through the UI; actual downloaded JSON inspected.
- Model adapter access approved by the user; gated inpainting LoRA downloaded
  through the user's browser and verified against published SHA-256.

## Actual generations

| Local render | Result | Observations |
| --- | --- | --- |
| `a2037bff-931f-414f-ae6f-a6105d768706` | GPU success, 149.14 s | Small mask produced a dull patch. First output save node used `videos`; proxy expects `gifs`. Outputs recovered from verified native history, save node corrected. |
| `2c3b5f86-e8b0-4fca-a960-551273142135` | Complete SDK round trip, 71.91 s | Broad moss coverage produces a clear transformation. CUDA 13 cut sampling from ~93 s to ~12 s on these different draft runs. |
| `8116bdf7-492e-43c3-8105-ac10addcc64a` | Complete SDK round trip, 118.24 s | 768 × 448 / 97 frames with flow-tracked cue. Consistent greenery; boundary quality still needs improvement. |
| `3a9e2e89-095e-45da-bea0-ea45508165f9` | Complete SDK round trip | Live-action actors preserved in composite, but the frost instruction largely failed. This is negative quality evidence, not a successful showcase. |

Videos and recipes are under `.data/`. Contact sheets and source research are
under `.runtime/evidence/` and `.runtime/sources/`. Those folders are ignored.

## Native inpainting execution

All three LTX-2.5 public artifacts and the gated adapter are installed and
SHA-256 verified. Both draft and two-stage finish have executed on the RTX 5080.

| Render | Evidence |
| --- | --- |
| `7394891b-ad76-406e-8216-7762c0097247` | Native draft completed in 75.17 s. Coherent greenery, weaker wall coverage than requested. |
| `39c84d21-c7b7-4e5f-8a08-dbe85bfa3ed5` | Early finish completed in 81.10 s but lost the transformation. Negative quality evidence. |
| `d4b47413-80e8-4a0f-99ad-9e4e44c1aeb4` | Consistent conditioning mask alone did not solve the tiny coarse pass: invented a person. Negative quality evidence. |
| `ca56f918-ba61-4935-86ca-13814f22d56c` | 512-pixel coarse pass and reference samplers retained foliage through refinement, 87.67 s. Coarse, raw and composite outputs inspected. |
| `0bc7df85-955e-4d36-8da2-a9f16bedb77c` | Clear blue portal in the original room study, 83.92 s. Temporal appearance/disappearance visible in the composite. |
| `d02a1b59-26d1-49d3-9075-f38a9b9ae8e7`, `656ceb50-8539-4fa7-9d3b-f9967c1276a4` | Small real-room mask ignored the portal instruction, including with CFG 3. Negative quality evidence. |
| `8acd01c3-b25a-4e3b-a730-a698d3a366e6` | Wider mask and untiled guide produced a clear live-action portal; duplicated a ceiling fixture. |
| `d88fb542-794b-4889-9726-dda98843325e` (isolated install) | Eraser protected the fan, clear portal retained. 80.96 s. Full SDK round trip in the fresh installation. |
| `fe2fd39c-aeb6-4c11-8a97-2bfc8204a094` | Narrow waterfall mask followed the golden-material prompt weakly. Negative quality evidence. |
| `515db4fc-5b10-4fbb-8606-866a695cd9d8` | Wider mask and untiled guide produced visibly glowing golden falls on licensed nature footage. Draft inspected. |
| `2a7c74eb-8313-499e-8276-6d598b0ac6d1` | Protected portal retained through 768 × 448 / 97-frame refinement. Fan remains the source in the final composite. |
| `c729f8fb-5919-4152-be2c-8eeb56c3ffcf` | Golden waterfall retained through 768 × 448 / 97-frame refinement. Surrounding forest restored by the composite. |

Current native guide uses a consistent spatial region, independently of the
temporal composite envelope. Fade-in of the green plate was removed. Finish
uses a 512-pixel coarse pass, Euler ancestral sampling, pyramid blend,
resize/re-encode, two Euler refinement steps with another seed, boundary blend
and exact-source compositing. Presets describe the masked region.

These are quality experiments, not a guarantee that any arbitrary prompt works.
Reference samples and attention/memory settings were checked against the pinned
Lightricks workflow. Larger regions often work better; protect foreground detail
with erase strokes. The original narrow-mask failures remain in local history.

Experimental public weights download with:

```sh
.runtime/venv/Scripts/python.exe scripts/download-models.py --ltx25
```

The resumable downloader retains `.part` files, pins revisions and verifies
SHA-256. It was repaired to resume truncated HTTP responses. Do not restart a
live download solely because an observation times out; inspect its session.

The inpainting adapter has been installed and its receipt is checked in.
No API key or browser cookie was extracted or created. Chrome's automated
download hit `ERR_BLOCKED_BY_CLIENT`; the user completed the ordinary download.

## Installation and reliability checks

- Installed pinned Python dependencies and cloned pinned runtime repositories
  into `.runtime/clean-check`, using `setup.py --skip-models`.
- Reused the already verified model directory through ComfyUI's extra search
  paths; the test did not redownload a second copy of the weights.
- The generated original source video has exactly the same SHA-256 as the
  first installation (`c54ab72b1e49289da2ea7df20e950a492e27a3c791da89d9e74da44031849b4b`).
- Fresh `pnpm install --frozen-lockfile`, production build, eight TypeScript
  tests, seven Python tests, and `pip check` passed.
- Started an isolated ComfyUI on 8198, proxy on 8199 and production studio on
  4311. Imported a clip and rendered through the official SDK.
- Restarted that studio during job `efb3e42f-fb74-4ff3-bfd8-e137f6555e9a`;
  it resumed the same ID. Native queue showed one running job and no pending
  duplicate before and after restart. The output then downloaded successfully.
- Cancellation test `228189b3-f07c-4fdf-9f44-65daba6bd9e9` reached `canceled`,
  and the native queue was empty. Engine log confirms interruption.
- Isolated test processes were stopped after completion; evidence and files
  remain local. This is a fresh installation on the same Windows machine,
  not a claim of testing other operating systems or GPUs.
- Browser video decoding failed under GPU pressure and recovered when idle
  weights were released. Engine reserves 3 GB; completed jobs release the cache.
  The editor's thumbnail videos were replaced with cached CPU-decoded JPEGs.
- UI now has paint/erase, visible brush radius, source range selection, quality
  timing clamping, global render admission state, and source selection on small
  screens. Output download remains `finalizing` until local files are available.
- Fonts are bundled locally under OFL, with source and hash receipts.

## Reviewable example workspace and UI checks

- Three reviewed examples are bundled under `examples/`, with source media,
  recipes, actual MP4-embedded graphs, original render records and SHA-256
  manifest. Research actor footage is excluded.
- `pnpm demo` copies them into `.data-demo` and starts a separate local studio
  on port 4312. Its banner identifies the results as pre-rendered. New output
  still requires an actual connected Comfy engine.
- A separate source copy at `.runtime/no-python-demo` has no Python/runtime
  directory and no engine connection. Its studio on 4313 loaded and played
  all three outputs. Edited workflows exported through the UI without Python.
- Cached source thumbnails cover every 24-fps source position. Trimming to
  0.2 seconds loaded all ten visible filmstrip images without Python.
- Example loader checks passed: repeat initialization is idempotent; different
  existing files are preserved; modified assets and path traversal are rejected.
- The main UI imported a real MP4, loaded its recipe, and rejected a deliberately
  mismatched source hash. Downloaded video SHA-256 matches the stored output.
- Exported native workflow has the expected green-plate node and untiled guide.
  An unchanged historical take now exports its recorded graph; edits export
  the newly built graph. Changed settings are explicitly labeled above playback.
- Before/after source and output both reached `readyState=4` at time 1.5 seconds.
- Chrome at 390 × 844 verified source selection, controls and persistence.
  Brush-control overflow was fixed (`scrollWidth=clientWidth=375`). An unpainted
  project now survives reload; render validation still requires paint.
- Latest suite: ten TypeScript tests and seven Python tests. Production build
  passes. These checks do not imply universal prompt-following or other GPU/OS
  compatibility.

## Higgsfield replacement expansion, October 17

- Public Genjutsu, Cinema Studio, apps/effects and three open-source projects
  were reviewed. Coverage and unimplemented capabilities are tracked in
  `higgsfield-benchmark.md`. No third-party application code was copied.
- REA 6.5.0 completed bounded static analysis of two public Higgsfield scripts;
  203,090 bytes and 48,363 AST nodes, no parse errors. This is partial client
  evidence, not the private backend implementation.
- Added a real LTX-2.5 first-frame animation workflow without the masked-edit
  adapter. PNG/JPEG/WebP imports normalize EXIF orientation to an RGB PNG;
  preview and conditioning use that same normalized reference.
- Added camera/lens/lighting prompt controls, a view of the exact compiled
  encoder prompt, named saved looks and reuse across sources.
- `ade9d68a-6a3f-431d-8970-2b37f482aa4f` / job
  `703bb028-8684-4fed-bea9-c4a682cdc7a0`: 49 frames at 512 × 288,
  16 fps, successfully generated a coherent forward move from a still room.
  Browser playback reached readyState 4 and advanced normally.
- `1279f0f7-4d76-46d7-a900-dbdf89a19359` / job
  `7345d182-8209-4000-8bb3-7bf708c37065`: 97 frames at 768 × 448,
  24 fps. Generation completed, but did not reliably follow the static camera
  or monochrome prompt. This is negative control-adherence evidence.
- Added `AftertakeFilmGrade`: consistent warm/cool/monochrome grading after
  generation, with an untouched source-color option and separate raw output.
  `2b2262f9-899f-47c6-99dd-5fb2198f5ec9` / job
  `b2fcbe60-8045-4235-8038-62f10107a7a0` completed 49 frames. Decoded
  monochrome channel separation is exactly zero across all frames.
  A requested pullback still moved forward; motion-track conditioning is
  being investigated before claiming reliable camera control.
- Actual browser paint/erase/render test
  `f352d93e-92d4-4cca-959a-21ee014a3d55` / job
  `a2186b13-894c-4b87-9b3b-1646ae5e6e27` completed and retained the portal
  and protected fan. Captures show the actual cue, submission and result.
- Live schema integration checks cover all six pipeline/quality combinations,
  checking required inputs and output links without submitting jobs. The first
  animation attempt correctly exposed a missing `bypass` input; fixed and the
  rejected attempt retained. Typed admission rejections now become failed
  takes; transport uncertainty still blocks blind retry.
- Suite: 14 TypeScript and 10 Python tests; production build passes. Photo
  orientation, corrupt imports and deterministic grading are included.
- Four reviewed examples are now bundled (about 14.4 MiB), including actual
  photo animation. The example loader tolerates semantically identical JSON
  formatting while preserving genuinely different existing data.
- GitHub was reconnected by the user, but connector reads still return
  `UNAUTHORIZED`; publication is not yet verified.

### Motion-conditioned framing

- Downloaded the public motion adapter from pinned publisher revision
  `572bb9c9a1ba3d8e8724cce69783ffc2422386db`; 327,309,314 bytes,
  SHA-256 `e279807ee3aa3db1ce60188d665ff83342860367dcd6bac19f8bd5a99a9e1dca`.
  No additional account gate or credentials were needed.
- The app derives 12 screen-space trajectories from the framing direction.
  Its source overlay and native `LTXVDrawTracks` use the same coordinates.
  The guide conditions the IC-LoRA; guide tokens are cropped before decode.
  The exact guide video is downloaded alongside raw and graded results.
- Initial guided attempt `9863fb84-9d63-4684-8176-dceb45a77642` failed because
  the ref0.5 adapter needs pixel dimensions divisible by 64. Draft geometry
  now selects a nearby aspect-preserving 64-pixel grid (576 × 320 for this room).
- `4d104079-d530-47dd-936f-dade1212be0b` / job
  `04f16b30-2195-4cd3-b857-6e0baf1978df`: guided pullback completed. Visual
  inspection shows the room receding and new surrounding space appearing.
- `d6f1b874-8c93-49d4-b4f4-672fa9ddda9e` / job
  `e7385a8d-5401-482a-a2aa-c64336b9c8ab`: stationary tracks held the room's
  framing while the fan moved.
- `60dfef1a-02ef-4151-bb20-a2cfca21c676` / job
  `8c32f17a-7957-48e0-a253-ed891f5c6d9d`: guided finish also completed,
  97 frames at 768 × 448 / 24 fps, with the reference colors retained.
  The full-resolution pullback and its actual guide were visually inspected.
- First-to-last LK features + RANSAC partial-affine scale estimates:
  prompt pullback 1.0857, guided pullback 0.8681, prompt static 1.0487,
  guided static 1.00004. This is a screen-space engineering check on one
  room with different output sizes, not a calibrated 3D camera or controlled
  model benchmark. The directions agree with visual inspection.
- Orbit remains prompt-only. Track guidance, lens look and scene relighting
  need broader footage/scene testing before a reliability claim.
- Five reviewed examples are packaged (about 14.9 MiB), now including the
  successful guided pullback and its actual guide video.
- Latest suite: 15 TypeScript + 10 Python tests. Eight workflow variants pass
  the live required-input and output-link schema checks. Production build passes.
- A 68-second captioned submission-demo draft has been composed from actual
  app captures and generated outputs. Export QA passed: 1,632 decoded frames,
  1280 × 720, 24 fps, exactly 68 seconds, approximately 4.1 MB. Captions and
  representative frames were visually reviewed. No
  simulated progress, cloud inference, voice service or external music is used.
- All five examples played from a fresh data directory with Python set to an
  absent executable and both engine endpoints offline. The guided example
  reached readyState 4 and played; an edited pan workflow exported 12 correctly
  directed tracks without the runtime.
- The five-case manifest verifies all 350 runtime assets (15,607,918 bytes).
  Display titles are curated independently of the original render records;
  original names, timestamps, job IDs and MP4 metadata stay intact.
- At 390 × 844, the animation controls and source picker have no horizontal
  overflow (clientWidth = scrollWidth = 375). A saved film look survived a
  source change and reload. Scene text resets for the new source while the
  film look persists. A reload bug selecting the cue view for an unfinished
  animation was fixed.
- A real rejected SDK submission returned `InvalidWorkflow`, code
  `invalid_workflow`, HTTP 422. Error classification was corrected to recognize
  the high-level SDK `ComfyError` as well as protocol `ApiError`; unknown
  transport results remain ambiguous. Partial workflows can execute a valid
  independent guide output even when the main output is invalid, so successful
  admission alone is not treated as a usable take.

## Sound, upright footage and film assembly — October 17

- The native loader, probe and thumbnails share one display-matrix handler.
  All eight orthogonal rotation/mirror combinations match FFmpeg autorotation.
  Image EXIF normalization remains separate and still strips source metadata.
- Region-edit output node 21 muxes the original first audio stream, starting at
  the same source trim as the visual frames. It copies the encoded picture,
  pads a short audio track with silence and retains recipe/workflow metadata.
  Raw generation and reference-frame animation remain silent.
- Actual SDK masked edit `d8b43e02-0dc3-4d9f-b163-664841ee5745`, job
  `bccc81f3-88a0-4884-b752-2bf64a21ebdf`, completed on the RTX 5080:
  49 upright frames, 512 × 288, 16 fps, 3.0625 seconds. Source has a 90-degree
  display matrix and a procedural two-tone audio fixture. After a 0.5-second
  trim, decoded output has the expected 440 Hz / 880 Hz transition. Evidence:
  `.runtime/evidence/audio-native-proof.json` and `upright-audio-native.jpg`.
- The preview mute control directs sound to exactly one player: source or
  output. Comparison uses the output track. Switching views pauses playback
  and preserves the playhead; metadata load restores the result's position.
- The film desk adds, orders, removes and trims up to eight finished takes.
  Canvas options are 1280 × 720, 720 × 1280 and 720 × 720, all 24 fps.
  It letterboxes to preserve framing, retains source audio and supplies silence
  for silent takes. A CPU-only FFmpeg filter timeline encodes the cuts together.
- Film exports and in-progress state persist. Interrupted assembly is reported
  as failed with its cut list retained. A portable manifest embeds recipes,
  actual workflows and output SHA-256 hashes. Manifest import resolves matching
  local output bytes, independent of render IDs, before restoring the cut list.
- A real three-shot browser export `c1f62857-9fed-4932-b92c-9611fac594ef`
  decoded to exactly 254 frames / 10.583333 seconds. Two additional real exports,
  portrait `e3cc88cb-d2f1-44bd-add0-dba37c19f5ac` and square
  `dcec93a9-47e7-4482-b558-df99cf763cf7`, decoded to exactly 96 frames / 4 seconds,
  retained the two tone frequencies, and had zero sound in the silent second cut.
  Evidence: `.runtime/evidence/film-assembly-proof.json`.
- The first film iteration hit Windows' command-line length limit with full
  motion-track graphs. Metadata now travels in a UTF-8 FFmetadata file. A test
  round-trips over 100 KB including escape characters. A second iteration exposed
  a two-frame mixed-rate shortfall; explicit frame-grid trims and one concat
  filter fixed it. Failed/earlier iterations are retained locally as evidence.
- Manifest download/import passed through the in-app browser. Chrome playback
  reached readyState 4 and played the exported 10.583333-second film. Film controls
  have no horizontal overflow at 1280 × 900 or 390 × 844. Chrome's extension file
  upload setting was unavailable; its UI was tested by adding takes directly.
- Latest suite: 17 TypeScript + 13 Python tests; production build and all eight
  live Comfy workflow contracts pass. No additional GPU generation is required
  for film assembly.
- The captioned demo now includes the actual film desk and reviewed three-shot
  export: `.runtime/demo-output/aftertake-demo-v2.mp4`, exactly 85 seconds,
  2,040 decoded frames, 1280 × 720 at 24 fps, approximately 5.9 MB. The original
  68-second draft is retained. No fabricated app state or render progress is used.
- The example-only workspace still starts without Python or an engine. Its film
  list returns successfully; export reports the missing local runtime explicitly.

## Searchable recipes and first-frame pilots — October 17

- The Recipes library presents five real, reviewed outputs with their source
  previews, actual render settings, direction, attribution and license notices.
  Three region effects and two camera recipes can be searched by words/tags and
  filtered by category. Posters are extracted from the actual output at 1.5 s.
- Explore an example opens its recorded source and result without generating.
  Existing native/example outputs are reused only after checking source/output
  hashes. New local copies retain the original render identity in an explicit
  example-origin field. Repeated opens reuse the imported take. Shared still
  sources are deduplicated; existing source bytes are checked before reuse.
- Use on my source preserves source identity, trim, quality, seed and painted
  cue. Region effects apply the recorded prompt/method. Camera recipes apply
  camera/look settings and retain the user's scene direction. Still images
  cannot accept a region effect. The library pauses background studio playback.
- Actual browser checks covered search, source/result playback, applying gold
  to the current room cue, offline example opening/playback, and the still-image
  compatibility guard. No Python or engine was available to the offline app.
  At 390 × 844: page client/scroll widths both 375, dialog widths both 349.
  At 1280 × 900: page widths both 1265, dialog widths both 1038. Keyboard focus
  stays within the library and Escape restores focus to its trigger.
- The packaged manifest now verifies 355 runtime files / 15,763,202 bytes,
  including five posters. The five original renders and their metadata are
  unchanged. No additional illustrative media is presented as generated output.
- Latest suite: 20 TypeScript + 13 Python tests; production build and all eight
  live required-input/output-link contracts pass.
- Reference research: the official LTX-2.5 inpainting workflow supports an edited
  first frame for replacement. A draft SDK pilot inserted LTXVImgToVideoInplace
  before the inpainting guide, conditioned on a prior edited room frame. Job
  `ec0da214-d934-4b1e-92e9-2654657ca372` produced 49 frames at 512 × 288 / 16 fps.
  The opening raw frame differed from the resized reference by mean 2.135 levels
  per RGB channel (8-bit scale); the portal remained stable in the contact sheet.
- A finish pilot conditioned both stages, including the re-encoded high-res
  latent. Job `16e201a4-96dd-491f-99ba-c1469f5f79c0` produced 97 frames at
  768 × 448 / 24 fps. Opening-frame mean difference was 1.764 levels; the portal
  remained stable across the four-second shot. Raw/full composites and actual
  workflow metadata are retained in `.runtime/reference-inpaint/`, with
  `contact-final.jpg` and `verification-final.json`. These are internal pilots,
  not a user-facing identity-swap feature or a general reference-consistency
  benchmark. Product integration and broader scenes remain to be done.
- The separate LTX-2.3 Ingredients adapter requires its own publisher access
  gate and a matching 2.3 stack. It was not downloaded. The successful pilots
  use the installed 2.5 weights and existing inpainting adapter.

## Edited first frames and six-case walkthrough — October 17

- Native masked edits now accept an optional edited full frame. Export the
  selected starting frame as an upright, full-resolution PNG, edit it, then
  upload or select the reference. Incompatible image geometry is rejected
  without replacing the current reference. Source/range changes and new effect
  directions clear an old reference; manual prompt edits preserve it.
- `LTXVImgToVideoInplace` conditions the coarse latent and, for Finish, the
  refinement latent. Both stages receive the same SDK-uploaded image. Source
  compositing and audio continue to use the original video. Source and reference
  are rebound to canonical local metadata and their actual bytes are checked
  against SHA-256 hashes before GPU submission.
- Real app render `49b0792c-855f-43ed-b656-403351bb0976`, SDK job
  `2d52f915-4304-4f3f-81b6-cdf6a49c25a5`, completed on the RTX 5080:
  97 frames, 768 × 448, 24 fps, 4.041667 seconds. Its raw opening frame has
  mean absolute difference 1.764 RGB levels from the resized reference on an
  8-bit scale. Unselected pixels at 1.5 s differ from the resized source by
  1.319 levels after lossy encoding. The contact sheet shows the timed portal
  appearing and disappearing while the fan stays protected. Evidence:
  `.runtime/evidence/reference-app-proof.json` and `reference-app-contact.jpg`.
- The reference is a frame from the prior local portal output, based on the
  attributed Curtis Adams / Pexels source. No closed image API was used.
  Reference SHA-256:
  `eb1e002ac8b403d8dee60f9f233d5c67c2d9a1d693be3a83156c38cdfc10aaf4`.
  This proves this edited-frame workflow on one scene, not general arbitrary
  identity replacement.
- Browser checks covered full-resolution source export, upload, inspection,
  rendering, recipe download/removal/re-import, and rejection of a portrait
  reference while retaining the valid image. Recipes resolve both assets by
  content hash, independent of local IDs. The exported starting frame matched
  the decoded source RGB pixels and contained no EXIF metadata.
- The sixth reviewed case, **An image to follow**, includes its edited frame,
  source, output, both generation stages, recipe and executed graph. The
  manifest verifies 363 runtime files / 17,029,376 bytes. A fresh example
  workspace opens all six cases. Without Python or an engine, the reference
  preview and source/result playback work, both videos reach readyState 4,
  thumbnails load, and new generation stays disabled.
- Desktop panes now scroll independently and keep the render action visible.
  Checks at 1280 × 900 show the full preview, cue timeline and render button;
  page client/scroll widths are both 1280. At 390 × 844 the page widths are
  both 375 and the reference dialog widths both 349. Reference selection
  survives reload. Screenshots: `reference-desktop.png`, `reference-mobile.png`
  in `.runtime/evidence/`.
- Fixed sampling inside the final source frame's display interval. Automated
  checks compare full-frame export and native loading at multiple timestamps;
  out-of-range trim still fails. A real native loader-only SDK job
  `37e427ee-9632-4b65-a3a6-ddde91c4994d` also passed after the engine restart.
- Latest checks: 23 TypeScript + 14 Python tests, production build, and all ten
  live workflow required-input/output-link contracts pass. Contract checking
  submits no GPU jobs.
- The updated captioned demo includes the six-case recipe library and actual
  edited-frame output: `.runtime/demo-output/aftertake-demo-v3.mp4`, exactly
  97 seconds / 2,328 decoded frames, 1280 × 720 at 24 fps, 6,329,320 bytes.
  Representative frames were visually reviewed; all frames decoded. Evidence:
  `.runtime/evidence/demo-v3-proof.json` and `demo-v3-contact.jpg`. Earlier
  drafts are retained. Publication and the public repository URL remain pending.

## Local frame editing and the complete appearance chain — October 17

- The studio can now create an edited appearance with Qwen-Image-Edit-2511,
  using the selected source frame and an optional second image. Fast mode uses
  the four-step Lightning adapter; Detailed uses twenty steps and the base
  model. Both expose the seed. The result requires explicit review and selection
  before it becomes a video reference. The spatial cue still applies to video
  generation/compositing; the image editor receives the complete source frame.
- Four optional model files total 23,732,843,846 bytes. Repository revisions,
  SHA-256 hashes and Apache-2.0 license metadata are pinned in
  `docs/models-frame-editor.json`; all downloads were verified. The installed
  Comfy stack required no new custom-node dependency. Both image and video
  submission use the official Comfy SDK and the existing local proxy.
- Real UI Fast edit `5009120d-9816-41d2-9733-032b32541a1f`, SDK job
  `ab6bc3ce-4672-4b69-b160-10e37658fae5`, created a turquoise crystal in the
  licensed forest shot. The native engine reported 45.80 seconds. Its PNG is
  768 × 432, SHA-256
  `2723bccd53c823e306777d755d3dc0184f28b85e7b6a7bf4294688bea4944858`.
- The reviewed frame was applied in the UI, the cue extended, and a Finish
  video rendered: `bbe90566-782e-49c2-b308-43a1643103d9`, SDK job
  `a8528116-b73d-4b05-a79a-3dd6b5655d15`. It decoded to 97 frames at
  768 × 448 / 24 fps. The native engine reported 88.41 seconds. The crystal
  stays coherent in the contact sheet and the temporal cue brings it in/out.
  Both LTX stages use the same uploaded frame. Unselected pixels at 1.5 s have
  mean absolute source difference 1.892 RGB levels after lossy encoding. Raw
  opening-frame difference from the resized reference is 6.614 levels; reference
  conditioning does not promise pixel-exact reproduction. Evidence:
  `.runtime/evidence/frame-editor-chain-proof.json` and `crystal-video-contact.jpg`.
- Detailed two-image edit `d3a00f2a-7cf1-406d-9285-25eaafde09e3`, SDK job
  `12af69ed-acf6-4b3b-aee8-18a9bf8e5186`, reused the turquoise crystal as its
  second reference and changed it to ruby red. The native engine reported
  197.64 seconds. During generation the web server was stopped and restarted;
  the same job ID resumed, with one running native job and none pending.
  The final PNG retains the pointed shape and red material. Evidence:
  `.runtime/evidence/frame-editor-detail-proof.json`. This is one synthetic
  object test, not a general character/identity benchmark.
- Frame jobs, outputs and actual PNG-embedded graphs persist. A frame becomes
  available only after its complete PNG, dimensions and workflow are verified.
  Recovery preserves the idempotency key after an ambiguous submission. Image
  and video admission share a guard in each studio workspace. Automated tests
  cover these paths and incomplete/missing PNG metadata.
- Sharing exposed a real normalization edge case: the downloaded generated PNG
  contains workflow metadata, while importing an image strips metadata. Imports
  now retain a verified original-file hash as well as the normalized-file hash.
  Recipe matching prefers exact bytes, then recognizes an original image upload
  and rebinds to its normalized local file. A clean-workspace browser test
  imported the original video recipe with new asset IDs, preserving cue/prompt.
  The normalized reference has identical RGB pixels, no EXIF/workflow metadata,
  and its actual bytes pass canonical asset verification. Evidence:
  `.runtime/evidence/frame-recipe-roundtrip-proof.json` and `frame-recipe-roundtrip.png`.
- The frame editor also imports its own shared recipes. In the same clean
  workspace, the Detailed two-image recipe resolved the normalized subject by
  its original upload hash and restored its prompt, twenty-step mode and seed
  732. Importing created no GPU job. Screenshot:
  `.runtime/evidence/frame-edit-recipe-import.png`.
- The seventh packaged case includes both image/video recipes, generated frame,
  raw/refined video stages and actual graphs. The manifest verifies 373 runtime
  files / 22,653,766 bytes. The example workspace also includes the completed
  frame-edit record, so the frame editor can display its history offline.
- At 1280 × 900, page client/scroll widths are both 1280; the frame dialog is
  1100 × 828 with client/scroll widths both 1088. At 390 × 844 the page widths
  are both 375 and the dialog client/scroll widths both 354. History selection,
  Escape/focus restoration and Chrome frame-recipe download passed. With no
  Python or engine, the bundled frame loads, source/result players reach
  readyState 4, and new frame generation remains disabled. Screenshots:
  `.runtime/evidence/frame-editor-desktop.png` and `frame-editor-mobile.png`.
- Latest checks: 27 TypeScript + 14 Python tests, production build, and all
  fourteen live workflow input/output-link contracts pass. These contract
  checks submit no jobs. Model quality evidence remains limited to this GPU
  and the documented scenes.
- The updated demo includes actual in-studio appearance editing and the crystal
  video: `.runtime/demo-output/aftertake-demo-v4.mp4`, 97 seconds / 2,328 decoded
  frames, 1280 × 720 / 24 fps, 7,068,830 bytes. Representative frames were
  visually reviewed. Evidence: `demo-v4-proof.json` and `demo-v4-contact.jpg`
  under `.runtime/evidence/`. Public repository/demo upload remain pending;
  the GitHub connector still returns `UNAUTHORIZED` after the user's reconnect.

## Publication preparation — October 17

- Chrome has an authenticated GitHub browser session even though the connector
  still returns `UNAUTHORIZED`. The repository importer can create the public
  `ItsSNOWMOBILE/aftertake` repository; that name is available. Source credentials
  are kept empty because the reviewed import source is public and read-only.
- Audited 571 tracked historical blobs for excluded runtime paths, embedded
  credential patterns, signed download links and machine-specific user paths;
  no findings. All seven existing commits use the agent's non-personal identity.
  The temporary export serves Git clone files only, with directory listing,
  configuration files and writes unavailable. It exposes no running studio API.
- `docs/index.html` and its assets provide the captioned 97-second demo,
  source/setup links, hardware context and source/model attribution. The MP4 is
  the verified v4 demo, copied unchanged. The document is prepared for GitHub
  Pages publication from `/docs`; deployment remains to be verified.
- Local document QA: desktop page widths both 1265, mobile widths both 375;
  native video reaches readyState 4 with duration 97 s at 1280 × 720, and the
  Watch action starts playback. The Copy commands control copied the exact
  displayed setup commands. No model generation occurs on this document.

## Clean-clone portability correction — October 17

- A complete clone from the read-only HTTPS export installed its frozen pnpm
  lockfile and built successfully. Its template HTTP test exposed a hidden-path
  issue: Express rejected an absolute media path containing `.runtime` in the
  checkout location. Example assets now use a contained relative path and an
  explicit root, retaining the dotfile-denial policy inside that root.
- The regression test copies the real example catalog into a hidden checkout
  and exercises preview serving and source/result imports without Python or a
  GPU. All 27 TypeScript tests and the production build pass after the fix. The
  HTTPS clone was then fast-forwarded to the fix, passed its own tests/build,
  and launched all seven examples with Python absent and engine URLs offline.
  Poster, video, reference PNG and frame-recipe routes returned their expected
  MIME types. Evidence: `.runtime/publication/clean-clone-proof.json`.
- GitHub initially returned HTTP 500 in the import view and no anonymous Git
  refs. The importer subsequently recovered; public access was verified below.

## Public source and demo — October 17

- [The MIT repository](https://github.com/ItsSNOWMOBILE/aftertake) is public.
  Anonymous HTTPS Git fetch returns the published branch and complete source.
  Its application files, tests and example assets match the independently
  tested clean clone; the hidden-checkout media fix and regression are included.
- [The demo document](https://itssnowmobile.github.io/aftertake/) is live on
  GitHub Pages from the repository's `/docs` folder. Its native video reaches
  readyState 4, plays successfully, and reports 97 seconds at 1280 × 720.
  The public MP4 is the reviewed v4 file, SHA-256
  `4e3b93a34e16890dd103aeff897ca3c05fea5e2f0fb720586ea5948a136bf066`.
- The GitHub connector remains unauthorized, but the authenticated browser
  allowed import, source updates and Pages deployment. The separate Git device
  authorization was not needed and expired without completion. Its tab is
  closed. The temporary read-only Git export and tunnel have been stopped.
- Publication does not constitute competition registration, a social post,
  submission, category acceptance or an award. Those remain outstanding.

## Tracking on low-detail camera moves — October 17

- Controlled camera transforms of the licensed room and forest starting frames
  exposed distortion over blank walls. Dense flow now uses a guarded camera
  estimate where the local image cannot determine motion. Distributed feature
  tracks must agree before this fallback is used; textured regions retain dense
  flow. It requires no additional model or service.
- At 512 × 288 over 49 frames, mask intersection-over-union against the known
  transform improved as follows. These are synthetic camera moves on frozen
  real textures, not a general natural-video or occlusion benchmark.

  | Scene / move | Original mean IoU | Updated mean IoU |
  | --- | --- | --- |
  | Room / pan | 0.913 | 0.992 |
  | Room / pan, zoom and roll | 0.896 | 0.990 |
  | Forest / pan | 0.988 | 0.989 |
  | Forest / pan, zoom and roll | 0.988 | 0.988 |

- Separate synthetic checks retain independently moving textured foregrounds
  with both static and moving backgrounds. A completely blank source safely
  falls back without inventing a camera estimate. Three meaningful regression
  tests bring the Python suite to 17 passing tests; all 27 TypeScript tests,
  production build and fourteen live node contracts also pass.
- The real CPU preview endpoint processed a compressed controlled-pan clip in
  3.30 seconds. Its decoded sprite alpha matches current node masks exactly.
  Preview cache versioning prevents an old mask from being reused after this
  algorithm update. Evidence is retained under `.runtime/evidence/` as
  `tracking-camera*-proof.json` and `tracking-preview-http-proof.json`.
- The idle engine was restarted with the updated nodes; installed source bytes
  match. No generation was active or queued. General tracking, occlusion and
  independently moving low-detail objects remain experimental.

## First and last frames — October 17

- Added the Cinema Studio start/end workflow to Animate a frame. The ending
  image can be uploaded, selected from imported images, inspected or created
  inside the existing Qwen frame editor. Applying a frame edit remains an
  explicit review action. Selecting the already-active mode retains the work.
- Followed the official LTX-2.5 first/last template: image guides at frame 0
  and -1, each at strength 0.7; appended guide tokens are removed before decode.
  This is single-stage video generation, using the installed public backbone,
  encoder and VAE. No new model or hosted inference API is required.
- Real SDK pilots completed at 512 × 288 / 49 frames and, with motion-track
  conditioning, 576 × 320 / 49 frames. Their job IDs are
  `c8e4ea68-7563-4f82-8968-0a17eafeba2e` and
  `6de350ed-e5eb-48a5-a20a-7b834fa4f11f`. Representative frames show a continuous
  forest waterfall-to-crystal transition, rather than an edited crossfade.
- The normal editor then submitted finished take
  `373aeb55-1569-411f-a541-7a7367617ec3`, SDK job
  `56c4d2a8-f985-46b8-ad9a-ef61346ea985`: 768 × 448, 97 frames, 24 fps.
  The executed graph retains both guide bindings and the ending-image hash.
  Decoded first/last RGB MAE to their respective resized references is 9.00 /
  9.12 on a 0–255 scale. Endpoints are soft constraints, not exact copied pixels.
- A separate engine-offline workspace imported the original source and the
  generated ending PNG. The actual browser recipe import found both new local
  identities after PNG metadata removal. Its exported recipe binds the ending
  to normalized SHA-256 `55294df019ef562cb1c8d1c34642bb9340443507e156cc62f5712c4d6d5c63ff`;
  original-hash matching recognizes the shared PNG. Normalized RGB is identical
  and image metadata is empty. Workflow export contains both guides and the
  portable `ENDING_FRAME.png` placeholder. Importing settings creates no jobs.
- Mobile width 375 has no horizontal overflow in the new controls or ending
  editor. Escape closes the dialog and restores focus. Evidence is retained
  in `.runtime/first-last-pilot/` and
  `.runtime/evidence/ending-frame-roundtrip-proof.json`.
- All 29 TypeScript tests, the production build and eighteen live workflow
  input/output-link contracts pass. The unchanged Python suite previously
  passed all 17 tests. Contract checks submit no generation jobs.
- This extends reference animation; it does not establish arbitrary character
  identity or motion transfer. General scene quality remains experimental.

## Video-driven motion transfer — October 17

- Added a separate Transfer motion surface using the pinned, public Wan
  Animate 2 distilled model. A raw driving video supplies motion; an imported
  or locally created appearance image supplies character and scene. The optional
  driving caption, both input hashes, seed and whole-frame/painted-cue scope
  survive recipe sharing. Source audio is connected in both scopes.
- Matched 384 × 512 / 49-frame pilots kept the appearance, seed and neutral
  prompts fixed. Mirroring only the driver changed the waved arm. SDK jobs:
  `65047d0f-129d-4e4a-b576-5dca93721312` and
  `d22ab8db-8300-4bcd-8457-126348f43938`. This establishes the controlled
  original-character test, not arbitrary human identity or facial performance.
- The normal browser studio completed 576 × 768 / 97-frame, 24 fps take
  `fe95d08b-acd6-4124-8aeb-175655fc5632`, SDK job
  `dfbe604b-d8c9-4b4d-a4c8-d1b6f3ee2aab`. The initial int8-cache version of
  this longer test was canceled after severe memory pressure. The native int4
  cache completed it in 259 seconds on the RTX 5080 / 32 GB machine. Draft
  retains int8 caching. Idle GPU models are released after terminal jobs,
  including canceled and failed generations.
- The new mode's Qwen editor then created and explicitly applied appearance
  `729c2e07-8881-4a36-8125-3f86ddd26efe`, SDK job
  `93c34eec-58cd-4b67-b882-a9adc414da22`. It completed a second real 97-frame
  motion take: `d18450f0-a9ca-4a2b-9d24-fd75d00664c6`, SDK job
  `7ec51815-4c35-47d6-8268-9bb6743e9d78`. The executed conditions bind the
  new source and generated PNG separately. The knitted appearance and arm
  gesture remain coherent in representative frames; pose timing can vary.
- A painted/timed draft with a 0.5-second source trim completed as
  `f94a2209-fe53-4ed3-a9b0-a6482fd55c1f`, SDK job
  `413ee209-1958-4f73-a2bf-53b4906585a3`: 384 × 512, 49 frames, 16 fps.
  Its original synthetic 440 Hz tone survives at 48 kHz for 3.062 seconds.
  Outside the zero-alpha cue, decoded RGB mean absolute error is 1.06 / 255;
  the compositor's exact-source guarantee remains before lossy encoding.
- A separate engine-offline workspace imported the shared source, generated
  PNG and actual browser-exported recipe. It rebound both new asset IDs and
  recognized the original PNG hash after normalization. RGB is unchanged and
  private PNG metadata is empty. Re-export retains the normalized image hash,
  motion caption and scope, and produces both portable input placeholders.
  Importing/exporting settings created no jobs.
- Appearance inspection previews the actual center crop without stretching.
  At mobile width 375, the three creation modes and crop dialog have no
  horizontal overflow. Escape restores focus to the inspection control.
  Quality controls are disabled while restoring a project or rendering.
- New take exports now use the executed graph embedded in the downloaded MP4,
  after verifying its recipe; they no longer expose the pre-upload placeholder
  graph as the recorded execution. Portable unrendered graphs retain placeholders.
- The four Wan artifacts total 24,907,108,099 bytes, all SHA-256 verified.
  Setup/download/engine scripts support a remembered separate model disk while
  retaining the existing local folders. A normal supervisor restart found Wan,
  LTX cinema, inpainting and Qwen profiles ready.
- All 34 TypeScript tests, 17 Python tests, the production build and twenty-two
  live workflow input/output-link contracts pass. Evidence is retained under
  `.runtime/research/motion-transfer/` and `.runtime/evidence/motion-transfer*`.
  These new local studies are not yet in the seven-example public media bundle.

## Frame-history reuse — October 17

- Reopening the frame editor restores its latest matching direction, seed,
  fast/detail mode and available subject reference. A viewed history item has
  an explicit Reuse these settings action; missing subject images are reported.
  Mode-specific placeholder text describes character or ending-frame edits.
- Browser QA reopened the completed robot-to-bear edit, replaced its direction
  temporarily, then restored the exact saved settings without starting a job.
  The production build passes. The refreshed demo uses this actual review UI.

## Browser editor trial — October 17

- Added a static editor at `/aftertake/studio/` with the seven already-public
  recorded examples. It uses the same React editor, paint/erase cue, timeline,
  comparison, recipe library and frame-history review UI as the local studio.
  The disclosure explains that edits affect exports while recorded results
  stay unchanged. Importing new media, generation, tracking and film export
  require the local studio; unsupported actions create no simulated jobs.
- The build verifies the published manifest and media hashes, extracts the
  executed graphs from recorded MP4s and pins all media to one immutable
  public Git revision. It bundles local OFL fonts and app/dependency notices.
- Browser QA played actual remote source/result videos, loaded all ten timeline
  thumbnails, changed a temporal cue, painted a new stroke and undid it.
  The original cue was restored exactly. Portable graphs retained the edited
  cue and source hash; the recorded graph matched the original execution.
  Downloaded video and Qwen PNG hashes matched the published bytes, and the
  frame recipe matched its original. No generation jobs were created.
- At 375 px, the disclosure and local-setup link fit without horizontal overflow.
  Both the normal and browser builds pass; all 36 TypeScript tests on this
  branch pass, including immutable-record and portable-workflow checks.

## Motion-strength control — October 17

- Motion transfer now exposes a 0.50–1.50 strength control with an explicit
  reset to 1. Its value survives recipe exports/imports, changes take identity
  and reaches Wan's native `pose_strength` input. Appearance strength remains 1.
  Higher values can exaggerate detail; this is guidance rather than a fidelity
  guarantee. Old recipes retain the default value.
- Previous browser QA verified a 1.4 recipe/workflow export, import restoration,
  reset, disabled controls during generation and a 375 px mobile layout.
  Normal app render `fa3f5c76-d46b-44d0-bbbd-460ca1598d20` recorded 1.4 in its
  actual graph and embedded recipe. Its decoded frames matched the corresponding
  fixed-input native probe exactly. The licensed-film research input and result
  stay local and are excluded from the public demo and examples.
- The public editor build is refreshed from the same source. Its media remains
  the seven published examples; the nine-example media refresh is separate.
- All 37 release-branch TypeScript tests and both builds pass. Static-editor
  QA exported a 1.4 recipe and native graph, reset to 1, then imported the saved
  recipe and restored 1.4. At 375 px, the slider fits and the page has no horizontal
  overflow. These checks created no GPU jobs.

## Remaining work

- Continue edge, motion-tracking and prompt-following quality work.
- Review the published demo against the final submission form requirements.
- Refresh the public video with motion transfer and the ending-frame workflow.
- Publish the required social post; register/submit the entry with final terms reviewed.
- Award outcome remains external and unverified (official announcement date: November 6).

The included source study is original procedural media. Blender-derived
research footage is local only. Licensed Pexels clips without recognizable
people are being used for demo candidates; see
`docs/media-attribution.md`.
