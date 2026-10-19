import test from 'node:test';
import assert from 'node:assert/strict';
import { cudaSystemStats, hardwareFixture } from './hardware-fixture';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { requirements } from '../server/workflow.js';
import { recipeSchema } from '../src/domain.js';

const nativeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const temporaryPrefix = 'aftertake-take-accepted-';
type FaultOperation = 'write' | 'rename';
type RecordData = Record<string, any>;

function recordSummary(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const record = value as RecordData;
  return Object.fromEntries(
    ['id', 'state', 'jobId', 'requestKey', 'requestDigest', 'updatedAt', 'error'].map((key) => [
      key,
      record[key],
    ]),
  );
}

async function until<T>(
  phase: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  let lastValue: T | undefined;
  try {
    while (true) {
      lastValue = await read();
      if (ready(lastValue)) return lastValue;
      await delay(20, undefined, { signal: timeout });
    }
  } catch (error) {
    throw new Error(
      `Accepted-take fixture stopped while ${phase}; last observation: ${JSON.stringify(
        typeof lastValue === 'string'
          ? 'See the bounded child log in the fixture diagnostic.'
          : recordSummary(lastValue),
      )}`,
      { cause: error },
    );
  }
}

async function createFixture(directory: string) {
  const clips = path.join(directory, 'clips');
  await mkdir(clips);
  const recipe = JSON.parse(
    await readFile(new URL('../examples/observatory/recipe.json', import.meta.url), 'utf8'),
  );
  recipe.pipeline = 'structure';
  delete recipe.cinema;
  recipe.clip.kind = 'video';
  recipe.clip.duration = 5;
  recipe.clip.url = `/media/${recipe.clip.id}.mp4`;
  recipe.cue.strokes = [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.25 }];
  const source = Buffer.from('Synthetic input; no media decoding or GPU work is performed.');
  recipe.clip.sha256 = createHash('sha256').update(source).digest('hex');
  recipeSchema.parse(recipe);
  await writeFile(path.join(clips, `${recipe.clip.id}.json`), JSON.stringify(recipe.clip));
  await writeFile(path.join(clips, path.basename(recipe.clip.url)), source);
  const needed = requirements('structure');
  const nodes: RecordData = Object.fromEntries(
    needed.nodes.map((name) => [name, { input: { required: {}, optional: {} }, output: [] }]),
  );
  for (const [name, input, filename] of needed.menus)
    (nodes[name].input.required[input] ??= [[]])[0].push(filename);
  nodes.AftertakeLoadClip.output = ['IMAGE', 'STRING'];
  return { recipe, source, nodes };
}

// The marker is created by the backend only after inspecting the durable initial
// record. Faults therefore affect the accepted-job save and, optionally, its catch save.
async function createFaultPreloader(directory: string) {
  const filename = path.join(directory, 'preloader.mjs');
  await writeFile(
    filename,
    `import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const directory = process.env.AFTERTAKE_DATA_DIR;
const renderDirectory = path.join(directory, 'renders');
const marker = path.join(directory, 'backend-accepted');
const log = path.join(directory, 'faults.jsonl');
const diagnostics = path.join(directory, 'metadata-errors.jsonl');
const operation = process.env.AFTERTAKE_TEST_FAULT_OPERATION;
const limit = Number(process.env.AFTERTAKE_TEST_FAULT_LIMIT);
let failures = 0;
let diagnosticCount = 0;
const uuid = '[0-9a-f-]{36}';
function metadataError(kind, filename, error) {
  if (typeof filename !== 'string' || path.dirname(filename) !== renderDirectory) return;
  if (diagnosticCount++ >= 32) return;
  try {
    fs.appendFileSync(diagnostics, JSON.stringify({
      kind, filename: path.basename(filename), code: error?.code, atMs: Date.now(),
      injected: error?.message === 'Synthetic accepted-job metadata failure',
      pid: process.pid,
    }) + '\\n');
  } catch { /* Diagnostics must never replace the original storage error. */ }
}
function fail(kind, filename) {
  if (kind !== operation || failures >= limit || !fs.existsSync(marker)) return;
  if (typeof filename !== 'string' || path.dirname(filename) !== renderDirectory) return;
  const pattern = kind === 'write'
    ? new RegExp('^' + uuid + '\\\\.json\\\\.' + uuid + '\\\\.tmp$')
    : new RegExp('^' + uuid + '\\\\.json$');
  if (!pattern.test(path.basename(filename))) return;
  failures += 1;
  fs.appendFileSync(log, JSON.stringify({ kind, filename, pid: process.pid, failures }) + '\\n');
  throw Object.assign(new Error('Synthetic accepted-job metadata failure'), { code: 'EIO' });
}
const originalWrite = fs.promises.writeFile;
fs.promises.writeFile = async function(filename, ...args) {
  try {
    fail('write', filename);
    return await originalWrite.call(this, filename, ...args);
  } catch (error) {
    metadataError('write', filename, error);
    throw error;
  }
};
const originalRename = fs.promises.rename;
fs.promises.rename = async function(source, destination, ...args) {
  try {
    fail('rename', destination);
    return await originalRename.call(this, source, destination, ...args);
  } catch (error) {
    metadataError('rename', destination, error);
    throw error;
  }
};
syncBuiltinESMExports();
`,
    'utf8',
  );
  return filename;
}

for (const operation of ['write', 'rename'] as const) {
  for (const failureCount of [1, 2]) {
    test(
      `accepted take preserves its original identity after ${failureCount} ${operation} failure${failureCount === 1 ? '' : 's'}`,
      { timeout: 60000 },
      async () => {
        const directory = await mkdtemp(path.join(tmpdir(), temporaryPrefix));
        const renderDirectory = path.join(directory, 'renders');
        const { recipe, source, nodes } = await createFixture(directory);
        const preloader = await createFaultPreloader(directory);
        const submissions: { key: string; graph: unknown; saved: RecordData }[] = [];
        const nativeReads: string[] = [];
        let acceptedGenerations = 0;
        let backendFailure: unknown;
        let appId: string | undefined;
        let lastNativeState: RecordData | undefined;
        let lastDiskState: unknown;
        const startedAt = Date.now();
        let phase = 'create fixture';
        const phases: { phase: string; elapsedMs: number }[] = [];
        const requests: RecordData[] = [];
        const childLogs: { pid?: number; faultLimit: number; tail: string }[] = [];
        function enterPhase(name: string) {
          phase = name;
          phases.push({ phase, elapsedMs: Date.now() - startedAt });
          if (phases.length > 32) phases.shift();
        }
        function traceRequest(owner: string, method: string, pathname: string) {
          const entry: RecordData = {
            owner,
            method,
            pathname,
            elapsedMs: Date.now() - startedAt,
          };
          requests.push(entry);
          if (requests.length > 64) requests.shift();
          return entry;
        }
        const engine = createServer(async (request, response) => {
          const pathname = new URL(request.url || '/', 'http://localhost').pathname;
          const trace = traceRequest('engine', request.method || '', pathname);
          response.once('finish', () => {
            trace.status = response.statusCode;
            trace.completedMs = Date.now() - startedAt;
          });
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            response.setHeader('Content-Type', 'application/json');
            if (pathname === '/object_info') return void response.end(JSON.stringify(nodes));
            if (pathname === '/system_stats')
              return void response.end(
                JSON.stringify({ ...cudaSystemStats, system: { os: 'posix' } }),
              );
            if (pathname === '/aftertake/runtime') {
              const profile = new URL(request.url || '/', 'http://localhost').searchParams.get(
                'profile',
              );
              assert.equal(profile, 'structure');
              return void response.end(JSON.stringify(hardwareFixture('structure')));
            }
            if (pathname === '/api/v2/health' || pathname === '/free')
              return void response.end('{}');
            if (pathname === '/queue')
              return void response.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
            if (request.method === 'HEAD' && pathname.startsWith('/api/v2/assets/by-hash/')) {
              response.statusCode = 404;
              return void response.end();
            }
            if (request.method === 'POST' && pathname === '/api/v2/assets') {
              response.statusCode = 201;
              return void response.end(
                JSON.stringify({
                  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                  created_new: true,
                  hash: null,
                  file_path: 'source.mp4',
                  size_bytes: source.length,
                  content_type: 'video/mp4',
                  created_at: '2026-10-19T00:00:00Z',
                  url: '/unused',
                  url_expires_at: '2030-01-01T00:00:00Z',
                }),
              );
            }
            if (request.method === 'POST' && pathname === '/api/v2/jobs') {
              const key = String(request.headers['idempotency-key']);
              const saved = JSON.parse(
                await readFile(path.join(renderDirectory, `${key}.json`), 'utf8'),
              );
              const graph = JSON.parse(Buffer.concat(chunks).toString('utf8')).workflow;
              assert.ok(graph);
              submissions.push({ key, graph, saved });
              if (acceptedGenerations) {
                // The SDK contract rejects duplicate keys rather than replaying a response.
                assert.equal(key, appId);
                response.statusCode = 422;
                return void response.end(
                  JSON.stringify({
                    error: { code: 'idempotency_key_reuse', message: 'Key already admitted.' },
                  }),
                );
              }
              assert.equal(saved.id, key);
              assert.equal(saved.state, 'submitting');
              assert.equal(saved.jobId, undefined);
              assert.ok(saved.workflow);
              assert.notEqual(key, nativeId);
              appId = key;
              acceptedGenerations += 1;
              await writeFile(path.join(directory, 'backend-accepted'), key);
              response.statusCode = 201;
              return void response.end(JSON.stringify(jobSnapshot('queued')));
            }
            if (request.method === 'GET' && pathname === `/api/v2/jobs/${nativeId}`) {
              nativeReads.push(pathname);
              return void response.end(JSON.stringify(jobSnapshot('failed')));
            }
            response.statusCode = 404;
            response.end('{}');
          } catch (error) {
            backendFailure = error;
            response.statusCode = 500;
            response.end('{}');
          }
        }).listen(0, '127.0.0.1');
        await once(engine, 'listening');
        const engineAddress = engine.address();
        assert.ok(engineAddress && typeof engineAddress !== 'string');
        const engineUrl = `http://127.0.0.1:${engineAddress.port}`;
        function jobSnapshot(status: 'queued' | 'failed') {
          lastNativeState = {
            id: nativeId,
            status,
            error: status === 'failed' ? 'execution_error' : null,
            elapsedMs: Date.now() - startedAt,
          };
          return {
            id: nativeId,
            status,
            created_at: '2026-10-19T00:00:00Z',
            started_at: null,
            completed_at: status === 'failed' ? '2026-10-19T00:00:01Z' : null,
            expires_at: '2030-01-01T00:00:00Z',
            queue_position: status === 'queued' ? 0 : null,
            progress: null,
            outputs: [],
            error:
              status === 'failed'
                ? { code: 'execution_error', message: 'Synthetic terminal observation.' }
                : null,
            urls: {
              self: `/api/v2/jobs/${nativeId}`,
              events: `/api/v2/jobs/${nativeId}/events`,
              cancel: `/api/v2/jobs/${nativeId}/cancel`,
            },
          };
        }
        let child: ReturnType<typeof spawn> | undefined;
        let base = '';
        let output = '';
        const mainPids: number[] = [];
        async function stop() {
          if (child && child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
          }
          child = undefined;
        }
        async function start(limit: number) {
          enterPhase(`start studio ${mainPids.length + 1} with fault limit ${limit}`);
          const reservation = createServer().listen(0, '127.0.0.1');
          await once(reservation, 'listening');
          const address = reservation.address();
          assert.ok(address && typeof address !== 'string');
          await new Promise<void>((resolve) => reservation.close(() => resolve()));
          base = `http://127.0.0.1:${address.port}`;
          output = '';
          child = spawn(
            process.execPath,
            [
              '--import',
              pathToFileURL(preloader).href,
              '--import',
              'tsx',
              'server/index.ts',
              '--production',
            ],
            {
              cwd: process.cwd(),
              windowsHide: true,
              env: {
                ...process.env,
                PORT: String(address.port),
                AFTERTAKE_DATA_DIR: directory,
                AFTERTAKE_PYTHON: path.join(directory, 'unused-python'),
                COMFY_BASE_URL: engineUrl,
                COMFY_UI_URL: engineUrl,
                COMFY_API_KEY: '',
                AFTERTAKE_TEST_FAULT_OPERATION: operation,
                AFTERTAKE_TEST_FAULT_LIMIT: String(limit),
              },
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          assert.ok(child.pid);
          mainPids.push(child.pid);
          const childLog = { pid: child.pid, faultLimit: limit, tail: '' };
          childLogs.push(childLog);
          const appendOutput = (part: Buffer) => {
            output = (output + part.toString()).slice(-16384);
            childLog.tail = (childLog.tail + part.toString()).slice(-4000);
          };
          child.stdout!.on('data', appendOutput);
          child.stderr!.on('data', appendOutput);
          await until(
            phase,
            async () => {
              assert.equal(child!.exitCode, null, output.slice(-2000));
              return output;
            },
            (text) => text.includes('Aftertake studio:'),
          );
        }
        async function request(label: string, endpoint: string, init?: RequestInit) {
          enterPhase(label);
          const trace = traceRequest('studio', init?.method || 'GET', endpoint);
          try {
            const response = await fetch(`${base}${endpoint}`, init);
            trace.status = response.status;
            trace.completedMs = Date.now() - startedAt;
            return response;
          } catch (error) {
            trace.error = error instanceof Error ? error.name : typeof error;
            throw error;
          }
        }
        const post = (key: string, input = recipe, label = 'submit original take') =>
          request(label, '/api/renders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(15000),
          });
        const list = (label: string) =>
          request(label, '/api/renders', { signal: AbortSignal.timeout(5000) }).then(
            (response) => response.json() as Promise<RecordData[]>,
          );
        const diskRecord = async () => {
          const saved = JSON.parse(
            await readFile(path.join(renderDirectory, `${appId}.json`), 'utf8'),
          );
          lastDiskState = recordSummary(saved);
          return saved;
        };
        const key = `accepted-${operation}-${failureCount}`;
        try {
          await start(failureCount);
          const health = await request('check engine readiness', '/api/engine').then((response) =>
            response.json(),
          );
          assert.equal(health.ready, true);
          const response = await post(key);
          assert.equal(response.status, failureCount === 1 ? 502 : 500, output);
          const body = await response.json();
          const [inMemory] = await list('inspect accepted in-memory take');
          assert.equal(inMemory.id, appId);
          assert.equal(inMemory.jobId, nativeId);
          assert.equal(inMemory.state, 'submission_unknown');
          if (failureCount === 1) assert.deepEqual(body.render, inMemory);
          else assert.equal(body.render, undefined);
          const original = submissions[0].saved;
          assertIdentity(inMemory, original);
          const saved = await diskRecord();
          if (failureCount === 1) assert.deepEqual(saved, inMemory);
          else {
            assert.deepEqual(saved, original);
            assert.equal(saved.state, 'submitting');
            assert.equal(saved.jobId, undefined);
          }
          assert.equal(submissions.length, 1);
          assert.equal(acceptedGenerations, 1);
          assert.equal(nativeReads.length, 0);
          assert.equal(backendFailure, undefined);
          const faults = (await readFile(path.join(directory, 'faults.jsonl'), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          assert.equal(faults.length, failureCount);
          assert.ok(faults.every((fault) => fault.kind === operation && fault.pid === mainPids[0]));
          assert.deepEqual(
            faults.map((fault) => fault.failures),
            failureCount === 1 ? [1] : [1, 2],
          );

          const rejoined = await post(key, recipe, 'rejoin original take before restart');
          assert.equal(rejoined.status, 202);
          assert.deepEqual(await rejoined.json(), inMemory);
          assert.equal(
            (await post(key, { ...recipe, seed: recipe.seed + 1 }, 'reject changed original key'))
              .status,
            409,
          );
          assert.equal((await post(`${key}-new`, recipe, 'reject competing take')).status, 409);
          assert.equal(submissions.length, 1);

          enterPhase('stop studio before restart');
          await stop();
          await start(0);
          if (failureCount === 1) {
            enterPhase('observe failed native job persisted after restart');
            await until(phase, diskRecord, (record) => record.state === 'failed');
            const [recovered] = await list('inspect recovered failed take');
            assert.equal(recovered.state, 'failed');
            assert.equal(recovered.jobId, nativeId);
            assertIdentity(recovered, original);
            assert.deepEqual(await diskRecord(), recovered);
            assert.ok(nativeReads.length >= 1);
            assert.ok(nativeReads.every((pathname) => pathname === `/api/v2/jobs/${nativeId}`));
            assert.equal(
              submissions.length,
              1,
              'Known native IDs must be observed without resubmission.',
            );
          } else {
            enterPhase('observe uncertain submission persisted after restart');
            await until(phase, diskRecord, (record) => record.state === 'submission_unknown');
            const [reloaded] = await list('inspect recovered uncertain take');
            assert.equal(reloaded.state, 'submission_unknown');
            assert.equal(reloaded.jobId, undefined);
            assertIdentity(reloaded, original);
            assert.deepEqual(await diskRecord(), reloaded);
            assert.equal(nativeReads.length, 0);
            assert.equal(
              submissions.length,
              1,
              'Startup must not replay a request without a native ID.',
            );

            const reconciled = await request(
              'explicitly reconcile original uncertain take',
              `/api/renders/${appId}/reconcile`,
              { method: 'POST', signal: AbortSignal.timeout(15000) },
            );
            assert.equal(reconciled.status, 502);
            const reconciledBody = await reconciled.json();
            assert.equal(reconciledBody.render.state, 'submission_unknown');
            assert.equal(reconciledBody.render.jobId, undefined);
            assertIdentity(reconciledBody.render, original);
            assert.deepEqual(await diskRecord(), reconciledBody.render);
            assert.equal(submissions.length, 2);
            assert.equal(submissions[1].key, submissions[0].key);
            assert.deepEqual(submissions[1].graph, submissions[0].graph);
            assertIdentity(submissions[1].saved, original);
            assert.equal(nativeReads.length, 0);
            const joinedAgain = await post(key, recipe, 'rejoin reconciled original take');
            assert.equal(joinedAgain.status, 202);
            assert.deepEqual(await joinedAgain.json(), reconciledBody.render);
            assert.equal(
              (await post(`${key}-new`, recipe, 'reject competing take after reconciliation'))
                .status,
              409,
            );
            assert.equal(submissions.length, 2);
          }
          assert.equal(acceptedGenerations, 1);
          assert.equal(backendFailure, undefined);
          assert.deepEqual(
            (await readdir(renderDirectory)).filter((name) => name.endsWith('.tmp')),
            [],
          );
          const finalFaultLog = await readFile(path.join(directory, 'faults.jsonl'), 'utf8');
          assert.equal(finalFaultLog.trim().split('\n').length, failureCount);
        } catch (error) {
          let currentDiskState: unknown;
          try {
            currentDiskState = recordSummary(
              JSON.parse(await readFile(path.join(renderDirectory, `${appId}.json`), 'utf8')),
            );
          } catch (readError) {
            currentDiskState = { readError: (readError as NodeJS.ErrnoException).code };
          }
          const metadataErrors = await readFile(
            path.join(directory, 'metadata-errors.jsonl'),
            'utf8',
          )
            .then((text) =>
              text
                .trim()
                .split('\n')
                .slice(-32)
                .map((line) => JSON.parse(line)),
            )
            .catch((readError: NodeJS.ErrnoException) => ({ readError: readError.code }));
          let details = JSON.stringify({
            phase,
            operation,
            failureCount,
            elapsedMs: Date.now() - startedAt,
            lastDiskState,
            currentDiskState,
            lastNativeState,
            acceptedGenerations,
            submissionCount: submissions.length,
            nativeReadCount: nativeReads.length,
            backendFailure:
              backendFailure instanceof Error
                ? { name: backendFailure.name, message: backendFailure.message }
                : backendFailure,
            child: child && {
              pid: child.pid,
              exitCode: child.exitCode,
              signalCode: child.signalCode,
            },
            phases,
            requests,
            metadataErrors,
            childLogs,
          });
          for (const [filename, label] of [
            [directory, '<fixture>'],
            [process.cwd(), '<workspace>'],
            [tmpdir(), '<tmp>'],
          ]) {
            details = details.replaceAll(JSON.stringify(filename).slice(1, -1), label);
            details = details.replaceAll(filename.replaceAll('\\', '/'), label);
          }
          throw new Error(`Accepted-take fixture failure: ${details}`, { cause: error });
        } finally {
          await stop();
          engine.closeAllConnections();
          await new Promise<void>((resolve) => engine.close(() => resolve()));
          assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
          assert.ok(path.basename(directory).startsWith(temporaryPrefix));
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
  }
}

function assertIdentity(actual: RecordData, expected: RecordData) {
  assert.equal(actual.id, expected.id);
  assert.equal(actual.requestKey, expected.requestKey);
  assert.equal(actual.requestDigest, expected.requestDigest);
  assert.equal(typeof actual.requestDigest, 'string');
  assert.deepEqual(actual.workflow, expected.workflow);
  assert.deepEqual(actual.recipe, expected.recipe);
  assert.deepEqual(actual.jobTarget, expected.jobTarget);
}
