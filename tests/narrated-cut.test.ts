import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNarratedCut } from '../server/narrated-cut.js';
import { contentDigest } from '../server/edit-plan.js';
import {
  filmExportKey,
  exportAttemptKey,
  narratedRowKeys,
  narrationFromFilm,
} from '../src/narrated-cut.js';
import type { FilmAsset } from '../src/film.js';

const picture = '00000000-0000-4000-8000-000000000001',
  voiceId = '00000000-0000-4000-8000-000000000002';
const voice = {
  id: voiceId,
  name: 'Whole line',
  kind: 'audio',
  sha256: 'b'.repeat(64),
  duration: 1.29,
  extension: '.wav',
  url: '/voice',
  createdAt: 'now',
  narration: {
    text: 'Your morning called.',
    voice: 'af_heart',
    speed: 1.05,
    model: 'Kokoro',
    modelSha256: 'c'.repeat(64),
    voicesSha256: 'd'.repeat(64),
    runner: 'CPU',
  },
} as FilmAsset;
const pictures = new Map([
    [picture, { id: picture, kind: 'video' as const, sha256: 'a'.repeat(64), duration: 10 }],
  ]),
  voices = new Map([[voiceId, voice]]);
const input = () => ({
  name: 'A faster coffee story',
  aspect: 'portrait',
  look: 'bold',
  dissolve: 0.125,
  pace: 'quick',
  beats: [
    {
      shot: {
        assetId: picture,
        start: 0.5,
        end: 10,
        framing: { zoom: 1, endZoom: 1, x: 0.4, y: 0.5 },
      },
      pictureSHA256: 'a'.repeat(64),
      text: 'Your morning called.',
      voice: { assetId: voiceId, sha256: voice.sha256 },
    },
    {
      shot: { assetId: picture, start: 3, end: 10 },
      pictureSHA256: 'a'.repeat(64),
      text: 'Your morning called.',
      voice: { assetId: voiceId, sha256: voice.sha256 },
    },
  ],
});

test('reopened narrated cuts recover saved lines/settings without accepting truncated or ambiguous voice pairings', () => {
  const cut = prepareNarratedCut(input(), pictures, voices),
    assets = [voice];
  assert.deepEqual(narrationFromFilm(cut.draft, assets), {
    lines: [voice.narration!.text, voice.narration!.text],
    settings: { voice: 'af_heart', speed: 1.05, look: 'bold', pace: 'quick', dissolve: 0.125 },
  });
  const relaxed = prepareNarratedCut({ ...input(), pace: 'relaxed' }, pictures, voices);
  assert.equal(narrationFromFilm(relaxed.draft, assets)?.settings.pace, 'relaxed');
  const trimmed = structuredClone(cut.draft);
  trimmed.audio![0].sourceEnd -= 0.2;
  assert.equal(narrationFromFilm(trimmed, assets), null);
  const ambiguous = structuredClone(cut.draft);
  ambiguous.audio![1].start = ambiguous.audio![0].start;
  assert.equal(narrationFromFilm(ambiguous, assets), null);
  assert.equal(narrationFromFilm(cut.draft, [{ ...voice, narration: undefined }]), null);
  const mixed = structuredClone(cut.draft),
    other = {
      ...voice,
      id: '00000000-0000-4000-8000-000000000003',
      narration: { ...voice.narration!, voice: 'am_michael' as const },
    };
  mixed.audio![1].assetId = other.id;
  assert.equal(narrationFromFilm(mixed, [voice, other]), null);
});

test('narrated cuts measure whole voices, keep trim origins and pair captions with actual speech on a shared frame clock', () => {
  const cut = prepareNarratedCut(input(), pictures, voices);
  assert.equal(cut.draft.shots[0].start, 0.5);
  assert.equal(cut.draft.shots[0].end, 52 / 24);
  assert.deepEqual(cut.draft.shots[0].framing, input().beats[0].shot.framing);
  assert.equal(cut.draft.shots[1].start, 3);
  assert.equal(cut.draft.shots[1].end, 112 / 24);
  assert.equal(cut.duration, 77 / 24);
  assert.deepEqual(
    cut.draft.audio!.map((a) => [a.start, a.sourceStart, a.sourceEnd]),
    [
      [0.125, 0, 1.29],
      [40 / 24, 0, 1.29],
    ],
  );
  assert.ok(cut.ledger[1].voiceStart! >= cut.ledger[0].voiceEnd! + 0.08);
  assert.deepEqual(
    cut.draft.titles!.map((t) => [t.text, t.start, t.style, t.position]),
    [
      [voice.narration!.text, 0.125, 'headline', 'center'],
      [voice.narration!.text, 40 / 24, 'headline', 'center'],
    ],
  );
  assert.equal(cut.draft.sourceVolume, 0);
  assert.equal(cut.draft.normalizeAudio, true);
  assert.equal(cut.identity, prepareNarratedCut(input(), pictures, voices).identity);
  const relaxed = prepareNarratedCut({ ...input(), pace: 'relaxed' }, pictures, voices);
  assert.equal(relaxed.duration, cut.duration + 0.5);
  const smooth = prepareNarratedCut({ ...input(), dissolve: 0.25 }, pictures, voices);
  assert.ok(smooth.draft.titles![0].end <= smooth.draft.titles![1].start);
  assert.equal(smooth.draft.titles![0].end, smooth.ledger[0].voiceEnd! + 0.08);
  const three = { ...input(), beats: [...input().beats, input().beats[1]] };
  assert.deepEqual(
    prepareNarratedCut(three, pictures, voices).draft.titles!.map((t) => t.fontSize),
    [132, 72, 132],
  );
  assert.ok(
    prepareNarratedCut({ ...three, look: 'captions' }, pictures, voices).draft.titles!.every(
      (t) => t.fontSize === 48 && t.style === 'caption',
    ),
  );
});
test('narrated cuts refuse short footage, changed source or voice bytes, mismatched scripts and source overruns', () => {
  const short = input();
  short.beats[0].shot.end = 1.5;
  assert.throws(
    () => prepareNarratedCut(short, pictures, voices),
    /Line 1 needs.*Extend its Out trim/,
  );
  const wrong = input();
  wrong.beats[0].text = 'A different line.';
  assert.throws(() => prepareNarratedCut(wrong, pictures, voices), /exact line/);
  const hash = input();
  hash.beats[0].pictureSHA256 = 'f'.repeat(64);
  assert.throws(() => prepareNarratedCut(hash, pictures, voices), /picture changed/);
  const badVoice = input();
  badVoice.beats[0].voice.sha256 = 'f'.repeat(64);
  assert.throws(() => prepareNarratedCut(badVoice, pictures, voices), /complete local voice/);
  const over = input();
  over.beats[0].shot.end = 11;
  assert.throws(() => prepareNarratedCut(over, pictures, voices), /Out trim exceeds/);
});
test('browser exports use the native content identity, rejoin uncertain work and only retry observed failures', async () => {
  const draft = prepareNarratedCut(input(), pictures, voices).draft,
    key = await filmExportKey(draft);
  assert.equal(key, 'film-r4-' + contentDigest(draft));
  assert.notEqual(await filmExportKey(draft, 1), key);
  assert.equal(exportAttemptKey(key, []), key);
  assert.equal(exportAttemptKey(key, [{ requestKey: key, state: 'assembling' }]), key);
  assert.equal(exportAttemptKey(key, [{ requestKey: key, state: 'ready' }]), key);
  assert.equal(exportAttemptKey(key, [{ requestKey: key, state: 'failed' }]), key + '-retry-1');
  assert.equal(
    exportAttemptKey(key, [
      { requestKey: key, state: 'failed' },
      { requestKey: key + '-retry-1', state: 'assembling' },
    ]),
    key + '-retry-1',
  );
  assert.equal(
    exportAttemptKey(key, [{ requestKey: key + '-retry-1', state: 'failed' }]),
    key + '-retry-2',
  );
  assert.notEqual(await filmExportKey({ ...draft, name: 'Another story' }), key);
  const rows = [
    { assetId: picture, start: 0, end: 2 },
    { assetId: voiceId, start: 0, end: 2 },
  ];
  assert.deepEqual(narratedRowKeys(rows).reverse(), narratedRowKeys([...rows].reverse()));
});

test('follow-voice cuts use the measured words of the selected voice and reject unavailable or changed wording', () => {
  const timed: FilmAsset = {
    ...voice,
    narration: {
      ...voice.narration!,
      timedWords: true,
      wordTiming: {
        method: 'kokoro-phoneme-durations/1',
        words: [
          { text: 'Your', start: 0.06, end: 0.24 },
          { text: 'morning', start: 0.3, end: 0.69 },
          { text: 'called.', start: 0.72, end: 1.05 },
        ],
      },
    },
  };
  const cut = prepareNarratedCut(
    { ...input(), look: 'spoken' },
    pictures,
    new Map([[voiceId, timed]]),
  );
  assert.ok(
    cut.draft.titles!.every(
      (t) => t.animation === 'spoken' && t.style === 'headline' && t.position === 'center',
    ),
  );
  assert.deepEqual(
    cut.draft.titles![0].words,
    timed.narration!.wordTiming!.words.map((word) => ({ ...word, phrase: 0 })),
  );
  assert.equal(cut.draft.audio![0].sourceEnd, voice.duration);
  assert.throws(
    () => prepareNarratedCut({ ...input(), look: 'spoken' }, pictures, voices),
    /needs usable word timings/,
  );
  const changed = structuredClone(timed);
  changed.narration!.wordTiming!.words[0].text = 'Their';
  assert.throws(
    () =>
      prepareNarratedCut({ ...input(), look: 'spoken' }, pictures, new Map([[voiceId, changed]])),
    /exact voice/,
  );
});
