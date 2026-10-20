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
import { recompositionRouter, type RecompositionWorker } from '../server/recompositions.js';
import { handleRequestError } from '../server/http-errors.js';
import { contentDigest } from '../server/edit-plan.js';
import { templateRouter } from '../server/templates.js';
import { inspectVideoMetadata } from '../server/video-metadata.js';
import { displayDimensions, renderDimensions, type Recipe, type Render } from '../src/domain.js';
import {
  recompositionBusy,
  recompositionJobSchema,
  recompositionProvenanceSchema,
  recompositionReceiptSchema,
  recompositionRecipe,
  recompositionRequestSchema,
  sameRecompositionGeneration,
  type RecompositionJob,
  type RecompositionReceipt,
} from '../src/recomposition.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = Buffer.from('registered source bytes'),
  outputBytes = Buffer.from('new CPU blended MP4 bytes');
const sourceId = '9caa601d-9aa4-4fef-b50c-617ac2688fd4';
const parentId = 'e8292acb-1be8-45ed-87a4-99ebfcb792a2';
const recipe: Recipe = {
  format: 'aftertake/1',
  name: 'Regional edit',
  clip: {
    id: sourceId,
    name: 'Original',
    sha256: hash(sourceBytes),
    width: 640,
    height: 360,
    duration: 4.2,
    url: `/media/${sourceId}.mp4`,
    kind: 'video',
    hasAudio: true,
  },
  prompt: 'Warm golden waterfall in the painted region',
  cue: {
    start: 0,
    end: 4,
    fade: 0.2,
    feather: 0.02,
    tracking: 'static',
    strokes: [{ points: [{ x: 0.4, y: 0.5 }], radius: 0.15 }],
  },
  seed: 42,
  quality: 'final',
  trimStart: 0,
  pipeline: 'structure',
  matchSourceColor: false,
};
const workflow = {
  '8': { class_type: 'AftertakeLoadClip', inputs: { filename: `${sourceId}.mp4` } },
};
const request = {
  renderId: parentId,
  compositeRegion: {
    feather: 0.04,
    tracking: 'flow' as const,
    strokes: [{ points: [{ x: 0.45, y: 0.5 }], radius: 0.1 }],
  },
  matchSourceColor: true,
};

function box(type: string, bytes: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(bytes.length + 8);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, bytes]);
}
function rawVideo(original: Recipe = recipe, graph: Record<string, unknown> = workflow) {
  const flags = Buffer.alloc(8);
  flags.writeUInt32BE(1);
  const metadata = box(
    '©cmt',
    box(
      'data',
      Buffer.concat([flags, Buffer.from(JSON.stringify({ recipe: original, workflow: graph }))]),
    ),
  );
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000')),
    box('mdat', Buffer.from('raw generated frame bytes')),
    box('moov', box('udta', box('meta', Buffer.concat([Buffer.alloc(4), box('ilst', metadata)])))),
  ]);
}
const rawBytes = rawVideo();
function parent(): Render {
  return {
    id: parentId,
    recipe: structuredClone(recipe),
    state: 'succeeded',
    progress: 1,
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    output: `/outputs/${parentId}.mp4`,
    rawOutput: `/outputs/${parentId}-raw.mp4`,
    workflow: structuredClone(workflow),
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function receipt(work: any): RecompositionReceipt {
  return {
    format: 'aftertake-cpu-recomposition/1',
    processor: 'aftertake-cpu-recomposition/1',
    sourceSha256: work.expected.sourceSha256,
    rawSha256: work.expected.rawSha256,
    outputSha256: hash(outputBytes),
    width: work.dimensions.displayWidth,
    height: work.dimensions.displayHeight,
    frames: work.dimensions.frames,
    fps: work.dimensions.fps,
    duration: work.dimensions.frames / work.dimensions.fps,
    hasAudio: work.newRecipe.clip.hasAudio ?? false,
    originalRecipe: work.originalRecipe,
    newRecipe: work.newRecipe,
    originalGenerationWorkflow: work.originalGenerationWorkflow,
    compositionPolicy: 'aftertake-native-final-composite/1',
    stages: [
      'source-clock-sampling',
      'display-grid-final-mask',
      'boundary-color-match',
      'source-audio-mux',
    ],
    allProtectedPixelsExactBeforeEncoding: true,
    protectedPixelsReference: 'display-grid-source',
    noModelInvocation: true,
    noComfyGraphExecution: true,
  };
}
async function writeResult(work: any, patch: Partial<RecompositionReceipt> = {}) {
  await writeFile(work.output, outputBytes);
  await writeFile(work.receipt, JSON.stringify({ ...receipt(work), ...patch }));
}

async function fixture(
  options: {
    worker?: RecompositionWorker;
    before?: (data: string, renders: Map<string, Render>) => Promise<void>;
    python?: string | (() => Promise<string>);
    resolveClipAsset?: (clip: Recipe['clip']) => Promise<Recipe['clip']>;
    onRender?: (render: Render) => void | Promise<void>;
    templates?: boolean;
  } = {},
) {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-recomposition-'));
  for (const name of ['clips', 'outputs', 'renders', 'recompositions', 'previews'])
    await mkdir(path.join(data, name));
  await writeFile(path.join(data, 'clips', `${sourceId}.mp4`), sourceBytes);
  await writeFile(path.join(data, 'clips', `${sourceId}.json`), JSON.stringify(recipe.clip));
  await writeFile(path.join(data, 'outputs', `${parentId}-raw.mp4`), rawBytes);
  await writeFile(
    path.join(data, 'outputs', `${parentId}.mp4`),
    Buffer.from('original final take'),
  );
  const renders = new Map([[parentId, parent()]]);
  await writeFile(
    path.join(data, 'renders', `${parentId}.json`),
    JSON.stringify(renders.get(parentId)),
  );
  await options.before?.(data, renders);
  const calls: any[] = [],
    notifications: Render[] = [];
  const worker: RecompositionWorker =
    options.worker ||
    (async (args) => {
      if (args.at(-1) === '--check') return;
      const work = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
      calls.push(work);
      await writeResult(work);
    });
  const app = express();
  app.use(express.json());
  if (options.templates)
    app.use('/api/templates', await templateRouter(process.cwd(), data, renders));
  const backend = await recompositionRouter({
    root: process.cwd(),
    data,
    python: options.python || 'not-used',
    renders,
    worker,
    resolveClipAsset: options.resolveClipAsset,
    onRender: async (render) => {
      notifications.push(render);
      await options.onRender?.(render);
    },
  });
  app.use('/api/recompositions', backend.router);
  app.use(handleRequestError);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/recompositions`;
  return {
    data,
    renders,
    calls,
    notifications,
    url,
    ...backend,
    post(route: string, body: unknown, key?: string) {
      return fetch(`${url}${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key === undefined ? {} : { 'Idempotency-Key': key }),
        },
        body: JSON.stringify(body),
      });
    },
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
      assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
      assert.match(path.basename(data), /^aftertake-recomposition-/);
      await rm(data, { recursive: true, force: true });
    },
  };
}
async function terminal(url: string, id: string, state: RecompositionJob['state'] = 'succeeded') {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await fetch(`${url}/${id}`),
      job = (await response.json()) as RecompositionJob;
    assert.equal(response.status, 200);
    if (!recompositionBusy(job)) {
      assert.equal(job.state, state, job.error || `Expected ${state}.`);
      return job;
    }
    await delay(10);
  }
  assert.fail(`CPU blend did not reach ${state}.`);
}

test('CPU blend schema only admits final spatial/color controls and preserves generation settings', () => {
  assert(recompositionRequestSchema.safeParse(request).success);
  for (const patch of [
    { path: 'C:/private/source.mp4' },
    { prompt: 'replace generation prompt' },
    { matchSourceColor: 'true' },
    { compositeRegion: { ...request.compositeRegion, strokes: [] } },
    { compositeRegion: { ...request.compositeRegion, end: 3 } },
  ])
    assert(!recompositionRequestSchema.safeParse({ ...request, ...patch }).success);
  const next = recompositionRecipe(recipe, request);
  assert.deepEqual(next.cue, recipe.cue);
  assert.equal(next.seed, recipe.seed);
  assert.equal(next.prompt, recipe.prompt);
  assert.deepEqual(next.clip, recipe.clip);
  assert(sameRecompositionGeneration(recipe, next));
  assert(!sameRecompositionGeneration(recipe, { ...next, seed: 9 }));
  assert.throws(() => recompositionRecipe({ ...recipe, pipeline: 'cinema' }, request));
  assert.equal(
    recompositionRecipe(next, { renderId: parentId, matchSourceColor: false }).compositeRegion,
    undefined,
  );
  const appearance = { ...recipe.clip, id: randomUUID(), kind: 'image' as const, duration: 1 },
    masked: Recipe = { ...recipe, pipeline: 'inpaint', editReference: appearance },
    rebound: Recipe = {
      ...masked,
      clip: {
        ...masked.clip,
        id: randomUUID(),
        url: '/media/rebound.mp4',
        name: 'Local source label',
      },
      editReference: {
        ...appearance,
        id: randomUUID(),
        url: '/media/rebound.png',
        name: 'Local reference label',
      },
    };
  assert(sameRecompositionGeneration(masked, rebound));
  for (const clip of [
    { ...rebound.clip, sha256: 'b'.repeat(64) },
    { ...rebound.clip, width: rebound.clip.width + 32 },
    { ...rebound.clip, duration: rebound.clip.duration + 0.1 },
  ])
    assert(!sameRecompositionGeneration(masked, { ...rebound, clip }));
  assert(
    !sameRecompositionGeneration(masked, {
      ...rebound,
      editReference: { ...rebound.editReference!, sha256: 'b'.repeat(64) },
    }),
  );
});

test('CPU blend creates a new hash-bound take, preserving original bytes, clock, graph and generation recipe', async () => {
  const f = await fixture();
  try {
    const old = structuredClone(f.renders.get(parentId)),
      response = await f.post('', request, 'blend-one');
    assert.equal(response.status, 202);
    const accepted = (await response.json()) as RecompositionJob,
      job = await terminal(f.url, accepted.id);
    assert.equal(job.renderId, job.id);
    assert.notEqual(job.id, parentId);
    assert.deepEqual(f.renders.get(parentId), old);
    assert.deepEqual(await readFile(path.join(f.data, 'outputs', `${parentId}-raw.mp4`)), rawBytes);
    assert.deepEqual(await readFile(path.join(f.data, 'clips', `${sourceId}.mp4`)), sourceBytes);
    assert.equal(
      (await readFile(path.join(f.data, 'outputs', `${parentId}.mp4`))).toString(),
      'original final take',
    );
    const saved = f.renders.get(job.id)!;
    assert.equal(saved.workflow, undefined);
    assert.equal(saved.jobId, undefined);
    assert.equal(saved.rawOutput, old!.rawOutput);
    assert.equal(saved.recipe.matchSourceColor, true);
    assert.deepEqual(saved.recipe.compositeRegion, request.compositeRegion);
    const provenance = recompositionProvenanceSchema.parse(saved.recomposition);
    assert.deepEqual(provenance.originalRecipe, recipe);
    assert.deepEqual(provenance.originalGenerationWorkflow, workflow);
    assert.equal(provenance.rawSha256, hash(rawBytes));
    assert.equal(
      provenance.receipt.outputSha256,
      hash(await readFile(path.join(f.data, 'outputs', `${job.id}.mp4`))),
    );
    assert.equal(provenance.receipt.noComfyGraphExecution, true);
    assert.equal(provenance.receipt.noModelInvocation, true);
    assert.equal(f.calls.length, 1);
    const { duration: _duration, ...working } = renderDimensions(recipe);
    assert.deepEqual(f.calls[0].dimensions, {
      ...working,
      displayWidth: displayDimensions(recipe).width,
      displayHeight: displayDimensions(recipe).height,
    });
    assert.equal(f.calls[0].format, 'aftertake-recompose-work/1');
    assert.equal(f.notifications.length, 1);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(f.data, 'renders', `${job.id}.json`), 'utf8')),
      saved,
    );
    assert.equal((await fetch(`${f.url}/${job.id}/status`)).status, 200);
  } finally {
    await f.close();
  }
});

test('same-key recovery survives lost responses, conflicts reject changes and no POST is resubmitted to a model', async () => {
  const f = await fixture();
  try {
    const first = await f.post('', request, 'stable-key'),
      job = (await first.json()) as RecompositionJob;
    await terminal(f.url, job.id);
    const replay = await f.post('', request, 'stable-key');
    assert.equal(replay.status, 200);
    assert.equal(((await replay.json()) as RecompositionJob).id, job.id);
    const recovered = (await (
      await fetch(`${f.url}/by-key/stable-key`)
    ).json()) as RecompositionJob;
    assert.equal(recovered.id, job.id);
    assert.equal(recovered.requestKey, 'stable-key');
    assert.equal(
      (await f.post('', { ...request, matchSourceColor: false }, 'stable-key')).status,
      409,
    );
    assert.equal((await fetch(`${f.url}/by-key/unknown`)).status, 404);
    assert.equal((await f.post('', request, 'invalid key')).status, 400);
    assert.equal(f.calls.length, 1);
    assert.equal(((await (await fetch(f.url)).json()) as RecompositionJob[]).length, 1);
  } finally {
    await f.close();
  }
});

test('CPU refinements retain the earliest raw generation and can reset back to the generation region', async () => {
  const f = await fixture();
  try {
    const first = (await (await f.post('', request, 'first')).json()) as RecompositionJob;
    await terminal(f.url, first.id);
    const second = await f.post('', { renderId: first.id, matchSourceColor: false }, 'second');
    assert.equal(second.status, 202);
    const done = await terminal(f.url, ((await second.json()) as RecompositionJob).id);
    assert.equal(done.sourceRenderId, first.id);
    assert.equal(done.generationRenderId, parentId);
    assert.deepEqual(done.originalRecipe, recipe);
    assert.equal(done.newRecipe.compositeRegion, undefined);
    assert.equal(done.rawSha256, hash(rawBytes));
    assert.equal(done.rawOutput, `/outputs/${parentId}-raw.mp4`);
    assert.equal(f.renders.size, 3);
  } finally {
    await f.close();
  }
});

test('a terminal CPU blend releases admission before notification and cannot release its successor', async () => {
  const notificationEntered = deferred(),
    releaseNotification = deferred(),
    notificationFinished = deferred(),
    secondEntered = deferred(),
    releaseSecond = deferred();
  let workerCalls = 0,
    notifications = 0,
    activeWorkers = 0,
    maxActiveWorkers = 0;
  const f = await fixture({
    worker: async (args) => {
      if (args.at(-1) === '--check') return;
      workerCalls++;
      activeWorkers++;
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
      try {
        const work = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
        if (workerCalls === 2) {
          secondEntered.resolve();
          await releaseSecond.promise;
        }
        await writeResult(work);
      } finally {
        activeWorkers--;
      }
    },
    onRender: async () => {
      if (++notifications !== 1) return;
      notificationEntered.resolve();
      await releaseNotification.promise;
      notificationFinished.resolve();
    },
  });
  try {
    const firstResponse = await f.post('', request, 'terminal-first');
    assert.equal(firstResponse.status, 202);
    const first = (await firstResponse.json()) as RecompositionJob;
    await notificationEntered.promise;
    const done = await terminal(f.url, first.id);
    assert.equal(f.busy(), false, 'A terminal response must mean admission is released.');
    assert.deepEqual(await readdir(path.join(f.data, 'recompositions')), [`${first.id}.json`]);
    const replay = await f.post('', request, 'terminal-first');
    assert.equal(replay.status, 200);
    assert.equal(((await replay.json()) as RecompositionJob).id, first.id);

    const secondResponse = await f.post(
      '',
      { renderId: done.id, matchSourceColor: false },
      'terminal-second',
    );
    assert.equal(secondResponse.status, 202, await secondResponse.clone().text());
    const second = (await secondResponse.json()) as RecompositionJob;
    await secondEntered.promise;
    assert.equal(workerCalls, 2);
    assert.equal(activeWorkers, 1);
    assert.equal(maxActiveWorkers, 1);
    assert.equal(f.busy(), true);

    releaseNotification.resolve();
    await notificationFinished.promise;
    assert.equal(f.busy(), true, 'An earlier completion must not free the new reservation.');
    assert.equal((await f.post('', request, 'terminal-third')).status, 409);
    releaseSecond.resolve();
    await terminal(f.url, second.id);
    assert.equal(f.busy(), false);
    assert.equal(maxActiveWorkers, 1);
    assert.deepEqual(
      (await readdir(path.join(f.data, 'recompositions'))).sort(),
      [`${first.id}.json`, `${second.id}.json`].sort(),
    );
  } finally {
    releaseNotification.resolve();
    releaseSecond.resolve();
    // Allow a failed assertion to release the deliberately held fixture worker.
    for (let attempt = 0; f.busy() && attempt < 100; attempt++) await delay(10);
    await f.close();
  }
});

test('freshly opening the actual Golden template rebinds local IDs without losing raw provenance', async () => {
  const f = await fixture({ templates: true });
  try {
    const opened = await fetch(
      `${f.url.replace('/api/recompositions', '/api/templates')}/golden-falls/open`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    assert.equal(opened.status, 201, await opened.clone().text());
    const source = ((await opened.json()) as { render: Render }).render,
      raw = await readFile(path.join(f.data, 'outputs', path.basename(source.rawOutput!))),
      metadata = inspectVideoMetadata(raw);
    assert.notEqual(source.recipe.clip.id, metadata.recipe.clip.id);
    assert.notEqual(source.recipe.clip.url, metadata.recipe.clip.url);
    assert(sameRecompositionGeneration(metadata.recipe, source.recipe));
    // Names and optional import metadata do not change hash-bound tensor inputs.
    source.recipe.clip.name = 'A renamed imported source';
    f.renders.get(source.id)!.recipe.clip.name = source.recipe.clip.name;
    const response = await f.post(
      '',
      { renderId: source.id, matchSourceColor: true },
      'actual-template',
    );
    assert.equal(response.status, 202, await response.clone().text());
    const job = await terminal(f.url, ((await response.json()) as RecompositionJob).id);
    assert.equal(job.newRecipe.clip.id, source.recipe.clip.id);
    assert.equal(job.newRecipe.clip.name, 'A renamed imported source');
    assert.deepEqual(job.originalRecipe, metadata.recipe);
    assert.deepEqual(job.originalGenerationWorkflow, metadata.workflow);
    assert.equal(job.rawSha256, hash(raw));
    assert.notEqual(job.id, source.id);
    const next = await f.post(
      '',
      { renderId: job.id, matchSourceColor: false },
      'actual-template-again',
    );
    assert.equal(next.status, 202, await next.clone().text());
    await terminal(f.url, ((await next.json()) as RecompositionJob).id);
  } finally {
    await f.close();
  }
});

test('unsupported, historical, changed or unregistered inputs fail before worker admission', async () => {
  for (const change of [
    async (_data: string, renders: Map<string, Render>) => {
      renders.get(parentId)!.state = 'failed';
    },
    async (_data: string, renders: Map<string, Render>) => {
      renders.get(parentId)!.recipe.pipeline = 'cinema';
    },
    async (_data: string, renders: Map<string, Render>) => {
      delete renders.get(parentId)!.rawOutput;
    },
    async (_data: string, renders: Map<string, Render>) => {
      renders.get(parentId)!.rawOutput = '/outputs/../../private.mp4';
    },
    async (data: string) => {
      await writeFile(path.join(data, 'clips', `${sourceId}.mp4`), 'changed source');
    },
    async (data: string) => {
      await writeFile(
        path.join(data, 'clips', `${sourceId}.json`),
        JSON.stringify({ ...recipe.clip, url: '/media/../../private.mp4' }),
      );
    },
    async (data: string) => {
      await writeFile(
        path.join(data, 'outputs', `${parentId}-raw.mp4`),
        'historical video without metadata',
      );
    },
    async (data: string) => {
      await writeFile(
        path.join(data, 'outputs', `${parentId}-raw.mp4`),
        rawVideo({ ...recipe, seed: 9 }),
      );
    },
    async (_data: string, renders: Map<string, Render>) => {
      renders.get(parentId)!.workflow = { '8': { class_type: 'Changed', inputs: {} } };
    },
  ]) {
    let workerCalls = 0;
    const f = await fixture({
      before: change,
      worker: async () => {
        workerCalls++;
      },
    });
    try {
      const response = await f.post('', request, 'reject');
      assert.equal(response.status, 409, await response.text());
      assert.equal(workerCalls, 0);
      assert.equal(((await (await fetch(f.url)).json()) as RecompositionJob[]).length, 0);
      assert.equal((await fetch(`${f.url}/by-key/reject`)).status, 404);
    } finally {
      await f.close();
    }
  }
});

test('worker errors are safe durable failures and never publish a partial take', async () => {
  const f = await fixture({
    worker: async (args) => {
      if (args.at(-1) !== '--check') throw new Error('C:/private/model/api-key-SECRET');
    },
  });
  try {
    const response = await f.post('', request, 'worker-fail');
    assert.equal(response.status, 202);
    const job = await terminal(f.url, ((await response.json()) as RecompositionJob).id, 'failed');
    assert.equal(f.busy(), false);
    assert(!JSON.stringify(job).includes('SECRET'));
    assert(!JSON.stringify(job).includes('C:/private'));
    assert.equal(job.renderId, undefined);
    assert.equal(job.receipt, undefined);
    assert.equal(f.renders.size, 1);
    assert.deepEqual(await readdir(path.join(f.data, 'outputs')), [
      `${parentId}-raw.mp4`,
      `${parentId}.mp4`,
    ]);
    assert.equal((await f.post('', request, 'worker-fail')).status, 200);
  } finally {
    await f.close();
  }
});

test('receipt tampering, clock/audio drift and source mutation cannot enter the saved takes', async () => {
  const cases: {
    patch?: (work: any) => Partial<RecompositionReceipt>;
    mutate?: (work: any) => Promise<void>;
  }[] = [
    { patch: () => ({ outputSha256: 'a'.repeat(64) }) },
    { patch: (work) => ({ newRecipe: { ...work.newRecipe, seed: 99 } }) },
    { patch: () => ({ width: 770 }) },
    { patch: () => ({ frames: 98, duration: 98 / 24 }) },
    { patch: () => ({ hasAudio: false }) },
    { patch: () => ({ originalGenerationWorkflow: { '8': { class_type: 'Other', inputs: {} } } }) },
    {
      mutate: async (work) => {
        await writeFile(work.source, 'changed during worker');
      },
    },
    {
      mutate: async (work) => {
        await writeFile(work.raw, Buffer.concat([rawBytes, Buffer.from('changed')]));
      },
    },
  ];
  for (const item of cases) {
    const f = await fixture({
      worker: async (args) => {
        if (args.at(-1) === '--check') return;
        const work = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
        await writeResult(work, item.patch?.(work));
        await item.mutate?.(work);
      },
    });
    try {
      const response = await f.post('', request, 'tamper');
      assert.equal(response.status, 202);
      const job = await terminal(f.url, ((await response.json()) as RecompositionJob).id, 'failed');
      assert.equal(f.renders.has(job.id), false);
      assert.equal(f.notifications.length, 0);
      assert.equal((await readdir(path.join(f.data, 'outputs'))).length, 2);
    } finally {
      await f.close();
    }
  }
});

test('cancel waits for worker termination and a late result cannot publish or free the queue early', async () => {
  const entered = deferred(),
    release = deferred();
  let signal: AbortSignal | undefined,
    calls = 0;
  const f = await fixture({
    worker: async (args, options) => {
      if (args.at(-1) === '--check') return;
      calls++;
      signal = options.signal;
      const work = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
      entered.resolve();
      await release.promise;
      await writeResult(work);
    },
  });
  try {
    const job = (await (await f.post('', request, 'cancel-one')).json()) as RecompositionJob;
    await entered.promise;
    const canceled = await f.post(`/${job.id}/cancel`, {});
    assert.equal(canceled.status, 202);
    assert.equal(((await canceled.json()) as RecompositionJob).state, 'canceling');
    assert.equal(signal?.aborted, true);
    assert.equal(f.busy(), true);
    assert.equal((await f.post('', request, 'other-job')).status, 409);
    assert.equal((await f.post('', request, 'cancel-one')).status, 200);
    assert.equal(calls, 1);
    release.resolve();
    await terminal(f.url, job.id, 'canceled');
    assert.equal(f.renders.has(job.id), false);
    assert.equal(f.busy(), false);
    assert.equal((await f.post(`/${job.id}/cancel`, {})).status, 200);
  } finally {
    release.resolve();
    await f.close();
  }
});

test('restart interrupts durable nonterminal jobs, cleans their partial publication and never executes them', async () => {
  const id = randomUUID(),
    now = '2026-10-19T01:00:00.000Z';
  let workerCalls = 0;
  const initial: RecompositionJob = {
    id,
    request,
    sourceRenderId: parentId,
    generationRenderId: parentId,
    sourceSha256: recipe.clip.sha256,
    rawSha256: hash(rawBytes),
    rawOutput: `/outputs/${parentId}-raw.mp4`,
    originalRecipe: recipe,
    newRecipe: recompositionRecipe(recipe, request),
    originalGenerationWorkflow: workflow,
    state: 'running',
    createdAt: now,
    updatedAt: now,
    requestKey: 'restarted',
    requestDigest: contentDigest(request),
  };
  const f = await fixture({
    worker: async () => {
      workerCalls++;
    },
    before: async (data, renders) => {
      await writeFile(path.join(data, 'recompositions', `${id}.json`), JSON.stringify(initial));
      await writeFile(path.join(data, 'outputs', `${id}.mp4`), 'partial publication');
      const partial: Render = {
        ...parent(),
        id,
        output: `/outputs/${id}.mp4`,
        recomposition: {
          format: 'aftertake-recomposition/1',
          jobId: id,
          sourceRenderId: parentId,
          generationRenderId: parentId,
          sourceSha256: recipe.clip.sha256,
          rawSha256: hash(rawBytes),
          originalRecipe: recipe,
          originalGenerationWorkflow: workflow,
          receipt: receipt({
            expected: initial,
            originalRecipe: recipe,
            newRecipe: initial.newRecipe,
            originalGenerationWorkflow: workflow,
            dimensions: { ...renderDimensions(recipe), displayWidth: 768, displayHeight: 432 },
          }),
        },
      };
      renders.set(id, partial);
      await writeFile(path.join(data, 'renders', `${id}.json`), JSON.stringify(partial));
    },
  });
  try {
    const job = await terminal(f.url, id, 'interrupted');
    assert.equal(job.renderId, undefined);
    assert.equal(job.receipt, undefined);
    assert.equal(f.renders.has(id), false);
    assert.equal(f.renders.has(parentId), true);
    assert.equal(workerCalls, 0);
    assert.equal((await f.post('', request, 'restarted')).status, 200);
    assert.equal(workerCalls, 0);
    assert.equal((await readdir(path.join(f.data, 'outputs'))).length, 2);
    assert.equal(
      JSON.parse(await readFile(path.join(f.data, 'recompositions', `${id}.json`), 'utf8')).state,
      'interrupted',
    );
  } finally {
    await f.close();
  }
});

test('preflight failure is a definitive rejection and has no receipt, model submission or data mutation', async () => {
  const f = await fixture({
    worker: async () => {
      throw new Error('missing CPU dependency C:/private');
    },
  });
  try {
    const response = await f.post('', request, 'missing-runtime');
    assert.equal(response.status, 503);
    assert(!JSON.stringify(await response.json()).includes('C:/private'));
    assert.equal((await fetch(`${f.url}/by-key/missing-runtime`)).status, 404);
    assert.equal((await readdir(path.join(f.data, 'recompositions'))).length, 0);
    assert.equal(f.renders.size, 1);
  } finally {
    await f.close();
  }
});

test('portable CPU receipts reject fabricated graphs, unbound sources and false execution claims', () => {
  const work = {
    expected: { sourceSha256: recipe.clip.sha256, rawSha256: hash(rawBytes) },
    originalRecipe: recipe,
    newRecipe: recompositionRecipe(recipe, request),
    originalGenerationWorkflow: workflow,
    dimensions: { ...renderDimensions(recipe), displayWidth: 768, displayHeight: 432 },
  };
  const good = receipt(work);
  assert(recompositionReceiptSchema.safeParse(good).success);
  for (const patch of [
    { originalGenerationWorkflow: {} },
    { noModelInvocation: false },
    { noComfyGraphExecution: false },
    { sourceSha256: 'b'.repeat(64) },
    { duration: 100 },
    { outputPath: 'C:/private/output.mp4' },
  ])
    assert(!recompositionReceiptSchema.safeParse({ ...good, ...patch }).success);
  assert(!recompositionJobSchema.safeParse({ id: parentId }).success);
});
