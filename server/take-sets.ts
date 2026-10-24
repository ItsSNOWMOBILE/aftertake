import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { replaceFile } from './replace-file.js';
import path from 'node:path';
import { z } from 'zod';
import {
  takeSeeds,
  takeSetBusy,
  takeSetRequestSchema,
  takeSetRoutes,
  type TakeSet,
} from '../src/take-sets.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { RequestError } from './http-errors.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const finished = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
// The studio runs one generation at a time; these refusals mean "wait your turn".
const gpuTaken = /already active|already being submitted|another generation|is active/i;
type Generation = {
  id: string;
  state: string;
  stage?: string;
  progress?: number | null;
  error?: string;
};

/**
 * Take sets render one request 2–4 times with different seeds, one after another,
 * through the studio's own Create image, Create video or Animate a frame route, so
 * each take is an ordinary record there, with recovery and Cloud routing intact.
 */
export async function takeSetRouter(context: { data: string; studio: string }) {
  const router = Router(),
    folder = path.join(context.data, 'take-sets');
  await mkdir(folder, { recursive: true });
  const sets = new Map<string, TakeSet>(),
    driving = new Set<string>(),
    cancels = new Set<string>();

  async function persist(set: TakeSet) {
    set.updatedAt = new Date().toISOString();
    const target = path.join(folder, `${set.id}.json`),
      temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(set, null, 2));
      await replaceFile(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function call<T>(route: string, body?: unknown, key?: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(context.studio + route, {
          method: body === undefined ? 'GET' : 'POST',
          headers:
            body === undefined
              ? undefined
              : { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        });
        return { status: response.status, value: (await response.json()) as T };
      } catch (error) {
        // The studio answers its own calls; while it restarts, wait instead of failing.
        if (attempt >= 20) throw error;
        await pause(3000);
      }
    }
  }
  const failure = (value: unknown, fallback: string) =>
    (value as { error?: string })?.error || fallback;
  async function read(set: TakeSet, id: string) {
    const route = takeSetRoutes[set.kind];
    if (set.kind === 'frame') return (await call<Generation>(`${route}/${id}`)).value;
    return (await call<Generation[]>(route)).value.find((item) => item.id === id);
  }

  async function renderTake(set: TakeSet, index: number) {
    const take = set.takes[index],
      label = `Take ${index + 1} of ${set.count}`;
    if (!take.id) {
      const name = `${set.request.name} · take ${index + 1}`.slice(0, 100);
      for (;;) {
        if (cancels.has(set.id)) return false;
        const started = await call<Generation>(
          takeSetRoutes[set.kind],
          { ...set.request, name, seed: take.seed },
          `takes-${set.id}-${index}`,
        );
        if (started.status === 409 && gpuTaken.test(failure(started.value, ''))) {
          set.stage = `${label} · waiting for the GPU`;
          await persist(set);
          await pause(4000);
          continue;
        }
        if (started.status >= 300) {
          take.state = 'failed';
          take.error = failure(started.value, `${label} could not start.`);
          await persist(set);
          return true;
        }
        take.id = started.value.id;
        await persist(set);
        break;
      }
    }
    for (;;) {
      const record = await read(set, take.id!);
      if (!record) throw Error(`${label} is missing from its studio.`);
      take.state = record.state;
      if (finished.has(record.state)) {
        if (record.state !== 'succeeded') take.error = record.error || record.state;
        await persist(set);
        return true;
      }
      if (cancels.has(set.id)) {
        await call(`${takeSetRoutes[set.kind]}/${take.id}/cancel`, {}).catch(() => undefined);
        return false;
      }
      set.stage = `${label} · ${record.stage || 'rendering on your GPU'}`;
      await persist(set);
      await pause(2500);
    }
  }

  async function drive(set: TakeSet) {
    if (driving.has(set.id)) return;
    driving.add(set.id);
    try {
      for (let index = 0; index < set.count; index++)
        if (!(await renderTake(set, index))) {
          set.state = 'canceled';
          set.stage = 'Canceled';
          return await persist(set);
        }
      const made = set.takes.filter((take) => take.state === 'succeeded').length;
      set.state = made ? 'ready' : 'failed';
      set.stage =
        made === set.count ? 'Pick the take to keep' : `${made} of ${set.count} takes finished`;
      if (!made) set.error = set.takes.find((take) => take.error)?.error || 'No take finished.';
      await persist(set);
    } catch (error) {
      set.state = 'failed';
      set.error = error instanceof Error ? error.message : String(error);
      set.stage = 'Failed';
      await persist(set).catch(() => {});
    } finally {
      driving.delete(set.id);
    }
  }

  for (const name of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const set = JSON.parse(await readFile(path.join(folder, name), 'utf8')) as TakeSet;
      sets.set(set.id, set);
    } catch (error) {
      console.error('Could not read a saved take set:', name, error);
    }
  }

  router.get('/', (_req, res) => {
    res.json([...sets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.get('/:id', (req, res) => {
    const set = sets.get(req.params.id);
    if (!set) return void res.status(404).json({ error: 'Take set not found.' });
    res.json(set);
  });
  router.post('/', async (req, res) => {
    const input = takeSetRequestSchema.parse(req.body),
      admission = generationAdmission(req.get('Idempotency-Key'), input, sets.values());
    if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
    if (admission.existing) return void res.json(admission.existing);
    const now = new Date().toISOString();
    const set: TakeSet = {
      id: randomUUID(),
      ...admission.identity,
      kind: input.kind,
      count: input.count,
      request: input.request,
      takes: takeSeeds(input.request.seed, input.count).map((seed) => ({ seed })),
      state: 'running',
      stage: 'Starting',
      createdAt: now,
      updatedAt: now,
    };
    await persist(set);
    sets.set(set.id, set);
    void drive(set);
    res.status(202).json(set);
  });
  router.post('/:id/keep', async (req, res) => {
    const { take } = z.object({ take: z.string().uuid() }).strict().parse(req.body);
    const set = sets.get(req.params.id);
    if (!set) throw new RequestError('Take set not found.', 404);
    const chosen = set.takes.find((item) => item.id === take);
    if (!chosen || chosen.state !== 'succeeded')
      throw new RequestError('Keep one of this set’s finished takes.', 409);
    set.kept = take;
    await persist(set);
    res.json(set);
  });
  router.post('/:id/cancel', async (req, res) => {
    const set = sets.get(req.params.id);
    if (!set || !takeSetBusy(set)) throw new RequestError('No running take set to cancel.', 409);
    cancels.add(set.id);
    if (!driving.has(set.id)) {
      set.state = 'canceled';
      set.stage = 'Canceled';
      await persist(set);
    }
    res.json(set);
  });
  return {
    router,
    busy: () => [...sets.values()].some(takeSetBusy),
    /** Call once the studio listens: unfinished sets continue in the order they started. */
    resume() {
      for (const set of [...sets.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        if (takeSetBusy(set)) void drive(set);
    },
  };
}
