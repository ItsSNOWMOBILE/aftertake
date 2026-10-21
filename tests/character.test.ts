import { createJobTarget } from '../server/job-target.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
