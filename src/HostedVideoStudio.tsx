import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Clapperboard,
  Cloud,
  Download,
  Film,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import type { Clip } from './domain';
import type { FilmAsset } from './film';
import {
  routerVideoRequestSchema,
  routerVideoBusy,
  type RouterQuote,
  type RouterVideoGeneration,
  type RouterVideoRequest,
  type RouterConnectionStatus,
} from './router-video';
import PreviewVideo from './PreviewVideo';
import { apiFetch, browserDemo, mediaUrl } from './transport';
import './hosted-video-studio.css';

type Admission = { key: string; request: RouterVideoRequest; scope: string; createdAt: string };
type Connection = RouterConnectionStatus;
type RequestFailure = Error & { status?: number; code?: string; video?: RouterVideoGeneration };
const endpoint = '/api/router-videos';
const draftKey = 'aftertake-hosted-video-draft';
const admissionKey = 'aftertake-hosted-video-admission';
const initial: RouterVideoRequest = {
  format: 'aftertake-router-video/1',
  name: 'Morning light',
  prompt:
    'An unbranded amber glass fragrance bottle on pale limestone beside fresh green leaves. Warm window light shines through the glass. A leaf shadow moves gently across the stone while the bottle stays still. A locked camera, realistic reflections and coherent glass edges. No text, labels or people. Quiet room ambience and a faint rustle of leaves. No speech or music.',
  aspect: 'landscape',
  seconds: 3,
  sound: true,
};
const stateNames: Record<RouterVideoGeneration['state'], string> = {
  submitting: 'Submitting your request',
  queued: 'In the queue',
  running: 'Creating your video',
  canceling: 'Cancellation requested',
  finalizing: 'Saving your video',
  succeeded: 'Ready to edit',
  failed: 'Could not finish',
  canceled: 'Canceled',
  submission_unknown: 'Submission needs a check',
  connection_lost: 'Connection interrupted',
  output_error: 'Video needs recovery',
};
const unresolved = routerVideoBusy;
const needsRecovery = (video: RouterVideoGeneration) =>
  ['submission_unknown', 'connection_lost', 'output_error'].includes(video.state);

function stored<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  try {
    return parse(JSON.parse(localStorage.getItem(key) || 'null'));
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Draft storage is optional; credentials never enter it.
  }
}
async function api<T>(path = '', init?: RequestInit): Promise<T> {
  const response = await apiFetch(endpoint + path, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(25_000)])
      : AbortSignal.timeout(25_000),
  });
  let value;
  try {
    value = await response.json();
  } catch {
    throw Object.assign(
      Error(
        'The studio returned an incomplete response. Check the original request before trying again.',
      ),
      {
        status: response.status,
      },
    );
  }
  if (!response.ok)
    throw Object.assign(Error(value.error || 'The hosted video request failed.'), {
      status: response.status,
      video: value.video,
      code: value.code,
    });
  return value;
}
function post(body?: unknown, key?: string, scope?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(scope ? { 'X-Aftertake-Admission-Scope': scope } : {}),
    },
    body: JSON.stringify(body || {}),
  };
}
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ''
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export default function HostedVideoStudio({
  onClose,
  onUse,
  onFilmAdded,
}: {
  onClose: () => void;
  onUse: (clip: Clip) => void;
  onFilmAdded?: () => void;
}) {
  const [request, setRequest] = useState(() =>
    stored(draftKey, routerVideoRequestSchema.parse, initial),
  );
  const [admission, setAdmission] = useState<Admission | undefined>(() =>
    stored(
      admissionKey,
      (value) => {
        const op = value as Admission;
        if (!op || typeof op.key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(op.key))
          throw Error('Invalid saved request');
        return {
          key: op.key,
          request: routerVideoRequestSchema.parse(op.request),
          scope: typeof op.scope === 'string' ? op.scope : '',
          createdAt: typeof op.createdAt === 'string' ? op.createdAt : '',
        };
      },
      undefined,
    ),
  );
  const [videos, setVideos] = useState<RouterVideoGeneration[]>([]);
  const [selected, setSelected] = useState('');
  const [connection, setConnection] = useState<Connection>();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!browserDemo);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [notice, setNotice] = useState('');
  const [estimate, setEstimate] = useState<RouterQuote>();
  const dialog = useRef<HTMLElement>(null);
  const recipeInput = useRef<HTMLInputElement>(null);
  const activeAction = useRef(false);
  const pending = videos.find(unresolved);
  const viewed = videos.find((video) => video.id === selected) || videos[0];
  const locked = browserDemo || busy || !!pending || !!admission || !!connection?.admissionIssue;
  const valid = routerVideoRequestSchema.safeParse(request).success;
  const connected = !!connection?.configured && connection.authenticated !== false;

  const refresh = useCallback(async () => {
    const list = await api<RouterVideoGeneration[]>();
    if (!Array.isArray(list)) throw Error('Saved videos could not be read. No request was sent.');
    setVideos((current) => mergeVideos(current, list));
    setPollError('');
    return list;
  }, []);
  const retain = (video: RouterVideoGeneration) => {
    setVideos((list) => [video, ...list.filter((item) => item.id !== video.id)]);
    setSelected(video.id);
  };

  useEffect(() => save(draftKey, request), [request]);
  useEffect(() => save(admissionKey, admission), [admission]);
  useEffect(() => {
    if (!admission) return;
    const found = videos.find((video) => video.requestKey === admission.key);
    if (found) {
      setSelected(found.id);
      setAdmission(undefined);
    }
  }, [videos, admission]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    if (!browserDemo) {
      void api<Connection>('/connection', { signal: controller.signal })
        .then((value) => {
          if (live) setConnection(value);
        })
        .catch(() => {
          if (live)
            setError(
              'Your hosted connection could not be read. Check the connection before generating.',
            );
        });
      const poll = async () => {
        try {
          const list = await api<RouterVideoGeneration[]>('', { signal: controller.signal });
          if (!Array.isArray(list)) throw Error('Saved videos could not be read.');
          if (live) {
            setVideos((current) => mergeVideos(current, list));
            setPollError('');
          }
        } catch {
          if (live)
            setPollError(
              'Live updates are interrupted. Your saved request stays intact; no new generation has been sent.',
            );
        } finally {
          if (live) {
            setLoading(false);
            timer = setTimeout(poll, 3000);
          }
        }
      };
      void poll();
    }
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function change(value: Partial<RouterVideoRequest>) {
    setRequest((current) => ({ ...current, ...value }));
    setEstimate(undefined);
    setNotice('');
  }
  async function action(run: () => Promise<void>) {
    if (browserDemo || activeAction.current) return;
    activeAction.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      activeAction.current = false;
      setBusy(false);
    }
  }
  async function connect() {
    if (!apiKey.trim()) return;
    const credential = apiKey.trim();
    // Clear the password immediately, including when saving or probing fails.
    setApiKey('');
    await action(async () => {
      setConnection(await api<Connection>('/connection', post({ apiKey: credential })));
      setNotice(
        'Key connected for this server session. You can check the connection without starting a generation.',
      );
    });
  }
  async function generate() {
    await action(async () => {
      let operation = admission;
      if (operation) {
        const list = await refresh();
        const existing = list.find((video) => video.requestKey === operation!.key);
        if (existing) {
          retain(existing);
          setAdmission(undefined);
          setNotice('Original request found. Reviewing it does not start another generation.');
          return;
        }
      } else {
        if (!connection?.admissionScope)
          throw Error(
            'The studio session could not be verified. Check your connection before creating a video.',
          );
        operation = {
          key: crypto.randomUUID(),
          request: routerVideoRequestSchema.parse(request),
          scope: connection.admissionScope,
          createdAt: new Date().toISOString(),
        };
        save(admissionKey, operation);
        setAdmission(operation);
      }
      if (!operation.scope)
        throw Error(
          'This retained request has no original server session. Its submission cannot be safely repeated. Review the saved history before creating another take.',
        );
      try {
        const video = await api<RouterVideoGeneration>(
          '',
          post(operation.request, operation.key, operation.scope),
        );
        if (video.requestKey !== operation.key)
          throw Error(
            'The studio did not confirm the original request key. Keep this request and check it before generating again.',
          );
        retain(video);
        setAdmission(undefined);
        setEstimate(undefined);
      } catch (failure) {
        const problem = failure as RequestFailure;
        if (problem.video?.requestKey === operation.key) {
          retain(problem.video);
          setAdmission(undefined);
        }
        if (problem.code === 'admission_scope_changed')
          throw Error(
            'The server restarted before this original request could be located. Its submission is unresolved, so Aftertake will not start a replacement that could charge you twice. Review the original provider request before continuing.',
          );
        if (!problem.video && [400, 409, 422].includes(problem.status || 0))
          setAdmission(undefined);
        // An interruption never creates a new browser request key.
        throw failure;
      }
    });
  }
  async function act(video: RouterVideoGeneration, operation: 'cancel' | 'reconcile') {
    await action(async () => {
      retain(await api<RouterVideoGeneration>(`/${video.id}/${operation}`, post()));
      if (operation === 'cancel')
        setNotice(
          'Cancellation requested. Provider billing may still apply to work already started.',
        );
      else
        setNotice(
          'Checking the original request. An uncertain submission is recovered with its original inputs and submission key.',
        );
    });
  }
  async function importRecipe(file?: File) {
    if (!file || locked) return;
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a hosted video recipe under 2 MB.');
      const value = JSON.parse(await file.text());
      setRequest(routerVideoRequestSchema.parse(value.request || value));
      setEstimate(undefined);
      setNotice(
        'Settings imported. Create video starts a deliberate new take; the provider does not expose a reproducible seed.',
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  async function addToFilm(clip: Clip) {
    await action(async () => {
      const response = await apiFetch(clip.url);
      if (!response.ok) throw Error('The completed video is unavailable.');
      const bytes = await response.arrayBuffer();
      const hash = async (value: ArrayBuffer) =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
      if ((await hash(bytes)) !== clip.sha256)
        throw Error(
          'The completed video changed. Recover its original output before adding it to Film.',
        );
      const assetsResponse = await apiFetch('/api/films/assets');
      const assets = await assetsResponse.json();
      if (!assetsResponse.ok) throw Error(assets.error || 'Film media could not be read.');
      for (const asset of (assets as FilmAsset[]).filter(
        (item) => item.kind === 'video' && item.sha256 === clip.sha256,
      )) {
        const existing = await apiFetch(`/api/films/assets/${asset.id}/media`);
        if (existing.ok && (await hash(await existing.arrayBuffer())) === clip.sha256) {
          onFilmAdded?.();
          setNotice(
            'This exact video is already in Film media. Open Film editing to place it in your cut.',
          );
          return;
        }
      }
      const imported = await apiFetch(
        '/api/films/assets?name=' + encodeURIComponent(clip.name + '.mp4'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        },
      );
      const value = await imported.json();
      if (!imported.ok) throw Error(value.error || 'The video could not be added to Film.');
      if (value.sha256 !== clip.sha256)
        throw Error('The Film asset differs from the completed video.');
      onFilmAdded?.();
      setNotice(
        `Added to Film media${clip.hasAudio ? ', with its audio intact' : ''}. Open Film editing to place it in your cut.`,
      );
    });
  }

  return (
    <div className="modal-backdrop hosted-video-backdrop" onClick={onClose}>
      <section
        className="modal hosted-video-studio"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hosted-video-title"
        aria-describedby="hosted-video-intro"
        ref={dialog}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),select:not(:disabled),a[href],summary',
            ) || [],
          ).filter((node) => node.getClientRects().length);
          if (event.shiftKey && document.activeElement === nodes[0]) {
            event.preventDefault();
            nodes.at(-1)?.focus();
          } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
            event.preventDefault();
            nodes[0]?.focus();
          }
        }}
      >
        <button className="modal-close" aria-label="Close hosted video studio" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="hosted-eyebrow">
          <Cloud size={15} /> HOSTED LTX <span>No local GPU needed</span>
        </div>
        <h2 id="hosted-video-title">A new scene. A few words.</h2>
        <p id="hosted-video-intro" className="hosted-intro">
          Create footage with LTX-2.5 Fast through Comfy Router, then bring it into your cut.
          Generations use your Comfy workspace credits.
        </p>

        {browserDemo && (
          <p className="hosted-callout" role="status">
            This recorded preview cannot connect an account or generate footage. Open the installed
            Aftertake app to use hosted video.
          </p>
        )}
        {connection?.admissionIssue && (
          <p className="hosted-callout" role="alert">
            {connection.admissionIssue}
          </p>
        )}

        <div className="hosted-video-grid">
          <div className="hosted-output-column">
            <div
              className={
                'hosted-preview' + (viewed?.request.aspect === 'portrait' ? ' portrait' : '')
              }
            >
              {viewed?.state === 'succeeded' && viewed.clip ? (
                <PreviewVideo
                  key={viewed.clip.sha256}
                  controls
                  playsInline
                  preload="metadata"
                  mediaSrc={viewed.clip.url}
                  aria-label={viewed.request.name}
                />
              ) : (
                <div className="hosted-preview-empty">
                  {viewed && unresolved(viewed) && !needsRecovery(viewed) ? (
                    <LoaderCircle size={29} className="spin" />
                  ) : (
                    <Clapperboard size={30} />
                  )}
                  <strong>
                    {viewed ? stateNames[viewed.state] : 'Your next shot starts here.'}
                  </strong>
                  <p>
                    {viewed
                      ? viewed.stage ||
                        (viewed.state === 'output_error'
                          ? 'Recover the existing output, or start a deliberate new take.'
                          : needsRecovery(viewed)
                            ? 'Check this saved request before starting another take.'
                            : 'You can close this window and return to the saved request.')
                      : 'Describe a product moment, a place, or an idea in motion.'}
                  </p>
                </div>
              )}
            </div>

            {viewed && (
              <div className="hosted-result-heading">
                <div>
                  <h3>{viewed.request.name}</h3>
                  <span>
                    {stateNames[viewed.state]}
                    {dateLabel(viewed.createdAt) && ' · ' + dateLabel(viewed.createdAt)}
                  </span>
                </div>
                {viewed.state === 'succeeded' && <Check size={17} />}
              </div>
            )}
            {viewed?.state === 'succeeded' && viewed.clip && (
              <>
                <div className="hosted-result-actions">
                  <button
                    className="button hosted-primary"
                    disabled={browserDemo || busy}
                    onClick={() => void addToFilm(viewed.clip!)}
                  >
                    <Film size={14} /> Add to Film
                  </button>
                  <button
                    className="button"
                    disabled={browserDemo || busy}
                    onClick={() => {
                      onUse(viewed.clip!);
                      onClose();
                    }}
                  >
                    Use as source <ArrowUpRight size={14} />
                  </button>
                  <a
                    className="button"
                    href={mediaUrl(viewed.clip.url)}
                    download="aftertake-hosted-video.mp4"
                  >
                    <Download size={14} /> MP4
                  </a>
                </div>
                <p className="hosted-media-facts">
                  {viewed.clip.width} × {viewed.clip.height} · {viewed.clip.duration.toFixed(2)}s ·{' '}
                  {viewed.clip.hasAudio ? 'with generated audio' : 'silent video'} · saved in your
                  workspace
                </p>
              </>
            )}
            {viewed && (
              <div className="hosted-receipt">
                <details>
                  <summary>Shot details &amp; saved request</summary>
                  <p>{viewed.request.prompt}</p>
                  <p>
                    {viewed.request.aspect === 'portrait' ? 'Portrait 9:16' : 'Landscape 16:9'} ·
                    requested {viewed.request.seconds}s ·{' '}
                    {viewed.request.sound ? 'keep generated sound' : 'silent output'}
                  </p>
                  {viewed.providerRequestId && (
                    <p className="hosted-request-id">
                      Provider request: {viewed.providerRequestId}
                    </p>
                  )}
                  <p>
                    A hosted recipe saves the request and output receipt. A new generation may
                    produce different footage; this provider does not expose a seed.
                  </p>
                </details>
                <div className="hosted-small-actions">
                  <button
                    disabled={locked}
                    onClick={() => {
                      setRequest(viewed.request);
                      setEstimate(undefined);
                      setNotice('Original settings restored. Creating video starts a new take.');
                    }}
                  >
                    <RotateCcw size={13} /> Reuse settings
                  </button>
                  <button
                    disabled={browserDemo || busy}
                    onClick={() =>
                      void action(async () => {
                        downloadJson(
                          await api(`/${viewed.id}/request`),
                          'aftertake-hosted-video-request.json',
                        );
                      })
                    }
                  >
                    <Download size={13} /> Save request
                  </button>
                </div>
                {viewed.error && <p role="alert">{viewed.error}</p>}
                {needsRecovery(viewed) && (
                  <div className="hosted-recovery">
                    <p>
                      This request is retained. Checking it retrieves its existing status or output;
                      it does not create another video.
                    </p>
                    <button
                      className="button"
                      disabled={browserDemo || busy}
                      onClick={() => void act(viewed, 'reconcile')}
                    >
                      <RefreshCw size={14} /> Check original request
                    </button>
                  </div>
                )}
                {unresolved(viewed) && !needsRecovery(viewed) && (
                  <div className="hosted-progress" role="status">
                    <span>{viewed.stage || stateNames[viewed.state]}</span>
                    {viewed.progress !== null && (
                      <progress
                        max={1}
                        value={Math.max(0, Math.min(1, viewed.progress))}
                        aria-label="Hosted video progress"
                      />
                    )}
                    {!['finalizing', 'canceling'].includes(viewed.state) && (
                      <button
                        disabled={busy || browserDemo}
                        onClick={() => void act(viewed, 'cancel')}
                      >
                        Cancel request
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {videos.length > 0 && (
              <section className="hosted-history" aria-label="Hosted video history">
                <div className="hosted-history-heading">
                  <h3>Saved takes</h3>
                  <span>{videos.length}</span>
                </div>
                <div className="hosted-history-list">
                  {videos.map((video) => (
                    <button
                      key={video.id}
                      aria-pressed={viewed?.id === video.id}
                      className={viewed?.id === video.id ? 'active' : ''}
                      onClick={() => setSelected(video.id)}
                    >
                      <span>
                        <strong>{video.request.name}</strong>
                        <small>
                          {video.request.aspect} · {video.request.seconds}s
                        </small>
                      </span>
                      <span
                        className={
                          'hosted-history-state ' + (video.state === 'succeeded' ? 'ready' : '')
                        }
                      >
                        {stateNames[video.state]}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {loading && (
              <p className="hosted-hint" role="status">
                Loading your saved takes…
              </p>
            )}
            {pollError && (
              <p className="hosted-callout" role="status">
                {pollError}
              </p>
            )}
          </div>

          <div className="hosted-controls">
            <details className="hosted-connection" open={!connection?.configured && !browserDemo}>
              <summary>
                <span>
                  <LockKeyhole size={15} /> Your Comfy connection
                </span>
                <span className={connected ? 'connected' : ''}>
                  {connected ? 'Connected' : connection?.configured ? 'Check key' : 'Add key'}
                </span>
              </summary>
              <p>
                Your key is kept in server memory for this session. It is never saved in this
                browser, a project, or a recipe.
              </p>
              <label>
                COMFY API KEY
                <input
                  type="password"
                  aria-label="Hosted Comfy API key"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={browserDemo || busy}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    connection?.configured ? 'Enter a replacement key' : 'Paste your Comfy API key'
                  }
                />
              </label>
              <div className="hosted-connection-actions">
                <button
                  className="button"
                  disabled={browserDemo || busy || !apiKey.trim()}
                  onClick={() => void connect()}
                >
                  Connect key
                </button>
                <button
                  className="button"
                  disabled={browserDemo || busy}
                  onClick={() =>
                    void action(async () => {
                      const current = await api<Connection>('/connection');
                      setConnection(current);
                      if (!current.configured) {
                        setNotice('Add your Comfy API key to connect this server session.');
                        return;
                      }
                      setConnection(await api<Connection>('/connection/probe', post()));
                      setNotice(
                        'Connection checked. No video was generated and no generation credits were spent.',
                      );
                    })
                  }
                >
                  Check connection
                </button>
                {connection?.configured && (
                  <button
                    className="hosted-remove"
                    disabled={browserDemo || busy}
                    onClick={() =>
                      void action(async () => {
                        setConnection(await api<Connection>('/connection', { method: 'DELETE' }));
                        setApiKey('');
                        setNotice(
                          'Hosted key removed from server memory. Saved videos remain available.',
                        );
                      })
                    }
                  >
                    Remove key
                  </button>
                )}
              </div>
              <a href="https://platform.comfy.org/" target="_blank" rel="noreferrer">
                Get a key from Comfy <ArrowUpRight size={12} />
              </a>
            </details>

            <button
              className="hosted-import"
              disabled={locked}
              onClick={() => recipeInput.current?.click()}
            >
              <Upload size={12} /> Import saved request
            </button>
            <label>
              SHOT NAME
              <input
                aria-label="Hosted video name"
                value={request.name}
                maxLength={100}
                disabled={locked}
                onChange={(event) => change({ name: event.target.value })}
              />
            </label>
            <label>
              DESCRIBE YOUR SCENE
              <textarea
                aria-label="Hosted video prompt"
                rows={7}
                maxLength={3000}
                value={request.prompt}
                disabled={locked}
                onChange={(event) => change({ prompt: event.target.value })}
              />
              <span className="hosted-field-hint">
                Include the action, camera, light and sound you want. Simple, focused shots work
                best.
              </span>
            </label>
            <div className="hosted-settings">
              <label>
                FRAME
                <select
                  aria-label="Hosted video aspect ratio"
                  value={request.aspect}
                  disabled={locked}
                  onChange={(event) =>
                    change({ aspect: event.target.value as RouterVideoRequest['aspect'] })
                  }
                >
                  <option value="landscape">Landscape · 16:9</option>
                  <option value="portrait">Portrait · 9:16</option>
                </select>
              </label>
              <label>
                LENGTH
                <select
                  aria-label="Hosted video length"
                  value={request.seconds}
                  disabled={locked}
                  onChange={(event) =>
                    change({ seconds: Number(event.target.value) as RouterVideoRequest['seconds'] })
                  }
                >
                  {([2, 3, 4, 5] as const).map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="hosted-sound">
              <input
                type="checkbox"
                aria-label="Keep hosted generated sound"
                checked={request.sound}
                disabled={locked}
                onChange={(event) => change({ sound: event.target.checked })}
              />
              <span>
                Keep generated sound
                <small>
                  Describe ambience or dialogue in your prompt. Review it before mixing your own
                  narration.
                </small>
              </span>
            </label>

            <div className="hosted-cost">
              <div>
                <Cloud size={15} />
                <strong>Runs on Comfy. Bills your workspace.</strong>
              </div>
              <p>
                Each deliberate generation uses your Comfy credits. A connection check or price
                estimate does not start a video.
              </p>
              <button
                disabled={browserDemo || busy || !valid || !connected}
                onClick={() =>
                  void action(async () => {
                    setEstimate(
                      (await api<{ quote: RouterQuote }>('/estimate', post({ request }))).quote,
                    );
                  })
                }
              >
                Check estimated cost
              </button>
              {estimate !== undefined && (
                <div className="hosted-estimate" role="status">
                  <Estimate value={estimate} />
                </div>
              )}
            </div>
            <button
              className="button hosted-generate"
              disabled={
                browserDemo ||
                busy ||
                loading ||
                (!admission && !!connection?.admissionIssue) ||
                (!!pending && !admission) ||
                (!admission && (!connected || !valid))
              }
              onClick={() => void generate()}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <Clapperboard size={16} />}
              {admission
                ? 'Recover original request'
                : pending
                  ? 'A request is in progress'
                  : 'Create video with Comfy credits'}
            </button>
            {admission && (
              <div className="hosted-callout">
                <p role="status">
                  Your original request key is retained. Recovery checks saved history first, then
                  resends only the same request and key if it is missing. A server restart keeps the
                  original request unresolved rather than creating a replacement.
                </p>
                <button
                  className="hosted-inline-link"
                  onClick={() =>
                    downloadJson(
                      {
                        requestKey: admission.key,
                        request: admission.request,
                        admissionScope: admission.scope,
                        createdAt: admission.createdAt,
                      },
                      'aftertake-retained-hosted-request.json',
                    )
                  }
                >
                  <Download size={12} /> Save retained request
                </button>
              </div>
            )}
            {!connected && !browserDemo && !admission && (
              <p className="hosted-hint">
                Connect your Comfy key above to create a video. No GPU or model download is needed
                on this machine.
              </p>
            )}
            {pending && viewed?.id !== pending.id && (
              <button className="hosted-inline-link" onClick={() => setSelected(pending.id)}>
                View the active request <ArrowUpRight size={12} />
              </button>
            )}
            <p className="hosted-hint">
              Hosted text-to-video is separate from local character swaps and painted edits. It uses
              a hosted model API; keep this distinction when choosing competition categories.
            </p>
            {notice && (
              <p className="hosted-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="hosted-error" role="alert">
                {error}
              </p>
            )}
            <input
              ref={recipeInput}
              type="file"
              accept="application/json,.json"
              hidden
              disabled={locked}
              onChange={(event) => {
                void importRecipe(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function Estimate({ value }: { value: RouterQuote }) {
  if (value.source === 'exact')
    return (
      <>
        <strong>
          {value.credits !== undefined ? `${value.credits} credits` : `$${value.amount} USD`} quoted
        </strong>
        <p>This is a price quote, not a generation.</p>
      </>
    );
  if (value.source === 'estimated')
    return (
      <>
        <strong>
          ${value.minAmount}–${value.maxAmount} USD estimated
        </strong>
        <p>The provider’s final charge may differ. This is an estimate, not a generation.</p>
      </>
    );
  return (
    <>
      <strong>Price estimate unavailable</strong>
      <p>Comfy could not return a price quote for this request.</p>
      <p>
        This does not mean generation was refused. Creating a video still uses your Comfy credits.
      </p>
    </>
  );
}

function mergeVideos(current: RouterVideoGeneration[], incoming: RouterVideoGeneration[]) {
  const records = new Map(current.map((video) => [video.id, video]));
  for (const video of incoming) {
    const prior = records.get(video.id);
    if (!prior || Date.parse(video.updatedAt) >= Date.parse(prior.updatedAt))
      records.set(video.id, video);
  }
  return [...records.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}
