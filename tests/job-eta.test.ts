import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimeLeft, jobEta } from '../src/job-eta.js';

const steps = [
  { label: 'Frame your photo', seconds: 4 },
  { label: 'Move the camera', seconds: 100 },
  { label: 'Check the take', seconds: 3 },
  { label: 'Cut with titles and music', seconds: 10 },
];

test('the time left is the rest of the current step plus every later step', () => {
  const eta = jobEta(steps, 1, { inStep: 40, total: 45 });
  assert.equal(eta.seconds, 60 + 3 + 10);
  assert.deepEqual(
    eta.steps.map((step) => step.state),
    ['done', 'active', 'todo', 'todo'],
  );
  assert.equal(eta.progress, 45 / (45 + 73));
});

test('an overrunning step keeps a few seconds, and the bar never reads full while running', () => {
  const late = jobEta(steps, 1, { inStep: 500, total: 505 });
  assert.equal(late.seconds, 3 + 3 + 10);
  assert.ok(late.progress! <= 0.97);
});

test('a wait adds to the time left; a wait that cannot be timed leaves it unknown', () => {
  assert.equal(jobEta(steps, 1, { inStep: 0, total: 5, wait: 80 }).seconds, 80 + 100 + 13);
  const unknown = jobEta(steps, 1, { inStep: 0, total: 5, wait: null });
  assert.equal(unknown.seconds, null);
  assert.equal(unknown.progress, null);
  assert.equal(unknown.steps[1].state, 'active');
});

test('the time left is rounded to what an estimate can promise', () => {
  assert.equal(formatTimeLeft(4), 'Almost done');
  assert.equal(formatTimeLeft(-20), 'Almost done');
  assert.equal(formatTimeLeft(33), 'About 35 s left');
  assert.equal(formatTimeLeft(100), 'About 1 min 40 s left');
  assert.equal(formatTimeLeft(118), 'About 2 min left');
  assert.equal(formatTimeLeft(421), 'About 7 min left');
});
