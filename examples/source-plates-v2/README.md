# Fresh source plates

AI-generated fictional footage for the Aftertake example refresh. No phone capture or real-person reference is claimed.

| Plate | File | Model | Seed |
| --- | --- | --- | --- |
| A: Hero walk | [hero-walk/source.mp4](hero-walk/source.mp4) | LTX-2.5 distilled 22B Q4_K_M (unsloth GGUF) | 508023 |
| B: Dancer | [dancer/source.mp4](dancer/source.mp4) | LTX-2.5 distilled 22B Q4_K_M (unsloth GGUF) | 508021 |
| C: Repaint plate | [repaint-plate/source.mp4](repaint-plate/source.mp4) | LTX-2.5 distilled 22B Q4_K_M (unsloth GGUF) | 508020 |
| D: Storm lighthouse | [camera-move-still/source.png](camera-move-still/source.png) | Z-Image Turbo BF16 | 509042 |
| E: Neon depth portrait | [depth-still/source.png](depth-still/source.png) | Z-Image Turbo BF16 | 509052 |

Video plates contain 121 frames on a regular 24 fps clock (5.041667 seconds), 1280 × 720, with native generated ambience. LTX sampled 1280 × 736 then cropped eight native pixels from the top and bottom inside the saved Comfy workflow; no lower-resolution image was enlarged. Stills were sampled directly at 1280 × 720.

Import each `request.json` in Create video or Create image to restore the complete prompt, seed, framing and HD preset; generation remains a deliberate new action. `recipe.json`, `generation.json` and `workflow-api.json` retain the actual completed SDK job and native graph. The HD implementation is on the separate `source-upgrade` branch at commit `06ca946c5e0db28a8199c2337a0c14d748aa3289`, based on Claude's `d2f961e` code.

Each generated output may vary between hardware or runtime versions; saved seeds and graphs are provenance, not a promise of byte-identical rerenders. The delivered media hashes are in `manifest.json` and `SHA256SUMS.json`.

Hero A uses one explicitly recorded natural-lens quality variant after three literal anamorphic takes produced excessive black vignetting. All candidate requests and comparison previews remain available. B's CPU-only background-motion and frame-clock audit includes its method and limits in `comparisons/camera-audit-summary.json`; it does not certify flawless anatomy. E already has photographic bokeh and the model rendered a dusk/daylight look despite the requested night setting, so additional depth blur is modest.

All model file names, pinned revisions, hashes and license identifiers are in `models.json`. Native execution was preserved: mixed-quantization LTX GGUF, BF16 diffusion/video VAE, FP16 text encoding, and the upstream FP32 audio VAE. BF16 in a weight filename is not a claim that every component runs in BF16. No precision fallback or CPU diffusion was introduced.

The two fictional references under `references/` are new Z-Image generations, with the same complete provenance. No private personal photographs are included.
