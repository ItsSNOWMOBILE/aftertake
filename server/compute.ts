import { Router } from 'express';
import {
  computeConnectionSchema,
  computeFeatures,
  type ComputeCapability,
  type ComputeCheck,
  type ComputeConnectionInput,
  type ComputeFeature,
  type ComputeStatus,
} from '../src/compute.js';
import type { Engine } from '../src/domain.js';

type Options = {
  localEngine: (feature: ComputeFeature) => Promise<Engine>;
  now?: () => Date;
  fetch?: typeof fetch;
};

const cloudUserUrl = 'https://cloud.comfy.org/api/user';

/** Read-only authentication check. No submission, credits or provider state is changed. */
async function cloudPreflight(
  apiKey: string,
  request: typeof fetch,
  signal: AbortSignal,
): Promise<ComputeCheck[]> {
  try {
    const response = await request(cloudUserUrl, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    // Never return the account document or provider error body, which can contain PII.
    await response.body?.cancel();
    return [
      {
        id: 'reachability',
        state: 'pass',
        message: 'Comfy Cloud responded to the read-only account check.',
      },
      {
        id: 'authentication',
        state:
          response.status === 200
            ? 'pass'
            : response.status === 401 || response.status === 403
              ? 'blocked'
              : 'unverified',
        message:
          response.status === 200
            ? 'The Cloud account endpoint accepted this credential.'
            : response.status === 401 || response.status === 403
              ? 'Cloud authentication was refused. Check the API key and account access.'
              : 'Cloud authentication could not be verified from this response.',
      },
      {
        id: 'subscription',
        state: 'unverified',
        message:
          'An eligible paid subscription and available personal credits have not been verified.',
      },
    ];
  } catch {
    // Network exceptions can include URLs/headers. Keep diagnostics fixed and secret-free.
    return [
      {
        id: 'reachability',
        state: 'blocked',
        message: 'The Cloud account check timed out, redirected or could not connect.',
      },
      {
        id: 'authentication',
        state: 'unverified',
        message: 'Cloud authentication has not been verified.',
      },
      {
        id: 'subscription',
        state: 'unverified',
        message: 'Subscription eligibility has not been verified.',
      },
    ];
  }
}

const uncheckedCapabilities = (): ComputeCapability[] =>
  computeFeatures.map((feature) => ({
    feature,
    ready: false,
    message: 'Check the local engine to verify this workflow.',
  }));

/**
 * A remote connection is a candidate, never an active job router. All existing
 * routers retain their startup SDK client, including saved-job reconciliation
 * and cancellation. In particular, do not mutate COMFY_BASE_URL/API_KEY here:
 * SDK 0.5 resolves its base URL from process.env at construction time.
 *
 * Only the documented, read-only Cloud account endpoint is probed. Billing and
 * exact workflow compatibility have no verified execution adapter yet. Managed
 * deployments have no verified read-only metadata probe. No SDK job or billable
 * operation is performed by this owner-local connection preparation framework.
 */
export function createComputeConnection({
  localEngine,
  now = () => new Date(),
  fetch: request = fetch,
}: Options) {
  let candidate: ComputeConnectionInput | undefined;
  let checkedAt: string | null = null;
  let remoteChecks: ComputeCheck[] | undefined;
  let localCapabilities = uncheckedCapabilities();
  // A slow local probe must not publish a stale result over a newer selection.
  let revision = 0;
  let probeRevision = 0;
  let pendingProbe: AbortController | undefined;

  function status(): ComputeStatus {
    const remote = candidate && candidate.provider !== 'local';
    const configured: ComputeStatus['configured'] = candidate
      ? {
          provider: candidate.provider,
          hasApiKey: candidate.provider !== 'local' && Boolean(candidate.apiKey),
          ...(candidate.provider === 'managed-deployment' ? { endpoint: candidate.endpoint } : {}),
        }
      : null;
    return {
      activeProvider: 'local',
      configured,
      credentialStorage: 'memory',
      generationRouting: 'startup-local',
      state: remote ? (checkedAt ? 'blocked' : 'configured') : 'local',
      ready: !remote && localCapabilities.some((capability) => capability.ready),
      checkedAt,
      checks: remote
        ? [
            {
              id: 'credential',
              state: candidate?.provider !== 'local' && candidate?.apiKey ? 'pass' : 'blocked',
              message:
                candidate?.provider !== 'local' && candidate?.apiKey
                  ? 'Credential held in server memory only.'
                  : 'Supply a credential to check the connection.',
            },
            ...(
              remoteChecks ?? [
                {
                  id: 'authentication',
                  state: 'unverified' as const,
                  message: 'Credential authentication has not been verified with the provider.',
                },
                {
                  id: 'subscription',
                  state: 'unverified' as const,
                  message: 'Subscription eligibility has not been verified.',
                },
              ]
            ).map((check) => ({ ...check })),
            {
              id: 'billing',
              state: 'unverified',
              message: 'Account billing and whose credits a deployment uses are unverified.',
            },
            {
              id: 'compatibility',
              state: 'unverified',
              message:
                'Aftertake nodes, models, media and output contracts are unverified remotely.',
            },
            {
              id: 'routing',
              state: 'blocked',
              message:
                'Cloud generation is unavailable. Existing local jobs retain their original engine.',
            },
          ]
        : [
            {
              id: 'routing',
              state: 'pass',
              message: 'Generation and saved jobs use the unchanged startup local engine.',
            },
            {
              id: 'local-runtime',
              state: checkedAt
                ? localCapabilities.some((capability) => capability.ready)
                  ? 'pass'
                  : 'blocked'
                : 'unverified',
              message: checkedAt
                ? 'Readiness is checked separately for each local workflow.'
                : 'Run a local engine check to inspect workflow readiness.',
            },
          ],
      capabilities: remote
        ? computeFeatures.map((feature) => ({
            feature,
            ready: false,
            message:
              'Cloud execution is blocked pending verified billing, compatibility and job routing.',
          }))
        : localCapabilities.map((capability) => ({ ...capability })),
      message: remote
        ? 'Cloud configuration is stored for this server session. It does not activate cloud generation or change local job routing.'
        : 'Local rendering uses the existing engine. Cloud credentials are optional and never activate generation in this release.',
    };
  }

  return {
    status,
    configure(input: unknown) {
      // Only return fixed validation text; never echo supplied credentials or URLs.
      const parsed = computeConnectionSchema.safeParse(input);
      if (!parsed.success) return false;
      candidate = parsed.data;
      pendingProbe?.abort();
      checkedAt = null;
      remoteChecks = undefined;
      localCapabilities = uncheckedCapabilities();
      revision++;
      return true;
    },
    disconnect() {
      candidate = undefined;
      pendingProbe?.abort();
      checkedAt = null;
      remoteChecks = undefined;
      localCapabilities = uncheckedCapabilities();
      revision++;
      return status();
    },
    async probe() {
      const current = revision;
      const attempt = ++probeRevision;
      pendingProbe?.abort();
      const controller = new AbortController();
      pendingProbe = controller;
      const selected = candidate;
      if (!selected || selected.provider === 'local') {
        const capabilities = await Promise.all(
          computeFeatures.map(async (feature): Promise<ComputeCapability> => {
            try {
              const engine = await localEngine(feature);
              return { feature, ready: engine.connected && engine.ready, message: engine.message };
            } catch {
              return { feature, ready: false, message: 'The local engine check failed.' };
            }
          }),
        );
        if (current !== revision || attempt !== probeRevision) return status();
        localCapabilities = capabilities;
      } else if (selected.provider === 'comfy-cloud' && selected.apiKey) {
        const checks = await cloudPreflight(selected.apiKey, request, controller.signal);
        if (current !== revision || attempt !== probeRevision) return status();
        remoteChecks = checks;
      } else {
        remoteChecks = [
          {
            id: 'authentication',
            state: 'unverified',
            message: selected.apiKey
              ? 'Managed deployment authentication has no verified read-only probe yet.'
              : 'Supply a credential before checking authentication.',
          },
          {
            id: 'subscription',
            state: 'unverified',
            message: 'Subscription eligibility has not been verified.',
          },
        ];
      }
      checkedAt = now().toISOString();
      return status();
    },
  };
}

export function computeRouter(options: Options) {
  const connection = createComputeConnection(options);
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/', (_req, res) => res.json(connection.status()));
  router.post('/connection', (req, res) => {
    if (!connection.configure(req.body))
      return void res.status(400).json({
        error:
          'Choose a provider and supply a valid credential and HTTPS deployment URL when required.',
      });
    res.json(connection.status());
  });
  router.post('/probe', async (_req, res) => res.json(await connection.probe()));
  router.delete('/connection', (_req, res) => res.json(connection.disconnect()));
  return router;
}
