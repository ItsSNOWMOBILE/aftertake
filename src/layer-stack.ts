import { z } from 'zod';
import { clipSchema, type Clip } from './domain.js';
import { finishingSettingsSchema } from './finishing.js';

export const layerBlendModes = [
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'color-burn',
  'linear-burn',
  'darker-color',
  'lighten',
  'screen',
  'color-dodge',
  'linear-dodge',
  'lighter-color',
  'overlay',
  'soft-light',
  'hard-light',
  'vivid-light',
  'linear-light',
  'pin-light',
  'hard-mix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const layerImageRefSchema = z.object({ assetId: z.string().uuid(), sha256: sha }).strict();
export const defaultLayerTransform = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
export const layerTransformSchema = z
  .object({
    x: z.number().min(-2).max(2).default(0),
    y: z.number().min(-2).max(2).default(0),
    scale: z.number().min(0.05).max(4).default(1),
    rotation: z.number().min(-180).max(180).default(0),
    flipX: z.boolean().default(false),
  })
  .strict();
const maskControls = {
  enabled: z.boolean().default(true),
  invert: z.boolean().default(false),
  grow: z.number().int().min(-32).max(32).default(0),
  feather: z.number().min(0).max(32).default(0),
};
const geometry = {
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  width: z.number().positive().max(2),
  height: z.number().positive().max(2),
};
export const layerMaskSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rectangle'), ...geometry, ...maskControls }).strict(),
  z.object({ kind: z.literal('ellipse'), ...geometry, ...maskControls }).strict(),
  z
    .object({
      kind: z.literal('image'),
      source: layerImageRefSchema,
      channel: z.enum(['alpha', 'luminance']),
      ...maskControls,
    })
    .strict(),
]);
const common = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  blend: z.enum(layerBlendModes).default('normal'),
  dissolveSeed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 32 - 1)
    .default(42),
  clipToBelow: z.boolean().default(false),
  mask: layerMaskSchema.optional(),
};
export const layerStackLayerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('image'),
      ...common,
      source: layerImageRefSchema,
      transform: layerTransformSchema.default(defaultLayerTransform),
    })
    .strict(),
  z
    .object({ type: z.literal('adjustment'), ...common, settings: finishingSettingsSchema })
    .strict(),
]);
export const layerStackRequestSchema = z
  .object({
    format: z.literal('aftertake-layer-stack/1'),
    name: z.string().trim().min(1).max(100),
    canvas: z
      .object({
        width: z.number().int().min(1).max(4096),
        height: z.number().int().min(1).max(4096),
      })
      .strict()
      .refine(
        (value) => value.width * value.height <= 4194304,
        'Keep the still canvas within four megapixels.',
      ),
    // Bottom first. The first non-clipped image establishes a clipping base.
    layers: z.array(layerStackLayerSchema).min(1).max(8),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.layers.map((layer) => layer.id)).size !== request.layers.length)
      context.addIssue({ code: 'custom', message: 'Every layer needs a unique ID.' });
    if (!request.layers.some((layer) => layer.type === 'image'))
      context.addIssue({ code: 'custom', message: 'Add a still-image layer.' });
    let base = false;
    for (const layer of request.layers) {
      if (layer.clipToBelow && !base)
        context.addIssue({
          code: 'custom',
          message: 'A clipped layer needs an unclipped image below it.',
        });
      if (layer.type === 'image' && !layer.clipToBelow) base = true;
    }
    try {
      layerStackSources(request);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'A source ID cannot bind different image bytes.',
      });
    }
  });
export type LayerStackRequest = z.infer<typeof layerStackRequestSchema>;
export type LayerStackLayer = z.infer<typeof layerStackLayerSchema>;
export type LayerMask = z.infer<typeof layerMaskSchema>;
export type LayerImageRef = z.infer<typeof layerImageRefSchema>;
export const layerStackRecipeSchema = z
  .object({
    format: z.literal('aftertake-layer-stack-recipe/1'),
    processor: z.literal('aftertake-cpu-layer-stack/1'),
    request: layerStackRequestSchema,
    media: z
      .array(
        layerImageRefSchema
          .extend({
            filename: z
              .string()
              .min(1)
              .max(200)
              .regex(/^[^\\/:]+$/),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    output: clipSchema.optional(),
  })
  .strict()
  .superRefine((recipe, context) => {
    const refs = layerStackSources(recipe.request);
    if (
      recipe.media.length !== refs.length ||
      refs.some(
        (ref) =>
          !recipe.media.some((item) => item.assetId === ref.assetId && item.sha256 === ref.sha256),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'The portable media must bind every layer and mask exactly once.',
      });
  });
export type LayerStackRecipe = z.infer<typeof layerStackRecipeSchema>;
export type LayerStackJob = {
  id: string;
  request: LayerStackRequest;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  requestKey?: string;
  requestDigest?: string;
  media: LayerStackRecipe['media'];
  clip?: Clip;
  error?: string;
};
export function layerStackSources(request: LayerStackRequest): LayerImageRef[] {
  const refs = new Map<string, LayerImageRef>();
  for (const layer of request.layers) {
    for (const ref of [
      layer.type === 'image' ? layer.source : undefined,
      layer.mask?.kind === 'image' ? layer.mask.source : undefined,
    ]) {
      if (!ref) continue;
      const existing = refs.get(ref.assetId);
      if (existing && existing.sha256 !== ref.sha256)
        throw Error('A source ID cannot bind different image bytes.');
      refs.set(ref.assetId, ref);
    }
  }
  return [...refs.values()];
}
