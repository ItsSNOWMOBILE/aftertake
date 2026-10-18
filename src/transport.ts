import { createDemoRuntime, type DemoSnapshot } from './demo-runtime';
import { cacheRecordedVideos } from './preview-media';

export const browserDemo = import.meta.env?.VITE_BROWSER_DEMO === '1';
let demo: ReturnType<typeof createDemoRuntime> | undefined;
let videoCache = new Map<string, string>();
export async function initializeTransport() {
  if (!browserDemo) return;
  const response = await fetch(new URL('snapshot.json', document.baseURI));
  if (!response.ok) throw Error('Browser examples could not be loaded.');
  const snapshot = await response.json() as DemoSnapshot;
  demo = createDemoRuntime(snapshot);
  if (import.meta.env?.VITE_BLOB_PREVIEWS === '1') {
    videoCache = await cacheRecordedVideos(snapshot, demo.mediaUrl, { progress(completed, total) {
      const root = document.getElementById('root');
      if (root) {
        const status = document.createElement('p'); status.className = 'browser-demo-loading'; status.setAttribute('role', 'status');
        status.textContent = `Preparing your recorded examples… ${completed} / ${total}`; root.replaceChildren(status);
      }
    } });
  }
}
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!browserDemo) return fetch(url, init);
  if (!demo) return Promise.reject(Error('Browser examples are still loading.'));
  return demo.request(url, init);
}
export function mediaUrl(url: string): string {
  if (!browserDemo) return url;
  const resolved = demo?.mediaUrl(url) || '';
  return videoCache.get(resolved) || resolved;
}
export async function saveMedia(url: string, filename: string) {
  const source = mediaUrl(url);
  if (!source) throw Error('This recorded asset is unavailable.');
  const response = await fetch(source);
  if (!response.ok) throw Error('Could not download this recorded asset.');
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
