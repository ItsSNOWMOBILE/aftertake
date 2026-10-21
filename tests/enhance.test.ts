import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  enhanceOutput,
  enhanceRequestSchema,
  songLanguages,
  songRequestSchema,
  type EnhanceRequest,
  type SongRequest,
} from '../src/enhance.js';
import {
  buildEnhanceWorkflow,
  enhanceModels,
  enhanceOutputNode,
  enhanceRequirements,
} from '../server/enhance-workflow.js';
import { enhancementRouter } from '../server/enhancements.js';
import { createJobTarget } from '../server/job-target.js';
import { hardwareProfile } from '../src/compute.js';
import type { EngineClient } from '../server/sdk-port.js';

const sourceBytes = Buffer.from('source clip bytes');
const clip = {
  id: randomUUID(),
  name: 'Rooftop take',
  kind: 'video' as const,
  sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  width: 1280,
  height: 720,
  duration: 3.04,
  hasAudio: true,
  url: '',
};
clip.url = `/media/${clip.id}.mp4`;
const upscale: EnhanceRequest = {
  format: 'aftertake-enhance/1',
  operation: 'upscale',
  name: 'Rooftop take · upscaled',
  clip,
  seed: 42,
};
const smooth: EnhanceRequest = {
  format: 'aftertake-enhance/1',
  operation: 'interpolate',
  name: 'Rooftop take · smooth',
  clip,
  multiplier: 2,
  timing: 'smooth',
};
const song: SongRequest = {
  format: 'aftertake-song/1',
  name: 'Rooftop theme',
  tags: 'cinematic synthwave, warm pads, steady drums, hopeful',
  lyrics: '',
  seconds: 30,
  bpm: 110,
  keyscale: 'A minor',
  timesignature: '4',
  language: 'en',
  seed: 7,
};

test('requests stay inside what the engine nodes accept', () => {
  assert.ok(enhanceRequestSchema.safeParse(upscale).success);
  assert.ok(enhanceRequestSchema.safeParse(smooth).success);
  assert.ok(songRequestSchema.safeParse(song).success);
  const big = { ...clip, width: 1920, height: 1080 };
  assert.equal(enhanceRequestSchema.safeParse({ ...upscale, clip: big }).success, false);
  assert.equal(enhanceRequestSchema.safeParse({ ...smooth, multiplier: 4 }).success, false);
  assert.ok(
    enhanceRequestSchema.safeParse({ ...smooth, multiplier: 4, timing: 'slow-motion' }).success,
  );
  assert.equal(
    enhanceRequestSchema.safeParse({ ...smooth, clip: { ...clip, duration: 12 } }).success,
    false,
  );
  assert.equal(
    enhanceRequestSchema.safeParse({ ...smooth, clip: { ...clip, width: 1279 } }).success,
    false,
  );
  assert.equal(songRequestSchema.safeParse({ ...song, seconds: 400 }).success, false);
  assert.equal(songRequestSchema.safeParse({ ...song, keyscale: 'H major' }).success, false);
});

test('enhancement source dimensions match the native clip loader bounds', () => {
  for (const [width, height] of [
    [32, 720],
    [1280, 62],
    [4098, 720],
    [1280, 4098],
  ])
    assert.equal(
      enhanceRequestSchema.safeParse({ ...smooth, clip: { ...clip, width, height } }).success,
      false,
    );
  for (const [width, height] of [
    [64, 64],
    [4096, 64],
    [64, 4096],
  ])
    assert.equal(
      enhanceRequestSchema.safeParse({ ...smooth, clip: { ...clip, width, height } }).success,
      true,
    );
});

test('song languages use the native ACE-Step menu, including unknown', () => {
  for (const language of songLanguages)
    assert.equal(songRequestSchema.safeParse({ ...song, language }).success, true, language);
  for (const language of ['zz', 'eng', 'EN', '', 'english'])
    assert.equal(songRequestSchema.safeParse({ ...song, language }).success, false, language);
  const unknown = songRequestSchema.parse({ ...song, language: 'unknown' });
  assert.equal((buildEnhanceWorkflow('job', unknown) as any)['3'].inputs.language, 'unknown');
});

test('the result size, frame count, rate and sound follow the operation', () => {
  assert.deepEqual(enhanceOutput(upscale), {
    width: 2560,
    height: 1440,
    frames: 72,
    fps: 24,
    sound: true,
  });
  assert.deepEqual(enhanceOutput(smooth), {
    width: 1280,
    height: 720,
    frames: 143,
    fps: 48,
    sound: true,
  });
  const slow = enhanceOutput({ ...smooth, multiplier: 4, timing: 'slow-motion' } as EnhanceRequest);
  assert.deepEqual(slow, { width: 1280, height: 720, frames: 285, fps: 24, sound: false });
});

const manifests = {
  upscale: 'docs/models-upscale.json',
  interpolate: 'docs/models-interpolation.json',
  song: 'docs/models-song.json',
} as const;
test('each graph uses exactly its required nodes, valid links and the pinned model files', async () => {
  for (const [request, feature] of [
    [upscale, 'upscale'],
    [smooth, 'interpolate'],
    [song, 'song'],
  ] as const) {
    const graph = buildEnhanceWorkflow('job', request) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    const needed = enhanceRequirements(feature);
    assert.deepEqual(
      [...new Set(Object.values(graph).map((node) => node.class_type))].sort(),
      [...needed.nodes].sort(),
      feature,
    );
    for (const node of Object.values(graph))
      for (const value of Object.values(node.inputs))
        if (Array.isArray(value) && typeof value[0] === 'string')
          assert.ok(graph[value[0]], `${feature}: ${node.class_type} links to a missing node`);
    assert.ok(graph[enhanceOutputNode(request)], feature);
    const files = JSON.parse(await readFile(manifests[feature], 'utf8')).map(
      (entry: { path: string }) => path.basename(entry.path),
    );
    for (const [, , filename] of needed.menus) assert.ok(files.includes(filename), filename);
    assert.equal(hardwareProfile(feature), 'image-gen');
  }
  const interpolate = buildEnhanceWorkflow('job', smooth) as any;
  assert.deepEqual(interpolate['4'].inputs.source_audio, ['1', 1]);
  assert.equal(interpolate['4'].inputs.fps, 48);
  const slow = buildEnhanceWorkflow('job', {
    ...smooth,
    multiplier: 4,
    timing: 'slow-motion',
  } as EnhanceRequest) as any;
  assert.equal(slow['4'].inputs.source_audio, '');
  assert.equal(slow['3'].inputs.multiplier, 4);
  const music = buildEnhanceWorkflow('job', song) as any;
  assert.equal(music['3'].inputs.lyrics, '[Instrumental]');
  assert.equal(music['5'].inputs.seconds, 30);
  assert.equal(music['1'].inputs.ckpt_name, enhanceModels.song);
  const up = buildEnhanceWorkflow('job', upscale) as any;
  assert.deepEqual(up['10'].inputs.temporal_overlap, ['6', 1]);
  assert.equal(up['6'].inputs.chunking_mode, 'auto');
});

const box = (name: string, data: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + data.length);
  header.write(name, 4, 'latin1');
  return Buffer.concat([header, data]);
};
function movie(recipe: unknown, workflow: unknown) {
  const type = Buffer.alloc(8);
  type.writeUInt32BE(1);
  const comment = Buffer.concat([type, Buffer.from(JSON.stringify({ recipe, workflow }))]);
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000')),
    box('mdat', Buffer.from([1])),
    box(
      'moov',
      box(
        'udta',
        box(
          'meta',
          Buffer.concat([Buffer.alloc(4), box('ilst', box('©cmt', box('data', comment)))]),
        ),
      ),
    ),
  ]);
}

test('an enhancement binds its source clip, rejoins its key and publishes a checked clip', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aftertake-enhance-')),
    data = path.join(root, 'data');
  await mkdir(path.join(data, 'clips'), { recursive: true });
  await mkdir(path.join(root, 'scripts'));
  await writeFile(path.join(data, 'clips', `${clip.id}.json`), JSON.stringify(clip));
  await writeFile(path.join(data, 'clips', `${clip.id}.mp4`), sourceBytes);
  // Node stands in for the Python probe, so this test needs no media runtime.
  await writeFile(
    path.join(root, 'scripts/probe-film-asset.py'),
    "console.log(JSON.stringify({ kind: 'video', width: 1280, height: 720, duration: 2.98 }));",
  );
  let ready = false,
    admitting = false,
    submitted: any;
  const job = {
    id: randomUUID(),
    status: 'running',
    refresh: async () => {},
    events: async function* () {},
    cancel: async () => {},
    getOutputs: (node: string) =>
      node === '4'
        ? [
            {
              toFile: (file: string) =>
                writeFile(
                  file,
                  movie({ format: 'aftertake-enhance-output/1', request: smooth }, { ran: true }),
                ),
            },
          ]
        : [],
  };
  const client = {
    workflows: {
      fromJson: (graph: any) => ({
        graph,
        setInput(node: string, input: string, value: unknown) {
          graph[node].inputs[input] = value;
        },
      }),
    },
    assets: { fromFile: (file: string) => ({ asset: path.basename(file) }) },
    jobs: { get: async () => job },
    submit: async (workflow: any) => {
      submitted = workflow.graph;
      return job;
    },
  } as unknown as EngineClient;
  const enhancements = await enhancementRouter({
    data,
    root,
    python: process.execPath,
    client,
    target: createJobTarget({
      sdkBaseUrl: 'http://127.0.0.1:8189',
      uiBaseUrl: 'http://127.0.0.1:8188',
      allowLegacyLoopback: true,
    }),
    uiUrl: 'http://127.0.0.1:1',
    engine: async () => ({ connected: true, ready, missing: [], message: '' }),
    takeBusy: () => admitting,
    setAdmitting: (value) => {
      admitting = value;
    },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/enhancements', enhancements.router);
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/enhancements`;
  const post = (value: unknown, key?: string) =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(value),
    });
  try {
    const notReady = await post(smooth);
    assert.equal(notReady.status, 409);
    assert.match((await notReady.json()).error, /setup-gpu --interpolate/);
    assert.equal((await post({ format: 'other' })).status, 400);
    ready = true;
    const created = await post(smooth, 'smooth-1');
    assert.equal(created.status, 201);
    const record = await created.json();
    assert.deepEqual(submitted['1'].inputs.filename, { asset: `${clip.id}.mp4` });
    assert.equal((await post(smooth, 'smooth-1')).status, 202);
    assert.equal((await post(song)).status, 409);
    job.status = 'succeeded';
    let current = record;
    for (let attempt = 0; attempt < 100 && current.state !== 'succeeded'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      current = (await (await fetch(base)).json()).find((item: any) => item.id === record.id);
      if (current.state === 'output_error') assert.fail(current.error);
    }
    assert.equal(current.state, 'succeeded');
    assert.deepEqual(current.workflow, { ran: true });
    assert.equal(current.clip.url, `/media/${record.id}.mp4`);
    assert.equal(current.clip.hasAudio, true);
    const saved = JSON.parse(await readFile(path.join(data, 'clips', `${record.id}.json`), 'utf8'));
    assert.equal(saved.sha256, current.clip.sha256);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
