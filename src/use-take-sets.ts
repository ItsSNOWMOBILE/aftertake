import { useEffect, useState } from 'react';
import { takeSetBusy, type TakeSet, type TakeSetKind, type TakeSetRequest } from './take-sets';
import { apiFetch, browserDemo } from './transport';

async function call<T>(url: string, body?: unknown, key?: string): Promise<T> {
  const response = await apiFetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || 'The takes request failed.');
  return value;
}

// Sets started in this browser tab, so a reload keeps showing the comparison it made.
const startedKey = 'aftertake-started-take-sets';
function startedHere(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(startedKey) || '[]');
  } catch {
    return [];
  }
}
function remember(id: string) {
  try {
    sessionStorage.setItem(startedKey, JSON.stringify([id, ...startedHere()].slice(0, 20)));
  } catch {
    // Without storage the comparison still shows until the tab reloads.
  }
}

/** A studio's sets of takes: the newest first, refreshed while any is rendering. */
export function useTakeSets(kind: TakeSetKind) {
  const [sets, setSets] = useState<TakeSet[]>([]);
  const [mine, setMine] = useState(startedHere);
  const running = sets.some(takeSetBusy);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      call<TakeSet[]>('/api/take-sets')
        .then((all) => live && setSets(all.filter((set) => set.kind === kind)))
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, running ? 2000 : 8000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [kind, running]);
  const replace = (set: TakeSet) =>
    setSets((all) => [set, ...all.filter((item) => item.id !== set.id)]);
  return {
    sets,
    /**
     * The newest set while it renders, or while one started here still needs a keeper.
     * Recorded examples and sets from another visit stay closed, so the studio opens clean.
     */
    open:
      sets[0] &&
      (takeSetBusy(sets[0]) ||
        (mine.includes(sets[0].id) && !sets[0].kept && sets[0].state === 'ready'))
        ? sets[0]
        : undefined,
    running,
    async start(count: number, request: TakeSetRequest['request']) {
      if (browserDemo) throw Error('Render takes in the local studio.');
      const set = await call<TakeSet>(
        '/api/take-sets',
        { kind, count, request } as TakeSetRequest,
        crypto.randomUUID(),
      );
      remember(set.id);
      setMine(startedHere());
      replace(set);
      return set;
    },
    async keep(set: TakeSet, take: string) {
      const kept = await call<TakeSet>(`/api/take-sets/${set.id}/keep`, { take });
      replace(kept);
      return kept;
    },
    async cancel(set: TakeSet) {
      replace(await call<TakeSet>(`/api/take-sets/${set.id}/cancel`, {}));
    },
  };
}
