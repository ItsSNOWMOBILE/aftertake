import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recipeSchema, type Recipe, type Render } from '../src/domain.js';
import {
  TakeClient,
  parseTakeOperation,
  takeBusy,
  takeCancelable,
  takeRecoverable,
  takeUncertain,
  type TakeOperation,
} from '../src/take-client.js';

const scope = '11111111-1111-4111-8111-111111111111';
const otherScope = '22222222-2222-4222-8222-222222222222';
const appId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nativeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const storageKey = 'aftertake-take-admission';
const baseRecipe = recipeSchema.parse(
  JSON.parse(
    await readFile(new URL('../examples/observatory/recipe.json', import.meta.url), 'utf8'),
  ),
);
const regionalRecipe = recipeSchema.parse({
  ...JSON.parse(await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8')),
  compositeRegion: {
    feather: 0.02,
    strokes: [{ radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }],
  },
});
const recipe = () => structuredClone(baseRecipe);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function operation(): TakeOperation {
  return {
    format: 'aftertake-take-admission/1',
    key: 'original-click',
    recipe: recipe(),
    admissionScope: scope,
  };
}
function record(key = 'original-click', state = 'submission_unknown'): Render {
  return {
    id: appId,
    requestKey: key,
    recipe: recipe(),
    state,
    progress: null,
    createdAt: '2026-10-19T00:00:00Z',
    updatedAt: '2026-10-19T00:00:00Z',
    error: 'The original request needs checking.',
  };
}
function memoryStorage(initial?: TakeOperation) {
  const values = new Map<string, string>(initial ? [[storageKey, JSON.stringify(initial)]] : []);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}
type Request = { url: string; init?: RequestInit };
function harness(
  handler: (request: Request, requests: Request[]) => Response | Promise<Response>,
  saved?: TakeOperation,
) {
  const requests: Request[] = [];
  const storage = memoryStorage(saved);
  let keys = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    const request = { url, init };
    requests.push(request);
    return handler(request, requests);
  };
  const options = {
    storage,
    newKey: () => (++keys === 1 ? 'original-click' : `next-click-${keys}`),
  };
  return {
    client: new TakeClient(fetch, options),
    reload: () => new TakeClient(fetch, options),
    storage,
    requests,
    posts: () => requests.filter((request) => request.init?.method === 'POST'),
    keys: () => keys,
  };
}
function posted(request: Request) {
  return {
    key: new Headers(request.init?.headers).get('Idempotency-Key'),
    recipe: JSON.parse(String(request.init?.body)),
  };
}

test('a first click captures parsed inputs before awaiting scope and saves identity before POST', async () => {
  let releaseScope!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseScope = resolve;
  });
  const input = recipe();
  input.prompt = `  ${input.prompt}  `;
  const expected = recipeSchema.parse(input);
  const h = harness(async (request) => {
    if (request.url === '/api/workspace') {
      await held;
      return json({ admissionScope: scope });
    }
    assert.equal(request.url, '/api/renders');
    const saved = parseTakeOperation(JSON.parse(h.storage.getItem(storageKey)!));
    assert.deepEqual(saved.recipe, expected);
    assert.deepEqual(posted(request), { key: saved.key, recipe: expected });
    assert.equal(new Headers(request.init?.headers).get('X-Aftertake-Admission-Scope'), scope);
    return json({ ...record(saved.key, 'queued'), recipe: expected }, 201);
  });
  const pending = h.client.submit(input);
  input.prompt = 'These later edits must never change the original request.';
  input.cue.strokes = [];
  releaseScope();
  assert.equal((await pending).kind, 'record');
  assert.equal(h.client.pending, undefined);
  assert.equal(h.storage.getItem(storageKey), null);
  assert.equal(h.posts().length, 1);
  assert.equal(h.keys(), 1);
});

test('separate final regions require explicit backend support before saving or posting a new operation', async () => {
  for (const compositeRegionProtocol of [undefined, 0, true, '1']) {
    const h = harness((request) => {
      assert.equal(request.url, '/api/workspace');
      return json({ admissionScope: scope, compositeRegionProtocol });
    });
    const result = await h.client.submit(regionalRecipe);
    assert.equal(result.kind, 'rejected');
    assert.match(result.error || '', /separate final blend area support/);
    assert.equal(h.posts().length, 0);
    assert.equal(h.keys(), 0);
    assert.equal(h.client.pending, undefined);
    assert.equal(h.storage.getItem(storageKey), null);
  }
  const h = harness((request) => {
    if (request.url === '/api/workspace')
      return json({ admissionScope: scope, compositeRegionProtocol: 1 });
    assert.deepEqual(posted(request).recipe.compositeRegion, regionalRecipe.compositeRegion);
    return json({ ...record('original-click', 'queued'), recipe: regionalRecipe }, 202);
  });
  assert.equal((await h.client.submit(regionalRecipe)).kind, 'record');
  assert.equal(h.posts().length, 1);
});

test('an older backend cannot resubmit or replace a retained final-region operation', async () => {
  const saved = { ...operation(), recipe: regionalRecipe };
  const h = harness(
    (request) => (request.url === '/api/renders' ? json([]) : json({ admissionScope: scope })),
    saved,
  );
  const result = await h.client.submit(recipe());
  assert.equal(result.kind, 'pending');
  assert.match(result.error || '', /separate final blend area support/);
  assert.deepEqual(h.client.pending, saved);
  assert.deepEqual(parseTakeOperation(JSON.parse(h.storage.getItem(storageKey)!)), saved);
  assert.equal(h.posts().length, 0);
  assert.equal(h.keys(), 0);
});

test('observing an already accepted final-region record needs no new backend capability or admission', async () => {
  const saved = { ...operation(), recipe: regionalRecipe };
  const accepted = { ...record(), recipe: regionalRecipe, jobId: nativeId };
  const h = harness((request) => {
    assert.equal(request.url, '/api/renders');
    return json([accepted]);
  }, saved);
  assert.deepEqual(await h.client.submit(), { kind: 'record', render: accepted });
  assert.equal(h.posts().length, 0);
  assert.equal(h.client.pending, undefined);
});

test('a 502 response retains and exposes its matching accepted render', async () => {
  const accepted = { ...record(), jobId: nativeId };
  const h = harness((request) =>
    request.url === '/api/workspace'
      ? json({ admissionScope: scope })
      : json({ error: 'The accepted job could not be saved.', render: accepted }, 502),
  );
  assert.deepEqual(await h.client.submit(recipe()), {
    kind: 'record',
    render: accepted,
    error: 'The accepted job could not be saved.',
  });
  assert.equal(h.client.pending, undefined);
  assert.equal(
    h.requests.length,
    2,
    'A matching returned record needs no retry or history lookup.',
  );
});

test('transport failure retains the exact operation across reload and an explicit rejoin', async () => {
  let attempts = 0;
  const h = harness((request) => {
    if (request.url === '/api/workspace') return json({ admissionScope: scope });
    if (!request.init?.method) return json([]);
    attempts += 1;
    if (attempts === 1) throw Error('The response was interrupted.');
    return json(record('original-click', 'queued'), 202);
  });
  const first = await h.client.submit(recipe());
  assert.equal(first.kind, 'pending');
  const original = h.client.pending;
  assert.ok(original);
  assert.deepEqual(parseTakeOperation(JSON.parse(h.storage.getItem(storageKey)!)), original);
  const requestCount = h.requests.length;
  const reloaded = h.reload();
  assert.equal(h.requests.length, requestCount, 'Reloading a client performs no HTTP requests.');
  const edited = { ...recipe(), seed: 92751, prompt: 'A completely different deliberate edit.' };
  assert.equal((await reloaded.submit(edited)).kind, 'record');
  assert.deepEqual(h.posts().map(posted), [
    { key: original.key, recipe: original.recipe },
    { key: original.key, recipe: original.recipe },
  ]);
  assert.equal(h.keys(), 1);
  assert.deepEqual(
    h.requests
      .slice(requestCount)
      .map((request) => `${request.init?.method || 'GET'} ${request.url}`),
    ['GET /api/renders', 'GET /api/workspace', 'POST /api/renders'],
  );
});

test('a matching history record across restart is adopted without another POST or scope lookup', async () => {
  const accepted = { ...record(), jobId: nativeId };
  const h = harness((request) => {
    assert.equal(request.url, '/api/renders');
    assert.equal(request.init, undefined);
    return json([accepted]);
  }, operation());
  assert.deepEqual(await h.client.submit(), { kind: 'record', render: accepted });
  assert.equal(h.posts().length, 0);
  assert.equal(h.keys(), 0);
  assert.equal(h.client.pending, undefined);
});

test('passive history observation selects the matching request key rather than matching settings', () => {
  const h = harness(() => {
    throw Error('Observation must not request anything.');
  }, operation());
  const unrelated = record('different-click', 'succeeded');
  assert.equal(h.client.observe([unrelated]), undefined);
  assert.ok(h.client.pending);
  const accepted = record();
  assert.equal(h.client.observe([unrelated, accepted]), accepted);
  assert.equal(h.client.pending, undefined);
  assert.equal(h.requests.length, 0);
});

for (const nextScope of [otherScope, undefined]) {
  test(`absent history with ${nextScope ? 'changed' : 'missing'} studio scope never resubmits`, async () => {
    const h = harness(
      (request) =>
        request.url === '/api/renders' ? json([]) : json({ admissionScope: nextScope }),
      operation(),
    );
    const result = await h.client.submit();
    assert.equal(result.kind, 'pending');
    assert.ok(h.client.pending);
    assert.equal(h.posts().length, 0);
    assert.equal(h.keys(), 0);
  });
}

test('an older pending snapshot without a scope loads for review but cannot be sent', async () => {
  const saved = operation();
  delete saved.admissionScope;
  const h = harness(
    (request) => (request.url === '/api/renders' ? json([]) : json({ admissionScope: scope })),
    saved,
  );
  assert.deepEqual(h.client.pending, saved);
  assert.equal((await h.client.submit()).kind, 'pending');
  assert.equal(h.posts().length, 0);
});

test('scope rejection between preflight and POST retains even a fresh operation', async () => {
  const h = harness((request) => {
    if (request.url === '/api/workspace') return json({ admissionScope: scope });
    if (!request.init?.method) return json([]);
    return json({ code: 'admission_scope_changed', error: 'The studio restarted.' }, 409);
  });
  assert.equal((await h.client.submit(recipe())).kind, 'pending');
  assert.equal(h.client.pending?.admissionScope, scope);
  assert.equal(h.posts().length, 1);
});

test('a fresh definitive rejection clears only after a successful history check finds no record', async () => {
  const h = harness((request) => {
    if (request.url === '/api/workspace') return json({ admissionScope: scope });
    return request.init?.method ? json({ error: 'The workflow is not ready.' }, 409) : json([]);
  });
  assert.equal((await h.client.submit(recipe())).kind, 'rejected');
  assert.equal(h.client.pending, undefined);
  assert.equal(h.posts().length, 1);
  assert.deepEqual(
    h.requests.map((request) => `${request.init?.method || 'GET'} ${request.url}`),
    ['GET /api/workspace', 'POST /api/renders', 'GET /api/renders'],
  );
});

test('a late rejection of an uncertain request does not discard its original operation', async () => {
  const h = harness((request) => {
    if (request.url === '/api/workspace') return json({ admissionScope: scope });
    return request.init?.method ? json({ error: 'The key is already in use.' }, 422) : json([]);
  }, operation());
  assert.equal((await h.client.submit()).kind, 'pending');
  assert.deepEqual(h.client.pending, operation());
  assert.equal(h.posts().length, 1);
});

for (const failure of [
  'network',
  '500',
  'invalid-json',
  'unrelated-record',
  'history-unavailable',
]) {
  test(`${failure} never loses an unconfirmed original request`, async () => {
    const h = harness((request) => {
      if (request.url === '/api/workspace') return json({ admissionScope: scope });
      if (!request.init?.method)
        return failure === 'history-unavailable' ? json({ error: 'Unavailable' }, 503) : json([]);
      if (failure === 'network') throw Error('Disconnected.');
      if (failure === 'invalid-json')
        return new Response('not a confirmed JSON response', { status: 400 });
      if (failure === 'unrelated-record')
        return json({ render: record('different-click'), error: 'Unknown.' }, 502);
      return json(
        { error: 'The response was not confirmed.' },
        failure === 'history-unavailable' ? 409 : 500,
      );
    });
    assert.equal((await h.client.submit(recipe())).kind, 'pending');
    assert.equal(h.client.pending?.key, 'original-click');
    assert.equal(h.posts().length, 1);
  });
}

test('an ambiguous response is recovered by a read-only lookup without a retry', async () => {
  const saved = { ...record(), jobId: nativeId };
  const h = harness((request) => {
    if (request.url === '/api/workspace') return json({ admissionScope: scope });
    if (request.init?.method) throw Error('Connection closed after acceptance.');
    return json([saved]);
  });
  assert.deepEqual(await h.client.submit(recipe()), {
    kind: 'record',
    render: saved,
    error: 'Connection closed after acceptance.',
  });
  assert.equal(h.posts().length, 1);
  assert.equal(h.client.pending, undefined);
});

test('an unavailable history blocks explicit rejoin before any create request', async () => {
  const h = harness(() => {
    throw Error('History is offline.');
  }, operation());
  assert.equal((await h.client.submit()).kind, 'pending');
  assert.equal(h.posts().length, 0);
  assert.equal(h.requests.length, 1);
  assert.ok(h.client.pending);
});

test('storage restrictions keep session identity and dismissal performs no request', async () => {
  const posts: Request[] = [];
  const client = new TakeClient(
    async (url, init) => {
      if (url === '/api/workspace') return json({ admissionScope: scope });
      if (init?.method) {
        posts.push({ url, init });
        throw Error('Disconnected.');
      }
      return json([]);
    },
    {
      storage: {
        getItem() {
          throw Error('Storage is disabled.');
        },
        setItem() {
          throw Error('Storage is disabled.');
        },
        removeItem() {
          throw Error('Storage is disabled.');
        },
      },
      newKey: () => 'session-click',
    },
  );
  assert.equal((await client.submit(recipe())).kind, 'pending');
  assert.equal(client.sessionOnly, true);
  assert.equal((await client.submit()).kind, 'pending');
  assert.deepEqual(posts.map(posted), [
    { key: 'session-click', recipe: recipe() },
    { key: 'session-click', recipe: recipe() },
  ]);
  const retained = client.pending;
  assert.deepEqual(client.dismiss(), retained);
  assert.equal(client.pending, undefined);
  assert.equal(posts.length, 2, 'Dismissal neither cancels nor creates a native job.');
});

test('an in-flight request cannot be submitted or dismissed twice before React updates', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = harness(async (request) => {
    if (request.url === '/api/workspace') {
      await gate;
      return json({ admissionScope: scope });
    }
    return json(record('original-click', 'queued'), 201);
  });
  const first = h.client.submit(recipe());
  await assert.rejects(h.client.submit(recipe()), /already being checked/);
  assert.throws(() => h.client.dismiss(), /Wait for the current/);
  release();
  assert.equal((await first).kind, 'record');
  assert.equal(h.posts().length, 1);
});

test('finished or failed takes allow a deliberate next click to use a fresh key', async () => {
  const h = harness((request) =>
    request.url === '/api/workspace'
      ? json({ admissionScope: scope })
      : json(record(posted(request).key!, 'failed'), 201),
  );
  assert.equal((await h.client.submit(recipe())).kind, 'record');
  assert.equal((await h.client.submit(recipe())).kind, 'record');
  assert.deepEqual(
    h.posts().map((request) => posted(request).key),
    ['original-click', 'next-click-2'],
  );
});

test('known-ID recovery retains a returned 502 record and sends only the selected recovery route', async () => {
  const saved = { ...record(), jobId: nativeId };
  const updated = { ...saved, error: 'Still collecting the original outputs.' };
  const h = harness((request) => {
    assert.equal(request.url, `/api/renders/${appId}/reconcile`);
    assert.equal(request.init?.method, 'POST');
    assert.equal(request.init?.body, undefined);
    return json({ error: 'Collection remains uncertain.', render: updated }, 502);
  });
  assert.deepEqual(await h.client.act(saved, 'reconcile'), {
    kind: 'record',
    render: updated,
    error: 'Collection remains uncertain.',
  });
  assert.equal(h.keys(), 0);
  assert.equal(h.posts().length, 1);
  assert.equal(h.client.pending, undefined);
});

test('busy, recoverable and cancel policies cover every backend state without uncertain progress claims', () => {
  const expected: Record<string, [boolean, boolean, boolean]> = {
    submitting: [true, false, true],
    queued: [true, false, true],
    running: [true, false, true],
    finalizing: [true, false, false],
    canceling: [true, false, false],
    submission_unknown: [true, true, true],
    connection_lost: [true, true, true],
    output_error: [false, true, false],
    succeeded: [false, false, false],
    failed: [false, false, false],
    canceled: [false, false, false],
    expired: [false, false, false],
  };
  for (const [state, policies] of Object.entries(expected)) {
    const take = { state, jobId: nativeId };
    assert.deepEqual(
      [takeBusy(take), takeRecoverable(take), takeCancelable(take)],
      policies,
      state,
    );
    assert.equal(
      takeCancelable({ state }),
      false,
      `${state} without a native ID cannot be canceled`,
    );
    assert.equal(takeUncertain(take), ['submission_unknown', 'connection_lost'].includes(state));
  }
});

test('read-only examples ignore a native ledger and reject all create and recovery actions', async () => {
  const storage = memoryStorage(operation());
  let requests = 0;
  const client = new TakeClient(
    async () => {
      requests += 1;
      return json({});
    },
    { storage, readonly: true },
  );
  assert.equal(client.pending, undefined);
  await assert.rejects(client.submit(recipe()), /read-only/);
  await assert.rejects(client.act({ ...record(), jobId: nativeId }, 'reconcile'), /read-only/);
  assert.equal(requests, 0);
  assert.ok(
    storage.getItem(storageKey),
    'Opening a recorded demo must not delete a native studio request.',
  );
});

test('saved operation parsing rejects malformed keys and recipes and detaches valid input', () => {
  assert.throws(() => parseTakeOperation({ ...operation(), key: 'not a valid key' }));
  assert.throws(() => parseTakeOperation({ ...operation(), recipe: { ...recipe(), prompt: '' } }));
  assert.throws(() => parseTakeOperation({ ...operation(), admissionScope: 'another server' }));
  const saved = operation();
  const parsed = parseTakeOperation(saved);
  saved.recipe.prompt = 'Later mutation must not affect a parsed request.';
  assert.deepEqual(parsed.recipe, recipe());
});

test('a matching request key cannot replace the original recipe with different generation settings', async () => {
  const wrongRecipe = { ...recipe(), seed: recipe().seed + 1 };
  const wrong = { ...record(), recipe: wrongRecipe };
  const h = harness((request) => {
    if (request.url === '/api/workspace') return json({ admissionScope: scope });
    if (request.init?.method) return json(wrong, 201);
    return json([wrong]);
  });
  assert.equal((await h.client.submit(recipe())).kind, 'pending');
  assert.deepEqual(h.client.pending?.recipe, recipe());
  assert.equal(h.client.observe([wrong]), undefined);
  assert.equal(h.posts().length, 1);
});

test('recovery never adopts a changed native ID or changed recipe from a response', async () => {
  const original = { ...record(), jobId: nativeId };
  for (const altered of [
    { ...original, jobId: appId },
    { ...original, jobId: undefined },
    { ...original, recipe: { ...recipe(), seed: recipe().seed + 1 } },
  ]) {
    const h = harness(() => json(altered));
    assert.equal((await h.client.act(original, 'reconcile')).kind, 'rejected');
    assert.deepEqual(original, { ...record(), jobId: nativeId });
    assert.equal(h.posts().length, 1);
    assert.equal(h.keys(), 0);
  }
});

test('invalid record paths cannot trigger a recovery request', async () => {
  const h = harness(() => {
    throw Error('Invalid IDs must not reach the transport.');
  });
  await assert.rejects(
    h.client.act({ ...record(), id: '../another-job' }, 'reconcile'),
    /could not be verified/,
  );
  assert.equal(h.requests.length, 0);
});
