import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { formatTimeLeft, type JobEta } from './job-eta';
import './job-progress.css';

/**
 * A running job in the space its result will take: the picture it starts from behind a
 * veil, what is happening, the time left counting down between updates, and every step.
 */
export default function JobProgress({
  headline,
  detail,
  eta,
  poster,
}: {
  headline: string;
  /** A short line under the headline, such as how many are ahead in the line. */
  detail?: string;
  eta?: JobEta;
  /** The picture the job starts from, shown dimmed behind the progress. */
  poster?: string;
}) {
  // Count down between the server's updates, so the time left moves every second.
  const [received, setReceived] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setReceived(Date.now()), [eta?.seconds, eta?.progress]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const passed = Math.max(0, (now - received) / 1000);
  const left = eta?.seconds == null ? null : eta.seconds - passed;
  const progress =
    eta?.progress == null || eta.seconds == null
      ? null
      : Math.min(
          0.97,
          // Move the bar along with the countdown until the next update corrects it.
          eta.progress + (passed / Math.max(eta.seconds + passed, 1)) * (1 - eta.progress),
        );
  return (
    <div className="job-progress" role="status" aria-live="polite">
      {poster && <img className="job-progress-poster" src={poster} alt="" aria-hidden="true" />}
      <div className="job-progress-body">
        <span className="job-progress-ring" aria-hidden="true" />
        <strong>{headline}</strong>
        <span className="job-progress-time">
          {left === null
            ? detail || 'Starting when the GPU is free'
            : left < -15
              ? 'Taking a little longer than usual'
              : formatTimeLeft(left)}
        </span>
        {left !== null && detail && <small>{detail}</small>}
        <div
          className={`job-progress-bar${progress === null ? ' waiting' : ''}`}
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
        >
          <span style={progress === null ? undefined : { width: `${progress * 100}%` }} />
        </div>
        {eta && eta.steps.length > 1 && (
          <ol className="job-progress-steps">
            {eta.steps.map((step, index) => (
              <li key={index} className={step.state}>
                <span aria-hidden="true">
                  {step.state === 'done' ? <Check size={11} strokeWidth={3} /> : null}
                </span>
                {step.label}
                <span className="job-progress-sr">
                  {step.state === 'done' ? ' (done)' : step.state === 'active' ? ' (now)' : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
