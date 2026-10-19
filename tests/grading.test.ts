import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  colorChannels,
  curveChannels,
  curveSchema,
  defaultCurves,
  defaultSelectiveColor,
  lutDescriptorSchema,
  sampleCurve,
} from '../src/grading.js';
import {
  defaultFinishingSettings,
  finishingIsIdentity,
  finishingRequestSchema,
  finishingRecipeSchema,
  finishingSourceFiles,
} from '../src/finishing.js';

test('advanced grade schemas normalize older settings and reject invalid curves/channels/domains', () => {
  const clip = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Source',
    url: '/media/a.png',
    sha256: 'a'.repeat(64),
    width: 64,
    height: 64,
    duration: 1,
    kind: 'image',
  };
  const base = {
    format: 'aftertake-finishing/1',
    name: 'Grade',
    clip,
    settings: { ...defaultFinishingSettings },
  };
  for (const points of [
    [],
    [{ x: 0, y: 0 }],
    [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0.8 },
      { x: 1, y: 0.2 },
    ],
    [
      { x: 0.1, y: 0 },
      { x: 1, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: NaN },
    ],
  ])
    assert(!curveSchema.safeParse(points).success);
  for (const channel of colorChannels) {
    const settings = structuredClone(defaultFinishingSettings);
    settings.selectiveColor[channel].hueDegrees = 30;
    assert(finishingRequestSchema.safeParse({ ...base, settings }).success);
    assert(!finishingIsIdentity(settings));
    settings.selectiveColor[channel].hueDegrees = 30.1;
    assert(!finishingRequestSchema.safeParse({ ...base, settings }).success);
  }
  const older = Object.fromEntries(
    Object.entries(defaultFinishingSettings).filter(
      ([key]) => !['selectiveColor', 'curves', 'lut', 'lutStrength'].includes(key),
    ),
  );
  assert.deepEqual(
    finishingRequestSchema.parse({ ...base, settings: older }).settings,
    defaultFinishingSettings,
  );
  assert(
    !finishingRequestSchema.safeParse({ ...base, settings: { ...base.settings, lutStrength: 1 } })
      .success,
  );
  const lut = {
    sha256: 'b'.repeat(64),
    title: 'Look',
    size: 2,
    domainMin: [0.2, 0.2, 0.2],
    domainMax: [0.8, 0.8, 0.8],
    interpolation: 'trilinear',
    colorSpace: 'srgb',
  };
  assert(lutDescriptorSchema.safeParse(lut).success);
  assert(!lutDescriptorSchema.safeParse({ ...lut, domainMax: [0.1, 0.8, 0.8] }).success);
  assert(!lutDescriptorSchema.safeParse({ ...lut, path: 'C:/secret' }).success);
  assert(!lutDescriptorSchema.safeParse({ ...lut, colorSpace: 'log' }).success);
});

test('curve drawing uses monotone cubic samples and exact identity anchors', () => {
  const points = [
    { x: 0, y: 0.1 },
    { x: 0.2, y: 0.15 },
    { x: 0.7, y: 0.85 },
    { x: 1, y: 0.9 },
  ];
  const samples = sampleCurve(points, 1001);
  assert.equal(samples[0].y, 0.1);
  assert.equal(samples.at(-1)!.y, 0.9);
  samples.forEach((sample, index) => {
    assert(sample.y >= 0.1 - 1e-12 && sample.y <= 0.9 + 1e-12);
    if (index) assert(sample.y >= samples[index - 1].y - 1e-12);
  });
  for (const curve of curveChannels)
    for (const point of sampleCurve(defaultCurves[curve]))
      assert(Math.abs(point.x - point.y) < 1e-12);
  for (const channel of colorChannels)
    assert.deepEqual(defaultSelectiveColor[channel], {
      hueDegrees: 0,
      saturation: 0,
      lightness: 0,
    });
});

test('portable LUT companions bind their original cube hash rather than a client path', () => {
  const lut = lutDescriptorSchema.parse({
    sha256: 'b'.repeat(64),
    title: 'Look',
    size: 2,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    interpolation: 'trilinear',
    colorSpace: 'srgb',
  });
  const settings = { ...defaultFinishingSettings, lut, lutStrength: 0.7 };
  const recipe = {
    format: 'aftertake-finishing-recipe/1',
    processor: 'aftertake-cpu-finishing/1',
    sourceSha256: 'a'.repeat(64),
    request: {
      format: 'aftertake-finishing/1',
      name: 'Grade',
      clip: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Source',
        url: '/media/a.png',
        sha256: 'a'.repeat(64),
        width: 64,
        height: 64,
        duration: 1,
        kind: 'image',
      },
      settings,
    },
    sourceFiles: finishingSourceFiles(settings),
  };
  assert(finishingRecipeSchema.safeParse(recipe).success);
  assert(
    !finishingRecipeSchema.safeParse({
      ...recipe,
      sourceFiles: [{ role: 'lut', sha256: 'c'.repeat(64), filename: `${'c'.repeat(64)}.cube` }],
    }).success,
  );
  assert(
    !finishingRecipeSchema.safeParse({
      ...recipe,
      sourceFiles: [{ role: 'lut', sha256: lut.sha256, filename: '../../look.cube' }],
    }).success,
  );
});
