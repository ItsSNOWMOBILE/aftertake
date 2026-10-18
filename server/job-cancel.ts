import type { Job } from '@comfyorg/sdk';

/** Cancellation is a request; only a fresh native observation determines state. */
export async function cancelAndRefresh(job: Pick<Job, 'cancel' | 'refresh'>) {
  await job.cancel();
  await job.refresh();
}
