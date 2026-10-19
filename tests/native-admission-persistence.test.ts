import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { ComfyError } from '@comfyorg/sdk';
import type { Clip } from '../src/domain.js';
import type { EngineClient, EngineJob } from '../server/sdk-port.js';
import { createJobTarget } from '../server/job-target.js';
import { imageRouter } from '../server/images.js';
import { videoRouter } from '../server/videos.js';
import { frameEditorRouter } from '../server/frame-edits.js';
import { characterRouter } from '../server/characters.js';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const metadataName = /^[a-f0-9-]{36}\.json$/;
const temporaryName = /^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/;
type Family = 'image' | 'video' | 'frame' | 'selection' | 'replacement';

async function fixture(family: Family) {
  const root = await mkdtemp(path.join(tmpdir(), 'aftertake-native-admission-'));
  const data = path.join(root, 'data');
  const clips = path.join(data, 'clips');
  await mkdir(clips, { recursive: true });
  const folderName = {
    image: 'images',
    video: 'videos',
    frame: 'frame-edits',
    selection: 'characters',
    replacement: 'characters',
  }[family];
  const folder = path.join(data, folderName);
  await mkdir(folder);
  const store = async (name: string, kind: 'image' | 'video'): Promise<Clip> => {
    const id = randomUUID();
    const bytes = Buffer.from(name);
    const extension = kind === 'image' ? 'png' : 'mp4';
    const clip: Clip = {
      id,
      name,
      kind,
      width: 512,
      height: 512,
      duration: 2,
      hasAudio: false,
      sha256: sha(bytes),
      url: `/media/${id}.${extension}`,
    };
    await writeFile(path.join(clips, `${id}.${extension}`), bytes);
    await writeFile(path.join(clips, `${id}.json`), JSON.stringify(clip));
    return clip;
  };
  const image = await store('synthetic still input', 'image');
  const source = await store('synthetic video input', 'video');
  const selectionRequest = {
    format: 'aftertake-character-selection/1',
    clip: source,
    trimStart: 0,
    duration: 1,
    positive: [{ x: 0.4, y: 0.4 }],
    negative: [],
  };
  let selectionId: string | undefined;
  if (family === 'replacement') {
    selectionId = randomUUID();
    const mask = Buffer.from('synthetic reviewed mask');
    const prepared = Buffer.from('synthetic prepared source');
    await Promise.all([
      writeFile(path.join(folder, selectionId + '-mask.mkv'), mask),
      writeFile(path.join(folder, selectionId + '-source.mp4'), prepared),
      writeFile(
        path.join(folder, selectionId + '.json'),
        JSON.stringify({
          id: selectionId,
          kind: 'selection',
          state: 'succeeded',
          request: selectionRequest,
          workflow: {},
          progress: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          selection: {
            width: 512,
            height: 512,
            frames: 24,
            fps: 24,
            emptyFrames: [],
            maskSha256: sha(mask),
            sourceSha256: sha(prepared),
          },
        }),
      ),
    ]);
  }
  if (family === 'selection' || family === 'replacement') {
    await mkdir(path.join(root, 'scripts'));
    // Exercise the real router's graph-builder subprocess without Python,
    // native models or inference. Media stays synthetic and is never decoded.
    await writeFile(
      path.join(root, 'scripts/character-workflow.py'),
      `
      let input=''; process.stdin.on('data', part => input+=part);
      process.stdin.on('end', () => {
        JSON.parse(input);
        process.stdout.write(JSON.stringify({source:{class_type:'LoadVideo',inputs:{}},
          reference:{class_type:'LoadImage',inputs:{}},mask_video:{class_type:'LoadVideo',inputs:{}},
          original_audio:{class_type:'AftertakeLoadClip',inputs:{}}}));
      });
    `,
    );
  }
  const inputs = {
    image: {
      format: 'aftertake-image/1',
      name: 'Persistence image',
      prompt: 'A synthetic observatory above clouds.',
      seed: 1,
      aspect: 'square',
      style: 'none',
    },
    video: {
      format: 'aftertake-text-video/1',
      name: 'Persistence video',
      prompt: 'A synthetic observatory above clouds.',
      seed: 1,
      aspect: 'square',
      quality: 'draft',
      seconds: 2,
      sound: false,
    },
    frame: {
      format: 'aftertake-frame-edit/1',
      clip: image,
      trimStart: 0,
      prompt: 'Replace the background with a synthetic observatory.',
      seed: 1,
      mode: 'fast',
    },
    selection: selectionRequest,
    replacement: {
      format: 'aftertake-character/1',
      name: 'Persistence replacement',
      selectionId,
      reference: image,
      seed: 1,
      prompt: '',
    },
  };
  return {
    root,
    data,
    folder,
    input: inputs[family],
    async close() {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
      assert.ok(path.basename(root).startsWith('aftertake-native-admission-'));
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function siblingService(
  family: Family,
  data: Awaited<ReturnType<typeof fixture>>,
  client: EngineClient,
) {
  let admitting = false;
  const app = express();
  app.use(express.json());
  // Character tracker cleanup is real HTTP, confined to this mock control plane.
  app.get('/queue', (_req, res) => res.json({ queue_running: [], queue_pending: [] }));
  app.post('/free', (_req, res) => res.json({}));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const context = {
      root: data.root,
      data: data.data,
      python: process.execPath,
      client,
      target: createJobTarget({
        sdkBaseUrl: 'http://127.0.0.1:8189',
        uiBaseUrl: 'http://127.0.0.1:8188',
      }),
      uiUrl: origin,
      engine: async () => ({ connected: true, ready: true, missing: [], message: '' }),
      takeBusy: () => admitting,
      setAdmitting: (value: boolean) => {
        admitting = value;
      },
    };
    const native =
      family === 'image'
        ? await imageRouter(context)
        : family === 'video'
          ? await videoRouter(context)
          : family === 'frame'
            ? await frameEditorRouter(context)
            : await characterRouter(context);
    app.use('/jobs', native.router);
    const errorHandler: express.ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(503).json({ code: typeof error.code === 'string' ? error.code : 'fixture-error' });
    };
    app.use(errorHandler);
    const endpoint =
      family === 'selection' ? '/selections' : family === 'replacement' ? '/replacements' : '';
    const post = (route: string, key?: string) =>
      fetch(origin + '/jobs' + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        body: JSON.stringify(data.input),
        signal: AbortSignal.timeout(5000),
      });
    return {
      native,
      admitting: () => admitting,
      create: (key: string) => post(endpoint, key),
      reconcile: (id: string) => post('/' + id + '/reconcile'),
      list: () => fetch(origin + '/jobs').then((response) => response.json()),
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
}

function responseRecord(body: any) {
  return body.image || body.video || body.edit || body.character || body;
}

type MetadataObservation = {
  saved: Map<string, any>;
  changed: Set<() => void>;
  renameErrors: { code?: string; message: string; state?: string }[];
  observerErrors: string[];
};

async function waitForSavedState(
  folder: string,
  id: string,
  state: string,
  observation: MetadataObservation,
  trace: () => unknown,
) {
  let saved: any;
  try {
    saved = await new Promise((resolve, reject) => {
      const changed = () => {
        const record = observation.saved.get(id);
        if (record?.state !== state) return;
        cleanup();
        resolve(record);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Error('The restarted native tracker did not persist its terminal observation'));
      }, 5000);
      function cleanup() {
        clearTimeout(timer);
        observation.changed.delete(changed);
      }
      observation.changed.add(changed);
      changed();
    });
  } catch {
    let disk: any;
    let readError: { code?: string; message: string } | undefined;
    try {
      disk = JSON.parse(await readFile(path.join(folder, id + '.json'), 'utf8'));
    } catch (error) {
      readError = {
        code: (error as NodeJS.ErrnoException).code,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    assert.fail(
      'The restarted native tracker did not persist its terminal observation: ' +
        JSON.stringify({
          expectedState: state,
          lastObserved: observation.saved.get(id),
          disk,
          readError,
          renameErrors: observation.renameErrors,
          observerErrors: observation.observerErrors,
          trace: trace(),
        }),
    );
  }
  // Observe the successful real replacement first. Repeated destination reads
  // can themselves prevent metadata replacement on Windows.
  const actual = JSON.parse(await readFile(path.join(folder, id + '.json'), 'utf8'));
  assert.deepEqual(actual, saved);
  return actual;
}

for (const family of ['image', 'video', 'frame', 'selection', 'replacement'] as const) {
  for (const fault of ['write', 'rename'] as const) {
    test(
      `${family} retains an accepted native job after one ${fault} failure and restart only observes its ID`,
      { timeout: 15000 },
      async (t) => {
        const data = await fixture(family);
        const requestKey = 'accepted-persistence-' + family + '-' + fault;
        const nativeId = randomUUID();
        const submitKeys: string[] = [];
        const lookupIds: string[] = [];
        const submittedGraphs = new WeakMap<object, unknown>();
        const writtenMetadata = new Map<string, any>();
        const observation: MetadataObservation = {
          saved: new Map(),
          changed: new Set(),
          renameErrors: [],
          observerErrors: [],
        };
        let original: any;
        let failuresRemaining = 0;
        let failures = 0;
        const accepted: EngineJob = {
          id: nativeId,
          status: 'queued',
          error: null,
          refresh: async () => {},
          cancel: async () => {},
          async *events() {},
          getOutputs: () => [],
        };
        const observed: EngineJob = {
          ...accepted,
          status: 'failed',
          error: { code: 'execution_error', message: 'Synthetic terminal observation' },
        };
        const client: EngineClient = {
          workflows: {
            fromJson: (graph) => {
              const workflow = { setInput: () => {} };
              submittedGraphs.set(workflow, structuredClone(graph));
              return workflow;
            },
          },
          assets: { fromFile: (filename) => ({ filename }) },
          jobs: {
            get: async (id) => {
              lookupIds.push(id);
              assert.equal(id, nativeId);
              return observed;
            },
          },
          submit: async (workflow, options) => {
            submitKeys.push(options.idempotencyKey);
            assert.equal(submitKeys.length, 1, 'Known native IDs must never be resubmitted');
            original = JSON.parse(
              await readFile(path.join(data.folder, options.idempotencyKey + '.json'), 'utf8'),
            );
            assert.equal(original.state, 'submitting');
            assert.equal(original.requestKey, requestKey);
            assert.match(original.requestDigest, /^[a-f0-9]{64}$/);
            assert.deepEqual(submittedGraphs.get(workflow), original.workflow);
            assert.equal(original.jobId, undefined);
            // Admission has succeeded. Only subsequent metadata persistence is faulty.
            failuresRemaining = 1;
            return accepted;
          },
        };
        const originalWrite = fs.promises.writeFile;
        const originalRename = fs.promises.rename;
        const writeMock = t.mock.method(
          fs.promises,
          'writeFile',
          async (...args: Parameters<typeof writeFile>) => {
            if (
              failuresRemaining &&
              fault === 'write' &&
              path.dirname(String(args[0])) === data.folder &&
              temporaryName.test(path.basename(String(args[0])))
            ) {
              failuresRemaining--;
              failures++;
              throw Object.assign(Error('Synthetic accepted-job metadata write failure'), {
                code: 'EIO',
              });
            }
            const result = await originalWrite(...args);
            if (
              path.dirname(String(args[0])) === data.folder &&
              temporaryName.test(path.basename(String(args[0])))
            ) {
              try {
                writtenMetadata.set(String(args[0]), JSON.parse(String(args[1])));
              } catch {
                observation.observerErrors.push('Could not parse a successfully written payload');
              }
            }
            return result;
          },
        );
        const renameMock = t.mock.method(
          fs.promises,
          'rename',
          async (...args: Parameters<typeof fs.promises.rename>) => {
            if (
              failuresRemaining &&
              fault === 'rename' &&
              path.dirname(String(args[1])) === data.folder &&
              metadataName.test(path.basename(String(args[1])))
            ) {
              failuresRemaining--;
              failures++;
              throw Object.assign(Error('Synthetic accepted-job metadata replacement failure'), {
                code: 'EACCES',
              });
            }
            const temporary = String(args[0]);
            const destination = String(args[1]);
            const ownMetadata =
              path.dirname(destination) === data.folder &&
              metadataName.test(path.basename(destination));
            let result;
            try {
              result = await originalRename(...args);
            } catch (error) {
              if (ownMetadata)
                observation.renameErrors.push({
                  code: (error as NodeJS.ErrnoException).code,
                  message: error instanceof Error ? error.message : String(error),
                  state: writtenMetadata.get(temporary)?.state,
                });
              throw error;
            }
            if (ownMetadata) {
              const record = writtenMetadata.get(temporary);
              if (record && path.basename(destination) === record.id + '.json') {
                writtenMetadata.delete(temporary);
                observation.saved.set(record.id, record);
                for (const changed of observation.changed) changed();
              } else
                observation.observerErrors.push(
                  'Successful replacement lacked its matching payload',
                );
            }
            return result;
          },
        );
        syncBuiltinESMExports();
        let service: Awaited<ReturnType<typeof siblingService>> | undefined;
        try {
          service = await siblingService(family, data, client);
          const response = await service.create(requestKey);
          assert.equal(response.status, 502);
          const record = responseRecord(await response.json());
          assert.equal(failures, 1);
          assert.equal(failuresRemaining, 0);
          assert.equal(record.state, 'submission_unknown');
          assert.equal(record.jobId, nativeId);
          assert.notEqual(record.id, nativeId);
          assert.equal(record.id, original.id);
          assert.equal(record.requestKey, original.requestKey);
          assert.equal(record.requestDigest, original.requestDigest);
          assert.deepEqual(record.workflow, original.workflow);
          const saved = JSON.parse(
            await readFile(path.join(data.folder, record.id + '.json'), 'utf8'),
          );
          assert.deepEqual(saved, record);
          const rejoined = await service.create(requestKey);
          assert.equal(rejoined.status, 202);
          assert.equal((await rejoined.json()).jobId, nativeId);
          assert.deepEqual(submitKeys, [record.id]);
          assert.deepEqual(lookupIds, []);
          assert.equal(service.admitting(), false);

          await service.close();
          service = await siblingService(family, data, client);
          const recovered = await waitForSavedState(
            data.folder,
            record.id,
            'failed',
            observation,
            () => ({ lookupIds, submitKeys, failures, failuresRemaining }),
          );
          assert.equal(recovered.jobId, nativeId);
          assert.equal(recovered.requestKey, original.requestKey);
          assert.equal(recovered.requestDigest, original.requestDigest);
          assert.deepEqual(recovered.workflow, original.workflow);
          const afterRestart = await service.create(requestKey);
          assert.equal(afterRestart.status, 200);
          assert.equal((await afterRestart.json()).id, record.id);
          assert.deepEqual(submitKeys, [record.id]);
          assert.deepEqual(lookupIds, [nativeId]);
          assert.deepEqual(
            (await readdir(data.folder)).filter((name) => temporaryName.test(name)),
            [],
          );
        } finally {
          failuresRemaining = 0;
          writeMock.mock.restore();
          renameMock.mock.restore();
          syncBuiltinESMExports();
          await service?.close();
          await data.close();
        }
      },
    );
  }

  test(
    `${family} stays uncertain after both accepted-job saves fail and duplicate-key rejection on restart`,
    { timeout: 15000 },
    async (t) => {
      const data = await fixture(family);
      const requestKey = 'accepted-double-failure-' + family;
      const nativeId = randomUUID();
      const submitKeys: string[] = [];
      const admittedKeys = new Set<string>();
      const submittedGraphs = new WeakMap<object, unknown>();
      let original: any;
      let failuresRemaining = 0;
      let failures = 0;
      let lookups = 0;
      const client: EngineClient = {
        workflows: {
          fromJson: (graph) => {
            const workflow = { setInput: () => {} };
            submittedGraphs.set(workflow, structuredClone(graph));
            return workflow;
          },
        },
        assets: { fromFile: (filename) => ({ filename }) },
        jobs: {
          get: async () => {
            lookups++;
            assert.fail('An unknown native ID must not invent a lookup');
          },
        },
        submit: async (workflow, options) => {
          submitKeys.push(options.idempotencyKey);
          const saved = JSON.parse(
            await readFile(path.join(data.folder, options.idempotencyKey + '.json'), 'utf8'),
          );
          assert.deepEqual(submittedGraphs.get(workflow), saved.workflow);
          if (admittedKeys.has(options.idempotencyKey)) {
            assert.equal(saved.requestKey, original.requestKey);
            assert.equal(saved.requestDigest, original.requestDigest);
            assert.deepEqual(saved.workflow, original.workflow);
            // The SDK documents reject-on-duplicate, not replay of the accepted job.
            throw new ComfyError('Synthetic duplicate admission key', {
              code: 'idempotency_key_reuse',
              httpStatus: 422,
            });
          }
          assert.equal(admittedKeys.size, 0, 'Recovery must not admit a second generation');
          admittedKeys.add(options.idempotencyKey);
          original = saved;
          assert.equal(original.state, 'submitting');
          assert.equal(original.requestKey, requestKey);
          assert.match(original.requestDigest, /^[a-f0-9]{64}$/);
          failuresRemaining = 2;
          return {
            id: nativeId,
            status: 'queued',
            error: null,
            refresh: async () => {},
            cancel: async () => {},
            async *events() {},
            getOutputs: () => [],
          };
        },
      };
      const originalRename = fs.promises.rename;
      const renameMock = t.mock.method(
        fs.promises,
        'rename',
        async (...args: Parameters<typeof fs.promises.rename>) => {
          if (
            failuresRemaining &&
            path.dirname(String(args[1])) === data.folder &&
            metadataName.test(path.basename(String(args[1])))
          ) {
            failuresRemaining--;
            failures++;
            throw Object.assign(Error('Synthetic sustained accepted-job replacement failure'), {
              code: 'EACCES',
            });
          }
          return originalRename(...args);
        },
      );
      syncBuiltinESMExports();
      let service: Awaited<ReturnType<typeof siblingService>> | undefined;
      try {
        service = await siblingService(family, data, client);
        const response = await service.create(requestKey);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, 'EACCES');
        assert.equal(failures, 2);
        assert.equal(failuresRemaining, 0);
        assert.deepEqual(submitKeys, [original.id]);
        // Restart immediately: a list request could deliberately recover the
        // still-known in-memory ID, which is not the lost-durable-ID case.
        assert.deepEqual(
          JSON.parse(await readFile(path.join(data.folder, original.id + '.json'), 'utf8')),
          original,
        );

        await service.close();
        service = await siblingService(family, data, client);
        const restored = (await service.list()).find((record: any) => record.id === original.id);
        assert.equal(restored.state, 'submission_unknown');
        assert.equal(restored.jobId, undefined);
        assert.equal(restored.requestKey, original.requestKey);
        assert.equal(restored.requestDigest, original.requestDigest);
        assert.deepEqual(restored.workflow, original.workflow);
        assert.deepEqual(submitKeys, [original.id], 'Startup must not resubmit');
        assert.equal(lookups, 0);
        const rejoined = await service.create(requestKey);
        assert.equal(rejoined.status, 202);
        assert.equal((await rejoined.json()).id, original.id);
        assert.equal((await service.create(requestKey + '-different')).status, 409);
        assert.deepEqual(submitKeys, [original.id]);

        const recovery = await service.reconcile(original.id);
        assert.equal(recovery.status, 502);
        const uncertain = responseRecord(await recovery.json());
        assert.equal(uncertain.id, original.id);
        assert.equal(uncertain.jobId, undefined);
        assert.equal(uncertain.state, 'submission_unknown');
        assert.equal(uncertain.requestKey, original.requestKey);
        assert.equal(uncertain.requestDigest, original.requestDigest);
        assert.deepEqual(uncertain.workflow, original.workflow);
        assert.deepEqual(submitKeys, [original.id, original.id]);
        assert.equal(admittedKeys.size, 1);
        assert.equal(lookups, 0);
        const saved = JSON.parse(
          await readFile(path.join(data.folder, original.id + '.json'), 'utf8'),
        );
        assert.deepEqual(saved, uncertain);
        assert.equal((await service.create(requestKey)).status, 202);
        assert.equal((await service.create(requestKey + '-different')).status, 409);
        assert.deepEqual(submitKeys, [original.id, original.id]);
        assert.equal(service.admitting(), false);
        assert.deepEqual(
          (await readdir(data.folder)).filter((name) => temporaryName.test(name)),
          [],
        );
      } finally {
        failuresRemaining = 0;
        renameMock.mock.restore();
        syncBuiltinESMExports();
        await service?.close();
        await data.close();
      }
    },
  );
}

for (const family of ['image', 'video', 'frame', 'selection', 'replacement'] as const) {
  for (const fault of ['write', 'rename'] as const) {
    test(
      `${family} first metadata ${fault} failure leaves no phantom admission and the original key can retry`,
      { timeout: 15000 },
      async (t) => {
        const data = await fixture(family);
        const target = createJobTarget({
          sdkBaseUrl: 'http://127.0.0.1:8189',
          uiBaseUrl: 'http://127.0.0.1:8188',
        });
        const requestKey = 'initial-persistence-' + family + '-' + fault;
        const submissions: string[] = [];
        let workflowBindings = 0,
          assetBindings = 0,
          admitting = false;
        const client: EngineClient = {
          workflows: {
            fromJson: () => {
              workflowBindings++;
              return { setInput: () => {} };
            },
          },
          assets: {
            fromFile: (filename: string) => {
              assetBindings++;
              return { filename };
            },
          },
          jobs: { get: async () => assert.fail('No admitted job should need observation') },
          submit: async (_workflow, options) => {
            // A successful retry must establish the durable content-bound record
            // before even attempting the external SDK boundary.
            const saved = JSON.parse(
              await readFile(path.join(data.folder, options.idempotencyKey + '.json'), 'utf8'),
            );
            assert.equal(saved.state, 'submitting');
            assert.equal(saved.requestKey, requestKey);
            assert.equal(typeof saved.requestDigest, 'string');
            assert.deepEqual(saved.jobTarget, target.binding);
            submissions.push(options.idempotencyKey);
            // Typed rejection ends this test before polling, downloads or GPU work.
            throw new ComfyError('Synthetic admission rejection', {
              code: 'invalid_workflow',
              httpStatus: 422,
            });
          },
        };
        const context = {
          root: data.root,
          data: data.data,
          python: process.execPath,
          client,
          target,
          uiUrl: 'http://127.0.0.1:1',
          engine: async () => ({ connected: true, ready: true, missing: [], message: '' }),
          takeBusy: () => admitting,
          setAdmitting: (value: boolean) => {
            admitting = value;
          },
        };
        const native =
          family === 'image'
            ? await imageRouter(context)
            : family === 'video'
              ? await videoRouter(context)
              : family === 'frame'
                ? await frameEditorRouter(context)
                : await characterRouter(context);
        const app = express();
        app.use(express.json());
        app.use('/jobs', native.router);
        const errorHandler: express.ErrorRequestHandler = (error, _req, res, _next) => {
          res
            .status(503)
            .json({ code: typeof error.code === 'string' ? error.code : 'fixture-error' });
        };
        app.use(errorHandler);
        const server = createServer(app).listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const base = `http://127.0.0.1:${address.port}/jobs`;
        const endpoint =
          family === 'selection' ? '/selections' : family === 'replacement' ? '/replacements' : '';
        const post = () =>
          fetch(base + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
            body: JSON.stringify(data.input),
          });
        let locked = true,
          attempts = 0;
        const originalWrite = fs.promises.writeFile,
          originalRename = fs.promises.rename;
        const writeMock = t.mock.method(
          fs.promises,
          'writeFile',
          async (...args: Parameters<typeof writeFile>) => {
            if (
              locked &&
              fault === 'write' &&
              path.dirname(String(args[0])) === data.folder &&
              temporaryName.test(path.basename(String(args[0])))
            ) {
              attempts++;
              throw Object.assign(Error('Synthetic initial metadata write failure'), {
                code: 'EIO',
              });
            }
            return originalWrite(...args);
          },
        );
        const renameMock = t.mock.method(
          fs.promises,
          'rename',
          async (...args: Parameters<typeof fs.promises.rename>) => {
            if (
              locked &&
              fault === 'rename' &&
              path.dirname(String(args[1])) === data.folder &&
              metadataName.test(path.basename(String(args[1])))
            ) {
              attempts++;
              throw Object.assign(Error('Synthetic initial metadata replacement failure'), {
                code: 'EACCES',
              });
            }
            return originalRename(...args);
          },
        );
        syncBuiltinESMExports();
        try {
          const failed = await post();
          const initialBody = await failed.json();
          const initialList = await fetch(base).then((response) => response.json());
          const afterFailure = {
            failedStatus: failed.status,
            faultCode: initialBody.code,
            faultInjected: attempts > 0,
            phantomRecords: initialList.filter((record: any) => record.requestKey === requestKey)
              .length,
            busy: native.busy(),
            admitting,
            sdkCalls: submissions.length,
            workflowBindings,
            assetBindings,
            durableRecords: (await readdir(data.folder)).filter((name) => metadataName.test(name))
              .length,
            temporaryFiles: (await readdir(data.folder)).filter((name) => temporaryName.test(name))
              .length,
          };
          locked = false;
          const retried = await post();
          const retryBody = await retried.json();
          const retryRecord =
            retryBody.image ||
            retryBody.video ||
            retryBody.edit ||
            retryBody.character ||
            retryBody;
          const saved = await readFile(path.join(data.folder, retryRecord.id + '.json'), 'utf8')
            .then(JSON.parse)
            .catch(() => null);
          const rejoined = await post();
          const rejoinedBody = await rejoined.json();
          const afterRetry = {
            retryStatus: retried.status,
            retryState: retryRecord.state,
            sdkCalls: submissions.length,
            durableRetry:
              saved?.id === retryRecord.id &&
              saved?.requestKey === requestKey &&
              saved?.state === 'failed',
            rejoinStatus: rejoined.status,
            sameRecord: rejoinedBody.id === retryRecord.id,
            busy: native.busy(),
            admitting,
          };
          assert.deepEqual(
            { afterFailure, afterRetry },
            {
              afterFailure: {
                failedStatus: 503,
                faultCode: fault === 'write' ? 'EIO' : 'EACCES',
                faultInjected: true,
                phantomRecords: 0,
                busy: false,
                admitting: false,
                sdkCalls: 0,
                workflowBindings: 0,
                assetBindings: 0,
                durableRecords: family === 'replacement' ? 1 : 0,
                temporaryFiles: 0,
              },
              afterRetry: {
                retryStatus: 502,
                retryState: 'failed',
                sdkCalls: 1,
                durableRetry: true,
                rejoinStatus: 200,
                sameRecord: true,
                busy: false,
                admitting: false,
              },
            },
          );
        } finally {
          locked = false;
          writeMock.mock.restore();
          renameMock.mock.restore();
          syncBuiltinESMExports();
          server.closeAllConnections();
          await new Promise<void>((done) => server.close(() => done()));
          await data.close();
        }
      },
    );
  }
}
