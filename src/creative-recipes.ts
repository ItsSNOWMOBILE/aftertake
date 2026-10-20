import { z } from 'zod';
import { imageRequestSchema, type ImageRequest } from './image-generation';
import { frameEditRequestSchema, type FrameEditRequest } from './frame-edit';

const sourceSchema = z.object({ label: z.string().min(1), url: z.url() }).strict();
const identity = {
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(240),
  sources: z.array(sourceSchema).min(1).max(4),
};

export const imageCreativeRecipeSchema = z
  .object({
    ...identity,
    settings: imageRequestSchema.pick({ prompt: true, style: true, direction: true }).strict(),
  })
  .strict();
export const frameCreativeRecipeSchema = z
  .object({
    ...identity,
    requiresSubject: z.boolean(),
    settings: z
      .object({ prompt: imageRequestSchema.shape.prompt, mode: frameEditRequestSchema.shape.mode })
      .strict(),
  })
  .strict();

export type ImageCreativeRecipe = z.infer<typeof imageCreativeRecipeSchema>;
export type FrameCreativeRecipe = z.infer<typeof frameCreativeRecipeSchema>;

// Original Aftertake prompts, informed by the published production patterns.
// These are editable request settings, not imported graphs or proven outputs.
// The source cookbook is MIT, Copyright (c) 2026 Higgsfield AI; no source text
// or closed-service implementation is copied into these starters.
const campaignSource = {
  label: 'Higgsfield campaign cookbook · recipe 1',
  url: 'https://github.com/higgsfield-ai/skills/blob/f83af0bc1d937c8119099a11f8ebbf5e6fb99819/COOKBOOK.md#recipe-1--brand-campaign-from-a-founder-photo',
};
const relightSource = {
  label: 'Comfy Qwen 2509 relight template · workflow inspiration only',
  url: 'https://github.com/Comfy-Org/workflow_templates/blob/86ce86e92ec77e3c3c6d4a754e69cfce37886542/templates/image_qwen_image_edit_2509_relight.json',
};
const productSource = {
  label: 'Comfy product placement template · composition inspiration only',
  url: 'https://github.com/Comfy-Org/workflow_templates/blob/86ce86e92ec77e3c3c6d4a754e69cfce37886542/templates/template_product_placement.json',
};
const preservationSource = {
  label: 'Higgsfield Brandkit QA · controlled edits and source preservation',
  url: 'https://github.com/higgsfield-ai/skills/blob/f83af0bc1d937c8119099a11f8ebbf5e6fb99819/higgsfield-brandkit/references/qa-and-iteration.md',
};
// FrameEditor remains on its existing Qwen 2511 contract. The relight starter
// borrows the editing goal only, not the template's 2509 models or adapters.
// Likewise, the product starter does not import the partner API graph.

function imageRecipe(value: ImageCreativeRecipe) {
  const recipe = imageCreativeRecipeSchema.parse(value);
  if (recipe.settings.direction) Object.freeze(recipe.settings.direction);
  Object.freeze(recipe.settings);
  recipe.sources.forEach(Object.freeze);
  Object.freeze(recipe.sources);
  return Object.freeze(recipe);
}
function frameRecipe(value: FrameCreativeRecipe) {
  const recipe = frameCreativeRecipeSchema.parse(value);
  Object.freeze(recipe.settings);
  recipe.sources.forEach(Object.freeze);
  Object.freeze(recipe.sources);
  return Object.freeze(recipe);
}

export const imageCreativeRecipes = Object.freeze([
  imageRecipe({
    id: 'fashion-editorial',
    label: 'Fashion editorial',
    description: 'A clean fashion concept with a full outfit and room for your own campaign copy.',
    sources: [campaignSource],
    settings: {
      prompt:
        'An adult fashion model wearing a tailored cobalt-blue jacket, ivory trousers and simple dark shoes, standing naturally against a warm grey studio wall. Show the complete outfit and both hands. Gentle side light reveals the fabric texture. A restrained editorial composition with clear space beside the model for copy. No lettering, logos or watermarks.',
      style: 'photo',
      direction: { shot: 'wide', lens: 'normal', lighting: 'soft' },
    },
  }),
  imageRecipe({
    id: 'clean-product',
    label: 'Clean product still',
    description:
      'A simple studio product concept with controlled light and an uncluttered surface.',
    sources: [campaignSource],
    settings: {
      prompt:
        'One unbranded brushed-aluminium reusable bottle standing on a matte off-white tabletop against a seamless pale-grey background. Keep the bottle geometry straight and its material crisp. A large soft key light from the left and subtle fill create a grounded contact shadow and gentle reflections. Minimal composition, no extra props, no text, no logo.',
      style: 'product',
      direction: { shot: 'medium', lens: 'normal', lighting: 'soft' },
    },
  }),
]);

export const frameCreativeRecipes = Object.freeze([
  frameRecipe({
    id: 'warm-practical-relight',
    label: 'Warm practical relight',
    description:
      'Prompt-guided still relight using the current frame model. Keep the source composition. Detailed · 20 steps.',
    sources: [relightSource],
    requiresSubject: false,
    settings: {
      prompt:
        'Relight Picture 1 with a restrained warm evening atmosphere. Let existing lamps or windows motivate the illumination, with soft amber highlights and natural shadow falloff. Preserve the people, identities, expressions, clothing, object shapes, camera framing and background arrangement. Keep skin tones believable. Do not add a lamp, change the time of day dramatically or introduce bloom.',
      mode: 'detail',
    },
  }),
  frameRecipe({
    id: 'product-replacement',
    label: 'Product replacement',
    description:
      'Use your selected subject image as Picture 2. Edit the product instruction before running. Detailed · 20 steps.',
    sources: [productSource],
    requiresSubject: true,
    settings: {
      prompt:
        'Replace the main foreground product in Picture 1 with the product shown in Picture 2. Use Picture 2 for the product shape, material and colors only. Match the original product placement, scale, perspective, illumination, contact shadow and any visible reflections in Picture 1. Preserve every person, hand, surrounding prop, background and the camera framing. Do not copy the background or lighting of Picture 2. Keep existing lettering faithful; do not invent new text.',
      mode: 'detail',
    },
  }),
  frameRecipe({
    id: 'preserve-source-monochrome',
    label: 'Preserve-source monochrome',
    description:
      'Ask for a restrained black-and-white treatment while keeping the composition. Detailed · 20 steps.',
    sources: [preservationSource],
    requiresSubject: false,
    settings: {
      prompt:
        'Convert Picture 1 to a natural black-and-white photographic treatment with smooth midtones, retained highlight detail and gently deeper blacks. Preserve all people, facial identity, poses, clothing, object geometry, background, original framing and visible texture. Change the color treatment only. Do not add film damage, grain, blur, vignette, text or new objects.',
      mode: 'detail',
    },
  }),
]);

export function applyImageCreativeRecipe(request: ImageRequest, id: string): ImageRequest {
  const recipe = imageCreativeRecipes.find((item) => item.id === id);
  if (!recipe) throw Error('Unknown image starter recipe.');
  return { ...request, ...structuredClone(recipe.settings) };
}

export function applyFrameCreativeRecipe(request: FrameEditRequest, id: string): FrameEditRequest {
  const recipe = frameCreativeRecipes.find((item) => item.id === id);
  if (!recipe) throw Error('Unknown frame starter recipe.');
  if (recipe.requiresSubject && !request.subject)
    throw Error('Choose a subject reference before loading Product replacement.');
  return { ...request, ...structuredClone(recipe.settings) };
}
