# Remixable examples

These are actual local Comfy SDK renders, captured on an RTX 5080 with 16 GB
VRAM. The videos are pre-rendered examples; editing a recipe does not alter a
past render. A connected local engine is needed to generate a new take.

From the repository root:

```sh
pnpm install
pnpm demo
```

Open http://127.0.0.1:4312. This uses a separate `.data-demo` workspace and does
not modify your ordinary `.data` library. No model weights or Python runtime
are needed to watch the examples, inspect their paint, adjust settings and
export recipes/workflows. Importing new videos and computing tracked previews
require the Python runtime. Rendering requires the model files and local engine.

| Example | What to inspect |
| --- | --- |
| Reclaimed | Coarse generation and refinement retain foliage; the final composite restores the untouched source. |
| An opening elsewhere | Paint replaces a window with a portal; erase protects the original ceiling fan. The cue fades in and out. |
| The golden falls | Localized molten-gold waterfall with the surrounding forest retained from the source. |
| A quiet approach | A still image conditions the opening frame of a genuinely generated forward camera move. Camera/look settings appear in the actual encoder prompt. |
| Beyond the frame | Screen-space tracks drive a generated pullback. Compare the saved guide, raw generation and consistently graded monochrome result. |

Each folder contains the source clip, editable recipe, API graph, original
render record, final output and available raw/coarse outputs. MP4 metadata
includes the recipe and executed graph. The manifest records file SHA-256
checksums, original job IDs and source provenance. Names and timestamps in the
render records are retained from development history.

In a regular studio workspace, import `source.mp4` (or the animation example's
`source.png`), then use **Import a recipe**
to load `recipe.json`. Source matching uses the content hash, so the newly
assigned local clip ID does not have to match the example. To use a graph
directly in ComfyUI, upload the source and set `AftertakeLoadClip.filename` to
its actual input filename. Install the custom nodes and referenced model files.

## Media licenses and credits

The app and JSON/code files are MIT licensed. That license does not relicense
the third-party source footage or model weights. Generated derivatives also
remain subject to the model terms linked in the main README.

- `reclaimed/source.mp4`: original procedural camera study, made by Aftertake
  contributors with `scripts/create-study.py`; MIT. No external images/textures.
- `portal/source.mp4`: [Curtis Adams / Pexels](https://www.pexels.com/video/empty-room-with-ceiling-fan-and-carpet-19227392/),
  under the [Pexels License](https://www.pexels.com/license/). Trimmed to 101
  frames at 24 fps, resized to 768 × 432 and made silent. Results add a portal,
  spatial protection and temporal blending. No endorsement is implied.
- `golden-falls/source.mp4`: [Mikhail Nilov / Pexels](https://www.pexels.com/video/waterfall-in-the-middle-of-the-forest-6989026/),
  under the [Pexels License](https://www.pexels.com/license/). Excerpt starts at
  12 seconds, contains 101 frames at 24 fps, is resized to 768 × 432 and made
  silent. Results add golden liquid VFX and temporal blending. No endorsement
  is implied.

Cached JPEGs are source-frame thumbnails from these same clips. This is a
small technical demonstration, not a stock-footage collection. Blender-derived
actor footage used during local research is excluded.

`quiet-approach/source.png` is an RGB still extracted from the first frame of
the credited Curtis Adams room excerpt. It retains the Pexels License. The
generated video adds new camera movement; it does not replay the original clip.
`guided-pullback/source.png` uses that same credited still. Its `guide.mp4`
is the actual IC-LoRA control signal; the output reveals model-generated space
beyond the starting frame.

Maintainers can regenerate this reviewed selection with
`node scripts/package-examples.mjs` while the local studio is running and the
listed render IDs exist. The utility never packages the entire private library.
