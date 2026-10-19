import { useEffect, useState } from 'react';
import { preparePreview, previewSource, subscribePreview } from './transport';

export function useMediaSource(url?: string) {
  const [observed, setObserved] = useState(() => ({ url, value: previewSource(url) }));
  const source = observed.url === url ? observed.value : previewSource(url);
  useEffect(() => {
    const update = () => setObserved({ url, value: previewSource(url) });
    const unsubscribe = subscribePreview(url, update);
    update();
    if (url) void preparePreview(url).catch(() => {});
    return unsubscribe;
  }, [url]);
  return {
    ...source,
    retry: () => void preparePreview(url, true).catch(() => {}),
  };
}
