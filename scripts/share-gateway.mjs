// Serves a running studio to people outside this computer, such as judges who
// open it through a tunnel. The studio itself stays on loopback: this gateway
// admits holders of the access link, keeps Render setup as the owner left it,
// and caps how many renders each visitor can start in a day.
// Plain Node with no dependencies, like the launcher that starts it.
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ACCESS_COOKIE = 'aftertake_access';
const VISITOR_COOKIE = 'aftertake_visitor';
const DAY = 24 * 60 * 60 * 1000;
const COOKIE_DAYS = 45;
// Starting one of these runs a Comfy graph on the GPU or spends Comfy Cloud
// credits. A one-tap effect counts once, with its automatic re-render; a
// storyboard counts each shot and its song; a set of takes counts each take.
// CPU work, such as Film export, finishing, layer renders, planning a storyboard
// and re-cutting an effect without its watermark, is free.
const renderRoutes =
  /^\/api\/(images|videos|enhancements|renders|frame-edits|depth-effects|one-tap|storyboards|take-sets|characters\/(selections|replacements))$/;
/** Renders a storyboard starts: one video per shot, then its song. */
export function storyboardWeight(body) {
  try {
    const shots = JSON.parse(body.toString('utf8'))?.shots;
    return Array.isArray(shots) ? Math.min(5, Math.max(1, shots.length)) + 1 : 1;
  } catch {
    return 1;
  }
}
/** Renders a set of takes starts: one per take. */
export function takeSetWeight(body) {
  try {
    const count = Number(JSON.parse(body.toString('utf8'))?.count);
    return Number.isInteger(count) ? Math.min(4, Math.max(1, count)) : 1;
  } catch {
    return 1;
  }
}
/** Routes whose cost is in their request body. */
const weighedRoutes = { '/api/storyboards': storyboardWeight, '/api/take-sets': takeSetWeight };
const MAX_WEIGHED_BODY = 256 * 1024;
const lockedRoutes = [
  [
    /^\/api\/compute\/connection$/,
    'This shared copy keeps the Comfy Cloud connection its owner set.',
  ],
  [/^\/api\/compute\/routing$/, 'This shared copy keeps the render destinations its owner chose.'],
];
// Hop-by-hop headers describe one connection, not the response being relayed.
const hopHeaders = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade'];
const links = {
  film: 'https://itssnowmobile.github.io/aftertake/film/',
  trial: 'https://itssnowmobile.github.io/aftertake/studio/',
  source: 'https://github.com/ItsSNOWMOBILE/aftertake',
};

const digest = (value) => createHash('sha256').update(String(value)).digest();

/**
 * The path as the studio's router matches it: Express decodes it, ignores case
 * and a trailing slash, so the gateway's checks must too.
 */
export function routeOf(pathname) {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape reaches no studio route; check the raw path.
  }
  return path
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .replace(/(.)\/+$/, '$1');
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

function page(title, body, extraHead = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${extraHead}<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141615;color:#eaf0df;font:16px/1.6 system-ui,sans-serif}main{max-width:520px;padding:32px}h1{font-size:24px;margin:0 0 12px}p{color:#a4b495}a{color:#d5e991}</style></head><body><main>${body}</main></body></html>`;
}

const deniedPage = page(
  'Aftertake',
  `<h1>This shared copy of Aftertake opens from its access link.</h1><p>Ask its owner for the link. Meanwhile you can <a href="${links.film}">watch a film made in Aftertake</a>, <a href="${links.trial}">try the browser version</a> or <a href="${links.source}">get it on GitHub</a>.</p>`,
);
const unavailablePage = page(
  'Aftertake is starting',
  '<h1>Aftertake is starting.</h1><p>This page tries again on its own in a few seconds.</p>',
  '<meta http-equiv="refresh" content="10">',
);

function note(left, limit) {
  return `<input type="checkbox" id="aftertake-share-hide" hidden><div id="aftertake-share-note" role="note"><span>Shared copy of Aftertake, running live on its owner's computer. One render runs at a time, so a video can take a few minutes. ${left} of ${limit} renders left for you today.</span><label for="aftertake-share-hide" aria-label="Hide this note">×</label></div><style>#aftertake-share-note{position:fixed;left:16px;right:16px;bottom:14px;margin:0 auto;width:fit-content;max-width:720px;z-index:2147483647;display:flex;gap:14px;align-items:center;padding:9px 14px;border:1px solid #5b6e43;border-radius:8px;background:#1c2417;color:#dfe9cf;font:13px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px #0008;pointer-events:none;animation:aftertake-share-out .4s ease 15s forwards}#aftertake-share-note label{pointer-events:auto;cursor:pointer;color:#d5e991;font-size:18px;line-height:1}#aftertake-share-hide:checked+#aftertake-share-note{display:none}@keyframes aftertake-share-out{to{opacity:0;visibility:hidden}}</style>`;
}

/**
 * Create the gateway server. The caller listens on it; the studio must already
 * listen on 127.0.0.1:studioPort.
 */
export function createShareGateway({
  studioPort,
  token,
  rendersPerVisitor = 20,
  rendersPerDay = 150,
  now = Date.now,
  log = console.log,
}) {
  if (typeof token !== 'string' || token.length < 16)
    throw new Error('Use an access token of at least 16 characters.');
  const expected = digest(token);
  // The cookie proves the visitor had the link without storing the link itself.
  const accessValue = createHash('sha256').update(`aftertake-share:${token}`).digest('hex');
  let renders = [];

  function used(visitor) {
    renders = renders.filter((render) => now() - render.at < DAY);
    return {
      mine: renders.filter((render) => render.visitor === visitor).length,
      all: renders.length,
    };
  }
  function cookie(name, value, secure) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86400}${secure ? '; Secure' : ''}`;
  }
  function send(res, status, type, body, headers = {}) {
    res.writeHead(status, {
      'content-type': type,
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      ...headers,
    });
    res.end(body);
  }
  const json = (res, status, value) =>
    send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));

  function relay(req, res, url, visitor, counted, body) {
    const headers = { ...req.headers, host: `127.0.0.1:${studioPort}` };
    // The studio accepts only loopback hosts and same-origin writes, and needs
    // none of the visitor's cookies.
    delete headers.cookie;
    delete headers.referer;
    if (headers.origin) headers.origin = `http://127.0.0.1:${studioPort}`;
    const page = req.method === 'GET' && String(req.headers.accept || '').includes('text/html');
    if (page) headers['accept-encoding'] = 'identity';
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: studioPort,
        method: req.method,
        path: url.pathname + url.search,
        headers,
      },
      (response) => {
        const status = response.statusCode || 502;
        if (counted && status >= 200 && status < 300) {
          for (let render = 0; render < counted; render++) renders.push({ visitor, at: now() });
          const { mine, all } = used(visitor);
          log(
            `[share] render ${mine}/${rendersPerVisitor} for this visitor, ${all}/${rendersPerDay} today`,
          );
        }
        const outgoing = { ...response.headers };
        for (const name of hopHeaders) delete outgoing[name];
        if (page && String(response.headers['content-type'] || '').startsWith('text/html')) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const left = Math.max(0, rendersPerVisitor - used(visitor).mine);
            const html = Buffer.concat(chunks)
              .toString('utf8')
              .replace(/<\/body>/i, `${note(left, rendersPerVisitor)}</body>`);
            delete outgoing['content-length'];
            send(res, status, outgoing['content-type'], html, outgoing);
          });
          return;
        }
        res.writeHead(status, outgoing);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) send(res, 502, 'text/html; charset=utf-8', unavailablePage);
      else res.destroy();
    });
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    if (body) upstream.end(body);
    else req.pipe(upstream);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://share.invalid');
    const cookies = parseCookies(req.headers.cookie);
    const host = String(req.headers.host || '').split(':')[0];
    const secure = !['localhost', '127.0.0.1'].includes(host);
    const offered = url.searchParams.get('access');
    if (offered !== null) {
      if (!timingSafeEqual(digest(offered), expected))
        return send(res, 401, 'text/html; charset=utf-8', deniedPage);
      url.searchParams.delete('access');
      const visitor = /^[a-f0-9]{32}$/.test(cookies[VISITOR_COOKIE] || '')
        ? cookies[VISITOR_COOKIE]
        : randomBytes(16).toString('hex');
      res.writeHead(303, {
        location: url.pathname + url.search,
        'set-cookie': [
          cookie(ACCESS_COOKIE, accessValue, secure),
          cookie(VISITOR_COOKIE, visitor, secure),
        ],
        'cache-control': 'no-store',
      });
      return res.end();
    }
    const presented = cookies[ACCESS_COOKIE] || '';
    if (
      presented.length !== accessValue.length ||
      !timingSafeEqual(Buffer.from(presented), Buffer.from(accessValue))
    )
      return send(res, 401, 'text/html; charset=utf-8', deniedPage);
    const visitor = /^[a-f0-9]{32}$/.test(cookies[VISITOR_COOKIE] || '')
      ? cookies[VISITOR_COOKIE]
      : 'unnamed';
    const route = routeOf(url.pathname);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET'))
      for (const [pattern, message] of lockedRoutes)
        if (pattern.test(route)) return json(res, 403, { error: message });
    if (!(req.method === 'POST' && renderRoutes.test(route)))
      return relay(req, res, url, visitor, 0);
    const admit = (weight, body) => {
      const { mine, all } = used(visitor);
      if (mine + weight > rendersPerVisitor)
        return json(res, 429, {
          error:
            weight > 1 && mine < rendersPerVisitor
              ? `This starts ${weight} renders and you have ${rendersPerVisitor - mine} left today. Ask for fewer shots or takes, or try again tomorrow.`
              : `You've started ${mine} renders today, the most this shared copy allows each visitor. Try again tomorrow.`,
        });
      if (all + weight > rendersPerDay)
        return json(res, 429, {
          error: 'This shared copy has reached its renders for today. Try again tomorrow.',
        });
      relay(req, res, url, visitor, weight, body);
    };
    const weigh = weighedRoutes[route];
    if (!weigh) return admit(1);
    // A storyboard's or take set's cost is in its request, so read the small JSON body first.
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_WEIGHED_BODY) {
        json(res, 413, { error: 'This request is too large.' });
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_WEIGHED_BODY) return;
      const body = Buffer.concat(chunks);
      admit(weigh(body), body);
    });
  });
  // The production studio needs no WebSocket; refuse upgrades rather than relay them.
  server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}
