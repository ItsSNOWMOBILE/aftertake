import { z } from 'zod';
import { cinemaSchema, defaultCinema } from './cinema.js';
import type { JobTargetBinding } from './job-target.js';
import type { RecompositionProvenance } from './recomposition.js';

export const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const strokeSchema = z.object({
  points: z.array(pointSchema).min(1).max(300),
  radius: z.number().min(0.005).max(0.5),
  mode: z.enum(['paint', 'erase']).optional(),
});
export const cueSchema = z
  .object({
    start: z.number().min(0).max(12),
    end: z.number().positive().max(12),
    fade: z.number().min(0).max(2),
    feather: z.number().min(0.001).max(0.2),
    tracking: z.enum(['static', 'flow']).optional(),
    anchor: z.number().min(0).max(12).optional(),
    strokes: z.array(strokeSchema).max(100),
  })
  .refine((cue) => cue.end > cue.start, 'Cue must end after it starts');
export const compositeRegionSchema = z
  .object({
    feather: cueSchema.shape.feather,
    tracking: cueSchema.shape.tracking,
    anchor: cueSchema.shape.anchor,
    strokes: cueSchema.shape.strokes,
  })
  .strict();
export const clipSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(200),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  originalSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().positive(),
  url: z.string().startsWith('/media/'),
  kind: z.enum(['video', 'image']).optional(),
  hasAudio: z.boolean().optional(),
});
export const projectSchema = z
  .object({
    format: z.literal('aftertake/1'),
    name: z.string().min(1).max(100),
    clip: clipSchema,
    prompt: z.string().trim().min(5).max(2000),
    cue: cueSchema,
    compositeRegion: compositeRegionSchema.optional(),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
    quality: z.enum(['draft', 'final']),
    trimStart: z.number().min(0).max(3600),
    pipeline: z.enum(['structure', 'inpaint', 'cinema', 'motion-transfer']).optional(),
    cinema: cinemaSchema.optional(),
    directionStrength: z.number().min(1).max(4).optional(),
    matchSourceColor: z.boolean().optional(),
    editReference: clipSchema.extend({ kind: z.literal('image') }).optional(),
    endFrame: clipSchema.extend({ kind: z.literal('image') }).optional(),
    transfer: z
      .object({
        reference: clipSchema.extend({ kind: z.literal('image') }).optional(),
        motionCaption: z.string().trim().max(2000).optional(),
        poseStrength: z.number().min(0.5).max(1.5).multipleOf(0.01).optional(),
        focus: z
          .object({
            x: z.number().min(0).max(0.95),
            y: z.number().min(0).max(0.95),
            width: z.number().min(0.05).max(1),
            height: z.number().min(0.05).max(1),
          })
          .refine(
            (box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001,
            'Keep the focus inside the source frame.',
          )
          .optional(),
        scope: z.enum(['frame', 'cue']),
        finish: z
          .object({
            generation: clipSchema,
            matte: clipSchema,
            settingsKey: z.string().min(1).max(10000),
          })
          .optional(),
      })
      .refine(
        (transfer) => !transfer.focus || transfer.scope === 'cue',
        'A performer focus needs a painted cue.',
      )
      .optional(),
  })
  .refine((recipe) => !recipe.compositeRegion || supportsCompositeRegion(recipe), {
    message: 'A separate final region is available for region VFX and masked edits.',
    path: ['compositeRegion'],
  })
  .refine((recipe) => !recipe.endFrame || recipe.pipeline === 'cinema', {
    message: 'An ending frame is available in Animate a frame.',
    path: ['endFrame'],
  })
  .refine((recipe) => !recipe.endFrame || !editReferenceIssue(recipe.clip, recipe.endFrame), {
    message: 'Choose an ending image with the same aspect ratio as the starting frame.',
    path: ['endFrame'],
  })
  .refine((recipe) => !recipe.transfer || recipe.pipeline === 'motion-transfer', {
    message: 'A motion reference belongs to Transfer motion.',
    path: ['transfer'],
  });
export const recipeSchema = projectSchema
  .refine(
    (recipe) => !usesCue(recipe) || recipe.cue.strokes.some((stroke) => stroke.mode !== 'erase'),
    { message: 'Paint at least one region before rendering.', path: ['cue', 'strokes'] },
  )
  .refine(
    (recipe) =>
      !recipe.compositeRegion ||
      recipe.compositeRegion.strokes.some((stroke) => stroke.mode !== 'erase'),
    {
      message: 'Paint at least one final region before rendering.',
      path: ['compositeRegion', 'strokes'],
    },
  )
  .refine(
    (recipe) =>
      recipe.clip.kind !== 'image' || (recipe.pipeline === 'cinema' && recipe.trimStart === 0),
    {
      message: 'Use Animate a frame for still images, with the reference time set to zero.',
      path: ['pipeline'],
    },
  )
  .refine(
    (recipe) =>
      !recipe.editReference ||
      recipe.pipeline !== 'inpaint' ||
      !editReferenceIssue(recipe.clip, recipe.editReference),
    {
      message: 'Use an edited full frame with the same composition and aspect ratio as the source.',
      path: ['editReference'],
    },
  )
  .refine(
    (recipe) => recipe.pipeline !== 'motion-transfer' || Boolean(recipe.transfer?.reference),
    {
      message: 'Choose an appearance image before transferring motion.',
      path: ['transfer', 'reference'],
    },
  )
  .refine(
    (recipe) =>
      !recipe.transfer?.focus ||
      !recipe.transfer.reference ||
      Math.abs(
        Math.log(
          recipe.transfer.reference.width /
            recipe.transfer.reference.height /
            (recipe.clip.width / recipe.clip.height),
        ),
      ) < 0.06,
    {
      message:
        'Use an appearance frame with the same framing and aspect ratio before focusing a performer.',
      path: ['transfer', 'focus'],
    },
  )
  .refine(
    (recipe) =>
      !recipe.transfer?.finish ||
      (recipe.transfer.scope === 'cue' &&
        recipe.transfer.finish.generation.kind !== 'image' &&
        recipe.transfer.finish.matte.kind !== 'image' &&
        recipe.transfer.finish.settingsKey === motionGenerationKey(recipe)),
    {
      message:
        'A saved generation and video matte must match this motion setup and use a painted cue.',
      path: ['transfer', 'finish'],
    },
  );
export type Recipe = z.infer<typeof projectSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type CompositeRegion = z.infer<typeof compositeRegionSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type Clip = z.infer<typeof clipSchema>;
export function findImportedClip(clips: Clip[], requested: Clip): Clip | undefined {
  return (
    clips.find((clip) => clip.sha256 === requested.sha256) ||
    clips.find(
      (clip) =>
        clip.kind === 'image' &&
        requested.kind === 'image' &&
        clip.originalSha256 === requested.sha256,
    )
  );
}
export type Render = {
  jobTarget?: JobTargetBinding;
  requestKey?: string;
  requestDigest?: string;
  id: string;
  recipe: Recipe;
  state: string;
  progress: number | null;
  createdAt: string;
  updatedAt: string;
  jobId?: string;
  error?: string;
  output?: string;
  rawOutput?: string;
  workflow?: Record<string, unknown>;
  /** CPU finishing is recorded separately from the graph that generated the raw take. */
  recomposition?: RecompositionProvenance;
  coarseOutput?: string;
  guideOutput?: string;
  focusOutput?: string;
  stage?: string;
  origin?: { kind: 'example'; slug: string; renderId: string };
};
export type Engine = {
  connected: boolean;
  ready: boolean;
  gpu?: string;
  missing: string[];
  message: string;
};

export function supportsCompositeRegion(recipe: {
  pipeline?: 'structure' | 'inpaint' | 'cinema' | 'motion-transfer';
}): boolean {
  return !recipe.pipeline || recipe.pipeline === 'structure' || recipe.pipeline === 'inpaint';
}

/** The final spatial region has its own paint/tracking but always uses the generation cue's clock. */
export function finalCompositeCue(recipe: Pick<Recipe, 'cue' | 'compositeRegion'>): Cue {
  const region = recipe.compositeRegion;
  if (!region) return recipe.cue;
  return {
    start: recipe.cue.start,
    end: recipe.cue.end,
    fade: recipe.cue.fade,
    feather: region.feather,
    tracking: region.tracking,
    anchor: region.anchor,
    strokes: region.strokes,
  };
}

export function usesCue(recipe: Pick<Recipe, 'pipeline' | 'transfer'>) {
  return (
    recipe.pipeline !== 'cinema' &&
    !(recipe.pipeline === 'motion-transfer' && (recipe.transfer?.scope || 'frame') === 'frame')
  );
}

export function recipeReference(recipe: Recipe) {
  return recipe.pipeline === 'cinema'
    ? recipe.endFrame
    : recipe.pipeline === 'motion-transfer'
      ? recipe.transfer?.reference
      : recipe.pipeline === 'inpaint'
        ? recipe.editReference
        : undefined;
}

export function bindRecipeReference(recipe: Recipe, reference: Recipe['editReference']): Recipe {
  return {
    ...recipe,
    editReference: recipe.pipeline === 'inpaint' ? reference : undefined,
    endFrame: recipe.pipeline === 'cinema' ? reference : undefined,
    transfer:
      recipe.pipeline === 'motion-transfer'
        ? {
            ...recipe.transfer,
            scope: recipe.transfer?.scope || 'frame',
            reference,
            ...(reference?.sha256 !== recipe.transfer?.reference?.sha256
              ? { finish: undefined }
              : {}),
          }
        : undefined,
  };
}

export function renderSettingsKey(r: Recipe) {
  if (r.pipeline === 'motion-transfer') {
    return JSON.stringify([
      r.clip.sha256,
      r.prompt.trim(),
      r.seed,
      r.quality,
      r.trimStart,
      'motion-transfer',
      r.transfer?.reference?.sha256 || '',
      r.transfer?.motionCaption?.trim() || '',
      r.transfer?.scope || 'frame',
      r.transfer?.poseStrength ?? 1,
      usesCue(r)
        ? [
            cueSettingsKey(r.cue),
            r.matchSourceColor || false,
            r.transfer?.finish?.generation.sha256 || '',
            r.transfer?.finish?.matte.sha256 || '',
          ]
        : null,
      ...(r.transfer?.focus
        ? [
            [
              r.transfer.focus.x,
              r.transfer.focus.y,
              r.transfer.focus.width,
              r.transfer.focus.height,
            ],
          ]
        : []),
    ]);
  }
  if (r.pipeline === 'cinema') {
    const look = r.cinema || defaultCinema;
    return JSON.stringify([
      r.clip.sha256,
      r.prompt.trim(),
      r.seed,
      r.quality,
      r.trimStart,
      'cinema',
      look.movement,
      look.lens,
      look.lighting,
      look.palette,
      look.guidance || 'prompt',
      r.endFrame?.sha256 || '',
    ]);
  }
  const c = r.cue;
  return JSON.stringify([
    r.clip.sha256,
    r.prompt.trim(),
    c.start,
    c.end,
    c.fade,
    c.feather,
    c.tracking || 'static',
    c.anchor || 0,
    c.strokes.map((s) => [s.mode || 'paint', s.radius, s.points.map((p) => [p.x, p.y])]),
    r.seed,
    r.quality,
    r.trimStart,
    r.pipeline || 'structure',
    r.directionStrength || 1,
    r.pipeline === 'inpaint' ? r.editReference?.sha256 || null : null,
    r.matchSourceColor || false,
    ...(r.compositeRegion ? [['composite-region', cueSettingsKey(finalCompositeCue(r))]] : []),
  ]);
}

export function motionGenerationKey(r: Recipe) {
  return JSON.stringify([
    r.clip.sha256,
    r.prompt.trim(),
    r.seed,
    r.quality,
    r.trimStart,
    r.transfer?.reference?.sha256 || '',
    r.transfer?.motionCaption?.trim() || '',
    r.transfer?.poseStrength ?? 1,
    ...(r.transfer?.focus
      ? [[r.transfer.focus.x, r.transfer.focus.y, r.transfer.focus.width, r.transfer.focus.height]]
      : []),
  ]);
}

function cueSettingsKey(c: Cue) {
  return [
    c.start,
    c.end,
    c.fade,
    c.feather,
    c.tracking || 'static',
    c.anchor || 0,
    c.strokes.map((s) => [s.mode || 'paint', s.radius, s.points.map((p) => [p.x, p.y])]),
  ];
}

export function editReferenceIssue(source: Clip, reference: Clip): string | null {
  if (reference.kind !== 'image')
    return 'Choose a PNG, JPEG or WebP image for the edited first frame.';
  if (
    Math.abs(Math.log(reference.width / reference.height / (source.width / source.height))) > 0.06
  )
    return 'Use an edited full frame with the same composition and aspect ratio as the source.';
  return null;
}

export function renderDimensions(recipe: Recipe) {
  const fps = recipe.quality === 'draft' ? 16 : 24;
  const maxFrames = recipe.quality === 'draft' ? 49 : 97;
  const remaining = recipe.clip.duration - recipe.trimStart;
  if (remaining < (recipe.pipeline === 'cinema' ? 0.04 : 0.6))
    throw new Error('The selected source range is too short.');
  const frames =
    recipe.pipeline === 'cinema'
      ? maxFrames
      : Math.min(maxFrames, Math.floor((remaining * fps - 1) / 8) * 8 + 1);
  const longEdge = recipe.quality === 'draft' ? 512 : 768;
  const ratio = recipe.clip.width / recipe.clip.height;
  let width = Math.max(64, Math.round((ratio >= 1 ? longEdge : longEdge * ratio) / 32) * 32);
  let height = Math.max(64, Math.round((ratio >= 1 ? longEdge / ratio : longEdge) / 32) * 32);
  if (recipe.pipeline === 'cinema' && recipe.cinema?.guidance === 'tracks') {
    // The ref0.5 motion adapter needs both latent dimensions divisible by 2:
    // pixel geometry must be multiples of 64. Choose a nearby size close to
    // the source aspect ratio, instead of rounding a 16:9 draft to 512x320.
    const options = [-64, 0, 64]
      .map((offset) => {
        const long = longEdge + offset;
        const w = ratio >= 1 ? long : Math.max(64, Math.round((long * ratio) / 64) * 64);
        const h = ratio >= 1 ? Math.max(64, Math.round(long / ratio / 64) * 64) : long;
        return {
          width: w,
          height: h,
          score: Math.abs(Math.log(w / h / ratio)) * 8 + Math.abs(Math.log(long / longEdge)),
        };
      })
      .sort((a, b) => a.score - b.score);
    width = options[0].width;
    height = options[0].height;
  }
  return { width, height, frames, fps, duration: frames / fps };
}

export function displayDimensions(recipe: Recipe) {
  const d = renderDimensions(recipe),
    ratio = recipe.clip.width / recipe.clip.height;
  return {
    width: ratio >= 1 ? d.width : Math.max(2, Math.round((d.height * ratio) / 2) * 2),
    height: ratio >= 1 ? Math.max(2, Math.round(d.width / ratio / 2) * 2) : d.height,
  };
}

export const presets = [
  {
    id: 'overgrowth',
    name: 'Reclaimed',
    tag: 'NATURE TAKES OVER',
    color: '#b3c890',
    prompt:
      'Cinematic live-action shot. The architecture is covered in lush climbing vines, delicate ferns and dense emerald moss. Small leaves sway naturally. Warm sunlight filters through floating pollen and fine atmospheric haze. Realistic materials, coherent perspective, rich organic detail. One continuous shot.',
  },
  {
    id: 'molten',
    name: 'Molten',
    tag: 'MATTER IN MOTION',
    color: '#edac73',
    prompt:
      'Cinematic live-action shot. The surface transforms into glowing molten gold, slow viscous liquid metal flowing over dark volcanic rock. Warm amber light, intricate reflective detail, tiny glowing embers drifting gently. Photorealistic VFX, physically plausible lighting. One continuous shot.',
  },
  {
    id: 'crystal',
    name: 'Glacial',
    tag: 'A DIFFERENT ELEMENT',
    color: '#99c9d5',
    prompt:
      'Cinematic live-action shot. Translucent blue ice crystals spread across the architecture, delicate frost patterns glisten in soft cold light. Wisps of fine icy mist drift slowly. Intricate crystalline texture, realistic refraction and natural perspective. One continuous shot.',
  },
] as const;

const inpaintPrompts: Record<string, string> = {
  overgrowth:
    'Thick living emerald moss, delicate green ferns and trailing ivy completely cover the surface. Rich botanical detail, tiny leaves sway gently, realistic natural lighting and coherent perspective.',
  molten:
    'Glowing molten gold flows slowly over dark volcanic rock. Intricate reflective liquid metal, warm amber light and tiny drifting embers. Photorealistic materials and physically plausible lighting.',
  crystal:
    'Brilliant white frost and translucent blue ice crystals cover the surface. Delicate icicles, intricate crystalline texture, subtle cold mist and realistic winter light.',
};
export function presetPrompt(preset: (typeof presets)[number], pipeline: Recipe['pipeline']) {
  return pipeline === 'inpaint' ? inpaintPrompts[preset.id] : preset.prompt;
}

export function cueEnvelope(time: number, cue: Cue) {
  if (time < cue.start || time > cue.end) return 0;
  if (cue.fade === 0) return 1;
  const fade = Math.min(cue.fade, (cue.end - cue.start) / 2);
  const x = Math.min(1, (time - cue.start) / fade, (cue.end - time) / fade);
  return x * x * (3 - 2 * x);
}
