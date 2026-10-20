import type { shotTransitions } from './film';
import { motionHash } from './title-motion';

export type ShotTransition = (typeof shotTransitions)[number];
export const transitionLabels: Record<ShotTransition, string> = {
  dissolve: 'Dissolve',
  whip: 'Whip pan',
  zoom: 'Zoom punch',
  flash: 'Flash',
  glitch: 'Glitch cut',
  slide: 'Push up',
};
/** Seconds suggested when a styled transition is chosen on a hard cut. */
export const transitionDefaults: Record<ShotTransition, number> = {
  dissolve: 0.5,
  whip: 0.33,
  zoom: 0.42,
  flash: 0.25,
  glitch: 0.17,
  slide: 0.38,
};

export type TransitionPose = {
  visible: boolean;
  opacity: number;
  /** Offsets in canvas widths and heights. */
  x: number;
  y: number;
  scale: number;
  /** Directional smear as a fraction of the canvas width. */
  blur: number;
  /** White overlay strength above both pictures. */
  flash: number;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);
/** Whip and push speed peaks mid-move; render-film.py smears by the same amount. */
export const whipBlur = (progress: number) => 0.06 * 4 * progress * (1 - progress);
export const zoomScale = (progress: number) =>
  progress < 0.5 ? 1 + 1.5 * (2 * progress) ** 3 : 1 + 1.5 * (1 - (2 * progress - 1)) ** 3;
export const flashAmount = (progress: number) => clamp((1 - Math.abs(2 * progress - 1)) * 1.5);
export const glitchAmount = (progress: number) => 1 - Math.abs(2 * progress - 1);

/** Pose one side of an overlapping cut. Progress runs from the first overlap frame (0) toward 1. */
export function transitionPose(
  kind: ShotTransition | undefined,
  progress: number,
  role: 'outgoing' | 'incoming',
): TransitionPose {
  const p = clamp(progress),
    incoming = role === 'incoming',
    rest = { visible: true, opacity: 1, x: 0, y: 0, scale: 1, blur: 0, flash: 0 };
  switch (kind) {
    case 'whip':
      return { ...rest, x: (incoming ? 1 : 0) - smooth(p), blur: whipBlur(p) };
    case 'slide':
      return { ...rest, y: (incoming ? 1 : 0) - smooth(p) };
    case 'zoom':
      return { ...rest, visible: incoming === p >= 0.5, scale: zoomScale(p) };
    case 'flash':
      return { ...rest, visible: incoming === p >= 0.5, flash: flashAmount(p) };
    case 'glitch': {
      const frame = Math.floor(p * 24 * 8);
      return {
        ...rest,
        visible: incoming === p >= 0.5,
        x: glitchAmount(p) * 0.03 * (motionHash(frame * 5 + 3) * 2 - 1),
      };
    }
    default:
      return { ...rest, opacity: incoming ? p : 1 };
  }
}
