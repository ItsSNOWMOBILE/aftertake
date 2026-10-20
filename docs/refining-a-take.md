# Refine a saved take’s blend

A successful **Transform a region** take includes its original raw generation.
You can adjust where that generation meets the source without running the model
again. The original take stays in the library.

1. Select a finished region VFX or masked edit in **Takes**.
2. Choose **Refine blend** beneath the viewer. Paint a separate final area using
   the existing cue canvas; adjust its feather, tracking or boundary color match.
3. Choose **Update blend**. Aftertake uses the saved raw video and original source
   on the CPU, then adds a new take. Review moving edges and the full result.

The generation prompt, seed, source trim and timed generation cue must stay the
same. Changing them requires a deliberate new generation. **Use generation
region** restores the original spatial region for the final composite.

This can protect source detail that a broad generated region softened. It does
not repair changing architecture, anatomy, identity or motion inside the actual
generated content. Keep enough room for the intended effect and inspect the whole
shot, including the temporal fade.

## Runtime and provenance

The CPU worker uses Torch, PyAV, OpenCV, Pillow and Kornia from the local engine
runtime. `AFTERTAKE_CUE_PYTHON` selects an explicit alternative runtime. It loads no
model weights and does not change any neural precision, CUDA kernel or device
policy. Static compositing streams in small chunks; flow tracking retains the
same bidirectional tracking semantics as the native nodes.

Both input files are verified by SHA256. The new take retains the source clock
and audio, plus an explicit CPU processing receipt. Its original executed Comfy
graph is stored separately in that provenance; the CPU pass never claims to have
executed another graph. **Export blend receipt & original graph** downloads both
roles together. Keep the source, raw video and receipt to reproduce the blend.

Saved attempts survive reconnection. Check an uncertain request before retrying
with its original key. A server restart marks unfinished CPU work interrupted;
it does not silently start another operation.

Agents use `aftertake_refine_blend`, `aftertake_blend_status` and
`aftertake_cancel_blend`. The same source validation, durable job and output path
serve the visual editor and MCP.
