# Competition target and evidence

Primary objective: win an RTX 5090 in the Open Source Higgsfield challenge.
The result is not achieved until an award is verified. A running prototype is a milestone.

Primary target: Open Weights Only. Secondary: Most Innovative. Best Overall is upside.
Source: https://comfy.org/open-source-higgsfield/ (verified October 17, 2026).
Deadline: October 30, 2026, 09:00 Pacific / 12:00 America/Toronto.

## Product thesis

Aftertake is a VFX instrument for short clips: draw the region that can change,
set a temporal cue, describe the transformation, render, and share the editable
recipe. The distinguishing experiment is a spatial/temporal score that guides
generation AND composites the result onto the source. Untouched pixels must
remain the source, rather than relying on a text model to preserve them.

## Required evidence before submission

- [ ] Official Comfy SDK integration exercised against real ComfyUI, not a mock.
- [ ] Full generation graph uses only open-weight models, no partner nodes or closed inference APIs.
- [ ] Good outputs on at least three materially different source clips.
- [ ] Spatial and temporal controls visibly affect the actual generation/composite.
- [ ] A new user can install, import a clip, render, export, and remix.
- [ ] Public repository with MIT license, setup, model inventory, third-party attribution.
- [ ] Demo explains the innovation and shows actual input, interaction, and output.
- [ ] Registration and submission completed with the correct category and links.
- [ ] Award decision checked when published (official page currently says November 6).

## Current hardware

RTX 5080, 16 GB VRAM; 32 GB system RAM. Model quality and memory are early risks.
Model and runtime files are ignored, not shipped in the source repository.

## Engineering priorities

1. Real local inference, memory and timing measurement.
2. Cue masks and motion-preserving guidance; compare against whole-frame generation.
3. Usable editing surface and accurate job progress.
4. Reproducible recipes, runnable workflows, licensing and demo assets.

Do not claim category eligibility or visual quality from dependency installation
or passing unit tests. Preserve actual output evidence and known failures.
