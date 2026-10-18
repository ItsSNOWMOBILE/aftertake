# Performer focus

The experimental **Focus on one performer** option gives Wan a larger view of
one person while keeping the final scene's original position and aspect ratio.
It is available in Transfer motion, under Painted and timed cue.

Use a scene-matched appearance image with the same framing and aspect ratio as
the driving shot. The initial box covers positive paint with extra context.
Adjust its left, top, width and height percentages to include the entire moving
body, hands and head. A tight box can cut off a gesture; a broad box gives the
model less detail about the person. Review a short take.

The workflow crops both conditions with the same bounds, generates at the
focused aspect ratio, then restores those pixels into a copy of the driving
frames. The painted cue and optional tracked matte operate on that restored
whole frame. The crop creates no timeline zoom and changes no frame timestamps.
Pixels outside it are exact copies before later resizing and encoding.

The result has three downloads:

- **Download video:** the painted composite, with the source display geometry.
- **Placed generation for finishing:** the full model-grid frame, before paint.
  Import this file for a saved-generation matte finish.
- **Focused model output:** the actual model crop for inspection.

The box is part of the exported recipe and generation identity. A saved take
from different bounds cannot be used as its generation. Finishing a saved take
loads the placed frames and composites them directly; it does not generate or
crop the performance a second time.

The local bridge comparison held the source, decoded appearance, captions,
seed, sampler and quality constant. Changing only performer focus recovered
more of the ending head turn than the unfocused control. A separate lower
strength test reduced expression intensity and also reduced the turn. This is
one reviewed shot, not general evidence of identity, lip-sync or motion quality.
The reference was generated locally; the silent driving excerpt is Tears of
Steel, Blender Foundation, CC BY 3.0. Attribution remains with the examples.

The native crop/restore tests cover frame count, invalid bounds, preservation
of source pixels outside the crop, and unchanged source tensors. TypeScript
checks cover recipe round trips, generation binding, the actual graph wiring,
and finishing without another sampling pass. A moving subject matte still
requires explicit, reviewed annotations through `create-motion-matte.py`.
