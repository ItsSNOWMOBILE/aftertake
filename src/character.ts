import {z} from 'zod';
import {clipSchema,pointSchema,type Clip} from './domain';

export const characterSelectionSchema=z.object({
  format:z.literal('aftertake-character-selection/1'),clip:clipSchema,
  trimStart:z.number().min(0).max(3600),duration:z.number().min(1).max(15),
  positive:z.array(pointSchema).min(1).max(12),negative:z.array(pointSchema).max(12).default([]),
}).refine(r=>r.clip.kind!=='image','Choose a source video.')
  .refine(r=>r.trimStart+r.duration<=r.clip.duration+.001,'Keep the selected range inside the source video.');
const faceBoxSchema=z.object({x:z.number().min(0).max(.95),y:z.number().min(0).max(.95),
  width:z.number().min(.05).max(1),height:z.number().min(.05).max(1)})
  .refine(b=>b.x+b.width<=1.000001&&b.y+b.height<=1.000001,'Keep the face focus inside the photo.');
export const characterRequestSchema=z.object({
  format:z.literal('aftertake-character/1'),name:z.string().trim().min(1).max(100),
  selectionId:z.string().uuid(),reference:clipSchema.extend({kind:z.literal('image')}),
  faceBox:faceBoxSchema.optional(),prompt:z.string().trim().max(2000),
  wardrobe:z.enum(['reference','source']).optional(),
  seed:z.number().int().min(0).max(2**32-1),
}).refine(r=>!r.faceBox||((r.faceBox.width*r.reference.width)/(r.faceBox.height*r.reference.height)>=.5&&
  (r.faceBox.width*r.reference.width)/(r.faceBox.height*r.reference.height)<=2),'Include the full head in a roughly square face focus.');
export type CharacterSelectionRequest=z.infer<typeof characterSelectionSchema>;
export type CharacterRequest=z.infer<typeof characterRequestSchema>;
export const characterSelectionInfoSchema=z.object({
  width:z.number().int().positive().max(4096),height:z.number().int().positive().max(4096),
  frames:z.number().int().min(24).max(360),fps:z.literal(24),
  emptyFrames:z.array(z.number().int().nonnegative()).max(360),
  maskSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine(s=>s.width%32===0&&s.height%32===0&&s.width*s.height<=500000,'Unexpected character canvas.');
export type CharacterSelectionInfo=z.infer<typeof characterSelectionInfoSchema>;
export type CharacterJob={
  id:string;kind:'selection'|'replacement';request:CharacterSelectionRequest|CharacterRequest;
  state:string;progress:number|null;stage?:string;error?:string;jobId?:string;
  requestKey?:string;requestDigest?:string;createdAt:string;updatedAt:string;
  workflow:Record<string,any>;selection?:CharacterSelectionInfo;clip?:Clip;
};
export const characterTerminal=new Set(['succeeded','failed','canceled','expired','output_error']);
export const characterBusy=(job:CharacterJob)=>!characterTerminal.has(job.state);
export function characterSelectionKey(r:CharacterSelectionRequest){
  return JSON.stringify([r.clip.sha256,r.trimStart,r.duration,r.positive.map(p=>[p.x,p.y]),r.negative.map(p=>[p.x,p.y])]);
}
export function characterPrompt(r:CharacterRequest){
  return [`Replace ONLY the selected person in <Video 1> with the person in <Picture 1>.`,
    r.faceBox?'<Picture 1> is the original character photo. <Picture 2> is an unmodified crop of the SAME person\'s head. Use its close facial detail to preserve identity.':'',
    `Preserve the reference person's facial identity, facial proportions, hair and skin. Follow the source performance's pose, gaze, expression, hand gestures and movement.`,
    r.wardrobe==='source'?'Keep the source outfit from <Video 1>, while replacing the person\'s identity, face, hair and skin.':
      'Replace the source outfit with the clothing shown in <Picture 1>, over the whole visible body including the sleeves. Dress the replacement character in that reference outfit. Do not retain source clothing when it differs from the reference photo.',
    'Keep every other person, their limbs, props, background, lighting, camera framing and original audio timing. Natural scene integration and clean edges.',r.prompt].filter(Boolean).join('\n\n');
}
