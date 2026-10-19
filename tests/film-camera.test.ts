import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraAt, filmFramingSchema, type FilmFraming } from '../src/film-camera.js';
import { filmRequestSchema, filmManifestSchema } from '../src/film.js';

const move: FilmFraming = {
  zoom: 1,
  endZoom: 2,
  x: 0.5,
  y: 0.5,
  keyframes: [
    { at: 0, zoom: 1, x: 0, y: 0 },
    { at: 0.5, zoom: 2, x: 1, y: 0.5 },
    { at: 1, zoom: 1.5, x: 0.5, y: 1, easing: 'hold' },
  ],
};

test('camera pauses at arrivals, preserves exact endpoints and holds until the next cut', () => {
  assert.deepEqual(cameraAt(move, -1), { zoom: 1, x: 0, y: 0 });
  assert.deepEqual(cameraAt(move, 0.25), { zoom: 1.5, x: 0.5, y: 0.25 });
  assert.deepEqual(cameraAt(move, 0.5), { zoom: 2, x: 1, y: 0.5 });
  assert.deepEqual(cameraAt(move, 0.99), { zoom: 2, x: 1, y: 0.5 });
  assert.deepEqual(cameraAt(move, 1), { zoom: 1.5, x: 0.5, y: 1 });
  // A smooth arrival moves less than a linear move near both endpoints.
  assert.ok(cameraAt(move, 0.01).x < 0.002);
  assert.ok(1 - cameraAt(move, 0.49).x < 0.002);
  assert.deepEqual(cameraAt(move, Number.NaN), cameraAt(move, 0));
});

test('legacy linear zooms and fixed anchors keep their existing preview behavior', () => {
  const framing = { zoom: 1.2, endZoom: 2.4, x: 0.3, y: 0.7 };
  assert.deepEqual(cameraAt(framing, 0.25), { zoom: 1.5, x: 0.3, y: 0.7 });
  const accelerated = {
    ...move,
    keyframes: [move.keyframes![0], { at: 1, zoom: 2, x: 1, y: 1, easing: 'ease-out' as const }],
  };
  assert.deepEqual(cameraAt(accelerated, 0.5), { zoom: 1.875, x: 0.875, y: 0.875 });
});

test('camera tracks reject gaps, reversed times and nonfinite or out-of-canvas values', () => {
  assert.equal(filmFramingSchema.safeParse(move).success, true);
  for (const keyframes of [
    [move.keyframes![0]],
    [{ ...move.keyframes![0], at: 0.1 }, move.keyframes![2]],
    [move.keyframes![0], { ...move.keyframes![2], at: 0.9 }],
    [move.keyframes![0], move.keyframes![1], move.keyframes![1], move.keyframes![2]],
    [move.keyframes![0], { ...move.keyframes![2], zoom: Infinity }],
    [move.keyframes![0], { ...move.keyframes![2], x: 1.1 }],
    [move.keyframes![0], { ...move.keyframes![2], easing: 'random()' }],
  ]) {
    assert.equal(filmFramingSchema.safeParse({ ...move, keyframes }).success, false);
  }
});

test('native requests and portable projects retain the complete camera track', () => {
  const id = 'ca56f918-ba61-4935-86ca-13814f22d56c';
  const draft = {
    name: 'A purposeful camera move',
    aspect: 'landscape',
    shots: [{ assetId: id, start: 0, end: 2, framing: move }],
  };
  assert.deepEqual(filmRequestSchema.parse(draft).shots[0].framing, move);
  assert.deepEqual(
    filmManifestSchema.parse({
      ...draft,
      format: 'aftertake-film/2',
      shots: [{ ...draft.shots[0], sha256: 'a'.repeat(64) }],
    }).shots[0].framing,
    move,
  );
});
