import { z } from 'zod';
import { cameraMovements } from './cinema';
import { filmTimeline, type FilmDraft } from './film';
import type { Clip } from './domain';
import type { VideoRequest } from './video-generation';
import type { SongRequest } from './enhance';

/**
 * A storyboard turns one idea into a short film: an editable list of 3–5 shots,
 * each rendered with Create video (LTX-2.5), cut in Film to an ACE-Step song with
 * titles and transitions.
 */
export const storyboardShotSchema = z
  .object({
    prompt: z.string().trim().min(10).max(600),
    movement: z.enum(cameraMovements),
    seconds: z.number().int().min(3).max(5),
  })
  .strict();
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;

export const storyboardPlanRequestSchema = z
  .object({
    idea: z.string().trim().min(10).max(600),
    shots: z.number().int().min(3).max(5),
    /** Another version of the plan for the same idea. */
    variation: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type StoryboardPlanRequest = z.infer<typeof storyboardPlanRequestSchema>;

export const storyboardPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(60),
    /** One line of shared look, added to every shot so the shots match. */
    look: z.string().trim().max(300),
    shots: z.array(storyboardShotSchema).min(3).max(5),
    planner: z.enum(['local-model', 'template']),
    /** Why the template planned it, or the local model's receipt. */
    note: z.string().max(300).optional(),
  })
  .strict();
export type StoryboardPlan = z.infer<typeof storyboardPlanSchema>;

export const storyboardSongStarters = [
  {
    id: 'cinematic',
    label: 'Cinematic',
    tags: 'cinematic orchestral score, warm strings, soft piano, building percussion, hopeful, instrumental',
    bpm: 96,
  },
  {
    id: 'upbeat',
    label: 'Upbeat',
    tags: 'upbeat indie pop, bright guitars, claps, punchy drums, feel-good, instrumental',
    bpm: 118,
  },
  {
    id: 'lofi',
    label: 'Lo-fi',
    tags: 'lo-fi hip hop, dusty drums, mellow electric piano, vinyl crackle, relaxed, instrumental',
    bpm: 84,
  },
  {
    id: 'epic',
    label: 'Epic',
    tags: 'epic trailer music, pounding drums, deep brass hits, rising strings, powerful, instrumental',
    bpm: 100,
  },
  {
    id: 'electronic',
    label: 'Electronic',
    tags: 'sleek electronic house, deep bass, shimmering synths, driving beat, modern, instrumental',
    bpm: 122,
  },
] as const;

export const storyboardRequestSchema = z
  .object({
    idea: z.string().trim().min(10).max(600),
    title: z.string().trim().min(1).max(60),
    look: z.string().trim().max(300),
    aspect: z.enum(['landscape', 'portrait', 'square']),
    shots: z.array(storyboardShotSchema).min(3).max(5),
    song: z
      .object({
        tags: z.string().trim().min(3).max(400),
        bpm: z.number().int().min(60).max(180),
      })
      .strict(),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
  })
  .strict();
export type StoryboardRequest = z.infer<typeof storyboardRequestSchema>;

/** GPU renders a storyboard starts: one video per shot and the song. */
export const storyboardRenders = (request: Pick<StoryboardRequest, 'shots'>) =>
  request.shots.length + 1;

export type StoryboardJob = {
  id: string;
  requestKey?: string;
  requestDigest?: string;
  request: StoryboardRequest;
  state: 'queued' | 'running' | 'ready' | 'failed' | 'canceled';
  stage: string;
  progress: number | null;
  /** One entry per shot: its Create video job and, once done, the clip and Film asset. */
  shots: { videoId?: string; clip?: Clip; assetId?: string }[];
  song?: { enhancementId?: string; assetId?: string; beats?: number[] };
  /** The cut, as an editable Film project. */
  draft?: FilmDraft;
  filmId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
export const storyboardBusy = (job: Pick<StoryboardJob, 'state'>) =>
  job.state === 'queued' || job.state === 'running';

/** The Create video request for one shot, with the shared look added. */
export function storyboardShotRequest(request: StoryboardRequest, index: number): VideoRequest {
  const shot = request.shots[index];
  return {
    format: 'aftertake-text-video/1',
    name: `${request.title} · shot ${index + 1}`.slice(0, 100),
    prompt: [shot.prompt, request.look].filter(Boolean).join(' ').slice(0, 3000),
    seed: (request.seed + index * 7919) % 2 ** 32,
    aspect: request.aspect,
    quality: 'final',
    seconds: shot.seconds,
    sound: false,
    cinema: { movement: shot.movement, lens: 'natural', lighting: 'source', palette: 'source' },
  };
}

const transitions = ['whip', 'dissolve', 'zoom', 'flash'] as const;
/** The song needs to run past the cut so its fade ends inside the music. */
export function storyboardSongSeconds(request: Pick<StoryboardRequest, 'shots'>) {
  return Math.max(10, request.shots.reduce((sum, shot) => sum + shot.seconds, 0) + 4);
}
export function storyboardSongRequest(request: StoryboardRequest): SongRequest {
  return {
    format: 'aftertake-song/1',
    name: `${request.title} · score`.slice(0, 100),
    tags: request.song.tags,
    lyrics: '',
    seconds: storyboardSongSeconds(request),
    bpm: request.song.bpm,
    keyscale: 'C major',
    timesignature: '4',
    language: 'unknown',
    seed: request.seed,
  };
}

const frames = (seconds: number) => Math.round(seconds * 24) / 24;
/**
 * Choose each shot's length so every transition lands on a beat of the song.
 * A cut lands where its overlap is halfway through; each shot keeps at least
 * 1.5 s and never runs past its rendered clip.
 */
export function cutToBeats(
  lengths: { target: number; available: number }[],
  overlaps: number[],
  beats: number[],
) {
  const cuts: number[] = [];
  let start = 0;
  lengths.forEach((shot, index) => {
    const last = index === lengths.length - 1,
      next = last ? 0 : overlaps[index + 1],
      low = start + Math.max(1.5, next),
      high = start + shot.available;
    let end = Math.min(high, start + shot.target);
    if (!last) {
      const wanted = end - next / 2;
      const beat = beats
        .filter((time) => time + next / 2 >= low && time + next / 2 <= high)
        .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0];
      if (beat !== undefined) end = beat + next / 2;
    }
    const length = frames(Math.min(shot.available, Math.max(1.5, end - start)));
    cuts.push(length);
    start += length - next;
  });
  return cuts;
}

export type StoryboardCutInputs = {
  request: StoryboardRequest;
  shots: { assetId: string; duration: number }[];
  song?: { assetId: string; beats: number[] };
  ids: () => string;
};
/** The Film project a storyboard opens as: shots on the beat, titles, transitions and the song. */
export function storyboardFilm(inputs: StoryboardCutInputs): FilmDraft {
  const { request } = inputs,
    overlaps = inputs.shots.map((_, index) => (index ? frames(index % 2 ? 0.33 : 0.5) : 0));
  const lengths = cutToBeats(
    inputs.shots.map((shot, index) => ({
      target: request.shots[index].seconds,
      available: Math.floor(shot.duration * 24) / 24,
    })),
    overlaps,
    inputs.song?.beats || [],
  );
  const shots: FilmDraft['shots'] = inputs.shots.map((shot, index) => ({
    assetId: shot.assetId,
    start: 0,
    end: lengths[index],
    framing: { zoom: 1, endZoom: 1, x: 0.5, y: 0.5, fit: 'cover' },
    ...(index
      ? { dissolve: overlaps[index], transition: transitions[(index - 1) % transitions.length] }
      : {}),
  }));
  const duration = filmTimeline(shots).at(-1)!.end;
  const titles: FilmDraft['titles'] = [
    {
      id: inputs.ids(),
      text: request.title,
      start: 0.4,
      end: Math.min(3.2, lengths[0] - 0.1),
      style: 'headline',
      position: 'center',
      animation: 'reveal',
      font: 'display',
      fontSize: request.aspect === 'portrait' ? 150 : 110,
      color: '#ffffff',
    },
    {
      id: inputs.ids(),
      text: request.title,
      start: Math.max(0, duration - 1.8),
      end: duration,
      style: 'kicker',
      position: 'bottom',
      animation: 'fade',
      font: 'condensed',
      fontSize: request.aspect === 'portrait' ? 64 : 44,
      color: '#ffffff',
    },
  ];
  return {
    name: request.title,
    aspect: request.aspect,
    shots,
    titles,
    ...(inputs.song
      ? {
          audio: [
            {
              assetId: inputs.song.assetId,
              start: 0,
              sourceStart: 0,
              sourceEnd: duration,
              volume: 0.9,
              fadeIn: 0,
              fadeOut: Math.min(1.5, duration / 3),
            },
          ],
        }
      : {}),
    sourceVolume: 0,
    normalizeAudio: true,
  };
}

/** Shot roles for the template planner, from the first shot to the last. */
const roles = {
  open: { text: 'Wide establishing view of the whole setting:', movement: 'drone-reveal' },
  middle: [
    { text: 'Medium shot following the action:', movement: 'truck' },
    { text: 'Close-up on the most telling detail:', movement: 'zoom-in' },
    { text: 'A moving shot around the main subject:', movement: 'arc' },
  ],
  close: { text: 'Final image, the moment the idea lands:', movement: 'pull' },
} as const;
/** A plan without a language model: the idea framed as an opening, a middle and an ending. */
export function templatePlan(request: StoryboardPlanRequest): StoryboardPlan {
  const idea = request.idea.replace(/\s+/g, ' ').replace(/[.!?]*$/, '');
  const middle = roles.middle.slice(0, request.shots - 2);
  const picked = [roles.open, ...middle, roles.close];
  const words = idea.split(' ');
  return {
    title: words
      .slice(0, Math.min(4, words.length))
      .join(' ')
      .replace(/^\w/, (c) => c.toUpperCase()),
    look: 'Cinematic, natural light, consistent colors and the same characters and place in every shot.',
    shots: picked.map((role, index) => ({
      prompt: `${role.text} ${idea}.`,
      movement: role.movement,
      seconds: index === 0 || index === picked.length - 1 ? 4 : 3,
    })),
    planner: 'template',
  };
}
