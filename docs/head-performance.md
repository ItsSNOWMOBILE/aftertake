# Optional stable-portrait head pass

This experimental local command-line pass animates one aligned character portrait
from a driving video, then returns the tracked head to a finished character plate.
It uses LivePortrait for relative head rotation and direct lip expression, CPU
landmarks for placement, and SAM 2.1 for separate old/new head contours. A small
OpenCV fill covers exposed pixels from the old head. This is a separate utility,
not a studio button, MCP tool, audio-driven avatar or verified viseme system.

Use the existing CUDA runtime and pinned optional portrait setup:

```sh
python scripts/setup-face-performance.py
.runtime/venv/Scripts/python.exe scripts/create-head-performance.py examples/head-performance/request.json --output head-review.mp4
```

On Linux, use `.runtime/venv/bin/python`. Matting uses the existing Transformers
runtime and the pinned public SAM 2.1 tiny profile. Its approximately 156 MB model
is downloaded if absent; inference stays local. Leave the GPU idle. The NPU is
not used. Portrait setup adds approximately 637 MB of weights and excludes
InsightFace detection weights.

Start with the example request from the complete source snapshot. Its three
inputs are bound by SHA-256: the finished base, original driving video and an
upright, aligned 512 × 512 RGB portrait containing the full head and neck. Base
and driver need corresponding first frames, a complete constant frame clock and
explicit normalized first-face boxes. The current bounds are 1–257 frames,
1–60 fps and 64–1920 pixels per side. A different portrait must be cropped and
visually aligned before use; arbitrary face detection is not implemented.

Both matte roles require reviewed pixel boxes and positive/negative clicks.
Include hair, face and neck; exclude clothes, other people and the background.
Annotations begin at frame zero and can add later anchors. Clicks for this
specific bridge example are not a general automatic head selector. A preview
that loses the hair must be corrected before compositing.

The utility writes the MP4, a `-matte.mp4` covering all changed regions, separate
binary source/generation arrays in `-subjects.npz`, and a `.receipt.json` binding
inputs, models, annotations and outputs. Existing outputs are retained; use a
new name for each run. Source audio is kept where present. Portrait motion is
driven by video, so it does not make the character speak a separate voiceover.

Review the complete moving clip: eyes, teeth, forehead, jaw, neck, hair and the
background revealed by a turn. The fill can smear a textured background, and
the new face can be sharper than the body. Correct timestamps or protected-pixel
checks do not prove convincing quality. Pixels outside the incoming head and
old-contour fill stay exact before encoding; compression changes decoded pixels.
The included bridge result is one reviewed candidate, not general head-turn or
identity consistency evidence. The bridge MP4 remains available as an experimental comparison. See the
[native H3 example](../examples/character-h3-high/) for the current character workflow.

LivePortrait's official code/model terms and the SAM manifest are retained in
`models-face-performance.json` and `models-matting.json`. App code is MIT; source
media and models retain their licenses.
