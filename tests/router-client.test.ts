import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createRouterConnection,
  RouterError,
  type RouterLtxInput,
} from '../server/router-client.js';

const base = 'https://api.comfy.org/v2/models/ltx/ltx-2-5-fast';
const id = '11111111-2222-4333-8444-555555555555';
const otherId = '11111111-2222-4333-8444-666666666666';
const input: RouterLtxInput = {
  prompt: 'A locked-off macro shot of coffee beans in soft window light.',
  duration: 2,
  resolution: '1280x720',
  fps: 24,
  generate_audio: false,
};
const credentialA = 'fixture-account-one';
const credentialB = 'fixture-account-two';
const response = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

type Call = { url: string; init: RequestInit };
function fixture(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  const connection = createRouterConnection({ fetch: fetcher });
  connection.configure(credentialA);
  return { connection, calls, client: connection.capture() };
}

function routerError(
  code: string,
  definitiveRejection: boolean,
  status?: number,
): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof RouterError);
    assert.equal(error.code, code);
    assert.equal(error.definitiveRejection, definitiveRejection);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  };
}

test('connection fingerprints are secret-free and captured jobs retain their original credential', async () => {
  const { connection, client, calls } = fixture(() => response({}));
  const originalFingerprint = createHash('sha256').update(credentialA).digest('hex');
  assert.deepEqual(connection.snapshot(), {
    configured: true,
    credentialFingerprint: originalFingerprint,
  });
  assert.equal(client.fingerprint, originalFingerprint);
  assert.equal(connection.capture(originalFingerprint), client);
  connection.configure(credentialB);
  const nextClient = connection.capture();
  assert.notEqual(nextClient.fingerprint, client.fingerprint);
  assert.throws(
    () => connection.capture(originalFingerprint),
    routerError('connection_changed', false, 409),
  );
  connection.disconnect();
  assert.deepEqual(connection.snapshot(), { configured: false });
  assert.throws(() => connection.capture(), routerError('connection_required', false, 409));
  await client.probe();
  await nextClient.probe();
  assert.deepEqual(
    calls.map((call) => new Headers(call.init.headers).get('X-API-Key')),
    [credentialA, credentialB],
  );
  assert.equal(JSON.stringify(client), JSON.stringify({ fingerprint: originalFingerprint }));
  assert.equal(connection.configure(undefined), false);
});

test('configure rejects header injection without dropping the current connection', () => {
  const { connection, client } = fixture(() => response({}));
  assert.throws(
    () => connection.configure('key\r\ninjected: value'),
    routerError('invalid_credential', true, 400),
  );
  assert.equal(connection.capture(), client);
});

test('probe is an authenticated catalog GET with no account, billing or generation call', async () => {
  const { client, calls } = fixture(() => response({ eligibility: 'not proven' }));
  assert.deepEqual(await client.probe(), { authenticated: true, reachable: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, base);
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('probe distinguishes a reachable auth refusal from an unreachable server', async () => {
  const refused = fixture(() => response({ detail: 'private' }, 401));
  assert.deepEqual(await refused.client.probe(), { authenticated: false, reachable: true });
  const offline = fixture(() => {
    throw new Error(`socket failed at https://private.invalid/?key=${credentialA}`);
  });
  assert.deepEqual(await offline.client.probe(), { authenticated: false, reachable: false });
});

test('estimate rollout refusal does not block an otherwise valid queued submission', async () => {
  const { client, calls } = fixture(({ url }) =>
    url.endsWith('/estimate')
      ? response({ error_type: 'not_enabled', detail: credentialA }, 403)
      : response({ request_id: id, status: 'IN_QUEUE' }, 201),
  );
  assert.deepEqual(await client.estimate(input), {
    source: 'unknown',
    currency: 'USD',
    reason: 'not_enabled',
  });
  assert.deepEqual(await client.submit(input, 'stable-workspace-key'), {
    requestId: id,
    status: 'IN_QUEUE',
  });
  assert.equal(calls.length, 2);
});

test('quotes expose only validated prices, never raw provider fields or fabricated free prices', async () => {
  const replies = [
    {
      source: 'exact',
      currency: 'USD',
      amount: '0.035',
      credits: 7.39,
      pricing_as_of: '2026-10-19T20:00:00Z',
      provider: credentialA,
      secret: credentialA,
    },
    { source: 'estimated', currency: 'USD', min_amount: '0.02', max_amount: '0.04' },
    { source: 'unknown', reason: credentialA, amount: '0' },
    { source: 'exact', currency: 'USD', amount: '-5', credits: -1 },
    { source: 'exact', currency: 'USD', amount: '1e5' },
    { source: 'estimated', currency: 'USD', min_amount: '2', max_amount: '1' },
    { source: 'future_source', currency: 'USD', amount: '0' },
  ];
  const { client } = fixture(() => response(replies.shift()));
  assert.deepEqual(await client.estimate(input), {
    source: 'exact',
    currency: 'USD',
    amount: '0.035',
    credits: 7.39,
    pricingAsOf: '2026-10-19T20:00:00Z',
  });
  assert.deepEqual(await client.estimate(input), {
    source: 'estimated',
    currency: 'USD',
    minAmount: '0.02',
    maxAmount: '0.04',
  });
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await client.estimate(input), {
      source: 'unknown',
      currency: 'USD',
      reason: 'not_quotable',
    });
  }
});

test('queued submission sends exactly one native request with a stable key and bounded mapped input', async () => {
  const { client, calls } = fixture(() => response({ request_id: id, status: 'IN_PROGRESS' }, 201));
  const metadata = { ...input, apiKey: 'must-not-travel', model_provider: 'higgsfield' };
  assert.deepEqual(await client.submit(metadata, 'one-logical-job'), {
    requestId: id,
    status: 'IN_PROGRESS',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${base}/requests?reject_unknown_fields=true`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(new Headers(calls[0].init.headers).get('Idempotency-Key'), 'one-logical-job');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), input);
});

test('invalid settings or submission keys fail before any network request', async () => {
  const { client, calls } = fixture(() => response({}));
  for (const patch of [
    { prompt: '' },
    { prompt: 'x'.repeat(10001) },
    { duration: 1 },
    { duration: 2.5 },
    { resolution: '1920x1080' },
    { fps: 30 },
    { generate_audio: 'yes' },
  ]) {
    await assert.rejects(
      client.submit({ ...input, ...patch } as RouterLtxInput, 'key'),
      routerError('invalid_input', true, 400),
    );
  }
  for (const key of ['', 'x'.repeat(256), 'line\nbreak']) {
    await assert.rejects(
      client.submit(input, key),
      routerError('invalid_idempotency_key', true, 400),
    );
  }
  assert.equal(calls.length, 0);
});

test('a lost, failed or malformed submission is ambiguous and is never automatically posted twice', async () => {
  const answers = [
    () => {
      throw new Error(`${credentialA}: timeout at https://private.invalid`);
    },
    () => response({ error_type: 'deadline_exceeded', detail: credentialA }, 504),
    () => response({ request_id: id, status: 'NEW_UNKNOWN_STATE' }, 201),
    () => response({ request_id: '../private', status: 'IN_QUEUE' }, 201),
    () =>
      new Response(`not-json-${credentialA}`, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    () => response({ request_id: id, status: 'IN_QUEUE' }, 200),
  ];
  for (const answer of answers) {
    const { client, calls } = fixture(answer);
    await assert.rejects(client.submit(input, 'same-key'), (error: unknown) => {
      assert.ok(error instanceof RouterError);
      assert.equal(error.definitiveRejection, false);
      assert.equal(`${error}${JSON.stringify(error)}`.includes(credentialA), false);
      assert.equal(`${error}${JSON.stringify(error)}`.includes('private.invalid'), false);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test('only documented pre-dispatch rejection buckets are definitive; consumed keys and provider failures are not', async () => {
  const cases: [number, string, boolean, Record<string, string>?][] = [
    [401, 'unauthorized', true],
    [402, 'insufficient_credits', true],
    [403, 'not_enabled', true],
    [403, 'forbidden', true],
    [404, 'model_not_found', true],
    [422, 'invalid_input', true],
    [429, 'queue_backlog_full', true],
    [409, 'invalid_input', false],
    [409, 'concurrency_limit_exceeded', false],
    [400, 'content_policy_violation', false],
    [422, 'invalid_input', false, { 'X-Comfy-Upstream-Status': '422' }],
    [503, 'service_unavailable', false],
    [403, 'new_error_type_with_private_text', false],
  ];
  for (const [status, code, definitive, extraHeaders] of cases) {
    const { client } = fixture(() =>
      response({ detail: credentialA }, status, {
        'X-Comfy-Error-Type': code,
        ...extraHeaders,
      }),
    );
    await assert.rejects(
      client.submit(input, 'key'),
      routerError(
        code === 'new_error_type_with_private_text' ? 'internal_error' : code,
        definitive,
        status,
      ),
    );
  }
});

test('redirects cannot send the credential to another origin, even for otherwise valid-looking results', async () => {
  const { client, calls } = fixture(
    () =>
      new Response(null, {
        status: 307,
        headers: { Location: `https://private.invalid/?key=${credentialA}` },
      }),
  );
  await assert.rejects(client.submit(input, 'key'), routerError('transport_error', false, 502));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'error');
});

test('status treats only a completed queue request as terminal and maps cancellation from error_type', async () => {
  const replies = [
    { request_id: id, status: 'IN_QUEUE' },
    { request_id: id, status: 'IN_PROGRESS' },
    { request_id: id, status: 'COMPLETED' },
    { request_id: id, status: 'COMPLETED', error_type: 'cancelled' },
    { request_id: id, status: 'COMPLETED', error_type: 'provider_error' },
    { request_id: id, status: 'COMPLETED', error_type: 'new_private_error' },
  ];
  const { client, calls } = fixture(() => response(replies.shift(), 200, { 'Retry-After': '7' }));
  for (const expected of ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'FAILED', 'FAILED']) {
    assert.deepEqual(await client.status(id), { status: expected, retryAfterMs: 7000 });
  }
  assert.ok(calls.every((call) => call.url === `${base}/requests/${id}/status`));
});

test('status refuses mismatched request identities, unexpected states and nonterminal error flags', async () => {
  for (const value of [
    { request_id: otherId, status: 'COMPLETED' },
    { request_id: id, status: 'FAILED' },
    { request_id: id, status: 'completed' },
    { request_id: id, status: 'IN_PROGRESS', error_type: 'provider_error' },
    { request_id: id, status: 'COMPLETED', error_type: null },
  ]) {
    const { client } = fixture(() => response(value));
    await assert.rejects(client.status(id), routerError('malformed_response', false, 502));
  }
});

test('Retry-After accepts whole seconds with a bounded default for malformed hints', async () => {
  const cases: [string, number][] = [
    ['2', 2000],
    ['0', 1000],
    ['999999999', 300000],
    ['-2', 3000],
    ['2.5', 3000],
    ['later', 3000],
  ];
  for (const [raw, expected] of cases) {
    const { client } = fixture(() =>
      response({ request_id: id, status: 'IN_PROGRESS' }, 200, { 'Retry-After': raw }),
    );
    assert.equal((await client.status(id)).retryAfterMs, expected);
  }
});

test('result keeps the signed output URL private and requires the confirmed native LTX completed shape', async () => {
  const signedUrl = 'https://assets.example.test/output.mp4?signature=private-token';
  const { client, calls } = fixture(() =>
    response({ status: 'completed', result: { video_url: signedUrl } }),
  );
  assert.deepEqual(await client.result(id), { videoUrl: signedUrl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${base}/requests/${id}`);
  for (const value of [
    { status: 'failed', result: { video_url: signedUrl } },
    { status: 'completed', result: { video_url: 'http://assets.example.test/output.mp4' } },
    {
      status: 'completed',
      result: { video_url: 'https://user:pass@assets.example.test/output.mp4' },
    },
    { status: 'completed', result: { video_url: 'file:///private' } },
    { status: 'completed', result: {} },
  ]) {
    const malformed = fixture(() => response(value));
    await assert.rejects(
      malformed.client.result(id),
      routerError('malformed_response', false, 502),
    );
  }
});

test('collecting a still-running result does not resubmit or manufacture a failed generation', async () => {
  const { client, calls } = fixture(() =>
    response({ request_id: id, status: 'IN_PROGRESS' }, 202, { 'Retry-After': '4' }),
  );
  await assert.rejects(client.result(id), (error: unknown) => {
    assert.ok(error instanceof RouterError);
    assert.equal(error.code, 'result_pending');
    assert.equal(error.definitiveRejection, false);
    assert.equal(error.retryAfterMs, 4000);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('cancel sends PUT once and still permits a subsequent running or completed status', async () => {
  const replies = [
    response({ request_id: id, status: 'CANCELLATION_REQUESTED' }, 202),
    response({ request_id: id, status: 'IN_PROGRESS' }),
    response({ request_id: id, status: 'ALREADY_COMPLETED' }, 409),
    response({ request_id: id, status: 'COMPLETED' }),
  ];
  const { client, calls } = fixture(() => replies.shift()!);
  assert.equal(await client.cancel(id), undefined);
  assert.equal((await client.status(id)).status, 'IN_PROGRESS');
  assert.equal(await client.cancel(id), undefined);
  assert.equal((await client.status(id)).status, 'COMPLETED');
  assert.deepEqual(
    calls.map((call) => call.init.method),
    ['PUT', undefined, 'PUT', undefined],
  );
  assert.equal(calls[0].url, `${base}/requests/${id}/cancel`);
});

test('cancel rejects a malformed acknowledgement instead of claiming success', async () => {
  for (const value of [
    { request_id: otherId, status: 'CANCELLATION_REQUESTED' },
    { request_id: id, status: 'CANCELED' },
  ]) {
    const { client } = fixture(() => response(value, 202));
    await assert.rejects(client.cancel(id), routerError('malformed_response', false, 502));
  }
});

test('request identifiers cannot alter the fixed credential-bearing endpoint', async () => {
  const { client, calls } = fixture(() => response({}));
  for (const invalid of [
    '../other',
    `${id}?api_key=value`,
    `https://evil.test/${id}`,
    id.toUpperCase(),
  ]) {
    // The numeric fixture is unchanged by uppercasing; use a letter UUID for that case.
    const candidate = invalid === id ? 'AAAAAAAA-2222-4333-8444-555555555555' : invalid;
    await assert.rejects(client.status(candidate), routerError('invalid_request_id', false, 400));
    await assert.rejects(client.result(candidate), routerError('invalid_request_id', false, 400));
    await assert.rejects(client.cancel(candidate), routerError('invalid_request_id', false, 400));
  }
  assert.equal(calls.length, 0);
});

test('oversized or non-JSON provider documents are sanitized and bounded', async () => {
  for (const reply of [
    new Response('private html', { status: 201, headers: { 'Content-Type': 'text/html' } }),
    response({ request_id: id, status: 'IN_QUEUE', private: credentialA.repeat(10000) }, 201),
  ]) {
    const { client } = fixture(() => reply);
    await assert.rejects(
      client.submit(input, 'key'),
      routerError('malformed_response', false, 502),
    );
  }
});
