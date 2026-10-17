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

## Remaining work

- Continue edge, motion-tracking and prompt-following quality work.
- Complete the edited two-minute submission demo and final source review.
- Publish source repository: the GitHub connector currently requires reauthentication.
- Prepare the required social post; register/submit the entry.
- Award outcome remains external and unverified (official announcement date: November 6).

The included source study is original procedural media. Blender-derived
research footage is local only. Licensed Pexels clips without recognizable
people are being used for demo candidates; see
`docs/media-attribution.md`.
