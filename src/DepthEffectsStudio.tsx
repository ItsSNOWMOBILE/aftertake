import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, Film, Layers, LoaderCircle, Upload, X } from 'lucide-react';
import type { Clip, Engine } from './domain';
import {
  defaultDepthSettings,
  depthEffectBusy,
  depthEffectRecipeSchema,
  depthEffectRequestSchema,
  type DepthEffectJob,
  type DepthSettings,
} from './depth-effects';
import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import './image-studio.css';
import './depth-effects-studio.css';
import {
  depthEffectPresets,
  applyDepthEffectPreset,
  matchingDepthEffectPreset,
} from './effect-presets';

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
    throw Object.assign(Error(value.error || 'The depth effect could not complete.'), {
      job: value.depthEffect,
    });
  return value;
}
const controls: {
  key: Exclude<keyof DepthSettings, 'hazeColor'>;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}[] = [
  { key: 'focus', label: 'Focus depth', min: 0, max: 1, step: 0.01 },
  { key: 'blur', label: 'Lens blur', min: 0, max: 32, step: 0.5, unit: 'px' },
  { key: 'haze', label: 'Haze', min: 0, max: 1, step: 0.01 },
  { key: 'lightAzimuth', label: 'Light direction', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'lightElevation', label: 'Light elevation', min: 0, max: 90, step: 1, unit: '°' },
  { key: 'lightStrength', label: 'Light strength', min: 0, max: 1, step: 0.01 },
];
type Attempt = { request: string; id: string };
export function depthAttemptAfterJob(
  attempt: Attempt | undefined,
  job: Pick<DepthEffectJob, 'state' | 'requestKey'>,
) {
  return attempt &&
    job.requestKey === attempt.id &&
    ['failed', 'canceled', 'expired'].includes(job.state)
    ? undefined
    : attempt;
}
export default function DepthEffectsStudio({
  initialClip,
  clips,
  otherBusy,
  onUse,
  onImport,
  onFilmAdded,
  onClose,
}: {
  initialClip?: Clip;
  clips: Clip[];
  otherBusy: boolean;
  onUse: (clip: Clip) => void;
  onImport: (clip: Clip) => void;
  onFilmAdded?: () => void;
  onClose: () => void;
}) {
  const pictures = clips.filter((clip) => clip.kind === 'image');
  const [source, setSource] = useState<Clip | undefined>(
    initialClip?.kind === 'image' ? initialClip : pictures[0],
  );
  const [name, setName] = useState('Depth, light and atmosphere');
  const [settings, setSettings] = useState<DepthSettings>({ ...defaultDepthSettings });
  const [jobs, setJobs] = useState<DepthEffectJob[]>([]),
    [selected, setSelected] = useState('');
  const [engine, setEngine] = useState<Engine>();
  const [view, setView] = useState<'source' | 'result' | 'depth'>('source');
  const [sending, setSending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const dialog = useRef<HTMLElement>(null),
    importFile = useRef<HTMLInputElement>(null),
    photoFile = useRef<HTMLInputElement>(null);
  const key = useRef<Attempt | undefined>(undefined);
  const submitted = useRef(new Set<string>());
  const importCallback = useRef(onImport);
  importCallback.current = onImport;
  const active = jobs.find(depthEffectBusy);
  const history = jobs.filter((job) => job.request.clip.sha256 === source?.sha256);
  const viewed = history.find((job) => job.id === selected) || history[0];
  const parsed = depthEffectRequestSchema.safeParse({
    format: 'aftertake-depth-effect/1',
    name,
    clip: source,
    settings,
  });
  const changed = Boolean(
    viewed && parsed.success && JSON.stringify(viewed.request) !== JSON.stringify(parsed.data),
  );
  const preset = matchingDepthEffectPreset(settings);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      previous?.isConnected && previous.focus();
    };
  }, []);
  useEffect(() => {
    if (browserDemo) return;
    let live = true,
      reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const [saved, status] = await Promise.all([
          api<DepthEffectJob[]>('/api/depth-effects'),
          api<Engine>('/api/engine?pipeline=depth'),
        ]);
        if (!live) return;
        setJobs(saved);
        setEngine(status);
        for (const job of saved) {
          key.current = depthAttemptAfterJob(key.current, job);
          if (job.state === 'succeeded' && job.clip && submitted.current.delete(job.id))
            importCallback.current(job.clip);
        }
      } catch (cause) {
        if (live) setError((cause as Error).message);
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  function restore(job: DepthEffectJob) {
    setSource(job.request.clip);
    setName(job.request.name);
    setSettings(job.request.settings);
    setSelected(job.id);
    setView(job.clip ? 'result' : 'source');
    setError('');
  }
  function applyPreset(id: string) {
    if (!id) return;
    // Only editable settings change; submitted jobs and admission keys remain
    // available to rejoin an uncertain request using their original identity.
    const chosen = depthEffectPresets.find((item) => item.id === id);
    if (!chosen) return;
    setSettings(
      parsed.success
        ? applyDepthEffectPreset(parsed.data, id).settings
        : structuredClone(chosen.settings),
    );
    setNotice('Preset loaded. Review the still-image settings before creating a result.');
  }
  async function render() {
    if (browserDemo || sending || active || otherBusy || !parsed.success || !engine?.ready) return;
    setSending(true);
    setError('');
    setNotice('');
    const serialized = JSON.stringify(parsed.data);
    if (key.current?.request !== serialized)
      key.current = { request: serialized, id: crypto.randomUUID() };
    try {
      const job = await api<DepthEffectJob>('/api/depth-effects', parsed.data, key.current.id);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setSelected(job.id);
      setView('result');
      submitted.current.add(job.id);
      key.current = depthAttemptAfterJob(key.current, job);
    } catch (cause) {
      const failure = cause as Error & { job?: DepthEffectJob };
      if (failure.job) {
        key.current = depthAttemptAfterJob(key.current, failure.job);
        setJobs((current) => [
          failure.job!,
          ...current.filter((item) => item.id !== failure.job!.id),
        ]);
        setSelected(failure.job.id);
      }
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }
  async function act(job: DepthEffectJob, action: 'cancel' | 'reconcile') {
    setSending(true);
    setError('');
    try {
      const value = await api<DepthEffectJob>(`/api/depth-effects/${job.id}/${action}`, {});
      key.current = depthAttemptAfterJob(key.current, value);
      setJobs((current) => [value, ...current.filter((item) => item.id !== value.id)]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function upload(file?: File) {
    if (!file || browserDemo) return;
    setSending(true);
    setError('');
    try {
      if (file.size > 100 * 1024 ** 2) throw Error('Choose a still image under 100 MB.');
      const response = await apiFetch('/api/clips?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const clip = await response.json();
      if (!response.ok) throw Error(clip.error || 'Could not import this picture.');
      onImport(clip);
      setSource(clip);
      setSelected('');
      setView('source');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2 * 1024 ** 2) throw Error('Choose a depth recipe under 2 MB.');
      const value = depthEffectRecipeSchema.parse(JSON.parse(await file.text()));
      const matched = pictures.find((clip) => clip.sha256 === value.request.clip.sha256);
      if (!matched)
        throw Error(
          'Import the exact original image first; this recipe is bound to its content hash.',
        );
      setSource(matched);
      setName(value.request.name);
      setSettings(value.request.settings);
      setSelected('');
      setView('source');
      setNotice(
        'Recipe restored with its matching source. Review settings before creating a new result.',
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function exportRecipe(job: DepthEffectJob) {
    try {
      const value = await api(`/api/depth-effects/${job.id}/recipe`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'aftertake-depth-effect-recipe.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function download(url: string, name: string) {
    try {
      await saveMedia(url, name);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function addToFilm(clip: Clip) {
    setSending(true);
    setError('');
    try {
      const response = await apiFetch(clip.url);
      if (!response.ok) throw Error('The completed image is unavailable.');
      const bytes = await response.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      if (hash !== clip.sha256)
        throw Error('The image differs from its saved result. Reopen the completed effect.');
      const upload = await apiFetch(
        '/api/films/assets?name=' + encodeURIComponent(clip.name + '.png'),
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes },
      );
      if (!upload.ok)
        throw Error((await upload.json()).error || 'Could not add this image to Film.');
      onFilmAdded?.();
      setNotice('Added to Film media. Place the still in your cut from Film editing.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="modal-backdrop image-studio-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal image-studio depth-effects-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Depth and atmosphere"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled),a[href],summary',
              ) || []),
            ].filter((node) => node.getClientRects().length);
            if (event.shiftKey && document.activeElement === controls[0]) {
              event.preventDefault();
              controls.at(-1)?.focus();
            } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
              event.preventDefault();
              controls[0]?.focus();
            }
          }
        }}
      >
        <button className="modal-close" aria-label="Close depth studio" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="eyebrow">STILL IMAGE / NATIVE DA3 SMALL</div>
        <h2>Depth. Light. Atmosphere.</h2>
        <p className="image-intro">
          Estimate real depth from a still image, then shape lens blur, haze and directional light.
          Save the result for editing, Film or Animate a frame.
        </p>
        <p className="depth-effects-note">
          This version processes still images. Lighting uses approximate normals from relative
          depth; it does not reconstruct physical shadows or claim stable video depth.
        </p>
        {browserDemo && (
          <p className="depth-effects-note">
            Depth effects run in the local studio with the optional open DA3 weights. This browser
            trial does not run the model.
          </p>
        )}
        <div className="image-studio-grid">
          <div className="image-picture-column">
            <div className="depth-effects-tabs" role="group" aria-label="Depth preview">
              <button
                className="button"
                aria-pressed={view === 'source'}
                onClick={() => setView('source')}
              >
                Source
              </button>
              <button
                className="button"
                disabled={!viewed?.clip}
                aria-pressed={view === 'result'}
                onClick={() => setView('result')}
              >
                Result
              </button>
              <button
                className="button"
                disabled={!viewed?.depth}
                aria-pressed={view === 'depth'}
                onClick={() => setView('depth')}
              >
                Model depth
              </button>
            </div>
            <div className="depth-effects-viewer">
              {view === 'depth' && viewed?.depth ? (
                <img
                  src={mediaUrl(`/api/depth-effects/${viewed.id}/depth-preview`)}
                  alt="Actual model relative depth, near dark and far light"
                />
              ) : view === 'result' && viewed?.clip ? (
                <img src={mediaUrl(viewed.clip.url)} alt="Completed depth effect" />
              ) : source ? (
                <img src={mediaUrl(source.url)} alt="Original source image" />
              ) : (
                <div>
                  <Layers size={32} />
                  <p>Import a still image to begin.</p>
                </div>
              )}
            </div>
            {viewed?.clip && (
              <div className="image-actions">
                <button
                  className="button"
                  disabled={sending}
                  onClick={() => {
                    onUse(viewed.clip!);
                    onClose();
                  }}
                >
                  Use image <ArrowUpRight size={14} />
                </button>
                <button
                  className="button"
                  disabled={sending || browserDemo}
                  onClick={() => void addToFilm(viewed.clip!)}
                >
                  <Film size={14} /> Add to Film
                </button>
                <button
                  className="button"
                  onClick={() => void download(viewed.clip!.url, 'aftertake-depth-effect.png')}
                >
                  <Download size={14} /> PNG
                </button>
                <button className="button" onClick={() => void exportRecipe(viewed)}>
                  Recipe
                </button>
                <button
                  className="button"
                  onClick={() =>
                    void download(
                      `/api/depth-effects/${viewed.id}/depth`,
                      'aftertake-model-depth.npz',
                    )
                  }
                >
                  Raw depth
                </button>
              </div>
            )}
            {changed && viewed?.clip && (
              <p className="depth-effects-note">
                Settings changed. The saved result above uses its original settings; create a new
                result to apply your edits.
              </p>
            )}
            {active && (
              <p className="depth-effects-status" role="status">
                <LoaderCircle size={14} className="spin" />
                {active.stage || active.state.replaceAll('_', ' ')}
                <button
                  className="button"
                  disabled={sending || active.state === 'finalizing' || !active.jobId}
                  onClick={() => void act(active, 'cancel')}
                >
                  Cancel
                </button>
              </p>
            )}
            {viewed?.error && (
              <p className="depth-effects-error" role="alert">
                {viewed.error}
              </p>
            )}
            {viewed &&
              ['connection_lost', 'submission_unknown', 'output_error'].includes(viewed.state) && (
                <button
                  className="button"
                  disabled={sending}
                  onClick={() => void act(viewed, 'reconcile')}
                >
                  Check this submitted job
                </button>
              )}
            {jobs.length > 0 && (
              <label className="depth-effects-history">
                Saved depth effects
                <select
                  aria-label="Saved depth effect"
                  value={viewed?.id || ''}
                  onChange={(event) => {
                    const job = jobs.find((item) => item.id === event.target.value);
                    if (job) restore(job);
                  }}
                >
                  <option value="">Choose an effect</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.request.name} · {job.state.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="image-controls depth-effects-controls">
            <label>
              Starting look · still image
              <select
                aria-label="Depth effect preset"
                value={preset?.id || ''}
                disabled={sending}
                onChange={(event) => applyPreset(event.target.value)}
              >
                <option value="">Custom settings</option>
                {depthEffectPresets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="depth-effects-note">
              {preset?.description ||
                'Choose an editable still-image starting point. Applying a preset does not run the model or create a result.'}
            </p>
            <label>
              SOURCE IMAGE
              <select
                aria-label="Depth source image"
                value={source?.id || ''}
                disabled={sending}
                onChange={(event) => {
                  setSource(pictures.find((item) => item.id === event.target.value));
                  setSelected('');
                  setView('source');
                }}
              >
                <option value="">Choose an image</option>
                {pictures.map((clip) => (
                  <option value={clip.id} key={clip.id}>
                    {clip.name} · {clip.width} × {clip.height}
                  </option>
                ))}
              </select>
            </label>
            <div className="image-actions">
              <button
                className="button"
                disabled={browserDemo || sending}
                onClick={() => photoFile.current?.click()}
              >
                <Upload size={14} /> Import image
              </button>
              <button
                className="button"
                disabled={sending}
                onClick={() => importFile.current?.click()}
              >
                Import recipe
              </button>
            </div>
            <label>
              RESULT NAME
              <input
                value={name}
                maxLength={100}
                disabled={sending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {controls.map((control) => (
              <label className="depth-effect-range" key={control.key}>
                <span>
                  {control.label}
                  <output>
                    {control.unit
                      ? `${settings[control.key]}${control.unit}`
                      : `${Math.round(settings[control.key] * 100)}%`}
                  </output>
                </span>
                <input
                  aria-label={control.label}
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={settings[control.key]}
                  disabled={sending}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      [control.key]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
            <label className="depth-effect-color">
              HAZE COLOR
              <input
                aria-label="Haze color"
                type="color"
                value={settings.hazeColor}
                disabled={sending}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, hazeColor: event.target.value }))
                }
              />
            </label>
            <button
              className="button"
              disabled={sending}
              onClick={() => setSettings({ ...defaultDepthSettings })}
            >
              Reset effects
            </button>
            <p className="depth-effects-note">
              Focus depth: 0 is near, 100% is far. Blur increases with distance from this focus
              plane. Haze increases toward the far depth.
            </p>
            <button
              className="button depth-effects-render"
              disabled={
                browserDemo ||
                sending ||
                Boolean(active) ||
                otherBusy ||
                !engine?.ready ||
                !parsed.success
              }
              onClick={() => void render()}
            >
              {sending || active ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Layers size={15} />
              )}{' '}
              Estimate depth & create image
            </button>
            {!browserDemo && (
              <p className="depth-effects-note">
                {otherBusy
                  ? 'Another GPU generation is running.'
                  : !engine
                    ? 'Checking the local depth engine…'
                    : engine.ready
                      ? 'Native CUDA BF16 depth estimation; finishing runs locally on the CPU.'
                      : engine.missing[0] || engine.message}
              </p>
            )}
            {!parsed.success && (
              <p className="depth-effects-note">
                {source
                  ? parsed.error.issues[0].message
                  : 'Choose a still image before estimating depth.'}
              </p>
            )}
            {error && (
              <p className="depth-effects-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="depth-effects-status" role="status">
                {notice}
              </p>
            )}
            <input
              ref={photoFile}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <input
              ref={importFile}
              hidden
              type="file"
              accept="application/json,.json"
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
