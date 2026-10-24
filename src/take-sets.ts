import { z } from 'zod';
import { recipeSchema } from './domain';
import { imageRequestSchema } from './image-generation';
import { videoRequestSchema } from './video-generation';

/**
 * Takes: one request rendered 2–4 times with different seeds, one after another,
 * to compare side by side and keep one. Create image, Create video and Animate a
 * frame each start sets through their own routes.
 */
const count = z.number().int().min(2).max(4);
export const takeSetRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), count, request: imageRequestSchema }).strict(),
  z.object({ kind: z.literal('video'), count, request: videoRequestSchema }).strict(),
  z
    .object({
      kind: z.literal('frame'),
      count,
      request: recipeSchema.refine(
        (recipe) => recipe.pipeline === 'cinema',
        'Takes for a shot come from Animate a frame.',
      ),
    })
    .strict(),
]);
export type TakeSetRequest = z.infer<typeof takeSetRequestSchema>;
export type TakeSetKind = TakeSetRequest['kind'];

/** The route each kind of take is made through, and how its records are listed. */
export const takeSetRoutes: Record<TakeSetKind, string> = {
  image: '/api/images',
  video: '/api/videos',
  frame: '/api/renders',
};

/** The first take keeps the requested seed; each further take steps to a new one. */
export const takeSeeds = (seed: number, count: number) =>
  Array.from({ length: count }, (_, index) => (seed + index * 7919) % 2 ** 32);

export type TakeSet = {
  id: string;
  requestKey?: string;
  requestDigest?: string;
  kind: TakeSetKind;
  count: number;
  request: TakeSetRequest['request'];
  /** One entry per take, in the order they render. */
  takes: { seed: number; id?: string; state?: string; error?: string }[];
  /** The take the person kept; the others stay in the studio's history. */
  kept?: string;
  state: 'running' | 'ready' | 'failed' | 'canceled';
  stage: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
export const takeSetBusy = (set: Pick<TakeSet, 'state'>) => set.state === 'running';
