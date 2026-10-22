import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { ComfyError } from '@comfyorg/sdk';
import { cloudFeatures, type CloudFeature } from '../src/compute.js';
import {
  enhanceOutput,
  enhanceSourceFrames,
  type EnhanceRequest,
  type SongRequest,
} from '../src/enhance.js';
import type { ImageRequest, ImageGeneration } from '../src/image-generation.js';
import {
  videoDimensions,
  type VideoGeneration,
  type VideoRequest,
} from '../src/video-generation.js';
import type { Enhancement } from '../src/enhance.js';
import {
  buildCloudEnhanceWorkflow,
  buildCloudVideoWorkflow,
  cloudModels,
  cloudOutputs,
  cloudRequirements,
} from '../server/cloud-workflow.js';
import {
  cloudCreditsExhausted,
  cloudOtherAccount,
  cloudPlanRequired,
  createCloudRuntime,
  recordRoute,
  type EngineRoute,
} from '../server/cloud-runtime.js';
import { componentChecks } from '../server/engine-compatibility.js';
import { requirements } from '../server/workflow.js';
import { buildImageWorkflow } from '../server/image-workflow.js';
import { buildEnhanceWorkflow } from '../server/enhance-workflow.js';
import { buildVideoWorkflow } from '../server/video-workflow.js';
import {
  cloudJobDisconnected,
  createCloudJobTarget,
  createJobTarget,
  jobTargetIssue,
} from '../server/job-target.js';
import { createComputeConnection } from '../server/compute.js';
import { imageRouter } from '../server/images.js';
import { enhancementRouter } from '../server/enhancements.js';
import { videoRouter } from '../server/videos.js';
import type { EngineClient } from '../server/sdk-port.js';

// Comfy Cloud's live object_info (2026-10-22), trimmed to the nodes the cloud
// graphs use and to the model files they load.
const cloudInfo = JSON.parse(
  readFileSync(new URL('./fixtures/comfy-cloud-object-info.json', import.meta.url), 'utf8'),
);
const secret = 'synthetic-cloud-key-never-returned';
const account = 'synthetic-account-id';
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

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
const image: ImageRequest = {
  format: 'aftertake-image/1',
  name: 'Lighthouse',
  prompt: 'A small red lighthouse on a green cliff at sunrise',
  seed: 42,
  aspect: 'square',
  style: 'photo',
};
const video: VideoRequest = {
  format: 'aftertake-text-video/1',
  name: 'Steam',
  prompt: 'Steam rises from an unbranded coffee cup.',
  seed: 5090,
  aspect: 'landscape',
  quality: 'draft',
  seconds: 2,
  sound: true,
  cinema: { movement: 'pan', lens: 'wide', lighting: 'neon', palette: 'cool' },
};

const localTarget = () =>
  createJobTarget({
    sdkBaseUrl: 'http://127.0.0.1:8189',
    uiBaseUrl: 'http://127.0.0.1:8188',
    allowLegacyLoopback: true,
  });
const ready = async () => ({ connected: true, ready: true, missing: [], message: 'Local ready' });

/** A Comfy Cloud stand-in: /api/user and /api/object_info, keyed like the real service. */
function cloudFetch(options: { info?: unknown; userStatus?: number; calls?: string[] } = {}) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input),
      headers = new Headers(init?.headers);
    options.calls?.push(url);
    assert.equal(init?.redirect, 'error');
    if (url === 'https://cloud.comfy.org/api/user') {
      assert.equal(headers.get('X-API-Key'), secret);
      return new Response(
        JSON.stringify({ id: account, status: 'active', email: 'private@example.com' }),
        { status: options.userStatus ?? 200 },
      );
    }
    if (url === 'https://cloud.comfy.org/api/object_info') {
      assert.equal(headers.get('Authorization'), `Bearer ${secret}`);
      return new Response(JSON.stringify(options.info ?? cloudInfo));
    }
    throw Error(`unexpected ${url}`);
  }) as typeof fetch;
}
type FakeJob = {
  id: string;
  status: string;
  error: null;
  refresh(): Promise<void>;
  events(): AsyncGenerator<never>;
  cancel(): Promise<void>;
  getOutputs(node: string): { toFile(file: string): Promise<unknown> }[];
};
function fakeJob(outputs: Record<string, (file: string) => Promise<unknown>>): FakeJob {
  const job: FakeJob = {
    id: randomUUID(),
    status: 'running',
    error: null,
    refresh: async () => {},
    events: async function* () {},
    cancel: async () => {
      job.status = 'canceled';
    },
    getOutputs: (node) => (outputs[node] ? [{ toFile: outputs[node] }] : []),
  };
  return job;
}
function fakeClient(submit: (graph: Graph) => Promise<FakeJob> | FakeJob, jobs: FakeJob[] = []) {
  const assets: string[] = [];
  let closed = 0;
  const client = {
    assets: {
      fromFile: (file: string) => {
        assets.push(file);
        return { asset: path.basename(file) };
      },
    },
    workflows: {
      fromJson: (graph: Graph) => ({
        graph,
        setInput(node: string, input: string, value: unknown) {
          graph[node].inputs[input] = value;
        },
      }),
    },
    jobs: {
      get: async (id: string) => {
        const job = jobs.find((item) => item.id === id);
        if (!job) throw Error('unknown job');
        return job;
      },
    },
    submit: async (workflow: { graph: Graph }) => {
      const job = await submit(workflow.graph);
      jobs.push(job);
      return job;
    },
    close: () => {
      closed++;
    },
  };
  return { client, assets, jobs, closed: () => closed };
}
const localMustNotRun = {
  assets: { fromFile: () => assert.fail('The local engine must not receive a cloud job.') },
  workflows: { fromJson: () => assert.fail('The local engine must not receive a cloud job.') },
  jobs: { get: async () => assert.fail('The local engine must not receive a cloud job.') },
  submit: async () => assert.fail('The local engine must not receive a cloud job.'),
} as unknown as EngineClient;

async function connectedRuntime(cloud: ReturnType<typeof fakeClient>, info?: unknown) {
  const runtime = createCloudRuntime({
    fetch: cloudFetch({ info }),
    createClient: async (options) => {
      assert.deepEqual(options, { baseUrl: 'https://cloud.comfy.org', apiKey: secret });
      return cloud.client as unknown as EngineClient;
    },
  });
  await runtime.connect(secret, account);
  await runtime.choose([...cloudFeatures], 'comfy-cloud');
  return runtime;
}
async function serve(router: express.Router, mount: string) {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  app.use(
    (
      error: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.status || 500).json({ error: error.message });
    },
  );
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, base: `http://127.0.0.1:${address.port}${mount}` };
}
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, message: string) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const post = (url: string, body: unknown = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
/** A PNG with no text chunks, as Comfy Cloud may return it. */
function bareImagePng(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Node stands in for scripts/cloud-media.py: it logs each job and writes a tagged MP4. */
const fakeCloudMedia = String.raw`
const fs = require('node:fs');
const [mode, file] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(file, 'utf8'));
if (process.env.CLOUD_MEDIA_FAIL === mode) process.exit(1);
fs.appendFileSync(process.env.CLOUD_MEDIA_LOG || require('node:path').join(__dirname, 'log.jsonl'), JSON.stringify({ mode, job }) + '\n');
const box = (name, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + data.length); h.write(name, 4, 'latin1'); return Buffer.concat([h, data]); };
if (mode === 'prepare') fs.writeFileSync(job.output, 'prepared frames');
else {
  if (fs.readFileSync(job.frames, 'utf8') !== 'webm frames') throw Error('frames were not downloaded');
  const type = Buffer.alloc(8); type.writeUInt32BE(1);
  const comment = Buffer.concat([type, Buffer.from(JSON.stringify(job.comment))]);
  fs.writeFileSync(job.output, Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.from([1])),
    box('moov', box('udta', box('meta', Buffer.concat([Buffer.alloc(4), box('ilst', box('©cmt', box('data', comment)))]))))]));
}
console.log(JSON.stringify({ frames: job.frames_count || 1, width: 1, height: 1 }));
`;
async function scriptsRoot(probe: Record<string, unknown>) {
  const root = await mkdtemp(path.join(tmpdir(), 'aftertake-cloud-')),
    data = path.join(root, 'data');
  await mkdir(path.join(data, 'clips'), { recursive: true });
  await mkdir(path.join(root, 'scripts'));
  await writeFile(path.join(root, 'scripts/cloud-media.py'), fakeCloudMedia);
  await writeFile(
    path.join(root, 'scripts/probe-film-asset.py'),
    `console.log(${JSON.stringify(JSON.stringify(probe))});`,
  );
  return { root, data, log: path.join(root, 'scripts/log.jsonl') };
}
const logged = async (file: string) =>
  (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { mode: string; job: Record<string, any> });

test('Comfy Cloud has every node and model the cloud graphs load, unlike the local graphs', () => {
  for (const feature of cloudFeatures) {
    const blocked = componentChecks(cloudInfo, cloudRequirements(feature)).filter(
      (check) => check.state === 'blocked',
    );
    assert.deepEqual(blocked, [], feature);
  }
  const local = (feature: CloudFeature) =>
    componentChecks(cloudInfo, requirements(feature))
      .filter((check) => check.state === 'blocked')
      .map((check) => check.message);
  assert.ok(local('text-video').includes('Node: UnetLoaderGGUF'));
  assert.ok(local('text-video').includes('Node: AftertakeSaveVideo'));
  assert.ok(local('upscale').includes('Node: AftertakeLoadClip'));
  assert.deepEqual(local('image-gen'), []);
  assert.deepEqual(local('song'), []);
});

test('each cloud graph uses exactly its required nodes, valid links and no Aftertake node', () => {
  const graphs: [CloudFeature, Graph][] = [
    ['image-gen', buildImageWorkflow(image)],
    ['song', buildEnhanceWorkflow('song-id', song) as Graph],
    ['upscale', buildCloudEnhanceWorkflow('upscale-id', upscale)],
    ['interpolate', buildCloudEnhanceWorkflow('smooth-id', smooth)],
    ['text-video', buildCloudVideoWorkflow(video)],
  ];
  for (const [feature, graph] of graphs) {
    const needed = cloudRequirements(feature),
      used = new Set(Object.values(graph).map((node) => node.class_type));
    // ImageCrop only appears when the model canvas differs from the delivered one.
    assert.deepEqual(
      [...used].sort(),
      needed.nodes.filter((name) => name !== 'ImageCrop' || used.has('ImageCrop')).sort(),
      feature,
    );
    for (const name of used) assert.doesNotMatch(name, /^Aftertake|GGUF/, feature);
    for (const node of Object.values(graph))
      for (const input of Object.values(node.inputs))
        if (Array.isArray(input))
          assert.ok(graph[input[0] as string], `${feature} link ${input[0]}`);
    for (const [name, input, file] of needed.menus)
      assert.ok(
        Object.values(graph).some(
          (node) => node.class_type === name && node.inputs[input] === file,
        ),
        `${feature} loads ${file}`,
      );
  }
});

test('cloud upscale and interpolation keep the local processing between loader and saver', () => {
  for (const request of [upscale, smooth]) {
    const local = buildEnhanceWorkflow('id', request) as Graph,
      cloud = buildCloudEnhanceWorkflow('id', request),
      saver = request.operation === 'upscale' ? '13' : '4';
    assert.deepEqual(cloud['1'], { class_type: 'LoadVideo', inputs: { file: 'SOURCE.mp4' } });
    assert.deepEqual(cloud['80'], {
      class_type: 'GetVideoComponents',
      inputs: { video: ['1', 0] },
    });
    for (const [id, node] of Object.entries(local)) {
      if (id === '1' || id === saver) continue;
      assert.equal(cloud[id].class_type, node.class_type);
      assert.deepEqual(
        cloud[id].inputs,
        JSON.parse(JSON.stringify(node.inputs).replaceAll('["1",0]', '["80",0]')),
      );
    }
    assert.deepEqual(cloud[cloudOutputs.frames], {
      class_type: 'SaveWEBM',
      inputs: {
        images: local[saver].inputs.images,
        filename_prefix: `aftertake/enhance/id/${request.operation}`,
        fps: enhanceOutput(request).fps,
        codec: 'vp9',
        crf: 12,
      },
    });
  }
});

test('cloud text to video swaps only the transformer loader and moves grading and saving off Cloud', () => {
  const local = buildVideoWorkflow(video) as Graph,
    cloud = buildCloudVideoWorkflow(video);
  assert.deepEqual(cloud['1'], {
    class_type: 'UNETLoader',
    inputs: { unet_name: cloudModels.videoDiffusion, weight_dtype: 'default' },
  });
  for (const id of Object.keys(local).filter((id) => !['1', '20', '21'].includes(id)))
    assert.deepEqual(cloud[id], local[id], id);
  assert.equal(cloud['20'], undefined);
  assert.equal(cloud['21'], undefined);
  assert.deepEqual(cloud[cloudOutputs.frames].inputs.images, local['20'].inputs.images);
  assert.equal(cloud[cloudOutputs.frames].inputs.fps, videoDimensions(video).fps);
  assert.deepEqual(cloud[cloudOutputs.sound].inputs.audio, ['22', 0]);
  const silent = buildCloudVideoWorkflow({ ...video, sound: false });
  assert.equal(silent[cloudOutputs.sound], undefined);
  assert.equal(silent['22'], undefined);
});

test('a Cloud job binds to its account, never the key, and only that account can recover it', () => {
  const local = localTarget(),
    cloud = createCloudJobTarget({ origin: 'https://cloud.comfy.org', account }),
    other = createCloudJobTarget({ origin: 'https://cloud.comfy.org', account: 'another-account' });
  assert.equal(cloud.binding.kind, 'comfy-cloud');
  assert.match(cloud.binding.fingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(cloud.binding.fingerprint, other.binding.fingerprint);
  assert.doesNotMatch(
    JSON.stringify(cloud.binding),
    new RegExp(`${account}|${secret}|cloud\\.comfy`),
  );
  assert.equal(cloud.legacyLoopbackAllowed, false);
  assert.equal(typeof jobTargetIssue({ jobTarget: cloud.binding }, local), 'string');
  assert.equal(typeof jobTargetIssue({ jobTarget: local.binding }, cloud), 'string');
  assert.equal(typeof jobTargetIssue({}, cloud), 'string');
  const route = (target: typeof cloud): EngineRoute => ({
      provider: 'comfy-cloud',
      client: localMustNotRun,
      target,
    }),
    localRoute: EngineRoute = { provider: 'local', client: localMustNotRun, target: local },
    routes = (target?: typeof cloud) => ({
      route: () => (target ? route(target) : undefined),
      engine: async () => assert.fail(),
      chosen: () => true,
      refused: () => undefined,
    });
  const record = { jobTarget: cloud.binding };
  assert.equal(recordRoute(record, localRoute), cloudJobDisconnected);
  assert.equal(recordRoute(record, localRoute, routes()), cloudJobDisconnected);
  assert.equal(recordRoute(record, localRoute, routes(other)), cloudOtherAccount);
  assert.equal(
    (recordRoute(record, localRoute, routes(cloud)) as EngineRoute).provider,
    'comfy-cloud',
  );
  assert.equal(recordRoute({}, localRoute, routes(cloud)), localRoute);
  assert.equal(recordRoute({ jobTarget: local.binding }, localRoute, routes(cloud)), localRoute);
});

test('the cloud runtime checks Cloud nodes with its key, caches them and remembers a plan refusal', async () => {
  const calls: string[] = [],
    cloud = fakeClient(() => assert.fail()),
    runtime = createCloudRuntime({
      fetch: cloudFetch({ calls }),
      createClient: async () => cloud.client as unknown as EngineClient,
    });
  assert.equal((await runtime.engine('image-gen')).connected, false);
  assert.equal(runtime.routes.route(), undefined);
  await runtime.connect(secret, account);
  for (const feature of cloudFeatures) {
    const engine = await runtime.engine(feature);
    assert.deepEqual(
      { ready: engine.ready, missing: engine.missing, gpu: engine.gpu },
      { ready: true, missing: [], gpu: 'Comfy Cloud' },
      feature,
    );
  }
  assert.equal(calls.length, 1, 'the node list is cached');
  assert.equal(runtime.routes.route()?.provider, 'comfy-cloud');
  assert.equal(runtime.routes.refused(Error('network')), undefined);
  assert.equal(runtime.routes.refused({ code: 'insufficient_credits' }), cloudCreditsExhausted);
  assert.equal(runtime.status().planBlocked, false);
  assert.equal(runtime.routes.refused({ code: 'forbidden' }), cloudPlanRequired);
  assert.deepEqual(runtime.status(), { connected: true, planBlocked: true });
  const blocked = await runtime.engine('song');
  assert.equal(blocked.ready, false);
  assert.equal(blocked.message, cloudPlanRequired);
  await runtime.disconnect();
  assert.equal(cloud.closed(), 1);
  assert.equal(runtime.routes.route(), undefined);

  const withoutWebm = structuredClone(cloudInfo);
  delete withoutWebm.SaveWEBM;
  const partial = await connectedRuntime(
    fakeClient(() => assert.fail()),
    withoutWebm,
  );
  const missing = await partial.engine('upscale');
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, ['Node: SaveWEBM']);
  assert.equal((await partial.engine('song')).ready, true);
});

test('connecting Comfy Cloud changes nothing until a studio is switched to it', async () => {
  const cloud = fakeClient(() => assert.fail()),
    runtime = createCloudRuntime({
      fetch: cloudFetch(),
      createClient: async () => cloud.client as unknown as EngineClient,
    }),
    connection = createComputeConnection({
      localEngine: async (feature) => ({
        connected: true,
        ready: !['depth', 'text-video'].includes(feature),
        missing: [],
        message: 'Local engine checked.',
      }),
      fetch: cloudFetch(),
      cloud: runtime,
    });
  assert.equal(
    await connection.choose({ feature: 'image-gen', renders: 'comfy-cloud' }),
    undefined,
  );
  const choose = async (input: unknown) => {
    const result = await connection.choose(input);
    assert.ok(result, 'the choice is accepted');
    return result;
  };
  assert.equal(connection.configure({ provider: 'comfy-cloud', apiKey: secret }), true);
  assert.equal(connection.status().state, 'configured');
  const status = await connection.probe();
  assert.equal(status.state, 'cloud');
  assert.equal(status.activeProvider, 'comfy-cloud');
  assert.equal(status.generationRouting, 'per-studio');
  // Cloud is optional: every studio keeps the local engine until it is chosen.
  for (const capability of status.capabilities) {
    assert.equal(capability.renders, 'local', capability.feature);
    assert.equal(
      capability.ready,
      !['depth', 'text-video'].includes(capability.feature),
      capability.feature,
    );
    const supported = (cloudFeatures as readonly string[]).includes(capability.feature);
    assert.equal(Boolean(capability.choices), supported, capability.feature);
    if (supported) {
      assert.equal(capability.choices!['comfy-cloud'].ready, true);
      assert.equal(capability.choices!.local.ready, capability.feature !== 'text-video');
    }
  }
  assert.equal(runtime.routes.chosen('text-video'), false);
  const check = (id: string, value = status) => value.checks.find((item) => item.id === id);
  assert.deepEqual(
    ['credential', 'authentication', 'billing', 'compatibility', 'routing', 'subscription'].map(
      (id) => check(id)?.state,
    ),
    ['pass', 'pass', 'pass', 'pass', 'pass', 'unverified'],
  );
  assert.match(check('routing')!.message, /Every studio still renders on your GPU/);
  for (const hidden of [secret, account, 'private@example.com'])
    assert.equal(JSON.stringify(status).includes(hidden), false, hidden);

  // Text to video has no local model here: send just that studio to Cloud.
  const chosen = await choose({ feature: 'text-video', renders: 'comfy-cloud' });
  const video = chosen.capabilities.find((item) => item.feature === 'text-video')!;
  assert.deepEqual([video.renders, video.ready], ['comfy-cloud', true]);
  assert.equal(chosen.capabilities.find((item) => item.feature === 'image-gen')?.renders, 'local');
  assert.match(check('routing', chosen)!.message, /^1 of 5 supported studios/);
  assert.equal(runtime.routes.chosen('text-video'), true);
  assert.equal(await connection.choose({ feature: 'depth', renders: 'comfy-cloud' }), false);
  assert.equal(await connection.choose({ feature: 'all', renders: 'gpu' }), false);
  const all = await choose({ feature: 'all', renders: 'comfy-cloud' });
  assert.deepEqual(
    all.capabilities
      .filter((item) => item.renders === 'comfy-cloud')
      .map((item) => item.feature)
      .sort(),
    [...cloudFeatures].sort(),
  );
  assert.equal(all.capabilities.find((item) => item.feature === 'depth')?.renders, 'local');

  runtime.routes.refused(new ComfyError('Forbidden', { code: 'forbidden', httpStatus: 403 }));
  const refused = connection.status();
  assert.equal(check('subscription', refused)?.state, 'blocked');
  assert.equal(check('compatibility', refused)?.state, 'pass');
  for (const capability of refused.capabilities.filter((item) => item.renders === 'comfy-cloud'))
    assert.deepEqual([capability.ready, capability.message], [false, cloudPlanRequired]);
  // Going back to the GPU is always allowed, connected or not.
  const back = await choose({ feature: 'image-gen', renders: 'local' });
  assert.equal(back.capabilities.find((item) => item.feature === 'image-gen')?.ready, true);
  const local = connection.disconnect();
  assert.equal(local.state, 'local');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cloud.closed(), 1);
  assert.equal(runtime.routes.route(), undefined);
  await choose({ feature: 'all', renders: 'local' });

  const refusedKey = createComputeConnection({
    localEngine: ready,
    fetch: cloudFetch({ userStatus: 401 }),
    cloud: createCloudRuntime({
      createClient: async () => assert.fail('no worker for a refused key'),
    }),
  });
  refusedKey.configure({ provider: 'comfy-cloud', apiKey: secret });
  const blocked = await refusedKey.probe();
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.activeProvider, 'local');
});

test('studio choices are remembered in the workspace, never with the key', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-cloud-choices-')),
    choicesFile = path.join(data, 'cloud-choices.json'),
    make = () =>
      createCloudRuntime({
        fetch: cloudFetch(),
        createClient: async () => fakeClient(() => assert.fail()).client as unknown as EngineClient,
        choicesFile,
      });
  const first = make();
  await first.loadChoices();
  assert.ok(cloudFeatures.every((feature) => !first.routes.chosen(feature)));
  await first.connect(secret, account);
  await first.choose(['song', 'image-gen'], 'comfy-cloud');
  const saved = await readFile(choicesFile, 'utf8');
  assert.deepEqual(JSON.parse(saved), {
    format: 'aftertake-cloud-choices/1',
    cloud: ['image-gen', 'song'],
  });
  assert.equal(saved.includes(secret) || saved.includes(account), false);
  const second = make();
  await second.loadChoices();
  assert.deepEqual(
    cloudFeatures.filter((feature) => second.routes.chosen(feature)),
    ['image-gen', 'song'],
  );
  await writeFile(choicesFile, JSON.stringify({ cloud: ['depth', 'song', 7] }));
  const third = make();
  await third.loadChoices();
  assert.deepEqual(
    cloudFeatures.filter((feature) => third.routes.chosen(feature)),
    ['song'],
  );
});

test('with Comfy Cloud connected, a studio left on the GPU keeps rendering locally', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-cloud-local-'));
  let admitting = false,
    localSubmissions = 0;
  const local = fakeClient(() => {
      localSubmissions++;
      // The local run ends at once, so nothing keeps polling after the test.
      const job = fakeJob({});
      job.refresh = async () => {
        job.status = 'canceled';
      };
      return job;
    }),
    remote = fakeClient(() => assert.fail('a studio left on the GPU must not reach Cloud')),
    runtime = createCloudRuntime({
      fetch: cloudFetch(),
      createClient: async () => remote.client as unknown as EngineClient,
    });
  await runtime.connect(secret, account);
  await runtime.choose(['song'], 'comfy-cloud');
  const target = localTarget(),
    images = await imageRouter({
      data,
      client: local.client as unknown as EngineClient,
      target,
      uiUrl: 'http://127.0.0.1:1',
      engine: ready,
      cloud: runtime.routes,
      takeBusy: () => admitting,
      setAdmitting: (value: boolean) => {
        admitting = value;
      },
    }),
    { server, base } = await serve(images.router, '/api/images');
  try {
    const created = await post(base, image);
    assert.equal(created.status, 201);
    const job = (await created.json()) as ImageGeneration;
    assert.deepEqual(job.jobTarget, target.binding);
    assert.equal(localSubmissions, 1);
    assert.equal(remote.jobs.length, 0);
  } finally {
    server.close();
  }
  // A local setup error points at Comfy Cloud only while it is connected.
  const offline = async () => ({ connected: false, ready: false, missing: [], message: '' });
  const blocked = await imageRouter({
      data: await mkdtemp(path.join(tmpdir(), 'aftertake-cloud-local-')),
      client: local.client as unknown as EngineClient,
      target,
      uiUrl: 'http://127.0.0.1:1',
      engine: offline,
      cloud: runtime.routes,
      takeBusy: () => false,
      setAdmitting: () => {},
    }),
    second = await serve(blocked.router, '/api/images');
  try {
    const refused = await post(second.base, image);
    assert.equal(refused.status, 409);
    assert.match(
      (await refused.json()).error,
      /Or choose Comfy Cloud for this studio in Render setup\.$/,
    );
    await runtime.disconnect();
    const plain = await post(second.base, image);
    assert.doesNotMatch((await plain.json()).error, /Comfy Cloud/);
  } finally {
    second.server.close();
  }
});

test('images render on Comfy Cloud, rejoin only through that account and explain a free plan', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'aftertake-cloud-image-'));
  let admitting = false,
    freeCalls = 0,
    hold = false,
    refuse = false;
  const png = bareImagePng(1024, 1024),
    cloud = fakeClient((graph) => {
      if (refuse)
        throw new ComfyError('API key authentication is not available for free tier accounts', {
          code: 'forbidden',
          httpStatus: 403,
        });
      assert.deepEqual(
        graph,
        buildImageWorkflow({ ...image, seed: graph['17'].inputs.seed as number }),
      );
      const job = fakeJob({ '21': (file) => writeFile(file, png) });
      job.refresh = async () => {
        if (!hold) job.status = 'succeeded';
      };
      return job;
    }),
    runtime = await connectedRuntime(cloud);
  const context = {
    data,
    client: localMustNotRun,
    target: localTarget(),
    uiUrl: 'http://127.0.0.1:1',
    engine: async () => {
      freeCalls++;
      return { connected: true, ready: true, missing: [], message: '' };
    },
    cloud: runtime.routes,
    takeBusy: () => admitting,
    setAdmitting: (value: boolean) => {
      admitting = value;
    },
  };
  const images = await imageRouter(context),
    { server, base } = await serve(images.router, '/api/images');
  const list = () => fetch(base).then((r) => r.json()) as Promise<ImageGeneration[]>;
  try {
    const created = await post(base, image);
    assert.equal(created.status, 201);
    const job = (await created.json()) as ImageGeneration;
    assert.equal(job.jobTarget?.kind, 'comfy-cloud');
    const done = await until(
      () => list().then((items) => items.find((item) => item.id === job.id)!),
      (item) => item.state === 'succeeded',
      'the cloud image finishes',
    );
    assert.deepEqual(done.workflow, buildImageWorkflow(image));
    assert.equal(done.clip?.width, 1024);
    assert.deepEqual(await readFile(path.join(data, 'clips', `${job.id}.png`)), png);
    assert.equal(freeCalls, 0, 'cloud admission does not ask the local engine');

    // A running Cloud job survives a restart without the key, and rejoins with it.
    hold = true;
    const running = (await (await post(base, { ...image, seed: 43 })).json()) as ImageGeneration;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await runtime.disconnect();
    server.close();
    const reopened = await imageRouter(context),
      second = await serve(reopened.router, '/api/images');
    try {
      const restored = ((await fetch(second.base).then((r) => r.json())) as ImageGeneration[]).find(
        (item) => item.id === running.id,
      )!;
      assert.equal(restored.state, 'connection_lost');
      assert.equal(restored.error, cloudJobDisconnected);
      const blocked = await post(`${second.base}/${running.id}/reconcile`);
      assert.equal(blocked.status, 409);
      assert.equal((await blocked.json()).error, cloudJobDisconnected);
      await runtime.connect(secret, account);
      hold = false;
      await until(
        () =>
          fetch(second.base)
            .then((r) => r.json() as Promise<ImageGeneration[]>)
            .then((items) => items.find((item) => item.id === running.id)!),
        (item) => item.state === 'succeeded',
        'the rejoined image finishes',
      );

      refuse = true;
      const free = await post(second.base, { ...image, seed: 44 });
      assert.equal(free.status, 502);
      const failed = (await free.json()).image as ImageGeneration;
      assert.equal(failed.state, 'failed');
      assert.equal(failed.error, cloudPlanRequired);
      const after = await post(second.base, { ...image, seed: 45 });
      assert.equal(after.status, 409);
      assert.equal((await after.json()).error, cloudPlanRequired);
    } finally {
      second.server.close();
    }
  } finally {
    server.close();
  }
});

test('a Cloud upscale uploads locally prepared frames and finishes the MP4 on this computer', async () => {
  const { root, data, log } = await scriptsRoot({
    kind: 'video',
    width: 2560,
    height: 1440,
    duration: 3,
  });
  await writeFile(path.join(data, 'clips', `${clip.id}.json`), JSON.stringify(clip));
  await writeFile(path.join(data, 'clips', `${clip.id}.mp4`), sourceBytes);
  let admitting = false,
    submitted: Graph | undefined,
    preparedExisted = false;
  const cloud = fakeClient(async (graph) => {
      submitted = structuredClone(graph);
      preparedExisted = (await readdir(path.join(data, 'enhancements'))).some((name) =>
        name.endsWith('.cloud-source.mp4'),
      );
      const job = fakeJob({ [cloudOutputs.frames]: (file) => writeFile(file, 'webm frames') });
      job.refresh = async () => {
        job.status = 'succeeded';
      };
      return job;
    }),
    runtime = await connectedRuntime(cloud);
  const enhancements = await enhancementRouter({
    data,
    root,
    python: process.execPath,
    client: localMustNotRun,
    target: localTarget(),
    uiUrl: 'http://127.0.0.1:1',
    engine: async () => assert.fail('cloud admission does not ask the local engine'),
    cloud: runtime.routes,
    takeBusy: () => admitting,
    setAdmitting: (value) => {
      admitting = value;
    },
  });
  const { server, base } = await serve(enhancements.router, '/api/enhancements');
  try {
    const created = await post(base, upscale);
    assert.equal(created.status, 201);
    const job = (await created.json()) as Enhancement;
    assert.equal(job.jobTarget?.kind, 'comfy-cloud');
    assert.deepEqual(job.workflow, buildCloudEnhanceWorkflow(job.id, upscale));
    const done = await until(
      () =>
        fetch(base)
          .then((r) => r.json() as Promise<Enhancement[]>)
          .then((items) => items[0]),
      (item) => item.state === 'succeeded' || item.state === 'output_error',
      'the cloud upscale finishes',
    );
    assert.equal(done.state, 'succeeded', done.error ?? '');
    assert.equal(preparedExisted, true);
    assert.deepEqual(submitted?.['1'].inputs.file, {
      asset: path.basename(cloud.assets[0]),
    });
    assert.match(cloud.assets[0], /\.cloud-source\.mp4$/);
    // A record's own save may still be in flight; only Cloud media must be gone.
    const leftovers = async () =>
      (await readdir(path.join(data, 'enhancements'))).filter((name) =>
        /cloud-source|\.download|\.webm$|^cloud-media-/.test(name),
      );
    assert.deepEqual(await leftovers(), [], 'prepared sources and downloads are removed');
    const [prepare, finish] = await logged(log);
    assert.equal(prepare.mode, 'prepare');
    assert.deepEqual(
      { ...prepare.job, output: undefined },
      {
        source: path.join(data, 'clips', `${clip.id}.mp4`),
        output: undefined,
        width: 1280,
        height: 720,
        frames: enhanceSourceFrames(clip),
        fps: 24,
        trim_start: 0,
      },
    );
    assert.equal(finish.mode, 'finish');
    assert.equal(finish.job.fps, 24);
    assert.equal(finish.job.frame_count, enhanceOutput(upscale).frames);
    assert.deepEqual(finish.job.source_audio, {
      path: path.join(data, 'clips', `${clip.id}.mp4`),
      start: 0,
    });
    assert.deepEqual(finish.job.comment, {
      recipe: { format: 'aftertake-enhance-output/1', request: upscale },
      workflow: job.workflow,
    });
    assert.deepEqual(done.workflow, job.workflow);
    assert.equal(done.clip?.width, 2560);
    assert.equal(done.clip?.hasAudio, true);

    // A source that cannot be prepared never reaches Cloud and is not held for recovery.
    const submissions = cloud.jobs.length;
    process.env.CLOUD_MEDIA_FAIL = 'prepare';
    try {
      const refused = await post(base, { ...upscale, seed: 43 });
      assert.equal(refused.status, 502);
      const failed = (await refused.json()).enhancement as Enhancement;
      assert.equal(failed.state, 'failed');
      assert.equal(failed.error, 'The source could not be prepared for Comfy Cloud.');
    } finally {
      delete process.env.CLOUD_MEDIA_FAIL;
    }
    assert.equal(cloud.jobs.length, submissions);
    assert.deepEqual(await leftovers(), []);
  } finally {
    server.close();
  }
});

test('Cloud text to video is graded and given its sound locally, then checked against the cloud graph', async () => {
  const { root, data, log } = await scriptsRoot({});
  let admitting = false;
  const d = videoDimensions(video),
    cloud = fakeClient(() => {
      const job = fakeJob({
        [cloudOutputs.frames]: (file) => writeFile(file, 'webm frames'),
        [cloudOutputs.sound]: (file) => writeFile(file, 'flac sound'),
      });
      job.refresh = async () => {
        job.status = 'succeeded';
      };
      return job;
    }),
    runtime = await connectedRuntime(cloud);
  const videos = await videoRouter({
    root,
    python: process.execPath,
    data,
    client: localMustNotRun,
    target: localTarget(),
    uiUrl: 'http://127.0.0.1:1',
    inspect: async () => ({
      ...d,
      hasAudio: true,
      regularTimestamps: true,
      firstTimestamp: 0,
      audio: {
        sampleRate: 24000,
        channels: 2,
        samples: 49000,
        duration: d.duration,
        firstTimestamp: 0,
        regularTimestamps: true,
      },
    }),
    engine: async () => assert.fail('cloud admission does not ask the local engine'),
    cloud: runtime.routes,
    takeBusy: () => admitting,
    setAdmitting: (value) => {
      admitting = value;
    },
  });
  const { server, base } = await serve(videos.router, '/api/videos');
  try {
    const created = await post(base, video);
    assert.equal(created.status, 201);
    const job = (await created.json()) as VideoGeneration;
    assert.equal(job.jobTarget?.kind, 'comfy-cloud');
    const done = await until(
      () =>
        fetch(base)
          .then((r) => r.json() as Promise<VideoGeneration[]>)
          .then((items) => items[0]),
      (item) => item.state === 'succeeded' || item.state === 'output_error',
      'the cloud video finishes',
    );
    assert.equal(done.state, 'succeeded', done.error ?? '');
    assert.deepEqual(done.workflow, buildCloudVideoWorkflow(video));
    const [finish] = await logged(log);
    assert.equal(finish.mode, 'finish');
    assert.equal(finish.job.palette, 'cool');
    assert.equal(finish.job.frame_count, d.frames);
    assert.equal(finish.job.fps, d.fps);
    assert.match(finish.job.generated_audio, /\.flac$/);
    assert.deepEqual(finish.job.comment, {
      recipe: video,
      workflow: buildCloudVideoWorkflow(video),
    });
    assert.equal(done.clip?.hasAudio, true);
  } finally {
    server.close();
  }
});
