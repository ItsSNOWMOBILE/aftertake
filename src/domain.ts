import { z } from 'zod';
import { cinemaSchema, defaultCinema } from './cinema.js';

export const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const strokeSchema = z.object({ points: z.array(pointSchema).min(1).max(300), radius: z.number().min(0.005).max(0.5), mode: z.enum(['paint', 'erase']).optional() });
export const cueSchema = z.object({
  start: z.number().min(0).max(12), end: z.number().positive().max(12),
  fade: z.number().min(0).max(2), feather: z.number().min(0.001).max(0.2),
  tracking: z.enum(['static', 'flow']).optional(), anchor: z.number().min(0).max(12).optional(),
  strokes: z.array(strokeSchema).max(100),
}).refine(cue => cue.end > cue.start, 'Cue must end after it starts');
export const clipSchema = z.object({
  id: z.string().uuid(), name: z.string().max(200), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(), height: z.number().int().positive(),
  duration: z.number().positive(), url: z.string().startsWith('/media/'),
  kind: z.enum(['video', 'image']).optional(),
});
export const projectSchema = z.object({
  format: z.literal('aftertake/1'), name: z.string().min(1).max(100),
  clip: clipSchema, prompt: z.string().trim().min(5).max(2000),
  cue: cueSchema, seed: z.number().int().min(0).max(2 ** 32 - 1),
  quality: z.enum(['draft', 'final']), trimStart: z.number().min(0).max(3600),
  pipeline: z.enum(['structure', 'inpaint', 'cinema']).optional(),
  cinema: cinemaSchema.optional(),
  directionStrength: z.number().min(1).max(4).optional(),
});
export const recipeSchema = projectSchema
  .refine(recipe => recipe.pipeline === 'cinema' || recipe.cue.strokes.some(stroke => stroke.mode !== 'erase'),
    { message: 'Paint at least one region before rendering.', path: ['cue', 'strokes'] })
  .refine(recipe => recipe.clip.kind !== 'image' || (recipe.pipeline === 'cinema' && recipe.trimStart === 0),
    { message: 'Use Animate a frame for still images, with the reference time set to zero.', path: ['pipeline'] });
export type Recipe = z.infer<typeof projectSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Render = {
  id: string; recipe: Recipe; state: string; progress: number | null;
  createdAt: string; updatedAt: string; jobId?: string; error?: string;
  output?: string; rawOutput?: string; workflow?: Record<string, unknown>;
  coarseOutput?: string;
  stage?: string;
};
export type Engine = { connected: boolean; ready: boolean; gpu?: string; missing: string[]; message: string };

export function renderSettingsKey(r: Recipe) {
  if (r.pipeline === 'cinema') {
    const look = r.cinema || defaultCinema;
    return JSON.stringify([r.clip.sha256, r.prompt.trim(), r.seed, r.quality, r.trimStart, 'cinema',
      look.movement, look.lens, look.lighting, look.palette]);
  }
  const c = r.cue;
  return JSON.stringify([r.clip.sha256, r.prompt.trim(), c.start, c.end, c.fade, c.feather,
    c.tracking || 'static', c.anchor || 0,
    c.strokes.map(s => [s.mode || 'paint', s.radius, s.points.map(p => [p.x, p.y])]),
    r.seed, r.quality, r.trimStart, r.pipeline || 'structure', r.directionStrength || 1, null]);
}

export function renderDimensions(recipe: Recipe) {
  const fps = recipe.quality === 'draft' ? 16 : 24;
  const maxFrames = recipe.quality === 'draft' ? 49 : 97;
  const remaining = recipe.clip.duration - recipe.trimStart;
  if (remaining < (recipe.pipeline === 'cinema' ? 0.04 : 0.6)) throw new Error('The selected source range is too short.');
  const frames = recipe.pipeline === 'cinema' ? maxFrames : Math.min(maxFrames, Math.floor((remaining * fps - 1) / 8) * 8 + 1);
  const longEdge = recipe.quality === 'draft' ? 512 : 768;
  const ratio = recipe.clip.width / recipe.clip.height;
  const width = Math.max(64, Math.round((ratio >= 1 ? longEdge : longEdge * ratio) / 32) * 32);
  const height = Math.max(64, Math.round((ratio >= 1 ? longEdge / ratio : longEdge) / 32) * 32);
  return { width, height, frames, fps, duration: frames / fps };
}

export const presets = [
  { id: 'overgrowth', name: 'Reclaimed', tag: 'NATURE TAKES OVER', color: '#b3c890', prompt: 'Cinematic live-action shot. The architecture is covered in lush climbing vines, delicate ferns and dense emerald moss. Small leaves sway naturally. Warm sunlight filters through floating pollen and fine atmospheric haze. Realistic materials, coherent perspective, rich organic detail. One continuous shot.' },
  { id: 'molten', name: 'Molten', tag: 'MATTER IN MOTION', color: '#edac73', prompt: 'Cinematic live-action shot. The surface transforms into glowing molten gold, slow viscous liquid metal flowing over dark volcanic rock. Warm amber light, intricate reflective detail, tiny glowing embers drifting gently. Photorealistic VFX, physically plausible lighting. One continuous shot.' },
  { id: 'crystal', name: 'Glacial', tag: 'A DIFFERENT ELEMENT', color: '#99c9d5', prompt: 'Cinematic live-action shot. Translucent blue ice crystals spread across the architecture, delicate frost patterns glisten in soft cold light. Wisps of fine icy mist drift slowly. Intricate crystalline texture, realistic refraction and natural perspective. One continuous shot.' },
] as const;

const inpaintPrompts: Record<string, string> = {
  overgrowth: 'Thick living emerald moss, delicate green ferns and trailing ivy completely cover the surface. Rich botanical detail, tiny leaves sway gently, realistic natural lighting and coherent perspective.',
  molten: 'Glowing molten gold flows slowly over dark volcanic rock. Intricate reflective liquid metal, warm amber light and tiny drifting embers. Photorealistic materials and physically plausible lighting.',
  crystal: 'Brilliant white frost and translucent blue ice crystals cover the surface. Delicate icicles, intricate crystalline texture, subtle cold mist and realistic winter light.',
};
export function presetPrompt(preset: typeof presets[number], pipeline: Recipe['pipeline']) {
  return pipeline === 'inpaint' ? inpaintPrompts[preset.id] : preset.prompt;
}

export function cueEnvelope(time: number, cue: Cue) {
  if (time < cue.start || time > cue.end) return 0;
  if (cue.fade === 0) return 1;
  const fade = Math.min(cue.fade, (cue.end - cue.start) / 2);
  const x = Math.min(1, (time - cue.start) / fade, (cue.end - time) / fade);
  return x * x * (3 - 2 * x);
}
