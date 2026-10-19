import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { InvalidWorkflow } from '@comfyorg/sdk/low';
import { characterRouter } from '../server/characters.js';
import { handleRequestError } from '../server/http-errors.js';

test('replacement resolves every identity asset, binds original files and restores the full recipe', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-character-assets-')),
    data = path.join(directory, '.data'),
    clips = path.join(data, 'clips'),
    folder = path.join(data, 'characters');
  await Promise.all([
    mkdir(clips, { recursive: true }),
    mkdir(folder, { recursive: true }),
    mkdir(path.join(directory, 'scripts')),
  ]);
  // Stop at the SDK boundary: this executable fixture needs neither Python nor
  // installed H3 models. Native graph wiring is checked in the Python tests.
  await writeFile(
    path.join(directory, 'scripts/character-workflow.py'),
    `
    let input=''; process.stdin.on('data', part => input+=part);
    process.stdin.on('end', () => {
      const value=JSON.parse(input), graph={source:{class_type:'LoadVideo',inputs:{}},
        reference:{class_type:'LoadImage',inputs:{}},mask_video:{class_type:'LoadVideo',inputs:{}},
        original_audio:{class_type:'AftertakeLoadClip',inputs:{}}};
      (value.request.identityReferences||[]).forEach((_,index) => graph['identity_reference_'+index]={class_type:'LoadImage',inputs:{}});
      process.stdout.write(JSON.stringify(graph));
    });
  `,
  );
  const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const store = async (name: string, kind: 'image' | 'video', width = 960, height = 1280) => {
    const id = randomUUID(),
      bytes = Buffer.from(name),
      extension = kind === 'image' ? 'png' : 'mp4',
      clip = {
        id,
        name,
        kind,
        width,
        height,
        duration: kind === 'image' ? 1 : 12,
        hasAudio: kind === 'video',
        sha256: hash(bytes),
        url: `/media/${id}.${extension}`,
      };
    await writeFile(path.join(clips, `${id}.${extension}`), bytes);
    await writeFile(path.join(clips, `${id}.json`), JSON.stringify(clip));
    return clip;
  };
  const original = await store('original performance', 'video', 1920, 1080),
    primary = await store('primary wardrobe photo', 'image'),
    front = await store('independent front photo', 'image'),
    side = await store('independent side photo', 'image'),
    supporting = await store('independent identity photo', 'image'),
    selectionId = randomUUID(),
    faceBox = { x: 0.3, y: 0.1, width: 0.4, height: 0.3 };
  const mask = Buffer.from('reviewed lossless mask'),
    prepared = Buffer.from('prepared source');
  await Promise.all([
    writeFile(path.join(folder, selectionId + '-mask.mkv'), mask),
    writeFile(path.join(folder, selectionId + '-source.mp4'), prepared),
    writeFile(
      path.join(folder, selectionId + '.json'),
      JSON.stringify({
        id: selectionId,
        kind: 'selection',
        state: 'succeeded',
        request: {
          format: 'aftertake-character-selection/1',
          clip: original,
          trimStart: 1,
          duration: 8,
          positive: [{ x: 0.4, y: 0.4 }],
          negative: [],
        },
        workflow: {},
        createdAt: new Date().toISOString(),
        selection: {
          width: 960,
          height: 512,
          frames: 192,
          fps: 24,
          emptyFrames: [],
          maskSha256: hash(mask),
          sourceSha256: hash(prepared),
        },
      }),
    ),
  ]);
  const bindings: unknown[][] = [];
  let submissions = 0;
  const client = {
    workflows: { fromJson: () => ({ setInput: (...args: unknown[]) => bindings.push(args) }) },
    assets: { fromFile: (file: string) => ({ asset: file }) },
    submit: async () => {
      submissions++;
      throw new InvalidWorkflow('Test stops before GPU execution', { httpStatus: 400 });
    },
  };
  const open = async () => {
    const app = express(),
      { router } = await characterRouter({
        root: directory,
        data,
        python: process.execPath,
        client: client as any,
        uiUrl: 'http://127.0.0.1:1',
        engine: async () => ({ ready: true }) as any,
        takeBusy: () => false,
        setAdmitting: () => {},
      });
    app.use(express.json());
    app.use('/api/characters', router);
    app.use(handleRequestError);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return {
      base: `http://127.0.0.1:${address.port}/api/characters`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  };
  let app = await open();
  const candidate = {
    format: 'aftertake-character/1',
    name: 'Multi-photo take',
    selectionId,
    seed: 42,
    prompt: 'Keep the scene.',
    faceBox,
    reference: {
      ...primary,
      name: 'caller name',
      width: 1000,
      height: 1000,
      url: '/media/not-the-original.png',
    },
    identityReferences: [
      { reference: front, faceBox },
      { reference: side },
      {
        reference: { ...supporting, width: 800, height: 800, url: '/media/not-the-support.png' },
        faceBox,
      },
    ],
  };
  const post = (body: unknown, key: string) =>
    fetch(app.base + '/replacements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
  try {
    const response = await post(candidate, 'canonical-multi-reference');
    assert.equal(response.status, 502); // Intentional SDK rejection after actual asset binding.
    const { character } = (await response.json()) as any;
    assert.equal(character.state, 'failed');
    assert.deepEqual(character.request.reference, primary);
    assert.deepEqual(character.request.identityReferences, [
      { reference: front, faceBox },
      { reference: side },
      { reference: supporting, faceBox },
    ]);
    for (const [index, photo] of [front, side, supporting].entries())
      assert.ok(
        bindings.some(
          (args) =>
            args[0] === `identity_reference_${index}` &&
            args[1] === 'image' &&
            (args[2] as any).asset === path.join(clips, path.basename(photo.url)),
        ),
      );
    assert.ok(
      bindings.some(
        (args) =>
          args[0] === 'reference' &&
          (args[2] as any).asset === path.join(clips, path.basename(primary.url)),
      ),
    );
    assert.equal(submissions, 1);
    const rejoined = await post(candidate, 'canonical-multi-reference');
    assert.equal(rejoined.status, 200);
    assert.equal(((await rejoined.json()) as any).id, character.id);
    assert.equal(submissions, 1);
    assert.equal(
      (await post({ ...candidate, identityReferences: [] }, 'canonical-multi-reference')).status,
      409,
    );
    await app.close();
    app = await open();
    const restored = (await (await fetch(app.base + '/' + character.id)).json()) as any;
    assert.deepEqual(restored.request, character.request);

    await writeFile(path.join(clips, path.basename(supporting.url)), 'changed bytes');
    assert.equal((await post(candidate, 'tampered-support')).status, 409);
    await writeFile(path.join(clips, path.basename(supporting.url)), 'independent identity photo');
    await writeFile(
      path.join(clips, supporting.id + '.json'),
      JSON.stringify({ ...supporting, kind: 'video' }),
    );
    assert.equal((await post(candidate, 'not-a-photo')).status, 400);
    await writeFile(
      path.join(clips, supporting.id + '.json'),
      JSON.stringify({ ...supporting, width: 100, height: 2000 }),
    );
    assert.equal((await post(candidate, 'actual-crop-aspect')).status, 400);
    await writeFile(
      path.join(clips, supporting.id + '.json'),
      JSON.stringify({ ...supporting, id: primary.id }),
    );
    assert.equal((await post(candidate, 'canonical-duplicate-id')).status, 400);
    assert.equal(submissions, 1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
