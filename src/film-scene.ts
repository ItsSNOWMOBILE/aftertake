import { z } from 'zod';
import {
  curveMatchesEasing,
  curveMismatch,
  motionAt,
  motionCurveSchema,
  motionEasings,
  motionTrackSchema,
} from './film-motion';

const childSchema = z
  .object({ kind: z.enum(['graphic', 'title']), id: z.string().uuid() })
  .strict();
const depthKeySchema = z
  .object({
    at: z.number().min(0).max(1),
    yaw: z.number().min(-35).max(35),
    pitch: z.number().min(-35).max(35),
    // Positive Z approaches the camera; distances use the full canvas width.
    z: z.number().min(-0.2).max(0.2),
    easing: z.enum(motionEasings).optional(),
    bezier: motionCurveSchema.optional(),
  })
  .strict()
  .refine(curveMatchesEasing, curveMismatch);

export const filmMotionGroupSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    start: z.number().min(0).max(600),
    end: z.number().min(0).max(600),
    pivot: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
    children: z.array(childSchema).min(1).max(104),
    motion: motionTrackSchema.optional(),
    depth: z
      .object({
        perspective: z.number().min(1.5).max(6),
        keys: z
          .array(depthKeySchema)
          .min(2)
          .max(12)
          .refine(
            (keys) =>
              keys[0]?.at === 0 &&
              keys.at(-1)?.at === 1 &&
              keys.every((key, index) => !index || key.at > keys[index - 1].at),
            'Depth keys must cover 0 to 1 in strictly increasing order.',
          ),
      })
      .strict()
      .optional(),
    shutter: z
      .object({
        samples: z.union([z.literal(3), z.literal(5)]),
        exposure: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((group) => group.end >= group.start + 0.25, 'A group needs at least a quarter second.');

export const filmSceneSchema = z
  .object({
    groups: z.array(filmMotionGroupSchema).max(8),
    // Back to front, explicitly covering every group and every ungrouped layer.
    order: z
      .array(
        z
          .object({
            kind: z.enum(['graphic', 'title', 'group']),
            id: z.string().uuid(),
          })
          .strict(),
      )
      .max(112),
  })
  .strict();

export type FilmMotionScene = z.infer<typeof filmSceneSchema>;
export type FilmMotionGroup = z.infer<typeof filmMotionGroupSchema>;
export type SceneLayerRef = FilmMotionScene['order'][number];

/** Conservative clearance covers every eased pose between the authored keys. */
export function sceneProjectionClearance(group: FilmMotionGroup, width: number, height: number) {
  if (!group.depth) return 3 * width;
  const yaw = (Math.max(...group.depth.keys.map((key) => Math.abs(key.yaw))) * Math.PI) / 180;
  const pitch = (Math.max(...group.depth.keys.map((key) => Math.abs(key.pitch))) * Math.PI) / 180;
  const nearestZ = Math.max(...group.depth.keys.map((key) => key.z));
  return (
    group.depth.perspective * width -
    nearestZ * width -
    Math.max(group.pivot.x, 1 - group.pivot.x) * width * Math.sin(yaw) -
    Math.max(group.pivot.y, 1 - group.pivot.y) * height * Math.sin(pitch)
  );
}

type TimedLayer = { id: string; start: number; end: number };
/** Validate binding and painter order together, before allocating a group surface. */
export function sceneBindingErrors(
  scene: FilmMotionScene,
  graphics: TimedLayer[] = [],
  titles: TimedLayer[] = [],
): string[] {
  const errors: string[] = [];
  const layers = new Map<string, TimedLayer>();
  const ids = new Set<string>();
  for (const [kind, values] of [
    ['graphic', graphics],
    ['title', titles],
  ] as const) {
    for (const layer of values) {
      const key = `${kind}:${layer.id}`;
      if (ids.has(layer.id))
        errors.push('Every layer and group in a motion scene needs a unique ID.');
      ids.add(layer.id);
      if (layers.has(key)) errors.push(`Every ${kind} needs a unique ID in a motion scene.`);
      layers.set(key, layer);
    }
  }
  const children = new Set<string>();
  const roots = new Set(layers.keys());
  const groups = new Set<string>();
  for (const group of scene.groups) {
    if (ids.has(group.id))
      errors.push('Every layer and group in a motion scene needs a unique ID.');
    ids.add(group.id);
    if (groups.has(group.id)) errors.push('Every motion group needs a unique ID.');
    groups.add(group.id);
    roots.add(`group:${group.id}`);
    for (const child of group.children) {
      const key = `${child.kind}:${child.id}`;
      const layer = layers.get(key);
      if (!layer) errors.push(`“${group.name}” refers to a missing ${child.kind}.`);
      if (children.has(key)) errors.push('A layer can belong to only one group, once.');
      children.add(key);
      roots.delete(key);
      if (layer && (layer.start < group.start - 1e-7 || layer.end > group.end + 1e-7))
        errors.push(`“${group.name}” must cover each child’s complete timing interval.`);
    }
  }
  const seen = new Set<string>();
  for (const root of scene.order) {
    const key = `${root.kind}:${root.id}`;
    if (!roots.has(key)) errors.push('Root order contains a missing or grouped layer.');
    if (seen.has(key)) errors.push('Root order must list each layer exactly once.');
    seen.add(key);
  }
  if (seen.size !== roots.size || [...roots].some((key) => !seen.has(key)))
    errors.push('Root order must cover every group and every ungrouped layer.');
  return errors;
}

/** Continuous 24fps phase, used only by the opt-in scene compositor. */
export function sceneProgress(start: number, end: number, seconds: number) {
  const first = Math.ceil(start * 24 - 1e-7);
  const last = Math.ceil(end * 24 - 1e-7) - 1;
  return Math.max(0, Math.min(1, (seconds * 24 - first) / Math.max(1, last - first)));
}

export function sceneDepthAt(depth: FilmMotionGroup['depth'], progress: number) {
  if (!depth) return { yaw: 0, pitch: 0, z: 0 };
  // Reuse the established easing evaluator without introducing another curve convention.
  const track = {
    keys: depth.keys.map((key) => ({
      at: key.at,
      x: key.yaw / 35,
      y: key.pitch / 35,
      scale: 1,
      rotation: key.z,
      opacity: 1,
      easing: key.easing,
      bezier: key.bezier,
    })),
  };
  const value = motionAt(track, progress);
  return { yaw: value.x * 35, pitch: value.y * 35, z: value.rotation };
}

/** Row-major homography. Child surfaces are clipped to the canvas before projection. */
export function sceneGroupMatrix(
  group: FilmMotionGroup,
  width: number,
  height: number,
  seconds: number,
): number[] {
  const progress = sceneProgress(group.start, group.end, seconds);
  const pose = motionAt(group.motion, progress);
  const depth = sceneDepthAt(group.depth, progress);
  const yaw = (depth.yaw * Math.PI) / 180,
    pitch = (depth.pitch * Math.PI) / 180;
  const angle = (pose.rotation * Math.PI) / 180;
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const sx = pose.scale * pose.scaleX,
    syScale = pose.scale * pose.scaleY;
  const px = group.pivot.x * width,
    py = group.pivot.y * height;
  const d = (group.depth?.perspective ?? 3) * width;
  const den = [sy, -cy * sp, d - depth.z * width - sy * px + cy * sp * py];
  const ux = sx * c * cy,
    uy = sx * c * sy * sp - syScale * s * cp;
  const vx = sx * s * cy,
    vy = sx * s * sy * sp + syScale * c * cp;
  const ox = px + pose.x * width,
    oy = py + pose.y * height;
  const h = [
    ox * den[0] + d * ux,
    ox * den[1] + d * uy,
    ox * den[2] - d * (ux * px + uy * py),
    oy * den[0] + d * vx,
    oy * den[1] + d * vy,
    oy * den[2] - d * (vx * px + vy * py),
    ...den,
  ];
  return h.map((value) => value / den[2]);
}

/** Centered midpoint samples over at most one frame, clamped at the group endpoints. */
export function sceneSampleTimes(group: FilmMotionGroup, seconds: number): number[] {
  const first = Math.ceil(group.start * 24 - 1e-7),
    last = Math.ceil(group.end * 24 - 1e-7) - 1;
  const count = group.shutter?.exposure ? group.shutter.samples : 1;
  return Array.from(
    { length: count },
    (_, index) =>
      Math.max(
        first,
        Math.min(
          last,
          seconds * 24 + ((index + 0.5) / count - 0.5) * (group.shutter?.exposure ?? 0),
        ),
      ) / 24,
  );
}
