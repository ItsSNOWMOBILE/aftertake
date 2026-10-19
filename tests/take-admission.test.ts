import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { requirements } from '../server/workflow.js';
import { recipeSchema } from '../src/domain.js';

test(
  'ready takes reach the engine, failed initial storage leaves no ghost, and durable keys survive concurrent requests and restart',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-take-admission-'));
    const renderFolder = path.join(directory, 'renders');
    const heldFolder = path.join(directory, 'held-renders');
    const clips = path.join(directory, 'clips');
    await mkdir(clips);
    const recipe = JSON.parse(
      await readFile(new URL('../examples/observatory/recipe.json', import.meta.url), 'utf8'),
    );
    recipe.pipeline = 'structure';
    delete recipe.cinema;
    recipe.clip.kind = 'video';
    recipe.clip.duration = 5;
    recipe.clip.url = '/media/' + recipe.clip.id + '.mp4';
    recipe.cue.strokes = [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.25 }];
    recipeSchema.parse(recipe);
    const source = Buffer.from(
      'synthetic source; this admission test never decodes or generates media',
    );
    recipe.clip.sha256 = createHash('sha256').update(source).digest('hex');
    await writeFile(path.join(clips, recipe.clip.id + '.json'), JSON.stringify(recipe.clip));
    await writeFile(path.join(clips, path.basename(recipe.clip.url)), source);
    const needed = requirements('structure');
    const nodes: Record<string, any> = Object.fromEntries(
      needed.nodes.map((name) => [name, { input: { required: {}, optional: {} }, output: [] }]),
    );
    for (const [name, input, filename] of needed.menus)
      (nodes[name].input.required[input] ??= [[]])[0].push(filename);
    nodes.AftertakeLoadClip.output = ['IMAGE', 'STRING'];
    const requests: { method: string; pathname: string }[] = [];
    const submissions: { id: string; requestKey: string; workflow: unknown }[] = [];
    let held = false;
    let release: (() => void) | undefined;
    let engineFailure: unknown;
    const engine = createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        requests.push({ method: req.method || '', pathname });
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/json');
        if (pathname === '/object_info') return void res.end(JSON.stringify(nodes));
        if (pathname === '/system_stats')
          return void res.end(JSON.stringify({ devices: [], system: { os: 'posix' } }));
        if (pathname === '/api/v2/health') return void res.end('{}');
        if (req.method === 'HEAD' && pathname.startsWith('/api/v2/assets/by-hash/')) {
          res.statusCode = 404;
          return void res.end();
        }
        if (req.method === 'POST' && pathname === '/api/v2/assets') {
          res.statusCode = 201;
          return void res.end(
            JSON.stringify({
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              created_new: true,
              hash: null,
              file_path: 'source.png',
              size_bytes: source.length,
              content_type: 'image/png',
              created_at: '2026-10-19T00:00:00Z',
              url: '/unused',
              url_expires_at: '2030-01-01T00:00:00Z',
            }),
          );
        }
        if (req.method === 'POST' && pathname === '/api/v2/jobs') {
          const id = String(req.headers['idempotency-key']);
          const saved = JSON.parse(await readFile(path.join(renderFolder, id + '.json'), 'utf8'));
          assert.equal(saved.id, id);
          assert.equal(saved.state, 'submitting');
          submissions.push({ id, requestKey: saved.requestKey, workflow: saved.workflow });
          assert.ok(JSON.parse(body.toString()).workflow);
          if (held)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          res.statusCode = 422;
          return void res.end(
            JSON.stringify({
              error: { code: 'invalid_workflow', message: 'Synthetic admission rejection' },
            }),
          );
        }
        res.statusCode = 404;
        res.end('{}');
      } catch (error) {
        engineFailure = error;
        res.statusCode = 500;
        res.end('{}');
      }
    }).listen(0, '127.0.0.1');
    await once(engine, 'listening');
    const engineAddress = engine.address();
    assert.ok(engineAddress && typeof engineAddress !== 'string');
    const engineUrl = `http://127.0.0.1:${engineAddress.port}`;
    let child: ReturnType<typeof spawn> | undefined;
    let base = '';
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      child = undefined;
    }
    async function start() {
      const reservation = createServer().listen(0, '127.0.0.1');
      await once(reservation, 'listening');
      const address = reservation.address();
      assert.ok(address && typeof address !== 'string');
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
      base = `http://127.0.0.1:${address.port}`;
      child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
        cwd: process.cwd(),
        windowsHide: true,
        env: {
          ...process.env,
          PORT: String(address.port),
          AFTERTAKE_DATA_DIR: directory,
          AFTERTAKE_PYTHON: path.join(directory, 'unused-python'),
          COMFY_BASE_URL: engineUrl,
          COMFY_UI_URL: engineUrl,
          COMFY_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout!.on('data', (part) => {
        output += part.toString();
      });
      child.stderr!.on('data', (part) => {
        output += part.toString();
      });
      const startup = AbortSignal.timeout(15000);
      while (!output.includes('Aftertake studio:')) {
        assert.equal(child.exitCode, null, output.slice(-1000));
        await delay(20, undefined, { signal: startup });
      }
    }
    const post = (key: string, input = recipe) =>
      fetch(base + '/api/renders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10000),
      });
    const list = () => fetch(base + '/api/renders').then((response) => response.json());
    let replacedFolder = false;
    try {
      await start();
      const health = await fetch(base + '/api/engine').then((response) => response.json());
      assert.equal(health.ready, true);
      const ready = await post('ready-take');
      assert.equal(
        ready.status,
        502,
        'A ready take must pass admission and receive the synthetic SDK rejection',
      );
      const rejected = (await ready.json()).render;
      assert.equal(engineFailure, undefined);
      assert.equal(rejected.state, 'failed');
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].id, rejected.id);

      // Replace only this test's output-directory path with a file to force
      // an initial write failure on both Windows and Linux without changing ACLs.
      assert.equal(path.dirname(renderFolder), directory);
      assert.equal(path.dirname(heldFolder), directory);
      await rename(renderFolder, heldFolder);
      await writeFile(renderFolder, 'synthetic storage failure');
      replacedFolder = true;
      const priorRequests = requests.filter(
        (request) =>
          request.pathname.startsWith('/api/v2/assets') || request.pathname === '/api/v2/jobs',
      ).length;
      const failed = await post('storage-retry');
      // Windows reports ENOENT for a file used as a directory; POSIX uses ENOTDIR.
      assert.ok([404, 500].includes(failed.status));
      assert.doesNotMatch(
        JSON.stringify(await failed.json()),
        /ENOTDIR|aftertake-take-admission|renders[\\/]/,
      );
      const afterFailure = await list();
      assert.deepEqual(
        afterFailure.map((record: any) => record.id),
        [rejected.id],
        'An unsaved take must not be visible or reserve the engine',
      );
      assert.equal(
        requests.filter(
          (request) =>
            request.pathname.startsWith('/api/v2/assets') || request.pathname === '/api/v2/jobs',
        ).length,
        priorRequests,
      );
      await unlink(renderFolder);
      await rename(heldFolder, renderFolder);
      replacedFolder = false;
      const retry = await post('storage-retry');
      assert.equal(retry.status, 502);
      const retained = (await retry.json()).render;
      assert.equal(retained.state, 'failed');
      assert.equal(retained.requestKey, 'storage-retry');
      assert.equal(submissions.length, 2);
      assert.equal(engineFailure, undefined);
      const saved = JSON.parse(
        await readFile(path.join(renderFolder, retained.id + '.json'), 'utf8'),
      );
      assert.equal(saved.id, retained.id);
      assert.deepEqual(saved.workflow, retained.workflow);
      assert.equal((await post('storage-retry')).status, 200);
      assert.equal((await post('storage-retry', { ...recipe, seed: recipe.seed + 1 })).status, 409);
      assert.equal(submissions.length, 2);

      held = true;
      const pending = post('concurrent-take');
      const started = AbortSignal.timeout(5000);
      while (!release) await delay(10, undefined, { signal: started });
      const joined = await post('concurrent-take');
      assert.equal(joined.status, 202);
      const joinedRecord = await joined.json();
      assert.equal(joinedRecord.id, submissions[2].id);
      assert.equal((await post('different-take')).status, 409);
      const crossFamily = await fetch(base + '/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'aftertake-image/1',
          name: 'Blocked image',
          prompt: 'A coffee cup.',
          seed: 42,
          aspect: 'landscape',
          style: 'none',
        }),
      });
      assert.equal(crossFamily.status, 409);
      assert.equal(submissions.length, 3);
      held = false;
      release();
      assert.equal((await pending).status, 502);
      await stop();
      await start();
      const resumed = await post('storage-retry');
      assert.equal(resumed.status, 200);
      assert.equal((await resumed.json()).id, retained.id);
      assert.equal(submissions.length, 3);
      assert.equal((await list()).length, 3);
      assert.equal(engineFailure, undefined);
      assert.deepEqual(
        (await readdir(renderFolder)).filter((name) => name.endsWith('.tmp')),
        [],
      );
    } finally {
      held = false;
      release?.();
      await stop();
      engine.closeAllConnections();
      await new Promise<void>((resolve) => engine.close(() => resolve()));
      if (replacedFolder) {
        await unlink(renderFolder);
        await rename(heldFolder, renderFolder);
      }
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith('aftertake-take-admission-'));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
