import { z } from 'zod';

export const motionEasings = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] as const;

export const motionKeyframeSchema = z
  .object({
    at: z.number().min(0).max(1),
    // Offsets use the full output canvas, independently of an element's dimensions.
    x: z.number().min(-2).max(2),
    y: z.number().min(-2).max(2),
    scale: z.number().min(0.02).max(4),
    scaleX: z.number().min(0.02).max(4).optional(),
    scaleY: z.number().min(0.02).max(4).optional(),
    rotation: z.number().min(-360).max(360),
    opacity: z.number().min(0).max(1),
    // Describes the segment arriving at this key. Missing easing means linear.
    easing: z.enum(motionEasings).optional(),
  })
  .strict();

export const motionTrackSchema = z
  .object({
    keys: z
      .array(motionKeyframeSchema)
      .min(2)
      .max(12)
      .refine(
        (keys) =>
          keys[0]?.at === 0 &&
          keys.at(-1)?.at === 1 &&
          keys.every((key, index) => index === 0 || key.at > keys[index - 1].at),
        'Motion keys must cover the element from 0 to 1 in strictly increasing order.',
      ),
  })
  .strict();

export type MotionKeyframe = z.infer<typeof motionKeyframeSchema>;
export type MotionTrack = z.infer<typeof motionTrackSchema>;
export type MotionPose = Pick<MotionKeyframe, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'> & {
  scaleX: number;
  scaleY: number;
};

const identity = (): MotionPose => ({
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
});
const pose = (key: MotionKeyframe): MotionPose => ({
  x: key.x,
  y: key.y,
  scale: key.scale,
  scaleX: key.scaleX ?? 1,
  scaleY: key.scaleY ?? 1,
  rotation: key.rotation,
  opacity: key.opacity,
});

function eased(progress: number, easing: MotionKeyframe['easing']): number {
  switch (easing) {
    case 'ease-in':
      return progress ** 3;
    case 'ease-out':
      return 1 - (1 - progress) ** 3;
    case 'ease-in-out':
      return progress * progress * (3 - 2 * progress);
    case 'hold':
      return progress < 1 ? 0 : 1;
    default:
      return progress;
  }
}

/** The normalized pose shared by the preview and native motion renderer. */
export function motionAt(track: MotionTrack | undefined, progress: number): MotionPose {
  if (!track) return identity();
  const time = Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress));
  if (time <= 0) return pose(track.keys[0]);
  if (time >= 1) return pose(track.keys.at(-1)!);
  const rightIndex = track.keys.findIndex((key) => key.at >= time);
  const right = track.keys[rightIndex];
  const left = track.keys[rightIndex - 1];
  const amount = eased((time - left.at) / (right.at - left.at), right.easing);
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    scale: left.scale + (right.scale - left.scale) * amount,
    scaleX: (left.scaleX ?? 1) + ((right.scaleX ?? 1) - (left.scaleX ?? 1)) * amount,
    scaleY: (left.scaleY ?? 1) + ((right.scaleY ?? 1) - (left.scaleY ?? 1)) * amount,
    // Preserve the authored signed rotation; do not replace it with a shortest-path turn.
    rotation: left.rotation + (right.rotation - left.rotation) * amount,
    opacity: left.opacity + (right.opacity - left.opacity) * amount,
  };
}

/** Endpoint poses land on the first and last visible 24 fps frames, not the exclusive end. */
export function motionProgress(start: number, end: number, time: number): number {
  const first = Math.ceil(start * 24 - 1e-7);
  const last = Math.ceil(end * 24 - 1e-7);
  const frame = Number.isNaN(time) ? first : Math.floor(time * 24 + 1e-7);
  const visibleFrame = Math.max(first, Math.min(last - 1, frame));
  return (visibleFrame - first) / Math.max(1, last - first - 1);
}

const hexColor = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const filmGraphicSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['rect', 'ellipse', 'image']),
    start: z.number().min(0).max(600),
    end: z.number().min(0).max(600),
    // Base center and dimensions are fractions of the output canvas.
    x: z.number().min(-2).max(3),
    y: z.number().min(-2).max(3),
    width: z.number().min(0.005).max(3),
    height: z.number().min(0.005).max(3),
    color: hexColor,
    opacity: z.number().min(0).max(1),
    // Separate fill alpha permits an outlined card or reticle with a transparent center.
    fillOpacity: z.number().min(0).max(1).optional(),
    // Corner radius is a fraction of the shorter side, before the motion transform.
    radius: z.number().min(0).max(0.5).optional(),
    strokeColor: hexColor.optional(),
    // Pixels on a 1280-wide canvas; scale by output width / 1280 when rendering.
    strokeWidth: z.number().min(0).max(32).optional(),
    fit: z.enum(['contain', 'cover']).optional(),
    assetId: z.string().uuid().optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    motion: motionTrackSchema.optional(),
  })
  .strict()
  .refine(
    (graphic) => graphic.end >= graphic.start + 0.25,
    'A graphic needs at least a quarter second.',
  )
  .superRefine((graphic, context) => {
    if (graphic.kind === 'image' && !graphic.assetId) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'An image graphic requires an imported image asset.',
      });
    }
    if (
      graphic.kind !== 'image' &&
      (Object.hasOwn(graphic, 'assetId') || Object.hasOwn(graphic, 'sha256'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Shape graphics cannot refer to an image asset or its hash.',
      });
    }
  });

export type FilmGraphic = z.infer<typeof filmGraphicSchema>;

export const motionPresets = [
  'none',
  'slide-left',
  'slide-right',
  'slide-up',
  'pop',
  'drift',
  'panel-sweep',
] as const;
export type MotionPresetName = (typeof motionPresets)[number];

function key(
  at: number,
  values: Partial<MotionPose> = {},
  easing: MotionKeyframe['easing'] = 'linear',
): MotionKeyframe {
  return { at, ...identity(), ...values, easing };
}

const presetTracks: Record<Exclude<MotionPresetName, 'none'>, MotionTrack> = {
  'slide-left': {
    keys: [
      key(0, { x: 0.16, opacity: 0 }),
      key(0.18, {}, 'ease-out'),
      key(0.82),
      key(1, { x: -0.08, opacity: 0 }, 'ease-in'),
    ],
  },
  'slide-right': {
    keys: [
      key(0, { x: -0.16, opacity: 0 }),
      key(0.18, {}, 'ease-out'),
      key(0.82),
      key(1, { x: 0.08, opacity: 0 }, 'ease-in'),
    ],
  },
  'slide-up': {
    keys: [
      key(0, { y: 0.12, opacity: 0 }),
      key(0.18, {}, 'ease-out'),
      key(0.82),
      key(1, { y: -0.08, opacity: 0 }, 'ease-in'),
    ],
  },
  pop: {
    keys: [
      key(0, { scale: 0.72, opacity: 0 }),
      key(0.18, { scale: 1.08 }, 'ease-out'),
      key(0.32, {}, 'ease-in-out'),
      key(0.84),
      key(1, { scale: 0.92, opacity: 0 }, 'ease-in'),
    ],
  },
  drift: {
    keys: [key(0, { x: -0.025, y: 0.02 }), key(1, { x: 0.025, y: -0.015, scale: 1.04 })],
  },
  'panel-sweep': {
    keys: [
      key(0, { x: -1.2 }),
      key(0.22, {}, 'ease-out'),
      key(0.78, {}, 'hold'),
      key(1, { x: 1.2 }, 'ease-in'),
    ],
  },
};

/** Presets are editable tracks. None removes the optional track and preserves legacy rendering. */
export function motionPreset(name: MotionPresetName): MotionTrack | undefined {
  if (name === 'none') return undefined;
  const track = presetTracks[name];
  if (!track) throw new RangeError('Choose a supported motion preset.');
  return structuredClone(track);
}
