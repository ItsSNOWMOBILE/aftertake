# Scumble: ideas adapted for a video workflow

[Scumble](https://github.com/DenRakEiw/scumble) is DenRakEiw’s still-image editor shown in [the competition post](https://x.com/dennis84322486/status/2112168946291867764). This source study is pinned to [`33758aa`](https://github.com/DenRakEiw/scumble/tree/33758aa45f15f36ac76afc02329ae0fec3b2a28e) and examines actual layer, mask, grading and optical implementations, alongside the manual. Its useful lesson for Aftertake is keeping source pixels, selections and adjustments editable instead of requiring another generation for each placement or color change.

## Subject duplication

Scumble’s [selection and layer commands](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/renderer/commands.js) let a user isolate a subject, duplicate the layer and move its position. Duplication copies pixels and the layer mask; moving a copy sideways does not require diffusion. The separate [content-aware Move / Extend tool](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/docs/MANUAL.md#L239) can also fill a vacated area. These are image operations, not evidence of tracked video duplication.

Aftertake’s corresponding video workflow uses its existing, reviewed SAM3 selection. Each frame’s source pixels and tracked matte produce up to four extra copies, with independent offsets, scale, rotation, opacity and horizontal flip. Scale and rotation share a fixed anchor from the first tracked frame. The original person remains. Grow and feather adjust copy edges. Background blur and exposure act outside the original person’s matte; zero copies allows a focus-only edit. This effect uses CPU compositing and can reuse a saved selection while the generation engine is offline. The output retains the selected source range and its audio. A portable recipe binds the source, prepared frames and tracked mask by their hashes.

## Features that fit Aftertake

The [official feature inventory](https://github.com/DenRakEiw/scumble#features-in-detail) and [manual](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/docs/MANUAL.md) describe a much broader image editor. Video features need their own temporal behavior and validation.

| Scumble behavior | Aftertake application | Scope |
| --- | --- | --- |
| Selection becomes an editable layer | Reuse a tracked person matte for positioned copies | Subject effects |
| Mask grow, shrink and feather | Expose edge controls and review the actual encoded result | Subject effects |
| Saved layers and repeatable commands | Portable, hash-bound recipes; reuse exact settings | Subject effects and existing recipe tools |
| Ordered image and filter layers | Up to eight still-image and adjustment layers, with 27 executed blend modes | Layers & masks, CPU still-image compositor |
| Attached masks and image transforms | Rectangle, ellipse or image masks; inversion, grow/shrink and feather; affine image placement | Layers & masks |
| Selective color, curves and imported LUTs | Eight color ranges, monotone master/R/G/B curves, hash-bound display-sRGB `.cube` LUTs | Shared finishing and layer adjustments |
| Colour matching and filter layers | Editable finishing controls on footage, before final export | Film finishing; not depth-aware relighting |
| Depth-driven lens blur, haze and virtual light | Native DA3 Small estimates a still-image depth field; editable pixel effects use that measured field | Still images up to four megapixels, followed by optional animation |
| Text and agent commands | Reuse Film typography, narration and MCP operations | Existing Film workflow; extend shared commands |
| Multiple reference images | Keep primary identity plus supporting views visible | Existing character replacement |
| Local / cloud execution with clear status | Explain the active compute target and availability | Existing compute framework; paid execution requires configuration |

The finishing workspace includes five adjustable looks, exposure, white balance, contrast, saturation, sharpness, vignette and deterministic grain. Eight-channel selective HSL, editable monotone master/R/G/B curves, and imported 3D LUTs provide substantial grading controls beyond presets. Highlight glow, warm halation and stylized RGB separation have independent strengths and radii/offsets. Undo and redo retain editable settings, and an exact processed-frame preview shares the export pixel pipeline. Video exports preserve source frame timing and retain audio once. A fully unchanged finish preserves the original file bytes.

The source audit traces Scumble’s actual [selective grading](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/renderer/editor/inpaint_grade.js), [curves](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/renderer/editor/inpaint_curves.js), [LUT parsing and dispatch](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/renderer/editor/inpaint_filters.js), [image-derived dehaze](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/renderer/editor/inpaint_haze.js), [procedural glass](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/plugins/effects/glass.js), [lens blur](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/renderer/editor/inpaint_lensblur.js) and [relighting](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/renderer/editor/inpaint_relight.js). These inform the scope; they do not establish matching algorithms or pixels in Aftertake.

## Layers and masks

**Layers & masks** composes still images on the CPU. A project holds up to eight ordered image or adjustment layers on a canvas up to four megapixels. Native Film image imports retain PNG transparency. Image layers support position, scale, rotation and horizontal flip; adjustment layers apply the shared finishing processor to the composite beneath them.

All 27 exposed blend modes execute in the pixel compositor, including hue, saturation, color and luminosity. Visibility, opacity, clipping to a lower image and a seeded dissolve remain editable. Rectangle, ellipse and imported-image masks support inversion, grow/shrink and feathering. Image masks can read luminance or alpha. An attached image mask follows its layer’s transform; an adjustment mask uses canvas coordinates.

**Render preview** calculates an actual PNG. Editing a control marks the preview stale until it is rendered again; there is no CSS blend approximation. **Save PNG** creates a normal image clip for editing or Film. A portable plan retains ordered layers, parameters and source/mask SHA-256 bindings. JSON does not bundle media: import matching image and mask files before restoring it elsewhere. Imported LUTs also need their matching `.cube` companions. This is a bounded still-image compositor, not a PSD/ORA editor or a tracked video-layer timeline.

## Depth and remaining gaps

Depth effects use the existing native Comfy DA3 loader and inference at explicit BF16 precision on CUDA. The optional 137 MB model download is pinned and hash checked. The original canvas, lossless raw depth, executed workflow and recipe remain available for review. Lighting approximates surface normals from a monocular depth estimate; it does not reconstruct hidden geometry or repair a generated object's shape. Video depth needs stable per-frame depth and temporal tests before it can be described as a supported feature.

PSD/ORA round-trip editing, a general paint editor, non-affine mesh/warp tools, procedural glass, image-derived dehaze, richer disc bokeh, and arbitrary multi-light rigs with height-field shadows are not implemented in Aftertake. Its current depth effects are still-only; stable video depth needs source-clock binding and temporal validation. Provider and layer-format compatibility are separate work. No complete Scumble feature or visual parity is claimed.

## Attribution and implementation boundary

Scumble and its companion node pack retain their [GPL-3.0 license](https://github.com/DenRakEiw/scumble/blob/33758aa45f15f36ac76afc02329ae0fec3b2a28e/LICENSE). Aftertake’s subject effects, layer compositor, grading and depth effects are independent implementations using its own tracked selections, schemas, pixel processors, UI, native Comfy nodes and Film handoff. No Scumble source, assets, compiled modules or model downloads are included in the app.

Standard blend and alpha behavior follows [W3C Compositing and Blending](https://www.w3.org/TR/compositing-1/), with explicit formulas for additional modes such as dissolve and linear-light. Shape-preserving curves use the published [PCHIP slope construction](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html), implemented in Aftertake’s own code. The LUT parser treats `.cube` domains as input bounds, following the [OpenColorIO Iridas format reference](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/fileformats/FileFormatIridasCube.cpp). These standards and mathematical contracts are distinct from copying another editor’s GPL implementation or promising identical rounding and color rendering. LUTs require a declared display-referred sRGB input; log and ACES transforms need conversions this workspace does not supply.
