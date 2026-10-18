# Stable portrait / bridge performance candidate

Actual output of `scripts/create-head-performance.py request.json --output NEW.mp4`.
Use a fresh filename; the shipped result is retained. Run from the repository
root with the full example paths as shown in `docs/head-performance.md`.

The 73-frame, 24 fps silent shot starts with the existing Wan/SAM brown-jacket
body plate. A fixed aligned portrait supplies facial appearance; the original
silent performance supplies relative head rotation and direct lip expression.
Two explicit SAM 2.1 head annotations preserve the incoming head contour while
limiting old-head removal to exposed pixels. Full-body gestures and the original
woman remain in the base plate. This local finishing candidate is imported
as footage into the current 71.67-second judge movie.

`request.json` binds all inputs. `portrait-provenance.json` records the actual
native Comfy SDK study from which the aligned first-frame portrait was cropped.
The rejected rectangular crop is never placed directly into this final scene.
`result.receipt.json` binds models, annotations, output, coverage matte and the
separate source/generation mask arrays. `evidence.json` checks every timestamp
and measures decoded differences outside the edited area. The NPZ arrays are
included in the complete source ZIPs; the public page plays the coverage matte.

This is one reviewed clip. Small neck/background seams and portrait sharpness
still need creative review. No audio-driven viseme or general identity guarantee
is made. The NPU is not used.

Source: Tears of Steel (2012), Blender Foundation, https://mango.blender.org/about/,
CC BY 3.0: https://creativecommons.org/licenses/by/3.0/. Changes: silent excerpt,
resize, fictional character appearance, Wan Animate transfer, SAM composite,
portrait-driven head animation, tracked head matte and exposed-contour fill.
No actor or creator endorsement is implied. No original soundtrack is included.
Code is MIT; media and models retain their terms. No submission has been sent.
