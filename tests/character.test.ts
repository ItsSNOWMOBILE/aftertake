import { createJobTarget } from '../server/job-target.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  characterRequestSchema,
  characterSelectionSchema,
  characterSelectionKey,
  characterPrompt,
  parseCharacterSelectionInfo,
  characterMaxIdentityReferences,
  characterChain,
  type CharacterJob,
} from '../src/character.js';
import { registerCharacterTools } from '../server/character-tools.js';
import { characterRouter } from '../server/characters.js';
import express from 'express';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const source = {
  id: randomUUID(),
  name: 'Performance',
  kind: 'video' as const,
  sha256: 'a'.repeat(64),
  url: '/media/performance.mp4',
  width: 1920,
  height: 1080,
  duration: 12,
  hasAudio: true,
};
const reference = {
  ...source,
  id: randomUUID(),
  name: 'Original reference',
  kind: 'image' as const,
  width: 960,
  height: 1280,
  duration: 1,
  sha256: 'b'.repeat(64),
  url: '/media/reference.png',
  hasAudio: false,
};
const selection = {
  format: 'aftertake-character-selection/1' as const,
  clip: source,
  trimStart: 1,
  duration: 8,
  positive: [{ x: 0.4, y: 0.4 }],
  negative: [],
};
const request = {
  format: 'aftertake-character/1' as const,
  name: 'A replacement',
  selectionId: randomUUID(),
  reference,
  seed: 42,
  prompt: 'Keep the cup.',
  faceBox: { x: 0.3, y: 0.1, width: 0.4, height: 0.3 },
};
const identities = Array.from({ length: 8 }, (_, index) => ({
  reference: {
    ...reference,
    id: randomUUID(),
    sha256: (index + 1).toString(16).repeat(64),
    name: `Independent photo ${index + 1}`,
  },
}));
test('character selection binds the actual source, selected range and points', () => {
  assert.ok(characterSelectionSchema.safeParse(selection).success);
  assert.equal(characterSelectionSchema.safeParse({ ...selection, positive: [] }).success, false);
  assert.equal(characterSelectionSchema.safeParse({ ...selection, trimStart: 8 }).success, false);
  assert.equal(
    characterSelectionSchema.safeParse({ ...selection, clip: reference }).success,
    false,
  );
  for (const changed of [
    { ...selection, duration: 9 },
    { ...selection, trimStart: 2 },
    { ...selection, positive: [{ x: 0.5, y: 0.4 }] },
    { ...selection, negative: [{ x: 0.1, y: 0.1 }] },
    { ...selection, clip: { ...source, sha256: 'c'.repeat(64) } },
  ])
    assert.notEqual(characterSelectionKey(selection), characterSelectionKey(changed));
});
test('a take tracked in an earlier take counts every person swapped in the shot', () => {
  const job = (fields: Partial<CharacterJob>) =>
    ({
      id: randomUUID(),
      state: 'succeeded',
      progress: 1,
      createdAt: '',
      updatedAt: '',
      workflow: {},
      ...fields,
    }) as CharacterJob;
  const take = (selected: CharacterJob, sha: string, name: string) =>
    job({
      kind: 'replacement',
      request: { ...request, name, selectionId: selected.id },
      clip: { ...source, id: randomUUID(), sha256: sha.repeat(64), duration: 8 },
    });
  const firstSelection = job({ kind: 'selection', request: selection });
  const first = take(firstSelection, 'c', 'First person');
  const secondSelection = job({
    kind: 'selection',
    request: { ...selection, clip: first.clip!, trimStart: 0 },
  });
  const second = take(secondSelection, 'd', 'Second person');
  const thirdSelection = job({
    kind: 'selection',
    request: { ...selection, clip: second.clip!, trimStart: 0 },
  });
  const third = take(thirdSelection, 'e', 'Third person');
  const jobs = [third, thirdSelection, second, secondSelection, first, firstSelection];
  assert.deepEqual(
    characterChain(third, jobs).map((item) => item.id),
    [first.id, second.id, third.id],
  );
  assert.deepEqual(characterChain(first, jobs), [first]);
  assert.deepEqual(characterChain(firstSelection, jobs), []);
  // A failed earlier pass made no picture, so it cannot be part of the shot.
  const failed = jobs.map((item) => (item === first ? { ...first, state: 'failed' } : item));
  assert.equal(characterChain(third, failed).length, 2);
});

test('identity focus uses the actual photo and keeps face/wardrobe references distinct', () => {
  assert.ok(characterRequestSchema.safeParse(request).success);
  assert.match(characterPrompt(request), /unmodified crop/);
  assert.match(characterPrompt(request), /SAME person/);
  assert.match(characterPrompt(request), /Keep the cup/);
  assert.match(characterPrompt(request), /every other person/);
  assert.match(characterPrompt(request), /Replace the source outfit/);
  assert.match(characterPrompt({ ...request, wardrobe: 'source' }), /Keep the source outfit/);
  assert.doesNotMatch(
    characterPrompt({ ...request, wardrobe: 'source' }),
    /Replace the source outfit/,
  );
  assert.equal(
    characterRequestSchema.safeParse({
      ...request,
      faceBox: { x: 0.9, y: 0.1, width: 0.4, height: 0.3 },
    }).success,
    false,
  );
  assert.equal(
    characterRequestSchema.safeParse({
      ...request,
      faceBox: { x: 0, y: 0, width: 0.05, height: 0.9 },
    }).success,
    false,
  );
});

test('supporting identity photos validate distinct originals, crops and the nine-picture capacity', () => {
  assert.equal(characterMaxIdentityReferences, 7);
  const multi = { ...request, identityReferences: identities.slice(0, 7) };
  assert.deepEqual(characterRequestSchema.parse(JSON.parse(JSON.stringify(multi))), multi);
  assert.equal(
    characterRequestSchema.safeParse({ ...request, identityReferences: identities }).success,
    false,
  );
  for (const extra of [
    { reference },
    { reference: { ...identities[0].reference, id: reference.id } },
    { reference: { ...identities[0].reference, sha256: reference.sha256 } },
    { ...identities[0], faceBox: { x: 0.9, y: 0, width: 0.4, height: 0.4 } },
    { ...identities[0], faceBox: { x: 0, y: 0, width: 0.05, height: 0.9 } },
    { reference: { ...identities[0].reference, kind: 'video' } },
    { reference: { ...identities[0].reference, width: 8000, height: 1000 } },
  ])
    assert.equal(
      characterRequestSchema.safeParse({ ...request, identityReferences: [extra] }).success,
      false,
    );
  for (const duplicate of [
    identities[0],
    { reference: { ...identities[0].reference, id: randomUUID() } },
  ])
    assert.equal(
      characterRequestSchema.safeParse({
        ...request,
        identityReferences: [identities[0], duplicate],
      }).success,
      false,
    );
  assert.ok(
    characterRequestSchema.safeParse({
      ...request,
      identityReferences: [
        { ...identities[0], faceBox: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
      ],
    }).success,
  );
});

test('picture roles remain stable for old recipes and follow actual optional crop slots', () => {
  const legacy = characterPrompt(request);
  assert.equal(characterPrompt({ ...request, identityReferences: [] }), legacy);
  assert.equal(characterRequestSchema.parse(request).identityReferences, undefined);
  const withCrop = characterPrompt({ ...request, identityReferences: identities.slice(0, 2) });
  assert.match(
    withCrop,
    /<Picture 3>, <Picture 4> are additional unmodified identity references of the SAME person/,
  );
  assert.match(withCrop, /identity only/);
  assert.match(withCrop, /Do not copy their clothing, backgrounds, poses or lighting/);
  assert.match(withCrop, /<Picture 1> remains the clothing reference/);
  const withoutCrop = characterPrompt({
    ...request,
    faceBox: undefined,
    identityReferences: identities.slice(0, 2),
  });
  assert.match(withoutCrop, /<Picture 2>, <Picture 3> are additional/);
  assert.doesNotMatch(withoutCrop, /<Picture 4>/);
  assert.match(
    characterPrompt({ ...request, wardrobe: 'source', identityReferences: [identities[0]] }),
    /Keep the source outfit from <Video 1>/,
  );
});

test('high-resolution selections cannot reuse standard tracking or accept an oversized returned canvas', () => {
  const standard = { ...selection, resolution: '480' as const },
    high = { ...selection, resolution: '768' as const };
  assert.ok(characterSelectionSchema.safeParse(high).success);
  assert.equal(
    characterSelectionSchema.safeParse({ ...selection, resolution: '1080' }).success,
    false,
  );
  assert.equal(characterSelectionKey(standard), characterSelectionKey(selection));
  assert.notEqual(characterSelectionKey(high), characterSelectionKey(selection));
  const info = {
    width: 1344,
    height: 736,
    frames: 73,
    fps: 24,
    emptyFrames: [],
    maskSha256: 'c'.repeat(64),
  };
  assert.deepEqual(parseCharacterSelectionInfo(info, high), info);
  assert.throws(() => parseCharacterSelectionInfo(info, selection), /working resolution/);
  assert.throws(() => parseCharacterSelectionInfo(info, standard), /working resolution/);
  assert.throws(
    () => parseCharacterSelectionInfo({ ...info, width: 1408, height: 768 }, high),
    /canvas/,
  );
  assert.throws(() => parseCharacterSelectionInfo({ ...info, width: 1340 }, high), /canvas/);
});
test('agent character tools bind the reviewed mask, retain the source photo and reuse request IDs', async () => {
  const tools = new Map<string, any>(),
    calls: any[] = [];
  const tracked = {
    id: request.selectionId,
    kind: 'selection',
    state: 'succeeded',
    request: selection,
    selection: { maskSha256: 'c'.repeat(64), emptyFrames: [] as number[], frames: 192 },
  };
  const multiRequest = { ...request, identityReferences: identities.slice(0, 3) };
  const replacement = {
    id: randomUUID(),
    kind: 'replacement',
    state: 'queued',
    request: multiRequest,
    requestKey: 'stable-character-request',
  };
  const api = async (route: string, body?: any, key?: string) => {
    calls.push({ route, body, key });
    if (route === '/api/characters/' + request.selectionId) return tracked;
    if (route === '/api/characters/' + replacement.id) return replacement;
    if (route === '/api/characters/replacements') return replacement;
    if (route === '/api/characters') return [replacement, tracked];
    throw Error('Unexpected route ' + route);
  };
  registerCharacterTools({
    tool: (name, description, schema, run) => tools.set(name, { description, schema, run }),
    api: api as any,
    bytes: async () => Buffer.alloc(0),
    root: '.',
    python: 'python',
    state: '.',
  });
  const replace = tools.get('aftertake_replace_character');
  await assert.rejects(
    replace.run({ requestId: 'stable-character-request', maskSha256: 'd'.repeat(64), request }),
    /differs/,
  );
  assert.equal(calls.filter((c) => c.route === '/api/characters/replacements').length, 0);
  for (let i = 0; i < 2; i++) {
    const result = await replace.run(
      replace.schema.parse({
        requestId: 'stable-character-request',
        maskSha256: 'c'.repeat(64),
        request: multiRequest,
      }),
    );
    assert.equal(result.data.id, replacement.id);
  }
  const submissions = calls.filter((c) => c.route === '/api/characters/replacements');
  assert.deepEqual(
    submissions.map((c) => c.key),
    ['stable-character-request', 'stable-character-request'],
  );
  assert.deepEqual(submissions[0].body.reference, reference);
  assert.deepEqual(submissions[0].body.faceBox, request.faceBox);
  assert.deepEqual(submissions[0].body.identityReferences, multiRequest.identityReferences);
  const recipe = await tools.get('aftertake_character_recipe').run({ id: replacement.id });
  assert.deepEqual(
    characterRequestSchema.parse(JSON.parse(JSON.stringify(recipe.data.replacement))),
    multiRequest,
  );
  tracked.selection.emptyFrames = [4];
  await assert.rejects(
    replace.run({ requestId: 'new-character-request', maskSha256: 'c'.repeat(64), request }),
    /differs/,
  );
  assert.equal(calls.filter((c) => c.route === '/api/characters/replacements').length, 2);
  const status = await tools
    .get('aftertake_character_status')
    .run({ requestId: 'stable-character-request' });
  assert.equal(status.data.id, replacement.id);
});
test('selection media remains readable when the studio data lives in a hidden workspace folder', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-character-')),
    data = path.join(directory, '.private-data');
  const id = randomUUID(),
    folder = path.join(data, 'characters');
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, id + '.json'),
    JSON.stringify({
      id,
      kind: 'selection',
      state: 'succeeded',
      request: selection,
      createdAt: new Date().toISOString(),
      workflow: {},
      selection: { frames: 48, width: 960, height: 512, fps: 24, emptyFrames: [] },
    }),
  );
  const preview = Buffer.from('reviewed selection video'),
    prepared = Buffer.from('matched prepared source');
  await writeFile(path.join(folder, id + '-preview.mp4'), preview);
  await writeFile(path.join(folder, id + '-source.mp4'), prepared);
  await writeFile(path.join(folder, id + '-mask.mkv'), preview);
  const app = express(),
    { router } = await characterRouter({
      root: directory,
      data,
      python: 'unused',
      client: {} as any,
      target: createJobTarget({
        sdkBaseUrl: 'http://127.0.0.1:8189',
        uiBaseUrl: 'http://127.0.0.1:8188',
        allowLegacyLoopback: true,
      }),
      uiUrl: 'http://127.0.0.1:1',
      engine: async () => ({ ready: true }) as any,
      takeBusy: () => false,
      setAdmitting: () => {},
    });
  app.use('/api/characters', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/characters/`;
  try {
    for (const [suffix, expected] of [
      ['preview', preview],
      ['source', prepared],
      ['mask', preview],
    ] as const) {
      const response = await fetch(base + id + '/' + suffix);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    }
    assert.equal((await fetch(base + randomUUID() + '/preview')).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('mask repair writes a new reviewed selection beside the tracked one', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-repair-')),
    data = path.join(directory, 'data'),
    folder = path.join(data, 'characters'),
    id = randomUUID();
  await mkdir(folder, { recursive: true });
  await mkdir(path.join(directory, 'scripts'));
  const mask = Buffer.from('tracked mask with lost frames'),
    prepared = Buffer.from('prepared source'),
    repaired = Buffer.from('repaired mask');
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(folder, id + '-mask.mkv'), mask);
  await writeFile(path.join(folder, id + '-source.mp4'), prepared);
  await writeFile(path.join(folder, id + '-preview.mp4'), 'preview');
  const tracked = {
    id,
    kind: 'selection',
    state: 'succeeded',
    request: selection,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workflow: { tracked: true },
    selection: {
      frames: 48,
      width: 960,
      height: 512,
      fps: 24,
      emptyFrames: [10, 11],
      maskSha256: digest(mask),
      sourceSha256: digest(prepared),
    },
  };
  await writeFile(path.join(folder, id + '.json'), JSON.stringify(tracked));
  // Stand-in for the Python repair, run by Node so this test needs no media runtime.
  const behaviour = path.join(directory, 'behaviour.txt');
  await writeFile(
    path.join(directory, 'scripts/repair-character-mask.py'),
    `const fs = require('node:fs');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mode = fs.readFileSync(${JSON.stringify(behaviour)}, 'utf8');
if (mode === 'fail') { process.stderr.write('Tracking lost the person in every frame.'); process.exit(2); }
if (mode === 'clean') { console.log(JSON.stringify({ changed: false })); process.exit(0); }
fs.writeFileSync(job.maskOut, ${JSON.stringify(repaired.toString())});
fs.writeFileSync(job.previewOut, 'repaired preview');
console.log(JSON.stringify({ changed: true,
  selection: { width: 960, height: 512, frames: 48, fps: 24, emptyFrames: [],
    maskSha256: ${JSON.stringify(digest(repaired))} },
  repair: { processor: 'aftertake-mask-repair/1', maxGap: 12, flicker: 2,
    framesRecovered: [10, 11], recoveredPixels: 900, restoredPixels: 40 } }));`,
  );
  const app = express(),
    { router } = await characterRouter({
      root: directory,
      data,
      python: process.execPath,
      client: {} as any,
      target: createJobTarget({
        sdkBaseUrl: 'http://127.0.0.1:8189',
        uiBaseUrl: 'http://127.0.0.1:8188',
        allowLegacyLoopback: true,
      }),
      uiUrl: 'http://127.0.0.1:1',
      engine: async () => ({ ready: true }) as any,
      takeBusy: () => false,
      setAdmitting: () => {},
    });
  app.use(express.json());
  app.use('/api/characters', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/characters/`;
  const repair = (target: string) => fetch(base + target + '/repair', { method: 'POST' });
  try {
    await writeFile(behaviour, 'fail');
    const failed = await repair(id);
    assert.equal(failed.status, 422);
    assert.match((await failed.json()).error, /every frame/);
    await writeFile(behaviour, 'clean');
    assert.equal((await repair(id)).status, 409);
    await writeFile(behaviour, 'repair');
    const created = await repair(id);
    assert.equal(created.status, 201);
    const record = await created.json();
    assert.notEqual(record.id, id);
    assert.deepEqual(record.request, selection);
    assert.deepEqual(record.workflow, { tracked: true });
    assert.deepEqual(record.selection.emptyFrames, []);
    assert.equal(record.selection.sourceSha256, digest(prepared));
    assert.equal(record.repair.from, id);
    assert.equal(record.repair.originalMaskSha256, digest(mask));
    assert.deepEqual(record.repair.framesRecovered, [10, 11]);
    const media = async (suffix: string) =>
      Buffer.from(await (await fetch(base + record.id + '/' + suffix)).arrayBuffer());
    assert.deepEqual(await media('mask'), repaired);
    assert.deepEqual(await media('source'), prepared);
    // The tracked selection is untouched, a second request returns the same repair,
    // and a repaired selection is not repaired again.
    assert.deepEqual(
      await (await fetch(base + id + '/mask')).arrayBuffer().then(Buffer.from),
      mask,
    );
    assert.equal((await (await repair(id)).json()).id, record.id);
    assert.equal((await repair(record.id)).status, 409);
    const listed = await (await fetch(base)).json();
    assert.equal(listed.length, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeping the foreground makes a new take in the background from the reviewed inputs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-protect-')),
    data = path.join(directory, 'data'),
    folder = path.join(data, 'characters'),
    clipsFolder = path.join(data, 'clips');
  await mkdir(folder, { recursive: true });
  await mkdir(clipsFolder, { recursive: true });
  await mkdir(path.join(directory, 'scripts'));
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const mask = Buffer.from('mask'),
    prepared = Buffer.from('prepared'),
    takeBytes = Buffer.from('take with a redrawn cup');
  const selectionId = randomUUID(),
    takeId = randomUUID();
  await writeFile(path.join(folder, selectionId + '-mask.mkv'), mask);
  await writeFile(path.join(folder, selectionId + '-source.mp4'), prepared);
  await writeFile(path.join(clipsFolder, takeId + '.mp4'), takeBytes);
  const now = new Date().toISOString();
  await writeFile(
    path.join(folder, selectionId + '.json'),
    JSON.stringify({
      id: selectionId,
      kind: 'selection',
      state: 'succeeded',
      request: selection,
      createdAt: now,
      updatedAt: now,
      workflow: {},
      selection: {
        frames: 48,
        width: 960,
        height: 512,
        fps: 24,
        emptyFrames: [],
        maskSha256: digest(mask),
        sourceSha256: digest(prepared),
      },
    }),
  );
  await writeFile(
    path.join(folder, takeId + '.json'),
    JSON.stringify({
      id: takeId,
      kind: 'replacement',
      state: 'succeeded',
      request: { ...request, selectionId },
      createdAt: now,
      updatedAt: now,
      workflow: { executed: true },
      clip: {
        ...source,
        id: takeId,
        name: 'A replacement',
        sha256: digest(takeBytes),
        width: 960,
        height: 512,
        duration: 2,
        url: `/media/${takeId}.mp4`,
      },
    }),
  );
  // Node stands in for the Python scripts, so this test needs no media runtime.
  const installed = path.join(directory, 'installed.txt');
  await writeFile(installed, 'no');
  const script = (name: string, body: string) =>
    writeFile(path.join(directory, 'scripts', name), `const fs = require('node:fs');\n${body}`);
  await script(
    'depth_runtime.py',
    `const ready = fs.readFileSync(${JSON.stringify(installed)}, 'utf8') === 'yes';
console.log(JSON.stringify(ready ? { runtime: '1.30.0', model: true, accelerator: 'Intel NPU (OpenVINO)', fix: null }
  : { runtime: null, model: false, accelerator: null, fix: 'node scripts/aftertake.mjs setup-npu' }));`,
  );
  await script(
    'protect-foreground.py',
    `const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const share of [0.3, 0.6, 0.9]) process.stderr.write('progress ' + share + '\\n');
fs.writeFileSync(job.output, 'protected take');
console.log(JSON.stringify({ changed: true, frames: 48, protectedFrames: 40, protectedPixels: 9000,
  accelerator: 'Intel NPU (OpenVINO)', model: { name: 'Depth Anything V2 Small',
  repository: 'onnx-community/depth-anything-v2-small', revision: 'r1', sha256: '${'e'.repeat(64)}',
  license: 'Apache-2.0' } }));`,
  );
  await script(
    'inspect-character-media.py',
    `console.log(JSON.stringify({ width: 960, height: 512, frames: 48, fps: 24, regularTimestamps: true,
  duration: 2, hasAudio: true }));`,
  );
  const app = express(),
    { router } = await characterRouter({
      root: directory,
      data,
      python: process.execPath,
      client: {} as any,
      target: createJobTarget({
        sdkBaseUrl: 'http://127.0.0.1:8189',
        uiBaseUrl: 'http://127.0.0.1:8188',
        allowLegacyLoopback: true,
      }),
      uiUrl: 'http://127.0.0.1:1',
      engine: async () => ({ ready: true }) as any,
      takeBusy: () => false,
      setAdmitting: () => {},
    });
  app.use(express.json());
  app.use('/api/characters', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/characters/`;
  const keep = (id: string, margin?: number) =>
    fetch(base + id + '/protect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(margin === undefined ? {} : { margin }),
    });
  try {
    const missing = await keep(takeId);
    assert.equal(missing.status, 409);
    assert.match((await missing.json()).error, /setup-npu/);
    await writeFile(installed, 'yes');
    assert.equal(
      (await (await fetch(base + 'depth/status')).json()).accelerator,
      'Intel NPU (OpenVINO)',
    );
    assert.equal((await keep(takeId, 0.9)).status, 400);
    const started = await keep(takeId);
    assert.equal(started.status, 202);
    const running = await started.json();
    assert.equal(running.state, 'running');
    assert.equal(running.protection.from, takeId);
    assert.match(running.stage, /Intel NPU/);
    let record = running;
    for (let attempt = 0; attempt < 100 && record.state === 'running'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      record = await (await fetch(base + running.id)).json();
    }
    assert.equal(record.state, 'succeeded', record.error);
    assert.equal(record.protection.protectedFrames, 40);
    assert.equal(record.protection.accelerator, 'Intel NPU (OpenVINO)');
    assert.deepEqual(record.request, { ...request, selectionId });
    assert.deepEqual(record.workflow, { executed: true });
    assert.equal(record.clip.url, `/media/${record.id}.mp4`);
    assert.equal(record.clip.sha256, digest(Buffer.from('protected take')));
    const saved = JSON.parse(await readFile(path.join(clipsFolder, record.id + '.json'), 'utf8'));
    assert.equal(saved.sha256, record.clip.sha256);
    // The original take is untouched, asking again returns the same take, and a
    // protected take is not protected twice.
    assert.deepEqual(await readFile(path.join(clipsFolder, takeId + '.mp4')), takeBytes);
    assert.equal((await (await keep(takeId)).json()).id, record.id);
    assert.equal((await keep(record.id)).status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
