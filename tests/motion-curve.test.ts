import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { filmDraftSchema, filmManifestSchema } from '../src/film.js';
import {
  motionAt,
  motionCurveAmount,
  motionCurvePresets,
  motionCurveSchema,
  motionKeyframeSchema,
  motionPreset,
  motionPresets,
  motionProgress,
  motionTrackSchema,
  namedEasingCurve,
  type MotionCurve,
  type MotionKeyframe,
  type MotionTrack,
} from '../src/film-motion.js';
import {
  filmMotionGroupSchema,
  sceneDepthAt,
  sceneGroupMatrix,
  sceneProjectionClearance,
  type FilmMotionGroup,
} from '../src/film-scene.js';

const parity = JSON.parse(
  readFileSync(new URL('./motion-curve-parity.json', import.meta.url), 'utf8'),
);
const first: MotionKeyframe = { at: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
const arrival: MotionKeyframe = { at: 1, x: 1, y: -1, scale: 3, rotation: -350, opacity: 0 };
const expoOut = { ...motionCurvePresets['expo-out'] };
const custom = (bezier: MotionCurve, key: MotionKeyframe = arrival): MotionKeyframe => ({
  ...key,
  easing: 'custom',
  bezier,
});
const grid = Array.from({ length: 401 }, (_, index) => index / 400);

// The renderer behavior before custom curves existed, copied verbatim.
function legacyEased(progress: number, easing: MotionKeyframe['easing']) {
  switch (easing) {
    case 'ease-in':
      return progress ** 3;
    case 'ease-out':
      return 1 - (1 - progress) ** 3;
    case 'ease-in-out':
      return progress * progress * (3 - 2 * progress);
    case 'hold':
      return progress < 1 ? 0 : 1;
    default:
      return progress;
  }
}

test('custom curves reproduce the native solver bit for bit on the shared parity fixture', () => {
  for (const [name, curve] of Object.entries(parity.curves) as [string, MotionCurve][]) {
    assert.equal(motionCurveSchema.safeParse(curve).success, true, name);
    parity.progress.forEach((progress: number, index: number) =>
      assert.equal(motionCurveAmount(progress, curve), parity.amounts[name][index], name),
    );
  }
  const track = motionTrackSchema.parse(parity.track);
  parity.frames.forEach((frame: number, index: number) => {
    const pose = motionAt(
      track,
      motionProgress(parity.interval.start, parity.interval.end, frame / 24),
    );
    parity.poseFields.forEach((field: keyof typeof pose, at: number) =>
      assert.equal(pose[field], parity.poses[index][at], `frame ${frame} ${field}`),
    );
  });
  parity.depthProgress.forEach((progress: number, index: number) => {
    const depth = sceneDepthAt(parity.depth, progress);
    [depth.yaw, depth.pitch, depth.z].forEach((value, at) =>
      assert.ok(Math.abs(value - parity.depthPoses[index][at]) < 1e-12, `depth ${progress}`),
    );
  });
});

test('the solver inverts x(u) = time: the named easings are exact Bezier cases', () => {
  for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
    const curve = namedEasingCurve(easing);
    for (const progress of grid) {
      const expected = legacyEased(progress, easing);
      assert.ok(Math.abs(motionCurveAmount(progress, curve) - expected) < 1e-15, easing);
    }
  }
  // Symmetric handles give a point-symmetric curve; inversion keeps that symmetry.
  for (const name of ['sine-in-out', 'quint-in-out', 'speed-ramp'] as const) {
    for (const progress of grid)
      assert.ok(
        Math.abs(
          motionCurveAmount(progress, motionCurvePresets[name]) +
            motionCurveAmount(1 - progress, motionCurvePresets[name]) -
            1,
        ) < 1e-14,
        name,
      );
  }
  // Hold is a jump rather than a curve; Custom starts from Standard instead.
  assert.deepEqual(namedEasingCurve('hold'), motionCurvePresets.standard);
});

test('named easings, the linear default and hold keep their legacy values on real projects', () => {
  const tracks: MotionTrack[] = [];
  for (const name of [
    'make-the-next-take/project.json',
    'make-the-next-take/campaign-square.json',
    'motion-design/project.json',
    'shared-card-motion/project.json',
    'kinetic-type/project.json',
  ]) {
    const project = JSON.parse(
      readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'),
    );
    // Motion data in older projects parses without gaining a curve or a default easing.
    const parsed = filmManifestSchema.parse(project);
    for (const field of ['graphics', 'titles', 'motionScene'] as const)
      assert.deepEqual(parsed[field], project[field], `${name} ${field}`);
    for (const layer of [...(project.graphics || []), ...(project.titles || [])])
      if (layer.motion) tracks.push(layer.motion);
    for (const group of project.motionScene?.groups || [])
      if (group.motion) tracks.push(group.motion);
  }
  for (const name of motionPresets) {
    const preset = motionPreset(name);
    if (preset) tracks.push(preset);
  }
  assert.ok(tracks.length > 10);
  for (const track of tracks) {
    assert.ok(track.keys.every((key) => key.easing !== 'custom' && !('bezier' in key)));
    for (let frame = 1; frame < 47; frame++) {
      const progress = frame / 47,
        pose = motionAt(track, progress);
      const right = track.keys.find((key) => key.at >= progress)!;
      const left = track.keys[track.keys.indexOf(right) - 1];
      const amount = legacyEased((progress - left.at) / (right.at - left.at), right.easing);
      for (const field of ['x', 'y', 'scale', 'rotation', 'opacity'] as const)
        assert.equal(pose[field], left[field] + (right[field] - left[field]) * amount);
      for (const field of ['scaleX', 'scaleY'] as const)
        assert.equal(
          pose[field],
          (left[field] ?? 1) + ((right[field] ?? 1) - (left[field] ?? 1)) * amount,
        );
    }
  }
});

test('custom segments land exactly on every authored key and on the last visible frame', () => {
  const middle: MotionKeyframe = { at: 0.4, x: 0.3, y: 0.2, scale: 2, rotation: 90, opacity: 0.5 };
  const track: MotionTrack = {
    keys: [first, custom(expoOut, middle), custom(motionCurvePresets['speed-ramp'])],
  };
  const linear: MotionTrack = { keys: [first, middle, arrival] };
  assert.equal(motionCurveAmount(0, expoOut), 0);
  assert.equal(motionCurveAmount(1, expoOut), 1);
  assert.equal(motionCurveAmount(Number.NaN, expoOut), 0);
  assert.deepEqual(motionAt(track, 0), motionAt(linear, 0));
  assert.deepEqual(motionAt(track, 0.4), motionAt(linear, 0.4));
  assert.deepEqual(motionAt(track, 1), motionAt(linear, 1));
  // A layer from 1s to 2s shows frames 24..47; frame 47 is the exact final pose.
  assert.deepEqual(motionAt(track, motionProgress(1, 2, 47 / 24)), motionAt(linear, 1));
  assert.deepEqual(motionAt(track, motionProgress(1, 2, 24 / 24)), motionAt(linear, 0));
  // Expo-out reaches most of its move early; linear would be at 25%.
  assert.ok(motionAt(track, 0.1).x > 0.2);
  assert.ok(Math.abs(motionAt(linear, 0.1).x - 0.075) < 1e-12);
});

test('custom curves keep signed rotation, independent scale axes and bounded poses', () => {
  const spin: MotionTrack = {
    keys: [
      { ...first, rotation: 350, scaleX: 0.5 },
      custom(motionCurvePresets['quint-in-out'], { ...arrival, scaleY: 4, scaleX: 2 }),
    ],
  };
  for (const progress of grid) {
    const pose = motionAt(spin, progress);
    const amount = motionCurveAmount(progress, motionCurvePresets['quint-in-out']);
    assert.equal(pose.rotation, 350 + (-350 - 350) * amount);
    assert.ok(pose.rotation <= 350 && pose.rotation >= -350, 'no shortest-path wrap');
    assert.equal(pose.scaleX, 0.5 + (2 - 0.5) * amount);
    assert.equal(pose.scaleY, 1 + (4 - 1) * amount);
    assert.ok(pose.opacity >= 0 && pose.opacity <= 1);
    assert.ok(pose.scale >= 1 && pose.scale <= 3);
  }
  // A symmetric curve passes through the middle, within the solver's rounding.
  assert.ok(Math.abs(motionAt(spin, 0.5).rotation) < 1e-9);
});

test('every curve preset is bounded, monotonic and evaluates inside its two keys', () => {
  for (const [name, curve] of Object.entries(motionCurvePresets)) {
    assert.deepEqual(motionCurveSchema.parse(curve), curve, name);
    let previous = 0;
    for (const progress of grid) {
      const amount = motionCurveAmount(progress, curve);
      assert.ok(amount >= previous && amount >= 0 && amount <= 1, `${name} at ${progress}`);
      previous = amount;
    }
  }
  // A starting curve is a copy; editing one key cannot change the shared preset.
  const started = namedEasingCurve('hold');
  started.x1 = 0.9;
  assert.equal(motionCurvePresets.standard.x1, 0.25);
});

test('custom easing requires one bounded curve and no other easing may carry it', () => {
  const valid = custom(expoOut);
  assert.deepEqual(motionKeyframeSchema.parse(valid), valid);
  assert.deepEqual(motionKeyframeSchema.parse(custom({ x1: 0, y1: 0, x2: 1, y2: 1 })), {
    ...arrival,
    easing: 'custom',
    bezier: { x1: 0, y1: 0, x2: 1, y2: 1 },
  });
  const invalid: unknown[] = [
    { ...arrival, easing: 'custom' },
    { ...arrival, bezier: expoOut },
    { ...arrival, easing: 'ease-out', bezier: expoOut },
    { ...arrival, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    custom({ ...expoOut, x1: -0.01 }),
    custom({ ...expoOut, x2: 1.01 }),
    custom({ ...expoOut, y1: 1.5 }),
    custom({ ...expoOut, y2: -0.2 }),
    custom({ ...expoOut, x1: Number.NaN }),
    custom({ ...expoOut, y1: Number.POSITIVE_INFINITY }),
    { ...arrival, easing: 'custom', bezier: { ...expoOut, x1: '0.1' } },
    { ...arrival, easing: 'custom', bezier: { ...expoOut, x3: 0.5 } },
    { ...arrival, easing: 'custom', bezier: { x1: 0.1, y1: 0.2, x2: 0.3 } },
    { ...arrival, easing: 'custom', bezier: [0.16, 1, 0.3, 1] },
    { ...arrival, easing: 'custom', bezier: null },
  ];
  for (const key of invalid)
    assert.equal(motionKeyframeSchema.safeParse(key).success, false, JSON.stringify(key));
  const issue = motionKeyframeSchema.safeParse({ ...arrival, easing: 'custom' });
  assert.deepEqual(issue.error?.issues[0].path, ['bezier']);
  assert.throws(
    () => motionAt({ keys: [first, { ...arrival, easing: 'custom' }] }, 0.5),
    /bezier curve/,
  );
});

test('group motion and depth share the curve evaluator without loosening clearance', () => {
  const smooth = namedEasingCurve('ease-in-out'),
    cubic = namedEasingCurve('ease-in');
  const base: FilmMotionGroup = {
    id: randomUUID(),
    name: 'Curved card',
    start: 0,
    end: 2,
    pivot: { x: 0.4, y: 0.6 },
    children: [{ kind: 'graphic', id: randomUUID() }],
    motion: {
      keys: [
        { ...first, x: -0.2, rotation: 40 },
        {
          ...arrival,
          x: 0.2,
          y: 0,
          scale: 1.3,
          rotation: -20,
          opacity: 0.6,
          easing: 'ease-in-out',
        },
      ],
    },
    depth: {
      perspective: 2.5,
      keys: [
        { at: 0, yaw: -20, pitch: 10, z: -0.1 },
        { at: 1, yaw: 25, pitch: -12, z: 0.15, easing: 'ease-in' },
      ],
    },
    shutter: { samples: 5, exposure: 0.5 },
  };
  const curved = filmMotionGroupSchema.parse({
    ...base,
    motion: {
      keys: [base.motion!.keys[0], { ...base.motion!.keys[1], easing: 'custom', bezier: smooth }],
    },
    depth: {
      ...base.depth!,
      keys: [base.depth!.keys[0], { ...base.depth!.keys[1], easing: 'custom', bezier: cubic }],
    },
  });
  for (let frame = 0; frame < 48; frame += 3) {
    const named = sceneGroupMatrix(base, 1280, 720, frame / 24),
      curvedMatrix = sceneGroupMatrix(curved, 1280, 720, frame / 24);
    curvedMatrix.forEach((value, index) => assert.ok(Math.abs(value - named[index]) < 1e-9));
  }
  // Curves cannot move a pose beyond its keys, so the conservative bound is unchanged.
  assert.equal(
    sceneProjectionClearance(curved, 1280, 720),
    sceneProjectionClearance(base, 1280, 720),
  );
  const shaped = {
    ...curved,
    depth: {
      ...curved.depth!,
      keys: [curved.depth!.keys[0], { ...curved.depth!.keys[1], bezier: expoOut }],
    },
  };
  for (const progress of grid) {
    const depth = sceneDepthAt(shaped.depth, progress);
    assert.ok(depth.yaw >= -20 - 1e-12 && depth.yaw <= 25 + 1e-12);
    assert.ok(depth.z >= -0.1 - 1e-12 && depth.z <= 0.15 + 1e-12);
  }
  for (const key of [
    { at: 1, yaw: 0, pitch: 0, z: 0, easing: 'custom' },
    { at: 1, yaw: 0, pitch: 0, z: 0, easing: 'linear', bezier: expoOut },
    { at: 1, yaw: 0, pitch: 0, z: 0, easing: 'custom', bezier: { ...expoOut, y2: 1.2 } },
  ])
    assert.equal(
      filmMotionGroupSchema.safeParse({
        ...base,
        depth: { ...base.depth!, keys: [base.depth!.keys[0], key] },
      }).success,
      false,
    );
  const titleId = randomUUID();
  const draft = {
    name: 'Curved scene',
    aspect: 'landscape',
    shots: [{ assetId: randomUUID(), start: 0, end: 2 }],
    titles: [
      {
        id: titleId,
        text: 'Shaped',
        start: 0,
        end: 2,
        style: 'headline',
        position: 'center',
        animation: 'none',
        color: '#ffffff',
        motion: { keys: [first, custom(expoOut)] },
      },
    ],
    motionScene: {
      groups: [{ ...shaped, children: [{ kind: 'title', id: titleId }] }],
      order: [{ kind: 'group', id: shaped.id }],
    },
  };
  assert.deepEqual(filmDraftSchema.parse(draft), draft);
});
