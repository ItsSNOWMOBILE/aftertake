import { createDemoRuntime, type DemoSnapshot } from './demo-runtime';

export const browserDemo = import.meta.env?.VITE_BROWSER_DEMO === '1';
let demo: ReturnType<typeof createDemoRuntime> | undefined;
export async function initializeTransport() {
  if (!browserDemo) return;
  const response = await fetch(new URL('snapshot.json', document.baseURI));
  if (!response.ok) throw Error('Browser examples could not be loaded.');
  demo = createDemoRuntime(await response.json() as DemoSnapshot);
}
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!browserDemo) return fetch(url, init);
  if (!demo) return Promise.reject(Error('Browser examples are still loading.'));
  return demo.request(url, init);
}
export function mediaUrl(url: string): string {
  return browserDemo ? demo?.mediaUrl(url) || '' : url;
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
