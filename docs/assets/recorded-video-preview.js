const pagesOrigin = 'https://itssnowmobile.github.io';
const pagesRoot = '/aftertake/';
const sourceRoot =
  'https://raw.githubusercontent.com/ItsSNOWMOBILE/aftertake/6244e15d630578a41f8b94ddb0155d05b27fb8dc/';
const assetAliases = new Map([
  ['agent/guide.txt', 'docs/mcp.md'],
  ['agent/evidence.json', 'docs/agent-edit-evidence.json'],
  ['ads/narrated-cut-guide.txt', 'docs/narrated-cut.md'],
  ['ads/script-guide.txt', 'docs/script-draft.md'],
  ['cast/focus-guide.txt', 'docs/performer-focus.md'],
  ['cast/performance-guide.txt', 'docs/face-performance.md'],
  ['cast/head-guide.txt', 'docs/head-performance.md'],
  ['judges/evidence.json', 'docs/judges-film-evidence.json'],
  ['castle/source.mp4', 'examples/coastal-kingdom/source.mp4'],
  ['castle/transformation.mp4', 'examples/coastal-kingdom/result.mp4'],
  ['castle/camera-take.mp4', 'examples/castle-pullback/result.mp4'],
  ['examples/crystal-transition/raw.mp4', 'examples/crystal-transition/result.mp4'],
  ['examples/castle-pullback/raw.mp4', 'examples/castle-pullback/result.mp4'],
]);

// Pages publishes docs/, while the packaged showcase also includes examples/
// and generated aliases. Only the known Pages mount needs these fallbacks.
export function resolveRecordedAssetURL(value, baseURI) {
  let base, target;
  try {
    base = new URL(baseURI);
    target = new URL(value, base);
  } catch {
    return value;
  }
  if (
    base.origin !== pagesOrigin ||
    !base.pathname.startsWith(pagesRoot) ||
    target.origin !== pagesOrigin ||
    target.username ||
    target.password ||
    !target.pathname.startsWith(pagesRoot) ||
    /[\\]|%(?:2f|5c|00)/i.test(value)
  ) {
    return value;
  }
  const path = target.pathname.slice(pagesRoot.length);
  if ((path === '' || path === 'index.html') && target.hash === '#source-downloads') {
    return (
      'https://github.com/ItsSNOWMOBILE/aftertake/blob/' +
      '6244e15d630578a41f8b94ddb0155d05b27fb8dc/README.md' +
      target.search +
      '#run-locally'
    );
  }
  const source = assetAliases.get(path) || (path.startsWith('examples/') ? path : undefined);
  return source ? sourceRoot + source + target.search + target.hash : value;
}

export function recordedVideoSourceURL(video, baseURI) {
  // currentSrc can still name the original 404 after a <source> is corrected.
  const declared =
    video.getAttribute('src') || video.querySelector('source[src]')?.getAttribute('src');
  return new URL(resolveRecordedAssetURL(declared || video.currentSrc, baseURI), baseURI).href;
}

export function installRecordedVideoPreviews(doc) {
  const changedVideos = new Set();
  for (const element of doc.querySelectorAll('[src], [href], [poster]')) {
    for (const attribute of ['src', 'href', 'poster']) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const resolved = resolveRecordedAssetURL(value, doc.baseURI);
      if (resolved === value) continue;
      element.setAttribute(attribute, resolved);
      if (attribute === 'src') {
        const video = element.closest('video');
        if (video) changedVideos.add(video);
      }
    }
  }
  for (const video of changedVideos) video.load();

  // Static hosts may serve an MP4 without byte ranges. A local blob restores
  // normal seeking while preserving the recorded file's bytes.
  for (const video of doc.querySelectorAll('video')) {
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.hidden = true;
    status.style.cssText = 'font-size:12px;line-height:1.6;color:#bfd19f;margin:10px 0';
    video.after(status);
    let prepared = false,
      pending;
    function prepare() {
      if (pending) return pending;
      const source = recordedVideoSourceURL(video, doc.baseURI);
      status.hidden = false;
      status.textContent = 'Preparing video preview…';
      pending = (async () => {
        const response = await fetch(source);
        if (!response.ok) throw Error('Could not load the video. Reload to retry.');
        const blob = new Blob([await response.arrayBuffer()], { type: 'video/mp4' });
        await new Promise((resolve, reject) => {
          const done = () => {
            video.removeEventListener('error', failed);
            resolve();
          };
          const failed = () => {
            video.removeEventListener('loadedmetadata', done);
            reject(Error('The video could not be decoded. Download the MP4 instead.'));
          };
          video.addEventListener('loadedmetadata', done, { once: true });
          video.addEventListener('error', failed, { once: true });
          video.src = URL.createObjectURL(blob);
          video.load();
        });
        prepared = true;
        status.hidden = true;
      })();
      return pending;
    }
    video.addEventListener('play', () => {
      if (prepared) return;
      video.pause();
      prepare()
        .then(() => video.play())
        .catch((error) => {
          status.hidden = false;
          status.textContent = prepared ? 'Preview ready. Press Play to continue.' : error.message;
        });
    });
  }
}

if (typeof document !== 'undefined') installRecordedVideoPreviews(document);
