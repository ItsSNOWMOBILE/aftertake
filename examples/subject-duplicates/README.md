# One performance. Three dancers.

[![Watch the tracked subject effect](poster.jpg)](result.mp4)

[Watch the result](result.mp4) · [Source / result comparison](comparison.jpg) · [Editable recipe](recipe.json)

Aftertake tracks the original dancer once, then places two copies of those source pixels beside the performer. The right copy is mirrored. Position, scale, rotation, opacity and mask edges remain editable; no new face or motion is generated.

The actual app output is **1344 × 736, 73 frames at 24 fps** (3.042 seconds). The source excerpt is silent, so this example has no soundtrack. Subject effects retain source audio when present; they do not invent audio for a silent source.

## Reproduce without a generation engine

Install the [local studio](../../README.md#run-locally) and its small CPU media runtime. From the repository root:

```sh
pnpm install --frozen-lockfile
python scripts/setup-film.py
pnpm dev
```

The Python setup uses Python 3.12. Open **http://127.0.0.1:4310** in the local studio, then:

1. Open **Replace character → Duplicate a tracked person**.
2. Choose **Import portable recipe** and select this folder's `recipe.json`.
3. Choose `source-original.mp4` for **Original source video**, `prepared-source.mp4` for **Prepared source**, and `person-mask.mkv` for **Tracked mask**.
4. Choose **Restore checked media**. Aftertake verifies all three content hashes and restores the settings. Importing starts no render and requires no ComfyUI connection.
5. Review the two copies: horizontal offsets **−28%** and **+28%**, scale **100%**, vertical offset **0%**, rotation **0°**, opacity **100%**. The second copy is flipped horizontally. Feather is **1 px**, mask growth **0 px**, background blur **0**, and background exposure **0 EV**.
6. Choose **Build video preview**. This runs the real CPU compositor over the saved tracking. Watch the completed video, then use **MP4**, **Use as source**, or **Add to Film**.

To change the edit, adjust the controls and build another preview. To move the work to another machine, keep the recipe and all three companion files together. Local IDs are rebound during import; no original workspace is needed.

The [portability check](portability-check.json) imported these files through the real HTTP router into an empty workspace with no generation engine or original selection resolver. Its replay matched **all 73 decoded RGB frames and exact frame timestamps** in the checked runtime. Encoded MP4 hashes differ because embedded recipes contain new local IDs; exact encoded bytes across runtimes are not promised.

## Track it again

Tracking is optional for replay. To create a new mask, install the [character profile](../../docs/studio-guide.md#replace-character), import `source-original.mp4`, and open **Replace character**. Set start **0 s**, length **3.041667 s**, and working resolution **High**. Mark positive points at normalized coordinates **(0.455, 0.400)** and **(0.470, 0.730)**; use no negative points. Choose **Track selected person**, inspect the complete moving mask, then **Duplicate this person**. The actual SAM3 graph is in `selection-workflow-api.json`.

For an existing completed selection, **Saved tracked selection** or the duplicate panel's **Saved tracked person** restores its exact range, points and resolution without tracking again. A fresh SAM run can produce different mask boundaries; use the bundled lossless mask to reproduce this recorded composition.

## Source and review

Footage: [Video of a Man Dancing](https://www.pexels.com/video/video-of-a-man-dancing-7571381/) by [Antoni Shkraba](https://www.pexels.com/@shkrabaanthony/), under the [Pexels License](https://www.pexels.com/license/). The excerpt uses original seconds **21.000–24.042**, resized to 1536 × 810 and converted from 25 to 24 fps with the silent audio track removed. The native tracking stage produced the saved 1344 × 736 comparison canvas. Attribution, exact hashes and changes are recorded in `ATTRIBUTION.txt`, `provenance.json` and `file-manifest.json`.

Every output frame was inspected as a contact sequence, with larger samples checked alongside the moving mask. The 73 masks contain no empty frames; the two copies do not overlap the original or touch the frame border. The effect copies the visible source silhouette: it does not infer new shadows, scene geometry or foreground occlusion ordering. Review those details on each new shot.

| File | Purpose |
| --- | --- |
| `source-original.mp4` | Silent, trimmed source excerpt; audio binding for the effect. |
| `prepared-source.mp4` | Exact comparison canvas and pixels used by the compositor. |
| `person-mask.mkv` | Lossless binary FFV1 mask, one mask per source frame. |
| `result.mp4` | Actual output created through the studio API. |
| `recipe.json` | Editable settings and all three required media hashes. |
| `selection-workflow-api.json` | Actual native Comfy workflow that produced the tracking. |
| `provenance.json` / `portability-check.json` | Source/model provenance and fresh-workspace replay evidence. |

Footage and model terms remain separate from Aftertake's MIT code license. No performer or creator endorsement is implied. Model weights are not included.
