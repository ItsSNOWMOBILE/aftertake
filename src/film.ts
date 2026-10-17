import { z } from 'zod';
import type { Recipe } from './domain';

export const filmShotSchema = z.object({ renderId: z.string().uuid(), start: z.number().min(0).max(12), end: z.number().positive().max(12) })
  .refine(shot => shot.end - shot.start >= .25, 'Each shot needs at least a quarter second.');
export const filmDraftSchema = z.object({
  name: z.string().trim().min(1).max(100), aspect: z.enum(['landscape', 'portrait', 'square']),
  shots: z.array(filmShotSchema).max(8),
});
export const filmRequestSchema = filmDraftSchema.refine(film => film.shots.length > 0, 'Add a finished take to your film.');
export const filmManifestSchema = z.object({ format: z.literal('aftertake-film/1'), name: filmDraftSchema.shape.name,
  aspect: filmDraftSchema.shape.aspect, shots: z.array(filmShotSchema.safeExtend({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(8) });
export type FilmDraft = z.infer<typeof filmDraftSchema>;
export type Film = {
  id: string; name: string; state: 'assembling' | 'ready' | 'failed'; createdAt: string;
  aspect: FilmDraft['aspect']; duration: number; error?: string; output?: string;
  shots: (FilmDraft['shots'][number] & { title: string; sha256: string; recipe: Recipe; workflow?: Record<string, unknown> })[];
};
export const filmGeometry = { landscape: [1280, 720], portrait: [720, 1280], square: [720, 720] } as const;
