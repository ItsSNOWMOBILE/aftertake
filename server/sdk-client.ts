import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { ComfyError } from '@comfyorg/sdk';
import { canonicalNativeBaseUrl } from './job-target.js';
import type {
  EngineClient,
  EngineJob,
  EngineOutput,
  EngineProgress,
  EngineWorkflow,
} from './sdk-port.js';

const safeCodes = new Set([
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
const statuses = new Set([
  'queued',
  'running',
  'canceling',
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function failure(code: string, httpStatus?: number) {
  const messages: Record<string, string> = {
    invalid_workflow: 'The engine rejected the workflow. Check its required nodes and inputs.',
    workflow_format_ui: 'Use an API-format workflow for generation.',
    missing_asset: 'A required generation asset is unavailable.',
    hash_mismatch: 'The engine rejected an asset whose content hash did not match.',
    blob_not_found: 'A required uploaded asset is unavailable.',
    unauthorized: 'The engine refused this credential.',
    forbidden: 'This connection cannot perform the requested engine operation.',
    insufficient_credits: 'This account has insufficient generation credits.',
    queue_full: 'The engine queue is full. Keep the original request for recovery.',
    missing_credentials: 'This engine connection requires a credential.',
    request_aborted: 'The engine request was interrupted. Keep its original identity for recovery.',
    request_timeout: 'The engine request timed out. Keep its original identity for recovery.',
    worker_busy:
      'The engine connection has too many pending requests. Try again after they finish.',
    worker_unavailable: 'The engine connection stopped. Keep the original job for recovery.',
    execution_error: 'The workflow failed on the engine.',
  };
  return new ComfyError(
    messages[code] ||
      'The engine could not complete this operation. Keep the original job for review or recovery.',
    {
      code: safeCodes.has(code) ? code : 'unexpected_response',
      ...(Number.isInteger(httpStatus) && httpStatus! >= 400 && httpStatus! <= 599
        ? { httpStatus }
        : {}),
    },
  );
}

function remoteFailure(value: unknown) {
  const dto = value as { kind?: unknown; code?: unknown; httpStatus?: unknown } | null;
  if (
    dto?.kind === 'invalid' &&
    [
      'invalid_request',
      'invalid_path',
      'output_not_found',
      'stream_not_found',
      'stream_busy',
    ].includes(String(dto.code))
  )
    return failure('invalid_workflow', 400);
  const code =
    typeof dto?.code === 'string' && safeCodes.has(dto.code) ? dto.code : 'unexpected_response';
  return failure(code, typeof dto?.httpStatus === 'number' ? dto.httpStatus : undefined);
}

function inside(filename: string, roots: readonly string[]) {
  if (!path.isAbsolute(filename) || /^(?:\\\\|\/\/)/.test(filename) || /[\x00-\x1f]/.test(filename))
    throw failure('invalid_workflow', 400);
  const absolute = path.resolve(filename);
  if (
    !roots.some((root) => {
      const relative = path.relative(root, absolute);
      return (
        relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
      );
    })
  )
    throw failure('invalid_workflow', 400);
  return absolute;
}

class FileInput {
  #owner: symbol;
  #filename: string;
  constructor(owner: symbol, filename: string) {
    this.#owner = owner;
    this.#filename = filename;
  }
  binding(owner: symbol) {
    if (owner !== this.#owner) throw failure('invalid_workflow', 400);
    return this.#filename;
  }
}

type Binding = { nodeId: string; input: string; path: string };
class WorkflowInput implements EngineWorkflow {
  #owner: symbol;
  #graph: Record<string, any>;
  #bindings = new Map<string, Binding>();
  constructor(owner: symbol, graph: Record<string, any>) {
    this.#owner = owner;
    try {
      const json = JSON.stringify(graph);
      if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw Error();
      this.#graph = JSON.parse(json);
      if (!this.#graph || Array.isArray(this.#graph) || typeof this.#graph !== 'object')
        throw Error();
    } catch {
      throw failure('invalid_workflow', 400);
    }
  }
  setInput(nodeId: string, input: string, value: unknown) {
    const node = this.#graph[nodeId];
    if (
      !Object.hasOwn(this.#graph, nodeId) ||
      !node?.inputs ||
      typeof node.inputs !== 'object' ||
      input.length > 128
    )
      throw failure('invalid_workflow', 400);
    const key = JSON.stringify([nodeId, input]);
    if (value instanceof FileInput) {
      if (this.#bindings.size >= 128 && !this.#bindings.has(key))
        throw failure('invalid_workflow', 400);
      this.#bindings.set(key, { nodeId, input, path: value.binding(this.#owner) });
    } else {
      this.#bindings.delete(key);
      node.inputs[input] = structuredClone(value);
    }
    return this;
  }
  payload(owner: symbol) {
    if (owner !== this.#owner) throw failure('invalid_workflow', 400);
    try {
      // Inputs may change after construction; enforce the wire bound before IPC cloning.
      const json = JSON.stringify(this.#graph);
      if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw Error();
      return { graph: JSON.parse(json), bindings: [...this.#bindings.values()] };
    } catch {
      throw failure('invalid_workflow', 400);
    }
  }
}

type OutputSnapshot = {
  id: string;
  nodeId: string;
  name: string;
  type: string;
  sizeBytes: number | null;
  contentType: string;
};
type Snapshot = {
  id: string;
  status: string;
  error: { code?: string; message: string } | null;
  outputs: OutputSnapshot[];
};
function snapshot(value: unknown): Snapshot {
  const dto = value as Snapshot;
  if (
    !dto ||
    !uuid.test(dto.id) ||
    !statuses.has(dto.status) ||
    !Array.isArray(dto.outputs) ||
    dto.outputs.length > 256
  )
    throw failure('unexpected_response');
  const outputs = dto.outputs.map((output) => {
    if (
      !output ||
      !uuid.test(output.id) ||
      typeof output.nodeId !== 'string' ||
      output.nodeId.length > 128
    )
      throw failure('unexpected_response');
    return {
      id: output.id,
      nodeId: output.nodeId,
      name: String(output.name || '').slice(0, 200),
      type: String(output.type || '').slice(0, 40),
      sizeBytes:
        typeof output.sizeBytes === 'number' &&
        Number.isFinite(output.sizeBytes) &&
        output.sizeBytes >= 0
          ? output.sizeBytes
          : null,
      contentType: String(output.contentType || '').slice(0, 100),
    };
  });
  const error = dto.error ? remoteFailure(dto.error) : null;
  return {
    id: dto.id,
    status: dto.status,
    outputs,
    error: error ? { code: error.code, message: error.message } : null,
  };
}

export type IsolatedClientOptions = {
  baseUrl: string;
  apiKey?: string;
  readRoots: string[];
  writeRoots: string[];
  maxPending?: number;
  rpcTimeoutMs?: number;
  ioTimeoutMs?: number;
  startupTimeoutMs?: number;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  dispose: () => void;
};

export class IsolatedClient implements EngineClient {
  #worker: Worker;
  #owner = Symbol('engine connection');
  #pending = new Map<number, Pending>();
  #nextId = 0;
  #closed = false;
  #termination?: Promise<number>;
  #maxPending: number;
  #rpcTimeoutMs: number;
  #ioTimeoutMs: number;
  #readRoots: string[];
  #writeRoots: string[];
  #ready: Promise<void>;
  #stopReady!: (error?: Error) => void;

  readonly assets = {
    fromFile: (filename: string) => new FileInput(this.#owner, inside(filename, this.#readRoots)),
  };
  readonly workflows = {
    fromJson: (graph: Record<string, any>) => new WorkflowInput(this.#owner, graph),
  };
  readonly jobs = {
    get: async (id: string): Promise<EngineJob> =>
      new IsolatedJob(this, snapshot(await this.request('get', { jobId: id }))),
  };

  constructor(options: IsolatedClientOptions) {
    const baseUrl = canonicalNativeBaseUrl(options.baseUrl);
    const bounded = (value: number | undefined, fallback: number, max: number) => {
      const number = value ?? fallback;
      if (!Number.isInteger(number) || number < 1 || number > max)
        throw failure('invalid_workflow', 400);
      return number;
    };
    this.#maxPending = bounded(options.maxPending, 32, 32);
    this.#rpcTimeoutMs = bounded(options.rpcTimeoutMs, 120000, 1200000);
    this.#ioTimeoutMs = bounded(options.ioTimeoutMs, 1200000, 3600000);
    const startupTimeoutMs = bounded(options.startupTimeoutMs, 15000, 120000);
    const roots = (values: string[]) => {
      if (!Array.isArray(values) || !values.length || values.length > 16)
        throw failure('invalid_workflow', 400);
      return values.map((value) => {
        if (typeof value !== 'string') throw failure('invalid_workflow', 400);
        return inside(value, [path.parse(path.resolve(value)).root]);
      });
    };
    this.#readRoots = roots(options.readRoots);
    this.#writeRoots = roots(options.writeRoots);
    if (
      options.apiKey !== undefined &&
      (typeof options.apiKey !== 'string' ||
        /[\s\x00-\x1f\x7f]/.test(options.apiKey) ||
        options.apiKey.length > 4096)
    )
      throw failure('missing_credentials');
    this.#worker = new Worker(new URL('./sdk-worker.mjs', import.meta.url), {
      execArgv: [],
      env: { ...process.env, COMFY_BASE_URL: baseUrl, COMFY_API_KEY: options.apiKey || '' },
      workerData: {
        readRoots: this.#readRoots,
        writeRoots: this.#writeRoots,
        sdkTimeoutMs: 30000,
        maxPending: this.#maxPending,
        maxStreams: 16,
        maxJobs: 64,
      },
      stdout: true,
      stderr: true,
    });
    // SDK/dependency diagnostic text must never leak credentials through worker stdio.
    this.#worker.stdout?.resume();
    this.#worker.stderr?.resume();
    this.#ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(failure('worker_unavailable')), startupTimeoutMs);
      this.#stopReady = (error) => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
    });
    this.#worker.on('message', (message) => {
      if (message?.type === 'ready') return this.#stopReady();
      if (message?.type === 'fatal') return this.fail(remoteFailure(message.error));
      if (!Number.isSafeInteger(message?.id)) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      pending.dispose();
      if (message.ok === true) pending.resolve(message.value);
      else pending.reject(remoteFailure(message.error));
    });
    this.#worker.on('error', () => this.fail(failure('worker_unavailable')));
    this.#worker.on('messageerror', () => this.fail(failure('worker_unavailable')));
    this.#worker.on('exit', () => this.fail(failure('worker_unavailable')));
  }

  async ready() {
    await this.#ready;
    return this;
  }
  get available() {
    return !this.#closed;
  }

  private fail(error: Error) {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopReady(error);
    for (const pending of this.#pending.values()) {
      pending.dispose();
      pending.reject(error);
    }
    this.#pending.clear();
    this.#termination = this.#worker.terminate();
  }

  async request(op: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    await this.#ready;
    if (this.#closed) throw failure('worker_unavailable');
    if (signal?.aborted) throw failure('request_aborted');
    const control = op === 'cancel' || op === 'events.close';
    if (this.#pending.size >= this.#maxPending + (control ? 2 : 0)) throw failure('worker_busy');
    const id = ++this.#nextId;
    const timeoutMs =
      op === 'submit' || op === 'download' || op === 'events.next'
        ? this.#ioTimeoutMs
        : this.#rpcTimeoutMs;
    return new Promise((resolve, reject) => {
      const stop = (code: string) => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        pending.dispose();
        try {
          this.#worker.postMessage({ type: 'abort', id });
        } catch {
          /* Worker failure is uncertain. */
        }
        reject(failure(code));
      };
      const onAbort = () => stop('request_aborted');
      const timer = setTimeout(() => stop('request_timeout'), timeoutMs);
      this.#pending.set(id, {
        resolve,
        reject,
        dispose: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.#worker.postMessage({ id, op, args });
      } catch {
        stop('worker_unavailable');
      }
    });
  }

  async submit(
    workflow: EngineWorkflow,
    options: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<EngineJob> {
    if (!(workflow instanceof WorkflowInput) || !uuid.test(options.idempotencyKey))
      throw failure('invalid_workflow', 400);
    const payload = workflow.payload(this.#owner);
    return new IsolatedJob(
      this,
      snapshot(
        await this.request(
          'submit',
          { ...payload, idempotencyKey: options.idempotencyKey },
          options.signal,
        ),
      ),
    );
  }

  async download(jobId: string, outputId: string, filename: string) {
    const destination = inside(filename, this.#writeRoots);
    await this.request('download', { jobId, outputId, path: destination });
    return destination;
  }

  async close() {
    this.fail(failure('worker_unavailable'));
    await this.#termination;
  }
}

class IsolatedJob implements EngineJob {
  #client: IsolatedClient;
  #snapshot: Snapshot;
  constructor(client: IsolatedClient, initial: Snapshot) {
    this.#client = client;
    this.#snapshot = initial;
  }
  get id() {
    return this.#snapshot.id;
  }
  get status() {
    return this.#snapshot.status;
  }
  get error() {
    return structuredClone(this.#snapshot.error);
  }
  async refresh(signal?: AbortSignal) {
    this.#snapshot = snapshot(await this.#client.request('refresh', { jobId: this.id }, signal));
    return this;
  }
  async cancel(signal?: AbortSignal) {
    this.#snapshot = snapshot(await this.#client.request('cancel', { jobId: this.id }, signal));
    return this;
  }
  getOutputs(nodeId: string): EngineOutput[] {
    return this.#snapshot.outputs
      .filter((output) => output.nodeId === nodeId)
      .map((output) => ({
        toFile: (filename: string) => this.#client.download(this.id, output.id, filename),
      }));
  }
  async *events(signal?: AbortSignal): AsyncGenerator<EngineProgress> {
    if (signal?.aborted) return;
    const opened = (await this.#client.request('events.open', { jobId: this.id }, signal)) as {
      streamId?: unknown;
    };
    const streamId = opened?.streamId;
    if (!Number.isSafeInteger(streamId) || (streamId as number) < 1)
      throw failure('unexpected_response');
    try {
      while (!signal?.aborted) {
        const next = (await this.#client.request('events.next', { streamId }, signal)) as {
          done: boolean;
          event?: EngineProgress;
        };
        if (next.done === true) return;
        if (next.event?.kind !== 'progress' || !Number.isFinite(next.event.value))
          throw failure('unexpected_response');
        yield {
          kind: 'progress',
          value: Math.max(0, Math.min(1, next.event.value)),
          currentNode:
            typeof next.event.currentNode === 'string'
              ? next.event.currentNode.slice(0, 128)
              : null,
        };
      }
    } finally {
      await this.#client.request('events.close', { streamId }).catch(() => {});
    }
  }
}

export async function createIsolatedClient(options: IsolatedClientOptions) {
  return new IsolatedClient(options).ready();
}
