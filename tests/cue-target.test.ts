import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cuePreviewSettings,
  paintedCue,
  replacePaintedCue,
  separateComposite,
} from '../src/cue-target.js';
import { type Recipe } from '../src/domain.js';
import { spatialMask } from '../src/mask.js';

const recipe: Recipe = {
  format: 'aftertake/1',
  name: 'Boundary test',
  clip: {
    id: 'a7e24e70-2168-4e9c-b97f-06ae1401f558',
    name: 'source.mp4',
    sha256: 'a'.repeat(64),
    width: 768,
    height: 432,
    duration: 5,
    url: '/media/test.mp4',
  },
  prompt: 'Molten gold follows the waterfall',
  pipeline: 'inpaint',
  quality: 'final',
  seed: 5090,
  trimStart: 0,
  cue: {
    start: 0.4,
    end: 2.9,
    fade: 0.4,
    feather: 0.03,
    tracking: 'flow',
    anchor: 1,
    strokes: [
      {
        radius: 0.23,
        points: [
          { x: 0.5, y: 0.2 },
          { x: 0.5, y: 0.7 },
        ],
      },
    ],
  },
};

test('final-area editing narrows the visible matte without changing the model context', () => {
  const original = structuredClone(recipe);
  const separate = separateComposite(recipe, true);
  assert.notEqual(separate.compositeRegion!.strokes, recipe.cue.strokes);
  const final = paintedCue(separate, 'composite');
  const updated = replacePaintedCue(separate, 'composite', {
    ...final,
    start: 0,
    end: 5,
    fade: 0,
    strokes: final.strokes.map((stroke) => ({ ...stroke, radius: 0.11 })),
  });
  assert.deepEqual(recipe, original, 'Enabling and editing must not mutate the source recipe.');
  assert.deepEqual(updated.cue, original.cue, 'Generation context remains unchanged.');
  assert.equal(paintedCue(updated, 'composite').start, original.cue.start);
  assert.equal(paintedCue(updated, 'composite').end, original.cue.end);
  assert.equal(paintedCue(updated, 'composite').fade, original.cue.fade);
  const broad = spatialMask(160, 90, updated.cue);
  const narrow = spatialMask(160, 90, paintedCue(updated, 'composite'));
  const opaque = (pixels: Uint8ClampedArray) =>
    pixels.filter((_, i) => i % 4 === 3 && pixels[i] === 255).length;
  assert.ok(
    opaque(narrow) < opaque(broad) / 2,
    'The tighter final paint protects more source pixels.',
  );
  assert.equal(paintedCue(updated, 'generation'), updated.cue);
});

test('clear, undo and repaint target only the chosen area; shared timing follows the cue', () => {
  const separate = separateComposite(recipe, true);
  const cleared = replacePaintedCue(separate, 'composite', {
    ...paintedCue(separate, 'composite'),
    strokes: [],
  });
  assert.equal(cleared.compositeRegion!.strokes.length, 0);
  assert.deepEqual(cleared.cue.strokes, recipe.cue.strokes);
  const retimed = { ...cleared, cue: { ...cleared.cue, start: 1, end: 3.5, fade: 0.2 } };
  assert.equal(paintedCue(retimed, 'composite').start, 1);
  assert.equal(paintedCue(retimed, 'composite').end, 3.5);
  assert.equal(paintedCue(retimed, 'composite').fade, 0.2);
  const legacy = separateComposite(retimed, false);
  assert.ok(!('compositeRegion' in legacy));
  assert.equal(paintedCue(legacy, 'composite'), legacy.cue);
});

test('unsupported modes cannot create a separate region', () => {
  for (const pipeline of ['cinema', 'motion-transfer'] as const) {
    const unsupported = separateComposite({ ...separateComposite(recipe, true), pipeline }, true);
    assert.ok(!('compositeRegion' in unsupported));
    assert.equal(paintedCue(unsupported, 'composite'), unsupported.cue);
  }
});

test('final matte preview uses the direct output source grid instead of the padded model grid', () => {
  const separate = separateComposite(recipe, true);
  const context = cuePreviewSettings(separate, 'generation');
  const final = cuePreviewSettings(separate, 'composite');
  assert.equal(context.width, 768);
  assert.equal(context.height, 448);
  assert.equal(final.width, 768);
  assert.equal(final.height, 432);
  assert.equal(final.frames, context.frames);
  assert.equal(final.fps, context.fps);
  assert.equal(final.cue.start, context.cue.start);
  assert.equal(final.cue.end, context.cue.end);
  assert.equal(final.cue.fade, context.cue.fade);
});
