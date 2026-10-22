import type { Engine } from '../src/domain.js';
import {
  cloudFeature,
  comfyCloudEngine,
  type CloudFeature,
  type ComputeFeature,
} from '../src/compute.js';
import type { EngineClient } from './sdk-port.js';
import { componentChecks } from './engine-compatibility.js';
import { cloudRequirements } from './cloud-workflow.js';
import {
  boundToCloud,
  cloudJobDisconnected,
  createCloudJobTarget,
  jobTargetIssue,
  type JobTarget,
} from './job-target.js';

export const comfyCloudOrigin = 'https://cloud.comfy.org';
export const cloudPlanRequired =
  "Comfy Cloud refused this job: rendering through its API needs a paid Comfy Cloud plan. Free accounts can render only on Comfy Cloud's website.";
export const cloudCreditsExhausted =
  'Comfy Cloud has no credits left for this account. Add credits on comfy.org, then try again.';
export const cloudOtherAccount =
  'This job was submitted from another Comfy Cloud account. Connect that account to rejoin or cancel it.';

/** Where a job runs: its SDK client and the target its record is bound to. */
export type EngineRoute = {
  provider: 'local' | 'comfy-cloud';
  client: EngineClient;
  target: JobTarget;
};
type CloudClient = EngineClient & { close?(): unknown };

/** What the generation routers need from a Comfy Cloud connection. */
export type CloudRoutes = {
  route(): EngineRoute | undefined;
  engine(feature: CloudFeature): Promise<Engine>;
  /** A submission error's message for the user, recording a plan refusal. */
  refused(error: unknown): string | undefined;
};

/**
 * One Comfy Cloud session: an isolated SDK worker holding the key, the job
 * target for its account, and Cloud's node list for readiness checks. The key
 * lives only in this process's memory and the worker's copied environment.
 */
export function createCloudRuntime({
  createClient,
  fetch: request = fetch,
  origin = comfyCloudOrigin,
  objectInfoTtlMs = 10 * 60 * 1000,
  now = () => Date.now(),
}: {
  createClient: (options: { baseUrl: string; apiKey: string }) => Promise<CloudClient>;
  fetch?: typeof fetch;
  origin?: string;
  objectInfoTtlMs?: number;
  now?: () => number;
}) {
  let session:
    | {
        apiKey: string;
        client: CloudClient;
        route: EngineRoute;
        objectInfo?: { until: number; value: Promise<unknown> };
      }
    | undefined;
  let planBlocked = false;

  async function disconnect() {
    const previous = session;
    session = undefined;
    try {
      await previous?.client.close?.();
    } catch {
      /* A stopped worker is already disconnected. */
    }
  }
  async function connect(apiKey: string, account: string) {
    const target = createCloudJobTarget({ origin, account });
    // Checking again is how a user says the plan changed: retry and refresh nodes.
    planBlocked = false;
    if (
      session?.apiKey === apiKey &&
      session.route.target.binding.fingerprint === target.binding.fingerprint
    ) {
      delete session.objectInfo;
      return;
    }
    await disconnect();
    const client = await createClient({ baseUrl: origin, apiKey });
    session = { apiKey, client, route: { provider: 'comfy-cloud', client, target } };
  }
  function objectInfo() {
    const current = session;
    if (!current) return Promise.reject(Error('Comfy Cloud is not connected.'));
    if (current.objectInfo && current.objectInfo.until > now()) return current.objectInfo.value;
    const value = (async () => {
      const response = await request(`${origin}/api/object_info`, {
        headers: { Authorization: `Bearer ${current.apiKey}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error('Comfy Cloud did not return its node list.');
      }
      return (await response.json()) as unknown;
    })();
    current.objectInfo = { until: now() + objectInfoTtlMs, value };
    // A failed fetch is retried on the next check instead of being cached.
    value.catch(() => {
      if (current.objectInfo?.value === value) delete current.objectInfo;
    });
    return value;
  }
  async function engine(feature: CloudFeature): Promise<Engine> {
    if (!session)
      return {
        connected: false,
        ready: false,
        missing: [],
        message: 'Connect Comfy Cloud in Compute settings to render there.',
      };
    let missing: string[];
    try {
      missing = componentChecks(await objectInfo(), cloudRequirements(feature))
        .filter((check) => check.state === 'blocked')
        .map((check) => check.message);
    } catch {
      return {
        connected: false,
        ready: false,
        missing: [],
        message: 'Comfy Cloud could not be reached. Check the connection and try again.',
      };
    }
    return {
      connected: true,
      ready: !missing.length && !planBlocked,
      gpu: comfyCloudEngine,
      missing,
      message: planBlocked
        ? cloudPlanRequired
        : missing.length
          ? 'Comfy Cloud is missing a node or model this workflow needs.'
          : 'Comfy Cloud · open-weight workflow',
    };
  }
  const routes: CloudRoutes = {
    route: () => session?.route,
    engine,
    refused(error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'forbidden') {
        planBlocked = true;
        return cloudPlanRequired;
      }
      if (code === 'insufficient_credits') return cloudCreditsExhausted;
      return undefined;
    },
  };
  return {
    connect,
    disconnect,
    routes,
    engine,
    status: () => ({ connected: Boolean(session), planBlocked }),
  };
}
export type CloudRuntime = ReturnType<typeof createCloudRuntime>;

/**
 * The route a saved record belongs to, or why it has none. Local records keep
 * the startup engine's rules; Cloud records need the same account connected.
 */
export function recordRoute(
  record: { jobTarget?: unknown },
  local: EngineRoute,
  cloud?: CloudRoutes,
): EngineRoute | string {
  const issue = jobTargetIssue(record, local.target);
  if (!issue) return local;
  const remote = cloud?.route();
  if (remote && !jobTargetIssue(record, remote.target)) return remote;
  if (!boundToCloud(record)) return issue;
  return remote ? cloudOtherAccount : cloudJobDisconnected;
}

/** Where a new job of this feature goes, with that engine's readiness. */
export async function newJobRoute(
  feature: ComputeFeature,
  local: EngineRoute,
  localEngine: () => Promise<Engine>,
  cloud?: CloudRoutes,
): Promise<{ route: EngineRoute; engine: Engine }> {
  const remote = cloud?.route();
  if (remote && cloudFeature(feature))
    return { route: remote, engine: await cloud!.engine(feature) };
  return { route: local, engine: await localEngine() };
}
