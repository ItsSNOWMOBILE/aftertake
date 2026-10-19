export type PreviewSource = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  src?: string;
  error?: string;
}>;

export type PreviewCacheOptions = {
  fetch?: (url: string) => Promise<Response>;
  createURL?: (blob: Blob) => string;
  revokeURL?: (url: string) => void;
};

const idle: PreviewSource = Object.freeze({ status: 'idle' });

// A static host can omit the byte-range support needed by native video seeking.
// Prepare only requested videos, sharing their original bytes between previews.
export function createRecordedPreviewCache(options: PreviewCacheOptions = {}) {
  const fetchMedia = options.fetch || ((url: string) => fetch(url)),
    createURL = options.createURL || ((blob: Blob) => URL.createObjectURL(blob)),
    revokeURL = options.revokeURL || ((url: string) => URL.revokeObjectURL(url));
  const entries = new Map<string, { state: PreviewSource; pending?: Promise<string> }>();
  const listeners = new Map<string, Set<() => void>>();
  function notify(url: string) {
    for (const listener of listeners.get(url) || []) listener();
  }
  function load(url: string, retry = false): Promise<string> {
    const existing = entries.get(url);
    if (existing?.state.status === 'ready') return Promise.resolve(existing.state.src!);
    if (existing?.pending) return existing.pending;
    if (existing?.state.status === 'error' && !retry)
      return Promise.reject(Error(existing.state.error));
    const entry: { state: PreviewSource; pending?: Promise<string> } = {
      state: { status: 'loading' },
    };
    entries.set(url, entry);
    entry.pending = Promise.resolve().then(async () => {
      try {
        const response = await fetchMedia(url);
        if (!response.ok) throw Error('This video could not be loaded. Try again.');
        const blob = new Blob([await response.arrayBuffer()], { type: 'video/mp4' });
        if (entries.get(url) !== entry) throw Error('This preview was closed.');
        const src = createURL(blob);
        entry.state = { status: 'ready', src };
        entry.pending = undefined;
        notify(url);
        return src;
      } catch (error) {
        if (entries.get(url) === entry) {
          entry.state = { status: 'error', error: 'This video could not be loaded. Try again.' };
          entry.pending = undefined;
          notify(url);
        }
        throw error;
      }
    });
    notify(url);
    return entry.pending;
  }
  return {
    get: (url: string): PreviewSource => entries.get(url)?.state || idle,
    load,
    subscribe(url: string, listener: () => void) {
      const subscriptions = listeners.get(url) || new Set<() => void>();
      subscriptions.add(listener);
      listeners.set(url, subscriptions);
      return () => {
        subscriptions.delete(listener);
        if (!subscriptions.size) listeners.delete(url);
      };
    },
    dispose() {
      for (const entry of entries.values()) if (entry.state.src) revokeURL(entry.state.src);
      const urls = [...entries.keys()];
      entries.clear();
      for (const url of urls) notify(url);
    },
  };
}
