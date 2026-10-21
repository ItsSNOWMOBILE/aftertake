import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { startScreenWanted, startTasks } from '../src/start-tasks.js';

test('every start task has a light preview loop and poster cut from real outputs', () => {
  const ids = startTasks.map((task) => task.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids)
    for (const extension of ['mp4', 'jpg']) {
      const file = new URL(`../public/start/${id}.${extension}`, import.meta.url);
      assert(
        existsSync(file),
        `${id}.${extension} is missing; run scripts/build-start-previews.py`,
      );
      // Previews autoplay together, so each stays small.
      assert(statSync(file).size < 400_000, `${id}.${extension} is too large`);
    }
});

test('the start screen shows by default when storage is unavailable', () => {
  assert.equal(startScreenWanted(), true);
});
