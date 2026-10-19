import { createHash } from 'node:crypto';
import type { RouterQuote } from '../src/router-video.js';

export type { RouterQuote } from '../src/router-video.js';

/** The deliberately bounded, native LTX Fast text-to-video contract we expose. */
export type RouterLtxInput = {
  prompt: string;
  duration: 2 | 3 | 4 | 5;
  resolution: '1280x720' | '720x1280';
  fps: 24;
  generate_audio: boolean;
};

type QueueStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
export type RouterStatus = QueueStatus | 'FAILED' | 'CANCELED';

export interface RouterClient {
  readonly fingerprint: string;
  probe(): Promise<{ authenticated: boolean; reachable: boolean }>;
  estimate(body: RouterLtxInput): Promise<RouterQuote>;
  submit(body: RouterLtxInput, key: string): Promise<{ requestId: string; status: QueueStatus }>;
  status(requestId: string): Promise<{ status: RouterStatus; retryAfterMs: number }>;
  result(requestId: string): Promise<{ videoUrl: string }>;
  /** An accepted cancellation is only an ask. Keep polling the original request. */
  cancel(requestId: string): Promise<void>;
}

const modelUrl = 'https://api.comfy.org/v2/models/ltx/ltx-2-5-fast';
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const queueStatuses = new Set(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']);
const knownErrors = new Set([
  'invalid_input',
  'content_policy_violation',
  'provider_error',
  'provider_timeout',
  'insufficient_credits',
  'model_not_found',
  'unauthorized',
  'forbidden',
  'concurrency_limit_exceeded',
  'client_disconnected',
  'internal_error',
  'deadline_exceeded',
  'not_enabled',
  'service_unavailable',
  'rate_limited',
  'cancelled',
  'queue_timeout',
  'request_not_found',
  'queue_backlog_full',
]);

const messages: Record<string, string> = {
  connection_required: 'Connect the Comfy API key used for this generation.',
  connection_changed: 'Reconnect the original Comfy API key to continue this generation.',
  invalid_input: 'Check the supported LTX generation settings.',
  invalid_credential: 'Supply a valid Comfy API key.',
  invalid_request_id: 'This Router generation has an invalid request identifier.',
  invalid_idempotency_key: 'This Router generation has an invalid submission key.',
  unauthorized: 'Comfy did not accept this API key.',
  forbidden: 'This Comfy account cannot use this operation.',
  insufficient_credits: 'This Comfy account has insufficient credits for the generation.',
  not_enabled: 'This Comfy operation is not enabled for the account.',
  model_not_found: 'The selected LTX model is unavailable.',
  request_not_found: 'Comfy could not find this generation under the connected account.',
  content_policy_violation: 'The provider refused this generation under its content policy.',
  cancelled: 'Comfy reports that this generation was canceled.',
  result_pending: 'The Router generation is still running. Check its status again.',
  malformed_response: 'Comfy returned an unexpected response. Keep the original generation handle.',
  transport_error: 'The Comfy request could not be confirmed. Keep the original submission key.',
};

/** Contains only fixed text and allowlisted codes, never provider text or a cause. */
export class RouterError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly definitiveRejection = false,
    readonly retryAfterMs = 3000,
  ) {
    super(messages[code] ?? 'Comfy could not complete this operation. Keep the generation handle.');
    this.name = 'RouterError';
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function malformed(): never {
  throw new RouterError(502, 'malformed_response');
}

function nativeInput(body: RouterLtxInput): RouterLtxInput {
  if (
    typeof body?.prompt !== 'string' ||
    !body.prompt.trim() ||
    body.prompt.length > 10000 ||
    ![2, 3, 4, 5].includes(body.duration) ||
    !['1280x720', '720x1280'].includes(body.resolution) ||
    body.fps !== 24 ||
    typeof body.generate_audio !== 'boolean'
  ) {
    throw new RouterError(400, 'invalid_input', true);
  }
  // Do not accidentally forward local metadata, credentials or provider overrides.
  return {
    prompt: body.prompt,
    duration: body.duration,
    resolution: body.resolution,
    fps: 24,
    generate_audio: body.generate_audio,
  };
}

function requestUrl(requestId: string, suffix = ''): string {
  if (!requestIdPattern.test(requestId)) {
    throw new RouterError(400, 'invalid_request_id');
  }
  return `${modelUrl}/requests/${requestId}${suffix}`;
}

function retryAfter(response: Response): number {
  const raw = response.headers.get('Retry-After');
  if (raw && /^\d+$/.test(raw)) {
    return Math.min(300000, Math.max(1000, Number(raw) * 1000));
  }
  return 3000;
}

/** Bounded JSON reading also covers a provider that stalls after sending headers. */
async function json(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('Content-Type') ?? '')) {
    await response.body?.cancel();
    return malformed();
  }
  if (!response.body) return malformed();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const aborted = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', aborted, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > 131072) return malformed();
      chunks.push(value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) ?? malformed();
  } catch (error) {
    if (error instanceof RouterError) throw error;
    if (signal.aborted) throw new RouterError(503, 'transport_error');
    return malformed();
  } finally {
    signal.removeEventListener('abort', aborted);
    await reader.cancel().catch(() => undefined);
  }
}

function knownCode(value: unknown): string {
  return typeof value === 'string' && knownErrors.has(value) ? value : 'internal_error';
}

function isDefinitiveRejection(response: Response, code: string): boolean {
  // In particular, 409 can refer to an existing, consumed idempotency key.
  // A provider response and every 5xx/network failure remain ambiguous.
  if (response.headers.has('X-Comfy-Upstream-Status')) return false;
  return (
    ([400, 413, 422].includes(response.status) && code === 'invalid_input') ||
    (response.status === 401 && code === 'unauthorized') ||
    (response.status === 402 && code === 'insufficient_credits') ||
    (response.status === 403 && ['forbidden', 'not_enabled'].includes(code)) ||
    (response.status === 404 && code === 'model_not_found') ||
    (response.status === 429 &&
      ['queue_backlog_full', 'rate_limited', 'concurrency_limit_exceeded'].includes(code))
  );
}

function quote(value: Record<string, unknown>): RouterQuote {
  const decimal = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && /^\d{1,12}(?:\.\d{1,8})?$/.test(candidate);
  const pricingAsOf =
    typeof value.pricing_as_of === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value.pricing_as_of) &&
    Number.isFinite(Date.parse(value.pricing_as_of))
      ? value.pricing_as_of
      : undefined;
  if (value.currency === 'USD' && value.source === 'exact' && decimal(value.amount)) {
    return {
      source: 'exact',
      currency: 'USD',
      amount: value.amount,
      ...(typeof value.credits === 'number' && Number.isFinite(value.credits) && value.credits >= 0
        ? { credits: value.credits }
        : {}),
      ...(pricingAsOf ? { pricingAsOf } : {}),
    };
  }
  if (
    value.currency === 'USD' &&
    value.source === 'estimated' &&
    decimal(value.min_amount) &&
    decimal(value.max_amount) &&
    Number(value.min_amount) <= Number(value.max_amount)
  ) {
    return {
      source: 'estimated',
      currency: 'USD',
      minAmount: value.min_amount,
      maxAmount: value.max_amount,
      ...(pricingAsOf ? { pricingAsOf } : {}),
    };
  }
  return {
    source: 'unknown',
    currency: 'USD',
    reason:
      typeof value.reason === 'string' &&
      ['not_quotable', 'unpriced_model', 'byok', 'pricing_unavailable'].includes(value.reason)
        ? value.reason
        : 'not_quotable',
  };
}

function createClient(apiKey: string, request: typeof fetch): RouterClient {
  const fingerprint = createHash('sha256').update(apiKey).digest('hex');

  async function send(url: string, init: RequestInit = {}) {
    const signal = AbortSignal.timeout(30000);
    try {
      const response = await request(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        redirect: 'error',
        signal,
      });
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new RouterError(502, 'transport_error');
      }
      return { response, signal };
    } catch (error) {
      if (error instanceof RouterError) throw error;
      throw new RouterError(503, 'transport_error');
    }
  }

  async function failure(response: Response, signal: AbortSignal): Promise<RouterError> {
    let code = knownCode(response.headers.get('X-Comfy-Error-Type'));
    // Unknown header values stay unknown rather than trusting conflicting body text.
    if (!response.headers.has('X-Comfy-Error-Type')) {
      try {
        code = knownCode((await json(response, signal)).error_type);
      } catch {
        // The known HTTP rejection is not definitive without its known error bucket.
      }
    } else {
      await response.body?.cancel();
    }
    return new RouterError(
      response.status >= 400 && response.status <= 599 ? response.status : 502,
      code,
      isDefinitiveRejection(response, code),
      retryAfter(response),
    );
  }

  return Object.freeze({
    fingerprint,
    async probe() {
      try {
        const { response } = await send(modelUrl);
        await response.body?.cancel();
        // Catalog access proves authentication only, not credits or dispatch eligibility.
        return { authenticated: response.status === 200, reachable: true };
      } catch {
        return { authenticated: false, reachable: false };
      }
    },
    async estimate(body) {
      const { response, signal } = await send(`${modelUrl}/estimate`, {
        method: 'POST',
        body: JSON.stringify(nativeInput(body)),
      });
      if (response.status !== 200) {
        const error = await failure(response, signal);
        if (response.status === 403 && error.code === 'not_enabled') {
          return { source: 'unknown', currency: 'USD', reason: 'not_enabled' };
        }
        throw error;
      }
      return quote(await json(response, signal));
    },
    async submit(body, key) {
      if (typeof key !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(key)) {
        throw new RouterError(400, 'invalid_idempotency_key', true);
      }
      // Native input only. The queue has no fallback loop; do not select an alternate provider.
      const { response, signal } = await send(`${modelUrl}/requests?reject_unknown_fields=true`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(nativeInput(body)),
      });
      if (response.status !== 201) throw await failure(response, signal);
      const value = await json(response, signal);
      if (
        typeof value.request_id !== 'string' ||
        !requestIdPattern.test(value.request_id) ||
        !queueStatuses.has(value.status as string)
      ) {
        return malformed();
      }
      return { requestId: value.request_id, status: value.status as QueueStatus };
    },
    async status(requestId) {
      const { response, signal } = await send(requestUrl(requestId, '/status'));
      if (response.status !== 200) throw await failure(response, signal);
      const value = await json(response, signal);
      if (value.request_id !== requestId || !queueStatuses.has(value.status as string)) {
        return malformed();
      }
      if (Object.hasOwn(value, 'error_type')) {
        if (value.status !== 'COMPLETED' || typeof value.error_type !== 'string')
          return malformed();
        return {
          status: value.error_type === 'cancelled' ? 'CANCELED' : 'FAILED',
          retryAfterMs: retryAfter(response),
        };
      }
      return { status: value.status as QueueStatus, retryAfterMs: retryAfter(response) };
    },
    async result(requestId) {
      const { response, signal } = await send(requestUrl(requestId));
      if (response.status === 202) {
        await response.body?.cancel();
        throw new RouterError(409, 'result_pending', false, retryAfter(response));
      }
      if (response.status !== 200) throw await failure(response, signal);
      const value = await json(response, signal);
      if (value.status !== 'completed') return malformed();
      const videoUrl = object(value.result)?.video_url;
      if (typeof videoUrl !== 'string' || videoUrl.length > 16384) return malformed();
      try {
        const parsed = new URL(videoUrl);
        if (
          parsed.protocol !== 'https:' ||
          parsed.username ||
          parsed.password ||
          !parsed.hostname
        ) {
          return malformed();
        }
      } catch {
        return malformed();
      }
      // This signed URL is for the output collector only; never place it in public job data.
      return { videoUrl };
    },
    async cancel(requestId) {
      const { response, signal } = await send(requestUrl(requestId, '/cancel'), { method: 'PUT' });
      if (![202, 409].includes(response.status)) throw await failure(response, signal);
      const value = await json(response, signal);
      if (
        value.request_id !== requestId ||
        (response.status === 202 && value.status !== 'CANCELLATION_REQUESTED') ||
        (response.status === 409 && value.status !== 'ALREADY_COMPLETED')
      ) {
        return malformed();
      }
    },
  } satisfies RouterClient);
}

/** No environment mutation, SDK reconfiguration, disk persistence or automatic POST retries. */
export function createRouterConnection({ fetch: request = fetch }: { fetch?: typeof fetch } = {}) {
  let current: RouterClient | undefined;
  return {
    configure(apiKey: string | undefined): boolean {
      const key = apiKey?.trim();
      if (!key) {
        current = undefined;
        return false;
      }
      if (!/^[\x21-\x7e]{1,1024}$/.test(key)) {
        throw new RouterError(400, 'invalid_credential', true);
      }
      current = createClient(key, request);
      return true;
    },
    disconnect(): void {
      current = undefined;
    },
    snapshot(): { configured: boolean; credentialFingerprint?: string } {
      return current
        ? { configured: true, credentialFingerprint: current.fingerprint }
        : { configured: false };
    },
    capture(expectedFingerprint?: string): RouterClient {
      if (!current) throw new RouterError(409, 'connection_required');
      if (expectedFingerprint !== undefined && expectedFingerprint !== current.fingerprint) {
        throw new RouterError(409, 'connection_changed');
      }
      return current;
    },
  };
}
