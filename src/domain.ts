import { z } from 'zod';

export const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const strokeSchema = z.object({ points: z.array(pointSchema).min(1).max(300), radius: z.number().min(0.005).max(0.5) });
export const cueSchema = z.object({
  start: z.number().min(0).max(12), end: z.number().positive().max(12),
  fade: z.number().min(0).max(2), feather: z.number().min(0.001).max(0.2),
  tracking: z.enum(['static', 'flow']).optional(), anchor: z.number().min(0).max(12).optional(),
  strokes: z.array(strokeSchema).min(1).max(100),
}).refine(cue => cue.end > cue.start, 'Cue must end after it starts');
export const clipSchema = z.object({
  id: z.string().uuid(), name: z.string().max(200), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(), height: z.number().int().positive(),
  duration: z.number().positive(), url: z.string().startsWith('/media/'),
});
export const recipeSchema = z.object({
  format: z.literal('aftertake/1'), name: z.string().min(1).max(100),
  clip: clipSchema, prompt: z.string().trim().min(5).max(2000),
  cue: cueSchema, seed: z.number().int().min(0).max(2 ** 32 - 1),
  quality: z.enum(['draft', 'final']), trimStart: z.number().min(0).max(3600),
  pipeline: z.enum(['structure', 'inpaint']).optional(),
});
export type Recipe = z.infer<typeof recipeSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Render = {
  id: string; recipe: Recipe; state: string; progress: number | null;
  createdAt: string; updatedAt: string; jobId?: string; error?: string;
  output?: string; rawOutput?: string; workflow?: Record<string, unknown>;
  stage?: string;
};
export type Engine = { connected: boolean; ready: boolean; gpu?: string; missing: string[]; message: string };

export function renderDimensions(recipe: Recipe) {
  const fps = recipe.quality === 'draft' ? 16 : 24;
  const maxFrames = recipe.quality === 'draft' ? 49 : 97;
  const remaining = recipe.clip.duration - recipe.trimStart;
  if (remaining < 0.6) throw new Error('The selected source range is too short.');
  const frames = Math.min(maxFrames, Math.floor((remaining * fps - 1) / 8) * 8 + 1);
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

export function cueEnvelope(time: number, cue: Cue) {
  if (time < cue.start || time > cue.end) return 0;
  if (cue.fade === 0) return 1;
  const fade = Math.min(cue.fade, (cue.end - cue.start) / 2);
  const x = Math.min(1, (time - cue.start) / fade, (cue.end - time) / fade);
  return x * x * (3 - 2 * x);
}
