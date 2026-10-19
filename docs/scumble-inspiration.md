# Scumble: ideas adapted for a video workflow

[Scumble](https://github.com/DenRakEiw/scumble) is DenRakEiw’s still-image editor shown in [the competition post](https://x.com/dennis84322486/status/2112168946291867764). This audit uses release source at [`a111fe2`](https://github.com/DenRakEiw/scumble/tree/a111fe2f989534f80eaa4eb8483304694a4767e9). Its useful lesson for Aftertake is making a selection reusable: a person can become an editable cutout, rather than requiring another generation for every placement.

## Subject duplication

Scumble’s [selection and layer commands](https://github.com/DenRakEiw/scumble/blob/a111fe2f989534f80eaa4eb8483304694a4767e9/renderer/commands.js#L974) let a user isolate a subject, duplicate the layer and move its position. Duplication copies pixels and the layer mask; moving a copy sideways does not require diffusion. The separate [content-aware Move / Extend tool](https://github.com/DenRakEiw/scumble/blob/a111fe2f989534f80eaa4eb8483304694a4767e9/docs/MANUAL.md#L239) can also fill a vacated area. These are image operations, not evidence of tracked video duplication.

Aftertake’s corresponding video workflow uses its existing, reviewed SAM3 selection. Each frame’s source pixels and tracked matte produce up to four extra copies, with independent offsets, scale, rotation, opacity and horizontal flip. Scale and rotation share a fixed anchor from the first tracked frame. The original person remains. Grow and feather adjust copy edges. Background blur and exposure act outside the original person’s matte; zero copies allows a focus-only edit. This effect uses CPU compositing and can reuse a saved selection while the generation engine is offline. The output retains the selected source range and its audio. A portable recipe binds the source, prepared frames and tracked mask by their hashes.

## Features that fit Aftertake

The [official feature inventory](https://github.com/DenRakEiw/scumble#features-in-detail) and [manual](https://github.com/DenRakEiw/scumble/blob/a111fe2f989534f80eaa4eb8483304694a4767e9/docs/MANUAL.md) describe a much broader image editor. Video features need their own temporal behavior and validation.

| Scumble behavior | Aftertake application | Scope |
| --- | --- | --- |
| Selection becomes an editable layer | Reuse a tracked person matte for positioned copies | Subject effects |
| Mask grow, shrink and feather | Expose edge controls and review the actual encoded result | Subject effects |
| Saved layers and repeatable commands | Portable, hash-bound recipes; reuse exact settings | Subject effects and existing recipe tools |
| Colour matching and filter layers | Editable finishing controls on footage, before final export | Film finishing; not depth-aware relighting |
| Depth-driven lens blur, haze and virtual light | Native DA3 Small estimates a still-image depth field; editable pixel effects use that measured field | Still images up to four megapixels, followed by optional animation |
| Text and agent commands | Reuse Film typography, narration and MCP operations | Existing Film workflow; extend shared commands |
| Multiple reference images | Keep primary identity plus supporting views visible | Existing character replacement |
| Local / cloud execution with clear status | Explain the active compute target and availability | Existing compute framework; paid execution requires configuration |

The finishing workspace adds five adjustable looks, exposure, white balance, contrast, saturation, sharpness, vignette and deterministic grain. Undo and redo retain editable settings, and an exact processed-frame preview shares the export pixel pipeline. Video exports preserve source frame timing and retain its audio once. Unchanged settings preserve the original file bytes.

Depth effects use the existing native Comfy DA3 loader and inference at explicit BF16 precision on CUDA. The optional 137 MB model download is pinned and hash checked. The original canvas, lossless raw depth, executed workflow and recipe remain available for review. Lighting approximates surface normals from a monocular depth estimate; it does not reconstruct hidden geometry or repair a generated object's shape. Video depth needs stable per-frame depth and temporal tests before it can be described as a supported feature.

Full PSD/ORA editing, a general paint editor, arbitrary blend-mode parity and every provider integration remain outside Aftertake's current video workflow.

## Attribution and implementation boundary

Scumble and its companion node pack are [GPL-3.0 licensed](https://github.com/DenRakEiw/scumble/blob/a111fe2f989534f80eaa4eb8483304694a4767e9/LICENSE). Aftertake’s subject, finishing and depth effects are independent implementations using its own tracked selections, schemas, pixel processors, UI, native Comfy nodes and existing Film handoff. No Scumble source, assets, compiled modules or model downloads are included. The links above document behavior and credit the project that inspired this workflow.
