import { ApiError } from '@comfyorg/sdk/low';
import { ComfyError } from '@comfyorg/sdk';

// These typed responses reject admission. A transport error or timeout can
// arrive after admission and must retain its idempotency key for reconciliation.
export function submissionRejected(error: unknown) {
  return (error instanceof ApiError || error instanceof ComfyError) && typeof error.code === 'string' && error.httpStatus !== undefined && error.httpStatus >= 400 && error.httpStatus < 500 && [
    'invalid_workflow', 'workflow_format_ui', 'missing_asset', 'hash_mismatch',
    'blob_not_found', 'unauthorized', 'forbidden', 'insufficient_credits', 'queue_full',
  ].includes(error.code);
}
