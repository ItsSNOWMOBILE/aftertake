import { z } from 'zod';
import type { Clip } from './domain';
import { cinemaPrompt, cinemaSchema, defaultCinema } from './cinema';

export const videoRequestSchema = z.object({
  format: z.literal('aftertake-text-video/1'),
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(5).max(3000),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 32 - 1),
  aspect: z.enum(['landscape', 'portrait', 'square']),
  quality: z.enum(['draft', 'final']),
  seconds: z.number().int().min(2).max(5),
  sound: z.boolean(),
  cinema: cinemaSchema
    .refine((value) => value.guidance !== 'tracks', 'Text-to-video uses prompt camera direction.')
    .optional(),
});
export type VideoRequest = z.infer<typeof videoRequestSchema>;
export type VideoGeneration = {
  id: string;
  request: VideoRequest;
  state: string;
  progress: number | null;
  requestKey?: string;
  requestDigest?: string;
  createdAt: string;
  updatedAt: string;
  jobId?: string;
  stage?: string;
  error?: string;
  workflow: Record<string, any>;
  clip?: Clip;
};
export const videoTerminal = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
  'output_error',
]);
export const videoBusy = (video: VideoGeneration) => !videoTerminal.has(video.state);
export function videoDimensions(request: Pick<VideoRequest, 'aspect' | 'quality' | 'seconds'>) {
  const [width, height] = (
    {
      draft: { landscape: [512, 288], portrait: [288, 512], square: [512, 512] },
      final: { landscape: [1024, 576], portrait: [576, 1024], square: [768, 768] },
    } as const
  )[request.quality][request.aspect];
  const fps = 24,
    frames = request.seconds * fps + 1;
  return { width, height, frames, fps, duration: frames / fps };
}
export function videoPrompt(request: VideoRequest) {
  return cinemaPrompt(
    request.prompt,
    request.cinema || { ...defaultCinema, movement: 'locked' },
    false,
  );
}
