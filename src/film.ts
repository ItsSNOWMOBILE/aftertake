import { z } from 'zod';

// Include this revision in new export identities when renderer behavior changes.
export const filmRenderRevision = 3;
import type { Recipe } from './domain';

export const spokenWordSchema=z.object({text:z.string().min(1).max(240).regex(/^\S+$/),start:z.number().min(0).max(600),end:z.number().positive().max(600)})
  .refine(word=>word.end>word.start,'A spoken word needs an ordered timing interval.');
export const voiceWordTimingSchema=z.object({method:z.literal('kokoro-phoneme-durations/1'),words:z.array(spokenWordSchema).min(1).max(1000)})
  .refine(timing=>timing.words.every((word,index)=>!index||word.start>=timing.words[index-1].end-1e-6),'Spoken words must stay in order without overlap.');
export const titleWordSchema=spokenWordSchema.safeExtend({phrase:z.number().int().min(0).max(239)});

export const filmShotSchema = z.object({ renderId: z.string().uuid().optional(), assetId: z.string().uuid().optional(),
  dissolve: z.number().min(0).max(1).optional(),
  framing: z.object({ zoom: z.number().min(1).max(3), endZoom: z.number().min(1).max(3),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  start: z.number().min(0).max(600), end: z.number().positive().max(600) })
  .refine(shot => !!shot.renderId !== !!shot.assetId, 'Choose one take or imported asset.')
  .refine(shot => !shot.renderId || shot.end <= 12, 'A generated take is at most twelve seconds.')
  .refine(shot => shot.end - shot.start >= .25, 'Each shot needs at least a quarter second.');
export const filmTitleSchema = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(240),
  start: z.number().min(0).max(600), end: z.number().positive().max(600),
  style: z.enum(['headline', 'caption', 'kicker']), position: z.enum(['top', 'center', 'bottom']),
  animation: z.enum(['fade', 'rise', 'none', 'build', 'typewriter', 'impact', 'wipe', 'spoken']),
  words:z.array(titleWordSchema).min(1).max(120).optional(),
  motionDuration: z.number().min(.15).max(4).optional(),
  fontSize: z.number().min(16).max(180).optional(),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/) })
  .refine(title => title.end - title.start >= .25, 'A title needs at least a quarter second.')
  .refine(title=>title.animation!=='spoken'||!!title.words,'Follow voice needs measured word timings.')
  .refine(title=>!title.words||title.words.map(word=>word.text).join(' ')===title.text.replace(/\s+/g,' '),'Changing the words requires new speech timing.')
  .refine(title=>!title.words||title.words.every((word,index)=>word.end<=title.end-title.start+.001&&(!index?word.phrase===0:word.start>=title.words![index-1].end-1e-6&&word.phrase>=title.words![index-1].phrase&&word.phrase<=title.words![index-1].phrase+1)), 'Word timings must fit the title and stay in phrase order.');
export const filmAudioSchema = z.object({ assetId: z.string().uuid(), start: z.number().min(0).max(600),
  sourceStart: z.number().min(0).max(600), sourceEnd: z.number().positive().max(600), volume: z.number().min(0).max(2) })
  .refine(audio => audio.sourceEnd - audio.sourceStart >= .1, 'An audio clip needs a valid trim.');
export const filmDraftSchema = z.object({
  name: z.string().trim().min(1).max(100), aspect: z.enum(['landscape', 'portrait', 'square']),
  shots: z.array(filmShotSchema).max(48), titles: z.array(filmTitleSchema).max(80).optional(),
  audio: z.array(filmAudioSchema).max(32).optional(), sourceVolume: z.number().min(0).max(1).optional(), normalizeAudio: z.boolean().optional(),
});
export const filmRequestSchema = filmDraftSchema.refine(film => film.shots.length > 0, 'Add footage to your film.')
  .refine(film => film.shots.reduce((sum, shot) => sum + shot.end - shot.start, 0) <= 600, 'Keep films under ten minutes.');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const narrationSchema = z.object({ text: z.string().trim().min(1).max(3000),
  voice: z.enum(['af_heart', 'af_sarah', 'am_michael', 'bm_george']), speed: z.number().min(.8).max(1.3), timedWords:z.boolean().optional() });
export const narrationReceiptSchema=narrationSchema.extend({model:z.string().min(1).max(160),modelSha256:sha256,voicesSha256:sha256,
  runner:z.string().min(1).max(200),wordTiming:voiceWordTimingSchema.optional(),wordTimingError:z.string().min(1).max(1000).optional(),wordTimingMapper:z.literal('phoneme-boundaries/2').optional()})
  .refine(receipt=>!receipt.wordTiming||receipt.timedWords===true,'Word timings need a timed voice receipt.')
  .refine(receipt=>!receipt.wordTiming||!receipt.wordTimingError,'A voice receipt cannot contain both timings and a timing error.')
  .refine(receipt=>!receipt.wordTiming||receipt.wordTiming.words.map(word=>word.text).join(' ')===receipt.text.replace(/\s+/g,' '),'Voice word timings must match the saved script.');
export const filmVoiceSourceSchema=z.object({kind:z.literal('audio'),sha256,duration:z.number().positive().max(600),narration:narrationReceiptSchema.optional()})
  .refine(source=>!source.narration?.wordTiming||source.narration.wordTiming.words.at(-1)!.end<=source.duration+.001,'Voice word timings exceed their saved audio.');
export const filmManifestSchema = filmDraftSchema.safeExtend({ format: z.enum(['aftertake-film/1', 'aftertake-film/2']),
  shots: z.array(filmShotSchema.safeExtend({ sha256 })).min(1).max(48),
  audio: z.array(filmAudioSchema.safeExtend({ sha256,asset:filmVoiceSourceSchema.optional() })
    .refine(track=>!track.asset||track.asset.sha256===track.sha256,'Voice receipt and audio track hashes differ.')).max(32).optional() });
export type FilmAsset = { id: string; name: string; kind: 'video' | 'image' | 'audio'; extension: string; url: string;
  sha256: string; duration: number; width?: number; height?: number; createdAt: string;
  narrationOrigin?:'imported'; narration?: z.infer<typeof narrationReceiptSchema> };

/** Keep voice provenance portable without carrying workspace paths or URLs. */
export function portableVoiceSource(asset:FilmAsset){
  return asset.narration?filmVoiceSourceSchema.parse({kind:'audio',sha256:asset.sha256,duration:asset.duration,narration:asset.narration}):undefined;
}
export type FilmDraft = z.infer<typeof filmDraftSchema>;
// A dissolve overlaps the incoming shot with the outgoing tail. Keep a clean
// half of each shot, even after the user shortens or reorders footage.
export function filmTimeline(shots: { start: number; end: number; dissolve?: number }[]) {
  let cursor = 0, previousCount = 0;
  return shots.map((shot, index) => {
    const count = Math.round(shot.end*24)-Math.round(shot.start*24);
    const overlap = index ? Math.min(Math.round((shot.dissolve || 0)*24), Math.floor(count/2), Math.floor(previousCount/2)) : 0;
    const start = cursor-overlap;
    cursor = start+count; previousCount = count;
    return { start:start/24, end:cursor/24, duration:count/24, overlap:overlap/24 };
  });
}
export type Film = {
  id: string; name: string; state: 'assembling' | 'ready' | 'failed'; createdAt: string;
  requestKey?: string; requestDigest?: string;
  aspect: FilmDraft['aspect']; duration: number; error?: string; output?: string;
  shots: (FilmDraft['shots'][number] & { title: string; sha256: string; recipe?: Recipe; asset?: FilmAsset; workflow?: Record<string, unknown> })[];
  titles?: FilmDraft['titles']; sourceVolume?: number; normalizeAudio?: boolean;
  audio?: (NonNullable<FilmDraft['audio']>[number] & { sha256: string; asset: FilmAsset })[];
};
export const filmGeometry = { landscape: [1280, 720], portrait: [720, 1280], square: [720, 720] } as const;
