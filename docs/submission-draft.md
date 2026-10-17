# Submission draft — pending publication

Project: **Aftertake**

Primary target: Open Weights Only. Also demonstrate the cue system's novelty
for Most Innovative, and the native LTX workflows for the LTX bonus.

## Description

Aftertake is an open VFX studio for directing where a video changes and when
the change appears. Paint a region, erase protected detail, set the timing and
describe the transformation. One editable cue supplies spatial conditioning
and controls the final source-preserving composite. Every take carries its
recipe and the executed ComfyUI graph so another creator can reproduce or
remix it.

The studio also animates a photo or selected source frame. Optional
motion-track conditioning supplies explicit framing trajectories, with the
exact guide saved beside the result. Named film looks travel between sources;
color grading is consistent across frames.

Five real examples include source media, recipes, actual graphs and outputs.
The example workspace works without Python, model downloads or a GPU; new
generation uses a connected local Comfy engine. All inference uses open
weights through the official Comfy SDK and local Comfy v2 proxy.

## Tools and techniques

- React/TypeScript studio; official `@comfyorg/sdk` integration.
- LTX-2.5 distilled GGUF, Gemma 4 encoder and video VAE.
- Native inpainting IC-LoRA and optional motion-track IC-LoRA.
- Custom Comfy nodes for source sampling, editable masks, temporal envelopes,
  exact-source compositing, stable output grading and recipe-bearing MP4s.
- Optional classical OpenCV optical-flow mask tracking and CPU mask previews.
- Original procedural source and attributed Pexels examples; local OFL fonts.

## Novelty to show

The spatial and temporal cue is an editable part of the generative workflow,
not just a drawn annotation. Its spatial selection enters model conditioning;
its envelope controls compositing after generation. Erasing protects source
detail. The same recipe can be inspected, changed and run through an exported
graph. The demo should make the protected fan and timed portal visibly clear.

## Current limits

Camera guidance is experimental. Prompt-only control is unreliable; guided
pullback and static framing have been checked on one room. Quality varies
with scene, mask and prompt. Output sizes are rounded for the model's latent
grid. Exports are currently short and silent. Other GPU/OS combinations have
not been validated.

## Publication checklist

- Repository: pending; source is committed locally under MIT.
- Demo: 68-second silent captioned MP4 prepared locally; upload pending.
- Social post: draft below; no post has been sent.
- Sign-up/submission: pending; inspect the final terms and required identity
  fields before submission. No registration or award is claimed.

## Social post draft

Aftertake: an open studio for impossible takes.

Paint what changes. Erase what stays. Choose when it happens. Animate a still
with motion-track framing guides, then pass on the editable recipe and actual
ComfyUI graph.

Local open weights through the Comfy SDK. MIT app code. Five real examples
you can explore without downloading the models.

[Demo URL pending] · [Repository URL pending]

#OpenSourceHiggsfield
