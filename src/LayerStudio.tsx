import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Film,
  ImagePlus,
  Layers,
  LoaderCircle,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type { Clip } from './domain';
import type { FilmAsset } from './film';
import { defaultFinishingSettings, type FinishingSettings } from './finishing';
import GradingControls from './GradingControls';
import {
  defaultLayerTransform,
  layerBlendModes,
  layerStackRecipeSchema,
  layerStackRequestSchema,
  layerStackSources,
  type LayerMask,
  type LayerStackJob,
  type LayerStackLayer,
  type LayerStackRequest,
} from './layer-stack';
import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import './layer-studio.css';
import './finishing-studio.css';

type History = { past: LayerStackRequest[]; now: LayerStackRequest; future: LayerStackRequest[] };
type Attempt = { key: string; request: LayerStackRequest };
const pendingKey = 'aftertake-layer-stack-pending/1';
const draftKey = 'aftertake-layer-stack-draft/1';
const adjustmentControls = [
  { key: 'exposureEV', label: 'Exposure', min: -3, max: 3, step: 0.05, suffix: ' EV' },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.02 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.02 },
  { key: 'temperature', label: 'Warmth', min: -1, max: 1, step: 0.02 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.02 },
  { key: 'sharpen', label: 'Sharpness', min: 0, max: 1, step: 0.02 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.02 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 },
] as const;
const busyJob = (job: LayerStackJob) => job.state === 'queued' || job.state === 'running';
const labelMode = (mode: string) => mode.replaceAll('-', ' ').replace(/^./, (c) => c.toUpperCase());
/** Compare the same validated/defaulted request sent to the pixel renderer. */
export function layerPreviewKey(request: unknown) {
  const parsed = layerStackRequestSchema.safeParse(request);
  return JSON.stringify(parsed.success ? parsed.data : request);
}
function message(error: unknown) {
  const failure = error as { message?: string; issues?: { message: string }[] };
  return (
    failure.issues?.[0]?.message || failure.message || 'The layer operation could not complete.'
  );
}
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
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error(data.error || 'The layer operation could not complete.'), {
      status: response.status,
    });
  return data;
}
function rememberedAttempt(): Attempt | undefined {
  if (browserDemo) return;
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey) || 'null');
    if (typeof value?.key === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.key))
      return { key: value.key, request: layerStackRequestSchema.parse(value.request) };
  } catch {
    // A saved request is only restored for an explicit retry, never submitted automatically.
  }
}
function initialDraft(clip?: Clip): LayerStackRequest {
  if (!browserDemo)
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) return layerStackRequestSchema.parse(JSON.parse(saved));
    } catch {
      // Start a fresh draft if an older or incomplete local plan cannot be validated.
    }
  const w = clip?.kind === 'image' ? clip.width : 1280;
  const h = clip?.kind === 'image' ? clip.height : 720;
  const scale = Math.min(1, 4096 / w, 4096 / h, Math.sqrt(4194304 / (w * h)));
  return {
    format: 'aftertake-layer-stack/1',
    name: 'Untitled composition',
    canvas: {
      width: Math.max(1, Math.floor(w * scale)),
      height: Math.max(1, Math.floor(h * scale)),
    },
    layers: [],
  };
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
async function verifiedBytes(url: string, expected: string) {
  const response = await apiFetch(url);
  if (!response.ok) throw Error('This image is unavailable. Import its original file again.');
  const bytes = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== expected)
    throw Error('The image bytes differ from the saved source. Import the matching file.');
  return bytes;
}
function Range({
  label,
  value,
  min,
  max,
  step = 0.01,
  suffix = '',
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="layer-range-label">
        <span>{label}</span>
        <output>
          {Number(value.toFixed(2))}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function LayerStudio({
  initialClip,
  onUse,
  onImport,
  onFilmAdded,
  onClose,
}: {
  initialClip?: Clip;
  onUse: (clip: Clip) => void;
  onImport: (clip: Clip) => void;
  onFilmAdded?: () => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    now: initialDraft(initialClip),
    future: [],
  }));
  const [selected, setSelected] = useState(() => history.now.layers.at(-1)?.id || '');
  const [assets, setAssets] = useState<FilmAsset[]>([]);
  const [assetChoice, setAssetChoice] = useState('');
  const [jobs, setJobs] = useState<LayerStackJob[]>([]);
  const [viewedId, setViewedId] = useState('');
  const [attempt, setAttempt] = useState<Attempt | undefined>(rememberedAttempt);
  const [working, setWorking] = useState('');
  const [preview, setPreview] = useState<{
    url: string;
    request: string;
    canvas: LayerStackRequest['canvas'];
  }>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const maskInput = useRef<HTMLInputElement>(null);
  const recipeInput = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const live = useRef(true);
  const draft = history.now;
  const layer = draft.layers.find((item) => item.id === selected);
  const layerIndex = draft.layers.findIndex((item) => item.id === selected);
  const images = assets.filter((asset) => asset.kind === 'image');
  const active = jobs.find(busyJob);
  const viewed = jobs.find((job) => job.id === viewedId);
  const output = viewed?.state === 'succeeded' ? viewed.clip : undefined;
  const displayedCanvas = output
    ? { width: output.width, height: output.height }
    : preview?.canvas || draft.canvas;
  const requestKey = layerPreviewKey(draft);
  const stale = !!preview && preview.request !== requestKey;
  const locked = !!working || !!attempt;
  const canRender =
    !browserDemo && !locked && !active && draft.layers.some((item) => item.type === 'image');
  const canClip = draft.layers
    .slice(0, layerIndex)
    .some((item) => item.type === 'image' && !item.clipToBelow);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    live.current = true;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      live.current = false;
      serial.current += 1;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);
  useEffect(() => {
    if (browserDemo) return;
    const parsed = layerStackRequestSchema.safeParse(draft);
    if (parsed.success)
      try {
        localStorage.setItem(draftKey, JSON.stringify(parsed.data));
      } catch {
        /* Draft still remains in this dialog. */
      }
  }, [draft]);
  useEffect(() => {
    if (browserDemo) return;
    let canceled = false;
    const load = () =>
      Promise.all([
        api<FilmAsset[]>('/api/films/assets'),
        api<LayerStackJob[]>('/api/layer-stacks'),
      ])
        .then(([found, saved]) => {
          if (!canceled) {
            setAssets(found);
            setJobs(saved);
          }
        })
        .catch((failure) => {
          if (!canceled) setError(message(failure));
        });
    void load();
    const timer = active ? setInterval(() => void load(), 1500) : undefined;
    return () => {
      canceled = true;
      if (timer) clearInterval(timer);
    };
  }, [!!active]);

  function change(next: LayerStackRequest | ((value: LayerStackRequest) => LayerStackRequest)) {
    setViewedId('');
    setHistory((value) => ({
      past: [...value.past.slice(-39), value.now],
      now: typeof next === 'function' ? next(value.now) : next,
      future: [],
    }));
  }
  function changeLayer(patch: Partial<LayerStackLayer>) {
    change((value) => ({
      ...value,
      layers: value.layers.map((item) =>
        item.id === selected ? ({ ...item, ...patch } as LayerStackLayer) : item,
      ),
    }));
  }
  function updateMask(patch: Partial<LayerMask>) {
    if (layer?.mask) changeLayer({ mask: { ...layer.mask, ...patch } as LayerMask });
  }
  function undo(forward = false) {
    setViewedId('');
    setHistory((value) => {
      if (forward)
        return value.future.length
          ? {
              past: [...value.past, value.now],
              now: value.future[0],
              future: value.future.slice(1),
            }
          : value;
      return value.past.length
        ? {
            past: value.past.slice(0, -1),
            now: value.past.at(-1)!,
            future: [value.now, ...value.future],
          }
        : value;
    });
  }
  function common(name: string) {
    return {
      id: crypto.randomUUID(),
      name: name.slice(0, 80),
      visible: true,
      opacity: 1,
      blend: 'normal' as const,
      dissolveSeed: 42,
      clipToBelow: false,
    };
  }
  function addImage(asset: FilmAsset, asBase = false) {
    if (draft.layers.length >= 8) return setError('A composition supports up to eight layers.');
    const item: LayerStackLayer = {
      type: 'image',
      ...common(asset.name),
      source: { assetId: asset.id, sha256: asset.sha256 },
      transform: { ...defaultLayerTransform },
    };
    change((value) => ({
      ...value,
      layers: asBase ? [item, ...value.layers] : [...value.layers, item],
    }));
    setSelected(item.id);
    setNotice(
      asBase
        ? 'Current image added as the bottom layer. Render a preview to see the composition.'
        : 'Image added above the current stack. Render a preview to see the composition.',
    );
  }
  function addAdjustment() {
    if (draft.layers.length >= 8) return;
    const item: LayerStackLayer = {
      type: 'adjustment',
      ...common('Color adjustment'),
      settings: structuredClone(defaultFinishingSettings),
    };
    change((value) => ({ ...value, layers: [...value.layers, item] }));
    setSelected(item.id);
  }
  async function importBytes(name: string, bytes: BodyInit) {
    const response = await apiFetch('/api/films/assets?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    const asset = (await response.json()) as FilmAsset & { error?: string };
    if (!response.ok) throw Error(asset.error || 'The image could not be imported.');
    if (asset.kind !== 'image') throw Error('Choose a PNG, JPEG or WebP still image.');
    if (live.current) setAssets((all) => [asset, ...all.filter((item) => item.id !== asset.id)]);
    return asset;
  }
  async function upload(file?: File, forMask = false) {
    if (!file) return;
    const target = selected;
    setWorking(forMask ? 'Importing mask…' : 'Importing image…');
    setError('');
    try {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 100 * 1024 * 1024)
        throw Error('Use a PNG, JPEG or WebP image under 100 MB. PNG keeps its transparency.');
      const asset = await importBytes(file.name, file);
      if (!live.current) return;
      if (forMask) {
        change((value) => ({
          ...value,
          layers: value.layers.map((item) =>
            item.id === target
              ? {
                  ...item,
                  mask: {
                    kind: 'image',
                    source: { assetId: asset.id, sha256: asset.sha256 },
                    channel: 'luminance',
                    enabled: true,
                    invert: false,
                    grow: 0,
                    feather: 0,
                  },
                }
              : item,
          ),
        }));
        setNotice(
          'Mask imported. White reveals and black hides with the default luminance channel.',
        );
      } else addImage(asset);
    } catch (failure) {
      if (live.current) setError(message(failure));
    } finally {
      if (live.current) setWorking('');
    }
  }
  async function useCurrent() {
    if (!initialClip || initialClip.kind !== 'image') return;
    setWorking('Importing current image…');
    setError('');
    try {
      const existing = images.find((asset) => asset.sha256 === initialClip.sha256);
      let asset = existing;
      if (!asset) {
        const bytes = await verifiedBytes(initialClip.url, initialClip.sha256);
        const extension =
          new URL(initialClip.url, window.location.href).pathname.match(
            /\.(png|jpe?g|webp)$/i,
          )?.[0] || '.png';
        asset = await importBytes(
          initialClip.name.replace(/\.[a-z0-9]{2,5}$/i, '') + extension,
          bytes,
        );
      }
      if (live.current) addImage(asset, true);
    } catch (failure) {
      if (live.current) setError(message(failure));
    } finally {
      if (live.current) setWorking('');
    }
  }
  function reorder(direction: -1 | 1) {
    const next = layerIndex + direction;
    if (!layer || next < 0 || next >= draft.layers.length) return;
    const reordered = [...draft.layers];
    [reordered[layerIndex], reordered[next]] = [reordered[next], reordered[layerIndex]];
    change({ ...draft, layers: reordered });
  }
  function duplicate() {
    if (!layer || draft.layers.length >= 8) return;
    const item = {
      ...structuredClone(layer),
      id: crypto.randomUUID(),
      name: (layer.name + ' copy').slice(0, 80),
    };
    const layers = [...draft.layers];
    layers.splice(layerIndex + 1, 0, item);
    change({ ...draft, layers });
    setSelected(item.id);
  }
  async function renderPreview() {
    setWorking('Rendering preview…');
    setError('');
    const token = ++serial.current;
    try {
      const request = layerStackRequestSchema.parse(draft);
      const response = await apiFetch('/api/layer-stacks/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok)
        throw Error((await response.json()).error || 'The preview could not be rendered.');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/png'))
        throw Error('The preview did not return a processed PNG.');
      if (live.current && serial.current === token) {
        setPreview({
          url: URL.createObjectURL(blob),
          request: layerPreviewKey(request),
          canvas: { ...request.canvas },
        });
        setViewedId('');
        setNotice('Actual CPU-rendered PNG preview. Transparency is shown over the checkerboard.');
      }
    } catch (failure) {
      if (live.current) setError(message(failure));
    } finally {
      if (live.current && serial.current === token) setWorking('');
    }
  }
  async function save() {
    setWorking('Saving composition…');
    setError('');
    setNotice('');
    try {
      const operation = attempt || {
        key: crypto.randomUUID(),
        request: layerStackRequestSchema.parse(draft),
      };
      setAttempt(operation);
      try {
        localStorage.setItem(pendingKey, JSON.stringify(operation));
      } catch {
        /* The in-memory key still makes retries safe. */
      }
      const job = await api<LayerStackJob>('/api/layer-stacks', operation.request, operation.key);
      if (!live.current) return;
      setJobs((all) => [job, ...all.filter((item) => item.id !== job.id)]);
      setViewedId(job.id);
      setAttempt(undefined);
      localStorage.removeItem(pendingKey);
      setNotice(
        'Composition saved for rendering. Its original layers and image bindings remain editable.',
      );
    } catch (failure) {
      if ([400, 404, 409, 413, 422, 503].includes((failure as { status?: number }).status || 0)) {
        setAttempt(undefined);
        localStorage.removeItem(pendingKey);
      }
      if (live.current) setError(message(failure));
    } finally {
      if (live.current) setWorking('');
    }
  }
  async function exportPlan() {
    setError('');
    try {
      const request = layerStackRequestSchema.parse(draft);
      const recipe = layerStackRecipeSchema.parse({
        format: 'aftertake-layer-stack-recipe/1',
        processor: 'aftertake-cpu-layer-stack/1',
        request,
        media: layerStackSources(request).map((ref) => ({
          ...ref,
          filename:
            assets
              .find((asset) => asset.id === ref.assetId && asset.sha256 === ref.sha256)
              ?.name.replace(/[\\/:]/g, '_')
              .slice(0, 200) || `image-${ref.sha256.slice(0, 12)}.png`,
        })),
      });
      saveJSON(recipe, 'aftertake-layer-plan.json');
      setNotice(
        'Plan exported. Keep the original image and mask files alongside it; JSON does not bundle media.',
      );
    } catch (failure) {
      setError(message(failure));
    }
  }
  async function importPlan(file?: File) {
    if (!file) return;
    setWorking('Restoring plan…');
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a layer plan under 2 MB.');
      const recipe = layerStackRecipeSchema.parse(JSON.parse(await file.text()));
      const rebound = layerStackRequestSchema.parse(await api('/api/layer-stacks/resolve', recipe));
      if (!live.current) return;
      change(rebound);
      setSelected(rebound.layers.at(-1)?.id || '');
      setNotice(
        'Plan restored by matching image and mask hashes. Review its actual preview before saving.',
      );
    } catch (failure) {
      if (live.current) setError(message(failure));
    } finally {
      if (live.current) setWorking('');
    }
  }
  async function addToFilm() {
    if (!output) return;
    setWorking('Adding PNG to Film…');
    setError('');
    try {
      const bytes = await verifiedBytes(output.url, output.sha256);
      if (!images.some((asset) => asset.sha256 === output.sha256))
        await importBytes(output.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.png', bytes);
      if (!live.current) return;
      onFilmAdded?.();
      setNotice('PNG added to Film media with its transparency preserved.');
    } catch (failure) {
      if (live.current) setError(message(failure));
    } finally {
      if (live.current) setWorking('');
    }
  }
  function chooseMask(kind: string) {
    if (kind === 'none') return changeLayer({ mask: undefined });
    if (kind === 'image') {
      const asset = images.find((item) => item.id === assetChoice) || images[0];
      if (!asset) {
        setNotice('Import a mask image first. White reveals and black hides.');
        maskInput.current?.click();
        return;
      }
      return changeLayer({
        mask: {
          kind: 'image',
          source: { assetId: asset.id, sha256: asset.sha256 },
          channel: 'luminance',
          enabled: true,
          invert: false,
          grow: 0,
          feather: 0,
        },
      });
    }
    changeLayer({
      mask: {
        kind: kind as 'rectangle' | 'ellipse',
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
        enabled: true,
        invert: false,
        grow: 0,
        feather: 0,
      },
    });
  }

  return (
    <div className="modal-backdrop image-studio-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal layer-studio"
        role="dialog"
        aria-modal="true"
        aria-label="Layer studio"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const nodes = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled),a[href],summary',
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
        <button className="modal-close" aria-label="Close layer studio" onClick={onClose}>
          <X size={19} />
        </button>
        <header className="layer-studio-head">
          <div>
            <span className="layer-studio-kicker">STILL IMAGES · LAYERS · MASKS</span>
            <h2>Build the image in layers.</h2>
            <p className="layer-studio-muted">
              Combine transparent images and color adjustments. Preview the real composition, then
              save an editable plan and a new PNG.
            </p>
          </div>
        </header>
        {browserDemo && (
          <div className="layer-feedback">
            Layer rendering runs in the local studio on your CPU. This recorded browser trial does
            not calculate new compositions.{' '}
            <a
              href="https://github.com/ItsSNOWMOBILE/aftertake#run-locally"
              target="_blank"
              rel="noreferrer"
            >
              Install Aftertake <ArrowUpRight size={13} />
            </a>
          </div>
        )}
        <div className="layer-studio-toolbar">
          <label>
            Composition name
            <input
              value={draft.name}
              maxLength={100}
              disabled={locked}
              onChange={(event) => change({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Width · px
            <input
              type="number"
              min={1}
              max={4096}
              step={1}
              value={draft.canvas.width}
              disabled={locked}
              onChange={(event) =>
                change({
                  ...draft,
                  canvas: {
                    ...draft.canvas,
                    width: Math.max(1, Math.min(4096, Math.round(Number(event.target.value) || 1))),
                  },
                })
              }
            />
          </label>
          <label>
            Height · px
            <input
              type="number"
              min={1}
              max={4096}
              step={1}
              value={draft.canvas.height}
              disabled={locked}
              onChange={(event) =>
                change({
                  ...draft,
                  canvas: {
                    ...draft.canvas,
                    height: Math.max(
                      1,
                      Math.min(4096, Math.round(Number(event.target.value) || 1)),
                    ),
                  },
                })
              }
            />
          </label>
          <div className="layer-history-actions">
            <button
              className="layer-small-button"
              aria-label="Undo layer edit"
              disabled={locked || !history.past.length}
              onClick={() => undo()}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="layer-small-button"
              aria-label="Redo layer edit"
              disabled={locked || !history.future.length}
              onClick={() => undo(true)}
            >
              <Redo2 size={17} />
            </button>
          </div>
        </div>
        {error && (
          <p className="layer-feedback is-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="layer-feedback" role="status">
            {notice}
          </p>
        )}
        <div className="layer-studio-grid">
          <aside className="layer-studio-panel layer-stack-panel" aria-label="Composition layers">
            <div className="layer-panel-heading">
              <h3>Layers</h3>
              <span className="layer-studio-count">{draft.layers.length} / 8</span>
            </div>
            <p className="layer-studio-muted">
              Top of this list appears above the layers below it.
            </p>
            <div className="layer-add-actions">
              <button
                className="button"
                disabled={browserDemo || locked || draft.layers.length >= 8}
                onClick={() => mediaInput.current?.click()}
              >
                <ImagePlus size={16} /> Import image
              </button>
              <button
                className="button"
                disabled={browserDemo || locked || draft.layers.length >= 8}
                onClick={addAdjustment}
              >
                <SlidersHorizontal size={16} /> Adjustment
              </button>
            </div>
            {initialClip?.kind === 'image' && (
              <button
                className="layer-small-button"
                disabled={browserDemo || locked || draft.layers.length >= 8}
                onClick={() => void useCurrent()}
              >
                Use current image as base
              </button>
            )}
            {images.length > 0 && (
              <div className="layer-studio-field">
                <label>
                  Imported still images
                  <select
                    value={assetChoice}
                    disabled={locked}
                    onChange={(event) => setAssetChoice(event.target.value)}
                  >
                    <option value="">Choose an image…</option>
                    {images.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="layer-small-button"
                  disabled={locked || !assetChoice || draft.layers.length >= 8}
                  onClick={() => {
                    const asset = images.find((item) => item.id === assetChoice);
                    if (asset) addImage(asset);
                  }}
                >
                  Add chosen image
                </button>
              </div>
            )}
            <ol className="layer-stack-list">
              {[...draft.layers].reverse().map((item) => {
                const asset =
                  item.type === 'image'
                    ? assets.find(
                        (asset) =>
                          asset.id === item.source.assetId && asset.sha256 === item.source.sha256,
                      )
                    : undefined;
                return (
                  <li
                    className={'layer-stack-row' + (item.id === selected ? ' is-selected' : '')}
                    key={item.id}
                  >
                    <button
                      aria-label={(item.visible ? 'Hide ' : 'Show ') + item.name}
                      aria-pressed={item.visible}
                      disabled={locked}
                      onClick={() =>
                        change((value) => ({
                          ...value,
                          layers: value.layers.map((value) =>
                            value.id === item.id ? { ...value, visible: !value.visible } : value,
                          ),
                        }))
                      }
                    >
                      {item.visible ? <Eye size={17} /> : <EyeOff size={17} />}
                    </button>
                    <button
                      className="layer-select"
                      aria-pressed={item.id === selected}
                      onClick={() => setSelected(item.id)}
                    >
                      {asset ? (
                        <img src={mediaUrl(asset.url)} alt="" />
                      ) : (
                        <span className="layer-stack-glyph">
                          {item.type === 'image' ? (
                            <Layers size={18} />
                          ) : (
                            <SlidersHorizontal size={18} />
                          )}
                        </span>
                      )}
                      <span className="layer-select-copy">
                        <strong>{item.name || 'Unnamed layer'}</strong>
                        <small>
                          {labelMode(item.blend)} · {Math.round(item.opacity * 100)}%
                          {item.mask ? ' · Mask' : ''}
                          {item.clipToBelow ? ' · Clipped' : ''}
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {!draft.layers.length && (
              <p className="layer-studio-muted">
                Import a still to begin. PNG transparency stays intact.
              </p>
            )}
            <div className="layer-file-actions">
              <button
                className="layer-small-button"
                disabled={browserDemo || locked}
                onClick={() => recipeInput.current?.click()}
              >
                <Upload size={15} /> Import plan
              </button>
              <button
                className="layer-small-button"
                disabled={locked || !draft.layers.length}
                onClick={() => void exportPlan()}
              >
                <Download size={15} /> Export plan
              </button>
            </div>
            <small>
              A plan contains settings and media hashes. Import its original images and masks before
              restoring it on another computer.
            </small>
          </aside>
          <main className="layer-stage-panel">
            <div
              className="layer-stage"
              style={{ aspectRatio: `${displayedCanvas.width}/${displayedCanvas.height}` }}
            >
              {output ? (
                <img src={mediaUrl(output.url)} alt="Saved layer composition" />
              ) : preview ? (
                <img
                  src={preview.url}
                  alt={
                    stale
                      ? 'Previous rendered composition; edits are not previewed yet'
                      : 'Actual rendered layer composition'
                  }
                />
              ) : (
                <div className="layer-stage-empty">
                  <Layers size={34} />
                  <strong>Your composition starts here.</strong>
                  <p className="layer-studio-muted">
                    Add images, arrange the stack and render a preview. Every mask and blend is
                    calculated in the exported PNG.
                  </p>
                </div>
              )}
            </div>
            <div className="layer-stage-status">
              <span className={stale && !output ? 'layer-stale' : ''}>
                {output
                  ? 'Saved PNG · ' + output.width + ' × ' + output.height
                  : preview
                    ? stale
                      ? 'Edits changed. Render a new preview to see them.'
                      : 'Rendered preview · current settings'
                    : 'No composition has been rendered yet.'}
              </span>
              <span>
                {displayedCanvas.width} × {displayedCanvas.height} · up to 4 MP
              </span>
            </div>
            <div className="layer-stage-actions">
              <button className="button" disabled={!canRender} onClick={() => void renderPreview()}>
                {working === 'Rendering preview…' ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Eye size={16} />
                )}{' '}
                Render preview
              </button>
              <button
                className="button primary"
                disabled={browserDemo || !!working || !!active || (!attempt && !canRender)}
                onClick={() => void save()}
              >
                {working === 'Saving composition…' || active ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Download size={16} />
                )}
                {attempt ? 'Retry saved request' : active ? 'Rendering saved PNG…' : 'Save PNG'}
              </button>
            </div>
            {working && (
              <p className="layer-studio-muted" role="status">
                {working}
              </p>
            )}
            {attempt && !working && (
              <div className="layer-feedback">
                The save response was not confirmed. Retry with the same request to avoid duplicate
                jobs, or discard this local retry to edit again.{' '}
                <button
                  className="layer-small-button"
                  onClick={() => {
                    setAttempt(undefined);
                    localStorage.removeItem(pendingKey);
                  }}
                >
                  Discard local retry
                </button>
              </div>
            )}
            {viewed?.error && (
              <p className="layer-feedback is-error" role="alert">
                {viewed.error}
              </p>
            )}
            {output && (
              <>
                <div className="layer-stage-actions">
                  <button
                    className="button"
                    onClick={() => {
                      onImport(output);
                      onUse(output);
                    }}
                  >
                    <ArrowUpRight size={16} /> Use image
                  </button>
                  <button className="button" disabled={!!working} onClick={() => void addToFilm()}>
                    <Film size={16} /> Add to Film
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      void saveMedia(
                        output.url,
                        output.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.png',
                      ).catch((failure) => setError(message(failure)))
                    }
                  >
                    <Download size={16} /> Download PNG
                  </button>
                  <button
                    className="button"
                    disabled={locked}
                    onClick={() => {
                      change(structuredClone(viewed!.request));
                      setSelected(viewed!.request.layers.at(-1)?.id || '');
                    }}
                  >
                    <Layers size={16} /> Restore layers
                  </button>
                  <button
                    className="button"
                    disabled={!!working}
                    onClick={() =>
                      void api('/api/layer-stacks/' + viewed!.id + '/recipe')
                        .then((value) =>
                          saveJSON(
                            layerStackRecipeSchema.parse(value),
                            'aftertake-saved-layer-plan.json',
                          ),
                        )
                        .catch((failure) => setError(message(failure)))
                    }
                  >
                    <Download size={16} /> Saved plan
                  </button>
                </div>
                <p className="layer-receipt">Saved output SHA-256 {output.sha256}</p>
              </>
            )}
            {jobs.length > 0 && (
              <div className="layer-save-list" aria-label="Saved compositions">
                {jobs.slice(0, 8).map((job) => (
                  <button
                    key={job.id}
                    aria-pressed={job.id === viewedId}
                    onClick={() => setViewedId(job.id)}
                  >
                    <strong>{job.request.name}</strong>
                    <small>
                      {job.state} · {job.request.layers.length} layers · {job.request.canvas.width}{' '}
                      × {job.request.canvas.height}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </main>
          <aside
            className="layer-studio-panel layer-inspector-panel"
            aria-label="Selected layer controls"
          >
            <h3>{layer ? 'Layer properties' : 'Select a layer'}</h3>
            {!layer ? (
              <p className="layer-studio-muted">
                Choose a layer in the stack to adjust its blend, position or mask.
              </p>
            ) : (
              <div className="layer-inspector-fields">
                <label>
                  Layer name
                  <input
                    value={layer.name}
                    maxLength={80}
                    disabled={locked}
                    onChange={(event) => changeLayer({ name: event.target.value })}
                  />
                </label>
                <div className="layer-inspector-actions">
                  <button
                    className="layer-small-button"
                    title="Move layer up"
                    aria-label="Move layer up"
                    disabled={locked || layerIndex >= draft.layers.length - 1}
                    onClick={() => reorder(1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    className="layer-small-button"
                    title="Move layer down"
                    aria-label="Move layer down"
                    disabled={locked || layerIndex <= 0}
                    onClick={() => reorder(-1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    className="layer-small-button"
                    title="Duplicate layer"
                    aria-label="Duplicate layer"
                    disabled={locked || draft.layers.length >= 8}
                    onClick={duplicate}
                  >
                    <Copy size={17} />
                  </button>
                  <button
                    className="layer-small-button is-danger"
                    title="Remove layer"
                    aria-label="Remove layer"
                    disabled={locked}
                    onClick={() => {
                      change({
                        ...draft,
                        layers: draft.layers.filter((item) => item.id !== selected),
                      });
                      setSelected('');
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <label>
                  Blend mode
                  <select
                    value={layer.blend}
                    disabled={locked}
                    onChange={(event) =>
                      changeLayer({ blend: event.target.value as LayerStackLayer['blend'] })
                    }
                  >
                    {layerBlendModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {labelMode(mode)}
                      </option>
                    ))}
                  </select>
                </label>
                <Range
                  label="Layer opacity"
                  value={layer.opacity}
                  min={0}
                  max={1}
                  disabled={locked}
                  onChange={(opacity) => changeLayer({ opacity })}
                />
                {layer.blend === 'dissolve' && (
                  <label>
                    Dissolve seed
                    <input
                      type="number"
                      min={0}
                      max={4294967295}
                      step={1}
                      value={layer.dissolveSeed}
                      disabled={locked}
                      onChange={(event) =>
                        changeLayer({
                          dissolveSeed: Math.max(
                            0,
                            Math.min(4294967295, Math.round(Number(event.target.value) || 0)),
                          ),
                        })
                      }
                    />
                  </label>
                )}
                <label className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={layer.clipToBelow}
                    disabled={locked || (!canClip && !layer.clipToBelow)}
                    onChange={(event) => changeLayer({ clipToBelow: event.target.checked })}
                  />
                  Clip to image below
                </label>
                {layer.clipToBelow && !canClip && (
                  <small className="layer-stale">
                    This layer needs an unclipped image below it. Reorder it or turn clipping off.
                  </small>
                )}
                {layer.type === 'image' ? (
                  <details open>
                    <summary>Position and scale</summary>
                    <div className="layer-inspector-fields">
                      <p className="layer-studio-muted">
                        Images fit the canvas before these transforms. Offsets are relative to the
                        canvas width and height.
                      </p>
                      <Range
                        label="Horizontal position"
                        value={layer.transform.x}
                        min={-2}
                        max={2}
                        disabled={locked}
                        onChange={(x) => changeLayer({ transform: { ...layer.transform, x } })}
                      />
                      <Range
                        label="Vertical position"
                        value={layer.transform.y}
                        min={-2}
                        max={2}
                        disabled={locked}
                        onChange={(y) => changeLayer({ transform: { ...layer.transform, y } })}
                      />
                      <Range
                        label="Scale"
                        value={layer.transform.scale}
                        min={0.05}
                        max={4}
                        step={0.05}
                        suffix="×"
                        disabled={locked}
                        onChange={(scale) =>
                          changeLayer({ transform: { ...layer.transform, scale } })
                        }
                      />
                      <Range
                        label="Rotation"
                        value={layer.transform.rotation}
                        min={-180}
                        max={180}
                        step={1}
                        suffix="°"
                        disabled={locked}
                        onChange={(rotation) =>
                          changeLayer({ transform: { ...layer.transform, rotation } })
                        }
                      />
                      <label className="layer-toggle">
                        <input
                          type="checkbox"
                          checked={layer.transform.flipX}
                          disabled={locked}
                          onChange={(event) =>
                            changeLayer({
                              transform: { ...layer.transform, flipX: event.target.checked },
                            })
                          }
                        />
                        Flip horizontally
                      </label>
                      <button
                        className="layer-small-button"
                        disabled={locked}
                        onClick={() => changeLayer({ transform: { ...defaultLayerTransform } })}
                      >
                        <RotateCcw size={15} /> Reset transform
                      </button>
                      <p className="layer-receipt">Source SHA-256 {layer.source.sha256}</p>
                    </div>
                  </details>
                ) : (
                  <details open>
                    <summary>Color adjustment</summary>
                    <div className="layer-inspector-fields">
                      <p className="layer-studio-muted">
                        This adjustment affects the composite beneath it. Its opacity, blend and
                        mask limit that change.
                      </p>
                      {adjustmentControls.map((control) => (
                        <Range
                          key={control.key}
                          label={control.label}
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          suffix={'suffix' in control ? control.suffix : ''}
                          value={layer.settings[control.key]}
                          disabled={locked}
                          onChange={(value) =>
                            changeLayer({
                              settings: {
                                ...layer.settings,
                                [control.key]: value,
                              } as FinishingSettings,
                            })
                          }
                        />
                      ))}
                      <GradingControls
                        key={layer.id}
                        settings={layer.settings}
                        disabled={locked}
                        onChange={(next) =>
                          changeLayer({ settings: { ...layer.settings, ...next } })
                        }
                      />
                      <button
                        className="layer-small-button"
                        disabled={locked}
                        onClick={() =>
                          changeLayer({ settings: structuredClone(defaultFinishingSettings) })
                        }
                      >
                        <RotateCcw size={15} /> Reset adjustment
                      </button>
                    </div>
                  </details>
                )}
                <details open>
                  <summary>Layer mask</summary>
                  <div className="layer-inspector-fields">
                    <label>
                      Mask shape
                      <select
                        value={layer.mask?.kind || 'none'}
                        disabled={locked}
                        onChange={(event) => chooseMask(event.target.value)}
                      >
                        <option value="none">No mask</option>
                        <option value="rectangle">Rectangle</option>
                        <option value="ellipse">Ellipse</option>
                        <option value="image">Image mask</option>
                      </select>
                    </label>
                    <button
                      className="layer-small-button"
                      disabled={browserDemo || locked}
                      onClick={() => maskInput.current?.click()}
                    >
                      <Upload size={15} /> Import mask image
                    </button>
                    {layer.mask && (
                      <>
                        <label className="layer-toggle">
                          <input
                            type="checkbox"
                            checked={layer.mask.enabled}
                            disabled={locked}
                            onChange={(event) => updateMask({ enabled: event.target.checked })}
                          />
                          Enable mask
                        </label>
                        <label className="layer-toggle">
                          <input
                            type="checkbox"
                            checked={layer.mask.invert}
                            disabled={locked}
                            onChange={(event) => updateMask({ invert: event.target.checked })}
                          />
                          Invert mask
                        </label>
                        {layer.mask.kind === 'image' ? (
                          <>
                            <label>
                              Mask image
                              <select
                                value={layer.mask.source.assetId}
                                disabled={locked}
                                onChange={(event) => {
                                  const asset = images.find(
                                    (item) => item.id === event.target.value,
                                  );
                                  if (asset)
                                    updateMask({
                                      source: { assetId: asset.id, sha256: asset.sha256 },
                                    });
                                }}
                              >
                                {!images.some(
                                  (asset) =>
                                    asset.id ===
                                    (layer.mask as Extract<LayerMask, { kind: 'image' }>).source
                                      .assetId,
                                ) && (
                                  <option value={layer.mask.source.assetId}>
                                    Matching mask not imported
                                  </option>
                                )}
                                {images.map((asset) => (
                                  <option key={asset.id} value={asset.id}>
                                    {asset.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Mask channel
                              <select
                                value={layer.mask.channel}
                                disabled={locked}
                                onChange={(event) =>
                                  updateMask({
                                    channel: event.target.value as 'alpha' | 'luminance',
                                  })
                                }
                              >
                                <option value="luminance">Luminance · white reveals</option>
                                <option value="alpha">Alpha · opacity reveals</option>
                              </select>
                            </label>
                            <small>
                              Alpha reads opacity, so an opaque JPEG reveals the whole image.
                              Luminance uses white to reveal and black to hide.
                            </small>
                            <p className="layer-receipt">Mask SHA-256 {layer.mask.source.sha256}</p>
                          </>
                        ) : (
                          <>
                            <p className="layer-studio-muted">
                              Coordinates follow{' '}
                              {layer.type === 'image'
                                ? 'the original image before its transform'
                                : 'the canvas'}
                              ; 1 equals its full width or height.
                            </p>
                            <div className="layer-mask-grid">
                              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                                <label key={key}>
                                  {labelMode(key)}
                                  <input
                                    type="number"
                                    min={key === 'x' || key === 'y' ? -1 : 0.01}
                                    max={key === 'x' || key === 'y' ? 1 : 2}
                                    step={0.01}
                                    value={layer.mask?.kind !== 'image' ? layer.mask?.[key] : 0}
                                    disabled={locked}
                                    onChange={(event) =>
                                      updateMask({
                                        [key]: Math.max(
                                          key === 'x' || key === 'y' ? -1 : 0.01,
                                          Math.min(
                                            key === 'x' || key === 'y' ? 1 : 2,
                                            Number(event.target.value) || 0,
                                          ),
                                        ),
                                      })
                                    }
                                  />
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                        <Range
                          label="Mask grow / shrink"
                          value={layer.mask.grow}
                          min={-32}
                          max={32}
                          step={1}
                          suffix=" px"
                          disabled={locked}
                          onChange={(grow) => updateMask({ grow })}
                        />
                        <Range
                          label="Mask feather"
                          value={layer.mask.feather}
                          min={0}
                          max={32}
                          step={0.5}
                          suffix=" px"
                          disabled={locked}
                          onChange={(feather) => updateMask({ feather })}
                        />
                      </>
                    )}
                  </div>
                </details>
              </div>
            )}
          </aside>
        </div>
        <input
          ref={mediaInput}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          hidden
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <input
          ref={maskInput}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          hidden
          onChange={(event) => {
            void upload(event.target.files?.[0], true);
            event.target.value = '';
          }}
        />
        <input
          ref={recipeInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            void importPlan(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </section>
    </div>
  );
}
