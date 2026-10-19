import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmTitleSchema } from '../src/film.js';
import {
  titleMotion,
  titleTypography,
  wordMotion,
  speechPhrases,
  spokenTitleState,
  retimeSpokenWord,
} from '../src/title-motion.js';

const title = {
  id: '00000000-0000-4000-8000-000000000001',
  text: 'Make it yours.',
  start: 1,
  end: 4,
  style: 'headline' as const,
  position: 'center' as const,
  color: '#ffffff',
  animation: 'build' as const,
  motionDuration: 1,
  fontSize: 112,
};
test('kinetic title timing and size survive a portable project round trip', () => {
  for (const animation of ['build', 'typewriter', 'impact', 'wipe'] as const) {
    const layer = { ...title, animation };
    assert.deepEqual(filmTitleSchema.parse(JSON.parse(JSON.stringify(layer))), layer);
  }
  assert.equal(filmTitleSchema.safeParse({ ...title, fontSize: 500 }).success, false);
  assert.equal(filmTitleSchema.safeParse({ ...title, motionDuration: 0 }).success, false);
});

test('title appearance is optional for older projects and retains explicit choices for every motion', () => {
  assert.deepEqual(titleTypography(title), { fontWeight: 700, stroke: true, align: 'center' });
  assert.deepEqual(titleTypography({ ...title, style: 'caption' }), {
    fontWeight: 400,
    stroke: false,
    align: 'center',
  });
  assert.deepEqual(titleTypography({ ...title, style: 'kicker' }), {
    fontWeight: 400,
    stroke: true,
    align: 'center',
  });
  for (const animation of [
    'none',
    'fade',
    'rise',
    'build',
    'typewriter',
    'impact',
    'wipe',
  ] as const) {
    const styled = {
      ...title,
      animation,
      fontWeight: 500 as const,
      stroke: false,
      align: 'left' as const,
    };
    assert.deepEqual(filmTitleSchema.parse(JSON.parse(JSON.stringify(styled))), styled);
    assert.deepEqual(titleTypography(styled), { fontWeight: 500, stroke: false, align: 'left' });
  }
  for (const invalid of [
    { fontWeight: 450 },
    { fontWeight: '500' },
    { stroke: 'false' },
    { align: 'justify' },
  ])
    assert.equal(filmTitleSchema.safeParse({ ...title, ...invalid }).success, false);
  assert.equal('fontWeight' in filmTitleSchema.parse(title), false);
  assert.equal('stroke' in filmTitleSchema.parse(title), false);
  assert.equal('align' in filmTitleSchema.parse(title), false);
});

test('spoken phrases follow measured words through gaps and scrub backward without changing the layout', () => {
  const words = speechPhrases([
    { text: 'Pour', start: 0.05, end: 0.25 },
    { text: 'slowly.', start: 0.35, end: 0.8 },
    { text: 'Savor', start: 1.1, end: 1.5 },
    { text: 'the', start: 1.55, end: 1.65 },
    { text: 'moment.', start: 1.7, end: 2.1 },
  ]);
  assert.deepEqual(
    words.map((w) => w.phrase),
    [0, 0, 1, 1, 1],
  );
  const layer = filmTitleSchema.parse({
    ...title,
    text: 'Pour slowly. Savor the moment.',
    animation: 'spoken',
    words,
  });
  assert.equal(spokenTitleState(layer, 1.15).active, 0);
  assert.equal(spokenTitleState(layer, 1.3).active, -1);
  assert.equal(spokenTitleState(layer, 2.2).phrase, 1);
  assert.equal(spokenTitleState(layer, 1.6).phrase, 0);
  assert.equal(spokenTitleState(layer, 1.6).words.length, 2);
  assert.equal(filmTitleSchema.safeParse({ ...layer, text: 'Changed copy.' }).success, false);
  assert.equal(filmTitleSchema.safeParse({ ...layer, end: 2 }).success, false);
  assert.equal(filmTitleSchema.safeParse({ ...layer, words: undefined }).success, false);
  const overlap = structuredClone(layer);
  overlap.words![1].start = 0.1;
  assert.equal(filmTitleSchema.safeParse(overlap).success, false);
  const clampedStart = { ...layer, words: retimeSpokenWord(layer, 1, 'start', 0) };
  assert.equal(clampedStart.words![1].start, words[0].end);
  assert.equal(filmTitleSchema.safeParse(clampedStart).success, true);
  const clampedEnd = { ...layer, words: retimeSpokenWord(layer, 1, 'end', 5) };
  assert.equal(clampedEnd.words![1].end, words[2].start);
  assert.equal(filmTitleSchema.safeParse(clampedEnd).success, true);
});
test('word entrances settle before the hold and scrub by film time', () => {
  const beginning = titleMotion(title, 1),
    middle = titleMotion(title, 1.5),
    hold = titleMotion(title, 3);
  assert.equal(beginning.progress, 0);
  assert.equal(middle.progress, 0.5);
  assert.equal(hold.progress, 1);
  assert.equal(wordMotion(2, 3, 0, 1).opacity, 0);
  assert.equal(wordMotion(2, 3, 1, 1).opacity, 1);
  assert.equal(wordMotion(0, 3, 0.2, 1).opacity > wordMotion(2, 3, 0.2, 1).opacity, true);
  assert.equal(
    titleMotion({ ...title, animation: 'typewriter' }, 2).visibleCharacters,
    Array.from(title.text).length,
  );
  assert.equal(titleMotion({ ...title, animation: 'impact' }, 1).opacity, 0);
  assert.equal(titleMotion({ ...title, animation: 'impact' }, 2).scale, 1);
});
