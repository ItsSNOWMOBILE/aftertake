import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createComputeConnection, computeRouter } from '../server/compute.js';
import { computeFeatures } from '../src/compute.js';

const secret = 'private-test-key-do-not-return';

test('remote credentials remain server-only and no configuration can enable cloud execution', async () => {
  let calls = 0;
  const priorBaseUrl = process.env.COMFY_BASE_URL;
  const priorApiKey = process.env.COMFY_API_KEY;
  let cloudChecks = 0;
  const connection = createComputeConnection({
    localEngine: async () => {
      calls++;
      throw Error('Remote configuration must not reach the startup client.');
    },
    fetch: async (url, options) => {
      cloudChecks++;
      assert.equal(url, 'https://cloud.comfy.org/api/user');
      assert.equal(new Headers(options?.headers).get('X-API-Key'), secret);
      assert.equal(options?.redirect, 'error');
      assert.ok(options?.signal);
      return new Response(JSON.stringify({ privateAccountInformation: 'never returned' }), {
        status: 200,
      });
    },
  });
  for (const configuration of [
    { provider: 'comfy-cloud', apiKey: secret },
    {
      provider: 'managed-deployment',
      apiKey: secret,
      endpoint: 'https://test-instance.run.comfy.app/',
    },
  ]) {
    assert.equal(connection.configure(configuration), true);
    assert.equal(connection.status().state, 'configured');
    const status = await connection.probe();
    assert.equal(status.state, 'blocked');
    assert.equal(status.ready, false);
    assert.equal(status.activeProvider, 'local');
    assert.equal(status.generationRouting, 'startup-local');
    assert.equal(status.configured?.hasApiKey, true);
    assert.ok(status.capabilities.every((capability) => !capability.ready));
    for (const id of ['subscription', 'billing', 'compatibility'])
      assert.equal(status.checks.find((check) => check.id === id)?.state, 'unverified');
    assert.equal(
      status.checks.find((check) => check.id === 'authentication')?.state,
      configuration.provider === 'comfy-cloud' ? 'pass' : 'unverified',
    );
    assert.equal(JSON.stringify(status).includes(secret), false);
    assert.equal(JSON.stringify(status).includes('privateAccountInformation'), false);
  }
  assert.equal(calls, 0);
  assert.equal(cloudChecks, 1);
  assert.equal(process.env.COMFY_BASE_URL, priorBaseUrl);
  assert.equal(process.env.COMFY_API_KEY, priorApiKey);
  assert.equal(
    connection.configure({ provider: 'comfy-cloud', apiKey: secret, billingVerified: true }),
    false,
  );
  assert.equal(
    connection.configure({ provider: 'comfy-cloud', apiKey: secret, compatibilityVerified: true }),
    false,
  );
  assert.equal(connection.disconnect().configured, null);
  assert.equal(connection.status().checkedAt, null);
  assert.equal(connection.status().ready, false);
  // A new process/controller has no credential or selected provider to restore.
  assert.equal(
    createComputeConnection({ localEngine: async () => assert.fail() }).status().configured,
    null,
  );
});

test('local readiness is per workflow, exceptions fail closed, and snapshots cannot mutate state', async () => {
  const calls: string[] = [];
  const connection = createComputeConnection({
    localEngine: async (feature) => {
      calls.push(feature);
      if (feature === 'character-swap') throw Error(secret);
      return {
        connected: true,
        ready: feature === 'image-gen',
        missing: [],
        message: feature === 'image-gen' ? 'Image runtime ready.' : 'Required models missing.',
      };
    },
    now: () => new Date('2026-10-18T12:00:00Z'),
  });
  const status = await connection.probe();
  assert.deepEqual(calls, [...computeFeatures]);
  assert.equal(status.ready, true);
  assert.equal(status.checkedAt, '2026-10-18T12:00:00.000Z');
  assert.deepEqual(
    status.capabilities
      .filter((capability) => capability.ready)
      .map((capability) => capability.feature),
    ['image-gen'],
  );
  assert.equal(JSON.stringify(status).includes(secret), false);
  status.capabilities[0].ready = true;
  assert.equal(connection.status().capabilities[0].ready, false);
  assert.equal(connection.configure({ provider: 'local' }), true);
  assert.ok(connection.status().capabilities.every((capability) => !capability.ready));
});

test('a slow local probe cannot overwrite a newer remote configuration or disconnect', async () => {
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const connection = createComputeConnection({
    localEngine: async () => {
      await gate;
      return { connected: true, ready: true, missing: [], message: 'Ready.' };
    },
  });
  const pending = connection.probe();
  assert.equal(connection.configure({ provider: 'comfy-cloud', apiKey: secret }), true);
  complete();
  const status = await pending;
  assert.equal(status.configured?.provider, 'comfy-cloud');
  assert.equal(status.checkedAt, null);
  assert.equal(status.ready, false);
  connection.disconnect();
  assert.equal(connection.status().configured, null);
  assert.ok(connection.status().capabilities.every((capability) => !capability.ready));
});

test('HTTP settings lifecycle redacts credentials and rejects unsafe URLs or client attestation', async () => {
  const app = express();
  app.use(express.json());
  let mockOrigin = '';
  let accountStatus = 200;
  let receivedKey: string | undefined;
  let redirected = 0;
  app.get('/mock-account', (req, res) => {
    receivedKey = req.get('X-API-Key');
    if (accountStatus === 302) return void res.redirect('/must-not-follow');
    res.status(accountStatus).json({ privateName: 'do not expose account PII', apiKey: secret });
  });
  app.get('/must-not-follow', (_req, res) => {
    redirected++;
    res.json({});
  });
  app.use(
    '/api/compute',
    computeRouter({
      localEngine: async () => assert.fail(),
      fetch: (url, options) => {
        assert.equal(url, 'https://cloud.comfy.org/api/user');
        return fetch(mockOrigin + '/mock-account', options);
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  mockOrigin = `http://127.0.0.1:${address.port}`;
  const base = `http://127.0.0.1:${address.port}/api/compute`;
  async function configure(body: unknown) {
    return fetch(base + '/connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  try {
    for (const endpoint of [
      'http://example.com',
      `https://user:${secret}@example.com`,
      `https://example.com?key=${secret}`,
      `https://example.com#${secret}`,
      'https://example.com?',
      'https://example.com',
      'https://127.0.0.1',
      'https://localhost',
      'https://test.run.comfy.app.evil.example',
      'https://test.run.comfy.app:8443',
      'https://test.run.comfy.app/path',
      'https://nested.test.run.comfy.app',
      'not a URL',
    ]) {
      const response = await configure({
        provider: 'managed-deployment',
        apiKey: secret,
        endpoint,
      });
      assert.equal(response.status, 400);
      assert.equal((await response.text()).includes(secret), false);
    }
    const response = await configure({ provider: 'comfy-cloud', apiKey: secret });
    assert.equal(response.status, 200);
    assert.equal((await response.text()).includes(secret), false);
    assert.equal((await (await fetch(base)).json()).configured.hasApiKey, true);
    const blocked = await (await fetch(base + '/probe', { method: 'POST' })).json();
    assert.equal(receivedKey, secret);
    assert.equal(
      blocked.checks.find((check: { id: string }) => check.id === 'authentication').state,
      'pass',
    );
    assert.equal(JSON.stringify(blocked).includes(secret), false);
    assert.equal(JSON.stringify(blocked).includes('privateName'), false);
    assert.equal(blocked.ready, false);
    assert.ok(blocked.capabilities.every((capability: { ready: boolean }) => !capability.ready));
    for (const statusCode of [401, 403, 503, 302]) {
      accountStatus = statusCode;
      const result = await (await fetch(base + '/probe', { method: 'POST' })).json();
      assert.equal(
        result.checks.find((check: { id: string }) => check.id === 'authentication').state,
        statusCode === 401 || statusCode === 403 ? 'blocked' : 'unverified',
      );
      assert.equal(result.ready, false);
      assert.equal(JSON.stringify(result).includes(secret), false);
    }
    assert.equal(redirected, 0);
    assert.equal(
      (await (await fetch(base + '/connection', { method: 'DELETE' })).json()).configured,
      null,
    );
    assert.equal((await (await fetch(base)).json()).configured, null);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('missing keys never make requests and disconnect aborts an in-flight Cloud preflight', async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const connection = createComputeConnection({
    localEngine: async () => assert.fail(),
    fetch: async (_url, options) => {
      calls++;
      signal = options?.signal ?? undefined;
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(Error(secret)), { once: true }),
      );
      return new Response();
    },
  });
  assert.equal(connection.configure({ provider: 'comfy-cloud' }), true);
  assert.equal(
    (await connection.probe()).checks.find((check) => check.id === 'credential')?.state,
    'blocked',
  );
  assert.equal(calls, 0);
  assert.equal(connection.configure({ provider: 'comfy-cloud', apiKey: secret }), true);
  const pending = connection.probe();
  assert.equal(calls, 1);
  connection.disconnect();
  assert.equal(signal?.aborted, true);
  const status = await pending;
  assert.equal(status.configured, null);
  assert.equal(status.checkedAt, null);
  assert.equal(JSON.stringify(status).includes(secret), false);
});
