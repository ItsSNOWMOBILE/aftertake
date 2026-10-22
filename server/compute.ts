import { Router } from 'express';
import { z } from 'zod';
import {
  cloudFeature,
  cloudFeatures,
  computeConnectionSchema,
  computeFeatures,
  type ComputeCapability,
  type ComputeCheck,
  type ComputeConnectionInput,
  type ComputeFeature,
  type ComputeStatus,
} from '../src/compute.js';
import type { Engine } from '../src/domain.js';
import { cloudPlanRequired, type CloudRuntime } from './cloud-runtime.js';

type Options = {
  localEngine: (feature: ComputeFeature) => Promise<Engine>;
  now?: () => Date;
  fetch?: typeof fetch;
  /** Lets the cloud-capable studios render on Comfy Cloud once a key is accepted. */
  cloud?: Pick<CloudRuntime, 'connect' | 'disconnect' | 'engine' | 'status' | 'choose' | 'routes'>;
};

/** Choose where one cloud-capable studio, or all of them, render new jobs. */
const routingChoiceSchema = z
  .object({
    feature: z.union([z.enum(cloudFeatures), z.literal('all')]),
    renders: z.enum(['local', 'comfy-cloud']),
  })
  .strict();
type Readiness = { ready: boolean; message: string };

const cloudUserUrl = 'https://cloud.comfy.org/api/user';

/** Read-only authentication check. No submission, credits or provider state is changed. */
async function cloudPreflight(
  apiKey: string,
  request: typeof fetch,
  signal: AbortSignal,
): Promise<{ checks: ComputeCheck[]; account?: string }> {
  try {
    const response = await request(cloudUserUrl, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    // Never return the account document or provider error body, which can contain PII.
    // Only the account id is kept, to bind Cloud jobs to the account that ran them.
    let account: string | undefined;
    if (response.status === 200) {
      const document = (await response.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof document?.id === 'string' && document.id.trim()) account = document.id;
    } else await response.body?.cancel();
    return {
      account,
      checks: [
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
      ],
    };
  } catch {
    // Network exceptions can include URLs/headers. Keep diagnostics fixed and secret-free.
    return {
      checks: [
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
      ],
    };
  }
}

const uncheckedCapabilities = (): ComputeCapability[] =>
  computeFeatures.map((feature) => ({
    feature,
    ready: false,
    message: 'Check the local engine to verify this workflow.',
  }));

/**
 * The startup local engine keeps every saved local job, recovery and
 * cancellation. Do not mutate COMFY_BASE_URL/API_KEY here: SDK 0.5 resolves its
 * base URL from process.env at construction time.
 *
 * A Comfy Cloud key that the read-only account check accepts starts a separate
 * isolated Cloud worker (when a cloud runtime is supplied). Cloud stays
 * optional: each cloud-capable studio keeps rendering on the local engine until
 * the user chooses Comfy Cloud for it, and the other studios always do. Cloud
 * jobs bind to the account that ran them. Checking performs no job or billable
 * work. Managed deployments have no verified read-only probe and stay blocked.
 */
export function createComputeConnection({
  localEngine,
  now = () => new Date(),
  fetch: request = fetch,
  cloud,
}: Options) {
  let candidate: ComputeConnectionInput | undefined;
  let checkedAt: string | null = null;
  let remoteChecks: ComputeCheck[] | undefined;
  let localCapabilities = uncheckedCapabilities();
  // Both destinations' readiness, measured when Comfy Cloud was last checked.
  let readiness:
    | {
        local: Record<ComputeFeature, Readiness>;
        cloud: Partial<Record<ComputeFeature, Readiness>>;
      }
    | undefined;
  const cloudActive = () =>
    candidate?.provider === 'comfy-cloud' &&
    Boolean(readiness) &&
    Boolean(cloud?.status().connected);
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
    if (cloudActive()) {
      const planBlocked = cloud!.status().planBlocked;
      const capabilities = computeFeatures.map((feature): ComputeCapability => {
        const local = { ...readiness!.local[feature] };
        if (!cloudFeature(feature))
          return {
            feature,
            ...local,
            message: `Needs Aftertake's own nodes, so it renders on your GPU. ${local.message}`,
            renders: 'local',
          };
        // A plan refusal after the check blocks every cloud choice until the next check.
        const remote = planBlocked
          ? { ready: false, message: cloudPlanRequired }
          : { ...readiness!.cloud[feature]! };
        const onCloud = cloud!.routes.chosen(feature);
        return {
          feature,
          ...(onCloud ? remote : local),
          renders: onCloud ? 'comfy-cloud' : 'local',
          choices: { local, 'comfy-cloud': remote },
        };
      });
      // Node and model coverage, judged apart from the plan.
      const compatible = cloudFeatures.every((feature) => readiness!.cloud[feature]?.ready);
      const onCloud = cloudFeatures.filter((feature) => cloud!.routes.chosen(feature)).length;
      return {
        activeProvider: 'comfy-cloud',
        configured,
        credentialStorage: 'memory',
        generationRouting: 'per-studio',
        state: 'cloud',
        ready: capabilities.some((capability) => capability.ready),
        checkedAt,
        checks: [
          { id: 'credential', state: 'pass', message: 'Credential held in server memory only.' },
          ...(remoteChecks ?? [])
            .filter((check) => check.id !== 'subscription')
            .map((check) => ({ ...check })),
          planBlocked
            ? { id: 'subscription', state: 'blocked', message: cloudPlanRequired }
            : {
                id: 'subscription',
                state: 'unverified',
                message:
                  "Rendering through Comfy Cloud's API needs a paid plan. The first cloud render confirms this account's plan.",
              },
          {
            id: 'billing',
            state: 'pass',
            message: "Cloud renders use this account's Comfy Cloud credits.",
          },
          {
            id: 'compatibility',
            state: compatible ? 'pass' : 'blocked',
            message: compatible
              ? 'Comfy Cloud has every node and model the cloud workflows use.'
              : 'Comfy Cloud is missing a node or model for at least one cloud workflow.',
          },
          {
            id: 'routing',
            state: 'pass',
            message: onCloud
              ? `${onCloud} of ${cloudFeatures.length} supported studios render on Comfy Cloud; every other studio uses your GPU.`
              : 'Every studio still renders on your GPU. Choose Comfy Cloud for the studios you want to render there.',
          },
        ],
        capabilities,
        message:
          'Comfy Cloud is connected for this server session. Studios render where you choose; saved jobs keep their engine.',
      };
    }
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
        ? candidate?.provider === 'comfy-cloud' && cloud
          ? 'Check the connection to start rendering on Comfy Cloud. Local jobs keep their engine.'
          : 'Cloud configuration is stored for this server session. It does not activate cloud generation or change local job routing.'
        : 'Local rendering uses the existing engine. Comfy Cloud is optional: connect it to render images, text to video, upscaling, smooth or slow motion and songs there.',
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
      readiness = undefined;
      localCapabilities = uncheckedCapabilities();
      revision++;
      void cloud?.disconnect();
      return true;
    },
    /** False for an invalid choice; undefined when Comfy Cloud is not connected. */
    async choose(input: unknown) {
      const parsed = routingChoiceSchema.safeParse(input);
      if (!parsed.success || !cloud) return false;
      if (parsed.data.renders === 'comfy-cloud' && !cloudActive()) return undefined;
      await cloud.choose(
        parsed.data.feature === 'all' ? [...cloudFeatures] : [parsed.data.feature],
        parsed.data.renders,
      );
      return status();
    },
    disconnect() {
      candidate = undefined;
      pendingProbe?.abort();
      checkedAt = null;
      remoteChecks = undefined;
      readiness = undefined;
      localCapabilities = uncheckedCapabilities();
      revision++;
      void cloud?.disconnect();
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
        const { checks, account } = await cloudPreflight(
          selected.apiKey,
          request,
          controller.signal,
        );
        if (current !== revision || attempt !== probeRevision) return status();
        remoteChecks = checks;
        const accepted = checks.some(
          (check) => check.id === 'authentication' && check.state === 'pass',
        );
        if (cloud && accepted && account) {
          try {
            await cloud.connect(selected.apiKey, account);
          } catch {
            remoteChecks = [
              ...checks,
              {
                id: 'cloud-worker',
                state: 'blocked',
                message:
                  'The Comfy Cloud worker could not start. Restart the studio and try again.',
              },
            ];
          }
          if (current !== revision || attempt !== probeRevision) return status();
          if (cloud.status().connected) {
            const check = async (engine: () => Promise<Engine>): Promise<Readiness> => {
              try {
                const result = await engine();
                return {
                  ready: result.connected && result.ready,
                  message: result.missing.length
                    ? `${result.message} ${result.missing.join(', ')}`
                    : result.message,
                };
              } catch {
                return { ready: false, message: 'The engine check failed.' };
              }
            };
            const [local, remote] = await Promise.all([
              Promise.all(computeFeatures.map((feature) => check(() => localEngine(feature)))),
              Promise.all(cloudFeatures.map((feature) => check(() => cloud.engine(feature)))),
            ]);
            if (current !== revision || attempt !== probeRevision) return status();
            readiness = {
              local: Object.fromEntries(
                computeFeatures.map((feature, index) => [feature, local[index]]),
              ) as Record<ComputeFeature, Readiness>,
              cloud: Object.fromEntries(
                cloudFeatures.map((feature, index) => [feature, remote[index]]),
              ),
            };
          }
        }
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

export function computeRouter(options: Options & { startupCloudKey?: string }) {
  const connection = createComputeConnection(options);
  // A key in the studio's environment connects Comfy Cloud at startup, so saved
  // Cloud jobs can rejoin without typing it again. It is never written anywhere.
  if (
    options.startupCloudKey &&
    connection.configure({ provider: 'comfy-cloud', apiKey: options.startupCloudKey })
  )
    void connection.probe().catch(() => {});
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
  router.post('/routing', async (req, res) => {
    const result = await connection.choose(req.body);
    if (result === false)
      return void res
        .status(400)
        .json({ error: 'Choose a supported studio and either local or comfy-cloud.' });
    if (!result)
      return void res
        .status(409)
        .json({ error: 'Connect and check Comfy Cloud before choosing it for a studio.' });
    res.json(result);
  });
  router.delete('/connection', (_req, res) => res.json(connection.disconnect()));
  return router;
}
