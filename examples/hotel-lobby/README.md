# Hotel Lobby — a new cast

[![Watch the walkthrough](poster.jpg)](walkthrough.mp4)

[Watch the 26-second video](walkthrough.mp4) · [Editable Film project](project.json) · [Evidence](evidence.json)

The left performer is replaced using a supplied portrait, SAM3 tracking and H3 Character Swap V1.5. A separate native Comfy postpass combines the generated person with the source through the tracked mask. The video opens on that result, shows actual UI screenshots held statically, and compares matching 73-frame source and result clips. Generation waits are omitted. Audio is local Kokoro narration.

## Files

- [Finished result](result.mp4) · [Raw H3 take](native-h3.mp4)
- [Original silent excerpt](source-original-short.mp4): 76 frames at 25 fps, from 16.00–19.04 seconds of the source performance.
- [Initial prepared input](source-input.mp4) · [Actual engine-prepared source](prepared-source.mp4): 73 frames at 24 fps, 1280 × 768 with 24-pixel top and bottom padding.
- [Tracked mask](selection-mask.mkv) · [Selection preview](selection-preview.mp4)
- [Recipe](recipe.json) · [SAM3 graph](selection-workflow-api.json) · [H3 graph](h3-workflow-api.json) · [Compositing graph](protected-workflow-api.json)
- [Storyboard](storyboard.json) · [Narration](narration.txt) · [Voice provenance](voices.json) · [Capture provenance](capture-receipts.json) · [Checksums](file-manifest.json)

## Reopen

[Start the local studio](../../README.md#quick-start), then import the bundled media:

```sh
python scripts/import-film-project.py examples/hotel-lobby/project.json
```

In **Film assembly → Import film project**, choose `project.json`. Regeneration uses your own portrait; rebind the graph's image, source and mask inputs. The supplied model input is omitted; its face view appears only in the actual UI screenshots.

Source: [Quavo & Takeoff — HOTEL LOBBY | A COLORS SHOW](https://www.youtube.com/watch?v=x9yop0nYR9g), COLORS, June 17, 2022. The short excerpt is silent. Footage and model terms are separate from the app's MIT license.

All 73 finished-result frames were inspected. Walkthrough review covered decoded frames and voice timing, without a listening or continuous-playback review. Facial articulation and likeness remain generative.
