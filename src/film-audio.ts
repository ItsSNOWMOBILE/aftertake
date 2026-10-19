import { z } from 'zod';

export const audioFadeFields = {
  fadeIn: z.number().min(0).max(10).optional(),
  fadeOut: z.number().min(0).max(10).optional(),
};

export type AudioEnvelopeTrack = {
  sourceStart: number;
  sourceEnd: number;
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
};

export function audioFadesFitTrack(track: AudioEnvelopeTrack): boolean {
  const duration = track.sourceEnd - track.sourceStart;
  // A decimal trim can subtract to a few ulps below its authored duration.
  return (track.fadeIn ?? 0) <= duration + 1e-9 && (track.fadeOut ?? 0) <= duration + 1e-9;
}

/** Gain at elapsed seconds from this track's start, after its source trim. */
export function audioGain(track: AudioEnvelopeTrack, elapsed: number): number {
  const duration = track.sourceEnd - track.sourceStart;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= duration) return 0;
  const fadeIn = track.fadeIn ?? 0;
  const fadeOut = track.fadeOut ?? 0;
  const arrival = fadeIn > 0 ? Math.min(1, elapsed / fadeIn) : 1;
  const departure = fadeOut > 0 ? Math.min(1, (duration - elapsed) / fadeOut) : 1;
  return track.volume * arrival * departure;
}
