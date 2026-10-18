import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Clapperboard,
  Download,
  Film,
  LoaderCircle,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import type { Clip, Engine } from './domain';
import type { FilmAsset } from './film';
import { cinemaOptions, defaultCinema, type Cinema } from './cinema';
import {
  videoBusy,
  videoDimensions,
  videoPrompt,
  videoRequestSchema,
  type VideoGeneration,
  type VideoRequest,
} from './video-generation';
import { apiFetch, browserDemo, mediaUrl } from './transport';
import './image-studio.css';
import './video-studio.css';

type Admission = { key: string; request: VideoRequest };
async function api<T>(url: string, body?: unknown, key?: string): Promise<T> {
  const response = await apiFetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(Error(value.error || 'The video request failed.'), {
      video: value.video,
      status: response.status,
    });
  return value;
}
function stored<T>(key: string, parse: (value: unknown) => T, fallback: T) {
  try {
    return parse(JSON.parse(localStorage.getItem(key) || 'null'));
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    value === undefined
      ? localStorage.removeItem(key)
      : localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Draft storage may be unavailable. */
  }
}
function download(value: unknown, name = 'aftertake-text-video-recipe.json') {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const initial: VideoRequest = {
  format: 'aftertake-text-video/1',
  name: 'Amber morning',
  seed: 509018,
  aspect: 'landscape',
  quality: 'draft',
  seconds: 3,
  sound: true,
  cinema: { ...defaultCinema, movement: 'locked', lighting: 'daylight' },
  prompt:
    'An unbranded amber glass fragrance bottle with a matte black cap on pale limestone beside fresh green leaves. Soft window light shines through the glass. A leaf shadow moves gently across the stone in a breeze; the bottle stays still. Realistic reflections and coherent glass edges. No text, labels or people. Quiet room ambience and a faint rustle of leaves. No speech or music.',
};

export default function VideoStudio({
  videos,
  otherBusy,
  onUpdate,
  onUse,
  onClose,
  onFilmAdded,
}: {
  videos: VideoGeneration[];
  otherBusy: boolean;
  onUpdate: (video: VideoGeneration) => void;
  onUse: (clip: Clip) => void;
  onClose: () => void;
  onFilmAdded?: () => void;
}) {
  const [request, setRequest] = useState(() =>
    stored('aftertake-video-draft', videoRequestSchema.parse, initial),
  );
  const [admission, setAdmission] = useState<Admission | undefined>(() =>
    stored(
      'aftertake-video-admission',
      (value) => {
        const op = value as Admission;
        if (!op || typeof op.key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(op.key))
          throw Error('Invalid saved request');
        return { key: op.key, request: videoRequestSchema.parse(op.request) };
      },
      undefined,
    ),
  );
  const [selected, setSelected] = useState(''),
    [engine, setEngine] = useState<Engine | null>(null),
    [sending, setSending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const dialog = useRef<HTMLElement>(null),
    input = useRef<HTMLInputElement>(null);
  const pending = videos.find(videoBusy),
    viewed = videos.find((v) => v.id === selected) || videos[0],
    locked = sending || !!pending || otherBusy || !!admission;
  const d = videoDimensions(request),
    look = request.cinema || { ...defaultCinema, movement: 'locked' as const };
  useEffect(() => save('aftertake-video-draft', request), [request]);
  useEffect(() => save('aftertake-video-admission', admission), [admission]);
  useEffect(() => {
    if (admission) {
      const found = videos.find((v) => v.requestKey === admission.key);
      if (found) {
        setSelected(found.id);
        setAdmission(undefined);
      }
    }
  }, [videos, admission]);
  useEffect(() => {
    let live = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    const check = () =>
      api<Engine>('/api/engine?pipeline=text-video')
        .then((v) => {
          if (live) setEngine(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      live = false;
      clearInterval(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  function change(value: Partial<VideoRequest>) {
    setRequest((r) => ({ ...r, ...value }));
    setNotice('');
  }
  function reviewTop() {
    dialog.current?.querySelector('.image-picture-column')?.scrollTo({ top: 0 });
  }
  async function generate() {
    setError('');
    setNotice('');
    setSending(true);
    let operation = admission;
    try {
      operation = operation || {
        key: crypto.randomUUID(),
        request: videoRequestSchema.parse(request),
      };
      setAdmission(operation);
      save('aftertake-video-admission', operation);
      const video = await api<VideoGeneration>('/api/videos', operation.request, operation.key);
      if (video.requestKey !== operation.key)
        throw Error(
          'The studio did not retain the original request key. Keep this request and rejoin it.',
        );
      onUpdate(video);
      setSelected(video.id);
      setAdmission(undefined);
      reviewTop();
    } catch (e) {
      const failure = e as Error & { video?: VideoGeneration; status?: number };
      if (failure.video && failure.video.requestKey === operation?.key) {
        onUpdate(failure.video);
        setSelected(failure.video.id);
        setAdmission(undefined);
      } else if ([400, 409, 422].includes(failure.status || 0)) setAdmission(undefined);
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }
  async function act(video: VideoGeneration, action: 'cancel' | 'reconcile') {
    setSending(true);
    setError('');
    try {
      onUpdate(await api<VideoGeneration>(`/api/videos/${video.id}/${action}`, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a video recipe under 2 MB.');
      const value = JSON.parse(await file.text());
      setRequest(videoRequestSchema.parse(value.request || value));
      reviewTop();
      setNotice('Settings imported. Creating a video starts a new deliberate take.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function addToFilm(clip: Clip) {
    setSending(true);
    setError('');
    try {
      const media = await apiFetch(clip.url);
      if (!media.ok) throw Error('The video is unavailable.');
      const bytes = await media.arrayBuffer(),
        hash = async (value: ArrayBuffer) =>
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('');
      if ((await hash(bytes)) !== clip.sha256)
        throw Error(
          'The generated video changed. Reopen its original completed take before adding it to Film.',
        );
      for (const asset of (await api<FilmAsset[]>('/api/films/assets')).filter(
        (a) => a.kind === 'video' && a.sha256 === clip.sha256,
      )) {
        const saved = await apiFetch(`/api/films/assets/${asset.id}/media`);
        if (saved.ok && (await hash(await saved.arrayBuffer())) === clip.sha256) {
          onFilmAdded?.();
          setNotice(
            'This exact video is already in Film media. Open Film editing to place it in your cut.',
          );
          return;
        }
      }
      const response = await apiFetch(
        '/api/films/assets?name=' + encodeURIComponent(clip.name + '.mp4'),
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not add the video to Film.');
      if (result.sha256 !== clip.sha256)
        throw Error('The imported Film asset differs from the video.');
      onFilmAdded?.();
      setNotice('Added to Film media. Open Film editing to place it in your cut.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="modal-backdrop image-studio-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal image-studio video-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Create a video"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const nodes = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),select:not(:disabled),a[href],summary',
              ) || []),
            ].filter((n) => n.getClientRects().length);
            if (event.shiftKey && document.activeElement === nodes[0]) {
              event.preventDefault();
              nodes.at(-1)?.focus();
            } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
              event.preventDefault();
              nodes[0]?.focus();
            }
          }
        }}
      >
        <button className="modal-close" aria-label="Close video studio" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="eyebrow">TEXT → VIDEO / LOCAL LTX-2.5</div>
        <h2>Words into motion.</h2>
        <p className="image-intro">
          Describe the shot, action and sound. Create a new video, then bring it into your cut with
          editable type and narration.
        </p>
        <div className="image-studio-grid">
          <div className="image-picture-column">
            <div className="video-picture">
              {viewed?.clip && viewed.state === 'succeeded' ? (
                <video
                  key={viewed.clip.sha256}
                  controls
                  playsInline
                  preload="metadata"
                  src={mediaUrl(viewed.clip.url)}
                  aria-label={viewed.request.name}
                />
              ) : (
                <div>
                  <Clapperboard size={34} />
                  <p>
                    {pending
                      ? pending.stage || 'Creating your video…'
                      : viewed?.error
                        ? 'This video did not finish.'
                        : 'Your scene starts with a few words.'}
                  </p>
                </div>
              )}
            </div>
            {viewed?.clip && viewed.state === 'succeeded' && (
              <>
                <div className="image-actions">
                  <button
                    className="button"
                    disabled={sending || browserDemo}
                    onClick={() => void addToFilm(viewed.clip!)}
                  >
                    <Film size={14} />
                    Add to Film
                  </button>
                  <button
                    className="button"
                    disabled={sending}
                    onClick={() => {
                      onUse(viewed.clip!);
                      onClose();
                    }}
                  >
                    Use as source
                    <ArrowUpRight size={14} />
                  </button>
                  <a
                    className="button"
                    href={mediaUrl(viewed.clip.url)}
                    download="aftertake-text-video.mp4"
                  >
                    <Download size={14} />
                    MP4
                  </a>
                  <button
                    className="button"
                    onClick={() =>
                      download({
                        format: 'aftertake-text-video/1',
                        request: viewed.request,
                        workflow: viewed.workflow,
                        output: viewed.clip,
                        jobId: viewed.jobId,
                      })
                    }
                  >
                    Video recipe ↗
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      download(viewed.workflow, 'aftertake-text-video-workflow-api.json')
                    }
                  >
                    ComfyUI graph ↗
                  </button>
                </div>
                <small>
                  {viewed.clip.width} × {viewed.clip.height} · {viewed.clip.duration.toFixed(2)}s ·
                  24 fps · {viewed.clip.hasAudio ? 'generated sound' : 'silent'} · seed{' '}
                  {viewed.request.seed}
                </small>
              </>
            )}
            {viewed && (
              <div className="image-receipt">
                <p>{viewed.request.prompt}</p>
                <button
                  className="button"
                  disabled={locked}
                  onClick={() => {
                    setRequest(viewed.request);
                    reviewTop();
                    setNotice('Original settings restored.');
                  }}
                >
                  <RotateCcw size={13} />
                  Reuse settings
                </button>
                {viewed.error && <p role="alert">{viewed.error}</p>}
                {['submission_unknown', 'connection_lost', 'output_error'].includes(
                  viewed.state,
                ) && (
                  <button
                    className="button"
                    disabled={sending}
                    onClick={() => void act(viewed, 'reconcile')}
                  >
                    Check submitted video
                  </button>
                )}
              </div>
            )}
            {videos.length > 0 && (
              <div className="video-history" aria-label="Video generation history">
                {videos.map((v) => (
                  <button
                    key={v.id}
                    className={viewed?.id === v.id ? 'active' : ''}
                    onClick={() => {
                      setSelected(v.id);
                      reviewTop();
                    }}
                  >
                    <strong>{v.request.name}</strong>
                    <small>
                      {v.state.replaceAll('_', ' ')} · {v.request.aspect} · seed {v.request.seed}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="image-controls">
            <button
              className="image-recipe-import"
              disabled={locked}
              onClick={() => input.current?.click()}
            >
              <Upload size={12} />
              Import video recipe
            </button>
            <label>
              VIDEO NAME
              <input
                aria-label="Video name"
                value={request.name}
                disabled={locked}
                maxLength={100}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              YOUR SCENE
              <textarea
                aria-label="Video prompt"
                rows={7}
                maxLength={3000}
                value={request.prompt}
                disabled={locked}
                onChange={(e) => change({ prompt: e.target.value })}
              />
            </label>
            <div className="image-settings">
              <label>
                FRAME
                <select
                  aria-label="Video aspect ratio"
                  value={request.aspect}
                  disabled={locked}
                  onChange={(e) => change({ aspect: e.target.value as VideoRequest['aspect'] })}
                >
                  <option value="landscape">Landscape · 16:9</option>
                  <option value="portrait">Portrait · 9:16</option>
                  <option value="square">Square · 1:1</option>
                </select>
              </label>
              <label>
                QUALITY
                <select
                  aria-label="Video quality"
                  value={request.quality}
                  disabled={locked}
                  onChange={(e) => change({ quality: e.target.value as VideoRequest['quality'] })}
                >
                  <option value="draft">Draft</option>
                  <option value="final">Final</option>
                </select>
              </label>
            </div>
            <label>
              SHOT LENGTH
              <select
                aria-label="Video shot length"
                value={request.seconds}
                disabled={locked}
                onChange={(e) => change({ seconds: Number(e.target.value) })}
              >
                {[2, 3, 4, 5].map((s) => (
                  <option key={s} value={s}>
                    {s}s · {s * 24 + 1} frames
                  </option>
                ))}
              </select>
            </label>
            <label className="video-sound">
              <input
                type="checkbox"
                aria-label="Generate video sound"
                checked={request.sound}
                disabled={locked}
                onChange={(e) => change({ sound: e.target.checked })}
              />
              <span>
                Keep generated sound
                <small>
                  Describe ambience or dialogue in your prompt. Review it before mixing narration.
                </small>
              </span>
            </label>
            <fieldset className="image-direction">
              <legend>Direct the shot</legend>
              {(['movement', 'lens', 'lighting', 'palette'] as const).map((key) => (
                <label key={key}>
                  {
                    {
                      movement: 'CAMERA',
                      lens: 'LENS DIRECTION',
                      lighting: 'LIGHT',
                      palette: 'GRADE',
                    }[key]
                  }
                  <select
                    aria-label={'Video ' + key}
                    disabled={locked}
                    value={look[key]}
                    onChange={(e) =>
                      change({ cinema: { ...look, [key]: e.target.value } as Cinema })
                    }
                  >
                    {cinemaOptions[key].map(([value, label]) => (
                      <option key={value} value={value}>
                        {value === 'source'
                          ? key === 'lighting'
                            ? 'Natural / your prompt'
                            : 'Natural color'
                          : label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <small>
                Camera and lighting choices guide the prompt. Review the generated movement.
              </small>
            </fieldset>
            <details className="image-compiled">
              <summary>View the exact generation prompt</summary>
              <p>{videoPrompt(request)}</p>
            </details>
            <label>
              SEED
              <div className="image-seed">
                <input
                  aria-label="Video seed"
                  type="number"
                  min={0}
                  max={2 ** 32 - 1}
                  step={1}
                  value={request.seed}
                  disabled={locked}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isInteger(v))
                      change({ seed: Math.max(0, Math.min(2 ** 32 - 1, v)) });
                  }}
                />
                <button
                  className="button"
                  aria-label="New video seed"
                  disabled={locked}
                  onClick={() => change({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </label>
            <button
              className="button image-generate"
              disabled={
                browserDemo ||
                sending ||
                (!admission &&
                  (!!pending ||
                    otherBusy ||
                    !engine?.ready ||
                    !videoRequestSchema.safeParse(request).success))
              }
              onClick={() => void generate()}
            >
              {pending || sending ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Clapperboard size={15} />
              )}{' '}
              {admission ? 'Rejoin original request' : pending ? 'Creating video…' : 'Create video'}
            </button>
            <small>
              {d.width} × {d.height} · {d.frames} frames · {d.duration.toFixed(2)}s at 24 fps · 8
              native sampling steps. Generated footage starts from text alone.
            </small>
            {admission && (
              <p className="image-install">
                The original request is retained. Rejoin it after a connection interruption; its
                seed and inputs stay the same.
              </p>
            )}
            {pending && (
              <div className="image-progress" role="status">
                <strong>{pending.stage || pending.state.replaceAll('_', ' ')}</strong>
                {pending.progress !== null && <span>{Math.round(pending.progress * 100)}%</span>}
                {pending.jobId && pending.state !== 'finalizing' && (
                  <button disabled={sending} onClick={() => void act(pending, 'cancel')}>
                    Cancel video
                  </button>
                )}
              </div>
            )}
            {otherBusy && !pending && (
              <p className="image-install">
                Another generation is active. You can review videos while it finishes.
              </p>
            )}
            {browserDemo ? (
              <p className="image-install">
                Create new videos in the local Aftertake studio. This hosted trial reviews recorded
                examples.
              </p>
            ) : (
              engine &&
              !engine.ready && (
                <details className="image-install" open>
                  <summary>
                    {engine.connected
                      ? 'Install the video model profile'
                      : 'Start your local engine'}
                  </summary>
                  <pre>python scripts/download-models.py --text-video</pre>
                  <p>
                    After setup, restart with <code>python scripts/engine.py</code>.
                  </p>
                  {engine.missing.map((item) => (
                    <small key={item}>
                      {item}
                      <br />
                    </small>
                  ))}
                </details>
              )
            )}
            {notice && (
              <p role="status" className="video-notice">
                {notice}
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void importRecipe(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
