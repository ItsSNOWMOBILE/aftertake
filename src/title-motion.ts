import type { FilmDraft } from './film';
export type FilmTitle = NonNullable<FilmDraft['titles']>[number];
export function titleTypography(title: FilmTitle) {
  return {
    fontWeight: title.fontWeight ?? (title.style === 'headline' ? 700 : 400),
    stroke: title.stroke ?? title.style !== 'caption',
    align: title.align ?? 'center',
  };
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const kineticAnimations = new Set(['build', 'typewriter', 'impact', 'wipe']);
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
