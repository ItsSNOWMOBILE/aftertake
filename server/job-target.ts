import { createHash } from 'node:crypto';
import type { JobTargetBinding } from '../src/job-target.js';
import { RequestError } from './http-errors.js';

export type JobTarget = Readonly<{
  binding: Readonly<JobTargetBinding>;
  legacyLoopbackAllowed: boolean;
}>;
type BoundRecord = { jobTarget?: unknown };

export const jobTargetMismatch =
  'This job belongs to a different engine target. Reconnect its original engine before recovering or canceling it.';
export const legacyJobTargetBlocked =
  'This saved job has no engine binding. Legacy recovery is allowed only on the local loopback startup engine.';
export const cloudJobDisconnected =
  'This job runs on Comfy Cloud. Connect Comfy Cloud with the same account in Compute settings to rejoin or cancel it.';

export class JobTargetError extends RequestError {
  constructor(message: string) {
    super(message, 409);
  }
}

function canonicalBase(value: string) {
  try {
    if (typeof value !== 'string' || !value.trim() || /[\\?#\x00-\x1f\x7f]/.test(value))
      throw Error();
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw Error();
    return {
      canonical: url.origin + url.pathname.replace(/\/+$/, ''),
      loopback: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    };
  } catch {
    throw new JobTargetError(
      'Use HTTP or HTTPS engine bases without URL credentials, queries, fragments or device paths.',
    );
  }
}

/** Use this exact base for native HTTP requests as well as target identity. */
export function canonicalNativeBaseUrl(value: string): string {
  return canonicalBase(value).canonical;
}

/** Capture once beside the startup SDK client. No credentials, URLs or I/O retained. */
export function createJobTarget({
  sdkBaseUrl,
  uiBaseUrl,
  allowLegacyLoopback = false,
}: {
  sdkBaseUrl: string;
  uiBaseUrl: string;
  allowLegacyLoopback?: boolean;
}): JobTarget {
  const sdk = canonicalBase(sdkBaseUrl),
    ui = canonicalBase(uiBaseUrl);
  const binding: JobTargetBinding = {
    format: 'aftertake-job-target/1',
    kind: 'startup-engine',
    fingerprint: createHash('sha256')
      .update(JSON.stringify([sdk.canonical, ui.canonical]))
      .digest('hex'),
  };
  return Object.freeze({
    binding: Object.freeze(binding),
    legacyLoopbackAllowed: allowLegacyLoopback === true && sdk.loopback && ui.loopback,
  });
}

/**
 * Comfy Cloud jobs bind to the account that submitted them, so a rotated key for
 * the same account can still recover them. The account id is hashed; no
 * credential or address is retained.
 */
export function createCloudJobTarget({ origin, account }: { origin: string; account: string }) {
  if (typeof account !== 'string' || !account.trim() || account.length > 512)
    throw new JobTargetError('Comfy Cloud did not identify the account for this connection.');
  const binding: JobTargetBinding = {
    format: 'aftertake-job-target/1',
    kind: 'comfy-cloud',
    fingerprint: createHash('sha256')
      .update(JSON.stringify(['comfy-cloud', canonicalBase(origin).canonical, account.trim()]))
      .digest('hex'),
  };
  return Object.freeze({ binding: Object.freeze(binding), legacyLoopbackAllowed: false });
}

/** True when a record says it was submitted to Comfy Cloud, whichever account. */
export function boundToCloud(record: BoundRecord) {
  const value = Object.hasOwn(record, 'jobTarget') ? record.jobTarget : undefined;
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).kind === 'comfy-cloud'
  );
}

/** Present but malformed bindings never receive historical-job compatibility. */
export function jobTargetIssue(record: BoundRecord, target: JobTarget): string | undefined {
  if (!('jobTarget' in record))
    return target.legacyLoopbackAllowed ? undefined : legacyJobTargetBlocked;
  const value: unknown = record.jobTarget;
  if (
    !Object.hasOwn(record, 'jobTarget') ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    return jobTargetMismatch;
  const binding = value as Record<string, unknown>;
  return Object.keys(binding).length === 3 &&
    Object.hasOwn(binding, 'format') &&
    Object.hasOwn(binding, 'kind') &&
    Object.hasOwn(binding, 'fingerprint') &&
    binding.format === 'aftertake-job-target/1' &&
    binding.kind === target.binding.kind &&
    typeof binding.fingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(binding.fingerprint) &&
    binding.fingerprint === target.binding.fingerprint
    ? undefined
    : jobTargetMismatch;
}

export function assertJobTarget(record: BoundRecord, target: JobTarget) {
  const issue = jobTargetIssue(record, target);
  if (issue) throw new JobTargetError(issue);
}
