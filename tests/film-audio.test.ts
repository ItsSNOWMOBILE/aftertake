import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioGain, type AudioEnvelopeTrack } from '../src/film-audio.js';
import { filmAudioSchema, filmManifestSchema, filmRequestSchema } from '../src/film.js';

const track = {
  assetId: 'ca56f918-ba61-4935-86ca-13814f22d56c',
  start: 0.25,
  sourceStart: 1,
  sourceEnd: 3,
  volume: 0.6,
};

test('linear audio ramps follow the trimmed local clock and multiply when overlapping', () => {
  const fades = { ...track, fadeIn: 0.5, fadeOut: 0.75 };
  assert.equal(audioGain(fades, 0), 0);
  assert.equal(audioGain(fades, 0.25), 0.3);
  assert.equal(audioGain(fades, 0.75), 0.6);
  assert.ok(Math.abs(audioGain(fades, 1.625) - 0.3) < 1e-12);
  for (const elapsed of [-0.01, 2, 3, NaN, Infinity]) assert.equal(audioGain(fades, elapsed), 0);

  const overlap: AudioEnvelopeTrack = { ...track, fadeIn: 2, fadeOut: 2 };
  assert.equal(audioGain(overlap, 1), 0.6 * 0.5 * 0.5);
  // The restarted copy begins at silence regardless of its source's phase.
  assert.equal(audioGain(overlap, 0), 0);
  assert.ok(audioGain(overlap, 2 - 1 / 48000) < 0.00001);
});

test('absent and explicit zero fades preserve the previous constant active gain', () => {
  for (const elapsed of [0, 0.25, 1.5, 2 - 1 / 48000]) {
    assert.equal(audioGain(track, elapsed), track.volume);
    assert.equal(audioGain({ ...track, fadeIn: 0, fadeOut: 0 }, elapsed), track.volume);
  }
  assert.deepEqual(filmAudioSchema.parse(track), track, 'Legacy projects acquire no new fields.');
});

test('fade settings reject invalid values and independently fit the trim, permitting overlap', () => {
  assert.equal(filmAudioSchema.safeParse({ ...track, fadeIn: 2, fadeOut: 2 }).success, true);
  assert.equal(
    filmAudioSchema.safeParse({ ...track, sourceStart: 0.1, sourceEnd: 0.3, fadeIn: 0.2 }).success,
    true,
  );
  for (const invalid of [-0.001, 2.001, 10.001, NaN, Infinity, '0.2', null, true]) {
    for (const field of ['fadeIn', 'fadeOut']) {
      assert.equal(filmAudioSchema.safeParse({ ...track, [field]: invalid }).success, false);
    }
  }
  assert.equal(filmAudioSchema.safeParse({ ...track, sourceEnd: 0, fadeIn: 0 }).success, false);
});

test('requests and portable manifests retain each track fade without changing its source trim', () => {
  const audio = { ...track, fadeIn: 0.3, fadeOut: 0.45 };
  const draft = {
    name: 'A clean soundtrack join',
    aspect: 'landscape',
    shots: [{ assetId: track.assetId, start: 0, end: 3 }],
    audio: [audio],
  };
  assert.deepEqual(filmRequestSchema.parse(draft).audio, [audio]);
  const portable = filmManifestSchema.parse({
    ...draft,
    format: 'aftertake-film/2',
    shots: [{ ...draft.shots[0], sha256: 'a'.repeat(64) }],
    audio: [{ ...audio, sha256: 'b'.repeat(64) }],
  });
  assert.deepEqual(portable.audio, [{ ...audio, sha256: 'b'.repeat(64) }]);
});
