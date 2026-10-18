import { z } from 'zod';
import {
  filmShotSchema,
  narrationSchema,
  filmRenderRevision,
  filmTimeline,
  type FilmDraft,
  type Film,
  type FilmAsset,
} from './film';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const narratedSettingsSchema = z.object({
  voice: narrationSchema.shape.voice.default('af_heart'),
  speed: narrationSchema.shape.speed.default(1.05),
  look: z.enum(['captions', 'bold', 'spoken']).default('bold'),
  pace: z.enum(['quick', 'relaxed']).default('quick'),
  dissolve: z.number().min(0).max(0.25).default(0.125),
});
export const narratedSourcesSchema = z.object({ shots: z.array(filmShotSchema).min(1).max(16) });
export const narratedCutSchema = z.object({
  name: z.string().trim().min(1).max(100),
  aspect: z.enum(['landscape', 'portrait', 'square']),
  look: z.enum(['captions', 'bold', 'spoken']).default('captions'),
  dissolve: z.number().min(0).max(0.25).default(0.125),
  pace: z.enum(['quick', 'relaxed']).default('quick'),
  beats: z
    .array(
      z.object({
        shot: filmShotSchema,
        pictureSHA256: sha256,
        text: z.string().trim().min(1).max(240),
        voice: z.object({ assetId: z.string().uuid(), sha256 }),
      }),
    )
    .min(1)
    .max(16),
});
export type NarratedCutInput = z.infer<typeof narratedCutSchema>;
export type NarratedCut = {
  identity: string;
  draft: FilmDraft;
  manifest: unknown;
  duration: number;
  ledger: {
    name: string;
    start: number;
    end: number;
    voiceStart?: number;
    voiceEnd?: number;
    spokenText?: string;
    caption: string;
    shotNumbers: number[];
  }[];
};

/** Reordering different pictures keeps the written line attached to its media. */
export function narratedRowKeys(shots: FilmDraft['shots']) {
  const count = new Map<string, number>();
  return shots.map((shot) => {
    const media = shot.assetId || shot.renderId!,
      at = count.get(media) || 0;
    count.set(media, at + 1);
    return `${media}:${at}`;
  });
}

/** Recover authored copy only when complete, uniform voices map unambiguously to the pictures. */
export function narrationFromFilm(draft: FilmDraft, assets: FilmAsset[]) {
  if (!draft.shots.length || draft.shots.length > 16 || draft.audio?.length !== draft.shots.length)
    return null;
  const timeline = filmTimeline(draft.shots),
    tracks = draft.audio,
    voices: FilmAsset[] = [];
  for (const cut of timeline) {
    const paired = tracks.filter((track) => Math.abs(track.start - cut.start - 0.125) < 1 / 48);
    if (paired.length !== 1) return null;
    const track = paired[0],
      asset = assets.find((asset) => asset.id === track.assetId && asset.kind === 'audio');
    if (
      !asset?.narration ||
      track.sourceStart !== 0 ||
      Math.abs(track.sourceEnd - asset.duration) > 0.001 ||
      asset.narration.text.length > 240
    )
      return null;
    voices.push(asset);
  }
  const first = voices[0].narration!;
  if (
    voices.some(
      (asset) => asset.narration!.voice !== first.voice || asset.narration!.speed !== first.speed,
    )
  )
    return null;
  const titles = timeline.map((cut) =>
    draft.titles?.find((title) => Math.abs(title.start - cut.start - 0.125) < 1 / 48),
  );
  const look = titles.every((title) => title?.animation === 'spoken')
    ? 'spoken'
    : titles.some((title) => title?.animation === 'impact')
      ? 'bold'
      : 'captions';
  const relaxed = timeline.every(
    (cut, index) =>
      Math.abs(cut.duration - Math.ceil((0.125 + voices[index].duration + 0.5) * 24) / 24) < 1e-6,
  );
  const transitions = draft.shots.slice(1).map((shot) => shot.dissolve || 0),
    uniform = transitions.every((value) => value === transitions[0]);
  return {
    lines: voices.map((asset) => asset.narration!.text),
    settings: narratedSettingsSchema.parse({
      voice: first.voice,
      speed: first.speed,
      look,
      pace: relaxed ? 'relaxed' : 'quick',
      dissolve:
        uniform && [0, 0.125, 0.25].includes(transitions[0] ?? 0) ? transitions[0] || 0 : 0.125,
    }),
  };
}

/** Stable serialization is shared with native export admission. */
export function canonicalJSON(value: unknown): string {
  function sorted(item: any): any {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .filter((key) => item[key] !== undefined)
          .map((key) => [key, sorted(item[key])]),
      );
    return item;
  }
  return JSON.stringify(sorted(value));
}
export async function filmExportKey(draft: FilmDraft, revision = filmRenderRevision) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJSON(draft)),
  );
  return (
    `film-r${revision}-` +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}
export function exportAttemptKey(base: string, films: Pick<Film, 'state' | 'requestKey'>[]) {
  const prior = films
    .flatMap((film) => {
      if (film.requestKey === base) return [{ film, attempt: 0 }];
      const suffix = film.requestKey?.startsWith(base + '-retry-')
        ? film.requestKey.slice(base.length + 7)
        : '';
      return /^\d+$/.test(suffix) ? [{ film, attempt: Number(suffix) }] : [];
    })
    .sort((a, b) => b.attempt - a.attempt)[0];
  const attempt = prior ? prior.attempt + (prior.film.state === 'failed' ? 1 : 0) : 0;
  return attempt ? `${base}-retry-${attempt}` : base;
}
