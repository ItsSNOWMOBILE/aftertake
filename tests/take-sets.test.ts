import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { takeSeeds, takeSetRequestSchema, type TakeSet } from '../src/take-sets.js';
import { handleRequestError } from '../server/http-errors.js';
import { takeSetRouter } from '../server/take-sets.js';

const image = {
  format: 'aftertake-image/1',
  name: 'Teapot',
  prompt: 'A speckled ceramic teapot on linen.',
  seed: 11,
  aspect: 'square',
  style: 'product',
};

test('takes keep the first seed and step to new ones; only 2–4 takes of known kinds are accepted', () => {
  assert.deepEqual(takeSeeds(11, 3), [11, 11 + 7919, 11 + 2 * 7919]);
  assert.ok(takeSeeds(2 ** 32 - 1, 4).every((seed) => seed >= 0 && seed < 2 ** 32));
  assert.equal(
    takeSetRequestSchema.safeParse({ kind: 'image', count: 3, request: image }).success,
    true,
  );
  for (const count of [1, 5])
    assert.equal(
      takeSetRequestSchema.safeParse({ kind: 'image', count, request: image }).success,
      false,
    );
  assert.equal(
    takeSetRequestSchema.safeParse({ kind: 'song', count: 2, request: image }).success,
    false,
  );
  assert.equal(
    takeSetRequestSchema.safeParse({ kind: 'video', count: 2, request: image }).success,
    false,
    'a video set needs a video request',
  );
});

/** A stand-in Create image route: busy once, then each take succeeds or fails as asked. */
async function fakeStudio(outcomes: string[]) {
  const app = express(),
    posted: { key?: string; seed: number; name: string }[] = [],
    records: { id: string; state: string; error?: string }[] = [];
  let busyOnce = true;
  app.post('/api/images', express.json(), (req, res) => {
    if (busyOnce) {
      busyOnce = false;
      return void res.status(409).json({ error: 'A generation is already active. Try later.' });
    }
    posted.push({ key: req.get('Idempotency-Key'), seed: req.body.seed, name: req.body.name });
    const state = outcomes[records.length] || 'succeeded';
    records.push({
      id: randomUUID(),
      state,
      ...(state === 'failed' ? { error: 'out of memory' } : {}),
    });
    res.status(201).json({ ...records.at(-1), state: 'queued' });
  });
  app.get('/api/images', (_req, res) => res.json(records));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    posted,
    close: () => server.close(),
  };
}

async function takesApp(t: test.TestContext, outcomes: string[] = []) {
  const data = await mkdtemp(path.join(os.tmpdir(), 'aftertake-takes-'));
  const studio = await fakeStudio(outcomes);
  const sets = await takeSetRouter({ data, studio: studio.base });
  const app = express();
  app.use(express.json());
  app.use('/api/take-sets', sets.router);
  app.use(handleRequestError);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    studio.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(data, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/take-sets`;
  const post = async (route: string, body: unknown, key?: string) => {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  async function settle(id: string) {
    for (;;) {
      const set = (await (await fetch(`${base}/${id}`)).json()) as TakeSet;
      if (set.state !== 'running') return set;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return { studio, post, settle };
}

test('a set renders its takes one after another through the studio route, then one is kept', async (t) => {
  const takes = await takesApp(t);
  const started = await takes.post('', { kind: 'image', count: 3, request: image }, 'teapots');
  assert.equal(started.status, 202);
  assert.equal(
    (await takes.post('', { kind: 'image', count: 3, request: image }, 'teapots')).value.id,
    started.value.id,
  );
  const set = await takes.settle(started.value.id);
  assert.equal(set.state, 'ready');
  assert.equal(set.stage, 'Pick the take to keep');
  // It waited out a busy GPU, then sent each take with its own seed, name and key.
  assert.deepEqual(
    takes.studio.posted.map((take) => [take.key, take.seed, take.name]),
    takeSeeds(11, 3).map((seed, index) => [
      `takes-${set.id}-${index}`,
      seed,
      `Teapot · take ${index + 1}`,
    ]),
  );
  const refused = await takes.post(`/${set.id}/keep`, { take: randomUUID() });
  assert.equal(refused.status, 409);
  const kept = await takes.post(`/${set.id}/keep`, { take: set.takes[1].id });
  assert.equal(kept.value.kept, set.takes[1].id);
});

test('a failed take is reported and the others can still be kept; a set with none fails', async (t) => {
  const some = await takesApp(t, ['succeeded', 'failed']);
  const started = await some.post('', { kind: 'image', count: 2, request: image });
  const set = await some.settle(started.value.id);
  assert.equal(set.state, 'ready');
  assert.equal(set.stage, '1 of 2 takes finished');
  assert.equal(set.takes[1].error, 'out of memory');
  assert.equal((await some.post(`/${set.id}/keep`, { take: set.takes[1].id })).status, 409);
  const none = await takesApp(t, ['failed', 'failed']);
  const failed = await none.settle(
    (await none.post('', { kind: 'image', count: 2, request: image })).value.id,
  );
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, 'out of memory');
});
