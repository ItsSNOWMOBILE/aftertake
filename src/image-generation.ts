import { z } from 'zod';
import type { Clip } from './domain';
import type { JobTargetBinding } from './job-target.js';

export const imageDirectionOptions = {
  shot: [
    ['none', 'From your prompt'],
    ['wide', 'Wide establishing shot'],
    ['medium', 'Medium shot'],
    ['close', 'Close-up'],
    ['low', 'Low angle'],
    ['overhead', 'Overhead'],
  ],
  lens: [
    ['none', 'From your prompt'],
    ['wide', 'Wide lens · deep focus'],
    ['normal', '35 mm · natural perspective'],
    ['portrait', '85 mm · soft background'],
  ],
  lighting: [
    ['none', 'From your prompt'],
    ['soft', 'Soft window light'],
    ['golden', 'Golden-hour backlight'],
    ['hard', 'Hard sunlight'],
    ['blue', 'Blue-hour practical light'],
  ],
} as const;
export const imageDirectionDefaults = { shot: 'none', lens: 'none', lighting: 'none' } as const;
const directionSchema = z.object({
  shot: z.enum(['none', 'wide', 'medium', 'close', 'low', 'overhead']),
  lens: z.enum(['none', 'wide', 'normal', 'portrait']),
  lighting: z.enum(['none', 'soft', 'golden', 'hard', 'blue']),
});
export const imageRequestSchema = z.object({
  format: z.literal('aftertake-image/1'),
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(5).max(2000),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 32 - 1),
  aspect: z.enum(['square', 'landscape', 'portrait']),
  resolution: z.literal('720p').optional(),
  style: z.enum(['none', 'cinematic', 'photo', 'illustration', 'product', 'anime']),
  direction: directionSchema.optional(),
});
export type ImageRequest = z.infer<typeof imageRequestSchema>;
export type ImageGeneration = {
  jobTarget?: JobTargetBinding;
  id: string;
  request: ImageRequest;
  state: string;
  progress: number | null;
  requestKey?: string;
  requestDigest?: string;
  createdAt: string;
  updatedAt: string;
  jobId?: string;
  stage?: string;
  error?: string;
  workflow: Record<string, unknown>;
  clip?: Clip;
};
export const imageTerminal = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
  'output_error',
]);
export const imageBusy = (image: ImageGeneration) => !imageTerminal.has(image.state);
export const imageDimensions = (
  aspect: ImageRequest['aspect'],
  resolution?: ImageRequest['resolution'],
) =>
  resolution === '720p'
    ? ({ square: [720, 720], landscape: [1280, 720], portrait: [720, 1280] } as const)[aspect]
    : ({ square: [1024, 1024], landscape: [1152, 768], portrait: [768, 1152] } as const)[aspect];
const styles: Record<ImageRequest['style'], string> = {
  none: '',
  cinematic:
    'Cinematic composition, dramatic motivated lighting, carefully graded color and fine film texture.',
  photo:
    'Photographic image, natural material detail, believable lighting and coherent perspective.',
  illustration:
    'Expressive hand-drawn illustration with carefully composed shapes, color and linework.',
  product:
    'Premium product photograph with controlled studio lighting, crisp material detail and a clean composition.',
  anime:
    'Detailed anime illustration with expressive clean linework, cel shading and a cohesive color palette.',
};
const directionText = {
  shot: {
    none: '',
    wide: 'Wide establishing composition, showing the subject within its surrounding environment.',
    medium: 'Medium shot, with the subject and immediate surroundings clearly framed.',
    close: 'Close-up composition, concentrating on the subject and small details.',
    low: 'Low camera angle, looking upward toward the subject.',
    overhead: 'Overhead view, looking straight down at the scene.',
  },
  lens: {
    none: '',
    wide: 'Wide-angle lens character with deep focus and a strong sense of space.',
    normal: '35 mm lens character with natural perspective.',
    portrait:
      '85 mm portrait lens character, shallow depth of field and a softly separated background.',
  },
  lighting: {
    none: '',
    soft: 'Soft, directional window light with gentle shadow transitions.',
    golden: 'Warm golden-hour backlight with a natural rim of sunlight.',
    hard: 'Hard direct sunlight with defined, directional shadows.',
    blue: 'Blue-hour ambient light balanced with warm practical lights.',
  },
};
export function imagePrompt(request: ImageRequest) {
  const d = request.direction || imageDirectionDefaults;
  return [
    request.prompt.trim(),
    styles[request.style],
    directionText.shot[d.shot],
    directionText.lens[d.lens],
    directionText.lighting[d.lighting],
  ]
    .filter(Boolean)
    .join('\n\n');
}
