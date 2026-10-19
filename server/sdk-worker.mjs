// The real SDK and its environment-derived connection live only in this worker.
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { realpath, stat, lstat, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Comfy, ComfyError } from '@comfyorg/sdk';
import { ApiError } from '@comfyorg/sdk/low';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = /^[a-zA-Z0-9_.:-]{1,128}$/;
const statuses = new Set([
  'queued',
  'running',
  'canceling',
  'succeeded',
  'canceled',
  'failed',
  'expired',
]);
const sdkCodes = new Set([
  'invalid_workflow',
  'workflow_format_ui',
  'missing_asset',
  'hash_mismatch',
  'blob_not_found',
  'unauthorized',
  'forbidden',
  'insufficient_credits',
  'queue_full',
  'unexpected_response',
  'not_implemented',
  'idempotency_key_reuse',
  'idempotency_key_used',
  'missing_credentials',
  'execution_error',
  'not_found',
  'expired',
  'cancelled',
  'canceled',
  'request_aborted',
  'request_timeout',
  'worker_busy',
  'worker_unavailable',
]);
const operations = new Set([
  'submit',
  'get',
  'refresh',
  'cancel',
  'download',
  'events.open',
  'events.next',
  'events.close',
]);
const controls = new Set(['cancel', 'events.close']);
const graphLimit = 8 * 1024 * 1024;
const downloadTimeout = 20 * 60 * 1000;

class Invalid extends Error {
  constructor(code = 'invalid_request') {
    super();
    this.code = code;
  }
}
class Unexpected extends Error {}
const plain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value, key) => plain(value) && Object.hasOwn(value, key);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
function requireId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Invalid();
  return value;
}
function requireName(value) {
  if (
    typeof value !== 'string' ||
    !identifier.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  )
    throw new Invalid();
  return value;
}
function exact(value, keys) {
  if (
    !plain(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !own(value, key))
  )
    throw new Invalid();
}
function limit(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!positive(value) || value > maximum) throw new Invalid();
  return value;
}
function errorDTO(error, signal) {
  if (signal?.aborted) return { kind: 'transport', code: 'request_aborted' };
  if (error instanceof Invalid) return { kind: 'invalid', code: error.code };
  if (error instanceof Unexpected) return { kind: 'sdk', code: 'unexpected_response' };
  if (error instanceof ComfyError || error instanceof ApiError) {
    const result = { kind: 'sdk' };
    if (sdkCodes.has(error.code)) result.code = error.code;
    if (Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599)
      result.httpStatus = error.httpStatus;
    return result;
  }
  return { kind: 'transport' };
}
function diskPath(value) {
  if (
    typeof value !== 'string' ||
    value.length > 32768 ||
    !path.isAbsolute(value) ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Invalid('invalid_path');
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.startsWith('//') ||
    normalized.startsWith('/??/') ||
    normalized.toLowerCase().startsWith('/device/')
  )
    throw new Invalid('invalid_path');
  // Reject alternate data streams while retaining the ordinary Windows drive.
  if (normalized.slice(/^[a-z]:\//i.test(normalized) ? 2 : 0).includes(':'))
    throw new Invalid('invalid_path');
  return value;
}
function inside(filename, roots) {
  return roots.some((root) => {
    const relative = path.relative(root, filename);
    return (
      relative === '' ||
      (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
    );
  });
}
async function roots(values) {
  if (!Array.isArray(values) || values.length > 128) throw new Invalid('invalid_path');
  const result = [];
  for (const value of values) {
    try {
      const resolved = diskPath(await realpath(diskPath(value)));
      if (!(await stat(resolved)).isDirectory()) throw new Invalid('invalid_path');
      result.push(resolved);
    } catch {
      throw new Invalid('invalid_path');
    }
  }
  return [...new Set(result)];
}
async function inputPath(value, allowed) {
  try {
    const resolved = diskPath(await realpath(diskPath(value)));
    if (!inside(resolved, allowed) || !(await stat(resolved)).isFile())
      throw new Invalid('invalid_path');
    return resolved;
  } catch {
    throw new Invalid('invalid_path');
  }
}
async function outputPath(value, allowed) {
  try {
    diskPath(value);
    const parent = diskPath(await realpath(path.dirname(value)));
    if (!inside(parent, allowed)) throw new Invalid('invalid_path');
    const resolved = path.join(parent, path.basename(value));
    try {
      const existing = await lstat(resolved);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Invalid('invalid_path');
      if (!inside(diskPath(await realpath(resolved)), allowed)) throw new Invalid('invalid_path');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return resolved;
  } catch {
    throw new Invalid('invalid_path');
  }
}
function apiGraph(value) {
  let members = 0;
  const ancestors = new Set();
  function visit(item, depth) {
    if (++members > 250000 || depth > 64) throw new Invalid();
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if ((!Array.isArray(item) && !plain(item)) || ancestors.has(item)) throw new Invalid();
    ancestors.add(item);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) throw new Invalid();
        visit(item[index], depth + 1);
      }
    } else for (const itemValue of Object.values(item)) visit(itemValue, depth + 1);
    ancestors.delete(item);
  }
  if (!plain(value) || !Object.keys(value).length || Object.keys(value).length > 10000)
    throw new Invalid();
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > graphLimit) throw new Invalid();
  for (const [id, node] of Object.entries(value)) {
    requireName(id);
    if (
      !plain(node) ||
      typeof node.class_type !== 'string' ||
      node.class_type.length < 1 ||
      node.class_type.length > 160 ||
      !plain(node.inputs)
    )
      throw new Invalid();
  }
  return value;
}
function filename(value) {
  if (typeof value !== 'string') return 'output';
  const name = path.posix.basename(value.replaceAll('\\', '/').split(/[?#]/, 1)[0]);
  return /^[a-zA-Z0-9_. -]{1,255}$/.test(name) ? name : 'output';
}
function snapshot(job) {
  if (typeof job.id !== 'string' || !uuid.test(job.id) || !statuses.has(job.status))
    throw new Unexpected();
  const outputs = job.outputs;
  if (!Array.isArray(outputs) || outputs.length > 256) throw new Unexpected();
  return {
    id: job.id,
    status: job.status,
    error: job.error
      ? {
          code: sdkCodes.has(job.error.code) ? job.error.code : 'execution_error',
          message: 'The engine reported a job failure.',
        }
      : null,
    outputs: outputs.map((output) => {
      if (
        typeof output.id !== 'string' ||
        !uuid.test(output.id) ||
        typeof output.nodeId !== 'string' ||
        output.nodeId.length > 128
      )
        throw new Unexpected();
      return {
        id: output.id,
        nodeId: output.nodeId,
        name: filename(output.name),
        type:
          typeof output.type === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(output.type)
            ? output.type
            : 'file',
        sizeBytes:
          Number.isSafeInteger(output.sizeBytes) && output.sizeBytes >= 0 ? output.sizeBytes : null,
        contentType:
          typeof output.contentType === 'string' &&
          /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,128}$/i.test(output.contentType)
            ? output.contentType
            : 'application/octet-stream',
      };
    }),
  };
}

async function start() {
  let client, readRoots, writeRoots, maxPending, maxStreams, maxJobs;
  const pending = new Map(),
    streams = new Map(),
    jobs = new Map();
  let closing = false,
    streamSequence = 0,
    openingStreams = 0;
  const send = (message) => {
    if (!closing) {
      try {
        parentPort.postMessage(message);
      } catch {}
    }
  };
  function remember(job) {
    jobs.delete(job.id);
    jobs.set(job.id, job);
    while (jobs.size > maxJobs) jobs.delete(jobs.keys().next().value);
    return job;
  }
  async function loadJob(id, signal, fresh = false) {
    signal.throwIfAborted();
    const cached = jobs.get(id);
    if (cached && !fresh) return remember(cached);
    // SDK0.5 jobs.get has no signal argument. Its configured timeout bounds it;
    // aborting the RPC only suppresses this later result, not the remote request.
    const job = await client.jobs.get(id);
    signal.throwIfAborted();
    if (job.id !== id) throw new Unexpected();
    return remember(job);
  }
  async function closeStream(id) {
    const stream = streams.get(id);
    if (!stream) return;
    streams.delete(id);
    stream.controller.abort();
    let timer;
    const returned = Promise.resolve()
      .then(() => stream.iterator.return?.())
      .catch(() => {});
    try {
      await Promise.race([
        returned,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function cleanup() {
    if (closing) return;
    closing = true;
    for (const request of pending.values()) request.controller.abort();
    for (const id of [...streams.keys()]) void closeStream(id);
    jobs.clear();
    parentPort.close();
  }
  async function execute(op, args, request) {
    const signal = request.controller.signal;
    if (op === 'submit') {
      exact(args, ['graph', 'bindings', 'idempotencyKey']);
      const graph = apiGraph(args.graph);
      requireId(args.idempotencyKey);
      if (!Array.isArray(args.bindings) || args.bindings.length > 128) throw new Invalid();
      const seen = new Set(),
        bindings = [];
      for (const binding of args.bindings) {
        exact(binding, ['nodeId', 'input', 'path']);
        requireName(binding.nodeId);
        requireName(binding.input);
        if (!own(graph, binding.nodeId)) throw new Invalid();
        const key = JSON.stringify([binding.nodeId, binding.input]);
        if (seen.has(key)) throw new Invalid();
        seen.add(key);
        bindings.push({ ...binding, path: await inputPath(binding.path, readRoots) });
      }
      signal.throwIfAborted();
      const workflow = client.workflows.fromJson(graph);
      for (const binding of bindings)
        workflow.setInput(binding.nodeId, binding.input, client.assets.fromFile(binding.path));
      const job = await client.submit(workflow, { idempotencyKey: args.idempotencyKey, signal });
      signal.throwIfAborted();
      remember(job);
      return snapshot(job);
    }
    if (['get', 'refresh', 'cancel', 'events.open'].includes(op)) {
      exact(args, ['jobId']);
      requireId(args.jobId);
      if (op === 'events.open') {
        if (streams.size + openingStreams >= maxStreams) throw new Invalid('worker_busy');
        openingStreams++;
        try {
          const job = await loadJob(args.jobId, signal);
          signal.throwIfAborted();
          const controller = new AbortController();
          const streamId = ++streamSequence;
          streams.set(streamId, {
            openedByRequestId: request.id,
            controller,
            iterator: job.events(controller.signal)[Symbol.asyncIterator](),
            busy: false,
          });
          return { streamId };
        } finally {
          openingStreams--;
        }
      }
      const job = await loadJob(args.jobId, signal, op === 'get');
      if (op === 'refresh') await job.refresh(signal);
      if (op === 'cancel') await job.cancel(signal);
      signal.throwIfAborted();
      remember(job);
      return snapshot(job);
    }
    if (op === 'download') {
      exact(args, ['jobId', 'outputId', 'path']);
      requireId(args.jobId);
      requireId(args.outputId);
      const destination = await outputPath(args.path, writeRoots);
      signal.throwIfAborted();
      const job = await loadJob(args.jobId, signal);
      const output = job.outputs.find((item) => item.id === args.outputId);
      if (!output) throw new Invalid('output_not_found');
      const temporary = path.join(
        path.dirname(destination),
        '.aftertake-sdk-' + randomUUID() + '.tmp',
      );
      let created = false;
      try {
        const handle = await open(temporary, 'wx');
        created = true;
        await handle.close();
        await output.toFile(temporary, { signal, timeoutMs: downloadTimeout });
        signal.throwIfAborted();
        // Recheck the parent and destination before atomic publication.
        if ((await outputPath(destination, writeRoots)) !== destination)
          throw new Invalid('invalid_path');
        await rename(temporary, destination);
        return {};
      } finally {
        if (created) await unlink(temporary).catch(() => {});
      }
    }
    exact(args, ['streamId']);
    if (!positive(args.streamId)) throw new Invalid();
    if (op === 'events.close') {
      await closeStream(args.streamId);
      return {};
    }
    const stream = streams.get(args.streamId);
    if (!stream) throw new Invalid('stream_not_found');
    if (stream.busy) throw new Invalid('stream_busy');
    stream.busy = true;
    request.streamController = stream.controller;
    const aborted = () => stream.controller.abort();
    signal.addEventListener('abort', aborted, { once: true });
    try {
      let skipped = 0;
      while (true) {
        signal.throwIfAborted();
        const next = await stream.iterator.next();
        signal.throwIfAborted();
        if (next.done) {
          await closeStream(args.streamId);
          return { done: true };
        }
        const event = next.value;
        if (
          event?.kind === 'progress' &&
          typeof event.value === 'number' &&
          Number.isFinite(event.value)
        )
          return {
            done: false,
            event: {
              kind: 'progress',
              value: Math.max(0, Math.min(1, event.value)),
              currentNode:
                typeof event.currentNode === 'string' && identifier.test(event.currentNode)
                  ? event.currentNode
                  : null,
            },
          };
        if (++skipped % 64 === 0) await yieldTurn();
      }
    } catch (error) {
      await closeStream(args.streamId);
      throw error;
    } finally {
      stream.busy = false;
      signal.removeEventListener('abort', aborted);
    }
  }
  try {
    if (!plain(workerData)) throw new Invalid();
    maxPending = limit(workerData.maxPending, 32, 32);
    maxStreams = limit(workerData.maxStreams, 16, 16);
    maxJobs = limit(workerData.maxJobs, 64, 64);
    const timeoutMs = limit(workerData.sdkTimeoutMs, 30000, 30000);
    readRoots = await roots(workerData.readRoots);
    writeRoots = await roots(workerData.writeRoots);
    client = new Comfy({ timeoutMs });
    parentPort.on('message', (message) => {
      if (closing) return;
      if (plain(message) && message.type === 'close') {
        cleanup();
        return;
      }
      if (plain(message) && message.type === 'abort' && positive(message.id)) {
        const request = pending.get(message.id);
        request?.controller.abort();
        request?.streamController?.abort();
        // A deadline can race the open reply. Retain this bounded lease so a
        // late abort can release a stream whose ID the parent never observed.
        for (const [id, stream] of streams)
          if (stream.openedByRequestId === message.id) void closeStream(id);
        return;
      }
      if (!plain(message) || !positive(message.id)) return;
      const { id, op, args } = message;
      if (pending.has(id)) return;
      if (!operations.has(op) || !plain(args)) {
        send({ id, ok: false, error: { kind: 'invalid', code: 'invalid_request' } });
        return;
      }
      if (pending.size >= maxPending + (controls.has(op) ? 2 : 0)) {
        send({ id, ok: false, error: { kind: 'invalid', code: 'worker_busy' } });
        return;
      }
      const request = { id, controller: new AbortController() };
      pending.set(id, request);
      void execute(op, args, request)
        .then(
          (value) =>
            send(
              request.controller.signal.aborted
                ? { id, ok: false, error: errorDTO(undefined, request.controller.signal) }
                : { id, ok: true, value },
            ),
          (error) => send({ id, ok: false, error: errorDTO(error, request.controller.signal) }),
        )
        .finally(() => pending.delete(id));
    });
    parentPort.on('close', cleanup);
    send({ type: 'ready' });
  } catch (error) {
    send({ type: 'fatal', error: errorDTO(error) });
    cleanup();
  }
}

if (parentPort) void start();
