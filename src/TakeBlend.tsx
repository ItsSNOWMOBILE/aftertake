import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Check, Cpu, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { type Recipe, type Render, supportsCompositeRegion } from './domain';
import {
  recompositionBusy,
  recompositionJobSchema,
  recompositionRequestSchema,
  sameRecompositionGeneration,
  type RecompositionJob,
  type RecompositionRequest,
} from './recomposition';
import { apiFetch, browserDemo } from './transport';
import './take-blend.css';

const storageKey = 'aftertake-blend-admission';
const keyPattern = /^[a-zA-Z0-9_-]{1,128}$/;
type Admission = {
  format: 'aftertake-blend-admission/1';
  key: string;
  request: RecompositionRequest;
};

class BlendResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await apiFetch(path, { ...init, signal: controller.signal });
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new BlendResponseError(
        'Restart the studio with saved-take blend support, then check the original request.',
        response.status,
      );
    const body = await response.json();
    if (!response.ok)
      throw new BlendResponseError(
        body.error || 'The saved blend could not be checked.',
        response.status,
      );
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

function loadAdmission(): Admission | undefined {
  if (browserDemo) return;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null') as Admission | null;
    if (
      value?.format !== 'aftertake-blend-admission/1' ||
      typeof value.key !== 'string' ||
      !keyPattern.test(value.key)
    )
      return;
    return { ...value, request: recompositionRequestSchema.parse(value.request) };
  } catch {
    return;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.name !== 'AbortError'
    ? error.message
    : 'The connection timed out. Check the original request before trying again.';
}

/** Example titles are display aliases, not changes to generation settings. */
export function takeBlendMatches(take: Render, recipe: Recipe | null): boolean {
  try {
    return Boolean(
      recipe && sameRecompositionGeneration(take.recipe, { ...recipe, name: take.recipe.name }),
    );
  } catch {
    // A partially edited draft must not crash the editor or become a reblend.
    return false;
  }
}

export function takeBlendUnavailable(take: Render | null): string | undefined {
  if (!take) return 'Select a finished region take from the library to refine its blend.';
  if (!supportsCompositeRegion(take.recipe))
    return 'Blend refinement is available for region VFX and masked edits. Camera, motion-transfer and character workflows use their own finishing tools.';
  if (take.state !== 'succeeded' || !take.output)
    return 'This take must finish successfully before its blend can be refined.';
  if (!take.rawOutput)
    return 'This take has no saved raw generation. Select a take that includes its raw output.';
}

function blendRequest(take: Render, recipe: Recipe): RecompositionRequest {
  return recompositionRequestSchema.parse({
    renderId: take.id,
    ...(recipe.compositeRegion ? { compositeRegion: recipe.compositeRegion } : {}),
    matchSourceColor: recipe.matchSourceColor || false,
  });
}

function sameRequest(a: RecompositionRequest, b: RecompositionRequest) {
  return (
    JSON.stringify(recompositionRequestSchema.parse(a)) ===
    JSON.stringify(recompositionRequestSchema.parse(b))
  );
}

const labels: Record<RecompositionJob['state'], string> = {
  queued: 'Waiting for the CPU worker',
  running: 'Refining the saved pixels',
  canceling: 'Stopping the CPU refinement',
  succeeded: 'Refined take ready',
  failed: 'Blend needs attention',
  canceled: 'Refinement canceled',
  interrupted: 'Refinement interrupted',
};

export default function TakeBlend({
  take,
  recipe,
  onPrepare,
  onUseGenerationRegion,
  onComplete,
}: {
  take: Render | null;
  recipe: Recipe | null;
  onPrepare: (take: Render) => void;
  onUseGenerationRegion: () => void;
  onComplete: (render: Render, activate: boolean) => void;
}) {
  const [jobs, setJobs] = useState<RecompositionJob[]>([]);
  const [admission, setAdmission] = useState(loadAdmission);
  const [issue, setIssue] = useState('');
  const [action, setAction] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loaded, setLoaded] = useState(browserDemo);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [missingOriginal, setMissingOriginal] = useState(false);
  const admissionRef = useRef(admission);
  const actionRef = useRef(false);
  const refreshRef = useRef(false);
  const watched = useRef(new Set<string>());
  const delivered = useRef(new Set<string>());
  const delivering = useRef(new Set<string>());
  const resultCache = useRef(new Map<string, Render>());
  const selection = useRef({ take, recipe, onComplete });
  selection.current = { take, recipe, onComplete };

  const remember = useCallback((next?: Admission) => {
    admissionRef.current = next;
    setAdmission(next);
    setMissingOriginal(false);
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
      setSessionOnly(false);
    } catch {
      setSessionOnly(Boolean(next));
    }
  }, []);

  const observe = useCallback(
    (value: RecompositionJob) => {
      const job = recompositionJobSchema.parse(value);
      const pending = admissionRef.current;
      if (pending && job.requestKey === pending.key) {
        if (!sameRequest(job.request, pending.request))
          throw Error(
            'The original request key belongs to different blend settings. Keep this request and review the saved jobs.',
          );
        watched.current.add(job.id);
        remember();
      }
      setJobs((all) => [job, ...all.filter((row) => row.id !== job.id)]);
      return job;
    },
    [remember],
  );

  const refresh = useCallback(async () => {
    if (browserDemo || refreshRef.current) return;
    refreshRef.current = true;
    setChecking(true);
    try {
      const values = await request<unknown[]>('/api/recompositions');
      if (!Array.isArray(values))
        throw Error('The saved blend list is invalid. Check the local studio again.');
      const saved = values.map((row) => recompositionJobSchema.parse(row));
      const pending = admissionRef.current;
      if (pending) {
        const found = saved.find((row) => row.requestKey === pending.key);
        if (found) observe(found);
      }
      setJobs(saved);
      setLoaded(true);
      setIssue('');
    } catch (error) {
      setIssue(errorMessage(error));
    } finally {
      refreshRef.current = false;
      setChecking(false);
    }
  }, [observe]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  const hasActiveJob = jobs.some(recompositionBusy);
  useEffect(() => {
    if (browserDemo || (!admission && !hasActiveJob)) return;
    const timer = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(timer);
  }, [admission, hasActiveJob, refresh]);

  const loadResult = useCallback(async (job: RecompositionJob) => {
    if (!job.renderId)
      throw Error('The completed blend has no saved take yet. Check its status again.');
    const cached = resultCache.current.get(job.id);
    if (cached) return cached;
    const render = await request<Render>(`/api/renders/${job.renderId}`);
    if (render.id !== job.renderId || render.state !== 'succeeded' || !render.output)
      throw Error('The refined take is not available yet. Check its saved status again.');
    resultCache.current.set(job.id, render);
    return render;
  }, []);

  useEffect(() => {
    for (const job of jobs) {
      if (
        job.state !== 'succeeded' ||
        !watched.current.has(job.id) ||
        delivered.current.has(job.id) ||
        delivering.current.has(job.id)
      )
        continue;
      delivering.current.add(job.id);
      void loadResult(job)
        .then((render) => {
          const current = selection.current;
          let activate = false;
          try {
            activate = Boolean(
              current.take?.id === job.sourceRenderId &&
              current.recipe &&
              takeBlendMatches(current.take, current.recipe) &&
              sameRequest(blendRequest(current.take, current.recipe), job.request),
            );
          } catch {
            // Preserve a newer, incomplete final-area draft while adding the result.
          }
          current.onComplete(render, activate);
          delivered.current.add(job.id);
        })
        .catch((error) => setIssue(errorMessage(error)))
        .finally(() => delivering.current.delete(job.id));
    }
  }, [jobs, loadResult]);

  async function original(pending: Admission): Promise<RecompositionJob | undefined> {
    try {
      const job = await request<RecompositionJob>(
        `/api/recompositions/by-key/${encodeURIComponent(pending.key)}`,
      );
      if (job.requestKey !== pending.key || !sameRequest(job.request, pending.request))
        throw Error(
          'The original request returned different blend settings. Keep the saved request and review its record.',
        );
      return observe(job);
    } catch (error) {
      if (error instanceof BlendResponseError && error.status === 404) return;
      throw error;
    }
  }

  async function send(pending: Admission) {
    remember(pending);
    let job: RecompositionJob;
    try {
      job = await request<RecompositionJob>('/api/recompositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: JSON.stringify(pending.request),
      });
    } catch (error) {
      // These route responses are guaranteed to precede durable admission.
      // Conflicts, transport failures and 5xx keep the exact request for lookup.
      if (error instanceof BlendResponseError && [400, 404].includes(error.status)) remember();
      throw error;
    }
    if (job.requestKey !== pending.key || !sameRequest(job.request, pending.request))
      throw Error(
        'The server response did not confirm this blend request. Check the original request.',
      );
    watched.current.add(job.id);
    observe(job);
  }

  async function act(work: () => Promise<void>) {
    if (browserDemo || actionRef.current) return;
    actionRef.current = true;
    setAction(true);
    setIssue('');
    try {
      await work();
    } catch (error) {
      setIssue(errorMessage(error));
    } finally {
      actionRef.current = false;
      setAction(false);
    }
  }

  function submit() {
    void act(async () => {
      if (admissionRef.current)
        throw Error('Check the original blend request before starting another.');
      if (!take || !recipe || takeBlendUnavailable(take) || !takeBlendMatches(take, recipe))
        throw Error('Restore this saved take before refining its final blend.');
      // Check durable records immediately before admission, including other tabs.
      const saved = (await request<unknown[]>('/api/recompositions')).map((row) =>
        recompositionJobSchema.parse(row),
      );
      setJobs(saved);
      if (saved.some(recompositionBusy))
        throw Error('Another CPU blend is still in progress. Wait for it to finish or cancel it.');
      await send({
        format: 'aftertake-blend-admission/1',
        key: crypto.randomUUID(),
        request: blendRequest(take, recipe),
      });
    });
  }

  function checkOriginal(retry = false) {
    void act(async () => {
      const pending = admissionRef.current;
      if (!pending) return;
      const found = await original(pending);
      if (found) return;
      setMissingOriginal(true);
      if (retry) await send(pending);
    });
  }

  function cancel(job: RecompositionJob) {
    void act(async () => {
      // Read first: a worker may have finished since the last poll.
      const current = observe(await request<RecompositionJob>(`/api/recompositions/${job.id}`));
      if (recompositionBusy(current) && current.state !== 'canceling')
        observe(
          await request<RecompositionJob>(`/api/recompositions/${job.id}/cancel`, {
            method: 'POST',
          }),
        );
    });
  }

  function openResult(job: RecompositionJob) {
    void act(async () => selection.current.onComplete(await loadResult(job), true));
  }

  const unavailable = takeBlendUnavailable(take);
  const matches = Boolean(take && takeBlendMatches(take, recipe));
  const parsedRequest =
    take && recipe && matches
      ? recompositionRequestSchema.safeParse({
          renderId: take.id,
          ...(recipe.compositeRegion ? { compositeRegion: recipe.compositeRegion } : {}),
          matchSourceColor: recipe.matchSourceColor || false,
        })
      : undefined;
  const emptyRegion = parsedRequest && !parsedRequest.success;
  const visibleJobs = jobs
    .filter(
      (job) =>
        recompositionBusy(job) || job.sourceRenderId === take?.id || job.renderId === take?.id,
    )
    .slice(0, 5);
  const blocked =
    browserDemo ||
    !loaded ||
    Boolean(unavailable) ||
    !matches ||
    Boolean(emptyRegion) ||
    action ||
    checking ||
    Boolean(admission) ||
    hasActiveJob;

  return (
    <section className="take-blend" aria-label="Refine a saved take blend">
      <div className="take-blend-heading">
        <div>
          <Cpu size={17} />
          <h2>Refine the blend</h2>
          <span>CPU · saved pixels</span>
        </div>
        {!browserDemo && (
          <button
            className="take-blend-check"
            onClick={() => void refresh()}
            disabled={checking || action}
            aria-label="Check saved blend jobs"
          >
            <RefreshCw size={14} className={checking ? 'take-blend-spin' : ''} />
            Check status
          </button>
        )}
      </div>
      <p>
        Paint where a finished region edit meets the source. Update its final area and boundary
        color without running the model again.
      </p>
      {unavailable ? (
        <p className="take-blend-hint">{unavailable}</p>
      ) : (
        <>
          <div className="take-blend-target">
            <span>Saved take</span>
            <strong>{take!.recipe.name}</strong>
          </div>
          {!matches && (
            <p className="take-blend-hint">
              The source, prompt, generation area or timing has changed. Restore the saved take to
              refine its blend; generation settings stay with that take.
            </p>
          )}
          {matches && (
            <p className="take-blend-hint">
              {recipe?.compositeRegion
                ? 'Editing a separate final blend area. Its timing follows the original generation cue.'
                : 'Using the original generation area. Choose Refine blend to paint a separate final area.'}
            </p>
          )}
          {emptyRegion && (
            <p className="take-blend-error">
              Paint at least one final region, or use the original generation area.
            </p>
          )}
          <div className="take-blend-actions">
            <button
              onClick={() => onPrepare(take!)}
              disabled={action || hasActiveJob || Boolean(admission)}
            >
              <Brush size={15} />
              {matches ? 'Refine blend' : 'Restore take for blending'}
            </button>
            {matches && recipe?.compositeRegion && (
              <button
                onClick={onUseGenerationRegion}
                disabled={action || hasActiveJob || Boolean(admission)}
              >
                <RotateCcw size={14} />
                Use generation area
              </button>
            )}
            <button className="take-blend-primary" onClick={submit} disabled={blocked}>
              {action ? <LoaderCircle size={15} className="take-blend-spin" /> : <Cpu size={15} />}
              Update blend
            </button>
          </div>
          <p className="take-blend-note">
            Creates a new take. The saved generation, source clock and original take stay intact. No
            CUDA connection is needed.
          </p>
        </>
      )}
      {browserDemo && (
        <p className="take-blend-hint">
          You can inspect and paint a draft here. Run the local studio to compute a new blend from
          its saved raw file.
        </p>
      )}
      {admission && (
        <div className="take-blend-recovery" role="status">
          <strong>Keep the original blend request</strong>
          <p>
            {missingOriginal
              ? 'No durable record was found for this key. An explicit retry will send the exact same request and key.'
              : 'The response has not been confirmed. Check its saved record before starting another blend.'}
          </p>
          <div className="take-blend-actions">
            <button onClick={() => checkOriginal()} disabled={action || checking}>
              <RefreshCw size={14} />
              Check original request
            </button>
            {missingOriginal && (
              <button onClick={() => checkOriginal(true)} disabled={action || checking}>
                Retry original request
              </button>
            )}
          </div>
          {sessionOnly && (
            <small>
              Browser storage is unavailable. Keep this page open until the saved request is
              confirmed.
            </small>
          )}
        </div>
      )}
      {issue && (
        <p className="take-blend-error" role="alert">
          {issue}
        </p>
      )}
      {visibleJobs.length > 0 && (
        <div className="take-blend-jobs" aria-live="polite">
          {visibleJobs.map((job) => (
            <article key={job.id} className={`take-blend-job ${job.state}`}>
              <div className="take-blend-job-copy">
                <strong>
                  {recompositionBusy(job) ? (
                    <LoaderCircle size={14} className="take-blend-spin" />
                  ) : job.state === 'succeeded' ? (
                    <Check size={14} />
                  ) : (
                    <Cpu size={14} />
                  )}
                  {labels[job.state]}
                </strong>
                <small>{job.originalRecipe.name}</small>
                {job.state === 'interrupted' && (
                  <p>
                    The local worker stopped before this blend finished. The original take remains
                    available. Review the draft, then explicitly choose Update blend to start a new
                    CPU attempt.
                  </p>
                )}
                {job.error && <p className="take-blend-error">{job.error}</p>}
              </div>
              {recompositionBusy(job) && job.state !== 'canceling' && (
                <button onClick={() => cancel(job)} disabled={action || checking}>
                  Cancel
                </button>
              )}
              {job.state === 'succeeded' && job.renderId !== take?.id && (
                <button onClick={() => openResult(job)} disabled={action || checking}>
                  Open refined take
                </button>
              )}
              {job.state === 'succeeded' && job.renderId === take?.id && (
                <span className="take-blend-current">Selected</span>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
