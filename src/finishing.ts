import { z } from 'zod';
import { clipSchema, type Clip } from './domain.js';

/** These operations run in this order on upright RGB frames, without generation. */
export const finishingPipeline = [
  'linear-light exposure and white balance',
  'contrast and saturation',
  'film look',
  'sharpen',
  'vignette',
  'seeded grain',
] as const;

export const finishingPresets = [
  { id: 'clean', name: 'Clean', description: 'Keep the original color.' },
  { id: 'warm-film', name: 'Warm film', description: 'Warm highlights and gently lifted shadows.' },
  { id: 'cool-film', name: 'Cool film', description: 'Cool shadows and restrained saturation.' },
  { id: 'noir', name: 'Noir', description: 'Monochrome with stronger contrast.' },
  { id: 'vintage', name: 'Vintage', description: 'Faded blacks and warm, muted color.' },
] as const;

const signed = z.number().min(-1).max(1);
const amount = z.number().min(0).max(1);
export const finishingSettingsSchema = z
  .object({
    exposureEV: z.number().min(-3).max(3),
    contrast: signed,
    saturation: signed,
    temperature: signed,
    tint: signed,
    sharpen: amount,
    vignette: amount,
    grain: amount,
    preset: z.enum(['clean', 'warm-film', 'cool-film', 'noir', 'vintage']),
    lookStrength: amount,
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
  })
  .strict();

export type FinishingSettings = z.infer<typeof finishingSettingsSchema>;
export const defaultFinishingSettings: FinishingSettings = {
  exposureEV: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  preset: 'clean',
  lookStrength: 0,
  seed: 42,
};

export function finishingIsIdentity(settings: FinishingSettings) {
  return (
    settings.exposureEV === 0 &&
    settings.contrast === 0 &&
    settings.saturation === 0 &&
    settings.temperature === 0 &&
    settings.tint === 0 &&
    settings.sharpen === 0 &&
    settings.vignette === 0 &&
    settings.grain === 0 &&
    (settings.preset === 'clean' || settings.lookStrength === 0)
  );
}

export const finishingRequestSchema = z
  .object({
    format: z.literal('aftertake-finishing/1'),
    name: z.string().trim().min(1).max(100),
    clip: clipSchema,
    settings: finishingSettingsSchema,
  })
  .strict();
export type FinishingRequest = z.infer<typeof finishingRequestSchema>;

export const finishingClockSchema = z
  .object({
    frames: z.number().int().positive().max(72000),
    timeBase: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/),
    timestampsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    duration: z.number().positive().max(600),
  })
  .strict();
export type FinishingClock = z.infer<typeof finishingClockSchema>;

export const finishingRecipeSchema = z
  .object({
    format: z.literal('aftertake-finishing-recipe/1'),
    processor: z.literal('aftertake-cpu-finishing/1'),
    request: finishingRequestSchema,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    clock: finishingClockSchema.optional(),
  })
  .strict()
  .refine((recipe) => recipe.sourceSha256 === recipe.request.clip.sha256, {
    message: 'The recipe source hash must match its original clip.',
    path: ['sourceSha256'],
  });
export type FinishingRecipe = z.infer<typeof finishingRecipeSchema>;
export type FinishingJob = {
  id: string;
  request: FinishingRequest;
  sourceSha256: string;
  state: 'queued' | 'running' | 'canceling' | 'succeeded' | 'failed' | 'canceled' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  requestKey?: string;
  requestDigest?: string;
  clip?: Clip;
  outputSha256?: string;
  clock?: FinishingClock;
  identity?: boolean;
  error?: string;
};
export function finishingBusy(job: FinishingJob) {
  return job.state === 'queued' || job.state === 'running' || job.state === 'canceling';
}
