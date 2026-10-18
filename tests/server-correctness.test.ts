import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { loadWorkspaceEnvironment } from '../server/environment.js';
import { cancelAndRefresh } from '../server/job-cancel.js';
import { GenerationCoordinator } from '../server/generation-coordinator.js';

test('shared generation admission includes uncertain native jobs and excludes only the caller', () => {
  const generation = new GenerationCoordinator();
  let frameActive = false;
  let characterState = 'succeeded';
  generation.register('frames', () => frameActive);
  generation.register(
    'characters',
    () => !['succeeded', 'failed', 'canceled'].includes(characterState),
  );
  const frames = generation.forWorker('frames');
  const characters = generation.forWorker('characters');
  assert.equal(generation.busy(), false);
  frames.setAdmitting(true);
  assert.equal(characters.takeBusy(), true);
  assert.equal(frames.takeBusy(), true);
  frames.setAdmitting(false);
  frameActive = true;
  assert.equal(frames.takeBusy(), false);
  assert.equal(characters.takeBusy(), true);
  frameActive = false;
  for (const uncertain of ['submitting', 'submission_unknown', 'connection_lost', 'finalizing']) {
    characterState = uncertain;
    assert.equal(frames.takeBusy(), true);
    assert.equal(generation.busy(), true);
  }
  characterState = 'canceled';
  assert.equal(generation.busy(), false);
});

async function remove(directory: string) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('aftertake-correctness-'));
  await rm(directory, { recursive: true, force: true });
}

test('workspace environment loads its absolute file even when the caller is elsewhere', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-correctness-'));
  const loads: string[] = [];
  try {
    await loadWorkspaceEnvironment(directory, (file) => {
      loads.push(String(file));
    });
    assert.equal(loads.length, 0);
    await writeFile(path.join(directory, '.env'), 'AFTERTAKE_TEST_SETTING=workspace\n');
    await loadWorkspaceEnvironment(directory, (file) => {
      loads.push(String(file));
    });
    assert.deepEqual(loads, [path.join(directory, '.env')]);
    assert.ok(path.isAbsolute(loads[0]));
  } finally {
    await remove(directory);
  }
});

test('cancellation refreshes native state and preserves observation failures', async () => {
  const calls: string[] = [];
  const job = {
    cancel: async () => {
      calls.push('cancel');
      return job;
    },
    refresh: async () => {
      calls.push('refresh');
      return job;
    },
  };
  await cancelAndRefresh(job as any);
  assert.deepEqual(calls, ['cancel', 'refresh']);
  job.refresh = async () => {
    throw Error('native observation unavailable');
  };
  await assert.rejects(cancelAndRefresh(job as any), /native observation unavailable/);
});

test('native thumbnail routes distinguish missing media, runtime setup, cached media and internal failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-correctness-'));
  const clipDirectory = path.join(directory, 'clips');
  await mkdir(clipDirectory, { recursive: true });
  const id = '00000000-0000-4000-8000-000000000001';
  const missing = '00000000-0000-4000-8000-000000000002';
  const broken = '00000000-0000-4000-8000-000000000003';
  const sha256 = 'a'.repeat(64);
  await writeFile(
    path.join(clipDirectory, id + '.json'),
    JSON.stringify({
      id,
      name: 'Source',
      sha256,
      width: 320,
      height: 240,
      duration: 2,
      url: '/media/' + id + '.mp4',
    }),
  );
  await writeFile(path.join(clipDirectory, broken + '.json'), 'not JSON');
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      AFTERTAKE_DATA_DIR: directory,
      AFTERTAKE_PYTHON: path.join(directory, 'missing-python'),
      COMFY_BASE_URL: 'http://127.0.0.1:9',
      COMFY_UI_URL: 'http://127.0.0.1:8',
    },
  });
  let output = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error('Native server did not start: ' + output.slice(-1000))),
        15000,
      );
      child.stdout.on('data', (bytes) => {
        output += bytes.toString();
        if (output.includes('Aftertake studio:')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.stderr.on('data', (bytes) => {
        output += bytes.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('exit', () => {
        clearTimeout(timeout);
        reject(Error('Native server exited: ' + output.slice(-1000)));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const absent = await fetch(base + '/api/thumbnails/' + missing);
    assert.equal(absent.status, 404);
    assert.equal((await absent.json()).error, 'The requested media or project was not found.');
    const runtime = await fetch(base + '/api/thumbnails/' + id);
    assert.equal(runtime.status, 409);
    assert.match((await runtime.json()).error, /Install the Python runtime/);
    const failure = await fetch(base + '/api/thumbnails/' + broken);
    assert.equal(failure.status, 500);
    assert.doesNotMatch(JSON.stringify(await failure.json()), /JSON|clips|aftertake-correctness/);
    const invalid = await fetch(base + '/api/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(invalid.status, 400);
    const key = createHash('sha256').update(`thumbnail/1:${sha256}:0`).digest('hex');
    const cached = Buffer.from('cached thumbnail fixture');
    await writeFile(path.join(directory, 'previews', key + '.jpg'), cached);
    const response = await fetch(base + '/api/thumbnails/' + id);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), cached);
  } finally {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    await remove(directory);
  }
});
