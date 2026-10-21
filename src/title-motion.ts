import { punchAnimations, type FilmDraft } from './film';
export type FilmTitle = NonNullable<FilmDraft['titles']>[number];
export function titleTypography(title: FilmTitle) {
  return {
    fontWeight: title.fontWeight ?? (title.style === 'headline' ? 700 : 400),
    stroke: title.stroke ?? title.style !== 'caption',
    align: title.align ?? 'center',
  };
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const punchAnimationSet = new Set<string>(punchAnimations);
export const kineticAnimations = new Set<string>([
  'build',
  'typewriter',
  'impact',
  'wipe',
  ...punchAnimations,
]);
/** Display families shared with the native renderer's font files. */
export const titleFontFamilies = {
  display: "'Archivo Black', sans-serif",
  condensed: 'Anton, sans-serif',
  mono: "'JetBrains Mono', monospace",
} as const;
export const scrambleGlyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?';
/** Deterministic per-frame noise; render-film.py computes the same 32-bit hash. */
export function motionHash(value: number) {
  return (Math.imul(value | 0, 2654435761) >>> 0) / 4294967296;
}
/** Film frames since the title began, on the export's 24 fps clock. */
export const titleFrame = (elapsed: number) => Math.floor(elapsed * 24 + 1e-6);
/** Scale from 2.6× into place, then a damped shake measured in canvas widths. */
export function slamMotion(elapsed: number, duration: number) {
  const land = clamp(elapsed / (duration * 0.4)),
    after = elapsed - duration * 0.4,
    amplitude = after > 0 ? 0.018 * Math.exp(-9 * after) : 0;
  return {
    scale: 1 + 1.6 * (1 - land * land),
    x: amplitude * Math.sin(2 * Math.PI * 13 * after),
    y: amplitude * 0.6 * Math.cos(2 * Math.PI * 17 * after),
    opacity: clamp(elapsed / (duration * 0.12)),
  };
}
const stagger = (index: number, count: number, duration: number, spread: number) =>
  count > 1 ? (duration * spread * index) / (count - 1) : 0;
/** Words scale up in turn with a slight overshoot. */
export function popWord(index: number, count: number, elapsed: number, duration: number) {
  const part = clamp(
    (elapsed - stagger(index, count, duration, 0.6)) / (duration * (count > 1 ? 0.4 : 1)),
  );
  return {
    scale: part ? 1 + 2.70158 * (part - 1) ** 3 + 1.70158 * (part - 1) ** 2 : 0,
    opacity: clamp(part * 4),
  };
}
/** Words rise from behind their own line; offset is a fraction of the word's height. */
export function revealWord(index: number, count: number, elapsed: number, duration: number) {
  const part = clamp(
    (elapsed - stagger(index, count, duration, 0.5)) / (duration * (count > 1 ? 0.5 : 1)),
  );
  return { visible: part > 0, offset: (1 - part) ** 3 };
}
/** RGB separation and jitter decay to a clean title by the end of the motion. */
export function glitchMotion(elapsed: number, duration: number) {
  const frame = titleFrame(elapsed),
    amount = elapsed < duration ? (1 - Math.max(0, elapsed) / duration) ** 2 : 0;
  return {
    amount,
    split: amount * 0.02 * (motionHash(frame * 7 + 1) < 0.5 ? -1 : 1),
    jitter: amount * 0.015 * (motionHash(frame * 7 + 2) * 2 - 1),
    opacity: clamp(elapsed / 0.04),
  };
}
/** Characters appear as random glyphs, then settle left to right. Null hides one. */
export function scrambleCharacters(text: string, elapsed: number, duration: number) {
  const characters = Array.from(text),
    frame = titleFrame(elapsed),
    total = Math.max(1, characters.filter((character) => /\S/.test(character)).length);
  let index = 0;
  return characters.map((character) => {
    if (!/\S/.test(character)) return character;
    const at = index++;
    if (elapsed < (duration * 0.5 * at) / total) return null;
    if (elapsed >= duration * (0.35 + (0.65 * at) / total)) return character;
    return scrambleGlyphs[Math.floor(motionHash(frame * 31 + at) * scrambleGlyphs.length)];
  });
}
export function speechPhrases(words: { text: string; start: number; end: number }[]) {
  let phrase = 0,
    count = 0,
    characters = 0;
  return words.map((word, index) => {
    if (
      index &&
      (count >= 4 ||
        characters + word.text.length + 1 > 28 ||
        /[.!?;:]$/.test(words[index - 1].text))
    ) {
      phrase++;
      count = 0;
      characters = 0;
    }
    count++;
    characters += word.text.length + 1;
    return { ...word, phrase };
  });
}
export function spokenTitleState(title: FilmTitle, time: number) {
  const elapsed = time - title.start,
    words = title.words || [];
  let phrase = 0;
  for (const word of words) if (elapsed >= word.start) phrase = word.phrase;
  return {
    phrase,
    words: words.filter((word) => word.phrase === phrase),
    active: words.findIndex((word) => elapsed >= word.start && elapsed < word.end),
  };
}
export function retimeSpokenWord(
  title: FilmTitle,
  index: number,
  edge: 'start' | 'end',
  value: number,
) {
  if (!title.words || !title.words[index] || !Number.isFinite(value)) return title.words;
  const word = title.words[index],
    minimum = edge === 'start' ? title.words[index - 1]?.end || 0 : word.start + 0.0001;
  const maximum =
    edge === 'start'
      ? word.end - 0.0001
      : Math.min(title.end - title.start, title.words[index + 1]?.start ?? Infinity);
  if (minimum > maximum) return title.words;
  return title.words.map((item, at) =>
    at === index ? { ...item, [edge]: Math.max(minimum, Math.min(maximum, value)) } : item,
  );
}
export function titleMotion(title: FilmTitle, time: number) {
  const length = title.end - title.start,
    elapsed = time - title.start;
  const duration = Math.min(title.motionDuration ?? 0.8, length * 0.8),
    progress = clamp(elapsed / duration);
  const fade = Math.min(0.25, length / 3),
    exit = clamp((length - elapsed) / fade);
  const ease = 1 - (1 - progress) ** 3;
  const back = 1 + 2.70158 * (progress - 1) ** 3 + 1.70158 * (progress - 1) ** 2;
  const characters = Array.from(title.text);
  return {
    duration,
    progress,
    ease,
    exit,
    opacity:
      title.animation === 'none'
        ? 1
        : title.animation === 'spoken'
          ? Math.min(clamp(elapsed / 0.08), clamp((length - elapsed) / 0.08))
          : title.animation === 'impact'
            ? exit * clamp(elapsed / Math.min(0.12, duration))
            : title.animation === 'slam'
              ? exit * slamMotion(elapsed, duration).opacity
              : title.animation === 'glitch'
                ? exit * glitchMotion(elapsed, duration).opacity
                : kineticAnimations.has(title.animation)
                  ? exit
                  : Math.min(clamp(elapsed / fade), exit),
    scale: 1 + 0.16 * (1 - back),
    visibleCharacters: Math.floor(characters.length * progress),
    caret: progress < 1 && Math.floor(Math.max(0, elapsed) * 4) % 2 === 0,
  };
}
export function wordMotion(index: number, count: number, elapsed: number, duration: number) {
  const delay = count > 1 ? (duration * 0.65 * index) / (count - 1) : 0;
  const progress = clamp((elapsed - delay) / (duration * (count > 1 ? 0.35 : 1)));
  const ease = 1 - (1 - progress) ** 3;
  return { opacity: ease, y: (1 - ease) * 0.4 };
}
