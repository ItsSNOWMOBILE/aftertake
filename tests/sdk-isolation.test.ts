import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { ComfyError } from '@comfyorg/sdk';
import { createIsolatedClient } from '../server/sdk-client.js';
import { submissionRejected } from '../server/submission.js';

const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const privateMarker = 'synthetic-provider-private-response';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, message: string, milliseconds = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await delay(10);
  }
}

function noPrivateData(value: unknown, credentials: string[] = []) {
  const serialized = JSON.stringify(value) || '';
  for (const forbidden of [privateMarker, ...credentials])
    assert.ok(
      !serialized.includes(forbidden),
      'Adapter must not expose provider text or credentials',
    );
}

async function fixture(label: string) {
  const credential = 'synthetic-isolation-credential-' + label;
  const content = Buffer.from('streamed-output-' + label);
  const requests: {
    method: string;
    pathname: string;
    authorization: string | undefined;
    key: string | undefined;
    bytes: Buffer;
  }[] = [];
  const streams = new Set<ServerResponse>();
  const submitted = deferred();
  const getStarted = deferred();
  const releaseGet = deferred();
  const releaseDownload = deferred();
  let mode: 'normal' | 'reject' | 'hold-submit' | 'throttle-once' = 'normal';
  let status = 'running';
  let holdGets = false;
  let holdDownloads = false;
  let origin = '';
  let providerError: unknown = null;
  let unnamedOutput = false;
  let outputId = assetId;
  let graph: Record<string, any> | undefined;
  function output() {
    return {
      id: outputId,
      node_id: 'save',
      name: 'result.bin',
      type: 'video',
      content_type: 'application/octet-stream',
      size_bytes: content.length,
      hash: null,
      url: origin + '/api/v2/assets/' + encodeURIComponent(outputId) + '/content',
      url_expires_at: '2030-01-01T00:00:00Z',
    };
  }
  function job() {
    return {
      id: jobId,
      status,
      outputs: [
        output(),
        ...(unnamedOutput
          ? [{ ...output(), id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', node_id: '' }]
          : []),
      ],
      error: providerError,
      created_at: '2026-10-19T00:00:00Z',
      started_at: '2026-10-19T00:00:01Z',
      completed_at: null,
      expires_at: '2030-01-01T00:00:00Z',
      progress: null,
      queue_position: null,
      urls: {
        self: '/api/v2/jobs/' + jobId,
        cancel: '/api/v2/jobs/' + jobId + '/cancel',
        events: '/api/v2/jobs/' + jobId + '/events',
      },
    };
  }
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const pathname = new URL(req.url || '/', origin).pathname;
      requests.push({
        method: req.method || '',
        pathname,
        authorization: req.headers.authorization,
        key: req.headers['idempotency-key'] as string | undefined,
        bytes,
      });
      if (pathname.endsWith('/events')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        streams.add(res);
        res.on('close', () => streams.delete(res));
        res.write(
          'event: progress\ndata: ' +
            JSON.stringify({
              value: 0.25,
              current_node: 'sample',
              current_node_class: credential,
              message: privateMarker,
              nodes_done: 1,
              nodes_total: 4,
            }) +
            '\n\n',
        );
        return;
      }
      if (pathname.endsWith('/content')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.write(content.subarray(0, 1));
        if (holdDownloads) await releaseDownload.promise;
        res.end(content.subarray(1));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'HEAD' && pathname.startsWith('/api/v2/assets/by-hash/')) {
        res.statusCode = 404;
        return void res.end();
      }
      if (req.method === 'POST' && pathname === '/api/v2/assets') {
        res.statusCode = 201;
        return void res.end(
          JSON.stringify({
            id: assetId,
            created_new: true,
            hash: null,
            file_path: 'source.bin',
            size_bytes: 8,
            content_type: 'application/octet-stream',
            created_at: '2026-10-19T00:00:00Z',
            url: origin + '/api/v2/assets/' + assetId + '/content',
            url_expires_at: '2030-01-01T00:00:00Z',
          }),
        );
      }
      if (req.method === 'POST' && pathname === '/api/v2/jobs') {
        graph = JSON.parse(bytes.toString()).workflow;
        submitted.resolve();
        if (mode === 'hold-submit') return;
        if (mode === 'throttle-once') {
          mode = 'normal';
          res.statusCode = 429;
          res.setHeader('Retry-After', '0');
          return void res.end(
            JSON.stringify({ error: { code: 'queue_full', message: privateMarker } }),
          );
        }
        if (mode === 'reject') {
          res.statusCode = 422;
          return void res.end(
            JSON.stringify({
              error: {
                code: 'invalid_workflow',
                message: privateMarker + ':' + credential,
                details: { echoedKey: credential },
              },
            }),
          );
        }
        res.statusCode = 201;
        return void res.end(JSON.stringify(job()));
      }
      if (req.method === 'POST' && pathname.endsWith('/cancel')) {
        status = 'canceling';
        return void res.end(JSON.stringify(job()));
      }
      if (req.method === 'GET' && pathname === '/api/v2/jobs/' + jobId) {
        if (holdGets) {
          getStarted.resolve();
          await releaseGet.promise;
        }
        return void res.end(JSON.stringify(job()));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: 'not_found', message: privateMarker } }));
    } catch {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = 'http://127.0.0.1:' + address.port;
  return {
    origin,
    credential,
    content,
    requests,
    streams,
    submitted,
    getStarted,
    setMode(value: typeof mode) {
      mode = value;
    },
    setStatus(value: string) {
      status = value;
    },
    setError(value: unknown) {
      providerError = value;
    },
    includeUnnamedOutput() {
      unnamedOutput = true;
    },
    setOutputId(value: string) {
      outputId = value;
    },
    get graph() {
      return graph;
    },
    holdGets() {
      holdGets = true;
    },
    releaseGets() {
      holdGets = false;
      releaseGet.resolve();
    },
    holdDownloads() {
      holdDownloads = true;
    },
    releaseDownloads() {
      holdDownloads = false;
      releaseDownload.resolve();
    },
    async close() {
      releaseGet.resolve();
      releaseDownload.resolve();
      for (const stream of streams) stream.destroy();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), 'aftertake-sdk-isolation-'));
  const read = path.join(root, 'input');
  const write = path.join(root, 'output');
  await Promise.all([mkdir(read), mkdir(write)]);
  const source = path.join(read, 'source.bin');
  await writeFile(source, 'synthetic input bytes');
  return {
    root,
    read,
    write,
    source,
    async close() {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
      assert.ok(path.basename(root).startsWith('aftertake-sdk-isolation-'));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test(
  'real SDK workers isolate identical IDs, preserve materialization and throttling retries, and keep credentials outside snapshots',
  { timeout: 20000 },
  async () => {
    const before = { base: process.env.COMFY_BASE_URL, key: process.env.COMFY_API_KEY };
    const data = await directory();
    const fixtures = await Promise.all([fixture('A'), fixture('B')]);
    const clients: Awaited<ReturnType<typeof createIsolatedClient>>[] = [];
    try {
      fixtures[0].setMode('throttle-once');
      fixtures[1].includeUnnamedOutput();
      for (const f of fixtures)
        clients.push(
          await createIsolatedClient({
            baseUrl: f.origin,
            apiKey: f.credential,
            readRoots: [data.read],
            writeRoots: [data.write],
          }),
        );
      const keys = [randomUUID(), randomUUID()];
      const jobs = await Promise.all(
        clients.map((client, index) => {
          const workflow = client.workflows.fromJson({
            load: { class_type: 'LoadVideo', inputs: {} },
          });
          workflow.setInput('load', 'file', client.assets.fromFile(data.source));
          return client.submit(workflow, { idempotencyKey: keys[index] });
        }),
      );
      for (const [index, client] of clients.entries()) {
        const f = fixtures[index];
        assert.equal(jobs[index].id, jobId);
        assert.equal(jobs[index].status, 'running');
        const reference = f.graph?.load.inputs.file;
        assert.equal(reference.__type, 'core/ASSET');
        assert.equal(reference.info.id, assetId);
        assert.equal(typeof reference.info.hash, 'string');
        assert.ok(f.requests.some((r) => r.method === 'HEAD'));
        assert.equal(
          f.requests.filter(
            (r) =>
              r.pathname === '/api/v2/assets' &&
              r.bytes.includes(Buffer.from('synthetic input bytes')),
          ).length,
          1,
        );
        const posts = f.requests.filter((r) => r.pathname === '/api/v2/jobs');
        assert.equal(posts.length, index ? 1 : 2);
        assert.ok(posts.every((r) => r.key === keys[index]));
        const resumed = await client.jobs.get(jobId);
        assert.equal(resumed.getOutputs('').length, index ? 1 : 0);
        f.setStatus(index ? 'queued' : 'succeeded');
        await resumed.refresh();
        assert.equal(resumed.status, index ? 'queued' : 'succeeded');
        const dest = path.join(data.write, 'result-' + index + '.bin');
        await resumed.getOutputs('save')[0].toFile(dest);
        assert.deepEqual(await readFile(dest), f.content);
        await resumed.cancel();
        assert.equal(resumed.status, 'canceling');
        f.setStatus('canceled');
        await resumed.refresh();
        assert.equal(resumed.status, 'canceled');
        f.setStatus('failed');
        f.setError({ code: 'runtime_error', message: privateMarker + f.credential });
        await resumed.refresh();
        noPrivateData(
          { client, job: resumed, error: resumed.error },
          fixtures.map((item) => item.credential),
        );
        assert.ok(f.requests.every((r) => r.authorization === 'Bearer ' + f.credential));
      }
      assert.ok(process.env.COMFY_BASE_URL === before.base, 'Parent engine environment changed');
      assert.ok(process.env.COMFY_API_KEY === before.key, 'Parent credential environment changed');
    } catch (error) {
      if (error instanceof Error)
        error.message +=
          ' Loopback operations: ' +
          JSON.stringify(
            fixtures.map((f) =>
              f.requests.map(({ method, pathname }) => ({
                method,
                pathname: pathname.replace(/by-hash\/.*/, 'by-hash/<hash>'),
              })),
            ),
          );
      throw error;
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await Promise.all(fixtures.map((f) => f.close()));
      await data.close();
    }
  },
);

test(
  'opaque local-proxy output identities survive submit, restored snapshots and exact streamed download routing',
  { timeout: 15000 },
  async () => {
    const data = await directory();
    const f = await fixture('opaque-output');
    // The real local proxy can return signed opaque asset identities even though
    // SDK comments describe UUIDs. This token is synthetic, never a live capability.
    const token = ' synthetic-output-identity.雪.' + 'x'.repeat(180) + '.part+/=%?&# ';
    f.setOutputId(token);
    const client = await createIsolatedClient({
      baseUrl: f.origin,
      readRoots: [data.read],
      writeRoots: [data.write],
    });
    try {
      const results = await Promise.allSettled([
        client.submit(client.workflows.fromJson({ save: { class_type: 'Mock', inputs: {} } }), {
          idempotencyKey: randomUUID(),
        }),
        client.jobs.get(jobId),
      ]);
      assert.deepEqual(
        results.map((result) => result.status),
        ['fulfilled', 'fulfilled'],
        'A valid opaque output must not discard an accepted submit or restored job snapshot',
      );
      for (const [index, result] of results.entries()) {
        assert.equal(result.status, 'fulfilled');
        if (result.status !== 'fulfilled') continue;
        assert.equal(result.value.id, jobId);
        await result.value.refresh();
        const outputs = result.value.getOutputs('save');
        assert.equal(outputs.length, 1);
        const destination = path.join(data.write, 'opaque-' + index + '.bin');
        await outputs[0].toFile(destination);
        assert.deepEqual(await readFile(destination), f.content);
      }
      const downloads = f.requests.filter((request) => request.pathname.endsWith('/content'));
      assert.equal(downloads.length, 2);
      assert.ok(
        downloads.every(
          (request) =>
            request.pathname === '/api/v2/assets/' + encodeURIComponent(token) + '/content',
        ),
      );
      assert.equal(
        f.requests.filter(
          (request) => request.pathname === '/api/v2/jobs' && request.method === 'POST',
        ).length,
        1,
      );
      for (const invalid of ['', 'synthetic\nidentity', 'x'.repeat(4097)]) {
        f.setOutputId(invalid);
        await assert.rejects(client.jobs.get(jobId));
      }
    } finally {
      await client.close();
      await f.close();
      await data.close();
    }
  },
);

test(
  'typed admission rejection stays distinct from an ambiguous timed-out or closed submit without replay',
  { timeout: 20000 },
  async () => {
    const data = await directory();
    const f = await fixture('failure');
    const clients: Awaited<ReturnType<typeof createIsolatedClient>>[] = [];
    try {
      f.setMode('reject');
      const rejectedClient = await createIsolatedClient({
        baseUrl: f.origin,
        apiKey: f.credential,
        readRoots: [data.read],
        writeRoots: [data.write],
      });
      clients.push(rejectedClient);
      await assert.rejects(
        rejectedClient.submit(
          rejectedClient.workflows.fromJson({ save: { class_type: 'Mock', inputs: {} } }),
          { idempotencyKey: randomUUID() },
        ),
        (error: unknown) => {
          assert.ok(error instanceof ComfyError);
          assert.equal(error.code, 'invalid_workflow');
          assert.equal(error.httpStatus, 422);
          assert.equal(submissionRejected(error), true);
          noPrivateData({ message: error.message, error }, [f.credential]);
          return true;
        },
      );
      await rejectedClient.close();
      f.setMode('hold-submit');
      const timedClient = await createIsolatedClient({
        baseUrl: f.origin,
        apiKey: f.credential,
        readRoots: [data.read],
        writeRoots: [data.write],
        rpcTimeoutMs: 1000,
        ioTimeoutMs: 1000,
      });
      clients.push(timedClient);
      const priorPosts = f.requests.filter((r) => r.pathname === '/api/v2/jobs').length;
      await assert.rejects(
        timedClient.submit(
          timedClient.workflows.fromJson({ save: { class_type: 'Mock', inputs: {} } }),
          { idempotencyKey: randomUUID() },
        ),
        (error: unknown) => {
          assert.equal(submissionRejected(error), false);
          noPrivateData({ message: error instanceof Error ? error.message : error, error }, [
            f.credential,
          ]);
          return true;
        },
      );
      assert.equal(f.requests.filter((r) => r.pathname === '/api/v2/jobs').length - priorPosts, 1);
      await timedClient.close();
      const closedClient = await createIsolatedClient({
        baseUrl: f.origin,
        apiKey: f.credential,
        readRoots: [data.read],
        writeRoots: [data.write],
      });
      clients.push(closedClient);
      const closePriorPosts = f.requests.filter((r) => r.pathname === '/api/v2/jobs').length;
      const pending = closedClient.submit(
        closedClient.workflows.fromJson({ save: { class_type: 'Mock', inputs: {} } }),
        { idempotencyKey: randomUUID() },
      );
      const outcome = pending.then(
        () => assert.fail('A closed ambiguous submit must not succeed'),
        (error: unknown) => {
          assert.equal(submissionRejected(error), false);
          noPrivateData({ message: error instanceof Error ? error.message : error, error }, [
            f.credential,
          ]);
        },
      );
      await until(
        () => f.requests.filter((r) => r.pathname === '/api/v2/jobs').length > closePriorPosts,
        'Submit did not reach its loopback fixture',
      );
      await closedClient.close();
      await within(outcome, 'Closing the worker did not settle its pending submit');
      await assert.rejects(closedClient.jobs.get(jobId));
      assert.equal(
        f.requests.filter((r) => r.pathname === '/api/v2/jobs').length - closePriorPosts,
        1,
      );
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await f.close();
      await data.close();
    }
  },
);

test(
  'file roots and client ownership reject invalid descriptors before network access',
  { timeout: 15000 },
  async () => {
    const data = await directory();
    const f = await fixture('paths');
    const clients: Awaited<ReturnType<typeof createIsolatedClient>>[] = [];
    try {
      for (let i = 0; i < 2; i++)
        clients.push(
          await createIsolatedClient({
            baseUrl: f.origin,
            readRoots: [data.read],
            writeRoots: [data.write],
          }),
        );
      const [first, second] = clients;
      const before = f.requests.length;
      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(
        first.submit(first.workflows.fromJson({ save: { class_type: 'Mock', inputs: {} } }), {
          idempotencyKey: randomUUID(),
          signal: aborted.signal,
        }),
      );
      await assert.rejects(async () => {
        const workflow = first.workflows.fromJson({
          load: { class_type: 'LoadVideo', inputs: {} },
        });
        workflow.setInput(
          'load',
          'file',
          first.assets.fromFile(path.join(data.root, 'outside.bin')),
        );
        await first.submit(workflow, { idempotencyKey: randomUUID() });
      });
      await assert.rejects(async () => {
        const workflow = second.workflows.fromJson({
          load: { class_type: 'LoadVideo', inputs: {} },
        });
        workflow.setInput('load', 'file', first.assets.fromFile(data.source));
        await second.submit(workflow, { idempotencyKey: randomUUID() });
      });
      await assert.rejects(async () => {
        const foreign = first.workflows.fromJson({ save: { class_type: 'Mock', inputs: {} } });
        await second.submit(foreign, { idempotencyKey: randomUUID() });
      });
      assert.equal(f.requests.length, before);
      const job = await first.jobs.get(jobId);
      const beforeOutput = f.requests.length;
      await assert.rejects(async () =>
        job.getOutputs('save')[0].toFile(path.join(data.root, 'outside.bin')),
      );
      assert.equal(f.requests.length, beforeOutput);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await f.close();
      await data.close();
    }
  },
);

test(
  'pending RPCs are bounded and live progress does not block three streamed downloads or job control',
  { timeout: 20000 },
  async () => {
    const data = await directory();
    const f = await fixture('concurrency');
    const clients: Awaited<ReturnType<typeof createIsolatedClient>>[] = [];
    let controller: AbortController | undefined;
    try {
      const bounded = await createIsolatedClient({
        baseUrl: f.origin,
        readRoots: [data.read],
        writeRoots: [data.write],
        maxPending: 2,
      });
      clients.push(bounded);
      const job = await bounded.jobs.get(jobId);
      f.holdGets();
      const reads = [job.refresh(), job.refresh()];
      const completedReads = Promise.all(reads);
      void completedReads.catch(() => {});
      await within(f.getStarted.promise, 'Held reads did not reach the fixture');
      const overload = await within(
        job.refresh().then(
          () => ({ accepted: true }),
          (error: unknown) => ({ error }),
        ),
        'Overload must reject instead of waiting for a free RPC slot',
        1000,
      );
      assert.ok('error' in overload);
      f.releaseGets();
      await completedReads;
      assert.equal(f.requests.filter((r) => r.pathname === '/api/v2/jobs/' + jobId).length, 3);
      await bounded.close();
      const client = await createIsolatedClient({
        baseUrl: f.origin,
        readRoots: [data.read],
        writeRoots: [data.write],
        maxPending: 8,
      });
      clients.push(client);
      const live = await client.jobs.get(jobId);
      controller = new AbortController();
      const iterator = live.events(controller.signal)[Symbol.asyncIterator]();
      const first = await within(iterator.next(), 'No real SSE progress reached the parent');
      assert.equal(first.done, false);
      assert.equal(first.value?.kind, 'progress');
      assert.equal(first.value?.value, 0.25);
      assert.equal(first.value?.currentNode, 'sample');
      assert.deepEqual(Object.keys(first.value).sort(), ['currentNode', 'kind', 'value']);
      noPrivateData(first.value, [f.credential]);
      f.holdDownloads();
      const downloads = [0, 1, 2].map((index) =>
        live.getOutputs('save')[0].toFile(path.join(data.write, 'parallel-' + index + '.bin')),
      );
      const completedDownloads = Promise.all(downloads);
      void completedDownloads.catch(() => {});
      await until(
        () => f.requests.filter((r) => r.pathname.endsWith('/content')).length === 3,
        'Three output streams did not start concurrently',
      );
      await within(live.refresh(), 'An open SSE and downloads blocked authoritative polling');
      await within(live.cancel(), 'An open SSE and downloads blocked cancellation');
      assert.equal(live.status, 'canceling');
      assert.equal(f.streams.size, 1);
      f.releaseDownloads();
      await completedDownloads;
      for (let index = 0; index < 3; index++)
        assert.deepEqual(
          await readFile(path.join(data.write, 'parallel-' + index + '.bin')),
          f.content,
        );
      controller.abort();
      await within(
        iterator.next().catch(() => ({ done: true })),
        'Aborting progress left a pending pull',
      );
      await iterator.return?.();
      await until(() => f.streams.size === 0, 'Aborting progress did not close the SSE socket');
    } finally {
      controller?.abort();
      f.releaseGets();
      f.releaseDownloads();
      await Promise.all(clients.map((client) => client.close()));
      await f.close();
      await data.close();
    }
  },
);

test(
  'workflow mutations remain bounded JSON before they cross the worker message boundary',
  { timeout: 15000 },
  async (t) => {
    const data = await directory();
    const f = await fixture('payload');
    const client = await createIsolatedClient({
      baseUrl: f.origin,
      readRoots: [data.read],
      writeRoots: [data.write],
    });
    const postMessage = Worker.prototype.postMessage;
    let submittedMessages = 0;
    const messageMock = t.mock.method(
      Worker.prototype,
      'postMessage',
      function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
        if (args[0]?.op === 'submit') submittedMessages++;
        return postMessage.apply(this, args);
      },
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    try {
      for (const value of ['x'.repeat(8 * 1024 * 1024), 1n, cyclic]) {
        await assert.rejects(async () => {
          const workflow = client.workflows.fromJson({ save: { class_type: 'Mock', inputs: {} } });
          workflow.setInput('save', 'value', value);
          await client.submit(workflow, { idempotencyKey: randomUUID() });
        });
      }
      assert.equal(
        submittedMessages,
        0,
        'Invalid or oversized graph must be rejected before IPC cloning',
      );
      assert.equal(f.requests.length, 0);
    } finally {
      messageMock.mock.restore();
      await client.close();
      await f.close();
      await data.close();
    }
  },
);
