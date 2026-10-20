import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { filmRouter } from '../server/films.js';
import { handleRequestError } from '../server/http-errors.js';
import { filmFormat, filmManifestSchema, filmRequestSchema } from '../src/film.js';
import { motionPreset } from '../src/film-motion.js';
import { filmSceneSchema, type FilmMotionScene } from '../src/film-scene.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
const hash = createHash('sha256').update(png).digest('hex');

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-scene-api-'));
  const folder = path.join(directory, 'films');
  const assets = path.join(folder, 'assets');
  await mkdir(assets, { recursive: true });
  const assetId = randomUUID();
  await writeFile(path.join(assets, assetId + '.png'), png);
  await writeFile(
    path.join(assets, assetId + '.json'),
    JSON.stringify({
      id: assetId,
      kind: 'image',
      extension: '.png',
      name: 'Original scene still',
      sha256: hash,
      width: 1,
      height: 1,
      duration: 600,
      url: `/api/films/assets/${assetId}/media`,
      createdAt: new Date().toISOString(),
    }),
  );
  await mkdir(path.join(directory, 'scripts'));
  // A model-free child process captures the exact native renderer input. Pixel
  // rendering is covered separately by the Python scene tests, not this fixture.
  await writeFile(
    path.join(directory, 'scripts', 'render-film.py'),
    `const fs = require('node:fs');
const path = require('node:path');
const input = fs.readFileSync(process.argv[2], 'utf8');
fs.appendFileSync(path.join(__dirname, '..', 'renderer-calls.jsonl'), input + '\\n');
`,
  );
  const app = express();
  app.use(express.json());
  app.use('/api/films', await filmRouter(directory, directory, process.execPath, new Map()));
  app.use(handleRequestError);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-scene-api-'));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}/api/films`;
  const post = (route: string, body: unknown, key?: string) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
  const get = (route = '') => fetch(base + route);
  const imageId = randomUUID();
  const panelId = randomUUID();
  const titleId = randomUUID();
  const rootTitleId = randomUUID();
  const groupId = randomUUID();
  const motionScene: FilmMotionScene = {
    groups: [
      {
        id: groupId,
        name: 'Product and headline',
        start: 0.5,
        end: 3.5,
        pivot: { x: 0.42, y: 0.55 },
        children: [
          { kind: 'graphic', id: imageId },
          { kind: 'title', id: titleId },
        ],
        motion: motionPreset('pop'),
        depth: {
          perspective: 3,
          keys: [
            { at: 0, yaw: -12, pitch: 5, z: -0.06 },
            { at: 1, yaw: 14, pitch: -4, z: 0.1, easing: 'ease-in-out' },
          ],
        },
        shutter: { samples: 5, exposure: 0.65 },
      },
    ],
    order: [
      { kind: 'graphic', id: panelId },
      { kind: 'group', id: groupId },
      { kind: 'title', id: rootTitleId },
    ],
  };
  const project = {
    format: 'aftertake-film/4',
    name: 'Portable layered scene',
    aspect: 'landscape',
    resolution: '1080p',
    shots: [{ assetId: randomUUID(), sha256: hash, start: 0, end: 4 }],
    graphics: [
      {
        id: panelId,
        name: 'Backdrop panel',
        kind: 'rect',
        start: 0,
        end: 4,
        x: 0.5,
        y: 0.5,
        width: 0.8,
        height: 0.7,
        color: '#203040',
        opacity: 0.9,
      },
      {
        id: imageId,
        name: 'Product still',
        kind: 'image',
        start: 0.75,
        end: 3.25,
        x: 0.5,
        y: 0.5,
        width: 0.25,
        height: 0.25,
        color: '#ffffff',
        opacity: 1,
        assetId: randomUUID(),
        sha256: hash,
        motion: motionPreset('slide-up'),
      },
    ],
    titles: [
      {
        id: titleId,
        text: 'Keep it together.',
        start: 1,
        end: 3,
        style: 'headline',
        position: 'center',
        animation: 'none',
        color: '#ffffff',
      },
      {
        id: rootTitleId,
        text: 'AFTERTAKE',
        start: 0,
        end: 4,
        style: 'kicker',
        position: 'top',
        animation: 'none',
        color: '#d5e991',
      },
    ],
    motionScene,
  };
  const draft = () =>
    filmRequestSchema.parse({
      ...project,
      shots: [{ assetId, start: 0, end: 4 }],
      graphics: project.graphics.map((graphic) =>
        graphic.kind === 'image' ? { ...graphic, assetId } : graphic,
      ),
    });
  async function ready(id: string) {
    const deadline = Date.now() + 5000;
    for (;;) {
      const response = await get();
      assert.equal(response.status, 200);
      const film = (await response.json()).find((entry: { id: string }) => entry.id === id);
      if (film?.state === 'ready') return film;
      assert.notEqual(film?.state, 'failed', 'The model-free renderer fixture failed.');
      if (Date.now() > deadline) assert.fail('The model-free renderer fixture did not finish.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return { directory, folder, assetId, project, motionScene, post, get, draft, ready };
}

test('scene restore rebinds verified image assets without losing group transforms or painter order', async (t) => {
  const f = await fixture(t);
  assert.equal(filmSceneSchema.safeParse(f.motionScene).success, true);
  assert.equal(filmManifestSchema.safeParse(f.project).success, true);
  const response = await f.post('/resolve', f.project);
  assert.equal(response.status, 200);
  const restored = filmRequestSchema.parse(await response.json());
  assert.equal(restored.shots[0].assetId, f.assetId);
  assert.equal(restored.graphics?.[1].assetId, f.assetId);
  assert.equal(restored.graphics?.[1].sha256, hash);
  assert.deepEqual(restored.motionScene, f.motionScene);
  assert.deepEqual(restored.graphics?.[1].motion, f.project.graphics[1].motion);
  assert.equal(filmFormat(restored), 'aftertake-film/4');
});

test('scene export reaches the native workfile and portable manifest and remains bound to its original export key', async (t) => {
  const f = await fixture(t);
  const draft = f.draft();
  const created = await f.post('', draft, 'scene-export-original');
  assert.equal(created.status, 202);
  const admitted = await created.json();
  await f.ready(admitted.id);
  const calls = () =>
    readFile(path.join(f.directory, 'renderer-calls.jsonl'), 'utf8').then((text) =>
      text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    );
  const [workfile] = await calls();
  assert.deepEqual(workfile.motionScene, draft.motionScene);
  assert.deepEqual(workfile.manifest.motionScene, draft.motionScene);
  assert.equal(workfile.manifest.format, 'aftertake-film/4');
  const exportedResponse = await f.get('/' + admitted.id + '/manifest');
  assert.equal(exportedResponse.status, 200);
  const exported = filmManifestSchema.parse(await exportedResponse.json());
  assert.deepEqual(exported.motionScene, draft.motionScene);
  assert.equal(exported.format, 'aftertake-film/4');
  const restored = await f.post('/resolve', exported);
  assert.equal(restored.status, 200);
  assert.deepEqual(filmRequestSchema.parse(await restored.json()).motionScene, draft.motionScene);
  const rejoined = await f.post('', draft, 'scene-export-original');
  assert.equal(rejoined.status, 200);
  assert.equal((await rejoined.json()).id, admitted.id);

  const edits = [
    { ...draft, motionScene: { ...f.motionScene, order: [...f.motionScene.order].reverse() } },
    {
      ...draft,
      motionScene: {
        ...f.motionScene,
        groups: [{ ...f.motionScene.groups[0], pivot: { x: 0.6, y: 0.4 } }],
      },
    },
    {
      ...draft,
      motionScene: {
        ...f.motionScene,
        groups: [
          {
            ...f.motionScene.groups[0],
            depth: { ...f.motionScene.groups[0].depth!, perspective: 4 },
          },
        ],
      },
    },
    {
      ...draft,
      motionScene: {
        ...f.motionScene,
        groups: [{ ...f.motionScene.groups[0], shutter: { samples: 3, exposure: 0.5 } }],
      },
    },
  ];
  for (const edit of edits)
    assert.equal((await f.post('', edit, 'scene-export-original')).status, 409);
  assert.equal(
    (await calls()).length,
    1,
    'Rejoining or changing an existing key must not export again.',
  );
  const saved = JSON.parse(await readFile(path.join(f.folder, admitted.id + '.json'), 'utf8'));
  assert.deepEqual(saved.motionScene, draft.motionScene);
});

test('invalid scene references, duplicate ownership and child timing reject both restore and export before admission', async (t) => {
  const f = await fixture(t);
  const p = f.project;
  const scene = f.motionScene;
  const group = scene.groups[0];
  const invalid = [
    [
      'missing child',
      { ...scene, groups: [{ ...group, children: [{ kind: 'graphic', id: randomUUID() }] }] },
    ],
    [
      'wrong child kind',
      { ...scene, groups: [{ ...group, children: [{ kind: 'title', id: p.graphics[1].id }] }] },
    ],
    [
      'nested group',
      { ...scene, groups: [{ ...group, children: [{ kind: 'group', id: group.id }] }] },
    ],
    [
      'duplicate child',
      { ...scene, groups: [{ ...group, children: [...group.children, group.children[0]] }] },
    ],
    ['child also at root', { ...scene, order: [...scene.order, group.children[0]] }],
    ['missing root layer', { ...scene, order: scene.order.slice(1) }],
    ['duplicate root', { ...scene, order: [...scene.order, scene.order[0]] }],
    [
      'unknown root group',
      {
        ...scene,
        order: scene.order.map((entry) =>
          entry.kind === 'group' ? { ...entry, id: randomUUID() } : entry,
        ),
      },
    ],
    ['duplicate group', { ...scene, groups: [group, group] }],
    [
      'group ID collides with a layer',
      {
        ...scene,
        groups: [{ ...group, id: p.graphics[0].id }],
        order: scene.order.map((entry) =>
          entry.kind === 'group' ? { ...entry, id: p.graphics[0].id } : entry,
        ),
      },
    ],
    ['child precedes parent', { ...scene, groups: [{ ...group, start: 1 }] }],
    ['child outlasts parent', { ...scene, groups: [{ ...group, end: 3 }] }],
    ['parent outlasts film', { ...scene, groups: [{ ...group, end: 4.25 }] }],
    [
      'unbounded depth',
      {
        ...scene,
        groups: [
          {
            ...group,
            depth: {
              ...group.depth!,
              keys: [
                { at: 0, yaw: 0, pitch: 0, z: -0.21 },
                { at: 1, yaw: 0, pitch: 0, z: 0.21 },
              ],
            },
          },
        ],
      },
    ],
    [
      'unsupported shutter',
      { ...scene, groups: [{ ...group, shutter: { samples: 100, exposure: 1 } }] },
    ],
  ] as const;
  const accepted: string[] = [];
  for (const [reason, motionScene] of invalid) {
    const project = { ...p, motionScene };
    if ((await f.post('/resolve', project)).status !== 400) accepted.push(reason + ' on restore');
    // A regression must not start even the model-free renderer fixture.
    const draft = { ...f.draft(), motionScene };
    if (filmRequestSchema.safeParse(draft).success) accepted.push(reason + ' on export schema');
    else if ((await f.post('', draft)).status !== 400) accepted.push(reason + ' on export');
  }
  assert.deepEqual(accepted, [], 'Invalid scenes must not pass restore or export validation.');
  const files = await readdir(f.folder);
  assert.equal(
    files.some((name) => /^[a-f0-9-]{36}\.json$/.test(name)),
    false,
  );
  assert.equal(
    files.some((name) => name.endsWith('.work.json')),
    false,
  );
});

test('custom curves survive restore, the native workfile, the exported manifest and export identity', async (t) => {
  const f = await fixture(t);
  const curve = (index: number) => ({ x1: 0.16, y1: 1, x2: 0.3 + index / 100, y2: 1 });
  const shape = (keys: any[]) =>
    keys.map((key, index) => (index ? { ...key, easing: 'custom', bezier: curve(index) } : key));
  const project: any = structuredClone(f.project);
  project.graphics[1].motion.keys = shape(project.graphics[1].motion.keys);
  project.titles[1].motion = {
    keys: shape([
      { at: 0, x: -0.1, y: 0, scale: 1, rotation: 0, opacity: 0 },
      { at: 1, x: 0.1, y: 0, scale: 1, rotation: -30, opacity: 1 },
    ]),
  };
  const group = project.motionScene.groups[0];
  group.motion.keys = shape(group.motion.keys);
  group.depth.keys = shape(group.depth.keys);
  assert.equal(filmManifestSchema.safeParse(project).success, true);
  const curved = (value: any) => ({
    graphic: value.graphics[1].motion,
    title: value.titles[1].motion,
    scene: value.motionScene,
  });
  const restored = await f.post('/resolve', project);
  assert.equal(restored.status, 200);
  assert.deepEqual(curved(filmRequestSchema.parse(await restored.json())), curved(project));

  const draft = filmRequestSchema.parse({
    ...project,
    shots: [{ assetId: f.assetId, start: 0, end: 4 }],
    graphics: project.graphics.map((graphic: any) =>
      graphic.kind === 'image' ? { ...graphic, assetId: f.assetId } : graphic,
    ),
  });
  const created = await f.post('', draft, 'curve-export');
  assert.equal(created.status, 202);
  const admitted = await created.json();
  await f.ready(admitted.id);
  const [workfile] = (await readFile(path.join(f.directory, 'renderer-calls.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(curved(workfile), curved(project));
  assert.deepEqual(curved(workfile.manifest), curved(project));
  const exported = filmManifestSchema.parse(await (await f.get(`/${admitted.id}/manifest`)).json());
  assert.deepEqual(curved(exported), curved(project));
  const again = await f.post('/resolve', exported);
  assert.equal(again.status, 200);
  assert.deepEqual(curved(filmRequestSchema.parse(await again.json())), curved(project));
  // One control point belongs to the export identity.
  const changed: any = structuredClone(draft);
  changed.motionScene.groups[0].depth.keys[1].bezier.y1 = 0.9;
  assert.equal((await f.post('', changed, 'curve-export')).status, 409);
  const uncurved: any = structuredClone(draft);
  delete uncurved.titles[1].motion.keys[1].bezier;
  assert.equal(filmRequestSchema.safeParse(uncurved).success, false);
  assert.equal((await f.post('', uncurved)).status, 400);
});

test('scene projects require format four while legacy project labels retain their original settings', async (t) => {
  const f = await fixture(t);
  for (const format of ['aftertake-film/1', 'aftertake-film/2', 'aftertake-film/3']) {
    assert.equal((await f.post('/resolve', { ...f.project, format })).status, 400);
    const legacy = {
      format,
      name: 'Original legacy film',
      aspect: 'landscape',
      shots: f.project.shots,
    };
    assert.equal(filmManifestSchema.safeParse(legacy).success, true);
    const response = await f.post('/resolve', legacy);
    assert.equal(response.status, 200);
    assert.equal(filmRequestSchema.parse(await response.json()).motionScene, undefined);
  }
  const { motionScene: _scene, ...motionProject } = f.project;
  assert.equal(
    filmManifestSchema.safeParse({ ...motionProject, format: 'aftertake-film/3' }).success,
    true,
  );
});
