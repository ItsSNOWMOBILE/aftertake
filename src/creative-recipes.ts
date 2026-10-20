import { z } from 'zod';
import { imageRequestSchema, type ImageRequest } from './image-generation';
import { frameEditRequestSchema, type FrameEditRequest } from './frame-edit';
import { videoRequestSchema, type VideoRequest } from './video-generation';

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

// Video starters set the prompt, length, sound and camera look. The draft keeps
// its name, aspect, quality and seed, like the image starters.
export const videoCreativeRecipeSchema = z
  .object({
    ...identity,
    settings: z
      .object({
        prompt: videoRequestSchema.shape.prompt,
        seconds: videoRequestSchema.shape.seconds,
        sound: videoRequestSchema.shape.sound,
        cinema: videoRequestSchema.shape.cinema.unwrap(),
      })
      .strict(),
  })
  .strict();

export type ImageCreativeRecipe = z.infer<typeof imageCreativeRecipeSchema>;
export type FrameCreativeRecipe = z.infer<typeof frameCreativeRecipeSchema>;
export type VideoCreativeRecipe = z.infer<typeof videoCreativeRecipeSchema>;

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
const higgsfield = (path: string) =>
  `https://github.com/higgsfield-ai/skills/blob/f83af0bc1d937c8119099a11f8ebbf5e6fb99819/${path}`;
const photoshootSource = {
  label: 'Higgsfield product photoshoot · modes',
  url: higgsfield('higgsfield-product-photoshoot/SKILL.md#modes'),
};
const marketingSource = {
  label: 'Higgsfield marketing studio · video modes',
  url: higgsfield('higgsfield-generate/references/marketing-modes.md'),
};
const motionPromptSource = {
  label: 'Higgsfield prompt engineering · motion and positive phrasing',
  url: higgsfield('higgsfield-generate/references/prompt-engineering.md#image-to-video'),
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
function videoRecipe(value: VideoCreativeRecipe) {
  const recipe = videoCreativeRecipeSchema.parse(value);
  Object.freeze(recipe.settings.cinema);
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
  imageRecipe({
    id: 'lifestyle-scene',
    label: 'Lifestyle scene',
    description: 'A product in use in a lived-in place, with natural light and a human touch.',
    sources: [photoshootSource],
    settings: {
      prompt:
        'One unbranded matte-black ceramic pour-over coffee set on a worn oak kitchen counter in the morning. Steam rises from a fresh cup, an adult hand rests beside it, and a window behind the counter fills the room with low warm sunlight. Linen towel, a small plant and a few coffee beans give the scene life without crowding the product, which stays sharp and clearly the subject. Natural colors, believable clutter, no text or logos.',
      style: 'photo',
      direction: { shot: 'medium', lens: 'portrait', lighting: 'golden' },
    },
  }),
  imageRecipe({
    id: 'hands-close-up',
    label: 'Hands close-up',
    description: 'A tight demonstration shot: adult hands holding or applying the product.',
    sources: [photoshootSource],
    settings: {
      prompt:
        "Extreme close-up of an adult's hands holding a small unbranded amber glass dropper bottle and releasing one clear drop onto the fingertips. Natural skin texture with visible fine detail, short clean nails, a soft cream sweater cuff at the edge of frame. The bottle label area is blank. Bright diffused light, creamy out-of-focus background in warm neutrals, tack-sharp focus on the drop. No faces, text or logos.",
      style: 'photo',
      direction: { shot: 'close', lens: 'portrait', lighting: 'soft' },
    },
  }),
  imageRecipe({
    id: 'moodboard-pin',
    label: 'Moodboard pin',
    description:
      'A soft, styled flat-lay with a curated palette. Choose Portrait for a pin-shaped frame.',
    sources: [photoshootSource],
    settings: {
      prompt:
        'A styled overhead flat-lay in a muted sage, sand and terracotta palette: an unbranded linen notebook, a ceramic cup of matcha, dried pampas stems, a brass pen and a folded knit scarf arranged with generous breathing room on a textured plaster surface. Gentle window light with soft shadows, calm editorial mood, everything in focus. No text, logos or watermarks.',
      style: 'photo',
      direction: { shot: 'overhead', lens: 'normal', lighting: 'soft' },
    },
  }),
  imageRecipe({
    id: 'hero-banner',
    label: 'Hero banner',
    description:
      'A wide campaign header with the product on one side and clear space for a headline. Choose Landscape.',
    sources: [photoshootSource],
    settings: {
      prompt:
        'A wide cinematic campaign image: one unbranded white running shoe resting on a wet black stone ledge in the right third of the frame, lit by a cool rim light, with fine mist and soft dawn light over a blurred mountain lake behind it. The left two thirds stay calm and uncluttered, a smooth gradient of sky and water ready for a headline. Premium, minimal and crisp. No text, logos or watermarks.',
      style: 'cinematic',
      direction: { shot: 'wide', lens: 'wide', lighting: 'blue' },
    },
  }),
  imageRecipe({
    id: 'conceptual-splash',
    label: 'Conceptual splash',
    description: 'A sculptural, frozen-motion product shot: levitation, splash and studio color.',
    sources: [photoshootSource],
    settings: {
      prompt:
        'One unbranded frosted glass perfume bottle floating mid-air at a slight tilt, surrounded by a frozen crown splash of clear water and a few suspended citrus slices, against a saturated tangerine studio backdrop. Crisp droplets catch a hard key light, the bottle casts a soft shadow on the seamless floor below. High-speed photography look, sharp from front to back, bold and playful. No text, logos or watermarks.',
      style: 'product',
      direction: { shot: 'medium', lens: 'normal', lighting: 'hard' },
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
  frameRecipe({
    id: 'seasonal-restyle',
    label: 'Seasonal restyle',
    description:
      'Move the same scene into a snowy winter evening without changing who or what is in it. Detailed · 20 steps.',
    sources: [photoshootSource],
    requiresSubject: false,
    settings: {
      prompt:
        'Restyle Picture 1 as a quiet winter evening: a light layer of fresh snow on outdoor surfaces, a few soft falling flakes, cool blue ambient light balanced by warm windows or practical lights. Preserve every person, facial identity, pose, clothing, object geometry, camera framing and the layout of the scene. Change only the season, weather and light. Do not add new people, objects, text or logos.',
      mode: 'detail',
    },
  }),
  frameRecipe({
    id: 'outfit-try-on',
    label: 'Outfit try-on',
    description:
      'Dress the person in Picture 1 in the garment from your selected subject image. Detailed · 20 steps.',
    sources: [photoshootSource],
    requiresSubject: true,
    settings: {
      prompt:
        "Dress the main person in Picture 1 in the garment shown in Picture 2. Use Picture 2 only for the garment's cut, fabric, color and details, and fit it naturally to the person's body, pose and proportions with believable folds. Preserve the person's face, identity, hair, skin tone, hands, pose, the background and the camera framing. Match the lighting and shadows of Picture 1. Do not change any other clothing unless the new garment covers it, and do not add text or logos.",
      mode: 'detail',
    },
  }),
]);

export const videoCreativeRecipes = Object.freeze([
  videoRecipe({
    id: 'product-showcase',
    label: 'Product showcase',
    description: 'A polished hero turn around a product on a lit plinth. No presenter.',
    sources: [marketingSource, motionPromptSource],
    settings: {
      prompt:
        'An unbranded brushed-steel wristwatch rests on a slowly rotating black stone plinth in a dark studio. A thin rim light traces its edge, reflections glide across the polished case, and the second hand ticks smoothly. Fine dust drifts through a single soft spotlight. Premium, calm and tack sharp. No text or logos.',
      seconds: 5,
      sound: false,
      cinema: { movement: 'orbit', lens: 'anamorphic', lighting: 'tungsten', palette: 'warm' },
    },
  }),
  videoRecipe({
    id: 'tv-spot',
    label: 'TV spot',
    description: 'A broadcast-style moment: a crafted scene, warm light and a confident push in.',
    sources: [marketingSource, motionPromptSource],
    settings: {
      prompt:
        'Golden evening in a sunlit family kitchen. An adult in a denim shirt pours fresh orange juice from an unbranded glass carafe into a tall glass, the juice catching the light, then lifts the glass toward the window with a satisfied smile. Lens flare from the low sun, warm wood tones, shallow depth of field, the polish of a broadcast commercial. Gentle ambient kitchen sound, no dialogue. No text or logos.',
      seconds: 5,
      sound: true,
      cinema: { movement: 'push', lens: 'portrait', lighting: 'daylight', palette: 'warm' },
    },
  }),
  videoRecipe({
    id: 'phone-ugc',
    label: 'Phone-filmed UGC',
    description: 'An organic, filmed-on-a-phone feel: a person reacting to a product at home.',
    sources: [marketingSource],
    settings: {
      prompt:
        'Filmed on a phone propped on a bookshelf in a bright apartment. A young adult in a grey hoodie sits on a sofa, holds up an unbranded mint-green water bottle toward the lens, takes a sip, and nods with an easy, genuine grin. Everyday window light, slightly imperfect framing, natural colors and real-life texture rather than studio polish. Quiet room tone, no dialogue. No text or logos.',
      seconds: 4,
      sound: true,
      cinema: { movement: 'locked', lens: 'wide', lighting: 'daylight', palette: 'source' },
    },
  }),
  videoRecipe({
    id: 'unboxing-reveal',
    label: 'Unboxing reveal',
    description: 'Overhead hands opening a box and lifting the product into view.',
    sources: [marketingSource, motionPromptSource],
    settings: {
      prompt:
        'Top-down view of a light oak desk. Adult hands lift the lid off a plain matte-white gift box, fold back crisp tissue paper, and raise a pair of unbranded charcoal wireless headphones up into the light. Soft daylight from one side, a small plant and a notebook at the frame edges. Satisfying, tactile and clean. Soft paper rustle sound, no dialogue. No text or logos.',
      seconds: 5,
      sound: true,
      cinema: { movement: 'locked', lens: 'natural', lighting: 'daylight', palette: 'source' },
    },
  }),
  videoRecipe({
    id: 'how-to-demo',
    label: 'How-to demo',
    description: 'A clear tutorial beat: hands showing one step, close and well lit.',
    sources: [marketingSource, motionPromptSource],
    settings: {
      prompt:
        'Close shot of adult hands on a pale marble counter pressing the plunger of an unbranded glass French press down in one slow, steady motion, the dark coffee swirling below the mesh. Bright, even daylight, a clean neutral background, every movement easy to follow. The camera eases slowly closer. Faint pour and press sounds, no dialogue. No text or logos.',
      seconds: 5,
      sound: true,
      cinema: { movement: 'push', lens: 'natural', lighting: 'daylight', palette: 'source' },
    },
  }),
  videoRecipe({
    id: 'neon-teaser',
    label: 'Neon teaser',
    description: 'A moody launch teaser: rain, neon reflections and a slow reveal.',
    sources: [marketingSource, motionPromptSource],
    settings: {
      prompt:
        'Night in a rain-soaked city alley. Neon light in magenta and cyan ripples across puddles as the view slowly sweeps past steaming vents toward a sleek unbranded electric scooter parked under a single flickering sign. Raindrops streak through the light, reflections shimmer on its glossy body. Tense, stylish and cinematic. Rain and distant city hum, no dialogue. No text or logos.',
      seconds: 5,
      sound: true,
      cinema: { movement: 'pan', lens: 'anamorphic', lighting: 'neon', palette: 'cool' },
    },
  }),
]);

export function applyImageCreativeRecipe(request: ImageRequest, id: string): ImageRequest {
  const recipe = imageCreativeRecipes.find((item) => item.id === id);
  if (!recipe) throw Error('Unknown image starter recipe.');
  return { ...request, ...structuredClone(recipe.settings) };
}

export function applyVideoCreativeRecipe(request: VideoRequest, id: string): VideoRequest {
  const recipe = videoCreativeRecipes.find((item) => item.id === id);
  if (!recipe) throw Error('Unknown video starter recipe.');
  return { ...request, ...structuredClone(recipe.settings) };
}

export function applyFrameCreativeRecipe(request: FrameEditRequest, id: string): FrameEditRequest {
  const recipe = frameCreativeRecipes.find((item) => item.id === id);
  if (!recipe) throw Error('Unknown frame starter recipe.');
  if (recipe.requiresSubject && !request.subject)
    throw Error(`Choose a subject reference before loading ${recipe.label}.`);
  return { ...request, ...structuredClone(recipe.settings) };
}
