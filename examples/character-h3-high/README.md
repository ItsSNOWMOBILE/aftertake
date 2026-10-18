# Native H3 replacement at the original source aspect

This review take replaces the man on the left of a licensed *Tears of Steel*
excerpt with the same fictional character as the earlier [H3 example](../character-h3/).
The native output is **1536 × 640, 73 frames at 24 fps**, without audio.
The source retains its original cinematic aspect. No portrait overlay or
intermediate face redraw is used.

Import `source.mp4` and [the original fictional reference](../character-h3/reference.png)
into the local studio. Open **Replace character**, import `recipe.json`, inspect
the tracked person and choose **High** before rendering. Importing a recipe
starts no job. The saved seed is 509103. Exact bytes can vary across runtimes.

| File | Role |
| --- | --- |
| `source.mp4` | Original-aspect silent excerpt, 75 frames at 24 fps. |
| `prepared-source.mp4` | Matched 73-frame comparison canvas. |
| `result.mp4` | Actual native H3 output. |
| `tracked-mask.mkv` / `selection-preview.mp4` | Lossless person mask and moving overlay. |
| `recipe.json` | Source-bound portable selection and replacement settings. |
| `selection.json` / `render.json` | Recorded operations and native SDK job IDs. |
| `workflow-api.json` / `selection-workflow-api.json` | Actual executed graphs. |
| `all-face-frames.jpg` | Every face crop, following the tracked person. |

The full reference photo and its generation receipt remain in `../character-h3/`.
Review mouth articulation, hands, occlusions and continuation windows for each
new source. Facial articulation is generative; this is not an audio-driven
viseme system or a guarantee of exact source expressions. Model terms are
separate from the MIT app license.

The [review receipt](../../docs/character-resolution-review.json) records hashes,
attribution, native graph and review boundaries. See `ATTRIBUTION.txt` for source
and model notices. The older character example remains available for projects
that reference its original hashes.
