# Submission draft — source and demo published

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

Transfer motion combines a driving video with a separately chosen appearance
image using local Wan Animate 2 distilled weights. Create the appearance in the
Qwen editor or import it, inspect its actual center crop, then animate the whole
frame or blend it through a painted/timed cue. Driving and appearance hashes,
motion caption, seed and scope travel in the recipe. A controlled mirrored-driver
pair changed the waved arm while appearance, seed and neutral prompts stayed
fixed. Broader human identity and facial-performance claims remain unestablished.

An optional ending image gives a shot a defined destination. Import it or
design it with the local Qwen editor, explicitly review and select it, then
generate the transition between both frames. Start/end guides can also be
combined with motion tracks. Both input assets are hash-bound, verified before
generation and retained in shared recipes. Endpoints remain soft constraints.

Optional edited-first-frame conditioning sets the intended appearance for a
masked edit. It enters both native generation stages while the original cue
controls the visible region and timing. The source and edited frame are hash-bound
and checked before submission. A complete reference-led example is included.

Create that appearance inside the studio with local Qwen-Image-Edit-2511.
An optional subject reference supports a second image; fast and detailed modes
retain the seed and executed graph. Review the frame before attaching it to the
video recipe. The crystal-forest example includes both the image-editing recipe
and the finished two-stage LTX video, all generated with local open weights.

An editable film desk trims and orders up to eight completed takes, preserving
source sound where available. Its 720p exports include a portable shot manifest
with output hashes, recipes and actual workflows. Rotated phone footage stays
upright throughout import, cue preview and generation.

Seven real examples include source media, recipes, actual graphs and outputs.
The searchable recipe library shows actual source/result previews, opens the
recorded take, or applies its direction while keeping the user's source and cue.
The example workspace works without Python, model downloads or a GPU; new
generation uses a connected local Comfy engine. All inference uses open
weights through the official Comfy SDK and local Comfy v2 proxy.

## Tools and techniques

- React/TypeScript studio; official `@comfyorg/sdk` integration.
- LTX-2.5 distilled GGUF, Gemma 4 encoder and video VAE.
- Wan Animate 2 distilled int8 backbone, UMT5, CLIP vision and Wan VAE;
  separate motion/appearance conditioning and compact native motion caches.
- Native inpainting IC-LoRA and optional motion-track IC-LoRA.
- Optional Qwen-Image-Edit-2511 GGUF, Qwen2.5-VL encoder and Lightning adapter
  for creating edited frames locally.
- Custom Comfy nodes for source sampling, editable masks, temporal envelopes,
  exact-source compositing, stable output grading and recipe-bearing MP4s.
- Optional classical OpenCV optical-flow mask tracking and CPU mask previews.
- PyAV display-matrix normalization and frame-aligned FFmpeg film assembly.
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
grid. Individual generated shots are short; the film desk joins and trims up to
eight finished takes. Region edits preserve source sound; reference-frame
animation is silent. Other GPU/OS combinations have
not been validated.

## Publication checklist

- Repository: https://github.com/ItsSNOWMOBILE/aftertake — public MIT source,
  workflows, setup and seven recorded examples. Anonymous Git access verified.
- Try the editor: https://itssnowmobile.github.io/aftertake/studio/ — browser
  trial with seven recorded examples, editable cues and workflow exports.
  Recorded results stay unchanged; new generation runs in the local studio.
- Demo: https://itssnowmobile.github.io/aftertake/ — live 97-second silent
  captioned video, verified at 1280 × 720 / 24 fps. Generation waits are omitted.
  Refresh this cut with motion transfer and the ending-frame workflow before
  the final social post and entry; those newer capabilities are local evidence.
- Social post: draft below; no post has been sent.
- Sign-up/submission: pending; inspect the final terms and required identity
  fields before submission. No registration or award is claimed.

## Social post draft

Aftertake: an open studio for impossible takes.

Paint what changes. Erase what stays. Choose when it happens. Animate a still
with motion-track framing guides, then pass on the editable recipe and actual
ComfyUI graph.

Local open weights through the Comfy SDK. MIT app code. Seven real examples
you can explore without downloading the models.

https://itssnowmobile.github.io/aftertake/
https://github.com/ItsSNOWMOBILE/aftertake

#OpenSourceHiggsfield
