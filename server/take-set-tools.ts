import { z } from 'zod';
import { takeSetRequestSchema, takeSetRoutes, type TakeSet } from '../src/take-sets.js';

type Register = (
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: any) => Promise<{ data: unknown }>,
  readOnly?: boolean,
) => void;
const requestId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);

/** Takes for agents: render one request several times, compare, keep one. */
export function registerTakeSetTools({
  tool,
  api,
  base,
}: {
  tool: Register;
  api: <T = any>(route: string, body?: unknown, key?: string) => Promise<T>;
  base: string;
}) {
  const summary = (set: TakeSet) => ({
    id: set.id,
    kind: set.kind,
    state: set.state,
    stage: set.stage,
    error: set.error,
    requestKey: set.requestKey,
    kept: set.kept,
    takes: set.takes.map((take) => ({
      seed: take.seed,
      id: take.id,
      state: take.state,
      error: take.error,
      record: take.id
        ? `${base}${takeSetRoutes[set.kind]}${set.kind === 'frame' ? `/${take.id}` : ''}`
        : undefined,
    })),
  });
  tool(
    'aftertake_make_takes',
    'Render one Create image, Create video or Animate a frame request 2–4 times with different seeds, one after another, to compare and keep one. The first take keeps the request seed. Each take is an ordinary record in its studio. Starts one render per take; a stable requestId rejoins the same set.',
    z.object({ requestId, request: takeSetRequestSchema }),
    async (input) => ({
      data: summary(await api<TakeSet>('/api/take-sets', input.request, input.requestId)),
    }),
    false,
  );
  tool(
    'aftertake_takes_status',
    'Read a set of takes by record ID or stable requestId: each take’s seed, studio record ID and state, and which one was kept. Inspect finished takes with aftertake_inspect_picture before keeping one.',
    z
      .object({ id: z.string().uuid().optional(), requestId: requestId.optional() })
      .refine(
        (value) => Boolean(value.id) !== Boolean(value.requestId),
        'Choose exactly one ID or requestId.',
      ),
    async (input) => {
      const set = input.id
        ? await api<TakeSet>(`/api/take-sets/${input.id}`)
        : (await api<TakeSet[]>('/api/take-sets')).find(
            (item) => item.requestKey === input.requestId,
          );
      if (!set) throw Error('No set of takes matches this request.');
      return { data: summary(set) };
    },
  );
  tool(
    'aftertake_keep_take',
    'Keep one finished take of a set as the result. The other takes stay in their studio’s history; nothing is deleted or rendered.',
    z.object({ id: z.string().uuid(), take: z.string().uuid() }),
    async (input) => ({
      data: summary(await api<TakeSet>(`/api/take-sets/${input.id}/keep`, { take: input.take })),
    }),
    false,
  );
}
