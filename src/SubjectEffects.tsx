import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Copy, Download, Film, LoaderCircle, Plus, Upload, X } from 'lucide-react';
import type { CharacterJob, CharacterSelectionInfo, CharacterSelectionRequest } from './character';
import type { Clip } from './domain';
import {
  subjectEffectRecipeSchema,
  subjectEffectRequestSchema,
  type SubjectEffectCopy,
  type SubjectEffectJob,
  type SubjectEffectRecipe,
  type SubjectEffectRequest,
} from './subject-effects';
import { apiFetch, browserDemo, saveMedia } from './transport';
import PreviewVideo from './PreviewVideo';
import {
  subjectEffectPresets,
  applySubjectEffectPreset,
  matchingSubjectEffectPreset,
} from './effect-presets';

type Selection = { id: string; request: CharacterSelectionRequest; info: CharacterSelectionInfo };
type ImportResult = {
  request: SubjectEffectRequest;
  selection: { request: CharacterSelectionRequest; info: CharacterSelectionInfo };
};
const roles = ['source', 'prepared', 'mask'] as const;
type MediaRole = (typeof roles)[number];
const roleLabels: Record<MediaRole, string> = {
  source: 'Original source video',
  prepared: 'Prepared source',
  mask: 'Tracked mask',
};
const newCopy = (): SubjectEffectCopy => ({
  x: 0.22,
  y: 0,
  scale: 1,
  opacity: 1,
  flipX: false,
  rotation: 0,
});

export function reviewedSubjectSelection(job?: CharacterJob): Selection | undefined {
  if (
    job?.kind !== 'selection' ||
    job.state !== 'succeeded' ||
    !job.selection?.sourceSha256 ||
    job.selection.emptyFrames.length
  )
    return;
  return { id: job.id, request: job.request as CharacterSelectionRequest, info: job.selection };
}

export function subjectEffectSettingsKey(request: SubjectEffectRequest) {
  return JSON.stringify({
    format: request.format,
    name: request.name.trim(),
    selectionId: request.selectionId,
    maskSha256: request.maskSha256,
    feather: request.feather ?? 0,
    grow: request.grow ?? 0,
    backgroundBlur: request.backgroundBlur ?? 0,
    backgroundExposureEV: request.backgroundExposureEV ?? 0,
    copies: request.copies.map((copy) => ({
      x: copy.x,
      y: copy.y,
      scale: copy.scale,
      opacity: copy.opacity,
      flipX: copy.flipX ?? false,
      rotation: copy.rotation ?? 0,
      color: copy.color?.toLowerCase() ?? null,
      behindSubject: copy.behindSubject ?? false,
    })),
  });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'The subject effect could not be completed.');
  return value as T;
}
function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export default function SubjectEffects({
  selection: selectionJob,
  selections = [],
  onSelectionChange,
  onImport,
  onUse,
  onFilmAdded,
  onClose,
}: {
  selection?: CharacterJob;
  selections?: CharacterJob[];
  onSelectionChange?: (job: CharacterJob) => void;
  onImport: (clip: Clip) => void;
  onUse: (clip: Clip) => void;
  onFilmAdded?: () => void;
  onClose: () => void;
}) {
  const [override, setOverride] = useState<Selection>();
  const selection = override || reviewedSubjectSelection(selectionJob);
  const [name, setName] = useState('Same person. More possibilities.');
  const [copies, setCopies] = useState<SubjectEffectCopy[]>([newCopy()]);
  const [feather, setFeather] = useState(2),
    [grow, setGrow] = useState(0);
  const [backgroundBlur, setBackgroundBlur] = useState(0),
    [backgroundExposureEV, setBackgroundExposureEV] = useState(0);
  const [jobs, setJobs] = useState<SubjectEffectJob[]>([]),
    [viewedId, setViewedId] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0),
    [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [recipe, setRecipe] = useState<SubjectEffectRecipe>();
  const [files, setFiles] = useState<Partial<Record<MediaRole, File>>>({});
  const recipeInput = useRef<HTMLInputElement>(null);
  const submitted = useRef(new Set<string>());
  const admission = useRef<{ key: string; requestKey: string } | undefined>(undefined);
  const region = useRef<HTMLElement>(null);
  const importedCallback = useRef(onImport);
  importedCallback.current = onImport;
  const request: SubjectEffectRequest | undefined = selection
    ? {
        format: 'aftertake-subject-effect/1',
        name,
        selectionId: selection.id,
        maskSha256: selection.info.maskSha256,
        copies,
        feather,
        grow,
        backgroundBlur,
        backgroundExposureEV,
      }
    : undefined;
  const validation = subjectEffectRequestSchema.safeParse(request);
  const preset = matchingSubjectEffectPreset(request);
  const history = jobs.filter((job) => job.request.selectionId === selection?.id);
  const viewed = history.find((job) => job.id === viewedId) || history[0];
  const pending = jobs.find((job) => job.state === 'queued' || job.state === 'running');
  const changed = Boolean(
    viewed &&
    request &&
    subjectEffectSettingsKey(viewed.request) !== subjectEffectSettingsKey(request),
  );

  useEffect(() => {
    region.current?.focus();
  }, []);
  useEffect(() => {
    if (browserDemo) return;
    let live = true;
    const read = () =>
      api<SubjectEffectJob[]>('/api/subject-effects')
        .then((value) => {
          if (!live) return;
          setJobs(value);
          setConnected(true);
          setConnectionError('');
          for (const job of value) {
            if (job.state === 'succeeded' && job.clip && submitted.current.delete(job.id))
              importedCallback.current(job.clip);
            if (job.state === 'failed' && job.requestKey === admission.current?.requestKey)
              admission.current = undefined;
          }
        })
        .catch((cause) => {
          if (live) {
            setConnected(false);
            setConnectionError((cause as Error).message);
          }
        });
    void read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh]);

  function updateCopy(index: number, patch: Partial<SubjectEffectCopy>) {
    setCopies((current) =>
      current.map((copy, item) => (item === index ? { ...copy, ...patch } : copy)),
    );
  }
  function applyPreset(id: string) {
    if (!request || !id) return;
    const next = applySubjectEffectPreset(request, id);
    setCopies(next.copies);
    setFeather(next.feather ?? 0);
    setGrow(next.grow ?? 0);
    setBackgroundBlur(next.backgroundBlur ?? 0);
    setBackgroundExposureEV(next.backgroundExposureEV ?? 0);
    setNotice('Preset loaded. Review placement and build a new preview to apply it.');
  }
  function restore(job: SubjectEffectJob) {
    setOverride({ id: job.request.selectionId, ...job.selection });
    setName(job.request.name);
    setCopies(job.request.copies);
    setFeather(job.request.feather ?? 0);
    setGrow(job.request.grow ?? 0);
    setBackgroundBlur(job.request.backgroundBlur ?? 0);
    setBackgroundExposureEV(job.request.backgroundExposureEV ?? 0);
    setViewedId(job.id);
    setNotice('Settings restored. Build a preview after making changes.');
    setError('');
  }
  async function render() {
    if (browserDemo || !validation.success || busy || pending) return;
    setBusy(true);
    setError('');
    setNotice('');
    const key = subjectEffectSettingsKey(validation.data);
    if (admission.current?.key !== key)
      admission.current = { key, requestKey: crypto.randomUUID() };
    try {
      const job = await api<SubjectEffectJob>('/api/subject-effects/duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': admission.current.requestKey,
        },
        body: JSON.stringify(validation.data),
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setViewedId(job.id);
      if (job.state === 'succeeded' && job.clip) onImport(job.clip);
      else submitted.current.add(job.id);
      if (job.state === 'failed') admission.current = undefined;
      setNotice('Preview submitted. The original person and source audio are retained.');
    } catch (cause) {
      setError(
        (cause as Error).message +
          ' Check the effect history before retrying; the same settings reuse the request key.',
      );
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Choose a subject-effect recipe under 2 MB.');
      setRecipe(subjectEffectRecipeSchema.parse(JSON.parse(await file.text())));
      setFiles({});
      setNotice(
        'Choose the three original companion files. Their hashes are verified before restoring the recipe.',
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function restorePortable() {
    if (!recipe || browserDemo || busy || roles.some((role) => !files[role])) return;
    setBusy(true);
    setError('');
    try {
      const media: Record<string, string> = {};
      // Check all files before any upload, then restore without rendering.
      for (const role of roles) {
        if (files[role]!.size > 100 * 1024 * 1024)
          throw Error(`${roleLabels[role]} exceeds the local import limit of 100 MB.`);
        if ((await sha256(await files[role]!.arrayBuffer())) !== recipe.media[role].sha256)
          throw Error(
            `${roleLabels[role]} does not match this recipe. Choose ${recipe.media[role].filename}.`,
          );
      }
      for (const role of roles) {
        const file = files[role]!;
        const uploaded = await api<{ id: string; sha256: string }>(
          `/api/subject-effects/media?role=${role}&name=${encodeURIComponent(file.name)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
        );
        if (uploaded.sha256 !== recipe.media[role].sha256)
          throw Error(`The uploaded ${roleLabels[role].toLowerCase()} differs from the recipe.`);
        media[role + 'Id'] = uploaded.id;
      }
      const restored = await api<ImportResult>('/api/subject-effects/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, media }),
      });
      setOverride({ id: restored.request.selectionId, ...restored.selection });
      setName(restored.request.name);
      setCopies(restored.request.copies);
      setFeather(restored.request.feather ?? 0);
      setGrow(restored.request.grow ?? 0);
      setBackgroundBlur(restored.request.backgroundBlur ?? 0);
      setBackgroundExposureEV(restored.request.backgroundExposureEV ?? 0);
      setViewedId('');
      setRecipe(undefined);
      setFiles({});
      setNotice(
        'Recipe and tracked media restored. Review the settings, then build a preview. Nothing has been rendered.',
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportRecipe(job: SubjectEffectJob) {
    setError('');
    try {
      downloadJSON(
        await api(`/api/subject-effects/${job.id}/recipe`),
        'aftertake-subject-effect-recipe.json',
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function download(url: string, filename: string) {
    try {
      await saveMedia(url, filename);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function downloadCompanion(job: SubjectEffectJob, role: MediaRole) {
    setError('');
    try {
      const saved = await api<SubjectEffectRecipe>(`/api/subject-effects/${job.id}/recipe`);
      await saveMedia(`/api/subject-effects/${job.id}/media/${role}`, saved.media[role].filename);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function addToFilm(clip: Clip) {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(clip.url);
      if (!response.ok) throw Error('The completed subject effect is unavailable.');
      const bytes = await response.arrayBuffer();
      if ((await sha256(bytes)) !== clip.sha256)
        throw Error('The video differs from its saved result. Reopen the completed effect.');
      const asset = await api<{ sha256: string }>(
        `/api/films/assets?name=${encodeURIComponent(clip.name + '.mp4')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        },
      );
      if (asset.sha256 !== clip.sha256)
        throw Error('The Film asset differs from the completed effect.');
      onFilmAdded?.();
      setNotice('Added to Film media. Open Film editing to place it in your cut.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="subject-effects"
      aria-label="Duplicate a tracked person"
      ref={region}
      tabIndex={-1}
    >
      <header className="subject-effects-heading">
        <div>
          <div className="eyebrow">SUBJECT EFFECTS</div>
          <h3>One performance. Extra copies.</h3>
        </div>
        <button className="button" onClick={onClose} aria-label="Close subject effects">
          <X size={15} /> Close
        </button>
      </header>
      <p className="subject-effects-intro">
        Place copies of the tracked person in the same shot. The original stays in place; no new
        face or motion is generated. Use colored silhouettes behind the original for a graphic echo.
      </p>
      {browserDemo ? (
        <p className="subject-effects-note">
          This browser trial shows recorded work. Open the local studio to compose copies from a
          saved tracked selection; no generation engine or credits are needed for the composition.
        </p>
      ) : (
        <>
          <div className="subject-effects-toolbar">
            {selections.length > 0 && onSelectionChange && (
              <label className="subject-effects-saved">
                Saved tracked person
                <select
                  aria-label="Saved tracked person"
                  value={override ? '' : selectionJob?.id || ''}
                  disabled={busy}
                  onChange={(event) => {
                    const saved = selections.find((job) => job.id === event.target.value);
                    if (!saved || !reviewedSubjectSelection(saved)) return;
                    setOverride(undefined);
                    setViewedId('');
                    admission.current = undefined;
                    onSelectionChange(saved);
                  }}
                >
                  <option value="">Choose existing tracking</option>
                  {selections
                    .filter((job) => reviewedSubjectSelection(job))
                    .map((job) => {
                      const saved = job.request as CharacterSelectionRequest;
                      return (
                        <option key={job.id} value={job.id}>
                          {saved.clip.name} · {saved.trimStart.toFixed(2)}–
                          {(saved.trimStart + saved.duration).toFixed(2)}s
                        </option>
                      );
                    })}
                </select>
              </label>
            )}
            <button className="button" disabled={busy} onClick={() => recipeInput.current?.click()}>
              <Upload size={14} /> Import portable recipe
            </button>
            {override && reviewedSubjectSelection(selectionJob) && (
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setOverride(undefined);
                  setViewedId('');
                }}
              >
                Use current tracked selection
              </button>
            )}
            {jobs.length > 0 && (
              <label className="subject-effects-saved">
                Saved effects
                <select
                  aria-label="Saved subject effect"
                  value={viewed?.id || ''}
                  disabled={busy}
                  onChange={(event) => {
                    const job = jobs.find((item) => item.id === event.target.value);
                    if (job) restore(job);
                  }}
                >
                  <option value="">Choose a saved effect</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.request.name} · {job.state}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {recipe && (
            <div className="subject-effects-import">
              <strong>Restore {recipe.request.name}</strong>
              <p>
                Choose the exact companion files saved with this recipe. Import restores editable
                settings and does not start a render.
              </p>
              {roles.map((role) => (
                <label key={role}>
                  {roleLabels[role]}
                  <small>{recipe.media[role].filename}</small>
                  <input
                    type="file"
                    disabled={busy}
                    accept={role === 'mask' ? '.mkv,video/*' : 'video/*,.mkv'}
                    onChange={(event) =>
                      setFiles((current) => ({ ...current, [role]: event.target.files?.[0] }))
                    }
                  />
                </label>
              ))}
              <div className="subject-effects-actions">
                <button
                  className="button"
                  disabled={busy || roles.some((role) => !files[role])}
                  onClick={() => void restorePortable()}
                >
                  Restore checked media
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setRecipe(undefined);
                    setFiles({});
                  }}
                >
                  Cancel import
                </button>
              </div>
            </div>
          )}
          {selection ? (
            <div className="subject-effects-grid">
              <div className="subject-effects-preview-column">
                <div
                  className="subject-effects-preview"
                  style={{ aspectRatio: selection.info.width / selection.info.height }}
                >
                  {viewed?.clip && viewed.state === 'succeeded' ? (
                    <PreviewVideo
                      key={viewed.clip.sha256}
                      mediaSrc={viewed.clip.url}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={viewed.request.name}
                    />
                  ) : (
                    <div className="subject-effects-placeholder">
                      <Copy size={28} />
                      <p>
                        {pending
                          ? pending.state === 'queued'
                            ? 'Preview queued…'
                            : 'Compositing the tracked frames…'
                          : 'Build a preview to see the actual composited video.'}
                      </p>
                    </div>
                  )}
                </div>
                <p className="subject-effects-note">
                  {selection.info.width} × {selection.info.height} · {selection.info.frames} frames
                  · 24 fps · {(selection.info.frames / 24).toFixed(2)}s ·{' '}
                  {selection.request.clip.hasAudio === true
                    ? 'Source audio retained'
                    : selection.request.clip.hasAudio === false
                      ? 'Source has no audio'
                      : 'Source audio retained when present'}
                </p>
                {changed && (
                  <p className="subject-effects-note">
                    Settings changed. The video above is the previous preview; build a preview to
                    apply these edits.
                  </p>
                )}
                {viewed?.error && (
                  <p className="subject-effects-error" role="alert">
                    {viewed.error}
                  </p>
                )}
                {viewed?.clip && viewed.state === 'succeeded' && (
                  <div className="subject-effects-actions">
                    <button className="button" disabled={busy} onClick={() => onUse(viewed.clip!)}>
                      Use as source <ArrowUpRight size={14} />
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void addToFilm(viewed.clip!)}
                    >
                      <Film size={14} /> Add to Film
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        void download(viewed.clip!.url, 'aftertake-subject-effect.mp4')
                      }
                    >
                      <Download size={14} /> MP4
                    </button>
                  </div>
                )}
                {viewed && (
                  <details className="subject-effects-portable">
                    <summary>Portable recipe and original media</summary>
                    <p>
                      Keep the recipe and all three companion files together to reproduce this
                      effect on another machine.
                    </p>
                    <div className="subject-effects-actions">
                      <button className="button" onClick={() => void exportRecipe(viewed)}>
                        Recipe JSON
                      </button>
                      {roles.map((role) => (
                        <button
                          className="button"
                          key={role}
                          onClick={() => void downloadCompanion(viewed, role)}
                        >
                          {roleLabels[role]}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
                {history.length > 0 && (
                  <div className="subject-effects-history" aria-label="Subject effect history">
                    {history.map((job) => (
                      <button
                        key={job.id}
                        className={viewed?.id === job.id ? 'active' : ''}
                        onClick={() => restore(job)}
                      >
                        {job.request.name}
                        <small>
                          {job.state} · {job.request.copies.length} extra{' '}
                          {job.request.copies.length === 1 ? 'copy' : 'copies'}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="subject-effects-controls">
                <label>
                  Starting look
                  <select
                    aria-label="Subject effect preset"
                    value={preset?.id || ''}
                    disabled={busy}
                    onChange={(event) => applyPreset(event.target.value)}
                  >
                    <option value="">Custom settings</option>
                    {subjectEffectPresets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="subject-effects-note">
                  {preset?.description ||
                    'Choose an editable starting point, then adjust the controls. Applying a preset does not render.'}
                </p>
                <label>
                  EFFECT NAME
                  <input
                    value={name}
                    maxLength={100}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <p className="subject-effects-note">
                  Offsets use the full canvas. Scale and rotation share a fixed anchor at the first
                  tracked frame’s subject center. Copies may overlap or leave the frame.
                </p>
                {copies.map((copy, index) => (
                  <fieldset className="subject-copy" key={index} disabled={busy}>
                    <legend>Copy {index + 1}</legend>
                    <label className="subject-copy-appearance">
                      Appearance
                      <select
                        aria-label={`Copy ${index + 1} appearance`}
                        value={copy.color ? 'silhouette' : 'pixels'}
                        onChange={(event) =>
                          updateCopy(index, {
                            color: event.target.value === 'silhouette' ? '#ff2a96' : undefined,
                          })
                        }
                      >
                        <option value="pixels">Original pixels</option>
                        <option value="silhouette">Solid silhouette</option>
                      </select>
                    </label>
                    {copy.color && (
                      <label className="subject-copy-appearance">
                        Silhouette color
                        <input
                          type="color"
                          aria-label={`Copy ${index + 1} silhouette color`}
                          value={copy.color}
                          onChange={(event) => updateCopy(index, { color: event.target.value })}
                        />
                      </label>
                    )}
                    <div className="subject-copy-sliders">
                      <Range
                        label="Horizontal"
                        value={copy.x}
                        min={-1}
                        max={1}
                        step={0.01}
                        display={`${Math.round(copy.x * 100)}%`}
                        onChange={(value) => updateCopy(index, { x: value })}
                      />
                      <Range
                        label="Vertical"
                        value={copy.y}
                        min={-1}
                        max={1}
                        step={0.01}
                        display={`${Math.round(copy.y * 100)}%`}
                        onChange={(value) => updateCopy(index, { y: value })}
                      />
                      <Range
                        label="Scale"
                        value={copy.scale}
                        min={0.1}
                        max={3}
                        step={0.01}
                        display={`${Math.round(copy.scale * 100)}%`}
                        onChange={(value) => updateCopy(index, { scale: value })}
                      />
                      <Range
                        label="Rotation"
                        value={copy.rotation ?? 0}
                        min={-180}
                        max={180}
                        step={1}
                        display={`${copy.rotation ?? 0}°`}
                        onChange={(value) => updateCopy(index, { rotation: value })}
                      />
                      <Range
                        label="Opacity"
                        value={copy.opacity}
                        min={0}
                        max={1}
                        step={0.01}
                        display={`${Math.round(copy.opacity * 100)}%`}
                        onChange={(value) => updateCopy(index, { opacity: value })}
                      />
                    </div>
                    <div className="subject-copy-actions">
                      <label>
                        <input
                          type="checkbox"
                          checked={copy.behindSubject ?? false}
                          onChange={(event) =>
                            updateCopy(index, { behindSubject: event.target.checked })
                          }
                        />{' '}
                        Behind original person
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={copy.flipX ?? false}
                          onChange={(event) => updateCopy(index, { flipX: event.target.checked })}
                        />{' '}
                        Flip horizontally
                      </label>
                      <button
                        className="button"
                        onClick={() =>
                          setCopies((current) => current.filter((_, item) => item !== index))
                        }
                      >
                        Remove copy
                      </button>
                    </div>
                  </fieldset>
                ))}
                <button
                  className="button"
                  disabled={busy || copies.length === 4}
                  onClick={() =>
                    setCopies((current) => [
                      ...current,
                      { ...newCopy(), x: current.length % 2 ? -0.22 : 0.35 },
                    ])
                  }
                >
                  <Plus size={14} /> Add copy · {copies.length}/4
                </button>
                <fieldset className="subject-copy" disabled={busy}>
                  <legend>Subject focus</legend>
                  <Range
                    label="Background blur"
                    value={backgroundBlur}
                    min={0}
                    max={32}
                    step={0.5}
                    display={`${backgroundBlur}px`}
                    onChange={setBackgroundBlur}
                  />
                  <Range
                    label="Background exposure"
                    value={backgroundExposureEV}
                    min={-2}
                    max={2}
                    step={0.1}
                    display={`${backgroundExposureEV > 0 ? '+' : ''}${backgroundExposureEV.toFixed(1)} EV`}
                    onChange={setBackgroundExposureEV}
                  />
                  <p className="subject-effects-note">
                    Only the background outside the original tracked person is affected. Remove all
                    copies for a focus-only edit.
                  </p>
                </fieldset>
                <fieldset className="subject-copy" disabled={busy}>
                  <legend>Mask edges</legend>
                  <Range
                    label="Feather"
                    value={feather}
                    min={0}
                    max={12}
                    step={0.5}
                    display={`${feather}px`}
                    onChange={setFeather}
                  />
                  <Range
                    label="Grow / shrink"
                    value={grow}
                    min={-16}
                    max={32}
                    step={1}
                    display={`${grow}px`}
                    onChange={setGrow}
                  />
                </fieldset>
                <button
                  className="button subject-effects-render"
                  disabled={busy || Boolean(pending) || !connected || !validation.success}
                  onClick={() => void render()}
                >
                  {busy || pending ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Copy size={15} />
                  )}{' '}
                  {pending
                    ? pending.state === 'queued'
                      ? 'Preview queued'
                      : 'Building preview'
                    : 'Build video preview'}
                </button>
                <p className="subject-effects-note">
                  CPU composition from your saved selection. No ComfyUI connection or credits
                  required. Review hair, hands and overlapping people in the result.
                </p>
                {!validation.success && (
                  <p className="subject-effects-note">{validation.error.issues[0].message}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="subject-effects-note">
              Track a person and review the complete selection first, or import a portable recipe
              with its source and mask files. An older selection without saved source hashes needs
              to be tracked again.
            </p>
          )}
          <input
            ref={recipeInput}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void importRecipe(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </>
      )}
      {notice && (
        <p className="subject-effects-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="subject-effects-error" role="alert">
          {error}
        </p>
      )}
      {connectionError && (
        <p className="subject-effects-error" role="alert">
          {connectionError}
        </p>
      )}
      {!browserDemo && !connected && (
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setError('');
            setRefresh((value) => value + 1);
          }}
        >
          Check local studio connection
        </button>
      )}
    </section>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="subject-effect-range">
      <span>
        {label}
        <output>{display}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
