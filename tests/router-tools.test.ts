import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { z } from 'zod';
import { registerRouterTools } from '../server/router-tools.js';
import type { RouterVideoGeneration, RouterVideoRequest } from '../src/router-video.js';

const base = 'http://127.0.0.1:4310';
const route = '/api/router-videos';
const request: RouterVideoRequest = {
  format: 'aftertake-router-video/1',
  name: 'A quiet product moment',
  prompt: 'An amber bottle in warm window light. The bottle stays still while a leaf shadow moves.',
  aspect: 'portrait',
  seconds: 3,
  sound: true,
};
type Call = { path: string; method: string; body?: any; headers: Headers };
type Tool = { schema: z.ZodType; run: (input: any) => Promise<{ data: any }>; readOnly: boolean };

function setup(state: string, respond: (call: Call) => Response | Promise<Response>) {
  const tools = new Map<string, Tool>();
  const calls: Call[] = [];
  registerRouterTools({
    base,
    state,
    tool(name, _description, schema, run, readOnly = true) {
      tools.set(name, { schema, run, readOnly });
    },
    fetch: async (input, init) => {
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      const url = new URL(String(input));
      assert.equal(url.origin, base);
      const call = {
        path: url.pathname,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        headers: new Headers(init?.headers),
      };
      calls.push(call);
      return respond(call);
    },
  });
  return {
    tools,
    calls,
    async call(name: string, input: unknown = {}) {
      const tool = tools.get(name);
      assert.ok(tool, name);
      return (await tool.run(tool.schema.parse(input))).data;
    },
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function record(key: string): RouterVideoGeneration {
  const fingerprint = 'a'.repeat(64);
  return {
    id: randomUUID(),
    target: {
      format: 'aftertake-router-target/1',
      provider: 'comfy-router',
      origin: 'https://api.comfy.org',
      model: 'ltx/ltx-2-5-fast',
      credentialFingerprint: fingerprint,
    },
    request,
    requestKey: key,
    credentialFingerprint: fingerprint,
    state: 'queued',
    progress: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
async function temporary(t: TestContext) {
  const state = await mkdtemp(path.join(tmpdir(), 'aftertake-router-tools-'));
  t.after(async () => {
    assert.equal(path.dirname(state), path.resolve(tmpdir()));
    assert.ok(path.basename(state).startsWith('aftertake-router-tools-'));
    await rm(state, { recursive: true, force: true });
  });
  return state;
}

test('hosted MCP connection and quote are separate from generation and expose no credential argument', async (t) => {
  const state = await temporary(t);
  const fixture = setup(state, (call) => {
    if (call.path === route + '/estimate')
      return json({
        quote: { source: 'unknown', currency: 'USD', reason: 'No quote is offered.' },
      });
    return json({
      configured: true,
      admissionScope: 'original-session',
      model: 'ltx/ltx-2-5-fast',
      credentialStorage: 'memory',
      ...(call.method === 'POST' ? { authenticated: true } : {}),
    });
  });
  const connection = await fixture.call('aftertake_hosted_video_connection');
  assert.equal(connection.connection.credentialStorage, 'memory');
  assert.equal(connection.capabilities.localGpuRequired, false);
  await fixture.call('aftertake_hosted_video_connection', { probe: true });
  const estimate = await fixture.call('aftertake_estimate_hosted_video', { request });
  assert.equal(estimate.quote.source, 'unknown');
  assert.deepEqual(
    fixture.calls.map((call) => [call.method, call.path]),
    [
      ['GET', route + '/connection'],
      ['POST', route + '/connection/probe'],
      ['POST', route + '/estimate'],
    ],
  );
  assert.deepEqual(fixture.calls[2].body, { request });
  assert.equal(fixture.tools.get('aftertake_estimate_hosted_video')!.readOnly, true);
  assert.equal(fixture.tools.get('aftertake_generate_hosted_video')!.readOnly, false);
  assert.equal(fixture.tools.get('aftertake_recover_hosted_video')!.readOnly, false);
  assert.equal(fixture.tools.get('aftertake_cancel_hosted_video')!.readOnly, false);
  assert.equal(fixture.tools.size, 7);
  assert.equal(
    fixture.tools
      .get('aftertake_hosted_video_connection')!
      .schema.safeParse({ apiKey: 'not-accepted' }).success,
    false,
  );
  assert.equal(
    fixture.tools
      .get('aftertake_generate_hosted_video')!
      .schema.safeParse({ requestId: 'one', request, apiKey: 'not-accepted' }).success,
    false,
  );
  assert.equal(
    fixture.tools
      .get('aftertake_generate_hosted_video')!
      .schema.safeParse({ requestId: 'one', request: { ...request, apiKey: 'not-accepted' } })
      .success,
    false,
  );
  assert.equal((await readdir(state)).length, 0);
});

test('a lost generation response rejoins the durable studio record after MCP restart without a second POST', async (t) => {
  const state = await temporary(t);
  const videos: RouterVideoGeneration[] = [];
  let scope = 'original-session';
  const handler = (call: Call) => {
    if (call.method === 'GET' && call.path === route) return json(videos);
    if (call.path === route + '/connection')
      return json({ configured: true, admissionScope: scope });
    if (call.method === 'POST' && call.path === route) {
      assert.equal(call.headers.get('X-Aftertake-Admission-Scope'), 'original-session');
      assert.deepEqual(call.body, request);
      videos.push(record(call.headers.get('Idempotency-Key')!));
      throw Error('Simulated lost local response');
    }
    throw Error('Unexpected test request');
  };
  const first = setup(state, handler);
  const original = await first.call('aftertake_generate_hosted_video', {
    requestId: 'hero-v1',
    request,
  });
  assert.equal(original.state, 'submission_unconfirmed');
  const [savedFile] = await readdir(state);
  const saved = JSON.parse(await readFile(path.join(state, savedFile), 'utf8'));
  assert.equal(saved.scope, 'original-session');
  assert.equal(saved.requestKey, videos[0].requestKey);
  scope = 'restarted-session';
  const restarted = setup(state, handler);
  const joined = await restarted.call('aftertake_generate_hosted_video', {
    requestId: 'hero-v1',
    request,
  });
  assert.equal(joined.id, videos[0].id);
  assert.equal(restarted.calls.filter((call) => call.method === 'POST').length, 0);
  assert.equal(first.calls.filter((call) => call.method === 'POST').length, 1);
  await assert.rejects(
    restarted.call('aftertake_generate_hosted_video', {
      requestId: 'hero-v1',
      request: { ...request, sound: false },
    }),
    /different hosted inputs/,
  );
  assert.equal(videos.length, 1);
});

test('recovery keeps the original request key and scope when a restart lost the studio admission', async (t) => {
  const state = await temporary(t);
  const posted: Call[] = [];
  let restarted = false;
  const handler = (call: Call) => {
    if (call.method === 'GET' && call.path === route) return json([]);
    if (call.path === route + '/connection')
      return json({
        configured: true,
        admissionScope: restarted ? 'new-session' : 'original-session',
      });
    if (call.method === 'POST' && call.path === route) {
      posted.push(call);
      if (!restarted) throw Error('Simulated unknown response');
      return json({ code: 'admission_scope_changed', error: 'The server session changed.' }, 409);
    }
    throw Error('Unexpected test request');
  };
  const original = setup(state, handler);
  await original.call('aftertake_generate_hosted_video', { requestId: 'uncertain-v1', request });
  restarted = true;
  const resumed = setup(state, handler);
  const result = await resumed.call('aftertake_recover_hosted_video', {
    requestId: 'uncertain-v1',
  });
  assert.equal(result.state, 'admission_unresolved');
  assert.equal(result.originalScopeRetained, true);
  assert.match(result.next, /Do not refresh the scope/);
  assert.equal(posted.length, 2);
  assert.equal(posted[0].headers.get('Idempotency-Key'), posted[1].headers.get('Idempotency-Key'));
  assert.equal(posted[1].headers.get('X-Aftertake-Admission-Scope'), 'original-session');
  assert.deepEqual(posted[0].body, posted[1].body);
  assert.equal(resumed.calls[0].method, 'GET');
  assert.equal(resumed.calls[0].path, route);
  assert.ok(!resumed.calls.some((call) => call.path.endsWith('/connection')));
  const status = await resumed.call('aftertake_hosted_video_status', { requestId: 'uncertain-v1' });
  assert.equal(status.retainedOriginalIntent, true);
  await assert.rejects(
    resumed.call('aftertake_generate_hosted_video', {
      requestId: 'uncertain-v1',
      request: { ...request, seconds: 4 },
    }),
    /different hosted inputs/,
  );
  assert.equal(posted.length, 2);
});

test('status and export read the existing record; recovery and cancellation target only that UUID', async (t) => {
  const state = await temporary(t);
  const video = record('a-ui-request-key');
  video.state = 'connection_lost';
  const portable = { format: 'aftertake-hosted-video-record/1', request };
  const fixture = setup(state, (call) => {
    if (call.method === 'GET' && call.path === route) return json([video]);
    if (call.path === route + '/' + video.id + '/request') return json(portable);
    if (call.path === route + '/' + video.id + '/reconcile') {
      video.state = 'running';
      return json(video);
    }
    if (call.path === route + '/' + video.id + '/cancel') {
      video.state = 'canceling';
      return json(video);
    }
    throw Error('Unexpected test request');
  });
  const status = await fixture.call('aftertake_hosted_video_status', { id: video.id });
  assert.equal(status.state, 'connection_lost');
  assert.equal(
    fixture.calls.every((call) => call.method === 'GET'),
    true,
  );
  assert.equal(
    (await fixture.call('aftertake_recover_hosted_video', { id: video.id })).state,
    'running',
  );
  assert.equal(
    (await fixture.call('aftertake_cancel_hosted_video', { id: video.id })).state,
    'canceling',
  );
  assert.deepEqual(
    (await fixture.call('aftertake_export_hosted_video_request', { id: video.id })).portable,
    portable,
  );
  video.state = 'canceled';
  const before = fixture.calls.filter((call) => call.method === 'POST').length;
  assert.equal(
    (await fixture.call('aftertake_cancel_hosted_video', { id: video.id })).state,
    'canceled',
  );
  assert.equal(fixture.calls.filter((call) => call.method === 'POST').length, before);
  assert.ok(!fixture.calls.some((call) => call.method === 'POST' && call.path === route));
  await assert.rejects(
    fixture.call('aftertake_recover_hosted_video', { requestId: 'missing' }),
    /Recovery cannot create a new request/,
  );
});

test('changed or partial durable admissions fail closed and cannot refresh a missing original scope', async (t) => {
  const state = await temporary(t);
  const fixture = setup(state, (call) => {
    if (call.method === 'GET' && call.path === route) return json([]);
    if (call.path === route + '/connection')
      return json({ configured: true, admissionScope: 'original-session' });
    throw Error('Simulated unknown response');
  });
  await fixture.call('aftertake_generate_hosted_video', { requestId: 'protected-v1', request });
  const [file] = await readdir(state);
  const filename = path.join(state, file);
  const changed = JSON.parse(await readFile(filename, 'utf8'));
  changed.scope = 'replacement-session';
  await writeFile(filename, JSON.stringify(changed));
  const posts = fixture.calls.filter((call) => call.method === 'POST').length;
  await assert.rejects(
    fixture.call('aftertake_recover_hosted_video', { requestId: 'protected-v1' }),
    /changed or is incomplete/,
  );
  assert.equal(fixture.calls.filter((call) => call.method === 'POST').length, posts);
  await writeFile(filename, '{');
  await assert.rejects(
    fixture.call('aftertake_recover_hosted_video', { requestId: 'protected-v1' }),
    /changed or is incomplete/,
  );
  assert.equal(fixture.calls.filter((call) => call.method === 'POST').length, posts);
});

test('hosted tools refuse external origins and unconfigured sessions without saving or submitting', async (t) => {
  const state = await temporary(t);
  assert.throws(
    () => registerRouterTools({ base: 'https://example.com', state, tool() {} }),
    /loopback/,
  );
  assert.throws(
    () => registerRouterTools({ base: base + '/redirect', state, tool() {} }),
    /loopback/,
  );
  const fixture = setup(state, (call) =>
    json(call.path === route ? [] : { configured: false, admissionScope: 'session' }),
  );
  await assert.rejects(
    fixture.call('aftertake_generate_hosted_video', { requestId: 'not-configured', request }),
    /studio/i,
  );
  assert.ok(fixture.calls.every((call) => call.method === 'GET'));
  assert.equal((await readdir(state)).length, 0);
});

test('a provider refusal with a durable video remains observable and never mints a replacement key', async (t) => {
  const state = await temporary(t);
  const videos: RouterVideoGeneration[] = [];
  const fixture = setup(state, (call) => {
    if (call.method === 'GET' && call.path === route) return json(videos);
    if (call.path === route + '/connection')
      return json({ configured: true, admissionScope: 'original-session' });
    const video = record(call.headers.get('Idempotency-Key')!);
    video.state = 'failed';
    video.error = 'Comfy refused this request.';
    videos.push(video);
    return json({ error: video.error, video }, 403);
  });
  const first = await fixture.call('aftertake_generate_hosted_video', {
    requestId: 'refused-v1',
    request,
  });
  assert.equal(first.state, 'failed');
  assert.equal(first.id, videos[0].id);
  const replay = await fixture.call('aftertake_generate_hosted_video', {
    requestId: 'refused-v1',
    request,
  });
  assert.equal(replay.id, first.id);
  assert.equal(fixture.calls.filter((call) => call.method === 'POST').length, 1);
});
