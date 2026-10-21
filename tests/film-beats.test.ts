import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { filmTimeline } from '../src/film.js';
import { beatAnalysisSchema, filmBeatGrid, snapCutsToBeats } from '../src/film-beats.js';

const shot = (start: number, end: number, patch = {}) => ({
  assetId: randomUUID(),
  start,
  end,
  ...patch,
});
const analysis = beatAnalysisSchema.parse({
  method: 'spectral-flux-dp/1',
  tempo: 120,
  duration: 20,
  beats: Array.from({ length: 40 }, (_, index) => 0.25 + index * 0.5),
  downbeats: Array.from({ length: 10 }, (_, index) => 0.25 + index * 2),
});

test('beat grids follow the audio clip placement and trim', () => {
  const track = { start: 1, sourceStart: 2.25, sourceEnd: 6 };
  assert.deepEqual(filmBeatGrid(analysis, track).slice(0, 3), [1, 1.5, 2]);
  assert.deepEqual(filmBeatGrid(analysis, track, { every: 2 }).slice(0, 3), [1, 2, 3]);
  assert.deepEqual(filmBeatGrid(analysis, track, { downbeats: true }), [1, 3]);
  assert.ok(filmBeatGrid(analysis, track).every((time) => time <= 1 + 6 - 2.25));
});

test('cuts and transition midpoints land on the nearest reachable beat', () => {
  const grid = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const shots = [
    shot(0, 1.1),
    shot(0, 1.3),
    shot(0, 2, { dissolve: 0.25, transition: 'flash' as const }),
  ];
  const { shots: snapped, misses } = snapCutsToBeats(shots, grid, () => 30);
  assert.deepEqual(misses, []);
  const timeline = filmTimeline(snapped);
  assert.equal(timeline[1].start, 1, 'A hard cut moves to the nearest beat.');
  const middle = timeline[2].start + timeline[2].overlap / 2;
  assert.ok(Math.abs(middle - 2) < 1 / 24 + 1e-9, `flash midpoint ${middle}`);
  assert.ok(snapped.every((item) => Number.isInteger(Math.round(item.end * 24 * 1e6) / 1e6)));
  assert.deepEqual(
    snapped.map((item) => item.start),
    shots.map((item) => item.start),
    'Only shot ends change.',
  );
});

test('snapping respects source length and minimum shot length', () => {
  const grid = [3];
  const short = snapCutsToBeats([shot(0, 1), shot(0, 1)], grid, () => 1.5);
  assert.deepEqual(short.misses, [1], 'A cut that would need more footage is kept.');
  assert.equal(short.shots[0].end, 1);
  const early = snapCutsToBeats([shot(0, 1), shot(0, 1)], [0.1], () => 10);
  assert.deepEqual(early.misses, [1], 'A shot never shrinks below a quarter second.');
});
