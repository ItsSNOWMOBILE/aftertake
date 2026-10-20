# HD footage and reproducible examples

A fresh set of fictional source plates and native 720p example edits. Each example includes its source, result, saved recipe, render record, executed workflow and model provenance. Model weights are downloaded separately under their own license terms.

| Example | Source | Result and replay files |
| --- | --- | --- |
| Character replacement | Rooftop walk and a generated character reference | [H3 recast](character-h3-high-v2/) |
| Tracked subject copies | Locked camera, orange-hoodie dancer | [Subject duplicates](subject-duplicates-v2/) |
| Performance transfer | Dancer driving a knitted teddy | [Gesture transfer](signal-v2/) |
| Regional repaint | Arched loft window overlooking a neon city | [Window repaint](portal-v2/) |
| Camera control | Storm lighthouse with a pullback | [Camera move](castle-pullback-v2/) |
| Depth effects | Silver-haired alley portrait | [Depth and lens blur](depth-effects-v2/) |

The [source pack](source-plates-v2/) retains the selected generation requests, seeds and candidate comparisons. Video sources are 1280 × 720 at 24 fps, with 121 frames each. Example durations retain their original presets: 73 frames for H3 and subject copies, 97 frames for the generated video edits. Generated ambient audio is preserved where the source has audio.

For character replacement and copies, compare each `before-720p.mp4` with `result.mp4`; they share the same prepared framing. The original and native intermediate outputs are also retained. The window repaint includes the internal dividers within its painted region; the outer arch, room and readers stay protected. Read each example's quality notes before choosing a shot: gesture transfer does not reproduce all footwork, the lighthouse lightning is stylized, and stronger depth blur can reveal estimated-depth boundaries.

## Replay

Import the included media into Aftertake, rebind the saved media and selection IDs to the new local imports, and use the saved request or recipe. Local execution IDs document the original run; they are not download links. Review tracking masks on the imported source before running a new generation. Seeds and pinned models make the setup reproducible, while hardware and runtime differences can affect generated pixels.

The optional `resolution: "720p"` setting uses each model's required latent grid and records the exact padding and crop. Existing `videoDimensions()` presets and older saved recipe sizes remain unchanged. The related code changes are isolated in commits `64be2d3` and `06ca946` on this branch. Commit `f06cdc8` also fixes bounded progress logging for large CPU recomposition recipes; the complete validated workflow receipt is retained.

## Song timing

The [song-alignment folder](film-song-alignment/) contains the raw full-mix and isolated-vocal Whisper word timestamps, plus printed segment lines. Times are relative to the original 96-second song. Transcription hallucinations are preserved in the records and should be discarded when editing titles.
