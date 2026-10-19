# Optical finishing

Open **Color & finish**, choose a source, and review an actual processed frame
before saving the complete take. Optical recipes change only their six optical
controls; they keep the existing color grade, grain seed and source. Choosing a
recipe starts no preview or export.

| Recipe | Result |
| --- | --- |
| Soft highlight glow | A soft, neutral bloom around bright highlights |
| Warm highlight halo | A restrained red-orange halo outside bright edges |
| Subtle prism | Small red/blue channel separation for a stylized optical edge |
| Off | Disables all three optical effects |

These are deterministic pixel operations, with no models or paid API calls.
Halation approximates a warm photographic halo; it is not a film-stock
simulation. Chromatic displacement is an intentional color effect, not an
automatic fix for a composite seam, soft face or identity error.

## Controls and portable recipes

`aftertake-finishing/1` and `aftertake-finishing-recipe/1` retain these settings:

| Field | Range | Default |
| --- | --- | --- |
| `glowStrength` | 0–1 | 0 |
| `glowRadius` | 0–32 pixels | 8 |
| `halationStrength` | 0–1 | 0 |
| `halationRadius` | 0–32 pixels | 6 |
| `chromaticStrength` | 0–1 | 0 |
| `chromaticOffset` | 0–8 pixels | 1.5 |

Radii and displacement use pixels of the output canvas. Missing optical fields
in older recipes take these defaults. Zero strengths bypass the optical stages
completely, preserving the previous processor's pixels. When every adjustment
is disabled, final export still copies the original file byte-for-byte.

The shared processing order is exposure/white balance, contrast/saturation,
color look, highlight glow/halation, RGB displacement, sharpening, vignette,
then seeded grain. Glow and halation select high-luminance pixels and spread
their light in linear RGB. Blur pads with replicated edge pixels, and channel
displacement clamps at the frame edge; neither operation wraps the opposite
side into the image.

**Preview frame** returns a PNG from this same pixel processor. Final video
encoding preserves the source's rational timestamps, canvas and duration, and
retains original sound once as AAC. It does not synthesize new frames or audio.
The existing 4K pixel, ten-minute, 120 fps limits continue to apply. Review
highlights and high-contrast edges at the target resolution before exporting.
