# Remixable examples

## Then comes the Aftertake

The [93-second beat-cut film](then-comes-the-aftertake/README.md) is seven native
Film projects on the beat grid of its original ACE-Step song. It uses punch typography, styled transitions,
animated graphics and real studio recordings around this folder's generated takes.
Its build scripts re-export every scene through the studio's Film API.

## Make the next take

The [96-second campaign film](make-the-next-take/README.md) follows three dance
takes into a finished short-form campaign. Its native Film project retains the
cuts, typography, motion graphics, narration and music mix, including the closing
reveal of that same project. The three original eight-second campaign projects
remain independently editable. Reassembling the supplied media uses the CPU Film
runtime; fresh SAM3 tracking uses the local generation engine.

## Earlier focused Film

An earlier 53.04-second [editable Film](judges-film/README.md) develops a shared cue, tracked character replacement, product video and an ad revision. Its 19 cuts, 24 titles, 13 complete outer voices and genuine editor captures remain inspectable. `submission-film/` is a compatibility archive of that project.

The model-generation examples below are actual local Comfy SDK renders, captured on an RTX 5080 with 16 GB
VRAM. The videos are pre-rendered examples; editing a recipe does not alter a
past render. A connected local engine is needed to generate a new take.

The browser gallery features the [native H3 character replacement](character-h3-high/README.md)
and [portrait text-to-video with generated sound](text-video/README.md) above
the VFX, camera and motion recipes. They retain their own character/video
requests and executed workflows. The Wan motion-transfer example below is a
different workflow from H3 character replacement.

## Recorded quality and pipeline version

On October 19, twelve workflow examples were regenerated through the normal
studio API at **Final / 24 fps**, using the current decoder, compositing and
source-aspect output settings. This replaces both earlier 16 fps camera drafts.
The coastal transformation already matched the current pipeline and retains
its reviewed output. All thirteen workflow examples now use Final settings.

The featured H3 take is **1536 × 640**. The featured portrait text-to-video is
**576 × 1024** with generated sound; the VFX/camera set uses the app's **768 px**
final canvas. These are saved model profiles, not a claim of maximum possible
model quality. The [gallery review receipt](gallery-review.json) records the
new jobs, seeds, output hashes, frame checks and visual review limits. A CI
check compares each bundled video's executed settings with the current graph
builder so future pipeline changes flag stale previews.

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
| An image to follow | An edited first frame guides both inpainting stages; the painted cue controls where it appears. |
| The forest keeps a secret | Create the crystal appearance locally with Qwen, then carry it into the LTX masked video. |
| Signal — a new character | Original procedural robot footage drives a locally created knitted character through Wan Animate 2. The appearance, Qwen recipe and actual graph are included. |
| Between falling water and crystal | Starting and ending images condition a generated forest transition. Inspect both image guides and the Qwen ending-frame recipe. |
| The coast becomes a kingdom | Real coastal drone footage gains a locally edited castle through a painted, timed, flow-tracked region; inspect the Qwen reference and actual native graph. |
| The tide keeps a secret | The edited castle still becomes a new LTX shot guided by pullback framing tracks. |
| A season in a moment | Green alpine slopes become snowy winter terrain and return to the original footage through a timed, tracked cue. |
| Above the clouds | Words create an original 1152 × 768 observatory with Z-Image Turbo. Its native PNG graph and image recipe are included; framing tracks guide the subsequent LTX camera shot. |

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
Import the matching reference PNG before importing recipes that use one:
`edited-first-frame.png`, `appearance.png` or `ending-frame.png`. The app can
recognize a generated PNG after metadata normalization and binds the recipe to
the actual normalized local file. In ComfyUI, also replace the reference loader's
filename with the uploaded image filename.

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
small technical demonstration, not a stock-footage collection. The separate
[H3 example](character-h3-high/README.md) includes its licensed *Tears of Steel*
excerpt and source attribution.

`signal/source.mp4` is an original articulated robot gesture, rendered by
`scripts/create-motion-study.py` under MIT. Its appearance PNG and frame recipe
come from local Qwen-Image-Edit-2511; Wan Animate 2 creates the motion output.
No outside image, actor footage or closed inference API supplies that case.
`crystal-transition/` reuses the credited Mikhail Nilov forest source and the
same locally generated Qwen crystal image as `crystal-forest/`. Qwen, Wan and
LTX retain their respective model terms.

`quiet-approach/source.png` is an RGB still extracted from the first frame of
the credited Curtis Adams room excerpt. It retains the Pexels License. The
generated video adds new camera movement; it does not replay the original clip.
`guided-pullback/source.png` uses that same credited still. Its `guide.mp4`
is the actual IC-LoRA control signal; the output reveals model-generated space
beyond the starting frame.

Maintainers can regenerate this reviewed selection with
`node scripts/package-examples.mjs` while the local studio is running and the
listed render IDs exist. The utility never packages the entire private library.
