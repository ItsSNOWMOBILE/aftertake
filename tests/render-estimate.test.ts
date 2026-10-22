import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentEstimate,
  describeEstimate,
  elapsedSeconds,
  estimate,
  estimateKey,
  formatDuration,
  referenceSeconds,
  type TimedJob,
} from '../src/render-estimate.js';

const examples = fileURLToPath(new URL('../examples', import.meta.url));
const records = (folder: string): string[] =>
  readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name);
    return statSync(file).isDirectory() ? records(file) : name.endsWith('.json') ? [file] : [];
  });

test('the RTX 5080 reference table is exactly the recorded example jobs', () => {
  const measured: Record<string, number[]> = {};
  for (const file of records(examples)) {
    const job = JSON.parse(readFileSync(file, 'utf8')) as TimedJob;
    if (!job || typeof job !== 'object' || !job.createdAt) continue;
    const key = estimateKey(job),
      seconds = elapsedSeconds(job);
    if (key && seconds !== null) (measured[key] ||= []).push(Math.round(seconds));
  }
  for (const values of Object.values(measured)) values.sort((a, b) => a - b);
  assert.deepEqual(measured, referenceSeconds);
});

const at = (seconds: number) => ({
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: new Date(Date.parse('2026-10-20T10:00:00.000Z') + seconds * 1000).toISOString(),
});
const video = (quality: string, seconds: number, state = 'succeeded'): TimedJob => ({
  state,
  request: { format: 'aftertake-text-video/1', quality },
  ...at(seconds),
});

test('earlier runs with the same settings come before the reference', () => {
  const history = [video('draft', 40), video('draft', 50), video('draft', 300, 'failed')];
  history.push(video('final', 200), video('draft', 60));
  assert.deepEqual(estimate('video:draft', history), { seconds: 50, runs: 3, from: 'workspace' });
  assert.deepEqual(estimate('video:final-720p', history), {
    seconds: 123,
    runs: 14,
    from: 'reference',
  });
  assert.equal(estimate('take:structure:draft', []), null);
  assert.equal(estimate(null, history), null);
});

test('recompositions and saved-take composites are not counted as renders', () => {
  const take = {
    state: 'succeeded',
    recipe: { pipeline: 'inpaint', quality: 'final' },
    ...at(2),
  };
  assert.equal(estimateKey(take), 'take:inpaint:final');
  assert.equal(elapsedSeconds({ ...take, recomposition: {} }), null);
  assert.equal(estimateKey({ recipe: { ...take.recipe, transfer: { finish: {} } } }), null);
  assert.equal(
    estimateKey({ recipe: { quality: 'draft', resolution: '720p' } }),
    'take:structure:draft-720p',
  );
});

test('durations round to what the runs can support', () => {
  const cases: [number, string][] = [
    [3, '5 s'],
    [10, '10 s'],
    [28, '30 s'],
    [72.5, '1 min'],
    [84, '1½ min'],
    [122, '2 min'],
    [543, '9 min'],
    [3142, '50 min'],
    [3600, '1 hour'],
    [5400, '1.5 hours'],
  ];
  for (const [seconds, text] of cases) assert.equal(formatDuration(seconds), text);
});

test('the estimate says where its time comes from', () => {
  const reference = estimate('video:final-720p', []);
  assert.deepEqual(describeEstimate(reference), {
    time: 'About 2 min · free on your own GPU',
    basis: 'Measured on an RTX 5080',
  });
  assert.equal(
    describeEstimate(reference, 'NVIDIA GeForce RTX 5080')!.basis,
    'Measured on an RTX 5080',
  );
  assert.equal(
    describeEstimate(reference, 'NVIDIA GeForce RTX 4070')!.basis,
    'Measured on an RTX 5080; yours may differ',
  );
  assert.deepEqual(describeEstimate({ seconds: 95, runs: 1, from: 'workspace' }), {
    time: 'About 1½ min · free on your own GPU',
    basis: 'From 1 earlier run in this workspace',
  });
  assert.equal(
    describeEstimate({ seconds: 95, runs: 4, from: 'workspace' })!.basis,
    'Median of 4 runs in this workspace',
  );
  assert.equal(describeEstimate(null), null);
});

test('a Comfy Cloud render says it spends credits instead of running free on the GPU', () => {
  const cloud = {
    time: 'Renders on Comfy Cloud · uses your credits',
    basis: "Time depends on Comfy Cloud's queue",
  };
  assert.deepEqual(describeEstimate(estimate('video:final-720p', []), 'Comfy Cloud'), cloud);
  assert.deepEqual(describeEstimate(null, 'Comfy Cloud'), cloud);
  const reference = estimate('video:final-720p', []);
  assert.equal(agentEstimate(reference)?.cost, 'none: it runs on the local GPU');
  assert.equal(
    agentEstimate(reference, true)?.cost,
    'Comfy Cloud credits on the connected account',
  );
  assert.match(agentEstimate(reference, true)!.basis, /Comfy Cloud's time depends on its queue$/);
});
