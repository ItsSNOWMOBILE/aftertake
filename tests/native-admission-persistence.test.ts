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
import type { EngineClient } from '../server/sdk-port.js';
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
