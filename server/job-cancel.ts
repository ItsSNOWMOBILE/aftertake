import type { EngineJob } from './sdk-port.js';

/** Cancellation is a request; only a fresh native observation determines state. */
export async function cancelAndRefresh(job: Pick<EngineJob, 'cancel' | 'refresh'>) {
  await job.cancel();
  await job.refresh();
}
