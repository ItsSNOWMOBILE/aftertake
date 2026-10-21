import { z } from 'zod';
import { clipSchema, type Clip } from './domain.js';
import {
  selectiveColorSchema,
  defaultSelectiveColor,
  curvesSchema,
  defaultCurves,
  lutDescriptorSchema,
  gradingIsIdentity,
} from './grading.js';

/** These operations run in this order on upright RGB frames, without generation. */
export const finishingPipeline = [
  'redaction of hidden regions and matches',
  'linear-light exposure and white balance',
  'contrast and saturation',
  'selective HSL and master/RGB monotone curves',
  'film look',
  'highlight glow and warm halation',
  'edge-clamped RGB displacement',
  'sharpen',
  'vignette',
  'seeded grain',
  'display-sRGB 3D LUT',
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
export const defaultOpticalFinishing = {
  glowStrength: 0,
  glowRadius: 8,
  halationStrength: 0,
  halationRadius: 6,
  chromaticStrength: 0,
  chromaticOffset: 1.5,
};
export const opticalFinishingPresets = [
  { id: 'off', name: 'Off', settings: { ...defaultOpticalFinishing } },
  {
    id: 'soft-glow',
    name: 'Soft highlight glow',
    settings: { ...defaultOpticalFinishing, glowStrength: 0.3, glowRadius: 12 },
  },
  {
    id: 'warm-halation',
    name: 'Warm highlight halo',
    settings: { ...defaultOpticalFinishing, halationStrength: 0.4, halationRadius: 8 },
  },
  {
    id: 'prismatic',
    name: 'Subtle prism',
    settings: { ...defaultOpticalFinishing, chromaticStrength: 0.5, chromaticOffset: 1.5 },
  },
] as const;
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
    glowStrength: amount.default(defaultOpticalFinishing.glowStrength),
    glowRadius: z.number().min(0).max(32).default(defaultOpticalFinishing.glowRadius),
    halationStrength: amount.default(defaultOpticalFinishing.halationStrength),
    halationRadius: z.number().min(0).max(32).default(defaultOpticalFinishing.halationRadius),
    chromaticStrength: amount.default(defaultOpticalFinishing.chromaticStrength),
    chromaticOffset: z.number().min(0).max(8).default(defaultOpticalFinishing.chromaticOffset),
    selectiveColor: selectiveColorSchema.default(defaultSelectiveColor),
    curves: curvesSchema.default(defaultCurves),
    lut: lutDescriptorSchema.nullable().default(null),
    lutStrength: amount.default(0),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
  })
  .strict()
  .refine(
    (settings) => settings.lutStrength === 0 || settings.lut !== null,
    'Import a 3D LUT before increasing its strength.',
  );

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
  ...defaultOpticalFinishing,
  selectiveColor: defaultSelectiveColor,
  curves: defaultCurves,
  lut: null,
  lutStrength: 0,
};

export function applyOpticalFinishingPreset(settings: FinishingSettings, id: string) {
  const preset = opticalFinishingPresets.find((item) => item.id === id);
  if (!preset) throw new Error('Choose a supported optical finishing recipe.');
  return { ...settings, ...preset.settings };
}

export function matchingOpticalFinishingPreset(settings: FinishingSettings) {
  return (
    opticalFinishingPresets.find((preset) =>
      (Object.keys(defaultOpticalFinishing) as (keyof typeof defaultOpticalFinishing)[]).every(
        (key) => settings[key] === preset.settings[key],
      ),
    )?.id || 'custom'
  );
}
export function finishingSourceFiles(settings: FinishingSettings) {
  return settings.lut
    ? [
        {
          role: 'lut' as const,
          sha256: settings.lut.sha256,
          filename: `${settings.lut.sha256}.cube`,
        },
      ]
    : [];
}

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
    (settings.glowStrength ?? 0) === 0 &&
    (settings.halationStrength ?? 0) === 0 &&
    (settings.chromaticStrength ?? 0) === 0 &&
    gradingIsIdentity(settings) &&
    (settings.preset === 'clean' || settings.lookStrength === 0)
  );
}

export const redactionStyles = [
  { id: 'blur', name: 'Blur' },
  { id: 'pixelate', name: 'Pixelate' },
  { id: 'solid', name: 'Solid fill' },
] as const;
/**
 * A box to hide, in normalized source coordinates. With `match`, the box marks a
 * sample at time `at` instead, and every place those pixels appear in a frame
 * between `start` and `end` is hidden (for names or keys in screen recordings).
 * Redaction runs on the source pixels, before every finishing operation.
 */
export const redactionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    start: z.number().min(0).max(600).default(0),
    end: z.number().positive().max(600).nullable().default(null),
    style: z.enum(['blur', 'pixelate', 'solid']).default('blur'),
    match: z
      .object({
        at: z.number().min(0).max(600),
        threshold: z.number().min(0.5).max(1).default(0.9),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (box) => box.x + box.width <= 1 + 1e-9 && box.y + box.height <= 1 + 1e-9,
    'Keep each redaction box inside the frame.',
  )
  .refine((box) => box.end === null || box.end > box.start, 'End a redaction after it starts.');
export type Redaction = z.infer<typeof redactionSchema>;

export const finishingRequestSchema = z
  .object({
    format: z.literal('aftertake-finishing/1'),
    name: z.string().trim().min(1).max(100),
    clip: clipSchema,
    settings: finishingSettingsSchema,
    // Absent in requests made before redaction; treated as none.
    redactions: z.array(redactionSchema).max(16).optional(),
  })
  .strict();
export type FinishingRequest = z.infer<typeof finishingRequestSchema>;
/** An identity export copies the source: no look and nothing to hide. */
export function finishingRequestIsIdentity(
  request: Pick<FinishingRequest, 'settings' | 'redactions'>,
) {
  return finishingIsIdentity(request.settings) && !request.redactions?.length;
}

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
    sourceFiles: z
      .array(
        z
          .object({
            role: z.literal('lut'),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            filename: z.string().regex(/^[a-f0-9]{64}\.cube$/),
          })
          .strict(),
      )
      .max(1)
      .optional(),
  })
  .strict()
  .refine((recipe) => recipe.sourceSha256 === recipe.request.clip.sha256, {
    message: 'The recipe source hash must match its original clip.',
    path: ['sourceSha256'],
  })
  .refine(
    (recipe) =>
      !recipe.sourceFiles ||
      (recipe.sourceFiles.length === (recipe.request.settings.lut ? 1 : 0) &&
        recipe.sourceFiles.every(
          (asset) =>
            asset.sha256 === recipe.request.settings.lut?.sha256 &&
            asset.filename === `${asset.sha256}.cube`,
        )),
    'The LUT companion must match the recipe settings.',
  );
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
