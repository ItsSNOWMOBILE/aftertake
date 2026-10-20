import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { register } from 'node:module';
import type { CharacterJob, CharacterSelectionRequest } from '../src/character.js';
import { subjectEffectRequestSchema } from '../src/subject-effects.js';

// SSR exercises the real component; native browser styles do not participate in its markup.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}`),
  import.meta.url,
);
const {
  default: SubjectEffects,
  reviewedSubjectSelection,
  subjectEffectSettingsKey,
} = await import('../src/SubjectEffects.js');
const { default: CharacterStudio, restoreTrackedSelection } =
  await import('../src/CharacterStudio.js');

const request: CharacterSelectionRequest = {
  format: 'aftertake-character-selection/1',
  clip: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'My original performance',
    sha256: 'a'.repeat(64),
    width: 640,
    height: 384,
    duration: 5,
    hasAudio: true,
    url: '/media/source.mp4',
  },
  trimStart: 1,
  duration: 2,
  positive: [{ x: 0.5, y: 0.5 }],
  negative: [],
};
const selection: CharacterJob = {
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'selection',
  state: 'succeeded',
  request,
  progress: 1,
  createdAt: '2026-10-19T00:00:00Z',
  updatedAt: '2026-10-19T00:00:00Z',
  workflow: {},
  selection: {
    width: 640,
    height: 384,
    frames: 48,
    fps: 24,
    emptyFrames: [],
    maskSha256: 'b'.repeat(64),
    sourceSha256: 'c'.repeat(64),
  },
};

test('subject effects require a complete saved selection, independent of generation engine state', () => {
  const reviewed = reviewedSubjectSelection(selection)!;
  assert.equal(reviewed.id, selection.id);
  assert.equal(reviewed.info.maskSha256, selection.selection!.maskSha256);
  assert.equal(reviewed.request.trimStart, 1);
  assert.equal(reviewedSubjectSelection(undefined), undefined);
  assert.equal(reviewedSubjectSelection({ ...selection, state: 'running' }), undefined);
  assert.equal(reviewedSubjectSelection({ ...selection, kind: 'replacement' }), undefined);
  assert.equal(
    reviewedSubjectSelection({
      ...selection,
      selection: { ...selection.selection!, emptyFrames: [14] },
    }),
    undefined,
  );
  assert.equal(
    reviewedSubjectSelection({
      ...selection,
      selection: { ...selection.selection!, sourceSha256: undefined },
    }),
    undefined,
  );

  const markup = renderToStaticMarkup(
    createElement(SubjectEffects, {
      selection,
      onImport() {},
      onUse() {},
      onClose() {},
    }),
  );
  assert.match(markup, /Build video preview/);
  assert.match(markup, /Source audio retained/);
  assert.match(markup, /No ComfyUI connection or credits required/);
  assert.match(markup, /640 × 384/);
  assert.match(markup, /aria-label="Subject effect preset"/);
  for (const label of [
    'Three-person ensemble',
    'Mirror partner',
    'Translucent copies',
    'Color silhouette echoes',
    'Background focus',
    'Subtle focus',
  ])
    assert.ok(markup.includes(label));
  assert.match(markup, /Applying a preset does not render/);
  assert.match(markup, /Copy 1 appearance/);
  assert.match(markup, /Solid silhouette/);
  assert.match(markup, /Behind original person/);
  for (const label of [
    'Horizontal',
    'Vertical',
    'Scale',
    'Rotation',
    'Opacity',
    'Feather',
    'Grow / shrink',
    'Background blur',
    'Background exposure',
  ])
    assert.ok(markup.includes(`aria-label="${label}"`), `Missing ${label} control`);
  assert.doesNotMatch(markup, /<video|\.mp4/);
});

test('subject-effect identity includes matte and all editable transforms while normalizing optional defaults', () => {
  const base = subjectEffectRequestSchema.parse({
    format: 'aftertake-subject-effect/1',
    name: ' A copy ',
    selectionId: selection.id,
    maskSha256: selection.selection!.maskSha256,
    copies: [{ x: 0.22, y: 0, scale: 1, opacity: 1 }],
  });
  const key = subjectEffectSettingsKey(base);
  assert.equal(
    key,
    subjectEffectSettingsKey({
      ...base,
      feather: 0,
      grow: 0,
      backgroundBlur: 0,
      backgroundExposureEV: 0,
      copies: [{ ...base.copies[0], flipX: false, rotation: 0 }],
    }),
  );
  for (const patch of [
    { maskSha256: 'd'.repeat(64) },
    { selectionId: '33333333-3333-4333-8333-333333333333' },
    { feather: 2 },
    { grow: -2 },
    { backgroundBlur: 6 },
    { backgroundExposureEV: -1 },
    { copies: [{ ...base.copies[0], x: -0.2 }] },
    { copies: [{ ...base.copies[0], y: 0.2 }] },
    { copies: [{ ...base.copies[0], scale: 0.5 }] },
    { copies: [{ ...base.copies[0], opacity: 0.5 }] },
    { copies: [{ ...base.copies[0], rotation: 30 }] },
    { copies: [{ ...base.copies[0], flipX: true }] },
    { copies: [{ ...base.copies[0], color: '#ff2a96' }] },
    { copies: [{ ...base.copies[0], behindSubject: true }] },
    { copies: [] },
  ])
    assert.notEqual(key, subjectEffectSettingsKey({ ...base, ...patch }));
});

test('first-use subject effects explain tracking or portable restore before a result exists', () => {
  const markup = renderToStaticMarkup(
    createElement(SubjectEffects, {
      onImport() {},
      onUse() {},
      onClose() {},
    }),
  );
  assert.match(markup, /Track a person and review the complete selection first/);
  assert.match(markup, /Import portable recipe/);
  assert.doesNotMatch(markup, /Build video preview|<video|aria-label="Horizontal"/);
});

test('saved tracking restores exact points, clock and quality after a fresh studio open', () => {
  const tracked: CharacterJob = {
    ...selection,
    request: {
      ...request,
      resolution: '768',
      trimStart: 1.125,
      duration: 2.0416666666666665,
      positive: [
        { x: 0.271, y: 0.432 },
        { x: 0.29, y: 0.73 },
      ],
      negative: [{ x: 0.8, y: 0.5 }],
    },
  };
  const rebound = {
    ...request.clip,
    id: '44444444-4444-4444-8444-444444444444',
    url: '/media/new-local-source.mp4',
  };
  const restored = restoreTrackedSelection(tracked, [rebound])!;
  assert.equal(restored.clip.id, rebound.id);
  assert.equal(restored.clip.sha256, request.clip.sha256);
  assert.equal(restored.resolution, '768');
  assert.equal(restored.trimStart, 1.125);
  assert.equal(restored.duration, 2.0416666666666665);
  assert.deepEqual(restored.positive, (tracked.request as CharacterSelectionRequest).positive);
  assert.deepEqual(restored.negative, (tracked.request as CharacterSelectionRequest).negative);
  assert.equal(
    restoreTrackedSelection(tracked, [{ ...rebound, sha256: 'f'.repeat(64) }]),
    undefined,
  );
  assert.equal(restoreTrackedSelection({ ...tracked, state: 'running' }, [rebound]), undefined);
  assert.equal(
    restoreTrackedSelection(
      { ...tracked, selection: { ...tracked.selection!, emptyFrames: [7] } },
      [rebound],
    ),
    undefined,
  );

  const markup = renderToStaticMarkup(
    createElement(CharacterStudio, {
      clips: [rebound],
      jobs: [tracked],
      otherBusy: false,
      onUpdate() {},
      onImport() {},
      onUse() {},
      onClose() {},
    }),
  );
  assert.match(markup, /aria-label="Saved tracked selection"/);
  assert.match(markup, /Restore a completed selection/);
  assert.match(markup, /My original performance/);
  assert.match(markup, /1\.13–3\.17s · High/);
  const duplicateMarkup = renderToStaticMarkup(
    createElement(SubjectEffects, {
      selections: [tracked],
      onSelectionChange() {},
      onImport() {},
      onUse() {},
      onClose() {},
    }),
  );
  assert.match(duplicateMarkup, /aria-label="Saved tracked person"/);
  assert.match(duplicateMarkup, /Choose existing tracking/);
});
