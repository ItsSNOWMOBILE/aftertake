# Depth and atmosphere

Aftertake estimates a still image’s actual relative depth, then uses that geometry for focus blur, atmospheric haze and soft directional lighting. The result is a normal image: use it as an edited frame, add it to Film, or animate it with LTX.

The optional estimator is [Depth Anything 3 Small](https://huggingface.co/depth-anything/DA3-SMALL), using [Comfy Org’s native checkpoint](https://huggingface.co/Comfy-Org/Depth-Anything-3). Its Apache-2.0 model revision, byte size and SHA-256 are pinned in [the download manifest](models-depth-effects.json). No paid API is involved.

```powershell
python scripts/setup.py --depth-effects
python scripts/engine.py
pnpm dev
```

Open **Depth and atmosphere**, choose or import a still image, then set the effects and create an image. Sources must be at least 64 pixels per side, no larger than four megapixels or 4096 pixels per side. Review **Source**, **Result** and **Model depth** separately. The depth preview displays near pixels dark and far pixels light; the downloadable NPZ retains actual float depth values.

- **Focus depth** selects the relative focus plane. Blur increases with distance from it.
- **Haze** increases toward the far end of the estimated depth; its color is editable.
- **Light direction, elevation and strength** apply soft shading from approximate depth normals. These controls do not reconstruct physical lights, cast shadows or measured camera geometry.

CUDA hardware preflight runs before the native DA3 loader can allocate its model. The adapter requests BF16 explicitly and retains ComfyUI’s native model operations and attention. It does not retry the model on CPU or in FP32. Image decoding, depth-coordinate processing and output effects use ordinary CPU media processing; the saved float depth field is data, not an FP32 model fallback.

Recipes bind the original image and pinned model. Importing a recipe restores settings without submitting a job. Native job identity, executed workflow, raw-depth hash and output hash remain recorded, and interrupted submissions can be reconciled with the original request key. Inspect the result and depth exports before using them elsewhere.

This version accepts **still images only**. Monocular geometry can be wrong around transparent objects, reflections, thin structures and ambiguous scenes. No temporal consistency or video-depth feature is claimed.
