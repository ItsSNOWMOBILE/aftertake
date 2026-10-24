import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { cameraMovements, cinemaOptions, promptOnlyMovements } from '../src/cinema.js';

test('the moves gallery has 24 to 30 moves, each with a real preview loop and poster', () => {
  assert.ok(cameraMovements.length >= 24 && cameraMovements.length <= 30);
  assert.equal(cinemaOptions.movement.length, cameraMovements.length);
  for (const move of cameraMovements)
    for (const extension of ['mp4', 'jpg']) {
      const file = new URL(`../public/moves/${move}.${extension}`, import.meta.url);
      assert.ok(
        existsSync(file),
        `${move}.${extension} is missing; run scripts/build-move-previews.py`,
      );
      // Every card autoplays once the gallery opens, so each loop stays light.
      assert.ok(statSync(file).size < 200_000, `${move}.${extension} is too large`);
    }
});

test('the Higgsfield signature moves are in the gallery, with depth moves on prompt guidance', () => {
  for (const move of [
    'orbit-360',
    'fpv-drone',
    'bullet-time',
    'snorricam',
    'arc',
    'boom-down',
    'rack-focus',
  ] as const)
    assert.ok(cameraMovements.includes(move), move);
  for (const move of [
    'orbit-360',
    'fpv-drone',
    'bullet-time',
    'snorricam',
    'arc',
    'rack-focus',
    'drone-reveal',
  ])
    assert.ok(promptOnlyMovements.has(move), move);
  for (const move of [
    'boom-down',
    'zoom-in',
    'zoom-out',
    'truck-right',
    'dutch-roll',
    'impact-shake',
  ])
    assert.ok(!promptOnlyMovements.has(move), move);
});
