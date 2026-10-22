# Aftertake: project overview

Aftertake is an open creative studio for ads, reels and impossible scenes.
It combines localized video transformation with reference editing, character
replacement, local narration, animated typography and an editable Film timeline.

## One cue, two connected operations

Paint the region that may change and choose when the transformation appears.
The cue conditions generation and controls compositing over the original video.
That gives the user explicit control over the transformation's location and
entrance, while retaining source pixels outside the cue. Optional motion
tracking and boundary color correction support source-preserving finishing.

## A continuous creative workflow

Create or edit an image, animate a frame, generate a short shot from text, or
replace a tracked person using an original reference photo. Inspect the result,
then add the completed source directly to Film. Saved recipes retain model
settings, source hashes, seeds and the executed native graph.

Film supports landscape, square and portrait edits, narration, audio tracks,
editable titles and word-timed typography. The narrated-cut builder pairs spoken
lines with pictures and uses measured voice durations to prepare trims and
captions. Changing a hook can reuse unchanged media and voices.

## Agent editing stays editable

The 27-tool local MCP interface lets an agent inspect media, generate native
takes, voice short beats, save a content-bound plan and export it through the
same Film renderer. Stable request IDs rejoin recorded work after a timeout.
The resulting project can be opened and revised in the application.

## Explore the implementation

- [Public showcase](https://itssnowmobile.github.io/aftertake/)
- [Recorded browser editor](https://itssnowmobile.github.io/aftertake/studio/)
- [Narrated workflow demo](https://itssnowmobile.github.io/aftertake/judges/)
- [GitHub source](https://github.com/ItsSNOWMOBILE/aftertake)
- [Installation and studio guide](studio-guide.md)
- [Agent interface](mcp.md)
- [Capability inventory and limitations](higgsfield-benchmark.md)
- [Architecture and reproducibility](competition.md)

The browser showcase uses real recorded outputs. New model inference runs in
the installed local application with its configured Comfy engine. Model weights
are downloaded separately and are not included in the source repository.

## Scope and limits

Generative shot quality, identity fidelity and camera adherence vary. Masks and
finished cuts require review. Managed cloud rendering, persistent identities
across arbitrary shots and full marketing-suite parity are not implemented.
The public examples preserve their source and model licensing notices.
