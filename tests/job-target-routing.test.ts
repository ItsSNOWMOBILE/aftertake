import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createJobTarget } from '../server/job-target.js';
import { contentDigest } from '../server/edit-plan.js';

test('restart binding blocks cross-engine actions for all five job families and explicit metadata checks use canonical startup URLs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-job-target-'));
  const recipe = JSON.parse(
    await readFile(new URL('../examples/observatory/recipe.json', import.meta.url), 'utf8'),
  );
  const image = {
    format: 'aftertake-image/1',
    name: 'Engine identity fixture',
    prompt: 'An observatory above the clouds.',
    seed: 42,
    aspect: 'landscape',
    style: 'none',
  };
  const video = {
    format: 'aftertake-text-video/1',
    name: 'Engine identity fixture',
    prompt: 'Steam rises from an unbranded coffee cup.',
    seed: 42,
    aspect: 'landscape',
    quality: 'draft',
    seconds: 2,
    sound: true,
  };
  const clip = {
    id: randomUUID(),
    name: 'Source fixture',
    kind: 'video',
    width: 1280,
    height: 720,
    duration: 5,
    hasAudio: true,
    sha256: 'a'.repeat(64),
    url: '/media/source-fixture.mp4',
  };
  const frame = {
    format: 'aftertake-frame-edit/1',
    clip,
    trimStart: 0,
    prompt: 'Replace the window with a crystal sculpture.',
    seed: 42,
    mode: 'fast',
  };
  const selection = {
    format: 'aftertake-character-selection/1',
    clip,
    trimStart: 0,
    duration: 2,
    positive: [{ x: 0.5, y: 0.5 }],
    negative: [],
  };
  const previousTarget = createJobTarget({
    sdkBaseUrl: 'http://127.0.0.1:8189',
    uiBaseUrl: 'http://127.0.0.1:8188',
  }).binding;
  const fixtures = [
    { folder: 'renders', route: '/api/renders', input: recipe, recipe: true },
    { folder: 'images', route: '/api/images', input: image },
    { folder: 'videos', route: '/api/videos', input: video },
    { folder: 'frame-edits', route: '/api/frame-edits', input: frame },
    { folder: 'characters', route: '/api/characters', input: selection, kind: 'selection' },
  ].map((fixture) => ({
    ...fixture,
    record: {
      id: randomUUID(),
      jobId: randomUUID(),
      jobTarget: previousTarget,
      state: 'running',
      progress: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestKey: 'original-' + fixture.folder,
      requestDigest: contentDigest(fixture.input),
      workflow: { saved: { class_type: 'OriginalWorkflow', inputs: { seed: 42 } } },
      ...(fixture.recipe ? { recipe: fixture.input } : { request: fixture.input }),
      ...(fixture.kind ? { kind: fixture.kind } : {}),
    },
  }));
  const allFixtures = fixtures.flatMap((fixture) => [
    fixture,
    {
      ...fixture,
      record: {
        ...fixture.record,
        id: randomUUID(),
        jobId: undefined,
        state: 'submitting',
        requestKey: fixture.record.requestKey + '-uncertain',
      },
    },
  ]);
  for (const fixture of allFixtures) {
    await mkdir(path.join(directory, fixture.folder), { recursive: true });
    await writeFile(
      path.join(directory, fixture.folder, fixture.record.id + '.json'),
      JSON.stringify(fixture.record),
    );
  }
  let engineRequests = 0;
  const enginePaths: string[] = [];
  const engine = createServer((req, res) => {
    engineRequests++;
    enginePaths.push(req.url || '');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'A mismatched job must never reach this engine.' }));
  }).listen(0, '127.0.0.1');
  await once(engine, 'listening');
  const engineAddress = engine.address();
  assert.ok(engineAddress && typeof engineAddress !== 'string');
  const engineUrl = `http://127.0.0.1:${engineAddress.port}`;
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${address.port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(address.port),
      AFTERTAKE_DATA_DIR: directory,
      COMFY_BASE_URL: engineUrl + '/proxy///',
      COMFY_UI_URL: engineUrl + '/native///',
      COMFY_API_KEY: '',
    },
  });
  let output = '';
  child.stdout.on('data', (part) => (output += part.toString()));
  child.stderr.on('data', (part) => (output += part.toString()));
  try {
    const startup = AbortSignal.timeout(15000);
    while (!output.includes('Aftertake studio:')) {
      assert.equal(child.exitCode, null, output.slice(-1000));
      await delay(20, undefined, { signal: startup });
    }
    const request = async (route: string, body: unknown = {}) => {
      const response = await fetch(base + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 409, route);
      const value = await response.json();
      assert.match(value.error, /engine|target/i);
      assert.doesNotMatch(value.error, /127\.0\.0\.1|https?:|[a-f0-9]{64}/);
    };
    for (const fixture of allFixtures) {
      const waiting = AbortSignal.timeout(5000);
      const expectedState = fixture.record.jobId ? 'connection_lost' : 'submission_unknown';
      let record: any;
      do {
        const records = await fetch(base + fixture.route).then((response) => response.json());
        record = records.find((value: any) => value.id === fixture.record.id);
        if (record?.state !== expectedState) await delay(20, undefined, { signal: waiting });
      } while (record?.state !== expectedState);
      assert.match(record.error, /engine|target/i);
      if (fixture.record.jobId) await request(`${fixture.route}/${record.id}/cancel`);
      await request(`${fixture.route}/${record.id}/reconcile`);
      const stored = JSON.parse(
        await readFile(path.join(directory, fixture.folder, record.id + '.json'), 'utf8'),
      );
      for (const key of [
        'id',
        'jobId',
        'jobTarget',
        'requestKey',
        'requestDigest',
        'workflow',
        'request',
        'recipe',
      ]) {
        assert.deepEqual(stored[key], (fixture.record as any)[key], `${fixture.folder}: ${key}`);
      }
      assert.equal(engineRequests, 0, fixture.folder);
    }
    assert.equal(engineRequests, 0);
    // Deliberate metadata inspection is separate from the blocked job actions.
    const inspected = await fetch(base + '/api/engine');
    assert.equal(inspected.status, 200);
    assert.deepEqual(enginePaths.sort(), [
      '/native/aftertake/runtime?profile=structure',
      '/native/object_info',
      '/native/system_stats',
      '/proxy/api/v2/health',
    ]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    engine.closeAllConnections();
    await new Promise<void>((resolve) => engine.close(() => resolve()));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-job-target-'));
    await rm(directory, { recursive: true, force: true });
  }
});
