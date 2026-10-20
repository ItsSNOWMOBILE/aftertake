import { z } from 'zod';
import { filmTimeline, type FilmDraft } from './film';

export const beatAnalysisSchema = z.object({
  method: z.literal('spectral-flux-dp/1'),
  tempo: z.number().positive().max(400),
  duration: z.number().positive().max(600),
  beats: z.array(z.number().min(0).max(600)).max(4000),
  downbeats: z.array(z.number().min(0).max(600)).max(1000),
});
export type BeatAnalysis = z.infer<typeof beatAnalysisSchema>;
type Shot = FilmDraft['shots'][number];

const frames = (seconds: number) => Math.round(seconds * 24);

/**
 * Retime shot ends so each cut lands on the beat grid. A transition's midpoint
 * (where flash, glitch and zoom switch pictures) is the point placed on the beat.
 * `grid` holds film-clock seconds; `available` gives each shot's latest source end.
 */
export function snapCutsToBeats(
  shots: Shot[],
  grid: number[],
  available: (shot: Shot, index: number) => number,
) {
  const next = shots.map((shot) => ({ ...shot }));
  const beats = [...grid].sort((a, b) => a - b);
  const misses: number[] = [];
  let previousCut = 0;
  for (let index = 0; index + 1 < next.length; index++) {
    const timeline = filmTimeline(next),
      incoming = timeline[index + 1];
    const cut = incoming.start + incoming.overlap / 2;
    // Each shot keeps at least a quarter second of its own picture.
    const earliest = previousCut + 0.25,
      latestEnd = Math.min(available(next[index], index), 600);
    const room = frames(latestEnd) - frames(next[index].end);
    const shrink = frames(next[index].end) - frames(next[index].start) - 6;
    const choices = beats
      .filter((beat) => beat >= earliest)
      .map((beat) => frames(beat) - frames(cut))
      .filter((delta) => delta <= room && -delta <= shrink);
    if (!choices.length) {
      misses.push(index + 1);
      previousCut = cut;
      continue;
    }
    const delta = choices.reduce((best, value) =>
      Math.abs(value) < Math.abs(best) ? value : best,
    );
    next[index].end = (frames(next[index].end) + delta) / 24;
    const moved = filmTimeline(next)[index + 1];
    previousCut = moved.start + moved.overlap / 2;
  }
  return { shots: next, misses };
}

/** Beat times from an audio clip placed on the film timeline. */
export function filmBeatGrid(
  analysis: BeatAnalysis,
  track: { start: number; sourceStart: number; sourceEnd: number },
  options: { every?: number; downbeats?: boolean } = {},
) {
  const source = options.downbeats ? analysis.downbeats : analysis.beats,
    every = Math.max(1, Math.round(options.every ?? 1));
  return source
    .filter((time) => time >= track.sourceStart && time <= track.sourceEnd)
    .filter((_, index) => index % every === 0)
    .map((time) => track.start + time - track.sourceStart);
}
