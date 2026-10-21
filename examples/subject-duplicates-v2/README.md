# Garage ensemble — tracked subject duplicates

`result.mp4` is a 1280 × 720 export of the tracked source-pixel duplicate effect. The original dancer plus two copies at horizontal offsets −0.28 and +0.28 produce **three people total**. The right copy is mirrored. These are copied tracked pixels, without a second diffusion pass or added contact shadows.

The source is fictional LTX-generated footage. Original copy settings are preserved: scale and opacity 1, feather 1, grow 0, background blur 0, background exposure 0. The source and source-aware SAM clicks are the documented changes. `copy-count-note.json` explains why this preset does not match a lyric claiming five added dancers.

Compare `before-720p.mp4` with `result.mp4`: both use the identical Film framing from the aligned 1344 × 736 preparation canvas. `source.mp4` retains the unprepared 1280 × 720 original. Native compositor output is retained as `native-result.mp4`. The contact in `review/` shows seven matching times; all inspected bodies, hands, and shoes remain in frame. Duplicate contact shadows are not synthesized.

The primary native and delivered results each contain 73 consecutive frames at 24 fps with aligned source ambient audio. Verification JSONs record waveform correlation, gain, coverage, and timestamps. The matched-before comparison has one extra audio encode and fails the strict left-channel gain tolerance; its failed report is retained. No exact audio preservation claim is made for that comparison witness.

## Replay through Aftertake

Import `source.mp4`, create the selection with `selection-request.json` coordinates, trim start 0, duration 73/24 and resolution 768, then review the mask. Rebind `request.json` to the newly created selection ID and mask hash and use the standard subject-duplicates route. The saved `recipe.json` includes the original compositor contracts. Import its native result and export using `delivery-film.json`, replacing the stored asset ID with the current imported asset ID. Rebind `before-delivery-film.json` to the new prepared-source asset for the matched framing comparison.

`models.json` includes the pinned SAM3.1 selection model and source-generation model provenance. Application code and model weights have separate license terms. Stored IDs are local execution evidence, not portable media locators; always import and rebind them.
