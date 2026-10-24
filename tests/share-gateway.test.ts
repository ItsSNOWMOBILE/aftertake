import assert from 'node:assert/strict';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
  createShareGateway,
  parseCookies,
  routeOf,
  storyboardWeight,
} from '../scripts/share-gateway.mjs';

const token = 'a-long-enough-share-token';

type Seen = { method?: string; url?: string; headers: IncomingHttpHeaders; body: string };

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** A stand-in studio that records each request and answers with `reply`. */
async function studio(
  reply: (req: http.IncomingMessage) => { status: number; type?: string; body?: string },
) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const { status, type = 'application/json', body: out = '{}' } = reply(req);
      res.writeHead(status, { 'content-type': type }).end(out);
    });
  });
  return { server, seen, port: await listen(server) };
}

async function gateway(
  t: test.TestContext,
  reply: Parameters<typeof studio>[0],
  options: Partial<Parameters<typeof createShareGateway>[0]> = {},
) {
  const upstream = await studio(reply);
  const server = createShareGateway({
    studioPort: upstream.port,
    token,
    log: () => {},
    ...options,
  });
  const port = await listen(server);
  t.after(() => {
    server.close();
    upstream.server.close();
  });
  const base = `http://127.0.0.1:${port}`;
  /** Open the access link as a new visitor and return the cookies it set. */
  async function admit() {
    const response = await fetch(`${base}/?access=${token}`, { redirect: 'manual' });
    assert.equal(response.status, 303);
    return response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  }
  return { base, port, upstream, admit };
}

test('the access link admits a visitor with cookies and the gateway refuses everyone else', async (t) => {
  const { base, upstream, admit } = await gateway(t, () => ({ status: 200 }));
  for (const url of [`${base}/`, `${base}/api/workspace`, `${base}/?access=wrong`]) {
    const response = await fetch(url, { redirect: 'manual' });
    assert.equal(response.status, 401);
    assert.match(await response.text(), /opens from its access link/);
  }
  const response = await fetch(`${base}/studio?x=1&access=${token}`, { redirect: 'manual' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/studio?x=1');
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /HttpOnly; SameSite=Lax/);
    // Served on loopback here, so not Secure; through a tunnel it is.
    assert.doesNotMatch(cookie, /Secure/);
    assert.ok(!cookie.includes(token), 'the cookie does not carry the link itself');
  }
  assert.equal(upstream.seen.length, 0);
  const admitted = await fetch(`${base}/api/workspace`, { headers: { cookie: await admit() } });
  assert.equal(admitted.status, 200);
  assert.equal(upstream.seen.length, 1);
});

test('cookies are Secure when the gateway is reached through a tunnel host', async (t) => {
  const { port } = await gateway(t, () => ({ status: 200 }));
  const cookies = await new Promise<string[]>((resolve, reject) =>
    http
      .get({ port, path: `/?access=${token}`, headers: { host: 'studio.example.ts.net' } }, (res) =>
        resolve(res.headers['set-cookie'] || []),
      )
      .on('error', reject),
  );
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) assert.match(cookie, /; Secure$/);
});

test('requests reach the studio as same-origin loopback requests without visitor cookies', async (t) => {
  const { base, upstream, admit } = await gateway(t, () => ({ status: 201 }));
  const cookie = await admit();
  const response = await fetch(`${base}/api/films?draft=1`, {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://studio.example.ts.net',
      referer: 'https://studio.example.ts.net/',
      'content-type': 'application/json',
    },
    body: '{"name":"cut"}',
  });
  assert.equal(response.status, 201);
  const [seen] = upstream.seen;
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/films?draft=1');
  assert.equal(seen.headers.host, `127.0.0.1:${upstream.port}`);
  assert.equal(seen.headers.origin, `http://127.0.0.1:${upstream.port}`);
  assert.equal(seen.headers.cookie, undefined);
  assert.equal(seen.headers.referer, undefined);
  assert.equal(seen.body, '{"name":"cut"}');
});

test('visitors cannot change the Comfy Cloud connection or render destinations', async (t) => {
  const { base, upstream, admit } = await gateway(t, () => ({ status: 200 }));
  const cookie = await admit();
  for (const [method, path] of [
    ['POST', '/api/compute/connection'],
    ['DELETE', '/api/compute/connection'],
    ['POST', '/api/compute/routing'],
    // Spellings the studio's router treats as the same route.
    ['POST', '/api/compute/connection/'],
    ['DELETE', '/API/Compute/Connection'],
    ['POST', '/api/compute/%63onnection'],
    ['POST', '/api//compute/routing//'],
  ]) {
    const response = await fetch(base + path, { method, headers: { cookie } });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.match((await response.json()).error, /owner/);
  }
  assert.equal(upstream.seen.length, 0);
  assert.equal((await fetch(`${base}/api/compute`, { headers: { cookie } })).status, 200);
  assert.equal(
    (await fetch(`${base}/api/compute/probe`, { method: 'POST', headers: { cookie } })).status,
    200,
  );
});

test('each visitor gets a daily render allowance; only accepted renders count', async (t) => {
  let clock = 0;
  let status = 201;
  const { base, admit } = await gateway(t, () => ({ status }), {
    rendersPerVisitor: 2,
    rendersPerDay: 3,
    now: () => clock,
  });
  const first = await admit();
  const render = (cookie: string, path = '/api/images') =>
    fetch(base + path, { method: 'POST', headers: { cookie } }).then((r) => r.status);
  status = 409;
  assert.equal(await render(first), 409, 'a refused render is not counted');
  status = 201;
  assert.equal(await render(first), 201);
  assert.equal(await render(first, '/api/characters/replacements'), 201);
  const refused = await fetch(`${base}/api/videos`, { method: 'POST', headers: { cookie: first } });
  assert.equal(refused.status, 429);
  assert.match((await refused.json()).error, /2 renders today/);
  // Cancelling, previews and CPU work such as Film export are never counted.
  for (const path of [
    '/api/images/1234/cancel',
    '/api/finishing/preview',
    '/api/films',
    '/api/finishing',
  ])
    assert.equal(await render(first, path), 201, path);
  assert.equal(await render(first, '/API/Images/'), 429, 'other spellings count too');
  const second = await admit();
  assert.equal(await render(second), 201);
  assert.equal(await render(second), 429, 'the shared daily total is reached');
  clock += 24 * 60 * 60 * 1000;
  assert.equal(await render(first), 201, 'a new day restores the allowance');
});

test('a one-tap effect counts once; re-cutting it without the watermark is free', async (t) => {
  const { base, admit } = await gateway(t, () => ({ status: 202 }), { rendersPerVisitor: 1 });
  const cookie = await admit();
  const post = (path: string) =>
    fetch(base + path, { method: 'POST', headers: { cookie } }).then((r) => r.status);
  assert.equal(await post('/api/one-tap'), 202);
  for (const path of [
    '/api/one-tap/5f0c7a52-3d1e-4b8a-9b55-2f4d8c1e9a10/export',
    '/api/one-tap/5f0c7a52-3d1e-4b8a-9b55-2f4d8c1e9a10/cancel',
  ])
    assert.equal(await post(path), 202, path);
  assert.equal(await post('/api/one-tap/'), 429, 'Again with a new seed is a new render');
  assert.equal(await post('/API/One-Tap'), 429);
});

test('a storyboard counts one render per shot plus its song; planning it is free', async (t) => {
  const { base, upstream, admit } = await gateway(t, () => ({ status: 202 }), {
    rendersPerVisitor: 9,
  });
  const cookie = await admit();
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const shots = (count: number) => ({
    title: 'Dawn',
    shots: Array.from({ length: count }, () => ({})),
  });
  assert.equal((await post('/api/storyboards/plan', { idea: 'x', shots: 5 })).status, 202);
  assert.equal((await post('/api/storyboards', shots(5))).status, 202);
  // The studio still receives the exact request the visitor sent.
  assert.deepEqual(JSON.parse(upstream.seen.at(-1)!.body), shots(5));
  // Six of nine used; four shots would need five.
  const refused = await post('/api/storyboards', shots(4));
  assert.equal(refused.status, 429);
  assert.match((await refused.json()).error, /starts 5 renders and you have 3 left/);
  assert.equal(
    (await post('/api/storyboards', { shots: [] })).status,
    202,
    'one shot and its song at least',
  );
  assert.equal((await post('/api/images', {})).status, 202);
  assert.equal((await post('/api/images', {})).status, 429);
  assert.equal(storyboardWeight(Buffer.from('{"shots":[1,2,3]}')), 4);
  assert.equal(storyboardWeight(Buffer.from('not json')), 1);
  assert.equal(
    storyboardWeight(Buffer.from('{"shots":' + JSON.stringify(Array(50).fill(0)) + '}')),
    6,
  );
});

test('pages carry a dismissible note with the visitor’s renders left; other responses pass through', async (t) => {
  const { base, admit } = await gateway(
    t,
    (req) =>
      req.url === '/'
        ? {
            status: 200,
            type: 'text/html; charset=utf-8',
            body: '<html><body><div id="root"></div></body></html>',
          }
        : { status: 200, type: 'application/javascript', body: 'export {};</body>' },
    { rendersPerVisitor: 7 },
  );
  const cookie = await admit();
  const response = await fetch(`${base}/`, { headers: { cookie, accept: 'text/html' } });
  const html = await response.text();
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(html));
  assert.match(html, /<div id="root"><\/div><input type="checkbox" id="aftertake-share-hide"/);
  assert.match(html, /7 of 7 renders left for you today/);
  assert.match(html, /<\/body><\/html>$/);
  const script = await fetch(`${base}/assets/app.js`, { headers: { cookie } });
  assert.equal(await script.text(), 'export {};</body>');
});

test('an unreachable studio gets a page that retries on its own', async (t) => {
  const upstream = await studio(() => ({ status: 200 }));
  await new Promise((resolve) => upstream.server.close(resolve));
  const server = createShareGateway({ studioPort: upstream.port, token, log: () => {} });
  const port = await listen(server);
  t.after(() => server.close());
  const admitted = await fetch(`http://127.0.0.1:${port}/?access=${token}`, { redirect: 'manual' });
  const cookie = admitted.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /http-equiv="refresh"/);
});

test('routes are compared the way the studio router matches them', () => {
  assert.equal(routeOf('/API/Images/'), '/api/images');
  assert.equal(routeOf('//api//compute/%72outing'), '/api/compute/routing');
  assert.equal(routeOf('/'), '/');
  assert.equal(routeOf('/api/%E0%A4%A'), '/api/%e0%a4%a');
});

test('the gateway needs a long access token and reads cookies leniently', () => {
  assert.throws(() => createShareGateway({ studioPort: 1, token: 'short' }), /16 characters/);
  assert.deepEqual(parseCookies('a=1; b = two ;broken; c=x=y'), { a: '1', b: 'two', c: 'x=y' });
});
