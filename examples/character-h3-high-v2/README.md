# Rooftop recast — H3 character swap

A fictional woman is recast with a second fictional character while the rooftop and background performer stay in place. `result.mp4` is the 1280 × 720 delivery; `native-result.mp4` retains the actual 1344 × 736 model output. Both contain the source ambient audio.

## Review

Use `before-720p.mp4` against `result.mp4`: both pass through the identical Film canvas and cover crop from the aligned preparation canvas. The unprepared original is also included as `source.mp4`; comparing it directly would introduce a framing jump. `review/comparison-contact.jpg` shows seven matching times. Full native frames and reference comparison are in `review/`.

The original seed **509103**, eight-step sampler, CFG 1, 56-frame window, 18-frame history, and 32-pixel mask expansion are preserved. The source, fictional reference, prompt, and source-aware SAM clicks are the documented changes. Root and independent visual reviews accepted the likeness and join; a faint disconnected original flyaway hair remains in the sky at frame 36. No perfect identity or zero-artifact claim is made.

Both outputs decode to **73 consecutive frames at 24 fps** (3.041667 seconds). `native-audio-verification.json` and `media-verification.json` contain timestamp, coverage, waveform-correlation, and gain checks. Source volume is 1 and loudness normalization is disabled. Engine execution was **378.15 seconds** on the local RTX 5080; this is a measured runtime, not a performance guarantee.

## Replay through Aftertake

1. Import `source.mp4` and `reference.png` into Aftertake. Their stored media IDs are local provenance, so use the newly imported IDs.
2. Create the selection with the positive/negative coordinates in `selection-request.json`, trim start 0, duration 73/24, and selection resolution 768. Review its mask before continuing. `person-mask.mkv`, `prepared-source.mp4`, and the original selection preview are included as witnesses.
3. Rebind `request.json` to that selection ID and the new reference ID, preserving its face box and other settings. Run the standard character-replacement route. `recipe.json` and `executed-workflow.json` preserve the submitted parameters and executed graph.
4. Import the native result into Film. Rebind `delivery-film.json` to its asset ID and export at 720p. For the matched before, import the newly prepared source and apply `before-delivery-film.json` with its ID rebound.

`models.json` pins repositories, revisions, filenames, and SHA-256 values, with publisher license-card links. Application code and model weights have separate licenses. Source/reference generation recipes accompany the media; the source-plates-v2 example pack contains full generation provenance. No personal reference photographs are used.
