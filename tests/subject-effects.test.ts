import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { subjectEffectsRouter } from '../server/subject-effects.js';
import {
  subjectEffectRequestSchema,
  subjectEffectRecipeSchema,
  type SubjectEffectSelection,
} from '../src/subject-effects.js';
import { RequestError, handleRequestError } from '../server/http-errors.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const media = {
  source: Buffer.from('original source with sound'),
  prepared: Buffer.from('prepared source'),
  mask: Buffer.from('lossless tracked mask'),
};
async function fixture(t: any, resolve?: (id: string) => Promise<SubjectEffectSelection>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-subject-'));
  const data = path.join(directory, 'data');
  await Promise.all([mkdir(path.join(directory, 'scripts')), mkdir(data)]);
  // The API fixture stops at the CPU worker boundary. The Python tests render
  // real video/audio separately, without any model or Torch dependency.
  await writeFile(
    path.join(directory, 'scripts/subject-effects.py'),
    `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.argv[2]==='--inspect') {
 const b=fs.readFileSync(process.argv[3]),role=process.argv[5];
 console.log(JSON.stringify({width:96,height:64,duration:role==='source'?2:1,hasAudio:role==='source',frames:role==='source'?48:24,fps:24,sha256:hash(b)}));
} else {
 const work=JSON.parse(fs.readFileSync(process.argv[2]));
 fs.appendFileSync(path.join(${JSON.stringify(directory)},'renders.log'),'render\\n');
 setTimeout(()=>{const b=Buffer.from(JSON.stringify(work.request));fs.writeFileSync(work.output,b);
 console.log(JSON.stringify({width:96,height:64,frames:24,fps:24,hasAudio:true,sha256:hash(b)}));},40);
}
`,
  );
  const source = path.join(directory, 'source.mp4'),
    prepared = path.join(directory, 'prepared.mp4'),
    mask = path.join(directory, 'mask.mkv');
  await Promise.all([
    writeFile(source, media.source),
    writeFile(prepared, media.prepared),
    writeFile(mask, media.mask),
  ]);
  const selectionId = randomUUID();
  const selection: SubjectEffectSelection = {
    id: selectionId,
    request: {
      format: 'aftertake-character-selection/1',
      clip: {
        id: randomUUID(),
        name: 'Original',
        kind: 'video',
        width: 96,
        height: 64,
        duration: 2,
        hasAudio: true,
        sha256: hash(media.source),
        url: '/media/source.mp4',
      },
      trimStart: 0.5,
      duration: 1,
      positive: [{ x: 0.2, y: 0.5 }],
      negative: [],
    },
    selection: {
      width: 96,
      height: 64,
      frames: 24,
      fps: 24,
      emptyFrames: [],
      maskSha256: hash(media.mask),
      sourceSha256: hash(media.prepared),
    },
    originalSourcePath: source,
    preparedSourcePath: prepared,
    maskPath: mask,
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/subject-effects',
    await subjectEffectsRouter({
      root: directory,
      data,
      python: process.execPath,
      resolveSelection:
        resolve ||
        (async (id) => {
          if (id !== selectionId) throw new RequestError('Selection not found.', 404);
          return selection;
        }),
    }),
  );
  app.use(handleRequestError);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as any).port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.ok(
      path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + 'aftertake-subject-'),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (route: string, body?: unknown, key?: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/subject-effects` + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const request = {
    format: 'aftertake-subject-effect/1',
    name: 'Two performers',
    selectionId,
    maskSha256: hash(media.mask),
    copies: [{ x: 0.25, y: 0, scale: 1, opacity: 1 }],
  };
  async function complete(id: string) {
    for (let i = 0; i < 100; i++) {
      const value = await call('/' + id);
      if (['succeeded', 'failed'].includes(value.body.state)) return value.body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error('CPU fixture did not finish.');
  }
  return {
    directory,
    data,
    selection,
    selectionId,
    call,
    request,
    complete,
    base: `http://127.0.0.1:${port}/api/subject-effects`,
  };
}

test('local subject jobs retain request identity, source audio metadata and a portable recipe without an engine', async (t) => {
  const f = await fixture(t);
  const created = await f.call('/duplicates', f.request, 'duplicate-one');
  assert.equal(created.status, 201);
  const replay = await f.call('/duplicates', f.request, 'duplicate-one');
  assert.equal(replay.body.id, created.body.id);
  assert.equal(
    (await f.call('/duplicates', { ...f.request, name: 'Different' }, 'duplicate-one')).status,
    409,
  );
  const done = await f.complete(created.body.id);
  assert.equal(done.state, 'succeeded');
  assert.equal(done.clip.hasAudio, true);
  assert.equal((await readFile(path.join(f.directory, 'renders.log'), 'utf8')).trim(), 'render');
  assert.equal(
    JSON.parse(await readFile(path.join(f.data, 'clips', done.id + '.json'), 'utf8')).sha256,
    done.clip.sha256,
  );
  const recipe = (await f.call('/' + done.id + '/recipe')).body;
  assert.ok(subjectEffectRecipeSchema.safeParse(recipe).success);
  assert.equal(recipe.media.prepared.sha256, hash(media.prepared));
  assert.equal(recipe.selection.request.trimStart, 0.5);
  assert.equal((await f.call('/' + randomUUID())).status, 404);
  await writeFile(f.selection.maskPath, 'changed mask');
  assert.equal((await f.call('/duplicates', f.request, 'new-revision')).status, 409);
  assert.equal((await fetch(f.base + '/' + done.id + '/media/mask')).status, 409);
});

test('portable media rebinds to new workspace IDs without retracking or starting an export on import', async (t) => {
  const original = await fixture(t);
  const started = await original.call('/duplicates', original.request, 'portable-source');
  const done = await original.complete(started.body.id);
  const recipe = (await original.call('/' + done.id + '/recipe')).body;
  const fresh = await fixture(t, async () => {
    throw new RequestError('No engine selection exists.', 404);
  });
  const ids: Record<string, string> = {};
  for (const role of ['source', 'prepared', 'mask'] as const) {
    const exported = await fetch(original.base + '/' + done.id + '/media/' + role);
    assert.equal(exported.status, 200);
    const bytes = new Uint8Array(await exported.arrayBuffer());
    assert.equal(hash(bytes), recipe.media[role].sha256);
    const upload = await fetch(
      fresh.base + '/media?role=' + role + '&name=' + recipe.media[role].filename,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes },
    );
    assert.equal(upload.status, 201);
    ids[role + 'Id'] = (await upload.json()).id;
  }
  const imported = await fresh.call('/imports', { recipe, media: ids });
  assert.equal(imported.status, 201);
  assert.notEqual(imported.body.request.selectionId, original.selectionId);
  assert.deepEqual((await fresh.call('/')).body, [], 'Importing a recipe does not render it.');
  const startedFresh = await fresh.call(
    '/duplicates',
    { ...imported.body.request, copies: [], backgroundBlur: 8, backgroundExposureEV: -1 },
    'portable-focus',
  );
  assert.equal(startedFresh.status, 201);
  assert.equal((await fresh.complete(startedFresh.body.id)).state, 'succeeded');
  const wrong = structuredClone(recipe);
  wrong.media.source.sha256 = 'a'.repeat(64);
  assert.equal((await fresh.call('/imports', { recipe: wrong, media: ids })).status, 400);
});

test('transform schema rejects unbounded copies and allows focus-only edits', () => {
  const request = {
    format: 'aftertake-subject-effect/1',
    name: 'Focus',
    selectionId: randomUUID(),
    maskSha256: 'a'.repeat(64),
    copies: [],
    backgroundBlur: 12,
    backgroundExposureEV: -0.5,
  };
  assert.ok(subjectEffectRequestSchema.safeParse(request).success);
  for (const change of [
    { backgroundBlur: 33 },
    { backgroundExposureEV: -3 },
    { copies: [{ x: 0, y: 0, scale: 4, opacity: 1 }] },
    { copies: [{ x: 0, y: 0, scale: 1, opacity: 1, rotation: 181 }] },
  ])
    assert.equal(subjectEffectRequestSchema.safeParse({ ...request, ...change }).success, false);
});
