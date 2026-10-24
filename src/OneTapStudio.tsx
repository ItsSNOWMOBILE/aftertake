import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, LoaderCircle, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import type { Clip } from './domain';
import {
  oneTapBusy,
  oneTapDuration,
  oneTapResult,
  type OneTapJob,
  type OneTapPreset,
} from './one-tap';
import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import PreviewVideo from './PreviewVideo';
import './image-studio.css';
import './video-studio.css';
import './one-tap-studio.css';

type Library = {
  presets: OneTapPreset[];
  music: { id: string; title: string; duration: number }[];
  problems: { file: string; error: string }[];
};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await apiFetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error || 'The effect request failed.');
  return value;
}
const preview = (id: string, extension: 'mp4' | 'jpg') =>
  `${import.meta.env.BASE_URL}one-tap/${id}.${extension}`;
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** What the automatic checks found, in plain words. */
function checkLine(job: OneTapJob) {
  const tried = job.attempts.filter((attempt) => attempt.check);
  const last = tried.at(-1)?.check;
  if (!last) return '';
  const retried = tried.length > 1 ? ' after one automatic re-render' : '';
  return last.ok
    ? `Checked${retried}: not blank, moving, ${last.measured.duration.toFixed(2)} s.`
    : `Check failed${retried}: ${last.problems.join(' ')}`;
}

export default function OneTapStudio({
  clips,
  initialClip,
  onImported,
  onClose,
}: {
  clips: Clip[];
  initialClip?: Clip;
  onImported: (clip: Clip) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<Library>({ presets: [], music: [], problems: [] });
  const [jobs, setJobs] = useState<OneTapJob[]>([]);
  const [presetId, setPresetId] = useState('');
  // A photo open in the studio starts selected; otherwise the first sample photo does.
  const [clipId, setClipId] = useState(initialClip?.kind === 'image' ? initialClip.id : '');
  const [time, setTime] = useState(0);
  const [title, setTitle] = useState('');
  const [watermark, setWatermark] = useState(true);
  const [selected, setSelected] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [uploaded, setUploaded] = useState<string[]>([]);
  // Your uploads first, then photos already shaped for 9:16, other photos, then clips.
  const sources = useMemo(() => {
    const rank = (clip: Clip) =>
      uploaded.includes(clip.id)
        ? -1 - uploaded.indexOf(clip.id) / 100
        : clip.kind !== 'image'
          ? 2
          : Math.abs(clip.width / clip.height - 9 / 16) < 0.01
            ? 0
            : 1;
    return clips.slice().sort((a, b) => rank(a) - rank(b));
  }, [clips, uploaded]);
  const preset = library.presets.find((item) => item.id === presetId) || library.presets[0];
  const editable = preset?.titles.find((item) => item.editable);
  const source = clips.find((clip) => clip.id === clipId);
  const viewed = jobs.find((job) => job.id === selected);
  const result = viewed && oneTapResult(viewed);
  const running = jobs.some(oneTapBusy);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('.one-tap-card')?.focus();
    let live = true;
    api<Library>('/api/one-tap/presets')
      .then((value) => live && setLibrary(value))
      .catch((failure) => live && setError(failure.message));
    const refresh = () =>
      api<OneTapJob[]>('/api/one-tap')
        .then((value) => live && setJobs(value))
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      clearInterval(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  // Open on the latest effect once; choosing a card afterwards shows its preview.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !jobs.length) return;
    opened.current = true;
    setSelected(jobs[0].id);
  }, [jobs]);
  useEffect(() => {
    setTitle(editable?.text || '');
  }, [preset?.id, editable?.text]);
  useEffect(() => {
    if (!clipId && sources[0]) setClipId(sources[0].id);
  }, [sources, clipId]);

  function update(job: OneTapJob) {
    setJobs((all) => [job, ...all.filter((item) => item.id !== job.id)]);
    setSelected(job.id);
  }
  /** Start the chosen effect, or run a finished one again with the same photo and a new seed. */
  async function start(again?: OneTapJob) {
    const request = again
      ? {
          ...again.request,
          seed: Math.floor(Math.random() * 2 ** 32),
          watermark: again.watermark,
        }
      : {
          preset: preset!.id,
          clipId,
          ...(source?.kind !== 'image' ? { time } : {}),
          ...(editable && title.trim() ? { title: title.trim() } : {}),
          watermark,
        };
    setError('');
    setSending(true);
    try {
      update(await api<OneTapJob>('/api/one-tap', request));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function act(job: OneTapJob, action: 'cancel' | 'export', body: unknown = {}) {
    setError('');
    setSending(true);
    try {
      update(await api<OneTapJob>(`/api/one-tap/${job.id}/${action}`, body));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setError('');
    setSending(true);
    try {
      const response = await apiFetch(`/api/clips?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const clip = await response.json();
      if (!response.ok) throw Error(clip.error || 'Could not import this file.');
      onImported(clip);
      setUploaded((ids) => [clip.id, ...ids]);
      setClipId(clip.id);
      setTime(0);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSending(false);
      if (upload.current) upload.current.value = '';
    }
  }
  const resultUrl = (job: OneTapJob, mark: boolean) =>
    `/api/one-tap/${job.id}/video?watermark=${mark ? 1 : 0}`;
  const fileName = (job: OneTapJob) =>
    `aftertake-${job.preset.id}-${job.attempts.at(-1)?.seed ?? 0}.mp4`;
  const accepts = preset?.accepts.includes(source?.kind === 'image' ? 'image' : 'video');

  return (
    <div className="modal-backdrop image-studio-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal image-studio one-tap-studio"
        role="dialog"
        aria-modal="true"
        aria-label="One-tap effects"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const nodes = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled):not([hidden]),a[href]',
              ) || []),
            ].filter((node) => node.getClientRects().length);
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
        <button className="modal-close" aria-label="Close one-tap effects" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="eyebrow">ONE-TAP EFFECTS / ANIMATE A FRAME + FILM</div>
        <h2>One photo in. A clip to share out.</h2>
        <p className="image-intro">
          Pick an effect and a photo. Aftertake moves the camera with LTX-2.5 on your GPU, checks
          the take, then cuts a 9:16 clip with titles, a transition and an ACE-Step song. Every
          preset is one JSON file in <code>presets/one-tap</code>.
        </p>
        <div className="one-tap-grid">
          <div className="one-tap-result-column">
            <div className="one-tap-picture">
              {viewed && result ? (
                <PreviewVideo
                  key={`${viewed.id}:${viewed.watermark}`}
                  controls
                  autoPlay
                  loop
                  playsInline
                  preload="auto"
                  mediaSrc={resultUrl(viewed, viewed.watermark)}
                  aria-label={`${viewed.preset.title} result`}
                />
              ) : viewed && oneTapBusy(viewed) ? (
                <div className="one-tap-progress" role="status">
                  <LoaderCircle className="spin" size={28} aria-hidden="true" />
                  <p>{viewed.stage}</p>
                  {viewed.progress !== null && (
                    <progress max={1} value={viewed.progress} aria-label="Render progress" />
                  )}
                </div>
              ) : preset ? (
                <video
                  key={preset.id}
                  aria-label={`${preset.title} preview`}
                  src={preview(preset.id, 'mp4')}
                  poster={preview(preset.id, 'jpg')}
                  muted
                  loop
                  playsInline
                  autoPlay={!reducedMotion()}
                />
              ) : null}
            </div>
            {viewed && (
              <div className="one-tap-receipt">
                <strong>
                  {viewed.preset.title} · seed {viewed.attempts.at(-1)?.seed ?? viewed.request.seed}
                </strong>
                <small>
                  {viewed.state === 'ready'
                    ? checkLine(viewed)
                    : viewed.state === 'failed'
                      ? viewed.error
                      : viewed.state === 'canceled'
                        ? 'Canceled.'
                        : `${viewed.stage} · ${checkLine(viewed) || 'Checks run when the take finishes.'}`}
                </small>
              </div>
            )}
            {viewed && (
              <div className="image-actions">
                {result && (
                  <a
                    className="button"
                    href={mediaUrl(`${resultUrl(viewed, viewed.watermark)}&download=1`)}
                    download={fileName(viewed)}
                    onClick={
                      browserDemo
                        ? (event) => {
                            event.preventDefault();
                            void saveMedia(
                              resultUrl(viewed, viewed.watermark),
                              fileName(viewed),
                            ).catch((failure) => setError(failure.message));
                          }
                        : undefined
                    }
                  >
                    <Download size={14} />
                    Download
                  </a>
                )}
                {!oneTapBusy(viewed) && (
                  <button
                    className="button"
                    disabled={sending || browserDemo}
                    title={browserDemo ? 'Render effects in the local studio.' : undefined}
                    onClick={() => void start(viewed)}
                  >
                    <RotateCcw size={14} />
                    Again (new seed)
                  </button>
                )}
                {result && (
                  <label className="one-tap-toggle">
                    <input
                      type="checkbox"
                      checked={viewed.watermark}
                      disabled={sending || browserDemo}
                      onChange={(event) =>
                        void act(viewed, 'export', { watermark: event.target.checked })
                      }
                    />
                    <span>Aftertake watermark</span>
                  </label>
                )}
                {oneTapBusy(viewed) && (
                  <button
                    className="button"
                    disabled={sending}
                    onClick={() => void act(viewed, 'cancel')}
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
            {jobs.length > 0 && (
              <div className="video-history" aria-label="Effect history">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    className={viewed?.id === job.id ? 'active' : ''}
                    onClick={() => setSelected(job.id)}
                  >
                    <strong>{job.preset.title}</strong>
                    <small>
                      {job.state === 'running' ? job.stage : job.state} · seed{' '}
                      {job.attempts.at(-1)?.seed ?? job.request.seed}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="one-tap-controls">
            <div className="one-tap-gallery" role="radiogroup" aria-label="Effects">
              {library.presets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={preset?.id === item.id}
                  className="one-tap-card"
                  onClick={() => {
                    setPresetId(item.id);
                    setSelected('');
                  }}
                >
                  <video
                    aria-hidden="true"
                    src={preview(item.id, 'mp4')}
                    poster={preview(item.id, 'jpg')}
                    muted
                    loop
                    playsInline
                    autoPlay={!reducedMotion()}
                    preload="metadata"
                  />
                  <strong>{item.title}</strong>
                  {preset?.id === item.id && <Check className="one-tap-chosen" size={14} />}
                </button>
              ))}
            </div>
            {preset && <p className="one-tap-line">{preset.line}</p>}
            {library.problems.length > 0 && (
              <details className="one-tap-problems">
                <summary>{library.problems.length} preset files need fixing</summary>
                {library.problems.map((problem) => (
                  <p key={problem.file}>
                    <code>{problem.file}</code> {problem.error}
                  </p>
                ))}
              </details>
            )}
            <div className="one-tap-source">
              <span className="one-tap-label">YOUR PHOTO</span>
              <div className="one-tap-sources" role="radiogroup" aria-label="Photo or clip">
                {sources.slice(0, 15).map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    role="radio"
                    aria-checked={clip.id === clipId}
                    title={clip.name}
                    onClick={() => {
                      setClipId(clip.id);
                      setTime(0);
                    }}
                  >
                    <img
                      alt={clip.name}
                      src={mediaUrl(
                        clip.kind === 'image' ? clip.url : `/api/thumbnails/${clip.id}?time=0`,
                      )}
                    />
                  </button>
                ))}
                <button
                  type="button"
                  className="one-tap-upload"
                  disabled={sending || browserDemo}
                  onClick={() => upload.current?.click()}
                >
                  <Upload size={16} />
                  <small>Add</small>
                </button>
                <input
                  ref={upload}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
                  onChange={(event) => void importFile(event.target.files?.[0])}
                />
              </div>
              {source && source.kind !== 'image' && (
                <label>
                  MOMENT · {time.toFixed(1)} s
                  <input
                    type="range"
                    aria-label="Moment of the clip to start from"
                    min={0}
                    max={Math.max(0, source.duration - 0.05)}
                    step={0.1}
                    value={time}
                    onChange={(event) => setTime(Number(event.target.value))}
                  />
                </label>
              )}
            </div>
            {editable && (
              <label>
                TITLE
                <input
                  aria-label="Effect title"
                  maxLength={60}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            )}
            <label className="one-tap-toggle">
              <input
                type="checkbox"
                checked={watermark}
                onChange={(event) => setWatermark(event.target.checked)}
              />
              <span>Small Aftertake watermark</span>
            </label>
            <button
              className="button image-generate one-tap-go"
              disabled={!preset || !source || !accepts || sending || browserDemo}
              title={browserDemo ? 'Render effects in the local studio.' : undefined}
              onClick={() => void start()}
            >
              {sending ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
              {running ? 'Make it (joins the line)' : 'Make it'}
            </button>
            <small>
              {preset
                ? `${oneTapDuration(preset).toFixed(1)} s · 720 × 1280 · ${
                    library.music.find((song) => song.id === preset.music?.track)?.title || 'no'
                  } song · about 2 minutes on an RTX 5080. A take that comes out blank, frozen or the wrong length renders once more with a new seed.`
                : ''}
              {source && !accepts && preset
                ? ` ${preset.title} starts from a ${preset.accepts.join(' or ')}.`
                : ''}
            </small>
            {browserDemo && (
              <small>
                The browser version shows recorded results. Run Aftertake locally to make your own.
              </small>
            )}
            {error && (
              <p className="one-tap-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
