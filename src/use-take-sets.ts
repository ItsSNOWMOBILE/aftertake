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

/** A studio's sets of takes: the newest first, refreshed while any is rendering. */
export function useTakeSets(kind: TakeSetKind) {
  const [sets, setSets] = useState<TakeSet[]>([]);
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
    /** The newest set, while it renders or still needs a keeper; older sets stay closed. */
    open:
      sets[0] && !sets[0].kept && sets[0].state !== 'canceled' && sets[0].state !== 'failed'
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
