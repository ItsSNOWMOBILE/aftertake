# Optional lower-face performance pass

This experimental **local command-line utility** refines mouth movement in an
already generated character plate using the original driving **video**. It uses
LivePortrait's learned lip-expression components, retains the plate's measured
head pose and blends only a tracked lower-face region. It is separate from the
studio's UI and its nineteen MCP tools. It does not turn narration into dialogue,
repair head rotation, guarantee visemes or establish accurate lip-sync.

The current bounded profile uses CUDA for LivePortrait and CPU for 203-point
landmarks. Leave the GPU idle for this pass. The NPU is not used. Six pinned model
files total approximately 637 MB. No InsightFace detection weights are used.
The first face in each input is selected by an explicit box, then tracked.

With the existing GPU runtime installed:

```sh
python scripts/setup-face-performance.py
.runtime/venv/Scripts/python.exe scripts/create-face-performance.py request.json --output mouth-performance.mp4
```

On Linux, use `.runtime/venv/bin/python`. For a new engine installation, run
`python scripts/setup.py --skip-models` first. Setup fetches official code at the
fixed revision in [the model manifest](models-face-performance.json), installs
optional ONNX packages separately and verifies all six model SHA-256 values.
Inference performs no network requests. An existing setup can be reused with
`--runtime-dir PATH` on the setup command.

Request format:

```json
{
  "format": "aftertake-face-performance/1",
  "frames": 73,
  "fps": 24,
  "base": {
    "path": "finished-character.mp4",
    "sha256": "SHA256_OF_FINISHED_CHARACTER",
    "box": [0.33, 0.046, 0.462, 0.278]
  },
  "driver": {
    "path": "original-performance.mp4",
    "sha256": "SHA256_OF_ORIGINAL_PERFORMANCE",
    "box": [0.33, 0.046, 0.462, 0.278]
  }
}
```

Paths resolve relative to the request. Boxes are normalized left/top/right/bottom
coordinates in each first frame. Include one complete face and exclude other
people. Both clips must begin at the corresponding performance frame and provide
every requested frame at the same constant clock. The utility rejects a short
input or a clock mismatch; it does not invent or interpolate missing frames.
Use one continuous shot, at most 257 frames, 1–60 fps and 1920 pixels per side.

The output has a companion `-matte.mp4` and `.receipt.json`. The receipt binds
inputs, model/code revisions, output hashes and frame geometry. Original base
audio is retained where present. Pixels outside the mask remain exact before
encoding; ordinary video compression can still change decoded pixels. Import
the reviewed MP4 into Film as footage, keeping the request, receipt and matte
with the editable project. Re-running requires a new output name.

Review the whole moving face, particularly teeth, jaw and profile turns. Tiny,
occluded or rapidly turning faces can drift; guessed landmarks have no verified
confidence score. Correct timestamps and a high mouth-shape correlation do not
prove good facial quality. The source may itself contain exaggerated acting.

The official LivePortrait [license](https://github.com/KlingAIResearch/LivePortrait/blob/9b294b3d0536135442ea73cb01e6cb3ca7029dd3/LICENSE)
is MIT, with a separate restriction on InsightFace's detection weights. This
profile excludes those weights. Models retain their own terms; app code is MIT.
