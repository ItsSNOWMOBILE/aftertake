# Challenge build: architecture and reproducibility

Aftertake is an open creative studio built on the Comfy Developer Platform.
Its core interaction is a painted, timed cue: the same spatial mask guides a
generated transformation and composites it over the source. Outside the active
mask and time envelope, the source supplies the pixels.

## Open-weight implementation

The application uses the official Comfy SDK and a local Comfy v2 proxy. Its
generation workflows run locally with open-weight models; they do not call
partner inference nodes or closed model APIs. App code is MIT licensed. Models,
third-party nodes and example media retain their individual licenses.

- Z-Image Turbo creates stills; Qwen Image Edit edits reference images.
- LTX-2.5 powers video transformation, frame animation and text-to-video.
- Wan Animate 2 transfers a driving performance.
- SAM3 tracks a selected person; MiniMax H3 replaces that person using a primary
  reference photo, an optional head crop and up to seven supporting identity views.
- Optional SAM 2.1 mattes finish saved generations and protect foreground subjects.
- Kokoro supplies local generic narration; PyAV, Pillow and FFmpeg assemble films.

The local MCP interface exposes the same native workflows and editable Film
projects. Stable operation keys let an agent rejoin recorded generation and
export work. Review tools return decoded frames and measured audio evidence.

## Reproducible evidence

The public examples include their source attribution, recipes and executed
workflow graphs. The [studio guide](studio-guide.md) documents setup, model
profiles and commands. The [capability inventory](higgsfield-benchmark.md)
distinguishes implemented behavior from unimplemented features.

The bridge and stock-footage examples retain their source licenses and credits;
the bridge replacement uses a fictional generated appearance. The separate
[Hotel Lobby demonstration](../examples/hotel-lobby/README.md) uses a supplied
portrait and a credited COLORS performance excerpt. Its walkthrough includes
the portrait's cropped view in actual UI captures; the original portrait file
and separate private upload tests are excluded. Source rights and model terms
remain separate from the MIT app license. No actor, source creator or model
publisher endorsement is implied.

The tested generation machine uses an RTX 5080 with 16 GB VRAM and 32 GB RAM.
CPU media tests and browser editing do not require the generation models.
Generation on other hardware still requires independent verification.

## Challenge context

The official [Open Source Higgsfield challenge](https://comfy.org/open-source-higgsfield/)
includes an Open Weights Only category and an LTX VFX bonus. The LTX bonus
requires LTX to be the workflow's core video model. Category selection and
eligibility are determined by the organizers.

The published deadline is October 30, 2026 at 9 am Pacific. The official page
says the demo should show the application working and explain how it was built.
The repository and showcase document the implementation; publication of these
materials is not evidence of a submitted entry or an award.

## Quality boundaries

Passing tests, valid output clocks and embedded graphs establish specific
engineering properties. They do not establish visual quality, identity fidelity
or general creative competence. Faces, articulation, hands, occlusions, seams,
motion and complete audio/video edits require review of actual outputs.

The app makes no claim of full Higgsfield feature parity or a verified industry
first. See the capability inventory and individual example notes for limitations.
