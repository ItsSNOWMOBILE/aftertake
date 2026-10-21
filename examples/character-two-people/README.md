# Two-person swap test - visual validation failed

This is the requested **two-pass rooftop test**, retained as a reproducible diagnostic. The second H3 job completed technically and the studio ancestry contains two replacement operations, but **the intended second person was not convincingly recast**.

The seated man on the left still has his original black hair and black jacket instead of the reference man's close-cropped hair, beard, mustard jacket and grey hoodie. The foreground woman's face remains stable, but an unwanted yellow patch appears on her left shoulder late in the shot, most clearly in frame 72. The reviewed SAM mask excludes her; its native 32 px expansion reaches her shoulder as the man becomes occluded. See `visual-review.json` and the native before/after stills in `review/`. The UI counter describes completed operation ancestry and does not certify visual correctness.

| Stage | Seed | API wall time | Native engine time |
| --- | ---: | ---: | ---: |
| Fictional portrait, 720p portrait | 610201 | 36.849 s | Unavailable |
| Track the left man, High 768 | - | 38.585 s | 36.991 s |
| Replace selected person | 610202 | 629.541 s | 628.346 s |

Times are measured from the returned records and available Comfy execution timestamps. Portrait engine history was unavailable after engine shutdown; its API wall time is retained. Tracking produced **73 nonempty masks** and required no repair. The face focus is `x=.20, y=.12, width=.65, height=.44`. The replacement used the default empty additional prompt and reference wardrobe. Its exact request is in `request.json`.

`source.mp4` is the actual pass-one take imported through the studio. `prepared-source.mp4`, `person-mask.mkv` and `selection-preview.mp4` are the actual second selection's outputs. `reference.png` is the generated portrait and `reference-generation.json` is its native generation record. `render.json`, `selection-render.json`, requests and `executed-workflow.json` preserve the actual second execution. Prior ancestry remains in the existing [first-pass replacement record](../character-h3-high-v2/render.json) and [first-pass selection record](../character-h3-high-v2/selection-render.json); their original hashes are bound in `native-record-bindings.json`. No duplicate first-pass records are included here. `models.json` is copied from the first-pass model provenance as requested; the new portrait's generation graph records its actual model files.

The native second result is **1344 x 736, 73 frames at 24 fps**. `result.mp4` is a **1280 x 720** derivative encoded through the ordinary Aftertake Film API. It uses no titles, graphics, cuts or added audio: cover framing at the center, source volume 1 and audio normalization false. `before-720p.mp4` uses the identical transform on the prepared source, so the comparison introduces no artificial framing change. Exact Film requests, assets, manifests and returned records are included. Native and 720p outputs both pass independent clock/audio checks; delivery stereo audio correlations against the source are 0.99965 and 0.99973. Technical verification does not remedy the visual failure.

To reproduce the second test, import `source.mp4`, track the seated man with the saved green/red points at High 768, review the actual mask, select the provided portrait and face focus, and run seed 610202 with the saved defaults. Rebind imported clip/selection IDs to your app. To reproduce the two-operation UI ancestry from scratch, first run the normal first-pass example in `../character-h3-high-v2/`, then use its completed take as the second source. Importing a bare MP4 does not recreate missing studio history.

The requested `chain-screenshot.png` is **not captured and remains pending**: the user interrupted computer use before screenshot capture. The live result-panel DOM counter was verified as two by the root agent; no screenshot file is supplied. No synthetic screenshot, hand-edited video, invisible identity reinforcement or undocumented model retry is included.

File checksums in `files.sha256.json` and `pack.sha256.json` describe canonical Git/ZIP bytes: text uses LF newlines under the repository's `.gitattributes`. The original publication's seven CRLF-derived checksum entries are corrected in `hash-integrity-audit.json`. Native records, media and their bindings remain byte-identical. Use a clean checkout or Git archive when verifying these hashes.
