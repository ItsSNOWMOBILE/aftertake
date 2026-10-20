import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  filmDraftSchema,
  filmFormat,
  filmManifestSchema,
  filmRenderRevision,
  hasPunchFeatures,
} from '../src/film.js';
import {
  glitchMotion,
  kineticAnimations,
  motionHash,
  popWord,
  revealWord,
  scrambleCharacters,
  slamMotion,
  titleMotion,
} from '../src/title-motion.js';
import { transitionPose, zoomScale, flashAmount, whipBlur } from '../src/film-transitions.js';

const sha256 = 'a'.repeat(64);
const shot = (patch = {}) => ({ assetId: randomUUID(), start: 0, end: 2, ...patch });
const title = (patch = {}) => ({
  id: randomUUID(),
  text: 'YOUR KEY, NO MIDDLEMAN',
  start: 0,
  end: 2,
  style: 'headline' as const,
  position: 'center' as const,
  animation: 'slam' as const,
  color: '#ff6a2b',
  ...patch,
});
const draft = (patch = {}) => ({
  name: 'Punch',
  aspect: 'landscape' as const,
  shots: [shot(), shot({ dissolve: 0.33, transition: 'whip' })],
  titles: [title({ font: 'display', box: 'stamp', tilt: -6 })],
  ...patch,
});

test('punch typography and styled transitions validate and save as aftertake-film/5', () => {
  assert.ok(filmRenderRevision >= 12);
  const parsed = filmDraftSchema.parse(draft());
  assert.equal(hasPunchFeatures(parsed), true);
  assert.equal(filmFormat(parsed), 'aftertake-film/5');
  const plain = filmDraftSchema.parse(
    draft({ shots: [shot(), shot({ dissolve: 0.5, transition: 'dissolve' })], titles: [] }),
  );
  assert.equal(hasPunchFeatures(plain), false, 'An explicit dissolve keeps the older format.');
  for (const animation of ['slam', 'pop', 'reveal', 'glitch', 'scramble'])
    assert.equal(
      filmDraftSchema.safeParse(draft({ titles: [title({ animation })] })).success,
      true,
    );
  for (const invalid of [
    { tilt: 21 },
    { tilt: -20.5 },
    { font: 'comic' },
    { box: 'circle' },
    { animation: 'spin' },
  ])
    assert.equal(filmDraftSchema.safeParse(draft({ titles: [title(invalid)] })).success, false);
  assert.equal(
    filmDraftSchema.safeParse(draft({ shots: [shot(), shot({ transition: 'spiral' })] })).success,
    false,
  );
});

test('older project formats reject punch features instead of dropping them', () => {
  const manifest = {
    ...draft(),
    shots: draft().shots.map((item) => ({ ...item, sha256 })),
  };
  assert.equal(
    filmManifestSchema.safeParse({ ...manifest, format: 'aftertake-film/5' }).success,
    true,
  );
  for (const format of ['aftertake-film/2', 'aftertake-film/3', 'aftertake-film/4'])
    assert.equal(filmManifestSchema.safeParse({ ...manifest, format }).success, false, format);
});

test('punch motion settles exactly and matches the native renderer reference values', () => {
  // render-film.py's test_film_punch.py asserts the same numbers.
  assert.deepEqual(
    [0, 1, 7, 12345, -3].map(motionHash),
    [0, 0.6180339867714792, 0.32623790740035474, 0.6295666939113289, 0.14589803968556225],
  );
  assert.equal(slamMotion(0.05, 0.6).scale, 2.530555555555556);
  assert.equal(slamMotion(0.24, 0.6).scale, 1);
  assert.equal(slamMotion(0.3, 0.6).x, -0.010303671216445097);
  assert.ok(Math.abs(slamMotion(3, 0.6).x) < 1e-9, 'The shake decays.');
  assert.deepEqual(popWord(1, 3, 0.1, 0.6), { scale: 0, opacity: 0 });
  assert.equal(popWord(1, 3, 0.3, 0.6).scale, 1.0876975);
  assert.equal(popWord(2, 3, 0.6, 0.6).scale, 1);
  assert.deepEqual(revealWord(0, 1, 0.6, 0.6), { visible: true, offset: 0 });
  assert.equal(revealWord(3, 4, 0.1, 0.6).visible, false);
  const glitch = glitchMotion(0.1, 0.6);
  assert.equal(glitch.split, -0.013888888888888886);
  assert.equal(glitch.jitter, 0.008094662257159747);
  assert.equal(glitchMotion(0.6, 0.6).amount, 0);
  assert.deepEqual(scrambleCharacters('NO MIDDLEMAN', 0.3, 0.6), [
    'N',
    'O',
    ' ',
    'M',
    '=',
    'Z',
    'I',
    '9',
    'S',
    'C',
    '3',
    'M',
  ]);
  assert.deepEqual(scrambleCharacters('NO MIDDLEMAN', 0.6, 0.6), Array.from('NO MIDDLEMAN'));
  assert.equal(scrambleCharacters('AB', 0, 0.6)[1], null, 'Later characters start hidden.');
  for (const animation of ['slam', 'pop', 'reveal', 'glitch', 'scramble'] as const) {
    assert.ok(kineticAnimations.has(animation));
    const item = title({ animation, end: 2 });
    assert.equal(titleMotion(item, 1).opacity, 1, `${animation} is fully visible after entering`);
    assert.equal(titleMotion(item, 1.999).opacity < 0.05, true, `${animation} fades out`);
  }
});

test('transition poses hand over between pictures without gaps', () => {
  assert.equal(zoomScale(0.2), 1.096);
  assert.equal(zoomScale(0.7), 1.324);
  assert.deepEqual([flashAmount(0.2), flashAmount(0.5)], [0.6000000000000001, 1]);
  assert.equal(whipBlur(0.3), 0.05039999999999999);
  for (const kind of ['whip', 'slide'] as const) {
    const outgoing = transitionPose(kind, 0.4, 'outgoing'),
      incoming = transitionPose(kind, 0.4, 'incoming');
    const axis = kind === 'whip' ? 'x' : 'y';
    assert.ok(Math.abs(incoming[axis] - outgoing[axis] - 1) < 1e-12, 'The pictures stay adjacent.');
  }
  for (const kind of ['zoom', 'flash', 'glitch'] as const) {
    assert.equal(transitionPose(kind, 0.49, 'outgoing').visible, true);
    assert.equal(transitionPose(kind, 0.49, 'incoming').visible, false);
    assert.equal(transitionPose(kind, 0.5, 'incoming').visible, true);
    assert.equal(transitionPose(kind, 0.5, 'outgoing').visible, false);
  }
  assert.equal(transitionPose(undefined, 0.25, 'incoming').opacity, 0.25);
});
