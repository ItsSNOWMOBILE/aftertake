import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Download,
  Film,
  LoaderCircle,
  Redo2,
  RotateCcw,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type { Clip } from './domain';
import type { FilmAsset } from './film';
import {
  defaultFinishingSettings,
  finishingBusy,
  finishingRequestSchema,
  finishingRecipeSchema,
  applyOpticalFinishingPreset,
  matchingOpticalFinishingPreset,
  opticalFinishingPresets,
  type FinishingJob,
  type FinishingRequest,
  type FinishingSettings,
} from './finishing';
import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import PreviewVideo from './PreviewVideo';
import './image-studio.css';
import './finishing-studio.css';

type Pending = { key: string; request: FinishingRequest };
type History = { past: FinishingSettings[]; now: FinishingSettings; future: FinishingSettings[] };
const controls: {
  key: keyof FinishingSettings;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: 'exposureEV', label: 'Exposure', min: -3, max: 3, step: 0.05 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.02 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.02 },
  { key: 'temperature', label: 'Warmth', min: -1, max: 1, step: 0.02 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.02 },
  { key: 'sharpen', label: 'Sharpness', min: 0, max: 1, step: 0.02 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.02 },
  { key: 'grain', label: 'Film grain', min: 0, max: 1, step: 0.01 },
];
const opticalControls = [
  { key: 'glowStrength', label: 'Highlight glow', max: 1, step: 0.01, unit: '' },
  { key: 'glowRadius', label: 'Glow radius', max: 32, step: 0.5, unit: ' px' },
  { key: 'halationStrength', label: 'Warm halation', max: 1, step: 0.01, unit: '' },
  { key: 'halationRadius', label: 'Halo radius', max: 32, step: 0.5, unit: ' px' },
  { key: 'chromaticStrength', label: 'Color separation', max: 1, step: 0.01, unit: '' },
  { key: 'chromaticOffset', label: 'Color offset', max: 8, step: 0.25, unit: ' px' },
] as const;
async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await apiFetch(
    path,
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
    throw Object.assign(Error(value.error || 'This finishing operation could not be completed.'), {
      status: response.status,
    });
  return value;
}
function saveJSON(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pendingRequest(): Pending | undefined {
  if (browserDemo) return;
  try {
    const saved = JSON.parse(localStorage.getItem('aftertake-finishing-pending') || 'null');
    if (saved && typeof saved.key === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(saved.key))
      return { key: saved.key, request: finishingRequestSchema.parse(saved.request) };
  } catch {
    /* A malformed local draft is not an instruction to render. */
  }
}
function resultName(clip: Clip) {
  const extension =
    new URL(clip.url, window.location.href).pathname.match(/\.[a-z0-9]+$/i)?.[0] ||
    (clip.kind === 'image' ? '.png' : '.mp4');
  return clip.name.replace(/\.[a-z0-9]{2,5}$/i, '') + extension;
}
export default function FinishingStudio({
  initialClip,
  clips,
  onImport,
  onUse,
  onFilmAdded,
  onClose,
}: {
  initialClip: Clip;
  clips: Clip[];
  onImport: (clip: Clip) => void;
  onUse: (clip: Clip) => void;
  onFilmAdded: () => void;
  onClose: () => void;
}) {
  const [clip, setClip] = useState(initialClip);
  const [name, setName] = useState((initialClip.name + ' / finish').slice(0, 100));
  const [history, setHistory] = useState<History>({
    past: [],
    now: { ...defaultFinishingSettings },
    future: [],
  });
  const [jobs, setJobs] = useState<FinishingJob[]>([]);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState<Pending | undefined>(pendingRequest);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ before: string; after: string; time: number }>();
  const [previewTime, setPreviewTime] = useState(0);
  const [split, setSplit] = useState(50);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const previewSerial = useRef(0);
  const viewed = jobs.find((job) => job.id === selected);
  const active = jobs.find(finishingBusy);
  const locked = sending || Boolean(pending);
  const request = (): FinishingRequest =>
    finishingRequestSchema.parse({
      format: 'aftertake-finishing/1',
      name,
      clip,
      settings: history.now,
    });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      previewSerial.current += 1;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (browserDemo) return;
    let cancelled = false;
    const load = () =>
      api<FinishingJob[]>('/api/finishing')
        .then((value) => {
          if (!cancelled) setJobs(value);
        })
        .catch((failure) => {
          if (!cancelled) setError(failure.message);
        });
    void load();
    const timer = setInterval(() => {
      if (active || pending) void load();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [Boolean(active), pending?.key]);
  useEffect(() => {
    if (!preview) return;
    return () => {
      URL.revokeObjectURL(preview.before);
      URL.revokeObjectURL(preview.after);
    };
  }, [preview]);
  function clearPreview() {
    previewSerial.current += 1;
    setPreview(undefined);
    setSelected('');
  }
  function change(next: Partial<FinishingSettings>) {
    clearPreview();
    setHistory((previous) => ({
      past: [...previous.past.slice(-39), previous.now],
      now: { ...previous.now, ...next },
      future: [],
    }));
  }
  function undo(forward = false) {
    clearPreview();
    setHistory((previous) => {
      if (forward) {
        if (!previous.future.length) return previous;
        return {
          past: [...previous.past, previous.now],
          now: previous.future[0],
          future: previous.future.slice(1),
        };
      }
      if (!previous.past.length) return previous;
      return {
        past: previous.past.slice(0, -1),
        now: previous.past.at(-1)!,
        future: [previous.now, ...previous.future],
      };
    });
  }
  async function previewFrame() {
    setPreviewing(true);
    setError('');
    const serial = ++previewSerial.current;
    try {
      const value = request();
      const time = clip.kind === 'image' ? 0 : previewTime;
      const [before, after] = await Promise.all([
        apiFetch('/api/clips/' + clip.id + '/frame?time=' + time),
        apiFetch('/api/finishing/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: value, time }),
        }),
      ]);
      for (const response of [before, after]) {
        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          throw Error(failure?.error || 'The frame preview is unavailable.');
        }
        if (!response.headers.get('content-type')?.startsWith('image/'))
          throw Error('The finishing preview did not return an image.');
      }
      const images = await Promise.all([before.blob(), after.blob()]);
      if (serial !== previewSerial.current) return;
      setPreview({
        before: URL.createObjectURL(images[0]),
        after: URL.createObjectURL(images[1]),
        time,
      });
      setSelected('');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPreviewing(false);
    }
  }
  async function submit() {
    setSending(true);
    setError('');
    setNotice('');
    try {
      const operation = pending || { key: crypto.randomUUID(), request: request() };
      setPending(operation);
      localStorage.setItem('aftertake-finishing-pending', JSON.stringify(operation));
      const job = await api<FinishingJob>('/api/finishing', operation.request, operation.key);
      setJobs((all) => [job, ...all.filter((item) => item.id !== job.id)]);
      setSelected(job.id);
      setPending(undefined);
      localStorage.removeItem('aftertake-finishing-pending');
      setNotice('Finishing started. Your original footage and saved settings remain available.');
    } catch (failure) {
      if (
        [400, 404, 409, 413, 422, 503].includes(
          (failure as Error & { status?: number }).status || 0,
        )
      ) {
        setPending(undefined);
        localStorage.removeItem('aftertake-finishing-pending');
      }
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function addToFilm(result: Clip) {
    setSending(true);
    setError('');
    try {
      const response = await apiFetch(result.url);
      if (!response.ok) throw Error('The finished footage is unavailable.');
      const bytes = await response.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      if (digest !== result.sha256)
        throw Error('The finished footage changed on disk. Reopen its saved result.');
      const assets = await api<FilmAsset[]>('/api/films/assets');
      const existing = assets.find((asset) => asset.sha256 === digest);
      if (!existing) {
        const uploaded = await apiFetch(
          '/api/films/assets?name=' + encodeURIComponent(resultName(result)),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: bytes,
          },
        );
        if (!uploaded.ok)
          throw Error((await uploaded.json()).error || 'Could not add footage to Film.');
      }
      onFilmAdded();
      setNotice('Added to Film media. Place it in your cut from the Film editor.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    setError('');
    try {
      const value = JSON.parse(await file.text());
      if (!['aftertake-finishing-recipe/1', 'aftertake-finishing/1'].includes(value?.format))
        throw Error('Choose an Aftertake finishing recipe.');
      const parsed =
        value.format === 'aftertake-finishing/1'
          ? finishingRequestSchema.parse(value)
          : finishingRecipeSchema.parse(value).request;
      const original = clips.find((item) => item.sha256 === parsed.clip.sha256);
      if (!original)
        throw Error('Import the original source file first. Its content must match this recipe.');
      clearPreview();
      setClip(original);
      setName(parsed.name);
      setHistory({ past: [], now: parsed.settings, future: [] });
      setPreviewTime(0);
      setNotice(
        'Settings restored and bound to the matching source. Review a frame before exporting.',
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <div className="modal-backdrop image-studio-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal image-studio finishing-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Color and finish"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const nodes = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled),a[href]',
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
        <button className="modal-close" aria-label="Close finishing studio" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="eyebrow">COLOR / TEXTURE / FINISH</div>
        <h2>Give the take its finish.</h2>
        <p className="image-intro">
          Adjust your footage, compare an actual processed frame and save a new take. Your source
          stays available; the exported video keeps its original sound.
        </p>
        {browserDemo && (
          <p className="finishing-note">
            Color finishing runs in the local studio. This browser demo reviews recorded
            generations.
          </p>
        )}
        <div className="image-studio-grid">
          <div className="image-picture-column">
            <div className="finishing-viewer">
              {viewed?.clip ? (
                viewed.clip.kind === 'image' ? (
                  <img src={mediaUrl(viewed.clip.url)} alt="Finished image" />
                ) : (
                  <PreviewVideo mediaSrc={viewed.clip.url} controls playsInline />
                )
              ) : preview ? (
                <div className="finishing-split">
                  <img src={preview.before} alt="Original source frame" />
                  <img
                    className="finishing-after"
                    style={{ clipPath: 'inset(0 ' + (100 - split) + '% 0 0)' }}
                    src={preview.after}
                    alt="Processed finishing preview"
                  />
                  <span className="finishing-divider" style={{ left: split + '%' }} />
                  <span className="finishing-tag">FINISHED</span>
                  <span className="finishing-tag source">SOURCE</span>
                </div>
              ) : clip.kind === 'image' ? (
                <img src={mediaUrl(clip.url)} alt="Original source" />
              ) : (
                <PreviewVideo mediaSrc={clip.url} controls playsInline />
              )}
            </div>
            {preview && !viewed?.clip && (
              <label className="finishing-split-control">
                Before / after · {preview.time.toFixed(2)}s
                <input
                  aria-label="Finishing before and after split"
                  type="range"
                  min="0"
                  max="100"
                  value={split}
                  onChange={(event) => setSplit(Number(event.target.value))}
                />
              </label>
            )}
            <div className="image-actions">
              {clip.kind !== 'image' && (
                <label className="finishing-preview-time">
                  Frame at
                  <input
                    aria-label="Finishing preview time"
                    type="number"
                    min="0"
                    max={Math.max(0, clip.duration - 0.05)}
                    step="0.1"
                    value={previewTime}
                    onChange={(event) => {
                      clearPreview();
                      setPreviewTime(
                        Math.max(
                          0,
                          Math.min(clip.duration - 0.05, Number(event.target.value) || 0),
                        ),
                      );
                    }}
                  />
                  s
                </label>
              )}
              <button
                className="button"
                disabled={browserDemo || previewing || locked || Boolean(active)}
                onClick={() => void previewFrame()}
              >
                {previewing ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}
                Preview frame
              </button>
              <button
                className="button"
                disabled={!history.past.length || locked}
                onClick={() => undo()}
              >
                <Undo2 size={14} />
                Undo
              </button>
              <button
                className="button"
                disabled={!history.future.length || locked}
                onClick={() => undo(true)}
              >
                <Redo2 size={14} />
                Redo
              </button>
            </div>
            {viewed?.clip && (
              <div className="image-actions">
                <button
                  className="button"
                  onClick={() =>
                    void saveMedia(viewed.clip!.url, resultName(viewed.clip!)).catch((failure) =>
                      setError(failure.message),
                    )
                  }
                >
                  <Download size={14} />
                  Download
                </button>
                <button
                  className="button"
                  disabled={browserDemo || sending}
                  onClick={() => void addToFilm(viewed.clip!)}
                >
                  <Film size={14} />
                  Add to Film
                </button>
                <button
                  className="button"
                  onClick={() => {
                    onImport(viewed.clip!);
                    onUse(viewed.clip!);
                    onClose();
                  }}
                >
                  Use as source
                  <ArrowUpRight size={14} />
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setClip(viewed.request.clip);
                    setName(viewed.request.name);
                    setHistory({ past: [], now: viewed.request.settings, future: [] });
                    clearPreview();
                  }}
                >
                  Reuse settings
                </button>
              </div>
            )}
            <div className="finishing-history" aria-label="Finishing history">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  className={job.id === selected ? 'active' : ''}
                  onClick={() => {
                    setSelected(job.id);
                    if (job.clip) onImport(job.clip);
                  }}
                >
                  <strong>{job.request.name}</strong>
                  <span>
                    {job.state}
                    {job.clip?.hasAudio ? ' · with audio' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="image-controls finishing-controls">
            <label>
              SOURCE
              <select
                aria-label="Finishing source"
                value={clip.id}
                disabled={locked}
                onChange={(event) => {
                  const chosen = clips.find((item) => item.id === event.target.value);
                  if (chosen) {
                    clearPreview();
                    setClip(chosen);
                    setPreviewTime(0);
                    setName((chosen.name + ' / finish').slice(0, 100));
                  }
                }}
              >
                {clips.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              TAKE NAME
              <input
                aria-label="Finishing take name"
                maxLength={100}
                value={name}
                disabled={locked}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              FILM LOOK
              <select
                aria-label="Finishing film look"
                value={history.now.preset}
                disabled={locked}
                onChange={(event) =>
                  change({
                    preset: event.target.value as FinishingSettings['preset'],
                    lookStrength: event.target.value === 'clean' ? 0 : 0.7,
                  })
                }
              >
                <option value="clean">Clean / your adjustments</option>
                <option value="warm-film">Warm film</option>
                <option value="cool-film">Cool film</option>
                <option value="noir">Noir</option>
                <option value="vintage">Vintage</option>
              </select>
            </label>
            {history.now.preset !== 'clean' && (
              <label>
                LOOK STRENGTH
                <input
                  aria-label="Finishing look strength"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  disabled={locked}
                  value={history.now.lookStrength}
                  onChange={(event) => change({ lookStrength: Number(event.target.value) })}
                />
              </label>
            )}
            {controls.map((control) => (
              <label className="finishing-slider" key={control.key}>
                <span>
                  {control.label}
                  <output>{Number(history.now[control.key]).toFixed(2)}</output>
                </span>
                <input
                  aria-label={'Finishing ' + control.label.toLowerCase()}
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={Number(history.now[control.key])}
                  disabled={locked}
                  onChange={(event) => change({ [control.key]: Number(event.target.value) })}
                />
              </label>
            ))}
            <fieldset className="finishing-optics" disabled={locked}>
              <legend>Optical effects</legend>
              <label>
                OPTICAL RECIPE
                <select
                  aria-label="Finishing optical recipe"
                  value={matchingOpticalFinishingPreset(history.now)}
                  onChange={(event) =>
                    change(applyOpticalFinishingPreset(history.now, event.target.value))
                  }
                >
                  <option value="custom" disabled>
                    Custom adjustments
                  </option>
                  {opticalFinishingPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Glow and warm halos spread bright highlights. Color separation adds a stylized
                red/blue edge; it does not repair composite seams. Recipes keep your color grade.
                Review with Preview frame before saving a finished take.
              </p>
              {opticalControls.map((control) => (
                <label className="finishing-slider" key={control.key}>
                  <span>
                    {control.label}
                    <output>
                      {history.now[control.key].toFixed(2)}
                      {control.unit}
                    </output>
                  </span>
                  <input
                    aria-label={'Finishing ' + control.label.toLowerCase()}
                    type="range"
                    min="0"
                    max={control.max}
                    step={control.step}
                    value={history.now[control.key]}
                    onChange={(event) => change({ [control.key]: Number(event.target.value) })}
                  />
                </label>
              ))}
            </fieldset>
            {history.now.grain > 0 && (
              <label>
                GRAIN SEED
                <input
                  aria-label="Finishing grain seed"
                  type="number"
                  min="0"
                  max={2 ** 32 - 1}
                  step="1"
                  value={history.now.seed}
                  disabled={locked}
                  onChange={(event) =>
                    change({
                      seed: Math.max(
                        0,
                        Math.min(2 ** 32 - 1, Math.round(Number(event.target.value) || 0)),
                      ),
                    })
                  }
                />
              </label>
            )}
            <button
              className="button"
              disabled={locked}
              onClick={() => change({ ...defaultFinishingSettings })}
            >
              <RotateCcw size={14} />
              Reset adjustments
            </button>
            <button
              className="button primary"
              disabled={browserDemo || sending || previewing || (!pending && Boolean(active))}
              onClick={() => void submit()}
            >
              {sending || active ? <LoaderCircle size={14} className="spin" /> : <Film size={14} />}
              {pending
                ? 'Rejoin saved finishing request'
                : active
                  ? 'Finishing footage…'
                  : 'Save finished take'}
            </button>
            {pending && (
              <button
                className="button"
                disabled={sending}
                onClick={() => {
                  setPending(undefined);
                  localStorage.removeItem('aftertake-finishing-pending');
                  setNotice(
                    'Local request draft discarded. Any export already accepted by the studio remains in history.',
                  );
                }}
              >
                Discard local request draft
              </button>
            )}
            {active && (
              <button
                className="button"
                disabled={sending}
                onClick={() =>
                  void api<FinishingJob>('/api/finishing/' + active.id + '/cancel', {})
                    .then((job) =>
                      setJobs((all) => [job, ...all.filter((item) => item.id !== job.id)]),
                    )
                    .catch((failure) => setError(failure.message))
                }
              >
                Cancel finishing
              </button>
            )}
            <div className="image-actions">
              <button
                className="button"
                disabled={locked}
                onClick={() => importFile.current?.click()}
              >
                <Upload size={14} />
                Import settings
              </button>
              <button
                className="button"
                onClick={() => {
                  if (viewed)
                    void api('/api/finishing/' + viewed.id + '/recipe')
                      .then((value) => saveJSON(value, 'aftertake-finishing.json'))
                      .catch((failure) => setError(failure.message));
                  else {
                    try {
                      saveJSON(
                        {
                          format: 'aftertake-finishing-recipe/1',
                          processor: 'aftertake-cpu-finishing/1',
                          sourceSha256: clip.sha256,
                          request: request(),
                        },
                        'aftertake-finishing.json',
                      );
                    } catch (failure) {
                      setError((failure as Error).message);
                    }
                  }
                }}
              >
                <Download size={14} />
                Save recipe
              </button>
            </div>
            <small>
              Finishing uses the original pixels and audio. It changes color and texture; it does
              not regenerate faces or objects.
            </small>
          </div>
        </div>
        {error && (
          <p role="alert" className="studio-error">
            {error}
          </p>
        )}
        {viewed?.error && (
          <p role="alert" className="studio-error">
            {viewed.error}
          </p>
        )}
        {notice && (
          <p role="status" className="finishing-note">
            {notice}
          </p>
        )}
        <input
          ref={importFile}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            void importRecipe(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </section>
    </div>
  );
}
