import { z } from 'zod';
import { clipSchema, type Clip } from './domain.js';
import type { JobTargetBinding } from './job-target.js';

export const depthModel = {
  repository: 'Comfy-Org/Depth-Anything-3',
  revision: '1aaeea516f22fb2f4c7fae761c8ed470c6cf9f93',
  path: 'geometry_estimation/depth_anything_3_small.safetensors',
  filename: 'depth_anything_3_small.safetensors',
  sha256: '9c0a53d157c5b315d4c82908a43d93eeaa3a9ac3de9d15c2b4242ef46b5508ad',
  license: 'Apache-2.0',
} as const;
export const defaultDepthSettings = {
  focus: 0.35,
  blur: 0,
  haze: 0,
  hazeColor: '#cbd7e3',
  lightAzimuth: -45,
  lightElevation: 45,
  lightStrength: 0,
};
export const depthSettingsSchema = z
  .object({
    focus: z.number().min(0).max(1),
    blur: z.number().min(0).max(32),
    haze: z.number().min(0).max(1),
    hazeColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    lightAzimuth: z.number().min(-180).max(180),
    lightElevation: z.number().min(0).max(90),
    lightStrength: z.number().min(0).max(1),
  })
  .strict();
export const depthEffectRequestSchema = z
  .object({
    format: z.literal('aftertake-depth-effect/1'),
    name: z.string().trim().min(1).max(100),
    clip: clipSchema.extend({ kind: z.literal('image') }),
    settings: depthSettingsSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.clip.width >= 64 &&
      value.clip.height >= 64 &&
      value.clip.width <= 4096 &&
      value.clip.height <= 4096 &&
      value.clip.width * value.clip.height <= 4194304,
    'Use a still image from 64 pixels per side, up to 4 megapixels and 4096 pixels per side.',
  );
export type DepthSettings = z.infer<typeof depthSettingsSchema>;
export type DepthEffectRequest = z.infer<typeof depthEffectRequestSchema>;
export type DepthEffectJob = {
  id: string;
  request: DepthEffectRequest;
  state: string;
  progress: number | null;
  createdAt: string;
  updatedAt: string;
  stage?: string;
  error?: string;
  jobId?: string;
  requestKey?: string;
  requestDigest?: string;
  jobTarget?: JobTargetBinding;
  workflow: Record<string, any>;
  clip?: Clip;
  depth?: { sha256: string; rawSha256: string; width: number; height: number; modelSha256: string };
};
export const depthEffectTerminal = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
  'output_error',
]);
export const depthEffectBusy = (job: DepthEffectJob) => !depthEffectTerminal.has(job.state);
export const depthEffectRecipeSchema = z
  .object({
    format: z.literal('aftertake-depth-effect-recipe/1'),
    request: depthEffectRequestSchema,
    model: z.object({
      repository: z.literal(depthModel.repository),
      revision: z.literal(depthModel.revision),
      sha256: z.literal(depthModel.sha256),
      license: z.literal(depthModel.license),
    }),
    output: clipSchema.optional(),
  })
  .strict();
