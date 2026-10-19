import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  routerVideoModel,
  routerVideoRequestSchema,
  routerVideoTerminal,
  type RouterConnectionStatus,
  type RouterQuote,
  type RouterVideoGeneration,
  type RouterVideoRequest,
} from '../src/router-video.js';
import { contentDigest } from './edit-plan.js';

type Register = (
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: any) => Promise<{ data: any }>,
  readOnly?: boolean,
) => void;
const requestIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const selectorSchema = z
  .object({ id: z.string().uuid().optional(), requestId: requestIdSchema.optional() })
  .strict()
  .refine((value) => !!value.id !== !!value.requestId, 'Choose exactly one id or requestId.');
const route = '/api/router-videos';
const keyFor = (requestId: string) =>
  'agent-router-video-' + createHash('sha256').update(requestId).digest('hex');

class StudioFailure extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly video?: RouterVideoGeneration,
  ) {
    super(message);
  }
}

/** Keys are configured in the Studio UI; no credential enters any MCP tool. */
export function registerRouterTools(context: {
  tool: Register;
  base: string;
  state: string;
  fetch?: typeof globalThis.fetch;
}) {
  const base = new URL(context.base);
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw Error('Hosted video MCP tools require a loopback Aftertake studio origin.');
  const fetch = context.fetch || globalThis.fetch;
  const { tool } = context;
  const intentSchema = z
    .object({
      format: z.literal('aftertake-agent-router-intent/1'),
      base: z.literal(base.origin),
      requestId: requestIdSchema,
      requestKey: z.string(),
      scope: z.string().min(1).max(128),
      createdAt: z.iso.datetime(),
      request: routerVideoRequestSchema,
      digest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
  type Intent = z.infer<typeof intentSchema>;

  async function api<T>(suffix = '', body?: unknown, intent?: Intent): Promise<T> {
    const response = await fetch(base.origin + route + suffix, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers:
        body === undefined
          ? undefined
          : {
              'Content-Type': 'application/json',
              ...(intent
                ? {
                    'Idempotency-Key': intent.requestKey,
                    'X-Aftertake-Admission-Scope': intent.scope,
                  }
                : {}),
            },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),
    });
    let value;
    try {
      value = await response.json();
    } catch {
      throw new StudioFailure(
        'The studio response could not be confirmed. Keep the original requestId and recover it before starting another take.',
      );
    }
    if (!response.ok)
      throw new StudioFailure(
        typeof value.error === 'string'
          ? value.error
          : `The studio request failed (${response.status}).`,
        response.status,
        value.code,
        value.video,
      );
    return value;
  }
  const intentFilename = (requestId: string) =>
    path.join(context.state, keyFor(requestId) + '.json');
  async function readIntent(requestId: string) {
    let source: string;
    try {
      source = await readFile(intentFilename(requestId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw Error('The original hosted request cannot be read. No submission was attempted.');
    }
    try {
      const value = intentSchema.parse(JSON.parse(source));
      const { digest, ...input } = value;
      if (
        value.requestId !== requestId ||
        value.requestKey !== keyFor(requestId) ||
        digest !== contentDigest(input)
      )
        throw Error('Changed request');
      return value;
    } catch {
      throw Error(
        'The saved hosted request changed or is incomplete. Keep it for review; no provider action was attempted.',
      );
    }
  }
  async function prepareIntent(requestId: string, request: RouterVideoRequest): Promise<Intent> {
    const saved = await readIntent(requestId);
    if (saved) {
      if (contentDigest(saved.request) !== contentDigest(request))
        throw Error(
          'This requestId belongs to different hosted inputs. Keep the original inputs to recover it; use a new ID only for a deliberate new take.',
        );
      return saved;
    }
    const connection = await api<RouterConnectionStatus>('/connection');
    if (connection.admissionIssue) throw Error(connection.admissionIssue);
    if (!connection.configured || connection.authenticated === false)
      throw Error(
        'Connect your Comfy API key in the hosted video studio before generating. No credential can be supplied through MCP.',
      );
    if (typeof connection.admissionScope !== 'string' || !connection.admissionScope)
      throw Error('Restart the studio with persistent hosted request support before generating.');
    const input = {
      format: 'aftertake-agent-router-intent/1' as const,
      base: base.origin,
      requestId,
      requestKey: keyFor(requestId),
      scope: connection.admissionScope,
      createdAt: new Date().toISOString(),
      request,
    };
    const intent = intentSchema.parse({ ...input, digest: contentDigest(input) });
    await mkdir(context.state, { recursive: true });
    try {
      // Exclusive, write-once creation prevents concurrent calls changing the
      // first admission's scope. A partial write is rejected rather than retried.
      await writeFile(intentFilename(requestId), JSON.stringify(intent, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      return intent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw Error('The hosted request could not be saved. No generation was submitted.');
      const existing = await readIntent(requestId);
      if (!existing || contentDigest(existing.request) !== contentDigest(request))
        throw Error(
          'A concurrent call saved different inputs for this requestId. No replacement was submitted.',
        );
      return existing;
    }
  }
  async function records() {
    const values = await api<RouterVideoGeneration[]>();
    if (!Array.isArray(values))
      throw Error('The studio did not return saved hosted requests. No submission was attempted.');
    return values;
  }
  async function lookup(selector: { id?: string; requestId?: string }) {
    const values = await records();
    return values.find((value) =>
      selector.id ? value.id === selector.id : value.requestKey === keyFor(selector.requestId!),
    );
  }
  function summary(video: RouterVideoGeneration, requestId?: string) {
    return {
      requestId,
      id: video.id,
      provider: 'comfy-router',
      model: routerVideoModel,
      state: video.state,
      stage: video.stage,
      progress: video.progress,
      error: video.error,
      requestKey: video.requestKey,
      requestDigest: video.requestDigest,
      providerRequestId: video.providerRequestId,
      target: video.target,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
      clip: video.clip,
      price: video.price,
      portableRequest: base.origin + route + '/' + z.string().uuid().parse(video.id) + '/request',
      handoff: video.clip
        ? 'Inspect actual video and generated audio. Use its clipId with aftertake_use_source, then edit in Film.'
        : undefined,
    };
  }
  function assertInputs(video: RouterVideoGeneration, request: RouterVideoRequest) {
    if (contentDigest(video.request) !== contentDigest(request))
      throw Error(
        'This requestId is already bound to different hosted inputs. It cannot be retargeted.',
      );
  }
  async function submit(intent: Intent) {
    try {
      const video = await api<RouterVideoGeneration>('', intent.request, intent);
      if (video.requestKey !== intent.requestKey)
        throw Error('The studio did not confirm the original hosted request key.');
      assertInputs(video, intent.request);
      return {
        data: {
          ...summary(video, intent.requestId),
          next: 'Retain this requestId. Poll aftertake_hosted_video_status; recover uncertainty with aftertake_recover_hosted_video. No automatic retries or new operation keys are created.',
        },
      };
    } catch (error) {
      const failure = error as StudioFailure;
      if (failure.video?.requestKey === intent.requestKey) {
        assertInputs(failure.video, intent.request);
        return {
          data: {
            ...summary(failure.video, intent.requestId),
            next: 'The studio retained the original record. Poll or recover this same requestId; a timeout is not permission to create another take.',
          },
        };
      }
      return {
        data: {
          requestId: intent.requestId,
          requestKey: intent.requestKey,
          state:
            failure.code === 'admission_scope_changed'
              ? 'admission_unresolved'
              : [400, 409, 422].includes(failure.status || 0)
                ? 'rejected_before_admission'
                : 'submission_unconfirmed',
          error:
            failure instanceof StudioFailure
              ? failure.message
              : 'The original submission could not be confirmed.',
          originalScopeRetained: true,
          next:
            failure.code === 'admission_scope_changed'
              ? 'The server session changed and its original record is missing. Do not refresh the scope or invent a new requestId. Review the original provider/workspace before any deliberate replacement.'
              : 'Keep the original requestId and inputs. Status checks saved records; explicit recovery uses only the original request key and scope.',
        },
      };
    }
  }
  async function known(selector: { id?: string; requestId?: string }) {
    const video = await lookup(selector);
    if (!video)
      throw Error(
        'No saved hosted generation matches this identifier. Check status and retain the original requestId; no replacement has been submitted.',
      );
    z.string().uuid().parse(video.id);
    return video;
  }

  tool(
    'aftertake_hosted_video_connection',
    'Read the hosted LTX connection. An optional read-only probe checks the configured Comfy account without generating or spending generation credits. API keys must be entered in the Studio UI; no credential tool is exposed.',
    z.object({ probe: z.boolean().default(false) }).strict(),
    async ({ probe }) => ({
      data: {
        connection: await api<RouterConnectionStatus>(
          '/connection' + (probe ? '/probe' : ''),
          probe ? {} : undefined,
        ),
        model: routerVideoModel,
        capabilities: {
          aspects: ['landscape', 'portrait'],
          seconds: [2, 3, 4, 5],
          generatedAudio: true,
          seedControl: false,
          localGpuRequired: false,
        },
        billing:
          'Explicit generation and uncertain original-request recovery can contact the hosted provider and use the connected workspace credits. Key setup is through the hosted video Studio UI only.',
        distinction:
          'This hosted model API is separate from the native H3 character and painted-region workflows. Competition category eligibility is not asserted.',
      },
    }),
  );
  tool(
    'aftertake_estimate_hosted_video',
    'Request a Comfy Router quote for a supported hosted LTX shot. This performs no generation. An unavailable estimate does not imply that generation was refused.',
    z.object({ request: routerVideoRequestSchema }).strict(),
    async ({ request }) => ({ data: await api<{ quote: RouterQuote }>('/estimate', { request }) }),
  );
  tool(
    'aftertake_generate_hosted_video',
    'Create one billable hosted LTX text-to-video take using the Comfy key configured in Studio. Keep a stable requestId and identical inputs. The operation is saved before submission; every retry checks existing records and retains the original request key and server scope. No local GPU is used.',
    z.object({ requestId: requestIdSchema, request: routerVideoRequestSchema }).strict(),
    async ({ requestId, request }) => {
      const parsed = routerVideoRequestSchema.parse(request);
      const video = await lookup({ requestId });
      if (video) {
        assertInputs(video, parsed);
        return { data: summary(video, requestId) };
      }
      return submit(await prepareIntent(requestId, parsed));
    },
    false,
  );
  tool(
    'aftertake_hosted_video_status',
    'Read hosted video status by original requestId or saved record ID. With no identifier, list recent saved requests. Reading status never resubmits. A missing record after a timeout is unresolved, not permission to invent a new requestId.',
    z
      .object({
        id: z.string().uuid().optional(),
        requestId: requestIdSchema.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict()
      .refine((input) => !(input.id && input.requestId), 'Choose one identifier.'),
    async ({ id, requestId, limit }) => {
      if (!id && !requestId)
        return {
          data: { videos: (await records()).slice(0, limit).map((video) => summary(video)) },
        };
      const video = await lookup({ id, requestId });
      if (video) return { data: summary(video, requestId) };
      const intent = requestId ? await readIntent(requestId) : undefined;
      return {
        data: {
          id,
          requestId,
          state: 'not_found',
          retainedOriginalIntent: !!intent,
          requestKey: intent?.requestKey,
          next: intent
            ? 'Explicit recovery can check again and use only the saved original key and scope. It will refuse a changed server session without a durable record.'
            : 'No saved record or MCP admission is visible. Preserve the original identifier and investigate before deliberately creating another take.',
        },
      };
    },
  );
  tool(
    'aftertake_recover_hosted_video',
    'Explicitly recover the original hosted request after interruption. Checks saved records first. A known record uses its own original provider identity; a retained unconfirmed MCP admission can resend only its original key, inputs and server scope. This can replay an uncertain original provider submission, never a newly keyed take.',
    selectorSchema,
    async ({ id, requestId }) => {
      const video = await lookup({ id, requestId });
      if (video) {
        const updated = await api<RouterVideoGeneration>(
          '/' + z.string().uuid().parse(video.id) + '/reconcile',
          {},
        );
        return {
          data: {
            ...summary(updated, requestId),
            next: 'Checking the original request. Retain its ID and poll status; this may recover the original same-key submission or collect its output.',
          },
        };
      }
      const intent = requestId ? await readIntent(requestId) : undefined;
      if (!intent)
        throw Error(
          'The original record and admission are missing. Recovery cannot create a new request.',
        );
      return submit(intent);
    },
    false,
  );
  tool(
    'aftertake_cancel_hosted_video',
    'Ask the provider to cancel one existing hosted generation. Cancellation is not terminal until the provider confirms it, and work already started may still be billed. An unresolved provider handle must be recovered first.',
    selectorSchema,
    async (selector) => {
      const video = await known(selector);
      return {
        data: summary(
          routerVideoTerminal.has(video.state)
            ? video
            : await api<RouterVideoGeneration>('/' + video.id + '/cancel', {}),
          selector.requestId,
        ),
      };
    },
    false,
  );
  tool(
    'aftertake_export_hosted_video_request',
    'Read the validated portable request and output receipt for an existing hosted take. Contains no credential. The provider exposes no seed, so a saved request does not promise identical fresh generation.',
    selectorSchema,
    async (selector) => {
      const video = await known(selector);
      return {
        data: {
          id: video.id,
          requestId: selector.requestId,
          portable: await api('/' + video.id + '/request'),
        },
      };
    },
  );
}
