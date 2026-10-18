# Native H3 character replacement

This recorded example replaces the man on the left of a licensed *Tears of
Steel* excerpt with the fictional character in `reference.png`. It uses native
SAM3 tracking, H3 Character Swap V1.5, direct photo/head references, a latent edit
mask and two continuation windows. No intermediate appearance redraw or portrait
overlay is used. The result is silent: 73 frames, 24 fps, 928 × 512.

Install the optional character profile using the main README. Import `source.mp4`
and `reference.png` into the local studio, open **Replace character**, then
**Import character recipe** with `recipe.json`. Track the person and inspect the
moving selection before generating. Import restores settings and starts no job.
Exact generation bytes are not guaranteed across runtimes.

| File | Role |
| --- | --- |
| `source.mp4` | Original excerpt used by the source-bound request. |
| `prepared-source.mp4` | Matched 73-frame canvas for before/after comparison. |
| `reference.png` / `reference-origin.json` | Fictional character and original local image-generation receipt. |
| `tracked-mask.mkv` / `selection-preview.mp4` | Lossless binary person mask and actual moving review overlay. |
| `result.mp4` | Actual native H3 output. |
| `recipe.json` | Portable Aftertake settings for the selection and replacement. |
| `workflow-api.json` | Executed H3 API graph. On another engine, reconnect the prepared source, original photo, mask and original source/audio loaders. |
| `selection-workflow-api.json` | Executed native SAM3 selection graph. |
| `selection.json` / `render.json` | Persisted local operation and native SDK job records. |
| `evidence.json` | Output, source and mask hashes, frame clock and runtime qualification. |
| `all-face-frames.jpg` | Every decoded face frame for temporal review. |

The actor's performance includes the open mouth and turn. This is a generative
character edit, not an audio-driven viseme system. Review identity, fingers,
occlusions and motion for each new source. Model terms are separate from the
app's MIT code; attribution and upstream links are in `ATTRIBUTION.txt`.
