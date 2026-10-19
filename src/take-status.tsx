import { AlertCircle, Download, LoaderCircle, RotateCcw } from 'lucide-react';
import type { Render } from './domain';
import { takeCancelable, takeRecoverable, takeUncertain, type TakeOperation } from './take-client';
import './take-status.css';

export function describeTake(take: Pick<Render, 'state' | 'stage' | 'progress'>) {
  switch (take.state) {
    case 'submission_unknown':
      return {
        title: 'Submission needs checking',
        detail: 'Your original request is saved. Check its status before starting another take.',
      };
    case 'connection_lost':
      return {
        title: 'Connection interrupted',
        detail: 'The engine may still be working. Check status to reconnect to this take.',
      };
    case 'output_error':
      return {
        title: 'Could not collect this take',
        detail: 'Check status to retry collecting and verifying the existing result.',
      };
    case 'submitting':
      return { title: 'Sending your take', detail: 'Waiting for the engine to confirm admission.' };
    case 'queued':
      return { title: 'Waiting for the engine', detail: 'Your take is queued.' };
    case 'finalizing':
      return {
        title: 'Collecting your take',
        detail: 'Downloading and checking the generated result.',
      };
    case 'canceling':
      return {
        title: 'Canceling your take',
        detail: 'Waiting for the engine to confirm cancellation.',
      };
    default:
      return {
        title: take.stage || 'Rendering your take',
        detail: 'Your original recipe stays with this take.',
      };
  }
}

export default function TakeStatus({
  take,
  pending,
  sending,
  submitting,
  error,
  readOnly,
  sessionOnly,
  onAction,
  onRejoin,
  onExport,
  onDismiss,
}: {
  take?: Render | null;
  pending?: TakeOperation;
  sending: boolean;
  submitting: boolean;
  error: string;
  readOnly: boolean;
  sessionOnly: boolean;
  onAction: (take: Render, action: 'cancel' | 'reconcile') => void;
  onRejoin: () => void;
  onExport: () => void;
  onDismiss: () => void;
}) {
  const status = take ? describeTake(take) : undefined;
  const progress = take?.state === 'running' ? take.progress : null;
  if (!take && !pending && !submitting) return null;
  return (
    <div className="take-status-stack" aria-live="polite">
      {pending && (
        <section className="take-status needs-review" aria-label="Unconfirmed take request">
          <div className="take-status-heading">
            <AlertCircle size={16} />
            <strong>Keep your original request</strong>
          </div>
          <p>
            {pending.recipe.name} has no confirmed take record yet. Check saved takes first, then
            rejoin this exact request if the same studio session is available.
          </p>
          {error && <p className="take-status-error">{error}</p>}
          {sessionOnly && (
            <p className="take-status-error">
              Browser storage is unavailable. Keep this tab open and save the request; this reminder
              cannot be recovered automatically after a reload.
            </p>
          )}
          <div className="take-status-actions">
            <button disabled={sending || readOnly} onClick={onRejoin}>
              {sending ? <LoaderCircle size={13} className="spin" /> : <RotateCcw size={13} />}
              Check original request
            </button>
            <button disabled={sending} onClick={onExport}>
              <Download size={13} /> Save request
            </button>
            <button disabled={sending} onClick={onDismiss}>
              Dismiss request
            </button>
          </div>
          <p>
            Dismissing this browser request does not cancel the original take. It may still be
            running. Save the request before starting a separate take.
          </p>
        </section>
      )}
      {take && status && (
        <section
          className={`take-status ${takeRecoverable(take) ? 'needs-review' : ''}`}
          aria-label="Current take status"
        >
          <div className="take-status-heading">
            {takeRecoverable(take) ? (
              <AlertCircle size={16} />
            ) : (
              <LoaderCircle size={16} className="spin" />
            )}
            <strong>{status.title}</strong>
          </div>
          <small>{take.recipe.name}</small>
          <p>{status.detail}</p>
          {progress !== null && !takeUncertain(take) && (
            <div className="take-step-progress">
              <span>{Math.round(progress * 100)}% of step</span>
              <progress max="1" value={progress} />
            </div>
          )}
          {take.error && <p className="take-status-error">{take.error}</p>}
          {!pending && error && error !== take.error && (
            <p className="take-status-error">{error}</p>
          )}
          <div className="take-status-actions">
            {takeRecoverable(take) && (
              <button disabled={sending || readOnly} onClick={() => onAction(take, 'reconcile')}>
                {sending ? <LoaderCircle size={13} className="spin" /> : <RotateCcw size={13} />}
                Check status
              </button>
            )}
            {takeCancelable(take) && (
              <button disabled={sending || readOnly} onClick={() => onAction(take, 'cancel')}>
                Cancel take
              </button>
            )}
          </div>
        </section>
      )}
      {submitting && !pending && !take && (
        <section className="take-status" aria-label="Submitting take">
          <div className="take-status-heading">
            <LoaderCircle size={16} className="spin" />
            <strong>Sending your take</strong>
          </div>
          <p>Saving your original request and waiting for confirmation.</p>
        </section>
      )}
    </div>
  );
}
