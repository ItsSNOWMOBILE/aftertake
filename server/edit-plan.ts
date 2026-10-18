import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  filmShotSchema,
  filmTimeline,
  filmRequestSchema,
  filmRenderRevision,
  voiceWordTimingSchema,
  portableVoiceSource,
  type FilmAsset,
  type FilmDraft,
} from '../src/film.js';
import { canonicalJSON } from '../src/narrated-cut.js';
import { speechPhrases } from '../src/title-motion.js';

export function contentDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJSON(value)).digest('hex');
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const editPlanSchema = z.object({
  name: z.string().trim().min(1).max(100),
  aspect: z.enum(['landscape', 'portrait', 'square']),
  brief: z.string().max(2000).optional(),
  sourceVolume: z.number().min(0).max(1).default(0),
  normalizeAudio: z.boolean().default(true),
  beats: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        purpose: z.string().max(300).optional(),
        visuals: z
          .array(filmShotSchema.safeExtend({ sha256: hash }))
          .min(1)
          .max(12),
        voice: z.object({ assetId: z.string().uuid(), sha256: hash }).optional(),
        voiceLead: z.number().min(0).max(5).default(0.12),
        tail: z.number().min(0.08).max(5).default(0.12),
        caption: z.string().trim().max(240).optional(),
        animation: z
          .enum(['fade', 'rise', 'none', 'build', 'typewriter', 'impact', 'wipe', 'spoken'])
          .default('fade'),
        style: z.enum(['headline', 'caption', 'kicker']).optional(),
        position: z.enum(['top', 'center', 'bottom']).optional(),
        captionTail: z.number().min(0).max(5).optional(),
        fontSize: z.number().min(16).max(180).default(48),
        color: z
          .string()
          .regex(/^#[a-fA-F0-9]{6}$/)
          .default('#ffffff'),
      }),
    )
    .min(1)
    .max(32),
});
export type EditPlan = z.infer<typeof editPlanSchema>;
export type PlanPicture = { id: string; kind: 'video' | 'image'; sha256: string; duration: number };

export function compileEditPlan(
  input: unknown,
  pictures: Map<string, PlanPicture>,
  voices: Map<string, FilmAsset>,
) {
  const plan = editPlanSchema.parse(input);
  const shots = plan.beats.flatMap((beat) =>
    beat.visuals.map((shot) => {
      const media = pictures.get(shot.assetId || shot.renderId!);
      if (!media || media.sha256 !== shot.sha256)
        throw Error(
          `Missing or changed picture in "${beat.name}". Inspect workspace assets again.`,
        );
      if (Math.round(shot.end * 24) > Math.floor((media.duration + 0.001) * 24))
        throw Error(
          `Picture trim exceeds its source in "${beat.name}". Choose more footage; do not loop or stretch it to fit narration.`,
        );
      const { sha256: _hash, ...cut } = shot;
      return cut;
    }),
  );
  if (shots.length > 48) throw Error('Use at most 48 picture cuts across the edit.');
  const timeline = filmTimeline(shots),
    audio: NonNullable<FilmDraft['audio']> = [],
    titles: NonNullable<FilmDraft['titles']> = [];
  const ledger: {
    name: string;
    start: number;
    end: number;
    voiceStart?: number;
    voiceEnd?: number;
    spokenText?: string;
    caption: string;
    purpose?: string;
    shotNumbers: number[];
  }[] = [];
  let offset = 0;
  for (const beat of plan.beats) {
    const start = timeline[offset].start,
      end = timeline[offset + beat.visuals.length - 1].end;
    const voice = beat.voice ? voices.get(beat.voice.assetId) : undefined;
    if (beat.voice && (!voice || voice.kind !== 'audio' || voice.sha256 !== beat.voice.sha256))
      throw Error(`Missing or changed voice in "${beat.name}".`);
    const voiceStart = voice ? start + beat.voiceLead : undefined,
      voiceEnd = voice ? voiceStart! + voice.duration : undefined;
    if (voiceEnd !== undefined && voiceEnd > end - beat.tail + 1e-6)
      throw Error(
        `"${beat.name}" needs ${Math.ceil((beat.voiceLead + voice!.duration + beat.tail) * 24) / 24}s of picture; it has ${(end - start).toFixed(3)}s. Extend the picture or regenerate a shorter line. The voice will not be truncated.`,
      );
    if (voice)
      audio.push({
        assetId: voice.id,
        start: voiceStart!,
        sourceStart: 0,
        sourceEnd: voice.duration,
        volume: 1,
      });
    const caption = beat.caption ?? voice?.narration?.text ?? '';
    if (caption.length > 240)
      throw Error(`The narration for "${beat.name}" needs a shorter caption or smaller beats.`);
    let words;
    if (beat.animation === 'spoken') {
      const timing = voiceWordTimingSchema.safeParse(voice?.narration?.wordTiming);
      if (
        !timing.success ||
        !voice ||
        timing.data.words.map((word) => word.text).join(' ') !== caption.replace(/\s+/g, ' ') ||
        timing.data.words.at(-1)!.end > voice.duration + 0.001
      )
        throw Error(
          `"${beat.name}" needs usable word timings from this exact voice. Prepare it with Follow voice, or choose clean captions. ${voice?.narration?.wordTimingError || ''}`.trim(),
        );
      words = speechPhrases(timing.data.words);
    }
    if (caption)
      titles.push({
        id: randomUUID(),
        text: caption,
        start: voiceStart ?? start + Math.min(0.12, (end - start) / 8),
        end:
          voiceEnd !== undefined && beat.captionTail !== undefined
            ? Math.min(end - 0.08, voiceEnd + beat.captionTail)
            : end - 0.08,
        style: beat.style || 'caption',
        position: beat.position || 'bottom',
        animation: beat.animation,
        fontSize: beat.fontSize,
        color: beat.color,
        ...(words ? { words } : {}),
      });
    ledger.push({
      name: beat.name,
      start,
      end,
      voiceStart,
      voiceEnd,
      spokenText: voice?.narration?.text,
      caption,
      purpose: beat.purpose,
      shotNumbers: beat.visuals.map((_, index) => offset + index + 1),
    });
    offset += beat.visuals.length;
  }
  for (let index = 1; index < audio.length; index++) {
    const previous = audio[index - 1];
    if (audio[index].start < previous.start + previous.sourceEnd + 0.08 - 1e-6)
      throw Error(
        'Narration overlaps across a dissolve. Shorten the transition or leave more picture after the previous line.',
      );
  }
  const draft = filmRequestSchema.parse({
    name: plan.name,
    aspect: plan.aspect,
    shots,
    titles,
    audio,
    sourceVolume: plan.sourceVolume,
    normalizeAudio: plan.normalizeAudio,
  });
  const titleIds = new Map(titles.map((title, index) => [title.id, index]));
  // The plan identity excludes freshly allocated layer UUIDs; saving the same
  // reviewed inputs must find the same durable plan and export key.
  const identity = contentDigest({
    rendererRevision: filmRenderRevision,
    plan,
    draft: { ...draft, titles: titles.map((title) => ({ ...title, id: titleIds.get(title.id) })) },
  });
  const manifest = {
    format: 'aftertake-film/2',
    ...draft,
    shots: shots.map((shot, index) => ({
      ...shot,
      sha256: plan.beats.flatMap((beat) => beat.visuals)[index].sha256,
    })),
    audio: audio.map((track) => {
      const voice = voices.get(track.assetId)!;
      return {
        ...track,
        sha256: voice.sha256,
        ...(voice.narration ? { asset: portableVoiceSource(voice) } : {}),
      };
    }),
  };
  return { identity, plan, draft, manifest, ledger, duration: timeline.at(-1)!.end };
}
