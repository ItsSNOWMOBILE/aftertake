# Motion scenes

A motion scene moves several Film graphics and titles as one composition. Keep
each child editable, animate it independently, then move the finished group around
an authored pivot. Optional perspective adds a shallow card-like tilt, and shutter
sampling softens fast movement in the CPU export. No generation model is involved.

## Author a group

The Film draft's optional `motionScene` contains `groups` and `order`. A group has
an ID, name, absolute film `start`/`end` seconds, a normalized canvas `pivot`, and
an ordered `children` list referencing existing graphics or titles by ID. It can
also contain the existing `motion` keyframe track, a `depth` track and `shutter`.

Children keep their absolute film timing. Their visible intervals must fit within
the parent interval; grouping does not shift or stretch them. Child transforms,
title animation and clipping are evaluated before the parent transform. A clipped
part of a child cannot be recovered by moving its parent. Parent motion uses the
group's first and last visible frames on Film's 24 fps clock.

Each layer belongs to at most one group. Groups cannot contain other groups.
Every group and every ungrouped layer appears exactly once in `order`. Grouped
children appear only inside their group. IDs must be unique, and references must
match both the layer ID and its `graphic` or `title` kind.

`order` is painter order: later entries draw above earlier ones. A group is one
entry, with its children drawn in their listed order. This allows a graphic to
appear above a title without changing either layer's source array. Without a
scene, Film retains its existing graphics-then-titles composition.

Group opacity applies after the children have been composited together. For
example, fading an overlapping logo and label to 50% fades the combined group;
it does not independently fade the children and change their overlap.

## Perspective and shutter

`depth.keys` contains ordered poses from `at: 0` to `at: 1`. Each pose has `yaw`
and `pitch` in degrees, `z` as a shallow depth offset, and optional destination
`easing` using the existing motion easing names, including `custom` with a
bounded `bezier` curve (see [custom curves](motion-graphics.md#custom-curves)).
Edit depth curves in **Advanced depth keys**. Yaw and pitch range from −35°
to 35°, `z` from −0.2 to 0.2, and `perspective` from 1.5 to 6. The pivot remains
the anchor for the group's tilt and motion.

This is a flat group projected in perspective. It does not create hidden sides,
extrude text or infer depth from footage. Depth does not reorder layers: painter
order still decides which group is in front.

Optional `shutter` uses `samples: 3` or `5` and `exposure` from 0 to 1. It samples
the group's motion around an output frame; higher exposure produces a longer
trail and more samples increase CPU work. Shutter is an export effect. Browser
preview shows the current pose without the temporally sampled blur, so inspect
the exported MP4 when judging edge softness or fast movement.

## Save and restore

Scenes use **`aftertake-film/4`** portable projects. Formats 1–3 continue to work
without `motionScene`; they reject a scene rather than silently dropping it.
Groups, references, order, depth, pivot and shutter travel with the project and
contribute to the export's identity. Reusing an export key after changing them
returns a conflict instead of returning a different edit under the old key.

Keep exact companion media with the JSON. Restoring a project verifies source
hashes and rebinds local asset IDs while preserving layer and group identities.
There are at most eight groups; existing graphic, title and motion-key limits
still apply. Invalid references, nesting, duplicate ownership, out-of-parent
children and groups extending past the film are rejected before export.
