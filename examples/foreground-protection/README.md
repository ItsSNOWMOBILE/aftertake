# Foreground protection: cafe mug

This is a real UI-run evidence pack with a failed identity transfer. The Intel NPU protection action completed and emitted protected.mp4, but the H3 take still shows the original brown-haired woman in her navy blazer. It does not visibly adopt the silver-haired freckled reference or green sweater. Do not present this as a successful character replacement or an impressive foreground-restoration comparison.

A same-source, same-seed [prompt-only retry](prompt-retry/README.md) now visibly transfers the silver-haired identity and green sweater. That successful retry and its real NPU protection output are preserved separately; the failed baseline evidence below remains unchanged.

## Actual runs

| Stage | Seed / setting | Engine seconds | App wall seconds |
| --- | --- | ---: | ---: |
| Create video | 610301, Final 720p, 5 s | 132.589 | 134.342 |
| Create image | 610302, portrait 720p | 26.942 | 28.248 |
| Track woman | High 768, 121 frames | 29.215 | 30.747 |
| H3 replacement | 610303, reference wardrobe, empty extra prompt | 675.368 | 677.825 |
| Keep objects in front | margin 0.1, Intel NPU (OpenVINO) | Not a Comfy generation | 39.592 |

App wall time is measured from each durable record's createdAt to updatedAt. Native Comfy execution timestamps are saved in generation-engine-timings.json and engine-timings.json. No timing estimate replaces a measurement.

## What protection actually did

The actual protection receipt reports Intel NPU (OpenVINO), 121 frames processed, and 121 frames selected for source-pixel restoration: every frame from 0 through 120, inclusive. It selected 1,093,199 binary-mask pixels in total, ranging from 6,569 to 22,019 per frame. Exact indices and per-frame counts are preserved in protected-render.json and visual-review.json.

These counts describe the post-temporal-vote restoration masks before the 2 px feather. They are not a count of decoded video differences after lossy encoding. Depth inference used the Intel NPU; mask creation, temporal voting and compositing use the media pipeline on the CPU. The mug was already intact in the failed H3 take, so the visible protection benefit is subtle and this is execution evidence rather than a polished before/after demonstration.

The native take and protected output both contain 121 frames at 24 fps on a 1344 x 736 canvas, lasting 5.041667 s. Source audio is retained: source-to-take channel correlations are 0.99933 and 0.99808; take-to-protected audio correlations and gains are exactly 1.0 on both channels. See take-verification.json and protected-verification.json for timestamp coverage and gain checks.

## Visual review and limits

Actual source, take and protected frames 0, 30, 60, 90 and 119 are included under review/. Full 121-frame contacts for the selected mask, take and protected output were reviewed. The person mask excludes the white ceramic mug throughout the reviewed sequence; no repair or red-point retry was needed.

The original source is 1280 x 720. H3 prepares it at 1344 x 736; use prepared-source.mp4 for aligned comparisons with the native take. The source's opening composition crops much of the face, then widens despite the locked-camera request. Those source limitations were retained and disclosed.

The actual uploaded reference, prepared source and mask hashes match the executed graph. The mask contains nonzero white editable pixels in all 121 frames. The bound head crop is correct. Pre-composite H3 pixels were not saved by the executed graph, so their appearance cannot be inferred from the finish report. See input-binding-audit.json. The linked prompt-only retry tests that change successfully on this shot; this baseline failure remains preserved. This does not establish a universal cause for all failed transfers.

## Reproduce and inspect

Create the source and reference with the included exact generation requests. In Replace character, use the included selection request and High 768, then the included replacement request with seed 610303. Reimported media and selection IDs must be rebound to the local app. The source, reference, mask, native take, protection output and exact durable JSON records are included. Keep objects in front uses the actual take and margin 0.1. No synthetic composite or substituted protected result is included.

native-record-bindings.json records byte-identical native JSON hashes. models.json records pinned generation, tracking and depth model provenance. publication-audit.json and native-metadata-audit.json disclose path checks without silently rewriting records or media. Application code is MIT; model files retain their own publisher terms.
