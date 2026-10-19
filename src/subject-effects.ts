import { z } from 'zod';
import { clipSchema, type Clip } from './domain.js';
import { characterSelectionSchema, characterSelectionInfoSchema } from './character.js';

export const subjectEffectCopySchema = z
  .object({
    x: z.number().min(-1).max(1),
    y: z.number().min(-1).max(1),
    scale: z.number().min(0.1).max(3),
    opacity: z.number().min(0).max(1),
    flipX: z.boolean().optional(),
    rotation: z.number().min(-180).max(180).optional(),
  })
  .strict();
export const subjectEffectRequestSchema = z
  .object({
    format: z.literal('aftertake-subject-effect/1'),
    name: z.string().trim().min(1).max(100),
    selectionId: z.string().uuid(),
    maskSha256: z.string().regex(/^[a-f0-9]{64}$/),
    copies: z.array(subjectEffectCopySchema).max(4),
    feather: z.number().min(0).max(12).optional(),
    grow: z.number().int().min(-16).max(32).optional(),
    backgroundBlur: z.number().min(0).max(32).optional(),
    backgroundExposureEV: z.number().min(-2).max(2).optional(),
  })
  .strict();
const mediaBinding = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    filename: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[^\\/:]+$/),
  })
  .strict();
export const subjectEffectSelectionSchema = z.object({
  request: characterSelectionSchema,
  info: characterSelectionInfoSchema,
});
export const subjectEffectRecipeSchema = z
  .object({
    format: z.literal('aftertake-subject-effect-recipe/1'),
    renderer: z.literal('aftertake-local-subject-compositor/1'),
    request: subjectEffectRequestSchema,
    selection: subjectEffectSelectionSchema,
    media: z.object({ source: mediaBinding, prepared: mediaBinding, mask: mediaBinding }).strict(),
    output: clipSchema.optional(),
  })
  .strict()
  .superRefine((recipe, context) => {
    if (
      recipe.media.source.sha256 !== recipe.selection.request.clip.sha256 ||
      recipe.media.prepared.sha256 !== recipe.selection.info.sourceSha256 ||
      recipe.media.mask.sha256 !== recipe.selection.info.maskSha256 ||
      recipe.request.maskSha256 !== recipe.selection.info.maskSha256 ||
      recipe.selection.info.emptyFrames.length
    )
      context.addIssue({
        code: 'custom',
        message: 'The recipe media must match its complete reviewed selection.',
      });
  });
export type SubjectEffectCopy = z.infer<typeof subjectEffectCopySchema>;
export type SubjectEffectRequest = z.infer<typeof subjectEffectRequestSchema>;
export type SubjectEffectRecipe = z.infer<typeof subjectEffectRecipeSchema>;
export type SubjectEffectJob = {
  id: string;
  kind: 'subject-effect';
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  request: SubjectEffectRequest;
  selection: z.infer<typeof subjectEffectSelectionSchema>;
  createdAt: string;
  updatedAt: string;
  requestKey?: string;
  requestDigest?: string;
  error?: string;
  clip?: Clip;
};

export type SubjectEffectSelection = {
  id: string;
  request: z.infer<typeof characterSelectionSchema>;
  selection: z.infer<typeof characterSelectionInfoSchema>;
  preparedSourcePath: string;
  maskPath: string;
  originalSourcePath: string;
};
