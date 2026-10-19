import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createRouterConnection } from '../server/router-client.js';
import { handleRequestError } from '../server/http-errors.js';
import { routerVideoRouter } from '../server/router-videos.js';
import type { RouterMediaInfo } from '../server/router-media.js';
import type { RouterVideoGeneration, RouterVideoRequest } from '../src/router-video.js';

const credential = 'fixture-private-router-account';
const otherCredential = 'fixture-different-router-account';
const providerId = '11111111-2222-4333-8444-555555555555';
const providerBase = 'https://api.comfy.org/v2/models/ltx/ltx-2-5-fast';
const assetUrl =
  'https://storage.googleapis.com/ltx-research-model-serving/fixture.mp4?token=fixture-signed-secret';
const mediaBytes = Buffer.from('a deterministic downloaded media fixture');
const request: RouterVideoRequest = {
  format: 'aftertake-router-video/1',
  name: 'Hosted coffee shot',
  prompt: 'A locked-off shot of coffee beans in soft morning light.',
  aspect: 'landscape',
  seconds: 2,
  sound: false,
};
const media: RouterMediaInfo = {
  width: 1280,
  height: 720,
  frames: 49,
  fps: 24,
  duration: 49 / 24,
  hasAudio: false,
  regularTimestamps: true,
  firstTimestamp: 0,
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function eventually<T>(read: () => Promise<T>, accepted: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4000;
  let last: T;
  do {
    last = await read();
    if (accepted(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  assert.fail(`Hosted fixture did not reach its expected state: ${JSON.stringify(last!)}`);
}

function providerFixture() {
  const calls: { url: string; method: string; headers: Headers; body?: string }[] = [];
  const admissions = new Map<string, string>();
  let status = 'IN_PROGRESS';
  let errorType: string | undefined;
  let lostReplies = 0;
  let conflict: string | undefined;
  let statusGate: ReturnType<typeof deferred> | undefined;
  const fetcher = (async (url, init) => {
    const call = {
      url: String(url),
      method: init?.method || 'GET',
      headers: new Headers(init?.headers),
      ...(init?.body ? { body: String(init.body) } : {}),
    };
    calls.push(call);
    assert.equal(call.headers.get('X-API-Key'), credential);
    assert.equal(init?.redirect, 'error');
    if (call.url === providerBase && call.method === 'GET')
      return json({ privateAccount: credential });
    if (call.url.endsWith('/estimate'))
      return json({ detail: credential }, 403, { 'X-Comfy-Error-Type': 'not_enabled' });
    if (call.url === providerBase + '/requests?reject_unknown_fields=true') {
      assert.equal(call.method, 'POST');
      if (conflict)
        return json({ detail: credential }, 409, {
          'X-Comfy-Error-Type': conflict,
          'Retry-After': '2',
        });
      const key = call.headers.get('Idempotency-Key');
      assert.ok(key);
      if (admissions.has(key)) assert.equal(admissions.get(key), call.body);
      else admissions.set(key, call.body!);
      if (lostReplies-- > 0) throw new Error('Connection lost after provider admission');
      return json({ request_id: providerId, status: 'IN_QUEUE' }, 201);
    }
    if (call.url === `${providerBase}/requests/${providerId}/status`) {
      if (statusGate) await statusGate.promise;
      return json(
        { request_id: providerId, status, ...(errorType ? { error_type: errorType } : {}) },
        200,
        { 'Retry-After': '7' },
      );
    }
    if (call.url === `${providerBase}/requests/${providerId}`)
      return json({ status: 'completed', result: { video_url: assetUrl }, private: credential });
    if (call.url === `${providerBase}/requests/${providerId}/cancel`) {
      assert.equal(call.method, 'PUT');
      return json({ request_id: providerId, status: 'CANCELLATION_REQUESTED' }, 202);
    }
    assert.fail(`Unexpected provider call: ${call.method} ${call.url}`);
  }) as typeof fetch;
  return {
    fetcher,
    calls,
    admissions,
    setStatus(value: string, error?: string) {
      status = value;
      errorType = error;
    },
    loseNextReply() {
      lostReplies = 1;
    },
    conflict(value: string | undefined) {
      conflict = value;
    },
    holdStatus() {
      statusGate = deferred();
      return () => {
        statusGate?.resolve();
        statusGate = undefined;
      };
    },
  };
}

type RouterOptions = Parameters<typeof routerVideoRouter>[0];
async function studio(
  data: string,
  provider: ReturnType<typeof providerFixture>,
  options: Partial<Omit<RouterOptions, 'root' | 'data' | 'python' | 'connection'>> = {},
) {
  const connection = createRouterConnection({ fetch: provider.fetcher });
  const pauses: ReturnType<typeof deferred>[] = [];
  const downloads: string[] = [];
  const runtime = await routerVideoRouter({
    root: process.cwd(),
    data,
    // Existence preflight is real; the injected inspector prevents any interpreter execution.
    python: process.execPath,
    connection,
    download: async (url) => {
      downloads.push(url);
      return mediaBytes;
    },
    inspect: async (filename) => {
      assert.deepEqual(await readFile(filename), mediaBytes);
      return media;
    },
    wait: async (milliseconds, signal) => {
      assert.equal(milliseconds, 7000);
      const gate = deferred();
      pauses.push(gate);
      const abort = () => gate.reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        await gate.promise;
      } finally {
        signal.removeEventListener('abort', abort);
        const index = pauses.indexOf(gate);
        if (index >= 0) pauses.splice(index, 1);
      }
    },
    ...options,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/router-videos', runtime.router);
  app.use(handleRequestError);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/router-videos`;
  async function call(route = '', method = 'GET', body?: unknown, headers = {}) {
    return fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function connect(key = credential) {
    const response = await call('/connection', 'POST', { apiKey: key });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ admissionScope: string }>;
  }
  async function state(id: string) {
    const response = await call('/' + id);
    assert.equal(response.status, 200);
    return response.json() as Promise<RouterVideoGeneration>;
  }
  return {
    call,
    state,
    connect,
    downloads,
    stopRouter: () => runtime.close(),
    async create(key = 'browser-request', scope?: string) {
      const current = scope ?? (await connect()).admissionScope;
      return call('', 'POST', request, {
        'Idempotency-Key': key,
        'X-Aftertake-Admission-Scope': current,
      });
    },
    async advance() {
      await eventually(
        async () => pauses.length,
        (length) => length > 0,
      );
      pauses[0].resolve();
    },
    async close() {
      await runtime.close();
      server.closeAllConnections();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function workspace() {
  return mkdtemp(path.join(os.tmpdir(), 'aftertake-hosted-video-'));
}
async function stored(data: string, id: string) {
  return JSON.parse(await readFile(path.join(data, 'router-videos', id + '.json'), 'utf8'));
}
function videoFrom(body: RouterVideoGeneration | { video: RouterVideoGeneration }) {
  return 'video' in body ? body.video : body;
}

test('hosted admission must persist before any billable POST', async () => {
  const data = await workspace();
  const provider = providerFixture();
  const app = await studio(data, provider, {
    persist: async () => {
      throw Error('disk offline');
    },
  });
  try {
    const response = await app.create();
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.video.state, 'failed');
    assert.match(body.error, /No provider generation was started/);
    assert.equal(provider.calls.length, 0);
    assert.equal(provider.admissions.size, 0);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

for (const interruption of ['disconnect', 'close'] as const) {
  test(`${interruption} while initial persistence is pending prevents a later paid submission`, async () => {
    const data = await workspace();
    const provider = providerFixture();
    const entered = deferred();
    const release = deferred();
    let firstWrite = true;
    const app = await studio(data, provider, {
      persist: async (filename, value) => {
        if (firstWrite) {
          firstWrite = false;
          entered.resolve();
          await release.promise;
        }
        await writeFile(filename, JSON.stringify(value));
      },
    });
    try {
      const pending = app.create();
      await entered.promise;
      if (interruption === 'disconnect')
        assert.equal((await app.call('/connection', 'DELETE')).status, 200);
      else await app.stopRouter();
      release.resolve();
      const response = await pending;
      const video = videoFrom(await response.json());
      assert.equal(provider.calls.length, 0);
      assert.equal(provider.admissions.size, 0);
      assert.equal(video.state, 'submission_unknown');
      assert.equal(video.providerRequestId, undefined);
    } finally {
      release.resolve();
      await app.close();
      await rm(data, { recursive: true, force: true });
    }
  });
}

test('an accepted handle survives persistence failure and still collects the measured 49-frame output', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.setStatus('COMPLETED');
  let initialSaved = false;
  const app = await studio(data, provider, {
    persist: async (filename, value) => {
      if (value.providerRequestId) throw Error('disk unavailable after acceptance');
      await writeFile(filename, JSON.stringify(value));
      initialSaved = true;
    },
  });
  try {
    const response = await app.create();
    assert.equal(response.status, 201);
    const submitted = await response.json();
    const done = await eventually(
      () => app.state(submitted.id),
      (value) => value.state === 'succeeded',
    );
    assert.equal(initialSaved, true);
    assert.equal(done.providerRequestId, providerId);
    assert.equal(done.clip?.duration, 49 / 24);
    assert.equal(done.clip?.width, 1280);
    assert.equal(done.clip?.hasAudio, false);
    assert.equal(done.clip?.sha256, createHash('sha256').update(mediaBytes).digest('hex'));
    assert.deepEqual(app.downloads, [assetUrl]);
    assert.equal(provider.admissions.size, 1);
    assert.deepEqual(await readFile(path.join(data, 'clips', done.id + '.mp4')), mediaBytes);
    for (const value of [
      done,
      await (await app.call()).json(),
      await (await app.call('/' + done.id + '/request')).json(),
    ]) {
      const text = JSON.stringify(value);
      for (const forbidden of [
        credential,
        'fixture-signed-secret',
        data,
        'video_url',
        'intentDigest',
        '"intent"',
      ])
        assert.equal(text.includes(forbidden), false, forbidden);
    }
    const persisted = await stored(data, done.id);
    assert.equal(persisted.providerRequestId, undefined);
    assert.equal(JSON.stringify(persisted).includes(credential), false);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('lost submit recovery replays the original persisted key and body without a second queued job', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.loseNextReply();
  let clock = Date.parse('2026-10-19T12:00:00Z');
  const app = await studio(data, provider, { now: () => clock });
  try {
    const response = await app.create();
    assert.equal(response.status, 503);
    const initial = videoFrom(await response.json());
    assert.equal(initial.state, 'submission_unknown');
    const before = await stored(data, initial.id);
    assert.equal(before.intent.key, initial.id);
    assert.equal(before.providerRequestId, undefined);
    clock += 23 * 60 * 60 * 1000;
    provider.setStatus('COMPLETED');
    const recovery = await app.call('/' + initial.id + '/reconcile', 'POST');
    assert.equal(recovery.status, 200);
    await eventually(
      () => app.state(initial.id),
      (value) => value.state === 'succeeded',
    );
    const posts = provider.calls.filter((call) => call.method === 'POST');
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts.map((call) => call.headers.get('Idempotency-Key')),
      [initial.id, initial.id],
    );
    assert.equal(posts[0].body, posts[1].body);
    assert.equal(posts[0].url, posts[1].url);
    assert.equal(provider.admissions.size, 1);
    assert.equal((await stored(data, initial.id)).providerRequestId, providerId);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('restart requires the original credential and preserves same-key reconciliation', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.loseNextReply();
  let app = await studio(data, provider);
  try {
    const first = videoFrom(await (await app.create()).json());
    await app.close();
    app = await studio(data, provider);
    const baseline = provider.calls.length;
    assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 409);
    await app.connect(otherCredential);
    assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 409);
    assert.equal(provider.calls.length, baseline);
    await app.connect();
    provider.setStatus('COMPLETED');
    assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 200);
    await eventually(
      () => app.state(first.id),
      (value) => value.state === 'succeeded',
    );
    assert.equal(provider.admissions.size, 1);
    const keys = provider.calls
      .filter((call) => call.method === 'POST')
      .map((call) => call.headers.get('Idempotency-Key'));
    assert.deepEqual(keys, [first.id, first.id]);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('unobserved admission stops replay outside its 23-hour safety window', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.loseNextReply();
  let clock = Date.parse('2026-10-19T12:00:00Z');
  const app = await studio(data, provider, { now: () => clock });
  try {
    const initial = videoFrom(await (await app.create()).json());
    clock += 23 * 60 * 60 * 1000 + 1;
    const count = provider.calls.length;
    const replay = await app.call('/' + initial.id + '/reconcile', 'POST');
    assert.equal(replay.status, 409);
    assert.match((await replay.json()).error, /replay window has expired/);
    assert.equal(provider.calls.length, count);
    assert.equal((await stored(data, initial.id)).intent.key, initial.id);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('changed browser admission scope and reused keys with changed inputs cannot POST', async () => {
  const data = await workspace();
  const provider = providerFixture();
  const app = await studio(data, provider);
  try {
    const current = await app.connect();
    const rejected = await app.create('fresh-intent', 'stale-session');
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).code, 'admission_scope_changed');
    assert.equal(provider.calls.length, 0);
    const first = await (await app.create('stable-browser-key', current.admissionScope)).json();
    const count = provider.calls.length;
    const rejoined = await app.create('stable-browser-key', 'stale-session');
    assert.equal(videoFrom(await rejoined.json()).id, first.id);
    const changed = await app.call(
      '',
      'POST',
      { ...request, prompt: 'A different deliberate request.' },
      {
        'Idempotency-Key': 'stable-browser-key',
        'X-Aftertake-Admission-Scope': current.admissionScope,
      },
    );
    assert.equal(changed.status, 409);
    assert.equal(provider.calls.length, count);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('409 admission ambiguity retains the intent and does not automatically retry or mint another key', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.conflict('concurrency_limit_exceeded');
  const app = await studio(data, provider);
  try {
    const response = await app.create();
    assert.equal(response.status, 409);
    const first = videoFrom(await response.json());
    assert.equal(first.state, 'submission_unknown');
    assert.equal(provider.calls.length, 1);
    provider.conflict('invalid_input');
    assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 409);
    assert.equal((await app.state(first.id)).state, 'submission_unknown');
    assert.equal(provider.calls.length, 2);
    assert.ok(provider.calls.every((call) => call.headers.get('Idempotency-Key') === first.id));
    assert.equal(provider.admissions.size, 0);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('202 cancellation remains pending, and a generation that wins the race is still collected', async () => {
  const data = await workspace();
  const provider = providerFixture();
  const app = await studio(data, provider);
  try {
    const first = await (await app.create()).json();
    await eventually(
      () => app.state(first.id),
      (value) => value.state === 'running',
    );
    const cancellation = await app.call('/' + first.id + '/cancel', 'POST');
    assert.equal(cancellation.status, 200);
    assert.equal((await cancellation.json()).state, 'canceling');
    assert.equal(app.downloads.length, 0);
    provider.setStatus('COMPLETED');
    await app.advance();
    const done = await eventually(
      () => app.state(first.id),
      (value) => value.state === 'succeeded',
    );
    assert.equal(done.providerRequestId, providerId);
    assert.equal(done.clip?.duration, 49 / 24);
    assert.deepEqual(app.downloads, [assetUrl]);
    assert.equal(provider.calls.filter((call) => call.method === 'PUT').length, 1);
    assert.equal(provider.admissions.size, 1);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('authoritative canceled completion is terminal without downloading a video', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.setStatus('COMPLETED', 'cancelled');
  const app = await studio(data, provider);
  try {
    const first = await (await app.create()).json();
    await eventually(
      () => app.state(first.id),
      (value) => value.state === 'canceled',
    );
    assert.deepEqual(app.downloads, []);
    assert.equal(
      provider.calls.filter((call) => call.url === `${providerBase}/requests/${providerId}`).length,
      0,
    );
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('disconnect followed by immediate reconnect can recover while the old status read is still pending', async () => {
  const data = await workspace();
  const provider = providerFixture();
  const releaseStatus = provider.holdStatus();
  const app = await studio(data, provider);
  try {
    const first = await (await app.create()).json();
    const statusCalls = () => provider.calls.filter((call) => call.url.endsWith('/status')).length;
    await eventually(
      async () => statusCalls(),
      (count) => count === 1,
    );
    assert.equal((await app.call('/connection', 'DELETE')).status, 200);
    assert.equal((await app.state(first.id)).state, 'connection_lost');
    await app.connect();
    assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 200);
    // Recovery must start a fresh tracked read before the abandoned read settles.
    await eventually(
      async () => statusCalls(),
      (count) => count === 2,
    );
    provider.setStatus('COMPLETED');
    releaseStatus();
    await eventually(
      () => app.state(first.id),
      (value) => value.state === 'succeeded',
    );
    assert.equal(provider.admissions.size, 1);
    assert.deepEqual(app.downloads, [assetUrl]);
  } finally {
    releaseStatus();
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('restart detects missing or changed media and recollects the original handle without generation', async () => {
  for (const damaged of ['missing', 'changed']) {
    const data = await workspace();
    const provider = providerFixture();
    provider.setStatus('COMPLETED');
    let app = await studio(data, provider);
    try {
      const first = await (await app.create()).json();
      await eventually(
        () => app.state(first.id),
        (value) => value.state === 'succeeded',
      );
      await app.close();
      const filename = path.join(data, 'clips', first.id + '.mp4');
      if (damaged === 'missing') await rm(filename);
      else await writeFile(filename, Buffer.from('damaged published media'));
      app = await studio(data, provider);
      assert.equal((await app.state(first.id)).state, 'output_error');
      assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 409);
      await app.connect();
      assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 200);
      await eventually(
        () => app.state(first.id),
        (value) => value.state === 'succeeded',
      );
      assert.equal(provider.calls.filter((call) => call.method === 'POST').length, 1);
      assert.equal(provider.admissions.size, 1);
      assert.deepEqual(await readFile(filename), mediaBytes);
      const files = await readdir(path.join(data, 'clips'));
      assert.deepEqual(files.sort(), [first.id + '.json', first.id + '.mp4'].sort());
    } finally {
      await app.close();
      await rm(data, { recursive: true, force: true });
    }
  }
});

test('corrupted saved source intent is retained for review and cannot trigger provider action', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.loseNextReply();
  let app = await studio(data, provider);
  try {
    const first = videoFrom(await (await app.create()).json());
    await app.close();
    const filename = path.join(data, 'router-videos', first.id + '.json');
    const modified = await stored(data, first.id);
    modified.intent.body.prompt = 'A tampered provider request';
    await writeFile(filename, JSON.stringify(modified));
    const baseline = provider.calls.length;
    app = await studio(data, provider);
    await app.connect();
    assert.equal((await app.call('/' + first.id)).status, 404);
    assert.equal((await app.call('/' + first.id + '/reconcile', 'POST')).status, 404);
    assert.equal(provider.calls.length, baseline);
    assert.equal((await stored(data, first.id)).intent.body.prompt, modified.intent.body.prompt);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test('public snapshots cannot expose unrecognized stored fields or stale private diagnostics', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.loseNextReply();
  let app = await studio(data, provider);
  try {
    const first = videoFrom(await (await app.create()).json());
    await app.close();
    const filename = path.join(data, 'router-videos', first.id + '.json');
    const modified = await stored(data, first.id);
    Object.assign(modified, {
      apiKey: credential,
      signedUrl: assetUrl,
      localPath: data,
      rawProvider: { private: credential },
      stage: credential,
      error: assetUrl,
    });
    await writeFile(filename, JSON.stringify(modified));
    const count = provider.calls.length;
    app = await studio(data, provider);
    const values = [
      await app.state(first.id),
      await (await app.call()).json(),
      await (await app.call('/' + first.id + '/request')).json(),
      await (await app.call('/connection')).json(),
    ];
    for (const value of values) {
      const text = JSON.stringify(value);
      for (const forbidden of [
        credential,
        assetUrl,
        data,
        'rawProvider',
        'intentDigest',
        '"intent"',
      ])
        assert.equal(text.includes(forbidden), false, forbidden);
    }
    assert.equal(provider.calls.length, count);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

for (const damagedField of ['requestKey', 'requestDigest'] as const) {
  test(`corrupted browser ${damagedField} cannot erase a durable admission and permit another paid POST`, async () => {
    const data = await workspace();
    const provider = providerFixture();
    provider.setStatus('COMPLETED');
    let app = await studio(data, provider);
    try {
      const browserKey = 'original-durable-browser-intent';
      const first = await (await app.create(browserKey)).json();
      await eventually(
        () => app.state(first.id),
        (value) => value.state === 'succeeded',
      );
      await app.close();
      const filename = path.join(data, 'router-videos', first.id + '.json');
      const damaged = await stored(data, first.id);
      damaged[damagedField] =
        damagedField === 'requestKey' ? 'hidden-original-browser-intent' : '0'.repeat(64);
      await writeFile(filename, JSON.stringify(damaged));
      const before = provider.calls.length;
      app = await studio(data, provider);
      const connection = await app.connect();
      const response = await app.create(browserKey, connection.admissionScope);
      assert.equal(response.status, 409);
      assert.equal(provider.calls.length, before);
      assert.equal(provider.admissions.size, 1);
      // An invalid record must not be admitted as a different browser identity.
      const history = await (await app.call()).json();
      assert.equal(
        history.some((value: RouterVideoGeneration) => value.id === first.id),
        false,
      );
      assert.equal((await stored(data, first.id))[damagedField], damaged[damagedField]);
    } finally {
      await app.close();
      await rm(data, { recursive: true, force: true });
    }
  });
}

test('a hydrated record whose id differs from its filename is retained without recreating an alias', async () => {
  const data = await workspace();
  const provider = providerFixture();
  provider.setStatus('COMPLETED');
  let app = await studio(data, provider);
  try {
    const first = await (await app.create()).json();
    await eventually(
      () => app.state(first.id),
      (value) => value.state === 'succeeded',
    );
    await app.close();
    const canonical = path.join(data, 'router-videos', first.id + '.json');
    const misplaced = path.join(data, 'router-videos', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json');
    const original = await readFile(canonical);
    await writeFile(misplaced, original);
    await rm(canonical);
    const before = provider.calls.length;
    app = await studio(data, provider);
    const files = await readdir(path.join(data, 'router-videos'));
    assert.equal(files.includes(first.id + '.json'), false);
    assert.deepEqual(await readFile(misplaced), original);
    assert.equal((await app.call('/' + first.id)).status, 404);
    const connection = await app.connect();
    assert.equal(
      (await app.create('original-browser-after-restart', connection.admissionScope)).status,
      409,
    );
    assert.equal(provider.calls.length, before);
    assert.equal(provider.admissions.size, 1);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
