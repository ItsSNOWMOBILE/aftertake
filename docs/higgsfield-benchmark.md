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
| Change a selected part of footage | Native inpainting, paint/erase, temporal fades, source-preserving composite; real room, foliage and waterfall outputs reviewed | Prompt following and edge quality vary; reference-image object identity not implemented |
| Reuse motion while rebuilding the scene | Original structure-guided regional pipeline | Full-scene motion transfer and character reference conditioning are not implemented |
| Animate a reference | LTX-2.5 first-frame conditioning; video-frame selection or normalized PNG/JPEG/WebP import; draft and finish sizes | GPU quality evidence recorded separately in progress.md; no end-frame reference yet |
| Direct camera and look | Five movement suggestions, four lens characters, five lighting options; inspectable prompt; four output grades; optional motion-track conditioning | Prompt-only direction is unreliable. Guided pullback and static framing passed visual checks on one room; broader scene coverage and 3D camera reconstruction remain open |
| Keep a film look across sources | Named local look library, built-in looks, settings preserved in recipes and MP4 metadata | No multi-user collaboration or identity lock |
| Start from an effect | Three transformation directions and three fully recorded example workflows | Broader searchable catalog and more varied effects needed |
| Iterate and remix | Durable takes, source/result/compare, seeds, editable recipes, exact executed graph export | Batch variation grid and collections needed |
| Finish a longer film | Short outputs up to 97 frames, local download | Multi-shot assembly, sound, longer continuous clips and 1080p delivery remain open |

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

1. Verify first-frame animation quality, playback, photo orientation and
   reusable looks through the real app and SDK.
2. Add an effects browser with honest previews and recipe-based starting points.
3. Add multi-shot project assembly and portable shot lists.
4. Evaluate open-weight reference conditioning for object/character replacement
   and full-scene motion transfer before exposing those capabilities.
