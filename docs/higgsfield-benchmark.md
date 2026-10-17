# Higgsfield replacement benchmark

Reviewed October 17, 2026. The product goal is an open replacement for useful
Higgsfield workflows. Competition readiness and full feature parity are
different milestones. A control is counted as implemented only when it changes
the executed workflow; generative quality still needs visual review.

## What was observed

Higgsfield's public [Genjutsu page](https://higgsfield.ai/genjutsu) distinguishes
whole-scene motion transfer from selected-element replacement with references.
The public page and its guide give different reference-image limits, so this
benchmark does not assume either number is a stable backend contract.

The live [Cinema Studio](https://higgsfield.ai/generate) was inspected while
signed out. Its own read-only WebMCP options exposed camera look, lens
character, lighting, palette, genre, era and pacing, plus start/end references,
aspect ratio and duration. Options differed from older screenshots. The
[October camera guide](https://higgsfield.ai/blog/ai-video-camera-control)
provides additional context about prompt-driven movement. These are product
observations, not evidence of access to the server implementation.

The [apps catalog](https://higgsfield.ai/apps) and
[effects collection](https://higgsfield.ai/collection/effects) make discovery
and repeatable starting points a major part of the experience.

## Coverage and gaps

| User job | Aftertake implementation | Remaining gap |
| --- | --- | --- |
| Change a selected part of footage | Native inpainting, paint/erase, temporal fades, source-preserving composite, optional edited-first-frame conditioning in both stages | Prompt following and edge quality vary; arbitrary identity replacement is not established |
| Prepare a new appearance inside the studio | Local Qwen-Image-Edit-2511 frame editor, optional subject image, seed, fast/detail modes, explicit review and selection, PNG and actual graph export | Single-image and two-image native tests passed on the forest; broader scene quality and arbitrary identity consistency remain under evaluation |
| Reuse motion while rebuilding the scene | Original structure-guided regional pipeline | Full-scene motion transfer and character reference conditioning are not implemented |
| Animate a reference or connect two images | LTX-2.5 first-frame conditioning; optional ending image, upload/select/inspect or create with local Qwen; hash-bound recipe sharing; first/last guides with optional motion tracks | Real draft and finish transitions checked on the forest scene. Endpoints are soft constraints; broader scene and transition quality remain under evaluation |
| Direct camera and look | Five movement suggestions, four lens characters, five lighting options; inspectable prompt; four output grades; optional motion-track conditioning | Prompt-only direction is unreliable. Guided pullback and static framing passed visual checks on one room; broader scene coverage and 3D camera reconstruction remain open |
| Keep a film look across sources | Named local look library, built-in looks, settings preserved in recipes and MP4 metadata | No multi-user collaboration or identity lock |
| Start from an effect | Searchable library of seven reviewed effects/camera recipes with actual source/result previews; inspect/import recorded takes or apply direction to your source and cue | More varied scenes and effects needed |
| Iterate and remix | Durable takes, source/result/compare, seeds, editable recipes, exact executed graph export | Batch variation grid and collections needed |
| Finish a longer film | Trim and join up to eight finished takes; three 720p canvas shapes, source audio, portable hash-bound shot manifest | Longer continuous generation, transitions and 1080p delivery remain open |

The frame-animation path loads the same public LTX-2.5 backbone, text encoder
and VAE as masked editing, with **no inpainting adapter**. Camera and look
settings are compiled into the actual text encoder input; color grading is
also applied after generation. There are no partner
inference nodes or closed model calls in this path.

## Open-source references

- [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI)
  (MIT): useful reference for separate creation surfaces and exposed camera
  modifiers. Its advertised model count includes API integrations; that is not
  a substitute for a locally executed open-weight workflow.
- [Sonder Editor](https://github.com/SonderSaid/ComfyUI-Sonder-Editor)
  (GPL-3.0): reference for scenes, staged rendering and take management.
- [Montagen](https://github.com/MontagenAI/ComfyUI-Montagen)
  (AGPL-3.0): reference for node-controlled timeline composition.

These projects were reviewed for interaction and architecture ideas. No code
or assets from them are incorporated in Aftertake at this milestone.

## REA investigation

[REA](https://github.com/morluto/rea) 6.5.0 (MIT) was run as a local CLI on two
public Higgsfield JavaScript files observed in the browser. Static parsing
completed: 203,090 text bytes, 48,363 AST nodes visited, no parse failures.
The local Evidence ID is
`ev_b0bb5b3bbe6eb33c85ab4e91e88badc4127fc3ca6fdf248f210f8eb021cc459c`.

The evidence is partial: dynamic imports and server behavior are outside that
two-file scope. No downloaded JavaScript was executed. REA was not registered
as an MCP server, and no user credentials or private account data were read.
Downloaded proprietary bundles stay in ignored local research storage.

## Next replacement milestones

1. Evaluate arbitrary object/character identity conditioning and full-scene
   motion transfer across additional footage before exposing those capabilities.

The [current official inpainting guide](https://docs.ltx.io/open-source-model/feature-guides/editing-effects/in-outpainting)
supports an edited first frame as an object-replacement aid. Draft and finish
pilots passed, followed by a real finished app render. The product now supports
uploading/selecting this reference, exporting the starting frame, and preserving
its hash through recipe sharing. The sixth bundled case contains both images
and its actual workflow. This does not establish arbitrary identity replacement.
The separate
[Ingredients adapter](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients)
targets LTX-2.3 reference sheets and has a separate publisher access gate; it
has not been downloaded or represented as an installed capability.

First-frame animation, saved film looks and guided framing have completed real
SDK renders. The film desk now trims and orders up to eight completed takes,
exports 720p MP4s with original audio or silence, and saves a hash-bound shot
manifest. Upright phone-video handling and trimmed source sound also passed a
native masked-edit render on the local RTX 5080.
