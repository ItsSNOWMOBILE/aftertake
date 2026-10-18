import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEditPlan, contentDigest } from '../server/edit-plan.js';
import type { FilmAsset } from '../src/film.js';

const picture = '00000000-0000-4000-8000-000000000001',
  voiceId = '00000000-0000-4000-8000-000000000002';
const pictures = new Map([
  [picture, { id: picture, kind: 'video' as const, sha256: 'a'.repeat(64), duration: 10 }],
]);
const voice = {
  id: voiceId,
  name: 'Measured line',
  kind: 'audio',
  sha256: 'b'.repeat(64),
  duration: 1.25,
  extension: '.wav',
  url: '/voice',
  createdAt: 'now',
  narration: {
    text: 'Pour a little slower.',
    voice: 'af_heart',
    speed: 1,
    model: 'Kokoro',
    modelSha256: 'c'.repeat(64),
    voicesSha256: 'd'.repeat(64),
    runner: 'CPU',
  },
} as FilmAsset;
const voices = new Map([[voiceId, voice]]);
function plan() {
  return {
    name: 'A voiced cut',
    aspect: 'portrait',
    beats: [
      {
        name: 'Opening',
        visuals: [{ assetId: picture, sha256: 'a'.repeat(64), start: 0, end: 2 }],
        voice: { assetId: voiceId, sha256: voice.sha256 },
        animation: 'build',
      },
      {
        name: 'Payoff',
        visuals: [{ assetId: picture, sha256: 'a'.repeat(64), start: 2, end: 4, dissolve: 0.125 }],
        voice: { assetId: voiceId, sha256: voice.sha256 },
      },
    ],
  };
}
test('agent plans use measured whole narration, actual source hashes and the native frame clock', () => {
  const result = compileEditPlan(plan(), pictures, voices);
  assert.equal(result.duration, 3.875);
  assert.equal(result.ledger[1].start, 1.875);
  assert.equal(result.ledger[0].spokenText, voice.narration!.text);
  assert.equal(result.draft.titles![0].text, voice.narration!.text);
  assert.deepEqual(result.draft.audio![0], {
    assetId: voiceId,
    start: 0.12,
    sourceStart: 0,
    sourceEnd: 1.25,
    volume: 1,
  });
  assert.equal(result.manifest.shots[0].sha256, 'a'.repeat(64));
  assert.equal(result.manifest.audio[0].sha256, voice.sha256);
  assert.deepEqual(result.manifest.audio[0].asset?.narration, voice.narration);
  assert.equal('url' in result.manifest.audio[0].asset!, false);
  assert.equal(result.identity, compileEditPlan(plan(), pictures, voices).identity);
  const delayed = plan();
  Object.assign(delayed.beats[0], { voiceLead: 0.3 });
  assert.equal(compileEditPlan(delayed, pictures, voices).draft.titles![0].start, 0.3);
});
test('agent plans reject short pictures, changed media, source overrun and overlapping spoken beats', () => {
  const short = plan();
  short.beats[0].visuals[0].end = 1;
  assert.throws(() => compileEditPlan(short, pictures, voices), /will not be truncated/);
  const changed = plan();
  changed.beats[0].visuals[0].sha256 = 'f'.repeat(64);
  assert.throws(() => compileEditPlan(changed, pictures, voices), /changed picture/);
  const missingVoice = plan();
  missingVoice.beats[0].voice.sha256 = 'f'.repeat(64);
  assert.throws(() => compileEditPlan(missingVoice, pictures, voices), /changed voice/);
  const overrun = plan();
  overrun.beats[0].visuals[0].end = 11;
  assert.throws(() => compileEditPlan(overrun, pictures, voices), /exceeds its source/);
  const overlap = plan();
  overlap.beats[0].visuals[0].end = 4;
  overlap.beats[1].visuals[0] = { ...overlap.beats[1].visuals[0], start: 4, end: 8, dissolve: 1 };
  assert.throws(
    () => compileEditPlan(overlap, pictures, new Map([[voiceId, { ...voice, duration: 3.4 }]])),
    /overlaps across a dissolve/,
  );
});
test('canonical export digests ignore object property order but distinguish changed edit timing', () => {
  assert.equal(
    contentDigest({ b: 1, a: { d: 2, c: 3 } }),
    contentDigest({ a: { c: 3, d: 2 }, b: 1 }),
  );
  assert.notEqual(contentDigest({ start: 1 }), contentDigest({ start: 1.01 }));
});
