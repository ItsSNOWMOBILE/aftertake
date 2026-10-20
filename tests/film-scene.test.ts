import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { filmDraftSchema, filmFormat, filmManifestSchema } from '../src/film.js';
import {
  sceneDepthAt,
  sceneGroupMatrix,
  sceneProgress,
  sceneProjectionClearance,
  sceneSampleTimes,
  type FilmMotionGroup,
} from '../src/film-scene.js';

const group = (patch: Partial<FilmMotionGroup> = {}): FilmMotionGroup => ({
  id: randomUUID(),
  name: 'Attached card',
  start: 0,
  end: 1,
  pivot: { x: 0.5, y: 0.5 },
  children: [{ kind: 'graphic', id: randomUUID() }],
  ...patch,
});
const point = (h: number[], x: number, y: number) => {
  const d = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
};
const near = (actual: number[], expected: number[]) =>
  actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) < 1e-8, `${actual} != ${expected}`),
  );

test('group geometry preserves identity and uses the authored pivot for both affine and depth', () => {
  const still = group();
  near(sceneGroupMatrix(still, 1280, 720, 0), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const moving = group({
    pivot: { x: 0.25, y: 0.75 },
    motion: {
      keys: [
        {
          at: 0,
          x: 0.1,
          y: -0.2,
          scale: 1.3,
          scaleX: 0.8,
          scaleY: 1.2,
          rotation: 23,
          opacity: 0.4,
        },
        {
          at: 1,
          x: 0.1,
          y: -0.2,
          scale: 1.3,
          scaleX: 0.8,
          scaleY: 1.2,
          rotation: 23,
          opacity: 0.4,
        },
      ],
    },
    depth: {
      perspective: 3,
      keys: [
        { at: 0, yaw: 18, pitch: -12, z: 0.15 },
        { at: 1, yaw: 18, pitch: -12, z: 0.15 },
      ],
    },
  });
  near(point(sceneGroupMatrix(moving, 1280, 720, 0.5), 320, 540), [448, 396]);
  const affine = group({ ...moving, depth: undefined });
  const h = sceneGroupMatrix(affine, 1280, 720, 0);
  const angle = (23 * Math.PI) / 180;
  near(point(h, 420, 540), [448 + 104 * Math.cos(angle), 396 + 104 * Math.sin(angle)]);
});

test('depth projects toward the camera and its easing shares the established curve convention', () => {
  const g = group({
    depth: {
      perspective: 2,
      keys: [
        { at: 0, yaw: 0, pitch: 0, z: 0 },
        { at: 1, yaw: 20, pitch: -10, z: 0.2, easing: 'ease-in' },
      ],
    },
  });
  const depth = sceneDepthAt(g.depth, 0.5);
  near([depth.yaw, depth.pitch, depth.z], [2.5, -1.25, 0.025]);
  g.depth!.keys = [
    { at: 0, yaw: 0, pitch: 0, z: 0.2 },
    { at: 1, yaw: 0, pitch: 0, z: 0.2 },
  ];
  near(point(sceneGroupMatrix(g, 1280, 720, 0), 740, 360), [640 + 100 / 0.9, 360]);
});

test('scene samples preserve fractional time and clamp to the first and last displayed frames', () => {
  const g = group({ start: 0.13, end: 1.15, shutter: { samples: 3, exposure: 0.6 } });
  near(sceneSampleTimes(g, 0.5), [11.8 / 24, 12 / 24, 12.2 / 24]);
  near(sceneSampleTimes(g, 0.13), [4 / 24, 4 / 24, 4 / 24]);
  near(sceneSampleTimes(g, 1.15), [27 / 24, 27 / 24, 27 / 24]);
  assert.equal(sceneProgress(0.13, 1.15, 12.2 / 24), (12.2 - 4) / 23);
  assert.equal(sceneProgress(0.13, 1.15, 27 / 24), 1);
  near(sceneSampleTimes({ ...g, shutter: { samples: 5, exposure: 0 } }, 0.5), [0.5]);
});

test('format 4 is explicit and unsafe perspective is rejected before rendering', () => {
  const id = randomUUID();
  const title = {
    id,
    text: 'Attached',
    start: 0,
    end: 1,
    style: 'headline',
    position: 'center',
    animation: 'none',
    color: '#ffffff',
  };
  const g = group({ children: [{ kind: 'title', id }] });
  const draft = {
    name: 'Portable depth',
    aspect: 'portrait',
    shots: [{ assetId: randomUUID(), start: 0, end: 1 }],
    titles: [title],
    motionScene: { groups: [g], order: [{ kind: 'group', id: g.id }] },
  };
  assert.equal(filmDraftSchema.safeParse(draft).success, true);
  assert.equal(filmFormat(filmDraftSchema.parse(draft)), 'aftertake-film/4');
  const shot = { ...draft.shots[0], sha256: 'a'.repeat(64) };
  assert.equal(
    filmManifestSchema.safeParse({ ...draft, shots: [shot], format: 'aftertake-film/3' }).success,
    false,
  );
  assert.equal(
    filmManifestSchema.safeParse({ ...draft, shots: [shot], format: 'aftertake-film/4' }).success,
    true,
  );
  const unsafe = group({
    ...g,
    pivot: { x: 0, y: 0 },
    depth: {
      perspective: 1.5,
      keys: [
        { at: 0, yaw: 35, pitch: 35, z: 0.2 },
        { at: 1, yaw: 35, pitch: 35, z: 0.2 },
      ],
    },
  });
  assert.ok(sceneProjectionClearance(unsafe, 720, 1280) <= 0.05 * 720);
  assert.equal(
    filmDraftSchema.safeParse({ ...draft, motionScene: { ...draft.motionScene, groups: [unsafe] } })
      .success,
    false,
  );
  assert.equal(filmFormat({}), 'aftertake-film/2');
});
