import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filmGraphicSchema,
  motionAt,
  motionKeyframeSchema,
  motionPreset,
  motionPresets,
  motionProgress,
  motionTrackSchema,
  type FilmGraphic,
  type MotionKeyframe,
  type MotionPresetName,
  type MotionTrack,
} from '../src/film-motion.js';

const identity = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
const first: MotionKeyframe = { at: 0, ...identity };
const arrival: MotionKeyframe = { at: 1, x: 1, y: -1, scale: 3, rotation: 180, opacity: 0 };
const track: MotionTrack = { keys: [first, arrival] };
const graphic: FilmGraphic = {
  id: 'ca56f918-ba61-4935-86ca-13814f22d56c',
  name: 'Lower third panel',
  kind: 'rect',
  start: 0,
  end: 2,
  x: 0.5,
  y: 0.8,
  width: 0.8,
  height: 0.15,
  color: '#D5E991',
  opacity: 0.9,
};
const assetId = 'e77aaec4-a2df-4fd6-8f35-35be29b99104';

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
}

test('absent motion is a fresh identity pose and never mutates a caller or another evaluation', () => {
  const pose = motionAt(undefined, 0.5);
  assert.deepEqual(pose, identity);
  pose.x = 99;
  assert.deepEqual(motionAt(undefined, 0.5), identity);
  assert.deepEqual(motionAt(undefined, Number.NaN), identity);
  const before = structuredClone(track);
  motionAt(track, 0.5).x = 99;
  assert.deepEqual(track, before);
});

test('linear interpolation independently carries offsets, scale, rotation and opacity', () => {
  assert.deepEqual(motionAt(track, 0.25), {
    x: 0.25,
    y: -0.25,
    scale: 1.5,
    scaleX: 1,
    scaleY: 1,
    rotation: 45,
    opacity: 0.75,
  });
  assert.deepEqual(motionAt(track, -1), identity);
  assert.deepEqual(motionAt(track, 0), identity);
  assert.deepEqual(motionAt(track, Number.NaN), identity);
  const final = { x: 1, y: -1, scale: 3, scaleX: 1, scaleY: 1, rotation: 180, opacity: 0 };
  assert.deepEqual(motionAt(track, 1), final);
  assert.deepEqual(motionAt(track, Number.POSITIVE_INFINITY), final);
  assert.deepEqual(motionAt(track, Number.NEGATIVE_INFINITY), identity);
});

test('easing belongs to the destination key, with explicit cubic and smoothstep curves', () => {
  const cases = [
    ['linear', 0.25],
    ['ease-in', 0.015625],
    ['ease-out', 0.578125],
    ['ease-in-out', 0.15625],
    ['hold', 0],
  ] as const;
  for (const [easing, expected] of cases) {
    const move = {
      keys: [
        { ...first, easing: 'ease-out' as const },
        { ...arrival, easing },
      ],
    };
    close(motionAt(move, 0.25).x, expected);
    assert.deepEqual(motionAt(move, 1), motionAt(track, 1));
  }
  assert.equal(motionAt({ keys: [{ ...first, easing: 'hold' }, arrival] }, 0.25).x, 0.25);
});

test('multi-segment tracks preserve exact arrivals and hold until their destination frame', () => {
  const middle = { at: 0.4, x: -1, y: 0.5, scale: 2, rotation: -90, opacity: 0.5 };
  const move: MotionTrack = { keys: [first, middle, { ...arrival, easing: 'hold' }] };
  assert.deepEqual(motionAt(move, 0.4), {
    x: -1,
    y: 0.5,
    scale: 2,
    scaleX: 1,
    scaleY: 1,
    rotation: -90,
    opacity: 0.5,
  });
  assert.deepEqual(motionAt(move, 0.999), motionAt(move, 0.4));
  assert.deepEqual(motionAt(move, 1), motionAt(track, 1));
  close(motionAt(move, 0.2).x, -0.5);
});

test('rotation retains the authored signed spin instead of wrapping to a shorter turn', () => {
  const move = {
    keys: [
      { ...first, rotation: 350 },
      { ...arrival, rotation: -350 },
    ],
  };
  assert.equal(motionAt(move, 0.5).rotation, 0);
  assert.equal(motionAt(move, 0.25).rotation, 175);
});

test('frame phase reaches both poses on visible frames and clamps outside an element interval', () => {
  assert.equal(motionProgress(1, 2, 0), 0);
  assert.equal(motionProgress(1, 2, 1), 0);
  assert.equal(motionProgress(1, 2, 47 / 24), 1);
  assert.equal(motionProgress(1, 2, 2), 1);
  assert.equal(motionProgress(1, 2, 99), 1);
  close(motionProgress(1, 2, 36 / 24), 12 / 23);
  assert.equal(motionProgress(1, 2, Number.NaN), 0);
});

test('fractional intervals use ceil for the visible bounds and floor for the current frame', () => {
  // [0.1, 0.4) exposes frame indexes 3 through 9; only seven evaluated poses.
  for (let frame = 3; frame <= 9; frame++) {
    close(motionProgress(0.1, 0.4, frame / 24), (frame - 3) / 6);
  }
  assert.equal(motionProgress(0.1, 0.4, 0.1), 0);
  assert.equal(motionProgress(0.1, 0.4, 0.4), 1);
  assert.equal(motionProgress(0.1, 0.4, 4 / 24 - 1e-5), 0);
  assert.equal(motionProgress(0.1, 0.4, 4 / 24 + 1e-5), 1 / 6);
});

test('frame-grid floating error does not move a key one frame early or late', () => {
  const start = 13 / 24;
  const end = 37 / 24;
  assert.equal(motionProgress(start, end, start - 1e-10), 0);
  assert.equal(motionProgress(start, end, 36 / 24 - 1e-10), 1);
  close(motionProgress(start, end, 25 / 24), 12 / 23);
  assert.equal(motionProgress(0, 1 / 24, 0), 0);
  assert.equal(motionProgress(0, 1 / 24, 1 / 24), 0);
});

test('the last visible frame evaluates the exact final key rather than a near-final approximation', () => {
  const lastTime = 47 / 24;
  assert.deepEqual(motionAt(track, motionProgress(1, 2, lastTime)), motionAt(track, 1));
  assert.notDeepEqual(motionAt(track, motionProgress(1, 2, 46 / 24)), motionAt(track, 1));
});

test('motion schemas retain complete portable key values and reject unknown fields', () => {
  assert.deepEqual(motionTrackSchema.parse(track), track);
  assert.equal(motionTrackSchema.safeParse({ ...track, keyframes: track.keys }).success, false);
  assert.equal(
    motionTrackSchema.safeParse({ keys: [{ ...first, zoom: 2 }, arrival] }).success,
    false,
  );
  assert.equal(motionTrackSchema.safeParse({ keys: [{ at: 0, x: 0 }, arrival] }).success, false);
});

test('tracks require two through twelve ordered keys including both endpoints', () => {
  for (const keys of [
    [],
    [first],
    [{ ...first, at: 0.01 }, arrival],
    [first, { ...arrival, at: 0.99 }],
    [first, { ...first, at: 0.5 }, { ...arrival, at: 0.5 }, arrival],
    [first, { ...first, at: 0.7 }, { ...first, at: 0.3 }, arrival],
    Array.from({ length: 13 }, (_, index) => ({ ...first, at: index / 12 })),
  ]) {
    assert.equal(motionTrackSchema.safeParse({ keys }).success, false);
  }
  const twelve = { keys: Array.from({ length: 12 }, (_, index) => ({ ...first, at: index / 11 })) };
  assert.deepEqual(motionTrackSchema.parse(twelve), twelve);
});

test('key pose bounds allow off-canvas motion while rejecting invalid or nonfinite transforms', () => {
  assert.equal(
    motionKeyframeSchema.safeParse({
      ...first,
      x: -2,
      y: 2,
      scale: 0.02,
      rotation: -360,
      opacity: 0,
    }).success,
    true,
  );
  assert.equal(motionKeyframeSchema.safeParse({ ...first, scale: 4, rotation: 360 }).success, true);
  for (const patch of [
    { at: -0.01 },
    { at: 1.01 },
    { x: -2.01 },
    { x: 2.01 },
    { y: -2.01 },
    { scale: 0 },
    { scale: 4.01 },
    { scaleX: 0 },
    { scaleX: 4.01 },
    { scaleY: 0.019 },
    { scaleY: 4.01 },
    { rotation: 361 },
    { rotation: -361 },
    { opacity: -0.01 },
    { opacity: 1.01 },
    { x: Number.NaN },
    { scale: Infinity },
    { easing: 'spring' },
  ]) {
    assert.equal(motionKeyframeSchema.safeParse({ ...first, ...patch }).success, false);
  }
});

test('graphic schema preserves center geometry, paint, image fitting and editable motion', () => {
  const panel = {
    ...graphic,
    radius: 0.25,
    strokeColor: '#17221a',
    strokeWidth: 3,
    motion: motionPreset('slide-up'),
  };
  assert.deepEqual(filmGraphicSchema.parse(panel), panel);
  assert.deepEqual(filmGraphicSchema.parse({ ...graphic, kind: 'ellipse' }), {
    ...graphic,
    kind: 'ellipse',
  });
  const image = { ...graphic, kind: 'image', assetId, sha256: 'a'.repeat(64), fit: 'cover' };
  assert.deepEqual(filmGraphicSchema.parse(image), image);
  assert.equal(filmGraphicSchema.safeParse({ ...graphic, kind: 'image', assetId }).success, true);
});

test('image graphics require an asset and shape graphics cannot carry misleading provenance', () => {
  assert.equal(filmGraphicSchema.safeParse({ ...graphic, kind: 'image' }).success, false);
  for (const kind of ['rect', 'ellipse']) {
    for (const patch of [
      { assetId },
      { sha256: 'a'.repeat(64) },
      { assetId: undefined },
      { sha256: undefined },
    ]) {
      assert.equal(filmGraphicSchema.safeParse({ ...graphic, kind, ...patch }).success, false);
    }
  }
  assert.equal(
    filmGraphicSchema.safeParse({ ...graphic, kind: 'image', assetId: 'not-an-asset' }).success,
    false,
  );
  assert.equal(
    filmGraphicSchema.safeParse({ ...graphic, kind: 'image', assetId, sha256: 'A'.repeat(64) })
      .success,
    false,
  );
});

test('graphic bounds reject malformed geometry, styling, short intervals and renderer injection', () => {
  assert.equal(filmGraphicSchema.safeParse({ ...graphic, start: 0.1, end: 0.35 }).success, true);
  assert.equal(filmGraphicSchema.safeParse({ ...graphic, start: 599.75, end: 600 }).success, true);
  assert.equal(
    filmGraphicSchema.safeParse({
      ...graphic,
      x: -2,
      y: 3,
      width: 0.005,
      height: 3,
      radius: 0.5,
      strokeWidth: 32,
    }).success,
    true,
  );
  for (const patch of [
    { id: 'invalid' },
    { name: '' },
    { name: ' ' },
    { name: 'x'.repeat(81) },
    { kind: 'path' },
    { start: -0.1 },
    { end: 601 },
    { end: 0.249 },
    { start: 1, end: 0.5 },
    { x: -2.01 },
    { y: 3.01 },
    { width: 0 },
    { height: 3.01 },
    { opacity: 1.1 },
    { color: '#fff' },
    { color: 'red' },
    { color: 'url(https://example.test/image)' },
    { radius: 0.51 },
    { radius: -0.1 },
    { fillOpacity: -0.01 },
    { fillOpacity: 1.01 },
    { strokeColor: 'transparent' },
    { strokeWidth: 33 },
    { fit: 'stretch' },
    { x: Infinity },
    { end: Number.NaN },
    { source: '/private/file.png' },
    { filter: 'movie=/private/file' },
    { motion: { keys: [first] } },
  ]) {
    assert.equal(filmGraphicSchema.safeParse({ ...graphic, ...patch }).success, false);
  }
});

test('independent scale axes default to one without changing legacy key data', () => {
  const legacy: MotionTrack = {
    keys: [
      { at: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      { at: 1, x: 0, y: 0, scale: 2, rotation: 0, opacity: 1 },
    ],
  };
  assert.deepEqual(motionTrackSchema.parse(legacy), legacy);
  assert.equal(motionAt(legacy, 0.25).scaleX, 1);
  assert.equal(motionAt(legacy, 0.25).scaleY, 1);
  const move: MotionTrack = {
    keys: [legacy.keys[0], { ...legacy.keys[1], scaleX: 3, scaleY: 0.5, easing: 'ease-in' }],
  };
  const evaluated = motionAt(move, 0.5);
  assert.equal(evaluated.scale, 1.125);
  assert.equal(evaluated.scaleX, 1.25);
  assert.equal(evaluated.scaleY, 0.9375);
  assert.equal(evaluated.scale * evaluated.scaleX, 1.40625);
  assert.equal(evaluated.scale * evaluated.scaleY, 1.0546875);
  assert.equal(motionAt(move, 1).scaleX, 3);
  assert.equal(motionAt(move, 1).scaleY, 0.5);
});

test('a transparent graphic fill preserves independent stroke and global opacity fields', () => {
  const outlined = {
    ...graphic,
    fillOpacity: 0,
    strokeColor: '#17221a',
    strokeWidth: 3,
  };
  assert.deepEqual(filmGraphicSchema.parse(outlined), outlined);
  assert.equal(filmGraphicSchema.parse(outlined).opacity, 0.9);
  assert.deepEqual(
    filmGraphicSchema.parse(graphic),
    graphic,
    'Old graphics gain no serialized defaults.',
  );
});

test('every preset is a bounded editable track and none preserves absent-motion behavior', () => {
  assert.deepEqual(motionPresets, [
    'none',
    'slide-left',
    'slide-right',
    'slide-up',
    'pop',
    'drift',
    'panel-sweep',
  ]);
  assert.equal(motionPreset('none'), undefined);
  for (const name of motionPresets.filter((name) => name !== 'none')) {
    const original = motionPreset(name)!;
    assert.deepEqual(motionTrackSchema.parse(original), original);
    const edited = motionPreset(name)!;
    edited.keys[0].x = 1.99;
    assert.deepEqual(motionPreset(name), original, `${name} leaked a user's key edits`);
    for (let frame = 0; frame < 96; frame++) {
      const value = motionAt(original, frame / 95);
      assert.ok(Object.values(value).every(Number.isFinite));
      assert.ok(value.opacity >= 0 && value.opacity <= 1);
      assert.ok(value.scale >= 0.02 && value.scale <= 4);
    }
  }
  assert.throws(() => motionPreset('not-a-preset' as MotionPresetName), /supported motion preset/);
});

test('presets deliver deliberate entry, readable hold and exit rather than uniform movement', () => {
  const left = motionPreset('slide-left')!;
  assert.ok(motionAt(left, 0).x > 0);
  assert.equal(motionAt(left, 0).opacity, 0);
  assert.deepEqual(motionAt(left, 0.5), identity);
  assert.ok(motionAt(left, 1).x < 0);
  assert.equal(motionAt(left, 1).opacity, 0);
  const pop = motionPreset('pop')!;
  assert.ok(motionAt(pop, 0).scale < 1);
  assert.equal(motionAt(pop, 0.18).scale, 1.08);
  assert.deepEqual(motionAt(pop, 0.5), identity);
  const sweep = motionPreset('panel-sweep')!;
  assert.equal(motionAt(sweep, 0).x, -1.2);
  assert.deepEqual(motionAt(sweep, 0.5), identity);
  assert.equal(motionAt(sweep, 1).x, 1.2);
});
