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
selective HSL, master then RGB curves, color look, highlight glow/halation,
RGB displacement, sharpening, vignette, seeded grain, then the imported 3D LUT.
Glow and halation select high-luminance pixels and spread
their light in linear RGB. Blur pads with replicated edge pixels, and channel
displacement clamps at the frame edge; neither operation wraps the opposite
side into the image.

**Preview frame** returns a PNG from this same pixel processor. Final video
encoding preserves the source's rational timestamps, canvas and duration, and
retains original sound once as AAC. It does not synthesize new frames or audio.
The existing 4K pixel, ten-minute, 120 fps limits continue to apply. Review
highlights and high-contrast edges at the target resolution before exporting.

## Selective HSL

Choose red, orange, yellow, green, aqua, blue, purple or magenta. Each channel
has hue rotation (−30° to 30°), saturation (−1 to 1) and lightness (−1 to 1).
The eight hue centers blend smoothly around the color wheel; an orange
adjustment can leave a blue background unchanged. Low-chroma colors receive
less adjustment and exact neutral grays remain unchanged. The lightness
control uses HSL lightness, not measured scene luminance. Reset affects only
the selected channel; all 24 values default to zero.

The recipe field is `selectiveColor`, with one strict record per channel:
`{hueDegrees, saturation, lightness}`. Conversion follows the
[W3C display-sRGB/HSL definitions](https://www.w3.org/TR/css-color-4/#rgb-to-hsl).
This is a display-referred grade, without an HDR/log color-space conversion.

## Master and RGB curves

Choose the master, red, green or blue curve. Edit input/output points with the
numeric controls; **Add point** inserts an anchor in the largest input gap.
The graph previews the same monotone cubic shape. Master is evaluated before
the individual RGB curves. Each channel supports 2–16 points, normalized to 0–1,
with input endpoints 0/1, increasing inputs and nondecreasing outputs. Inputs
must be separated by at least 0.000001 to avoid ill-conditioned intervals.
Lift the first output to raise blacks or lower the final output to limit whites.
Reset one channel or all curves independently of other finishing settings.

Curves use the published shape-preserving
[PCHIP slope policy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html),
implemented independently without a SciPy dependency. The worker prepares
4096-entry float tables once per job; neutral curves bypass the stage exactly.
The portable `curves` object contains `master`, `red`, `green` and `blue` arrays
of `{x,y}` points. Decreasing, duplicate, nonfinite or excessive point sets are
rejected rather than silently repaired.

## Imported 3D LUTs

Confirm that a LUT expects **display-referred sRGB**, then import its original
`.cube` file. Log/ACES LUTs require a deliberate color-space conversion and
are outside this first version. Import selects the LUT at full strength but
starts no render. Review a processed frame and adjust its strength before
saving the take. **Remove LUT** clears it without changing other controls.

The parser accepts a quoted `TITLE`, one `LUT_3D_SIZE` from 2–64, optional
`DOMAIN_MIN/MAX` input bounds, and exactly N³ finite RGB triples. UTF-8/BOM,
blank lines and comments are supported. The 16 MiB cap, header/entry counts and
float bounds are checked before admission. One-dimensional/mixed LUTs,
unsupported directives, malformed data and nonfinite entries are rejected.

Sampling uses red-fastest ordering and trilinear interpolation. Following
[OpenColorIO's IridasCube input-domain semantics](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/fileformats/FileFormatIridasCube.cpp),
the domain maps **input coordinates**; it does not normalize the table's output
values. Finite negative/greater-than-one outputs stay in float until final
image quantization. The LUT runs last so existing finishing operations do not
silently clip those values first.

Recipes contain `lutStrength` and a `lut` descriptor with the original SHA-256,
title, edge size, input domain, `interpolation:"trilinear"` and
`colorSpace:"srgb"`. `sourceFiles` names the required `.cube` companion by its
hash. **Save recipe** plus **Save companion .cube** makes the grade portable.
Upload the companion in another workspace before applying an active imported
grade. Missing, changed or descriptor-mismatched assets fail explicitly; no
fallback look is substituted. At strength zero the asset need not be present.

The API uploads raw bytes to `POST /api/finishing/luts` with
`Content-Type:application/octet-stream` and `X-LUT-Color-Space:srgb`, returns
the portable descriptor, and serves exact companion bytes from
`GET /api/finishing/luts/:sha256`. Workers receive only server-resolved private
asset paths; client-supplied filesystem paths and URLs are not settings.

Older recipes default all selective adjustments to zero, curves to identity
and LUT strength to zero. Their prior pixels and the original-file identity
path are unchanged. Saved stable request keys migrate only after their original
raw content digest is verified, preserving replay without repeating an export.

## Hide details

Redactions hide parts of the frame before any other finishing step, on the
source pixels. Each is a box in normalized source coordinates with a style
(blur, pixelate or solid fill) and an optional time range. A request holds up
to 16.

Turn on **Hide every match** and the box becomes a sample instead. It is cut
from the frame at the time you drew it. On every frame in the box's time range,
each place the sample appears (normalized cross-correlation of at least 0.9,
adjustable from 0.5 to 1 in a recipe) is padded slightly and hidden. This suits
screen recordings, where text renders identically wherever it scrolls. It does
not track faces or objects that change shape; draw a timed box for those.

The finishing receipt records, for each redaction, how many frames had
something hidden and how many boxes were hidden in total. Agents use the same
`redactions` field through `aftertake_finish_media` and can check a frame with
`aftertake_preview_finish`. The competition film's proof recording uses it to
hide a username in the engine console (`examples/then-comes-the-aftertake/build/prepare.py`).
