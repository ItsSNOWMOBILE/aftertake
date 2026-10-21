# Cafe prompt-only identity retry

The same-seed retry visibly transfers the silver-haired, freckled identity and dark green knitted sweater. Only the additional prompt changed; source, reference, head crop, person mask, seed 610303, High 768 and wardrobe settings match the failed baseline. controlled-delta.json records the exact comparison. The failed baseline remains intact in the parent folder.

## Actual runs

| Stage | Native engine seconds | App wall seconds |
| --- | ---: | ---: |
| H3 prompt retry | 714.940 | 716.039 |
| Keep objects in front | Not a Comfy generation | 39.736 |

The app UI submitted both actual actions. render.json and protected-render.json are byte-identical durable app records. take.mp4 and protected.mp4 are the real outputs, verified against their native clip hashes. This export submitted no generation or compositing job.

The protection receipt reports Intel NPU (OpenVINO), 121 frames processed and source-restoration masks on every frame from 0 through 120. It selected 1,093,199 binary-mask pixels in total, ranging from 6,569 to 22,019 per frame. Exact indices and per-frame counts are in protected-render.json and visual-review.json. These are actual post-temporal-vote mask counts before 2 px feathering, rather than decoded differences after lossy video encoding. Depth inference used the NPU; mask processing and compositing use the media pipeline on the CPU.

## Visual and technical review

The five required native samples at frames 0, 30, 60, 90 and 119, full 121-frame take/protected contacts, and native joins 53 through 57 and 109 through 112 were inspected. The silver hair, face and green sweater persist, with coherent hands and mug. No severe limb cut, broad halo or abrupt join jump is visible in those checks. The real protection pass retains that appearance. Its visible benefit is subtle because the unprotected mug was already coherent.

Both outputs contain 121 frames at 24 fps on the native 1344 x 736 canvas and last 5.041667 s. Source-to-take audio correlations are 0.99933 and 0.99808; take-to-protected audio correlations and gains are exactly 1.0 on both channels, with aligned contiguous timestamps. See the two verification reports.

Source limitations remain: the opening shot crops much of the face, and its framing widens despite the locked-camera request. Facial age and detail remain a generated interpretation. A full-frame contact screens temporal consistency; it does not prove pixel-perfect likeness or exclude every subpixel edge artifact. This controlled success demonstrates an improvement for this shot, rather than a universal guarantee for all swaps.

## Shared artifacts and replay

The original source, prepared source, reference image, source/reference generation records, person mask, selection record and model pins stay in the parent folder without duplication. shared-baseline-bindings.json gives their relative paths and SHAs. Use ../prepared-source.mp4 for aligned native comparisons; the original ../source.mp4 is 1280 x 720, while H3 prepares 1344 x 736.

Replay with the parent's included assets and selection, rebind imported media/selection IDs, then use request.json with seed 610303 and the exact explicit prompt. Keep objects in front uses the real retry take and margin 0.1. The generation and protection records, actual graphs, model references, media hashes and review images preserve what was executed. No synthetic replacement or substituted protected result is included.
