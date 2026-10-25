/**
 * Live progress for a job made of several steps: which step is running, how long is left
 * and how far along it is. The server fills it in when it sends a running job; nothing of
 * it is saved, so a restart simply measures again.
 */
export type EtaStep = { label: string; state: 'done' | 'active' | 'todo' };
export type JobEta = {
  steps: EtaStep[];
  /** Seconds left, or null while the job waits on something it cannot time (another render). */
  seconds: number | null;
  /** 0–1 for a progress bar, or null when the time left is unknown. */
  progress: number | null;
};

/**
 * The time left is the rest of the current step (a few seconds at least while it runs),
 * the expected length of every later step, and any wait before the current step can start.
 * `inStep` and `total` are seconds already spent in this step and in the whole run.
 */
export function jobEta(
  steps: { label: string; seconds: number }[],
  current: number,
  { inStep, total, wait = 0 }: { inStep: number; total: number; wait?: number | null },
): JobEta {
  const later = steps.slice(current + 1).reduce((sum, step) => sum + step.seconds, 0),
    now = steps[current] ? Math.max(steps[current].seconds - Math.max(inStep, 0), 3) : 0;
  const seconds = wait === null ? null : Math.round(Math.max(wait, 0) + now + later);
  return {
    steps: steps.map((step, index) => ({
      label: step.label,
      state: index < current ? 'done' : index === current ? 'active' : 'todo',
    })),
    seconds,
    // It never reads full while running: the last few percent belong to the finish.
    progress: seconds === null ? null : Math.min(0.97, Math.max(total, 0) / (total + seconds || 1)),
  };
}

/** "About 1 min 20 s left", rounded so it does not promise more than an estimate can. */
export function formatTimeLeft(seconds: number) {
  if (seconds < 10) return 'Almost done';
  if (seconds < 60) return `About ${Math.round(seconds / 5) * 5} s left`;
  const tens = Math.round(seconds / 10) * 10,
    minutes = Math.floor(tens / 60),
    rest = tens % 60;
  return `About ${minutes} min${rest ? ` ${rest} s` : ''} left`;
}
