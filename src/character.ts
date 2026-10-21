import { z } from 'zod';
import { clipSchema, pointSchema, type Clip } from './domain';
import type { JobTargetBinding } from './job-target.js';

export const characterSelectionSchema = z
  .object({
    format: z.literal('aftertake-character-selection/1'),
    clip: clipSchema,
    trimStart: z.number().min(0).max(3600),
    duration: z.number().min(1).max(15),
    positive: z.array(pointSchema).min(1).max(12),
    negative: z.array(pointSchema).max(12).default([]),
    resolution: z.enum(['480', '768']).optional(),
  })
  .refine((r) => r.clip.kind !== 'image', 'Choose a source video.')
  .refine(
    (r) => r.trimStart + r.duration <= r.clip.duration + 0.001,
    'Keep the selected range inside the source video.',
  );
const faceBoxSchema = z
  .object({
    x: z.number().min(0).max(0.95),
    y: z.number().min(0).max(0.95),
    width: z.number().min(0.05).max(1),
    height: z.number().min(0.05).max(1),
  })
  .refine(
    (b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001,
    'Keep the face focus inside the photo.',
  );
export type CharacterFaceBox = z.infer<typeof faceBoxSchema>;
export const characterMaxIdentityReferences = 7;
const imageReferenceSchema = clipSchema.extend({ kind: z.literal('image') });
function faceAspect(reference: Clip, box?: CharacterFaceBox) {
  return ((box?.width ?? 1) * reference.width) / ((box?.height ?? 1) * reference.height);
}
const identityReferenceSchema = z
  .object({ reference: imageReferenceSchema, faceBox: faceBoxSchema.optional() })
  .refine(
    (r) => faceAspect(r.reference, r.faceBox) >= 0.5 && faceAspect(r.reference, r.faceBox) <= 2,
    'Crop the supporting photo to include the full head in a roughly square face focus.',
  );
export type CharacterIdentityReference = z.infer<typeof identityReferenceSchema>;
export const characterRequestSchema = z
  .object({
    format: z.literal('aftertake-character/1'),
    name: z.string().trim().min(1).max(100),
    selectionId: z.string().uuid(),
    reference: imageReferenceSchema,
    faceBox: faceBoxSchema.optional(),
    identityReferences: z
      .array(identityReferenceSchema)
      .max(characterMaxIdentityReferences)
      .optional(),
    prompt: z.string().trim().max(2000),
    wardrobe: z.enum(['reference', 'source']).optional(),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
  })
  .refine(
    (r) =>
      !r.faceBox ||
      (faceAspect(r.reference, r.faceBox) >= 0.5 && faceAspect(r.reference, r.faceBox) <= 2),
    'Include the full head in a roughly square face focus.',
  )
  .superRefine((r, context) => {
    const ids = new Set([r.reference.id]),
      hashes = new Set([r.reference.sha256]);
    for (const [index, identity] of (r.identityReferences ?? []).entries()) {
      if (ids.has(identity.reference.id) || hashes.has(identity.reference.sha256))
        context.addIssue({
          code: 'custom',
          path: ['identityReferences', index, 'reference'],
          message: 'Choose a different original photo for each supporting identity reference.',
        });
      ids.add(identity.reference.id);
      hashes.add(identity.reference.sha256);
    }
  });
export type CharacterSelectionRequest = z.infer<typeof characterSelectionSchema>;
export type CharacterRequest = z.infer<typeof characterRequestSchema>;
export const characterSelectionInfoSchema = z
  .object({
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    frames: z.number().int().min(24).max(360),
    fps: z.literal(24),
    emptyFrames: z.array(z.number().int().nonnegative()).max(360),
    maskSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .refine(
    (s) => s.width % 32 === 0 && s.height % 32 === 0 && s.width * s.height <= 1000000,
    'Unexpected character canvas.',
  );
export type CharacterSelectionInfo = z.infer<typeof characterSelectionInfoSchema>;
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** How a repaired selection differs from the tracked one it came from; repair only adds pixels. */
export const characterRepairSchema = z.object({
  from: z.string().uuid(),
  originalMaskSha256: shaSchema,
  processor: z.literal('aftertake-mask-repair/1'),
  maxGap: z.number().int().positive(),
  flicker: z.number().int().positive(),
  framesRecovered: z.array(z.number().int().nonnegative()).max(360),
  recoveredPixels: z.number().int().nonnegative(),
  restoredPixels: z.number().int().nonnegative(),
});
export type CharacterRepair = z.infer<typeof characterRepairSchema>;
export type CharacterJob = {
  jobTarget?: JobTargetBinding;
  id: string;
  kind: 'selection' | 'replacement';
  request: CharacterSelectionRequest | CharacterRequest;
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
  selection?: CharacterSelectionInfo;
  repair?: CharacterRepair;
  clip?: Clip;
};
export const characterTerminal = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
  'output_error',
]);
export const characterBusy = (job: CharacterJob) => !characterTerminal.has(job.state);
/**
 * The replacements that made this take, oldest first. Each pass composites only
 * inside its own mask, so tracking the next person in a finished take swaps
 * several people in one shot.
 */
export function characterChain(job: CharacterJob, jobs: CharacterJob[]) {
  const chain: CharacterJob[] = [];
  const earlier = (take: CharacterJob) => {
    const selectionId = (take.request as CharacterRequest).selectionId,
      selection = jobs.find((item) => item.id === selectionId && item.kind === 'selection'),
      source = (selection?.request as CharacterSelectionRequest | undefined)?.clip;
    return source
      ? jobs.find(
          (item) =>
            item.kind === 'replacement' &&
            item.state === 'succeeded' &&
            item.clip?.sha256 === source.sha256,
        )
      : undefined;
  };
  for (
    let take: CharacterJob | undefined = job;
    take?.kind === 'replacement';
    take = earlier(take)
  ) {
    if (chain.includes(take)) break;
    chain.unshift(take);
  }
  return chain;
}
export function characterCanvasLimit(r: Pick<CharacterSelectionRequest, 'resolution'>) {
  return r.resolution === '768' ? 1000000 : 500000;
}
export function parseCharacterSelectionInfo(value: unknown, request: CharacterSelectionRequest) {
  const info = characterSelectionInfoSchema.parse(value);
  if (info.width * info.height > characterCanvasLimit(request))
    throw Error('The selection canvas exceeds the requested working resolution.');
  return info;
}
export function characterSelectionKey(r: CharacterSelectionRequest) {
  const key: unknown[] = [
    r.clip.sha256,
    r.trimStart,
    r.duration,
    r.positive.map((p) => [p.x, p.y]),
    r.negative.map((p) => [p.x, p.y]),
  ];
  if (r.resolution === '768') key.push('768');
  return JSON.stringify(key);
}
export function characterPrompt(r: CharacterRequest) {
  return [
    `Replace ONLY the selected person in <Video 1> with the person in <Picture 1>.`,
    r.faceBox
      ? "<Picture 1> is the original character photo. <Picture 2> is an unmodified crop of the SAME person's head. Use its close facial detail to preserve identity."
      : '',
    r.identityReferences?.length
      ? `${r.identityReferences.map((_, index) => `<Picture ${index + (r.faceBox ? 3 : 2)}>`).join(', ')} ${r.identityReferences.length === 1 ? 'is an additional unmodified identity reference' : 'are additional unmodified identity references'} of the SAME person shown in <Picture 1>${r.faceBox ? ' and <Picture 2>' : ''}. Use consistent facial proportions, hair and skin details from these supporting photos for identity only. Do not copy their clothing, backgrounds, poses or lighting. They are not additional characters. <Picture 1> remains the clothing reference when replacing the source outfit.`
      : '',
    `Preserve the reference person's facial identity, facial proportions, hair and skin. Follow the source performance's pose, gaze, expression, hand gestures and movement.`,
    r.wardrobe === 'source'
      ? "Keep the source outfit from <Video 1>, while replacing the person's identity, face, hair and skin."
      : 'Replace the source outfit with the clothing shown in <Picture 1>, over the whole visible body including the sleeves. Dress the replacement character in that reference outfit. Do not retain source clothing when it differs from the reference photo.',
    'Keep every other person, their limbs, props, background, lighting, camera framing and original audio timing. Natural scene integration and clean edges.',
    r.prompt,
  ]
    .filter(Boolean)
    .join('\n\n');
}
