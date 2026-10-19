import { z } from 'zod';

export const cameraEasings = ['linear', 'ease-in-out', 'ease-out', 'hold'] as const;

export const cameraKeyframeSchema = z.object({
  at: z.number().min(0).max(1),
  zoom: z.number().min(1).max(3),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  // Easing belongs to the destination, describing the move arriving here.
  easing: z.enum(cameraEasings).optional(),
});

export const filmFramingSchema = z.object({
  zoom: z.number().min(1).max(3),
  endZoom: z.number().min(1).max(3),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  keyframes: z
    .array(cameraKeyframeSchema)
    .min(2)
    .max(8)
    .refine(
      (keys) =>
        keys[0]?.at === 0 &&
        keys.at(-1)?.at === 1 &&
        keys.every((key, index) => index === 0 || key.at > keys[index - 1].at),
      'Camera keyframes must cover the cut from 0 to 1 in strictly increasing order.',
    )
    .optional(),
});

export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;
export type FilmFraming = z.infer<typeof filmFramingSchema>;
export type CameraPose = Pick<CameraKeyframe, 'zoom' | 'x' | 'y'>;

function eased(progress: number, easing: CameraKeyframe['easing']): number {
  switch (easing) {
    case 'linear':
      return progress;
    case 'ease-out':
      return 1 - (1 - progress) ** 3;
    case 'hold':
      return progress < 1 ? 0 : 1;
    default:
      return progress * progress * (3 - 2 * progress);
  }
}

/** Evaluate the same normalized, first-to-last-frame camera clock used by native exports. */
export function cameraAt(framing: FilmFraming, progress: number): CameraPose {
  const time = Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress));
  const keys = framing.keyframes;
  if (!keys) {
    return {
      zoom: framing.zoom + (framing.endZoom - framing.zoom) * time,
      x: framing.x,
      y: framing.y,
    };
  }
  if (time <= 0) return { zoom: keys[0].zoom, x: keys[0].x, y: keys[0].y };
  const rightIndex = keys.findIndex((key) => key.at >= time);
  const right = keys[rightIndex < 0 ? keys.length - 1 : rightIndex];
  const left = keys[Math.max(0, rightIndex - 1)];
  if (time >= 1) return { zoom: right.zoom, x: right.x, y: right.y };
  const amount = eased((time - left.at) / (right.at - left.at), right.easing);
  return {
    zoom: left.zoom + (right.zoom - left.zoom) * amount,
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
  };
}
