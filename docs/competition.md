# Competition target and evidence

Primary objective: win an RTX 5090 in the Open Source Higgsfield challenge.
The result is not achieved until an award is verified. A running prototype is a milestone.

Primary target: Open Weights Only. Secondary: Most Innovative. Best Overall is upside.
Source: https://comfy.org/open-source-higgsfield/ (page and expanded requirements rechecked October 18, 2026).
Deadline: October 30, 2026, 09:00 Pacific / 12:00 America/Toronto.

## Submission details verified in the official page's expanded sections

- Use Comfy Router and/or the Comfy SDK.
- Public GitHub app code, workflow files, open-source license and local setup.
- Demo video: **two minutes maximum**. Explain all combined tools and techniques;
  explain the novelty explicitly for Most Innovative.
- A social post linking the demo on Reddit, X, Instagram, LinkedIn, YouTube or
  TikTok, tagged **#OpenSourceHiggsfield**.
- Deployed app or endpoint is optional but strongly encouraged.
- One submission per person. Work must be lawful and SFW, without unlicensed
  IP or likenesses. Submission permits the listed organizers and partners to
  feature the work with credit.
- Sign-up: https://form.typeform.com/to/Ayn9Cwfj
- Submission: https://form.typeform.com/to/V1dSQrkS

Jay reviews the final terms and submits personally. Unlicensed research media
is excluded from the public entry. Public examples retain their source licenses,
including the credited silent CC BY 3.0 Tears of Steel scene with a fictional
generated appearance. No actor or creator endorsement is claimed.

## Product thesis

Aftertake is a VFX instrument for short clips: draw the region that can change,
set a temporal cue, describe the transformation, render, and share the editable
recipe. The distinguishing experiment is a spatial/temporal score that guides
generation AND composites the result onto the source. Untouched pixels must
remain the source, rather than relying on a text model to preserve them.

## Required evidence before submission

- [x] Official Comfy SDK integration exercised against real ComfyUI, not a mock.
- [x] Full generation graph uses only open-weight models, no partner nodes or closed inference APIs.
- [x] Thirteen reviewed VFX/reference recipes plus native H3 and text-to-video cases, with applicable sources/recipes/graphs, are bundled under `examples/`.
- [x] Spatial and temporal controls visibly affect the actual generation/composite.
- [x] Fresh Windows runtime install, actual import/render, UI import/export and source-hash matching exercised. Other hardware/OS combinations remain unverified.
- [ ] Final source review by Jay. The [public GitHub repository](https://github.com/ItsSNOWMOBILE/aftertake) carries the MIT app, workflows and example media; complete source downloads are also on the showcase. GitHub app access has been restored. Final review remains a separate gate.
- [ ] Demo approved by Jay. The [44-second review cut](https://aftertake-studio.right-bard-9761.chatgpt.site/?review=h3-11#demo) contains the native H3 replacement, broader creation workflow and authentic editor reveal. The latest text-to-video addition has separate native examples and agent evidence; it is not yet part of this cut.
- [x] A separate [72-second narrated judges’ review](https://aftertake-studio.right-bard-9761.chatgpt.site/judges/) explains the model roles, combined techniques and contribution. Exported through the actual Film editor with a fresh editor reveal; see `judges-film-evidence.json`. Jay's approval remains a separate gate.
- [ ] Required social post linking the demo with #OpenSourceHiggsfield published.
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
