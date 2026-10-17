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

## Current experiment

LTX-2.5 native inpainting: its adapter conditions on a masked green plate,
rather than Canny geometry. `server/workflow.ts` implements a draft pass and
the official two-stage finish structure (coarse sampling, pyramid blend,
resize/re-encode, two refinement steps, boundary blend, exact-source composite).
The new graph compiles and has structural checks; **actual execution is still
unverified** until the new model files finish downloading.

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

## Outstanding

- Finish and validate native LTX-2.5 inference, memory budget and visual quality.
- Build three strong examples on materially different source clips.
- Improve mask authoring, edges, temporal consistency and usable preset prompts.
- Complete portable install/reproduction checks and cancel/reconnect testing.
- Publish source repository: the GitHub connector currently requires reauthentication.
- Verify full submission requirements, prepare demo and register/submit the entry.
- Award outcome remains external and unverified (official announcement date: November 6).

The included source study is original procedural media. Blender-derived
research footage is local only pending distribution/licensing checks; see
`docs/media-attribution.md`.
