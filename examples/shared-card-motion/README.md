# One card, one object

https://github.com/user-attachments/assets/c3aadc65-9cd7-43cd-813d-77fff4609a0f

A six-second native motion study: an image, card and caption share a pivot,
tilt briefly, then travel together through a ten-frame handoff. The reference
card settles into a sharp hold. This isolates motion quality; it is not the full
product demo and contains no narration or music.

The portable project was resolved and exported again through the studio's Film
API. Both MP4s have the same SHA-256, all 144 decoded RGB frames, frame timestamps
and decoded audio samples. [Replay verification →](replay-proof.json)

## Reopen in Aftertake

1. Install the Film runtime with `python scripts/setup-film.py` and start the studio.
2. Import the three companion files listed in [media-manifest.json](media-manifest.json)
   into Film media. Their original bytes are already in this repository.
3. Import [project.json](project.json) with **Import film project**. Aftertake
   verifies the hashes and rebinds local asset IDs.
4. Open **Shared groups & depth**. Edit the group, child layers, pivot, depth
   keys, order or shutter setting, then export.

The project uses `aftertake-film/4`, 1920 × 1080, 144 frames at 24 fps. Both groups
use five shutter samples over 0.12 of one frame. Browser preview shows the central
pose; temporal shutter blur appears in the exported MP4. No GPU, model download
or generation service is needed to replay this study.

Source still: *Tears of Steel*, Blender Foundation / Mango Open Movie Project,
[CC BY 3.0](https://mango.blender.org/about/). Fictional character reference:
the public Z-Image image already included in
[the H3 example](../character-h3/README.md). The reference is not a new character
replacement result. Background and motion design are authored for this study.

[Motion scene controls and format →](../../docs/motion-scenes.md)
