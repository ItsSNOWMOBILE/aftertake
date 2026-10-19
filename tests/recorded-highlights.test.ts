import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordedHighlights, {
  recordedFirst,
  selectRecordedWork,
} from '../src/RecordedHighlights.js';
import type {
  CharacterJob,
  CharacterRequest,
  CharacterSelectionRequest,
} from '../src/character.js';
import type { VideoGeneration } from '../src/video-generation.js';

async function fixtures() {
  const read = async (name: string) =>
    JSON.parse(await readFile(new URL('../examples/' + name, import.meta.url), 'utf8'));
  const selection = (await read('character-h3-high/selection.json')) as CharacterJob;
  const replacement = (await read('character-h3-high/render.json')) as CharacterJob;
  const portrait = (await read('text-video/portrait/generation.json')) as VideoGeneration;
  const square = (await read('text-video/square/generation.json')) as VideoGeneration;
  const clips = [
    (selection.request as CharacterSelectionRequest).clip,
    (replacement.request as CharacterRequest).reference,
    replacement.clip!,
    portrait.clip!,
    square.clip!,
  ];
  return { selection, replacement, portrait, square, clips };
}

test('featured recorded work needs a usable completed H3 bundle and a completed portrait take', async () => {
  const { selection, replacement, portrait, square, clips } = await fixtures();
  const jobs = [selection, replacement];
  const videos = [square, portrait];
  const before = structuredClone({ jobs, videos });
  const featured = selectRecordedWork(clips, jobs, videos);
  assert.equal(featured.character?.id, replacement.id);
  assert.equal(
    featured.video?.id,
    portrait.id,
    'The newer square draft must not displace the portrait example.',
  );
  assert.deepEqual(
    { jobs, videos },
    before,
    'Presentation must not alter saved jobs or history ordering.',
  );
  assert.equal(
    selectRecordedWork(clips, [{ ...replacement, state: 'running' }, selection], videos).character,
    undefined,
  );
  assert.equal(selectRecordedWork(clips, [replacement], videos).character, undefined);
  assert.equal(
    selectRecordedWork(
      clips.filter((c) => c.id !== (replacement.request as CharacterRequest).reference.id),
      jobs,
      videos,
    ).character,
    undefined,
  );
  assert.equal(
    selectRecordedWork(clips, jobs, [{ ...portrait, state: 'failed' }, square]).video,
    undefined,
  );
  const selectedHistory = recordedFirst(videos, portrait.id);
  assert.equal(
    selectedHistory[0].id,
    featured.video!.id,
    'Opening the card must preview the same take in its dedicated studio.',
  );
  assert.deepEqual(
    selectedHistory.slice(1).map((item) => item.id),
    [square.id],
  );
  assert.deepEqual(videos, before.videos);
});

test('featured cards expose actual output dimensions and audio with posters rather than video elements', async () => {
  const { selection, replacement, portrait, clips } = await fixtures();
  const work = selectRecordedWork(clips, [selection, replacement], [portrait]);
  const markup = renderToStaticMarkup(
    createElement(RecordedHighlights, { work, busy: false, onOpen() {} }),
  );
  assert.match(markup, /Featured recorded work/);
  assert.match(markup, /1536 × 640/);
  assert.match(markup, /576 × 1024/);
  assert.match(markup, /Silent output/);
  assert.match(markup, /With audio/);
  assert.match(markup, /Watch character replacement/);
  assert.match(markup, /Watch text-to-video/);
  assert.doesNotMatch(markup, /<video|\.mp4/);
  assert.match(markup, new RegExp('/api/thumbnails/' + replacement.clip!.id));
  assert.match(markup, new RegExp('/api/thumbnails/' + portrait.clip!.id));
  assert.equal(
    renderToStaticMarkup(createElement(RecordedHighlights, { work: {}, busy: false, onOpen() {} })),
    '',
  );
});
