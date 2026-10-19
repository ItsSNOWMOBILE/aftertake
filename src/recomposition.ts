import { z } from 'zod';
import {
  compositeRegionSchema,
  recipeSchema,
  supportsCompositeRegion,
  type Clip,
  type Recipe,
} from './domain.js';
import { canonicalJSON } from './narrated-cut.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const generationWorkflowSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (workflow) => Object.keys(workflow).length > 0,
    'Keep the original executed generation workflow with this take.',
  );

/** Only final spatial blending and source color matching can change without generation. */
export const recompositionRequestSchema = z
  .object({
    renderId: z.string().uuid(),
    compositeRegion: compositeRegionSchema.optional(),
    matchSourceColor: z.boolean(),
  })
  .strict()
  .refine(
    (request) =>
      !request.compositeRegion ||
      request.compositeRegion.strokes.some((stroke) => stroke.mode !== 'erase'),
    'Paint at least one final region, or use the original generation region.',
  );
export type RecompositionRequest = z.infer<typeof recompositionRequestSchema>;

/** Omitting compositeRegion deliberately restores the generation cue's spatial region. */
export function recompositionRecipe(original: Recipe, request: RecompositionRequest): Recipe {
  if (!supportsCompositeRegion(original))
    throw new Error('Only saved region VFX and masked edits support a CPU reblend.');
  return recipeSchema.parse({
    ...original,
    compositeRegion: request.compositeRegion,
    matchSourceColor: request.matchSourceColor,
  });
}

/** A local import may rebind IDs, names and URLs; actual generation inputs are content-bound. */
export function recompositionRecipeContent(recipe: Recipe, includeBlend = false): string {
  const asset = (clip: Clip) => ({
    sha256: clip.sha256,
    width: clip.width,
    height: clip.height,
    duration: clip.duration,
    kind: clip.kind || 'video',
  });
  const parsed = recipeSchema.parse(recipe),
    { compositeRegion: _region, matchSourceColor: _color, ...generation } = parsed;
  return canonicalJSON({
    ...(includeBlend ? parsed : generation),
    clip: asset(parsed.clip),
    editReference: parsed.editReference ? asset(parsed.editReference) : undefined,
    endFrame: parsed.endFrame ? asset(parsed.endFrame) : undefined,
    transfer: parsed.transfer
      ? {
          ...parsed.transfer,
          reference: parsed.transfer.reference ? asset(parsed.transfer.reference) : undefined,
          finish: parsed.transfer.finish
            ? {
                ...parsed.transfer.finish,
                generation: asset(parsed.transfer.finish.generation),
                matte: asset(parsed.transfer.finish.matte),
              }
            : undefined,
        }
      : undefined,
  });
}

export function sameRecompositionGeneration(original: Recipe, next: Recipe): boolean {
  return (
    supportsCompositeRegion(original) &&
    recompositionRecipeContent(original) === recompositionRecipeContent(next)
  );
}

export const recompositionReceiptSchema = z
  .object({
    format: z.literal('aftertake-cpu-recomposition/1'),
    processor: z.literal('aftertake-cpu-recomposition/1'),
    sourceSha256: sha256,
    rawSha256: sha256,
    outputSha256: sha256,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frames: z.number().int().positive().max(300),
    fps: z.number().int().positive().max(120),
    duration: z.number().positive().max(20),
    hasAudio: z.boolean(),
    originalRecipe: recipeSchema,
    newRecipe: recipeSchema,
    originalGenerationWorkflow: generationWorkflowSchema,
    compositionPolicy: z.literal('aftertake-native-final-composite/1'),
    stages: z
      .array(
        z.enum([
          'source-clock-sampling',
          'final-inpaint-laplacian-blend',
          'display-grid-final-mask',
          'working-grid-final-mask',
          'boundary-color-match',
          'display-bicubic',
          'source-audio-mux',
        ]),
      )
      .min(1)
      .max(7),
    allProtectedPixelsExactBeforeEncoding: z.boolean(),
    protectedPixelsReference: z.enum([
      'display-grid-source',
      'working-grid-source-before-display-resize',
    ]),
    noModelInvocation: z.literal(true),
    noComfyGraphExecution: z.literal(true),
  })
  .strict()
  .refine((receipt) => receipt.sourceSha256 === receipt.originalRecipe.clip.sha256)
  .refine((receipt) => sameRecompositionGeneration(receipt.originalRecipe, receipt.newRecipe))
  .refine((receipt) => Math.abs(receipt.duration - receipt.frames / receipt.fps) < 1e-7);
export type RecompositionReceipt = z.infer<typeof recompositionReceiptSchema>;

/** This records CPU provenance separately from the graph that generated the raw take. */
export const recompositionProvenanceSchema = z
  .object({
    format: z.literal('aftertake-recomposition/1'),
    jobId: z.string().uuid(),
    sourceRenderId: z.string().uuid(),
    generationRenderId: z.string().uuid(),
    sourceSha256: sha256,
    rawSha256: sha256,
    originalRecipe: recipeSchema,
    originalGenerationWorkflow: generationWorkflowSchema,
    receipt: recompositionReceiptSchema,
  })
  .strict()
  .refine(
    (provenance) =>
      provenance.jobId !== provenance.sourceRenderId &&
      provenance.jobId !== provenance.generationRenderId,
  )
  .refine(
    (provenance) =>
      provenance.sourceSha256 === provenance.receipt.sourceSha256 &&
      provenance.rawSha256 === provenance.receipt.rawSha256,
  )
  .refine(
    (provenance) =>
      canonicalJSON(provenance.originalRecipe) === canonicalJSON(provenance.receipt.originalRecipe),
  )
  .refine(
    (provenance) =>
      canonicalJSON(provenance.originalGenerationWorkflow) ===
      canonicalJSON(provenance.receipt.originalGenerationWorkflow),
  );
export type RecompositionProvenance = z.infer<typeof recompositionProvenanceSchema>;

export const recompositionJobSchema = z
  .object({
    id: z.string().uuid(),
    request: recompositionRequestSchema,
    sourceRenderId: z.string().uuid(),
    generationRenderId: z.string().uuid(),
    sourceSha256: sha256,
    rawSha256: sha256,
    rawOutput: z.string().regex(/^\/outputs\/[a-f0-9-]{36}-raw\.mp4$/),
    originalRecipe: recipeSchema,
    newRecipe: recipeSchema,
    originalGenerationWorkflow: generationWorkflowSchema,
    state: z.enum([
      'queued',
      'running',
      'canceling',
      'succeeded',
      'failed',
      'canceled',
      'interrupted',
    ]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    requestKey: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
    requestDigest: sha256.optional(),
    renderId: z.string().uuid().optional(),
    receipt: recompositionReceiptSchema.optional(),
    error: z.string().max(500).optional(),
  })
  .strict()
  .refine((job) => job.request.renderId === job.sourceRenderId)
  .refine((job) => job.id !== job.sourceRenderId && job.id !== job.generationRenderId)
  .refine((job) => job.originalRecipe.clip.sha256 === job.sourceSha256)
  .refine((job) => sameRecompositionGeneration(job.originalRecipe, job.newRecipe))
  .refine(
    (job) =>
      supportsCompositeRegion(job.originalRecipe) &&
      recompositionRecipeContent(recompositionRecipe(job.originalRecipe, job.request), true) ===
        recompositionRecipeContent(job.newRecipe, true),
  )
  .refine(
    (job) =>
      !job.receipt ||
      (job.receipt.sourceSha256 === job.sourceSha256 &&
        job.receipt.rawSha256 === job.rawSha256 &&
        canonicalJSON(job.receipt.originalRecipe) === canonicalJSON(job.originalRecipe) &&
        canonicalJSON(job.receipt.newRecipe) === canonicalJSON(job.newRecipe) &&
        canonicalJSON(job.receipt.originalGenerationWorkflow) ===
          canonicalJSON(job.originalGenerationWorkflow)),
  )
  .refine((job) => job.state !== 'succeeded' || (job.renderId === job.id && !!job.receipt));
export type RecompositionJob = z.infer<typeof recompositionJobSchema>;

export function recompositionBusy(job: Pick<RecompositionJob, 'state'>): boolean {
  return job.state === 'queued' || job.state === 'running' || job.state === 'canceling';
}
