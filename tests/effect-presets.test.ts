import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  subjectEffectPresets,
  depthEffectPresets,
  subjectEffectPresetSchema,
  depthEffectPresetSchema,
  applySubjectEffectPreset,
  applyDepthEffectPreset,
  matchingSubjectEffectPreset,
  matchingDepthEffectPreset,
} from '../src/effect-presets.js';
import { subjectEffectRecipeSchema, subjectEffectRequestSchema } from '../src/subject-effects.js';
import { depthEffectRequestSchema, defaultDepthSettings } from '../src/depth-effects.js';

const subject = subjectEffectRecipeSchema.parse(
  JSON.parse(
    await readFile(new URL('../examples/subject-duplicates/recipe.json', import.meta.url), 'utf8'),
  ),
).request;
const depth = depthEffectRequestSchema.parse({
  format: 'aftertake-depth-effect/1',
  name: 'My named picture',
  clip: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Original picture',
    kind: 'image',
    sha256: 'a'.repeat(64),
    width: 640,
    height: 384,
    duration: 1,
    url: '/media/source.png',
  },
  settings: defaultDepthSettings,
});

test('the small preset catalog validates against actual requests and cannot contain source overrides', () => {
  assert.equal(subjectEffectPresets.length, 5);
  assert.equal(depthEffectPresets.length, 3);
  for (const [catalog, schema] of [
    [subjectEffectPresets, subjectEffectPresetSchema],
    [depthEffectPresets, depthEffectPresetSchema],
  ] as const) {
    assert.equal(new Set(catalog.map((preset) => preset.id)).size, catalog.length);
    for (const preset of catalog) assert.equal(schema.safeParse(preset).success, true);
  }
  for (const preset of subjectEffectPresets) {
    assert.equal(
      subjectEffectRequestSchema.safeParse(applySubjectEffectPreset(subject, preset.id)).success,
      true,
    );
    for (const extra of [
      { selectionId: subject.selectionId },
      { maskSha256: subject.maskSha256 },
      { name: 'Override' },
    ])
      assert.equal(
        subjectEffectPresetSchema.safeParse({
          ...preset,
          settings: { ...preset.settings, ...extra },
        }).success,
        false,
      );
  }
  for (const preset of depthEffectPresets) {
    assert.equal(
      depthEffectRequestSchema.safeParse(applyDepthEffectPreset(depth, preset.id)).success,
      true,
    );
    assert.equal(
      depthEffectPresetSchema.safeParse({
        ...preset,
        settings: { ...preset.settings, clip: depth.clip },
      }).success,
      false,
    );
    assert.match(preset.description, /Still image/);
  }
  assert.equal(
    subjectEffectPresetSchema.safeParse({
      ...subjectEffectPresets[0],
      settings: {
        ...subjectEffectPresets[0].settings,
        copies: [{ x: 2, y: 0, scale: 1, opacity: 1 }],
      },
    }).success,
    false,
  );
  assert.equal(
    depthEffectPresetSchema.safeParse({
      ...depthEffectPresets[0],
      settings: { ...depthEffectPresets[0].settings, blur: 33 },
    }).success,
    false,
  );
});

test('subject preset application preserves the reviewed source binding and isolates every editable copy', () => {
  const original = structuredClone(subject);
  const state = {
    request: subject,
    history: [{ request: subject, state: 'running' }],
    pendingKey: 'rejoin-existing-job',
  };
  const applied = {
    ...state,
    request: applySubjectEffectPreset(state.request, 'three-person-ensemble'),
  };
  assert.equal(applied.history, state.history);
  assert.equal(applied.pendingKey, state.pendingKey);
  for (const key of ['format', 'name', 'selectionId', 'maskSha256'] as const)
    assert.equal(applied.request[key], subject[key]);
  assert.deepEqual(
    applied.request.copies.map(({ x, opacity, flipX }) => ({ x, opacity, flipX })),
    [
      { x: -0.28, opacity: 1, flipX: false },
      { x: 0.28, opacity: 1, flipX: true },
    ],
  );
  const repeated = applySubjectEffectPreset(subject, 'three-person-ensemble');
  applied.request.copies[0].x = -0.4;
  assert.equal(repeated.copies[0].x, -0.28);
  assert.equal(subjectEffectPresets[0].settings.copies[0].x, -0.28);
  assert.deepEqual(subject, original);
  assert.equal(matchingSubjectEffectPreset(repeated)?.id, 'three-person-ensemble');
  assert.equal(matchingSubjectEffectPreset(applied.request), undefined);
  assert.equal(
    matchingSubjectEffectPreset({
      ...repeated,
      name: 'Renamed',
      selectionId: '22222222-2222-4222-8222-222222222222',
    })?.id,
    'three-person-ensemble',
  );
  assert.throws(() => applySubjectEffectPreset(subject, 'unknown'), /Unknown subject/);
  const focus = applySubjectEffectPreset(repeated, 'background-focus');
  assert.equal(focus.copies.length, 0);
  assert.equal(focus.backgroundBlur, 10);
  const mirrors = applySubjectEffectPreset(focus, 'mirror-partner');
  assert.equal(mirrors.backgroundBlur, 0);
  assert.equal(mirrors.backgroundExposureEV, 0);
});

test('depth presets keep the exact image and name while resetting unrelated effects and exposing custom edits', () => {
  const original = structuredClone(depth);
  const lit = applyDepthEffectPreset(depth, 'directional-depth-light');
  assert.equal(lit.clip, depth.clip);
  assert.equal(lit.name, depth.name);
  assert.equal(lit.format, depth.format);
  assert.equal(lit.settings.lightStrength, 0.18);
  assert.equal(matchingDepthEffectPreset(lit.settings)?.id, 'directional-depth-light');
  const focus = applyDepthEffectPreset(lit, 'natural-depth-focus');
  assert.equal(focus.settings.lightStrength, 0);
  assert.equal(focus.settings.haze, 0);
  assert.equal(focus.settings.blur, 6);
  lit.settings.haze = 0.8;
  assert.equal(matchingDepthEffectPreset(lit.settings), undefined);
  assert.equal(applyDepthEffectPreset(depth, 'directional-depth-light').settings.haze, 0);
  assert.deepEqual(depth, original);
  assert.throws(() => applyDepthEffectPreset(depth, 'unknown'), /Unknown depth/);
});
