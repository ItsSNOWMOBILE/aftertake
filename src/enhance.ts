import { z } from 'zod';
import { clipSchema, type Clip } from './domain';
import type { JobTargetBinding } from './job-target.js';

/** Aftertake keeps every clip on a 24 fps clock; the loader resamples to it. */
export const enhanceFps = 24;
/** The engine's clip loader takes up to 257 frames, so a clip may run 10.7 seconds. */
export const enhanceMaxFrames = 257;
export const enhanceMaxSeconds = enhanceMaxFrames / enhanceFps;

const videoClipSchema = clipSchema
  .extend({ kind: z.literal('video') })
  .refine(
    (clip) => clip.width % 2 === 0 && clip.height % 2 === 0,
    'Use a clip with even dimensions.',
  )
  .refine(
    (clip) => clip.duration <= enhanceMaxSeconds + 0.001,
    `Trim the clip to ${Math.floor(enhanceMaxSeconds)} seconds or less before enhancing it.`,
  );
const name = z.string().trim().min(1).max(100);
const seed = z
  .number()
  .int()
  .min(0)
  .max(2 ** 32 - 1);

export const upscaleRequestSchema = z.object({
  format: z.literal('aftertake-enhance/1'),
  operation: z.literal('upscale'),
  name,
  clip: videoClipSchema.refine(
    (clip) => Math.max(clip.width, clip.height) <= 1280,
    'Upscale clips up to 1280 pixels on the long side; the result doubles both sides.',
  ),
  seed,
});
export const interpolateRequestSchema = z
  .object({
    format: z.literal('aftertake-enhance/1'),
    operation: z.literal('interpolate'),
    name,
    clip: videoClipSchema,
    multiplier: z.union([z.literal(2), z.literal(4)]),
    timing: z.enum(['smooth', 'slow-motion']),
  })
  .refine(
    (request) => request.timing === 'slow-motion' || request.multiplier === 2,
    'Smooth motion doubles the frame rate to 48 fps; use slow motion for four times the frames.',
  );
export const enhanceRequestSchema = z.union([upscaleRequestSchema, interpolateRequestSchema]);
export type EnhanceRequest = z.infer<typeof enhanceRequestSchema>;

export const songKeys = [
  'C',
  'C#',
  'Db',
  'D',
  'D#',
  'Eb',
  'E',
  'F',
  'F#',
  'Gb',
  'G',
  'G#',
  'Ab',
  'A',
  'A#',
  'Bb',
  'B',
].flatMap((root) => [`${root} major`, `${root} minor`]);
export const songRequestSchema = z.object({
  format: z.literal('aftertake-song/1'),
  name,
  /** Genre, instruments, mood and voice, as ACE-Step's style tags. */
  tags: z.string().trim().min(3).max(1000),
  /** Section markers like [Verse] and [Chorus] are understood; empty means instrumental. */
  lyrics: z.string().trim().max(4000),
  seconds: z.number().min(10).max(240),
  bpm: z.number().int().min(40).max(220),
  keyscale: z.enum(songKeys as [string, ...string[]]),
  timesignature: z.enum(['2', '3', '4', '6']),
  language: z.string().regex(/^[a-z]{2,3}$/),
  seed,
});
export type SongRequest = z.infer<typeof songRequestSchema>;

export type Enhancement = {
  jobTarget?: JobTargetBinding;
  id: string;
  request: EnhanceRequest | SongRequest;
  state: string;
  progress: number | null;
  stage?: string;
  error?: string;
  jobId?: string;
  requestKey?: string;
  requestDigest?: string;
  createdAt: string;
  updatedAt: string;
  workflow: Record<string, any>;
  /** The enhanced video, added to the studio's clips. */
  clip?: Clip;
  /** The song, served from /api/enhancements/:id/audio. */
  audio?: { sha256: string; duration: number; bytes: number };
};
export const enhancementTerminal = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
  'output_error',
]);
export const enhancementBusy = (job: Enhancement) => !enhancementTerminal.has(job.state);

/** How many frames the loader reads from the clip at the 24 fps clock. */
export function enhanceSourceFrames(clip: Pick<Clip, 'duration'>) {
  return Math.min(enhanceMaxFrames, Math.max(2, Math.floor(clip.duration * enhanceFps + 1e-6)));
}

/** What the result will be, for the UI and for checking the downloaded file. */
export function enhanceOutput(request: EnhanceRequest) {
  const frames = enhanceSourceFrames(request.clip);
  if (request.operation === 'upscale')
    return {
      width: request.clip.width * 2,
      height: request.clip.height * 2,
      frames,
      fps: enhanceFps,
      sound: Boolean(request.clip.hasAudio),
    };
  const out = (frames - 1) * request.multiplier + 1,
    fps = request.timing === 'smooth' ? enhanceFps * request.multiplier : enhanceFps;
  return {
    width: request.clip.width,
    height: request.clip.height,
    frames: out,
    fps,
    // Slowed-down sound would not match the picture, so slow motion is silent.
    sound: request.timing === 'smooth' && Boolean(request.clip.hasAudio),
  };
}

export function describeEnhancement(request: EnhanceRequest | SongRequest) {
  if (request.format === 'aftertake-song/1')
    return `Song · ${Math.round(request.seconds)} s · ${request.bpm} BPM · ${request.keyscale}`;
  const output = enhanceOutput(request);
  if (request.operation === 'upscale') return `Upscaled ×2 · ${output.width} × ${output.height}`;
  return request.timing === 'smooth'
    ? `Smooth motion · ${output.fps} fps`
    : `Slow motion ×${request.multiplier} · ${(output.frames / output.fps).toFixed(1)} s`;
}
