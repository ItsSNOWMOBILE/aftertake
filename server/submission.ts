import { ApiError } from '@comfyorg/sdk/low';

// These typed responses reject admission. A transport error or timeout can
// arrive after admission and must retain its idempotency key for reconciliation.
export function submissionRejected(error: unknown) {
  return error instanceof ApiError && error.httpStatus >= 400 && error.httpStatus < 500 && [
    'invalid_workflow', 'workflow_format_ui', 'missing_asset', 'hash_mismatch',
    'blob_not_found', 'unauthorized', 'forbidden', 'insufficient_credits', 'queue_full',
  ].includes(error.code);
}
