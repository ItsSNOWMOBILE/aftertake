import { z } from 'zod';

export const cinemaSchema = z.object({
  movement: z.enum(['locked', 'push', 'pull', 'pan', 'orbit']),
  lens: z.enum(['natural', 'wide', 'portrait', 'anamorphic']),
  lighting: z.enum(['source', 'daylight', 'tungsten', 'moonlight', 'neon']),
  palette: z.enum(['source', 'warm', 'cool', 'monochrome']),
});
export type Cinema = z.infer<typeof cinemaSchema>;
export const defaultCinema: Cinema = { movement: 'push', lens: 'natural', lighting: 'source', palette: 'source' };
export const cinemaOptions = {
  movement: [['locked', 'Locked camera'], ['push', 'Slow push in'], ['pull', 'Slow pull back'], ['pan', 'Pan left'], ['orbit', 'Gentle orbit']],
  lens: [['natural', 'Natural perspective'], ['wide', 'Wide and expansive'], ['portrait', 'Shallow focus'], ['anamorphic', 'Anamorphic character']],
  lighting: [['source', 'Follow the reference'], ['daylight', 'Soft daylight'], ['tungsten', 'Warm practical light'], ['moonlight', 'Moonlit'], ['neon', 'Neon glow']],
  palette: [['source', 'Follow the reference'], ['warm', 'Warm amber'], ['cool', 'Cool blue'], ['monochrome', 'Black and white']],
} as const;
const language: { [K in keyof Cinema]: Record<Cinema[K], string> } = {
  movement: {
    locked: 'A stationary locked-off shot. The camera does not translate, rotate or zoom. Framing and perspective remain unchanged; any subject motion happens inside this fixed composition.',
    push: 'The camera moves slowly forward in one smooth continuous dolly, gently approaching the subject with visible parallax.',
    pull: 'The camera slowly tracks backward in one steady continuous move, gradually revealing more of the environment.',
    pan: 'A stationary camera rotates slowly to the left with a level horizon and an even, unhurried speed.',
    orbit: 'The camera makes a small smooth arc around the subject at a constant height, keeping the subject near the center.',
  },
  lens: {
    natural: 'Natural perspective, crisp believable detail and moderate depth of field.',
    wide: 'Wide-angle perspective with deep focus and an expansive sense of space.',
    portrait: 'Long-lens character with a gently blurred background, soft bokeh and shallow depth of field.',
    anamorphic: 'Anamorphic lens character, soft oval bokeh, restrained horizontal highlights and gentle edge falloff.',
  },
  lighting: {
    source: 'Lighting direction and exposure remain consistent with the reference frame.',
    daylight: 'Soft diffused daylight, gently modeled shadows and a natural range of brightness.',
    tungsten: 'Warm practical lamps illuminate the scene with amber highlights and rich soft shadows.',
    moonlight: 'Cool moonlight, delicate silvery edges and restrained atmospheric darkness.',
    neon: 'Cyan and magenta practical neon light, reflected color and atmospheric glow.',
  },
  palette: {
    source: 'Keep the reference color relationships coherent throughout the shot.',
    warm: 'A restrained warm amber color grade with soft, earthy shadows.',
    cool: 'A cool blue color grade with quiet neutral highlights.',
    monochrome: 'Black-and-white cinematography with nuanced grayscale and deep tonal separation.',
  },
};
export function cinemaPrompt(prompt: string, settings: Cinema = defaultCinema) {
  return [language.movement[settings.movement], prompt.trim(), 'One continuous cinematic shot, beginning from the supplied reference frame.',
    language.lens[settings.lens],
    language.lighting[settings.lighting], language.palette[settings.palette],
    'The scene remains coherent over time.'].join(' ');
}
export const savedLookSchema = z.object({ name: z.string().trim().min(1).max(40), settings: cinemaSchema });
export type SavedLook = z.infer<typeof savedLookSchema>;
export const cinemaLooks: SavedLook[] = [
  { name: 'Daybreak', settings: { movement: 'push', lens: 'natural', lighting: 'daylight', palette: 'warm' } },
  { name: 'After hours', settings: { movement: 'orbit', lens: 'anamorphic', lighting: 'neon', palette: 'cool' } },
  { name: 'Silver screen', settings: { movement: 'locked', lens: 'portrait', lighting: 'source', palette: 'monochrome' } },
];
