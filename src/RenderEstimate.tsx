import { Timer } from 'lucide-react';
import { describeEstimate, estimate, estimateKey, type TimedJob } from './render-estimate';

/** The expected time for a job, shown beside the button that starts it. */
export default function RenderEstimate({
  job,
  history,
  gpu,
}: {
  job: Pick<TimedJob, 'request' | 'recipe'>;
  history: TimedJob[];
  gpu?: string;
}) {
  const line = describeEstimate(estimate(estimateKey(job), history), gpu);
  return line ? (
    <p className="render-estimate">
      <Timer size={13} aria-hidden="true" />
      <span>{line.time}</span>
      <small>{line.basis}</small>
    </p>
  ) : null;
}
