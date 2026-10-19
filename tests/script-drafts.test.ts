import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, rename, mkdir, readdir } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { scriptDraftRouter } from '../server/script-drafts.js';
type RenamePath = Parameters<typeof rename>[0];
import { contentDigest } from '../server/edit-plan.js';
import {
  scriptRequestSchema,
  checkedScriptResult,
  scriptModelRevision,
  scriptRevision,
} from '../src/script-draft.js';
const input = scriptRequestSchema.parse({
  brief: 'Coffee beans for slow mornings.',
  closingLine: 'Make mornings yours.',
  pictures: [
    { key: 'beans:0', name: 'Beans into filter', seconds: 3 },
    { key: 'pour:0', name: 'Pouring water', seconds: 3 },
    { key: 'cup:0', name: 'Finished cup', seconds: 3 },
  ],
});
const result = {
  lines: ['Start with the beans.', 'Water meets the grounds.', 'Make mornings yours.'],
  receipt: {
    model: 'Qwen3-4B / OpenVINO INT4',
    revision: scriptModelRevision,
    weightsSha256: 'a'.repeat(64),
    runtime: 'Test contract',
    device: 'CPU',
    deviceName: 'Test CPU',
    loadSeconds: 1,
    generationSeconds: 1,
    structuredOutput: true,
  },
};
test('script contracts preserve explicit closing copy and reject missing, extra or multiline rows', () => {
  assert.equal(checkedScriptResult(result, input).lines.length, 3);
  for (const lines of [
    result.lines.slice(1),
    [...result.lines, 'Extra line'],
    ['A\nB', ...result.lines.slice(1)],
    ['A', 'B', 'Changed CTA'],
  ])
    assert.throws(() => checkedScriptResult({ ...result, lines }, input));
  assert.equal(
    scriptRequestSchema.safeParse({ ...input, pictures: [input.pictures[0], input.pictures[0]] })
      .success,
    false,
  );
});
test('native script jobs rejoin by content and recover two transient metadata locks without changing inputs or results', async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-script-test-'));
  let calls = 0,
    ready = true,
    finish!: () => void;
  const hold = new Promise<void>((r) => (finish = r));
  const run = async (requestFile: string, outputFile: string) => {
    calls++;
    const payload = JSON.parse(await readFile(requestFile, 'utf8'));
    assert.deepEqual(payload.request, input);
    await hold;
    const temporary = outputFile + '.test.tmp';
    await writeFile(temporary, JSON.stringify({ requestDigest: payload.requestDigest, result }));
    await rename(temporary, outputFile);
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/script-drafts',
    await scriptDraftRouter({ root: data, data, ready: async () => ready, run }),
  );
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/script-drafts`;
  const post = async (route: string, body: unknown) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  let restoreRename = () => {};
  try {
    const firstResponse = await post('', input);
    assert.equal(firstResponse.status, 202);
    const first = await firstResponse.json();
    const repeat = await post('', input);
    assert.equal(repeat.status, 202);
    assert.equal((await repeat.json()).id, first.id);
    for (let i = 0; i < 50 && calls === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
    assert.equal((await post('', { ...input, variation: 1 })).status, 409);
    const stored = JSON.parse(
      await readFile(path.join(data, 'script-drafts', first.id + '.json'), 'utf8'),
    );
    assert.equal(stored.requestDigest, first.requestDigest);
    // Simulate a restarted native process while the original worker still owns
    // its result: the route rejoins the record, and output is collected by hash.
    const resumed = express();
    resumed.use(express.json());
    resumed.use(
      '/api/script-drafts',
      await scriptDraftRouter({
        root: data,
        data,
        ready: async () => false,
        run: async () => {
          throw Error('Should not run after completed output');
        },
      }),
    );
    const recovery = createServer(resumed).listen(0, '127.0.0.1');
    await once(recovery, 'listening');
    const addr = recovery.address();
    assert.ok(addr && typeof addr !== 'string');
    const url = `http://127.0.0.1:${addr.port}/api/script-drafts`;
    try {
      assert.equal((await fetch(url + '/' + first.id).then((r) => r.json())).state, 'interrupted');
      const metadataFile = path.join(data, 'script-drafts', first.id + '.json');
      const originalRename = fs.promises.rename;
      const injected: string[] = [];
      const renameMock = t.mock.method(
        fs.promises,
        'rename',
        async (source: RenamePath, destination: RenamePath) => {
          if (String(destination) === metadataFile && injected.length < 2) {
            const code = ['EPERM', 'EACCES'][injected.length];
            injected.push(code);
            throw Object.assign(Error('Transient metadata replacement lock'), { code });
          }
          return originalRename(source, destination);
        },
      );
      syncBuiltinESMExports();
      restoreRename = () => {
        renameMock.mock.restore();
        syncBuiltinESMExports();
      };
      finish();
      let job: any;
      for (let i = 0; i < 50; i++) {
        job = await fetch(url + '/' + first.id).then((r) => r.json());
        if (job.state === 'ready') break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(job.state, 'ready');
      assert.deepEqual(job.result, result);
      assert.deepEqual(job.request, input);
      assert.equal(job.requestDigest, first.requestDigest);
      assert.deepEqual(injected, ['EPERM', 'EACCES']);
      const saved = JSON.parse(await readFile(metadataFile, 'utf8'));
      assert.equal(saved.state, 'ready');
      assert.deepEqual(saved.result, result);
      assert.deepEqual(saved.request, input);
      assert.equal(saved.requestDigest, first.requestDigest);
      const again = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.equal(again.status, 200);
      assert.equal((await again.json()).id, first.id);
      assert.equal(calls, 1);
      const reconciled = await fetch(url + '/' + first.id + '/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal((await reconciled.json()).state, 'ready');
    } finally {
      recovery.close();
      recovery.closeAllConnections();
    }
    for (let i = 0; i < 50; i++) {
      if ((await fetch(base + '/' + first.id).then((r) => r.json())).state === 'ready') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    ready = false;
    assert.equal((await post('', { ...input, variation: 1 })).status, 409);
  } finally {
    finish();
    restoreRename();
    server.close();
    server.closeAllConnections();
    assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
    assert.ok(path.basename(data).startsWith('aftertake-script-test-'));
    await rm(data, { recursive: true, force: true });
  }
});

test('permanent replacement locks are bounded, other errors surface immediately, and failed collection never publishes unsaved ready state', async (t) => {
  for (const [code, expectedAttempts] of [
    ['EPERM', 5],
    ['EACCES', 5],
    ['EBUSY', 5],
    ['EIO', 1],
  ] as const) {
    const data = await mkdtemp(path.join(tmpdir(), 'aftertake-script-lock-test-'));
    const folder = path.join(data, 'script-drafts');
    await mkdir(folder);
    const id = randomUUID();
    const metadataFile = path.join(folder, id + '.json');
    const stored = {
      id,
      requestDigest: contentDigest({
        revision: scriptRevision,
        model: scriptModelRevision,
        request: input,
      }),
      request: input,
      state: 'interrupted',
      error: 'Retained interrupted draft',
      createdAt: '2026-10-19T00:00:00.000Z',
      updatedAt: '2026-10-19T00:00:00.000Z',
    };
    const originalBytes = JSON.stringify(stored);
    await writeFile(metadataFile, originalBytes);
    const app = express();
    app.use(express.json());
    app.use(
      '/api/script-drafts',
      await scriptDraftRouter({
        root: data,
        data,
        ready: async () => false,
        run: async () => assert.fail('A restored output must not start inference'),
      }),
    );
    const onError: express.ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(503).json({ code: error.code });
    };
    app.use(onError);
    // Match the native worker: the complete result appears through one rename.
    const output = path.join(folder, id + '.output.json');
    const temporary = output + '.test.tmp';
    await writeFile(temporary, JSON.stringify({ requestDigest: stored.requestDigest, result }));
    await rename(temporary, output);
    const server = createServer(app).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/script-drafts/${id}`;
    const originalRename = fs.promises.rename;
    let attempts = 0;
    const renameMock = t.mock.method(
      fs.promises,
      'rename',
      async (source: RenamePath, destination: RenamePath) => {
        if (String(destination) === metadataFile) {
          attempts++;
          throw Object.assign(Error('Metadata replacement refused'), { code });
        }
        return originalRename(source, destination);
      },
    );
    syncBuiltinESMExports();
    try {
      try {
        const failed = await fetch(url);
        assert.equal(failed.status, 503, code);
        assert.deepEqual(await failed.json(), { code });
        assert.equal(attempts, expectedAttempts, code);
        assert.equal(await readFile(metadataFile, 'utf8'), originalBytes);
        assert.deepEqual(
          (await readdir(folder)).filter((name) => name.endsWith('.tmp')),
          [],
        );
      } finally {
        renameMock.mock.restore();
        syncBuiltinESMExports();
      }
      // Collection remains recoverable after storage recovers. An in-memory
      // ready flag published before persistence would skip this needed write.
      const recovered = await fetch(url);
      assert.equal(recovered.status, 200);
      const job = await recovered.json();
      const persisted = JSON.parse(await readFile(metadataFile, 'utf8'));
      for (const draft of [job, persisted]) {
        assert.equal(draft.state, 'ready');
        assert.equal(draft.error, undefined);
        assert.equal(draft.requestDigest, stored.requestDigest);
        assert.deepEqual(draft.request, input);
        assert.deepEqual(draft.result, result);
      }
    } finally {
      renameMock.mock.restore();
      syncBuiltinESMExports();
      server.close();
      server.closeAllConnections();
      assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
      assert.ok(path.basename(data).startsWith('aftertake-script-lock-test-'));
      await rm(data, { recursive: true, force: true });
    }
  }
});

test(
  'a worker with permanently locked metadata retains its saved draft and collects output after storage recovers',
  { timeout: 10000 },
  async (t) => {
    const data = await mkdtemp(path.join(tmpdir(), 'aftertake-script-worker-lock-test-'));
    const folder = path.join(data, 'script-drafts');
    let locked = false,
      attempts = 0,
      calls = 0;
    let warned!: () => void;
    const warning = new Promise<void>((resolve) => {
      warned = resolve;
    });
    const warnings: unknown[][] = [];
    const warningMock = t.mock.method(console, 'warn', (...args: unknown[]) => {
      warnings.push(args);
      warned();
    });
    const originalRename = fs.promises.rename;
    const renameMock = t.mock.method(
      fs.promises,
      'rename',
      async (source: RenamePath, destination: RenamePath) => {
        if (
          locked &&
          path.dirname(String(destination)) === folder &&
          /^[a-f0-9-]{36}\.json$/.test(path.basename(String(destination)))
        ) {
          attempts++;
          throw Object.assign(Error('Private metadata path is locked'), { code: 'EPERM' });
        }
        return originalRename(source, destination);
      },
    );
    syncBuiltinESMExports();
    const app = express();
    app.use(express.json());
    app.use(
      '/api/script-drafts',
      await scriptDraftRouter({
        root: data,
        data,
        ready: async () => true,
        run: async (requestFile, outputFile) => {
          calls++;
          const payload = JSON.parse(await readFile(requestFile, 'utf8'));
          const temporary = outputFile + '.test.tmp';
          await writeFile(
            temporary,
            JSON.stringify({ requestDigest: payload.requestDigest, result }),
          );
          await rename(temporary, outputFile);
          locked = true;
        },
      }),
    );
    const server = createServer(app).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/script-drafts`;
    try {
      const admitted = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.equal(admitted.status, 202);
      const first = await admitted.json();
      await warning;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 1);
      assert.equal(attempts, 10);
      assert.deepEqual(warnings, [
        [
          'Could not save the script draft state. Keep the original request to collect or resume it.',
        ],
      ]);
      const metadataFile = path.join(folder, first.id + '.json');
      const retained = JSON.parse(await readFile(metadataFile, 'utf8'));
      assert.equal(retained.state, 'drafting');
      assert.equal(retained.result, undefined);
      assert.deepEqual(retained.request, input);
      assert.equal(retained.requestDigest, first.requestDigest);
      assert.deepEqual(
        (await readdir(folder)).filter((name) => name.endsWith('.tmp')),
        [],
      );
      locked = false;
      const response = await fetch(base + '/' + first.id);
      assert.equal(response.status, 200);
      const completed = await response.json();
      const persisted = JSON.parse(await readFile(metadataFile, 'utf8'));
      for (const job of [completed, persisted]) {
        assert.equal(job.state, 'ready');
        assert.deepEqual(job.request, input);
        assert.deepEqual(job.result, result);
        assert.equal(job.requestDigest, first.requestDigest);
      }
      assert.equal(calls, 1);
    } finally {
      locked = false;
      renameMock.mock.restore();
      syncBuiltinESMExports();
      warningMock.mock.restore();
      server.close();
      server.closeAllConnections();
      assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
      assert.ok(path.basename(data).startsWith('aftertake-script-worker-lock-test-'));
      await rm(data, { recursive: true, force: true });
    }
  },
);

test('failed initial admission publishes no ghost draft and the same input starts one worker after storage recovers', async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-script-admission-test-'));
  const folder = path.join(data, 'script-drafts');
  let locked = true,
    attempts = 0,
    calls = 0;
  let rejectedId: string | undefined;
  const originalRename = fs.promises.rename;
  const renameMock = t.mock.method(
    fs.promises,
    'rename',
    async (source: RenamePath, destination: RenamePath) => {
      if (
        locked &&
        path.dirname(String(destination)) === folder &&
        /^[a-f0-9-]{36}\.json$/.test(path.basename(String(destination)))
      ) {
        attempts++;
        rejectedId = path.basename(String(destination), '.json');
        throw Object.assign(Error('Initial metadata replacement locked'), { code: 'EPERM' });
      }
      return originalRename(source, destination);
    },
  );
  syncBuiltinESMExports();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/script-drafts',
    await scriptDraftRouter({
      root: data,
      data,
      ready: async () => true,
      run: async (requestFile, outputFile) => {
        calls++;
        const payload = JSON.parse(await readFile(requestFile, 'utf8'));
        assert.deepEqual(payload.request, input);
        const temporary = outputFile + '.test.tmp';
        await writeFile(
          temporary,
          JSON.stringify({ requestDigest: payload.requestDigest, result }),
        );
        await rename(temporary, outputFile);
      },
    }),
  );
  const onError: express.ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(503).json({ code: error.code });
  };
  app.use(onError);
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/script-drafts`;
  const post = () =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  try {
    const failed = await post();
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { code: 'EPERM' });
    assert.equal(attempts, 5);
    assert.equal(calls, 0);
    assert.ok(rejectedId);
    assert.deepEqual(await fetch(base).then((response) => response.json()), []);
    assert.deepEqual(await readdir(folder), []);
    locked = false;
    const admitted = await post();
    assert.equal(admitted.status, 202);
    const first = await admitted.json();
    assert.notEqual(first.id, rejectedId);
    let completed: any;
    for (let i = 0; i < 50; i++) {
      completed = await fetch(base + '/' + first.id).then((response) => response.json());
      if (completed.state === 'ready') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(completed.state, 'ready');
    assert.equal(calls, 1);
    const persisted = JSON.parse(await readFile(path.join(folder, first.id + '.json'), 'utf8'));
    for (const job of [completed, persisted]) {
      assert.deepEqual(job.request, input);
      assert.deepEqual(job.result, result);
      assert.equal(job.requestDigest, first.requestDigest);
    }
    assert.equal((await fetch(base).then((response) => response.json())).length, 1);
    assert.deepEqual(
      (await readdir(folder)).filter((name) => name.endsWith('.tmp')),
      [],
    );
  } finally {
    locked = false;
    renameMock.mock.restore();
    syncBuiltinESMExports();
    server.close();
    server.closeAllConnections();
    assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
    assert.ok(path.basename(data).startsWith('aftertake-script-admission-test-'));
    await rm(data, { recursive: true, force: true });
  }
});
