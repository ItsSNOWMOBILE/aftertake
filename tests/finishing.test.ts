import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { finishingRouter, finishingWorker, type FinishingWorker } from '../server/finishing.js';
import { handleRequestError } from '../server/http-errors.js';
import { generationAdmission } from '../server/generation-admission.js';
import {
  defaultFinishingSettings,
  finishingBusy,
  finishingIsIdentity,
  finishingRecipeSchema,
  finishingRequestSchema,
  type FinishingJob,
  type FinishingRequest,
} from '../src/finishing.js';
import type { Clip } from '../src/domain.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const baseClip: Clip = {
  id: '2ed5c6f3-7ba6-47a6-b4ec-afbcc4a4aa4f',
  name: 'Picture',
  sha256: hash(png),
  url: '/media/2ed5c6f3-7ba6-47a6-b4ec-afbcc4a4aa4f.png',
  width: 1,
  height: 1,
  duration: 1,
  kind: 'image',
  hasAudio: false,
};
const request: FinishingRequest = {
  format: 'aftertake-finishing/1',
  name: 'Finished picture',
  clip: baseClip,
  settings: { ...defaultFinishingSettings },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function fixture(
  options: {
    worker?: FinishingWorker;
    initialJob?: FinishingJob;
    initialPartial?: boolean;
  } = {},
) {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-finishing-'));
  const clips = path.join(data, 'clips');
  await mkdir(clips);
  await writeFile(path.join(clips, `${baseClip.id}.png`), png);
  await writeFile(path.join(clips, `${baseClip.id}.json`), JSON.stringify(baseClip));
  if (options.initialJob) {
    await mkdir(path.join(data, 'finishing'));
    await writeFile(
      path.join(data, 'finishing', `${options.initialJob.id}.json`),
      JSON.stringify(options.initialJob),
    );
    if (options.initialPartial) {
      const id = options.initialJob.id;
      await writeFile(path.join(clips, `${id}.png`), png);
      await writeFile(
        path.join(clips, `${id}.json`),
        JSON.stringify({
          ...baseClip,
          id,
          originalSha256: baseClip.sha256,
          url: `/media/${id}.png`,
        }),
      );
    }
  }
  const calls: { mode: string; request: FinishingRequest; time?: number }[] = [];
  const worker: FinishingWorker =
    options.worker ||
    (async (args) => {
      if (args.at(-1) === '--check') return;
      const work = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
      calls.push(work);
      await writeFile(work.output, png);
      await writeFile(
        work.receipt,
        JSON.stringify({
          processor: 'aftertake-cpu-finishing/1',
          sourceSha256: hash(png),
          outputSha256: hash(png),
          width: 1,
          height: 1,
          kind: 'image',
          duration: 1,
          hasAudio: false,
          identity: finishingIsIdentity(work.request.settings),
        }),
      );
    });
  const app = express();
  app.use(express.json());
  const backend = await finishingRouter({ root: process.cwd(), data, python: 'not-used', worker });
  app.use('/api/finishing', backend.router);
  app.use(handleRequestError);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/finishing`;
  async function post(route: string, body: unknown, key?: string) {
    return fetch(`${url}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key === undefined ? {} : { 'Idempotency-Key': key }),
      },
      body: JSON.stringify(body),
    });
  }
  return {
    data,
    clips,
    url,
    post,
    calls,
    ...backend,
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
      assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
      assert.match(path.basename(data), /^aftertake-finishing-/);
      await rm(data, { recursive: true, force: true });
    },
  };
}

async function terminal(url: string, id: string, state = 'succeeded') {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await (await fetch(`${url}/${id}`)).json()) as FinishingJob;
    if (job.state === state) return job;
    if (!finishingBusy(job)) assert.fail(`Expected ${state}, got ${job.state}: ${job.error}`);
    await delay(10);
  }
  assert.fail(`Finishing did not reach ${state}.`);
}

test('finishing controls are bounded, complete and default to a true bypass', () => {
  assert(finishingIsIdentity(defaultFinishingSettings));
  assert(finishingIsIdentity({ ...defaultFinishingSettings, preset: 'vintage', lookStrength: 0 }));
  assert(
    !finishingIsIdentity({ ...defaultFinishingSettings, preset: 'vintage', lookStrength: 0.1 }),
  );
  assert(!finishingIsIdentity({ ...defaultFinishingSettings, exposureEV: 0.01 }));
  for (const [name, value] of [
    ['exposureEV', 4],
    ['contrast', -2],
    ['grain', 2],
    ['seed', 2 ** 32],
    ['saturation', Infinity],
    ['temperature', NaN],
    ['sharpen', -0.1],
  ] as const)
    assert(
      !finishingRequestSchema.safeParse({
        ...request,
        settings: { ...defaultFinishingSettings, [name]: value },
      }).success,
    );
  assert(
    !finishingRequestSchema.safeParse({
      ...request,
      settings: { ...defaultFinishingSettings, lutPath: '/private' },
    }).success,
  );
});

test('successful finish is a normal saved Clip with a hash-bound portable recipe', async () => {
  const f = await fixture();
  try {
    const response = await f.post('', request, 'finish-1');
    assert.equal(response.status, 202);
    const admitted = (await response.json()) as FinishingJob;
    const job = await terminal(f.url, admitted.id);
    assert.equal(job.clip?.sha256, baseClip.sha256);
    assert.equal(job.clip?.originalSha256, baseClip.sha256);
    assert.equal(job.clip?.hasAudio, false);
    assert.equal(job.identity, true);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(f.clips, `${job.id}.json`), 'utf8')),
      job.clip,
    );
    const exported = finishingRecipeSchema.parse(
      await (await fetch(`${f.url}/${job.id}/recipe`)).json(),
    );
    assert.equal(exported.sourceSha256, baseClip.sha256);
    assert.equal(exported.outputSha256, baseClip.sha256);
    assert(!JSON.stringify(exported).includes(f.data));
    const imported = await f.post('/import-recipe', {
      ...exported,
      request: {
        ...exported.request,
        clip: { ...baseClip, id: randomUUID(), url: '/media/unavailable.png' },
      },
    });
    assert.equal(imported.status, 200);
    const reboundSource = (await imported.json()).request.clip;
    assert.equal(reboundSource.sha256, baseClip.sha256);
    assert([baseClip.id, job.id].includes(reboundSource.id));
    assert.equal(f.calls.length, 1);
    const rebound = {
      ...request,
      clip: { ...baseClip, id: randomUUID(), url: '/media/another-local-id.png' },
    };
    const replay = await f.post('', rebound, 'finish-1');
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).id, job.id);
    const conflict = await f.post(
      '',
      { ...request, settings: { ...request.settings, exposureEV: 1 } },
      'finish-1',
    );
    assert.equal(conflict.status, 409);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});

test('concurrent same-key admission joins one durable operation', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([f.post('', request, 'same'), f.post('', request, 'same')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 202]);
    const [a, b] = await Promise.all(results.map((r) => r.json()));
    assert.equal(a.id, b.id);
    await terminal(f.url, a.id);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});

test('exact preview is transient, preserves request settings and rejects outside source range', async () => {
  const f = await fixture();
  try {
    const req = { ...request, settings: { ...request.settings, grain: 0.4, seed: 17 } };
    const response = await f.post('/preview', { request: req, time: 0 });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /image\/png/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.deepEqual(f.calls[0].request, req);
    assert.equal(f.calls[0].mode, 'preview');
    assert.deepEqual(await (await fetch(f.url)).json(), []);
    assert.deepEqual(await readdir(path.join(f.data, 'finishing')), []);
    for (const time of [-1, 0.2, 1])
      assert.equal((await f.post('/preview', { request: req, time })).status, 400);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});

test('cancel remains busy and durable until the worker has actually closed', async () => {
  const started = deferred(),
    closed = deferred();
  const f = await fixture({
    worker: async (args, options) => {
      if (args.at(-1) === '--check') return;
      started.resolve();
      await closed.promise;
      assert(options.signal?.aborted);
      throw new Error('Private worker cancellation error C:\\secret\\source.mp4');
    },
  });
  try {
    const response = await f.post('', request);
    const job = (await response.json()) as FinishingJob;
    await started.promise;
    const canceled = await f.post(`/${job.id}/cancel`, {});
    assert.equal(canceled.status, 202);
    assert.equal((await canceled.json()).state, 'canceling');
    assert.equal(
      JSON.parse(await readFile(path.join(f.data, 'finishing', `${job.id}.json`), 'utf8')).state,
      'canceling',
    );
    assert(f.busy());
    assert.equal((await f.post('', request)).status, 409);
    assert.equal((await f.post('/preview', { request, time: 0 })).status, 409);
    closed.resolve();
    const terminalJob = await terminal(f.url, job.id, 'canceled');
    assert(!terminalJob.clip);
    assert(!JSON.stringify(terminalJob).includes('secret'));
    for (let attempt = 0; f.busy() && attempt < 100; attempt++) await delay(5);
    assert(!f.busy());
    assert.deepEqual(
      (await readdir(f.clips)).sort(),
      [`${baseClip.id}.json`, `${baseClip.id}.png`].sort(),
    );
  } finally {
    closed.resolve();
    await f.close();
  }
});

test('restart marks unfinished work interrupted instead of silently repeating it', async () => {
  const identity = generationAdmission(
    'interrupted-key',
    {
      name: request.name,
      sourceSha256: baseClip.sha256,
      settings: request.settings,
      format: request.format,
    },
    [],
  );
  const old: FinishingJob = {
    id: randomUUID(),
    request,
    sourceSha256: baseClip.sha256,
    state: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...identity.identity,
  };
  const f = await fixture({ initialJob: old, initialPartial: true });
  try {
    const replay = await f.post('', request, 'interrupted-key');
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).state, 'interrupted');
    assert.equal(f.calls.length, 0);
    assert(!f.busy());
    assert.deepEqual(
      (await readdir(f.clips)).sort(),
      [`${baseClip.id}.json`, `${baseClip.id}.png`].sort(),
    );
    assert.equal(
      JSON.parse(await readFile(path.join(f.data, 'finishing', `${old.id}.json`), 'utf8')).state,
      'interrupted',
    );
  } finally {
    await f.close();
  }
});

test('an output with a wrong source receipt never enters the shared clip library', async () => {
  const f = await fixture({
    worker: async (args) => {
      if (args.at(-1) === '--check') return;
      const work = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
      await writeFile(work.output, png);
      await writeFile(
        work.receipt,
        JSON.stringify({
          processor: 'aftertake-cpu-finishing/1',
          sourceSha256: '0'.repeat(64),
          outputSha256: hash(png),
          width: 1,
          height: 1,
          kind: 'image',
          duration: 1,
          hasAudio: false,
          identity: true,
        }),
      );
    },
  });
  try {
    const admitted = (await (await f.post('', request)).json()) as FinishingJob;
    const job = await terminal(f.url, admitted.id, 'failed');
    assert(!job.clip);
    assert.deepEqual(
      (await readdir(f.clips)).sort(),
      [`${baseClip.id}.json`, `${baseClip.id}.png`].sort(),
    );
    assert(!JSON.stringify(job).includes(f.data));
  } finally {
    await f.close();
  }
});

test('missing dependencies and changed media fail before admission without internal path leakage', async () => {
  const f = await fixture({
    worker: async () => {
      throw Error('C:\\private\\python.exe missing');
    },
  });
  try {
    const blocked = await f.post('', request);
    assert.equal(blocked.status, 503);
    assert.match((await blocked.json()).error, /setup/);
    assert.deepEqual(await (await fetch(f.url)).json(), []);
    await writeFile(path.join(f.clips, `${baseClip.id}.png`), 'changed');
    const changed = await f.post('', request);
    assert.equal(changed.status, 409);
    const body = await changed.text();
    assert(!body.includes('private'));
    assert(!body.includes(f.data));
    assert.equal((await f.post('', request, 'invalid key')).status, 400);
    assert.equal((await fetch(`${f.url}/${randomUUID()}`)).status, 404);
  } finally {
    await f.close();
  }
});

test('real subprocess runner waits for close on cancellation and sanitizes failures', async () => {
  const worker = finishingWorker(process.execPath);
  await worker(['-e', 'process.exit(0)'], { timeout: 1000 });
  await assert.rejects(
    worker(['-e', 'throw Error("C:/private/source")'], { timeout: 1000 }),
    (error: Error) => !error.message.includes('private'),
  );
  const controller = new AbortController();
  const running = worker(['-e', 'setInterval(() => {}, 1000)'], {
    signal: controller.signal,
    timeout: 3000,
  });
  controller.abort();
  await assert.rejects(running, /did not complete/);
});
