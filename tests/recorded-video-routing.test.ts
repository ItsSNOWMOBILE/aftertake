import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const helper = await import(new URL('../public/recorded-video-preview.js', import.meta.url).href);
const { resolveRecordedAssetURL, recordedVideoSourceURL, installRecordedVideoPreviews } = helper;
const commit = '2805cb7ebd987311e32357a5a4852970e924e94a';
const raw = `https://raw.githubusercontent.com/ItsSNOWMOBILE/aftertake/${commit}/`;
const pages = 'https://itssnowmobile.github.io/aftertake/';
const base = pages + 'cast/h3.html';

test('Pages media and generated aliases use their pinned tracked sources', () => {
  assert.equal(
    resolveRecordedAssetURL('../examples/character-h3-high/result.mp4?download=1#t=1', base),
    raw + 'examples/character-h3-high/result.mp4?download=1#t=1',
  );
  const aliases = {
    'agent/guide.txt': 'docs/mcp.md',
    'agent/evidence.json': 'docs/agent-edit-evidence.json',
    'ads/narrated-cut-guide.txt': 'docs/narrated-cut.md',
    'ads/script-guide.txt': 'docs/script-draft.md',
    'cast/focus-guide.txt': 'docs/performer-focus.md',
    'cast/performance-guide.txt': 'docs/face-performance.md',
    'cast/head-guide.txt': 'docs/head-performance.md',
    'judges/evidence.json': 'docs/judges-film-evidence.json',
    'castle/source.mp4': 'examples/coastal-kingdom/source.mp4',
    'castle/transformation.mp4': 'examples/coastal-kingdom/result.mp4',
    'castle/camera-take.mp4': 'examples/castle-pullback/result.mp4',
  };
  for (const [alias, target] of Object.entries(aliases)) {
    assert.equal(
      resolveRecordedAssetURL(alias + '?v=1#detail', pages),
      raw + target + '?v=1#detail',
    );
  }
  for (const path of ['examples/crystal-transition/raw.mp4', 'examples/castle-pullback/raw.mp4']) {
    assert.equal(
      resolveRecordedAssetURL(path + '?v=1#detail', pages),
      raw + path + '?v=1#detail',
      'A distinct raw generation must keep its own media path.',
    );
  }
  for (const path of ['', 'index.html']) {
    assert.equal(
      resolveRecordedAssetURL(pages + path + '#source-downloads', base),
      'https://github.com/ItsSNOWMOBILE/aftertake#run-locally',
    );
  }
});

test('routing fences preserve unknown paths, origin boundaries and packaged local URLs', () => {
  const unchanged = [
    '../assets/aftertake-demo.mp4',
    '../studio/',
    'missing-guide.txt',
    '../examples-other/result.mp4',
    '#source-downloads',
    'https://example.com/aftertake/examples/result.mp4',
    'http://itssnowmobile.github.io/aftertake/examples/result.mp4',
    'https://itssnowmobile.github.io:444/aftertake/examples/result.mp4',
    'https://itssnowmobile.github.io/aftertake-other/examples/result.mp4',
    'https://itssnowmobile.github.io/Aftertake/examples/result.mp4',
    'https://other@itssnowmobile.github.io/aftertake/examples/result.mp4',
    '../../examples/result.mp4',
    '../examples/../../private/result.mp4',
    '../examples/%2e%2e/%2e%2e/private/result.mp4',
    '../examples%2Fprivate/result.mp4',
    '../examples/%5cprivate/result.mp4',
    '../examples/\\private/result.mp4',
    'data:video/mp4;base64,AAA',
    'blob:https://itssnowmobile.github.io/a',
    'mailto:hello@example.com',
    'https://[',
  ];
  for (const value of unchanged) assert.equal(resolveRecordedAssetURL(value, base), value, value);
  for (const localBase of [
    'https://aftertake.example/cast/h3.html',
    'http://127.0.0.1:4344/cast/h3.html',
    'file:///showcase/cast/h3.html',
    'https://itssnowmobile.github.io/other/cast/h3.html',
  ]) {
    for (const value of [
      '../examples/a/result.mp4',
      '../castle/source.mp4',
      '../#source-downloads',
    ]) {
      assert.equal(resolveRecordedAssetURL(value, localBase), value);
    }
  }
  assert.equal(resolveRecordedAssetURL('../examples/a.mp4', 'invalid base'), '../examples/a.mp4');
});

class Element {
  attrs: Map<string, string>;
  owner?: Video;
  constructor(attrs: Record<string, string>) {
    this.attrs = new Map(Object.entries(attrs));
  }
  getAttribute(key: string) {
    return this.attrs.get(key) ?? null;
  }
  setAttribute(key: string, value: string) {
    this.attrs.set(key, value);
  }
  closest() {
    return this.owner;
  }
}

class Video extends Element {
  currentSrc = pages + 'examples/old-404.mp4';
  source: Element;
  loads = 0;
  plays = 0;
  listeners = new Map<string, Set<() => void>>();
  constructor() {
    super({ poster: '../examples/character-h3-high/poster.jpg' });
    this.owner = this;
    this.source = new Element({ src: '../examples/character-h3-high/result.mp4' });
    this.source.owner = this;
  }
  querySelector() {
    return this.source;
  }
  after() {}
  pause() {}
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  set src(value: string) {
    this.setAttribute('src', value);
  }
  load() {
    this.loads++;
    if (this.getAttribute('src')?.startsWith('blob:')) this.dispatch('loadedmetadata');
  }
  async play() {
    this.plays++;
  }
}

test('DOM routing fixes posters and links, reloads once, and fetches declared media before stale currentSrc', async () => {
  const video = new Video();
  const image = new Element({ src: '../examples/character-h3-high/reference.png' });
  const link = new Element({ href: '../#source-downloads' });
  const status = { hidden: true, textContent: '', style: {}, setAttribute() {} };
  const doc = {
    baseURI: base,
    querySelectorAll: (selector: string) =>
      selector === 'video' ? [video] : [video, video.source, image, link],
    createElement: () => status,
  };
  const previousFetch = globalThis.fetch;
  const previousCreate = URL.createObjectURL;
  const calls: string[] = [];
  const blobs: Blob[] = [];
  const bytes = new Uint8Array([1, 3, 5, 7]);
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(bytes);
  };
  URL.createObjectURL = (blob) => {
    assert.ok(blob instanceof Blob);
    blobs.push(blob);
    return 'blob:test/recorded';
  };
  try {
    installRecordedVideoPreviews(doc);
    assert.equal(video.loads, 1);
    assert.equal(video.source.getAttribute('src'), raw + 'examples/character-h3-high/result.mp4');
    assert.equal(image.getAttribute('src'), raw + 'examples/character-h3-high/reference.png');
    assert.equal(video.getAttribute('poster'), raw + 'examples/character-h3-high/poster.jpg');
    assert.equal(
      link.getAttribute('href'),
      'https://github.com/ItsSNOWMOBILE/aftertake#run-locally',
    );
    assert.equal(recordedVideoSourceURL(video, base), video.source.getAttribute('src'));
    video.dispatch('play');
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(calls, [raw + 'examples/character-h3-high/result.mp4']);
    assert.equal(video.loads, 2);
    assert.equal(video.plays, 1);
    assert.equal(status.hidden, true);
    assert.equal(blobs[0].type, 'video/mp4');
    assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()), bytes);
    video.dispatch('play');
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    URL.createObjectURL = previousCreate;
  }
});

test('explicit video src wins over nested source and packaged local sources stay local', () => {
  const video = new Video();
  video.setAttribute('src', '../examples/character-h3-high/prepared-source.mp4');
  assert.equal(
    recordedVideoSourceURL(video, base),
    raw + 'examples/character-h3-high/prepared-source.mp4',
  );
  assert.equal(
    recordedVideoSourceURL(video, 'https://aftertake.example/cast/h3.html'),
    'https://aftertake.example/examples/character-h3-high/prepared-source.mp4',
  );
});

test('all static showcase HTML includes one helper and its pinned Pages paths exist in the current checkout', () => {
  const root = resolve(import.meta.dirname, '..');
  // URL assertions retain the fixed asset revision; CI only needs its shallow
  // checkout's current path inventory, not historical commit objects.
  const tracked = new Set(
    execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n'),
  );
  const directories = ['', 'ads', 'agent', 'cast', 'castle', 'create', 'judges', 'type'];
  let pageCount = 0;
  let rewritten = 0;
  for (const directory of directories) {
    const folder = resolve(root, 'docs', directory);
    for (const name of readdirSync(folder).filter((name) => name.endsWith('.html'))) {
      const page = ['docs', directory, name].filter(Boolean).join('/');
      const html = readFileSync(resolve(folder, name), 'utf8');
      const base = pages + page.slice(5);
      assert.equal(
        (html.match(/src="[^\"]*recorded-video-preview\.js\?v=pages-assets-1"/g) ?? []).length,
        1,
        page,
      );
      pageCount++;
      for (const [, , value] of html.matchAll(/\b(src|href|poster)\s*=\s*["']([^"']*)["']/g)) {
        const target = new URL(resolveRecordedAssetURL(value, base), base);
        if (target.href.startsWith(raw)) {
          rewritten++;
          assert.ok(
            tracked.has(decodeURIComponent(target.pathname.split('/').slice(4).join('/'))),
            `${page}: ${value}`,
          );
        } else if (
          target.origin === new URL(pages).origin &&
          target.pathname.startsWith('/aftertake/')
        ) {
          const path = 'docs/' + decodeURIComponent(target.pathname.slice('/aftertake/'.length));
          assert.ok(
            tracked.has(path) || tracked.has(path.replace(/\/$/, '') + '/index.html'),
            `${page}: ${value}`,
          );
        }
      }
    }
  }
  assert.equal(pageCount, 16);
  assert.equal(rewritten, 136);
  assert.equal(
    readFileSync(resolve(root, 'public/recorded-video-preview.js'), 'utf8'),
    readFileSync(resolve(root, 'docs/assets/recorded-video-preview.js'), 'utf8'),
  );
});
