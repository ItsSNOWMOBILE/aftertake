# Lower-face performance candidate

`result.mp4` refines the lower face of `../performer-focus/result.mp4` using the
original silent `../character-replacement/source.mp4` performance. It retains
73 frames at 24 fps and the existing head pose. `mouth-matte.mp4` shows the tracked
blend region. The original SAM subject/foreground composite is retained.

Reproduce after installing the optional face utility:

```sh
.runtime/venv/Scripts/python.exe scripts/create-face-performance.py examples/face-performance/request.json --output .runtime/my-face-pass.mp4
```

See `docs/face-performance.md` for setup, request bounds and limitations. No
InsightFace detection weights are used. The manifest pins six public MIT model
files and official LivePortrait code. Inference uses CUDA; landmarks use CPU.

`receipt.json` binds model/input/output hashes. Its request input paths were
relocated without changing hashes, boxes or processing settings. The embedded
MP4 request retains its original runtime-relative paths as historical evidence.
`evidence.json` reports the complete frame clock and the bounded single-shot
mouth-shape comparison. All 73 decoded face crops, synchronized playback and
selected full-frame boundaries were reviewed. A roughly 24% decrease in tracked
lip-ratio error is not a phonetic or perceptual-quality score.

Head-turn fidelity remains limited. This is video-driven mouth refinement, not
audio-driven dialogue. Awaiting Jay review; no competition submission sent.

Source footage: Tears of Steel (2012), Blender Foundation / mango.blender.org,
CC BY 3.0. Silent excerpt; fictional generated appearance, motion transfer,
subject matte and lower-face refinement. No actor or creator endorsement.
