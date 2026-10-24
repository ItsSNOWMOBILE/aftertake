import { z } from 'zod';
import { cameraMovements, cinemaSchema, promptOnlyMovements } from './cinema';
import { punchAnimations, shotTransitions, titleBoxes, titleFonts, type FilmDraft } from './film';
import type { Clip } from './domain';

/**
 * One-tap effects turn one photo, or a frame of a short clip, into a finished
 * 9:16 clip. Each preset is a JSON file in presets/one-tap: a camera move from
 * Animate a frame, then a Film cut with titles, a transition and a song.
 */
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/);
const hexColor = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const cinema = cinemaSchema;

export const oneTapTitleSchema = z
  .object({
    text: z.string().trim().min(1).max(60),
    /** The person running the effect may rewrite this title before it renders. */
    editable: z.boolean().optional(),
    start: z.number().min(0).max(20),
    end: z.number().positive().max(20),
    style: z.enum(['headline', 'caption', 'kicker']),
    position: z.enum(['top', 'center', 'bottom']),
    animation: z.enum([
      'fade',
      'rise',
      'none',
      'build',
      'typewriter',
      'impact',
      'wipe',
      ...punchAnimations,
    ]),
    motionDuration: z.number().min(0.15).max(4).optional(),
    fontSize: z.number().min(16).max(180).optional(),
    fontWeight: z
      .union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)])
      .optional(),
    stroke: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    font: z.enum(titleFonts).optional(),
    box: z.enum(titleBoxes).optional(),
    tilt: z.number().min(-20).max(20).optional(),
    color: hexColor,
  })
  .strict()
  .refine((title) => title.end - title.start >= 0.25, 'A title needs at least a quarter second.');

export const oneTapPresetSchema = z
  .object({
    format: z.literal('aftertake-one-tap/1'),
    id: slug,
    title: z.string().trim().min(1).max(40),
    line: z.string().trim().min(1).max(140),
    /** Lower numbers come first in the gallery. */
    order: z.number().int().min(0).max(999),
    /** A video source contributes the frame at the chosen time. */
    accepts: z
      .array(z.enum(['image', 'video']))
      .min(1)
      .max(2),
    motion: z
      .object({
        prompt: z.string().trim().min(5).max(1500),
        movement: z.enum(cameraMovements),
        lens: cinema.shape.lens,
        lighting: cinema.shape.lighting,
        palette: cinema.shape.palette,
        guidance: z.enum(['prompt', 'tracks']).optional(),
        quality: z.enum(['draft', 'final']),
        resolution: z.literal('720p').optional(),
      })
      .strict()
      .refine(
        (motion) => !(motion.guidance === 'tracks' && promptOnlyMovements.has(motion.movement)),
        'This camera move uses prompt guidance only.',
      )
      .refine(
        (motion) => !motion.resolution || motion.quality === 'final',
        'A 720p effect renders at Finish quality.',
      ),
    /** Where the 9:16 crop sits on a wider photo, from top (0) to bottom (1). */
    focusY: z.number().min(0).max(1).optional(),
    cut: z
      .object({
        layout: z.enum(['motion', 'before-after', 'reveal']),
        /** Seconds the untouched photo holds before the move (before-after and reveal). */
        still: z.number().min(0.5).max(3).optional(),
        transition: z.enum(shotTransitions).optional(),
        transitionSeconds: z.number().min(0.1).max(1).optional(),
        /** A slow push on the held photo, as a Film camera zoom. */
        stillZoom: z.number().min(1).max(1.3).optional(),
      })
      .strict()
      .refine(
        (cut) => (cut.layout === 'motion') === (cut.still === undefined),
        'Only before-after and reveal layouts hold the photo first.',
      )
      .refine(
        (cut) => cut.layout !== 'motion' || (!cut.transition && !cut.stillZoom),
        'A single-shot layout has no transition or held photo.',
      ),
    titles: z.array(oneTapTitleSchema).max(3),
    music: z
      .object({
        track: slug,
        /** Where the cut starts in the song, in seconds. */
        start: z.number().min(0).max(200),
        volume: z.number().min(0).max(1.5),
        fadeOut: z.number().min(0).max(3),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((preset, context) => {
    const duration = oneTapDuration(preset);
    preset.titles.forEach((title, index) => {
      if (title.end > duration + 0.001)
        context.addIssue({
          code: 'custom',
          path: ['titles', index, 'end'],
          message: `Titles must end by ${duration.toFixed(2)} s, when this effect ends.`,
        });
    });
    if (preset.titles.filter((title) => title.editable).length > 1)
      context.addIssue({
        code: 'custom',
        path: ['titles'],
        message: 'Mark at most one title as editable.',
      });
  });
export type OneTapPreset = z.infer<typeof oneTapPresetSchema>;

/** A song the effects can cut to: an ACE-Step render shipped with Aftertake. */
export const oneTapMusicSchema = z
  .object({
    format: z.literal('aftertake-one-tap-music/1'),
    id: slug,
    title: z.string().trim().min(1).max(60),
    file: z.string().regex(/^[a-z0-9-]+\.(m4a|flac|wav|mp3)$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    duration: z.number().positive().max(240),
    /** The Song studio request that made it, so anyone can render it again. */
    recipe: z.record(z.string(), z.unknown()),
  })
  .strict();
export type OneTapMusic = z.infer<typeof oneTapMusicSchema>;

/** Generated takes from Animate a frame are cut to whole frames at 24 fps. */
export function oneTapMotionSeconds(motion: Pick<OneTapPreset['motion'], 'quality'>) {
  // Finish renders 97 frames at 24 fps and Draft 49 at 16 fps; the film keeps whole frames.
  return motion.quality === 'draft' ? 3 : 4;
}
/** The length Animate a frame renders: 97 frames at 24 fps, or 49 at 16 fps for Draft. */
export function oneTapTakeSeconds(quality: OneTapPreset['motion']['quality']) {
  return quality === 'draft' ? 49 / 16 : 97 / 24;
}
export function oneTapTransitionSeconds(cut: OneTapPreset['cut']) {
  if (cut.layout === 'motion') return 0;
  return Math.round((cut.transitionSeconds ?? 0.4) * 24) / 24;
}
/** The finished clip's length, from the same timeline rules as a Film export. */
export function oneTapDuration(preset: Pick<OneTapPreset, 'motion' | 'cut'>) {
  const motion = oneTapMotionSeconds(preset.motion);
  if (preset.cut.layout === 'motion') return motion;
  const still = Math.round((preset.cut.still ?? 1) * 24) / 24,
    overlap = Math.min(
      Math.round(oneTapTransitionSeconds(preset.cut) * 24),
      Math.floor((still * 24) / 2),
      Math.floor((motion * 24) / 2),
    );
  return (Math.round(still * 24) + motion * 24 - overlap) / 24;
}

export const oneTapRequestSchema = z
  .object({
    preset: slug,
    clipId: z.string().uuid(),
    /** For a video source: which moment becomes the photo. */
    time: z.number().min(0).max(3600).optional(),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1)
      .optional(),
    title: z.string().trim().min(1).max(60).optional(),
    watermark: z.boolean(),
  })
  .strict();
export type OneTapRequest = z.infer<typeof oneTapRequestSchema>;

export type ClipCheck = {
  duration: number;
  frames: number;
  width: number;
  height: number;
  /** Mean and spread of luma over sampled frames, 0–255. */
  meanLuma: number;
  lumaSpread: number;
  /** Mean absolute luma change between sampled frames, 0–255. */
  motion: number;
};
export type CheckResult = { ok: boolean; problems: string[]; measured: ClipCheck };

/**
 * Automatic checks on a generated or finished clip. They catch broken renders,
 * not taste: a black or flat frame, a picture that never moves, a wrong length.
 */
export function judgeClip(measured: ClipCheck, expectedSeconds: number): CheckResult {
  const problems: string[] = [];
  if (
    measured.frames < 2 ||
    measured.meanLuma < 6 ||
    measured.meanLuma > 250 ||
    measured.lumaSpread < 3
  )
    problems.push('The picture is blank.');
  else if (measured.motion < 0.35) problems.push('The picture does not move.');
  if (Math.abs(measured.duration - expectedSeconds) > 1.5 / 24)
    problems.push(
      `It runs ${measured.duration.toFixed(2)} s instead of ${expectedSeconds.toFixed(2)} s.`,
    );
  return { ok: !problems.length, problems, measured };
}

export type OneTapAttempt = {
  seed: number;
  renderId?: string;
  check?: CheckResult;
};
export type OneTapExport = { filmId: string; check?: CheckResult };
export type OneTapJob = {
  id: string;
  requestKey?: string;
  requestDigest?: string;
  request: OneTapRequest;
  /** The preset as it was when the job started; later edits do not change a result. */
  preset: OneTapPreset;
  source: Clip;
  /** The 9:16 still the move starts from. */
  frame?: Clip;
  state: 'queued' | 'running' | 'ready' | 'failed' | 'canceled';
  stage: string;
  progress: number | null;
  attempts: OneTapAttempt[];
  exports: { watermark?: OneTapExport; clean?: OneTapExport };
  /** Which export the result shows and downloads. */
  watermark: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
export const oneTapBusy = (job: Pick<OneTapJob, 'state'>) =>
  job.state === 'queued' || job.state === 'running';
export function oneTapResult(job: OneTapJob) {
  const chosen = job.watermark ? job.exports.watermark : job.exports.clean;
  return chosen && job.state === 'ready' ? chosen : undefined;
}

/** A different, reproducible seed for the automatic re-render and for Again. */
export const nextSeed = (seed: number) => (seed + 7919) % 2 ** 32;

/** Exact paste of a preset title into a Film title; the caller adds its ID. */
function filmTitle(title: OneTapPreset['titles'][number], text: string, id: string) {
  const { editable: _editable, ...rest } = title;
  return { ...rest, id, text };
}

export type OneTapCutInputs = {
  preset: OneTapPreset;
  renderId: string;
  frameAssetId?: string;
  musicAssetId?: string;
  watermark?: { assetId: string; width: number; height: number };
  title?: string;
  ids: () => string;
};
/** The Film draft that cuts a one-tap effect: 720×1280, 24 fps, ready to share. */
export function oneTapFilm(inputs: OneTapCutInputs): FilmDraft {
  const { preset } = inputs,
    motion = oneTapMotionSeconds(preset.motion),
    duration = oneTapDuration(preset),
    shots: FilmDraft['shots'] = [];
  if (preset.cut.layout !== 'motion') {
    if (!inputs.frameAssetId) throw Error('This effect needs its photo as a Film still.');
    const zoom = preset.cut.stillZoom ?? 1;
    shots.push({
      assetId: inputs.frameAssetId,
      start: 0,
      end: Math.round((preset.cut.still ?? 1) * 24) / 24,
      framing: { zoom: 1, endZoom: zoom, x: 0.5, y: 0.5, fit: 'cover' },
    });
  }
  shots.push({
    renderId: inputs.renderId,
    start: 0,
    end: motion,
    framing: { zoom: 1, endZoom: 1, x: 0.5, y: 0.5, fit: 'cover' },
    ...(shots.length
      ? {
          dissolve: oneTapTransitionSeconds(preset.cut),
          ...(preset.cut.transition ? { transition: preset.cut.transition } : {}),
        }
      : {}),
  });
  const titles = preset.titles.map((title) =>
    filmTitle(title, title.editable && inputs.title ? inputs.title : title.text, inputs.ids()),
  );
  const graphics: NonNullable<FilmDraft['graphics']> = [];
  if (inputs.watermark) {
    // A small mark in the lower right, above the safe margin phones keep for controls.
    const width = 0.24,
      height = (width * 720 * inputs.watermark.height) / inputs.watermark.width / 1280;
    graphics.push({
      id: inputs.ids(),
      name: 'Aftertake watermark',
      kind: 'image',
      assetId: inputs.watermark.assetId,
      start: 0,
      end: duration,
      x: 1 - 0.04 - width / 2,
      y: 1 - 0.035 - height / 2,
      width,
      height,
      color: '#ffffff',
      opacity: 0.82,
      fit: 'contain',
    });
  }
  const music = preset.music;
  return {
    name: preset.title,
    aspect: 'portrait',
    shots,
    titles,
    ...(graphics.length ? { graphics } : {}),
    ...(music && inputs.musicAssetId
      ? {
          audio: [
            {
              assetId: inputs.musicAssetId,
              start: 0,
              sourceStart: music.start,
              sourceEnd: music.start + duration,
              volume: music.volume,
              fadeIn: 0,
              fadeOut: Math.min(music.fadeOut, duration / 2),
            },
          ],
        }
      : {}),
    sourceVolume: 0,
    normalizeAudio: false,
  };
}
