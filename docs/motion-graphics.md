# Motion graphics in Film

Build title sequences, moving panels, logo reveals and outlined frames from
editable layers. Motion graphics use the native CPU Film renderer. Install it
with `python scripts/setup-film.py`; editing and exporting existing media needs
no diffusion model or CUDA GPU. The recorded browser editor does not export films.

## Make a moving layer

1. Open **Film**, import your footage and arrange its In/Out ranges. Choose the
   aspect ratio and **Export size**.
2. Open **Graphics & motion**. Add a **Rectangle**, **Ellipse**, **Reveal panel**,
   **Outline frame**, or choose an **Imported still** and select **Add image**.
3. Set the layer's timing, center, dimensions, opacity, fill and stroke. Reorder
   layers to change their depth. Graphics draw above footage and below titles;
   later graphics draw over earlier ones.
4. Open **Transform & motion** and choose a starting point. Adjust its keys or
   select **New custom track**. Use a key's **Preview** button to seek to that pose.
5. Play and scrub the draft, then select **Export film**. Review the exported MP4
   and download its editable project alongside the original media.

Titles have the same **Transform & motion** controls. Their existing word build,
typewriter, wipe, impact and speech-following animation remains separate. The
transform moves the rendered title around the full canvas center, so scaling a
top or bottom title also changes its position relative to that center.

**Edit motion JSON** accepts the graphics array with schema validation. Import
matching stills first. Applying invalid JSON preserves the current layers.

## Punch typography

Titles have five additional entrances for fast promos and launch films. Each
uses the title's **Entrance seconds** and fades out over its last quarter second.

| Motion | Movement |
| --- | --- |
| Slam | Drops from 2.6× scale into place, then a short damped shake |
| Word pop | Words scale up in turn with a slight overshoot |
| Line reveal | Words rise into place from behind their own line |
| Glitch | Red/cyan separation, jitter and sliced bands settle to a clean title |
| Scramble | Characters appear as random glyphs, then settle left to right |

**Font** replaces the style's family with **Display** (Archivo Black),
**Condensed** (Anton) or **Mono** (JetBrains Mono); display and condensed have a
single weight. **Box** draws a **Stamp** outline, a solid **Highlight** with dark
text, or an **Underline** bar in the title color. **Tilt** rotates the finished
title by −20° to 20° around its own center. Combine Slam, Display, Stamp and a
small tilt for a rubber-stamp callout.

Glitch and scramble use deterministic per-frame noise, so the browser preview and
export choose the same glyphs and offsets. The preview approximates the glitch with
colored text shadows; sliced bands appear in the exported MP4.

## Shot transitions

Choose a shot's **Transition** to style the overlap with the previous shot. Its
length is the shot's **Dissolve in** seconds; choosing a transition on a hard cut
fills in a suggested length.

| Transition | Behavior |
| --- | --- |
| Dissolve | Crossfade (the default) |
| Whip pan | Both pictures travel left with a horizontal motion smear |
| Zoom punch | The outgoing picture accelerates into a zoom; the incoming one lands from it |
| Flash | A white flash hides the cut at its midpoint |
| Glitch cut | RGB separation and displaced bands around the switch |
| Push up | The incoming picture pushes the outgoing one upward |
| Wipe | A hard edge with a thin light bar sweeps left to right, revealing the incoming picture; good for before and after |

Audio still crossfades over the same overlap. The preview poses each picture with
the export's curves; the export adds the smear, zoom blur, glitch bands and the
wipe's light bar.
Projects using punch typography or a styled transition save as
**`aftertake-film/5`**; older formats reject them rather than dropping them.

## Cut to the beat

Import a music track, add it under audio, then choose **Cut every** (beat, two
beats, four beats or downbeat) and **Snap cuts to beats**. Aftertake estimates the
track's tempo and beats locally, then changes only shot **Out** points so each cut
lands on the nearest reachable beat. For a styled transition, the midpoint of its
overlap (where flash, glitch and zoom switch pictures) is placed on the beat. A cut
stays where it is when its shot lacks the footage to reach a beat, and the status
line lists it. Move the audio clip first; snapping follows its placement and trim.

Analysis uses spectral-flux onsets, an autocorrelation tempo estimate and a
dynamic-programming beat tracker on the CPU (`scripts/detect-beats.py`). Results
are cached by the audio's content hash. Beat times are quantized to about 23 ms and
the downbeat is a likely bar phase, not a verified one; review the cut by ear.
Agents use `aftertake_detect_beats` and set shot Out points in the saved project.

## Presets and keyframes

| Starting point | Movement |
| --- | --- |
| Still | Removes the optional transform track |
| Slide left / Slide right | Enters from one side and leaves toward the other |
| Rise into place | Enters from below and leaves upward |
| Pop into place | Scales in, briefly overshoots and settles |
| Slow drift | Adds a small translation and scale change |
| Sweep across the canvas | Moves a panel in, holds it and moves it out |

Presets are editable tracks. Each track contains 2–12 ordered keys. The first
stays at 0% and the last at 100%; add intermediate keys to shape the movement.
Time is relative to the layer's first and last displayed frames on the absolute
24 fps film clock. A cut or dissolve does not restart the layer's motion.

Layer centers and dimensions use canvas percentages. Center 50%, 50% is the
middle. Motion offsets are additional canvas percentages: X offset 100% moves
one complete canvas width. Rotation is clockwise and interpolates the authored
signed values. Horizontal and vertical scale multiply the overall scale.

Each destination key selects the easing for the segment arriving at it:

| Easing | Behavior |
| --- | --- |
| Constant speed | Linear interpolation; also the default |
| Soft start, fast finish | Cubic ease-in |
| Fast start, soft stop | Cubic ease-out |
| Smooth start & stop | Smoothstep ease-in-out |
| Hold, then jump | Keeps the preceding pose until this key |
| Custom curve · cubic Bézier | Your own timing curve for this segment |

### Custom curves

Choose **Custom curve · cubic Bézier** to shape one segment. The key card shows
the curve: across is time between the two keys, up is progress toward this key,
and the dots mark equal time steps, so wider gaps move faster. Drag either
handle, type **x1**, **y1**, **x2** and **y2**, or pick a starting point:

| Curve preset | Values | Feel |
| --- | --- | --- |
| Standard | 0.25, 0.1, 0.25, 1 | Soft start, settled stop |
| Sine | 0.37, 0, 0.63, 1 | Gentle in and out |
| Quint | 0.83, 0, 0.17, 1 | Dramatic in and out |
| Snap | 0.16, 1, 0.3, 1 | Fast arrival, long settle |
| Wind-up | 0.7, 0, 0.84, 0 | Slow start, fast exit |
| Speed ramp | 0.1, 0.6, 0.9, 0.4 | Fast, hang in the middle, fast |

Switching a key from a named easing starts from that easing's exact curve, so
its motion does not jump; Hold starts from Standard. The values use CSS
`cubic-bezier(x1, y1, x2, y2)` order and are stored on the destination key:

```json
{ "at": 1, "x": 0.2, "y": 0, "scale": 1, "rotation": 0, "opacity": 1,
  "easing": "custom", "bezier": { "x1": 0.16, "y1": 1, "x2": 0.3, "y2": 1 } }
```

All four values stay between 0 and 1. Time handles inside that range keep the
curve moving forward, so each frame time has exactly one position on it.
Progress handles inside that range keep every eased pose between its two keys,
so opacity, scale and group depth limits still hold. For an overshoot or
anticipation, add a keyframe beyond the resting pose, as **Pop into place**
does. A `bezier` without `easing: "custom"`, or the reverse, is rejected.

The browser preview and the native renderer solve the same curve with the same
fixed 52-step bisection and arithmetic, so a frame's position is the same
number in both. The first and last displayed frames still land exactly on their
keys. Custom curves work for graphics, titles, group transforms and group depth
keys; camera keyframes keep their own easing list.

Fill opacity affects the shape interior or image pixels. Stroke remains
independent; layer opacity and motion opacity affect both. A zero-opacity fill
with a visible stroke makes an outline. Stroke width uses pixels on a 1280-wide
canvas and scales with export size and the layer transform.

## Images and export sizes

Import PNG, JPEG or WebP through Film media. PNG and WebP transparency is retained;
EXIF orientation is applied before fitting. **Contain** keeps the complete image
inside its box; **Cover** fills the box and crops its edges. Rounded corners clip
the image. Graphics preserve the original source hash rather than embedding
image files in project JSON.

| Export size | Landscape | Portrait | Square |
| --- | --- | --- | --- |
| 720p | 1280 × 720 | 720 × 1280 | 720 × 720 |
| 1080p | 1920 × 1080 | 1080 × 1920 | 1080 × 1080 |
| 2160p | 3840 × 2160 | 2160 × 3840 | 2160 × 2160 |

Export size changes the composition canvas and rasterized typography/graphics.
It resizes existing footage to that canvas; it does not regenerate footage or run
a detail-recovering AI upscaler. Higher sizes increase CPU work and temporary
storage. Review the actual export for source softness and edge quality.

## Portable projects and agents

Projects containing graphic layers, title transform tracks or an explicit export
size use **`aftertake-film/3`**. Older project format labels reject those settings.
Custom curves need no new label; an older Aftertake build rejects a custom key
instead of flattening it to another easing.
Keep the JSON and exact companion media together; import the media before using
**Import film project** on another device. Restore verifies hashes and rebinds
workspace asset IDs while retaining the edit.

Agents use the same project schema through `aftertake_save_film_edit`, then
`aftertake_export_plan`, `aftertake_plan_status` and `aftertake_review_film`.
Saving an edit checks sources and timing without rendering. Review the completed
video and decoded frames before treating a plan as finished. See the
[MCP guide](mcp.md) for connection and recovery behavior.

## Native limits

Film projects support up to 24 graphics, 80 titles and 12 keys per motion track.
Layers last at least a quarter second and must fit within the film's ten-minute
limit. Transform values are finite and bounded: overall and per-axis scale each
range from 0.02 to 4, rotation from −360° to 360°, and motion offsets from −200%
to 200% of the canvas.

The native renderer bounds each working graphic and transformed frame to the
output canvas, at most 3840 pixels per side and 8,294,400 total pixels. Film image
imports accept up to 100 MiB and 8,294,400 pixels. The standalone graphic decoder
also enforces a 100 MiB file limit, a 16,777,216-pixel image ceiling and Pillow's
decompression checks. Image content hashes are verified again when loaded.

These controls provide editable 2D composition and animation. They do not claim
After Effects project compatibility or its complete effects, expression, 3D and
compositing feature set.
