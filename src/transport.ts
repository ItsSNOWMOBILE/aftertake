import { createDemoRuntime, type DemoSnapshot } from './demo-runtime';
import {
  createRecordedPreviewCache,
  type PreviewCacheOptions,
  type PreviewSource,
} from './preview-media';

export const browserDemo = import.meta.env?.VITE_BROWSER_DEMO === '1';

export function createBrowserTransport(
  options: PreviewCacheOptions & { blobPreviews?: boolean } = {},
) {
  const fetchAsset = options.fetch || ((url: string) => fetch(url));
  const previews = createRecordedPreviewCache({ ...options, fetch: fetchAsset });
  const directSources = new Map<string, PreviewSource>();
  const noSource: PreviewSource = Object.freeze({ status: 'idle' });
  const unavailableSource: PreviewSource = Object.freeze({
    status: 'error',
    error: 'This recorded video is unavailable. Choose another recorded take.',
  });
  let demo: ReturnType<typeof createDemoRuntime> | undefined;
  function resolve(url?: string) {
    return url ? demo?.mediaUrl(url) || '' : '';
  }
  function lazy(url: string) {
    return Boolean(options.blobPreviews && /\.mp4(?:[?#]|$)/i.test(url));
  }
  function source(url?: string): PreviewSource {
    if (!url) return noSource;
    const resolved = resolve(url);
    if (!resolved) return unavailableSource;
    if (lazy(resolved)) return previews.get(resolved);
    if (!directSources.has(resolved))
      directSources.set(resolved, { status: 'ready', src: resolved || undefined });
    return directSources.get(resolved)!;
  }
  return {
    async initialize(snapshotURL: string) {
      const response = await fetchAsset(snapshotURL);
      if (!response.ok) throw Error('Browser examples could not be loaded.');
      demo = createDemoRuntime((await response.json()) as DemoSnapshot);
    },
    request(url: string, init?: RequestInit) {
      return demo
        ? demo.request(url, init)
        : Promise.reject(Error('Browser examples are still loading.'));
    },
    mediaUrl(url: string) {
      const resolved = resolve(url);
      return previews.get(resolved).src || resolved;
    },
    source,
    subscribe(url: string | undefined, listener: () => void) {
      return previews.subscribe(resolve(url), listener);
    },
    async prepare(url?: string, retry = false) {
      const resolved = resolve(url);
      if (!resolved) throw Error('This recorded asset is unavailable.');
      return lazy(resolved) ? previews.load(resolved, retry) : resolved;
    },
    async blob(url: string) {
      const resolved = resolve(url);
      if (!resolved) throw Error('This recorded asset is unavailable.');
      const response = await fetchAsset(
        lazy(resolved) ? await previews.load(resolved, true) : resolved,
      );
      if (!response.ok) throw Error('Could not download this recorded asset.');
      return response.blob();
    },
    dispose: previews.dispose,
  };
}

const browserTransport = createBrowserTransport({
  blobPreviews: import.meta.env?.VITE_BLOB_PREVIEWS === '1',
});

export async function initializeTransport() {
  if (browserDemo)
    await browserTransport.initialize(new URL('snapshot.json', document.baseURI).href);
}
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return browserDemo ? browserTransport.request(url, init) : fetch(url, init);
}
export function mediaUrl(url: string): string {
  return browserDemo ? browserTransport.mediaUrl(url) : url;
}
export function previewSource(url?: string): PreviewSource {
  return browserDemo ? browserTransport.source(url) : { status: 'ready', src: url };
}
export function subscribePreview(url: string | undefined, listener: () => void) {
  return browserDemo ? browserTransport.subscribe(url, listener) : () => {};
}
export function preparePreview(url?: string, retry = false) {
  return browserDemo ? browserTransport.prepare(url, retry) : Promise.resolve(url || '');
}
export async function saveMedia(url: string, filename: string) {
  const blob = browserDemo
    ? await browserTransport.blob(url)
    : await fetch(url).then((response) => {
        if (!response.ok) throw Error('Could not download this recorded asset.');
        return response.blob();
      });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
