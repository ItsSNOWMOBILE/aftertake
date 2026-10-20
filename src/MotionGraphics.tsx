import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ArrowDown,
  ArrowUp,
  Circle,
  Copy,
  ImagePlus,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { FilmAsset } from './film';
import {
  filmGraphicSchema,
  motionAt,
  motionPreset,
  motionPresets,
  motionProgress,
  motionTrackSchema,
  type FilmGraphic,
  type MotionKeyframe,
  type MotionPresetName,
  type MotionTrack,
} from './film-motion';
import { mediaUrl } from './transport';
import './motion-graphics.css';

const countLimit = 24;
const presetLabels: Record<MotionPresetName, string> = {
  none: 'Still · no motion track',
  'slide-left': 'Slide left into place',
  'slide-right': 'Slide right into place',
  'slide-up': 'Rise into place',
  pop: 'Pop into place',
  drift: 'Slow drift',
  'panel-sweep': 'Sweep across the canvas',
};
const easingLabels = [
  ['linear', 'Constant speed'],
  ['ease-in', 'Soft start, fast finish'],
  ['ease-out', 'Fast start, soft stop'],
  ['ease-in-out', 'Smooth start & stop'],
  ['hold', 'Hold, then jump'],
] as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const display = (value: number) => Number(value.toFixed(4));

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  factor = 1,
  disabled,
  readOnly,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  factor?: number;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        min={min * factor}
        max={max * factor}
        step={step}
        value={display(value * factor)}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => {
          const number = event.target.valueAsNumber / factor;
          if (Number.isFinite(number)) onChange(clamp(number, min, max));
        }}
      />
    </label>
  );
}

export function MotionTrackEditor({
  motion,
  onChange,
  disabled = false,
  onPreview,
}: {
  motion?: MotionTrack;
  onChange: (motion: MotionTrack | undefined) => void;
  disabled?: boolean;
  onPreview?: (progress: number) => void;
}) {
  const keys = motion?.keys;
  const [addedAt, setAddedAt] = useState<number>();
  const currentPreset = !motion
    ? 'none'
    : motionPresets.find((name) => JSON.stringify(motionPreset(name)) === JSON.stringify(motion)) ||
      'custom';
  function write(next: MotionKeyframe[]) {
    if (disabled) return;
    const parsed = motionTrackSchema.safeParse({ keys: next });
    if (parsed.success) onChange(parsed.data);
  }
  function update(index: number, patch: Partial<MotionKeyframe>) {
    if (!keys) return;
    write(keys.map((key, at) => (at === index ? { ...key, ...patch } : key)));
  }
  let widest = 0;
  for (let index = 1; keys && index < keys.length - 1; index++) {
    if (keys[index + 1].at - keys[index].at > keys[widest + 1].at - keys[widest].at) widest = index;
  }
  const canAdd = !!keys && keys.length < 12 && keys[widest + 1].at - keys[widest].at > 0.0002;
  function addKey() {
    if (!keys || !canAdd) return;
    const at = (keys[widest].at + keys[widest + 1].at) / 2;
    write([
      ...keys.slice(0, widest + 1),
      { at, ...motionAt(motion, at), easing: 'linear' },
      ...keys.slice(widest + 1),
    ]);
    setAddedAt(at);
    onPreview?.(at);
  }
  function moveTime(index: number, value: number) {
    if (!keys || index === 0 || index === keys.length - 1) return;
    const margin = Math.min(0.0001, (keys[index + 1].at - keys[index - 1].at) / 3);
    const at = clamp(value, keys[index - 1].at + margin, keys[index + 1].at - margin);
    update(index, { at });
    onPreview?.(at);
  }
  function enableCustom() {
    onChange({
      keys: [
        { at: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        { at: 1, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'linear' },
      ],
    });
  }
  return (
    <details className="motion-track-editor">
      <summary>Transform & motion{keys ? ` · ${keys.length} keyframes` : ' · still'}</summary>
      <fieldset disabled={disabled}>
        <div className="motion-preset-row">
          <label>
            Starting point
            <select
              aria-label="Motion starting point"
              value={currentPreset}
              onChange={(event) =>
                event.target.value === 'custom'
                  ? enableCustom()
                  : onChange(motionPreset(event.target.value as MotionPresetName))
              }
            >
              {motionPresets.map((name) => (
                <option key={name} value={name}>
                  {presetLabels[name]}
                </option>
              ))}
              <option value="custom">
                {currentPreset === 'custom' ? 'Custom keyframes' : 'New custom track'}
              </option>
            </select>
          </label>
          <button type="button" disabled={disabled || !motion} onClick={() => onChange(undefined)}>
            <RotateCcw size={13} /> Reset
          </button>
        </div>
        <p className="motion-hint">
          Presets are editable starting points. Offsets use the full canvas; 100% moves one canvas
          width or height. Key time runs from the layer’s first to last displayed frame.
        </p>
        {keys ? (
          <>
            <ol className="motion-key-list" aria-label="Motion keyframes">
              {keys.map((key, index) => (
                <li key={index}>
                  <details className="motion-key-card" open={index === 0 || key.at === addedAt}>
                    <summary className="motion-key-heading">
                      <strong>
                        {index === 0
                          ? 'First frame'
                          : index === keys.length - 1
                            ? 'Last frame'
                            : `Keyframe ${index + 1}`}
                      </strong>
                      <span>{display(key.at * 100)}%</span>
                    </summary>
                    <div className="motion-key-actions">
                      {onPreview && (
                        <button
                          type="button"
                          aria-label={`Preview motion keyframe ${index + 1}`}
                          onClick={() => onPreview(key.at)}
                        >
                          <Play size={12} /> Preview
                        </button>
                      )}
                      {index > 0 && index < keys.length - 1 && (
                        <button
                          type="button"
                          className="motion-delete"
                          aria-label={`Remove motion keyframe ${index + 1}`}
                          onClick={() => write(keys.filter((_, at) => at !== index))}
                        >
                          <X size={12} /> Remove
                        </button>
                      )}
                    </div>
                    <div className="motion-field-grid wide">
                      <NumberField
                        label={`Key ${index + 1} time (%)`}
                        value={key.at}
                        min={0}
                        max={1}
                        step={0.1}
                        factor={100}
                        readOnly={index === 0 || index === keys.length - 1}
                        onChange={(at) => moveTime(index, at)}
                      />
                      <NumberField
                        label={`Key ${index + 1} X offset (%)`}
                        value={key.x}
                        min={-2}
                        max={2}
                        factor={100}
                        onChange={(x) => update(index, { x })}
                      />
                      <NumberField
                        label={`Key ${index + 1} Y offset (%)`}
                        value={key.y}
                        min={-2}
                        max={2}
                        factor={100}
                        onChange={(y) => update(index, { y })}
                      />
                      <NumberField
                        label={`Key ${index + 1} scale (%)`}
                        value={key.scale}
                        min={0.02}
                        max={4}
                        factor={100}
                        onChange={(scale) => update(index, { scale })}
                      />
                      <NumberField
                        label={`Key ${index + 1} rotation (°)`}
                        value={key.rotation}
                        min={-360}
                        max={360}
                        onChange={(rotation) => update(index, { rotation })}
                      />
                      <NumberField
                        label={`Key ${index + 1} horizontal scale (%)`}
                        value={key.scaleX ?? 1}
                        min={0.02}
                        max={4}
                        factor={100}
                        onChange={(scaleX) => update(index, { scaleX })}
                      />
                      <NumberField
                        label={`Key ${index + 1} vertical scale (%)`}
                        value={key.scaleY ?? 1}
                        min={0.02}
                        max={4}
                        factor={100}
                        onChange={(scaleY) => update(index, { scaleY })}
                      />
                      <NumberField
                        label={`Key ${index + 1} opacity (%)`}
                        value={key.opacity}
                        min={0}
                        max={1}
                        factor={100}
                        onChange={(opacity) => update(index, { opacity })}
                      />
                      {index > 0 && (
                        <label className="motion-full-width">
                          Move into this keyframe
                          <select
                            aria-label={`Key ${index + 1} easing`}
                            value={key.easing || 'linear'}
                            onChange={(event) =>
                              update(index, {
                                easing: event.target.value as MotionKeyframe['easing'],
                              })
                            }
                          >
                            {easingLabels.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="button"
              disabled={disabled || !canAdd}
              onClick={addKey}
            >
              <Plus size={13} /> Add keyframe
            </button>
            <p className="motion-hint">
              Up to 12 keys. First and last stay at 0% and 100%. Reordering graphics changes their
              depth; it does not change their timing.
            </p>
          </>
        ) : (
          <button className="button" type="button" onClick={enableCustom}>
            <Plus size={13} /> Add custom motion
          </button>
        )}
      </fieldset>
    </details>
  );
}

export function MotionGraphicsEditor({
  graphics,
  assets,
  duration,
  time,
  onChange,
  onSeek,
  disabled = false,
}: {
  graphics: FilmGraphic[];
  assets: FilmAsset[];
  duration: number;
  time: number;
  onChange: (graphics: FilmGraphic[]) => void;
  onSeek: (time: number) => void;
  disabled?: boolean;
}) {
  const [selectedImage, setSelectedImage] = useState('');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(graphics, null, 2));
  const [jsonDirty, setJsonDirty] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [jsonNotice, setJsonNotice] = useState('');
  const jsonInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!jsonDirty) setJsonDraft(JSON.stringify(graphics, null, 2));
  }, [graphics, jsonDirty]);
  const stills = assets.filter((asset) => asset.kind === 'image');
  const selected = stills.find((asset) => asset.id === selectedImage) || stills[0];
  const canAdd = !disabled && graphics.length < countLimit && duration >= 0.25;
  function add(kind: FilmGraphic['kind'], preset?: 'panel' | 'frame') {
    if (!canAdd || (kind === 'image' && !selected)) return;
    const start = clamp(Math.floor(time * 24) / 24, 0, duration - 0.25);
    const graphic = filmGraphicSchema.parse({
      id: crypto.randomUUID(),
      name:
        kind === 'image'
          ? selected.name.slice(0, 80)
          : `${kind === 'rect' ? 'Rectangle' : 'Ellipse'} ${graphics.length + 1}`,
      kind,
      start,
      end: Math.min(duration, start + 2),
      x: 0.5,
      y: kind === 'rect' ? 0.78 : 0.5,
      width: kind === 'rect' ? 0.5 : 0.2,
      height: kind === 'rect' ? 0.15 : 0.2,
      color: '#d5e991',
      opacity: 1,
      ...(kind === 'rect' ? { radius: 0.08 } : {}),
      ...(kind === 'image'
        ? { assetId: selected.id, sha256: selected.sha256, fit: 'contain' }
        : {}),
      ...(preset === 'panel'
        ? {
            name: `Reveal panel ${graphics.length + 1}`,
            x: 0.5,
            y: 0.5,
            width: 1.05,
            height: 1.05,
            radius: 0,
            color: '#f5f4ec',
            motion: motionPreset('panel-sweep'),
          }
        : {}),
      ...(preset === 'frame'
        ? {
            name: `Outline frame ${graphics.length + 1}`,
            x: 0.5,
            y: 0.5,
            width: 0.82,
            height: 0.78,
            radius: 0.04,
            fillOpacity: 0,
            strokeWidth: 3,
            strokeColor: '#d5e991',
            motion: motionPreset('pop'),
          }
        : {}),
    });
    onChange([...graphics, graphic]);
    onSeek(start);
  }
  function replace(index: number, graphic: FilmGraphic) {
    if (disabled) return;
    const parsed = filmGraphicSchema.safeParse(graphic);
    if (parsed.success) onChange(graphics.map((item, at) => (at === index ? parsed.data : item)));
  }
  function move(index: number, delta: number) {
    const target = index + delta;
    if (disabled || target < 0 || target >= graphics.length) return;
    const next = [...graphics];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return (
    <section className="motion-graphics-editor" aria-label="Motion graphics">
      <div className="motion-graphics-heading">
        <h4>
          <Layers size={15} /> Graphics & motion
        </h4>
        <span className="motion-layer-count">
          {graphics.length} / {countLimit} layers
        </span>
      </div>
      <p className="motion-hint">
        Build panels, accents and image overlays on their own clocks. Back layers draw first; front
        layers draw above them. Graphics sit above footage and below titles unless Shared groups
        &amp; depth defines a combined overlay order.
      </p>
      <div className="motion-add-tools">
        <button type="button" className="button" disabled={!canAdd} onClick={() => add('rect')}>
          <Square size={13} /> Rectangle
        </button>
        <button type="button" className="button" disabled={!canAdd} onClick={() => add('ellipse')}>
          <Circle size={13} /> Ellipse
        </button>
        <button
          type="button"
          className="button"
          disabled={!canAdd}
          onClick={() => add('rect', 'panel')}
        >
          <Layers size={13} /> Reveal panel
        </button>
        <button
          type="button"
          className="button"
          disabled={!canAdd}
          onClick={() => add('rect', 'frame')}
        >
          <Square size={13} /> Outline frame
        </button>
        <div className="motion-image-add">
          <label>
            Imported still
            <select
              aria-label="Graphic image to add"
              disabled={!canAdd || !stills.length}
              value={selected?.id || ''}
              onChange={(event) => setSelectedImage(event.target.value)}
            >
              {stills.length ? (
                stills.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))
              ) : (
                <option value="">Import an image in Film media</option>
              )}
            </select>
          </label>
          <button
            type="button"
            className="button"
            disabled={!canAdd || !selected}
            onClick={() => add('image')}
          >
            <ImagePlus size={13} /> Add image
          </button>
        </div>
      </div>
      {duration < 0.25 && (
        <p className="motion-hint">Add a picture to your film before placing timed graphics.</p>
      )}
      {graphics.length ? (
        <ol className="motion-layer-list" aria-label="Graphics from back to front">
          {graphics.map((graphic, index) => (
            <li key={graphic.id}>
              <GraphicEditor
                graphic={graphic}
                index={index}
                count={graphics.length}
                assets={stills}
                duration={duration}
                time={time}
                disabled={disabled}
                onChange={(next) => replace(index, next)}
                onSeek={onSeek}
                onMove={(delta) => move(index, delta)}
                onDuplicate={() => {
                  if (!canAdd) return;
                  const duplicate = {
                    ...graphic,
                    id: crypto.randomUUID(),
                    name: `${graphic.name.slice(0, 75)} copy`,
                    motion: graphic.motion ? structuredClone(graphic.motion) : undefined,
                  };
                  onChange([
                    ...graphics.slice(0, index + 1),
                    duplicate,
                    ...graphics.slice(index + 1),
                  ]);
                }}
                onRemove={() => {
                  if (!disabled) onChange(graphics.filter((_, at) => at !== index));
                }}
                canDuplicate={canAdd}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="motion-empty">
          A lower third, a moving color panel, a logo reveal. Add a shape or an imported still, then
          give it a path.
        </p>
      )}
      <details className="motion-json-editor">
        <summary>Edit motion JSON</summary>
        <p className="motion-hint">
          Paste or review the graphics array. Apply checks every layer and keeps the current edit
          until the full array is valid. It does not run code.
        </p>
        <label>
          Graphics array
          <textarea
            ref={jsonInput}
            aria-label="Motion graphics JSON"
            rows={12}
            maxLength={262144}
            spellCheck={false}
            value={jsonDraft}
            disabled={disabled}
            onChange={(event) => {
              setJsonDraft(event.target.value);
              setJsonDirty(true);
              setJsonError('');
              setJsonNotice('');
            }}
          />
        </label>
        <div className="motion-json-actions">
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={() => {
              try {
                const parsed = z
                  .array(filmGraphicSchema)
                  .max(countLimit)
                  .parse(JSON.parse(jsonDraft));
                const next = parsed.map((graphic) => {
                  if (graphic.kind !== 'image') return graphic;
                  const asset =
                    stills.find(
                      (item) =>
                        item.id === graphic.assetId &&
                        (!graphic.sha256 || item.sha256 === graphic.sha256),
                    ) ||
                    (graphic.sha256
                      ? stills.find((item) => item.sha256 === graphic.sha256)
                      : undefined);
                  if (!asset)
                    throw Error(
                      `Import the matching still for “${graphic.name}” into Film media before applying.`,
                    );
                  return { ...graphic, assetId: asset.id, sha256: asset.sha256 };
                });
                if (new Set(next.map((graphic) => graphic.id)).size !== next.length)
                  throw Error('Every graphic needs a unique ID.');
                if (next.some((graphic) => graphic.end > duration + 1e-6))
                  throw Error('A graphic ends after the film. Adjust its timing before applying.');
                onChange(next);
                setJsonDraft(JSON.stringify(next, null, 2));
                setJsonDirty(false);
                setJsonError('');
                setJsonNotice('Graphics applied. Review the layer timing and preview.');
              } catch (error) {
                setJsonError(
                  error instanceof z.ZodError
                    ? error.issues
                        .map((issue) => `${issue.path.join('.') || 'Graphics'}: ${issue.message}`)
                        .slice(0, 4)
                        .join(' ')
                    : error instanceof SyntaxError
                      ? 'This is not valid JSON. Correct the array before applying.'
                      : (error as Error).message,
                );
                setJsonNotice('');
              }
            }}
          >
            Apply graphics JSON
          </button>
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={() => {
              setJsonDraft(JSON.stringify(graphics, null, 2));
              setJsonDirty(false);
              setJsonError('');
              setJsonNotice('Loaded the current layers.');
            }}
          >
            Load current layers
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              jsonInput.current?.focus();
              jsonInput.current?.select();
            }}
          >
            Select JSON
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(graphics, null, 2)], { type: 'application/json' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'aftertake-motion-graphics.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download current layers
          </button>
        </div>
        {jsonError && <p role="alert">{jsonError}</p>}
        {jsonNotice && (
          <p className="motion-json-notice" role="status">
            {jsonNotice}
          </p>
        )}
      </details>
    </section>
  );
}

function GraphicEditor({
  graphic,
  index,
  count,
  assets,
  duration,
  time,
  disabled,
  canDuplicate,
  onChange,
  onSeek,
  onMove,
  onDuplicate,
  onRemove,
}: {
  graphic: FilmGraphic;
  index: number;
  count: number;
  assets: FilmAsset[];
  duration: number;
  time: number;
  disabled: boolean;
  canDuplicate: boolean;
  onChange: (graphic: FilmGraphic) => void;
  onSeek: (time: number) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(graphic.name);
  useEffect(() => setName(graphic.name), [graphic.name]);
  const frameTime = Math.floor(time * 24 + 1e-7) / 24;
  const active = frameTime >= graphic.start && frameTime < graphic.end;
  const image = assets.find(
    (asset) => asset.id === graphic.assetId && (!graphic.sha256 || asset.sha256 === graphic.sha256),
  );
  const label = `Graphic ${index + 1}`;
  function patch(next: Partial<FilmGraphic>) {
    onChange({ ...graphic, ...next });
  }
  function preview(progress: number) {
    const first = Math.ceil(graphic.start * 24 - 1e-7);
    const last = Math.max(first, Math.ceil(graphic.end * 24 - 1e-7) - 1);
    onSeek((first + Math.round((last - first) * progress)) / 24);
  }
  return (
    <details className={'motion-graphic-card' + (active ? ' active' : '')} open>
      <summary className="motion-graphic-heading">
        <span className="motion-graphic-title">
          {graphic.kind === 'rect' ? (
            <Square size={15} />
          ) : graphic.kind === 'ellipse' ? (
            <Circle size={15} />
          ) : (
            <ImagePlus size={15} />
          )}
          <span>
            <strong>{graphic.name}</strong>
            <small>
              Layer {index + 1}
              {index === 0 ? ' · back' : index === count - 1 ? ' · front' : ''} ·{' '}
              {display(graphic.start)}–{display(graphic.end)}s
            </small>
          </span>
        </span>
        {active && <span className="motion-graphic-state">At playhead</span>}
      </summary>
      <div className="motion-graphic-body">
        <div className="motion-layer-actions">
          <button
            type="button"
            disabled={disabled}
            onClick={() => preview(0)}
            aria-label={`Preview ${label.toLowerCase()}`}
          >
            <Play size={12} /> Preview
          </button>
          <button
            type="button"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
            aria-label={`Move ${label.toLowerCase()} backward`}
          >
            <ArrowDown size={12} /> Back
          </button>
          <button
            type="button"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`Move ${label.toLowerCase()} forward`}
          >
            <ArrowUp size={12} /> Front
          </button>
          <button
            type="button"
            disabled={disabled || !canDuplicate}
            onClick={onDuplicate}
            aria-label={`Duplicate ${label.toLowerCase()}`}
          >
            <Copy size={12} /> Copy
          </button>
          <button
            type="button"
            className="motion-delete"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Delete ${label.toLowerCase()}`}
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
        <fieldset disabled={disabled}>
          <label>
            Layer name
            <input
              aria-label={`${label} name`}
              maxLength={80}
              value={name}
              aria-invalid={!name.trim() || undefined}
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim()) patch({ name: event.target.value });
              }}
              onBlur={() => {
                if (!name.trim()) setName(graphic.name);
              }}
            />
          </label>
          <div className="motion-field-grid">
            <NumberField
              label={`${label} from (s)`}
              value={graphic.start}
              min={0}
              max={Math.max(0, Math.min(duration - 0.25, graphic.end - 0.25))}
              step={1 / 24}
              onChange={(start) => patch({ start })}
            />
            <NumberField
              label={`${label} until (s)`}
              value={graphic.end}
              min={graphic.start + 0.25}
              max={Math.max(graphic.start + 0.25, duration)}
              step={1 / 24}
              onChange={(end) => patch({ end })}
            />
          </div>
          {graphic.kind === 'image' && (
            <>
              <label>
                Image source
                <select
                  aria-label={`${label} image`}
                  value={graphic.assetId || ''}
                  onChange={(event) => {
                    const asset = assets.find((item) => item.id === event.target.value);
                    if (asset) patch({ assetId: asset.id, sha256: asset.sha256 });
                  }}
                >
                  {!image && (
                    <option value={graphic.assetId || ''}>
                      Missing matching image · choose a still
                    </option>
                  )}
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              {!image && (
                <p className="motion-warning" role="status">
                  The matching still is missing. Import its original bytes, or deliberately choose
                  another source above.
                </p>
              )}
              <label>
                Fit in graphic box
                <select
                  aria-label={`${label} image fit`}
                  value={graphic.fit || 'contain'}
                  onChange={(event) => patch({ fit: event.target.value as 'contain' | 'cover' })}
                >
                  <option value="contain">Fit · show the whole image</option>
                  <option value="cover">Fill · crop centrally</option>
                </select>
              </label>
            </>
          )}
          <fieldset>
            <legend>Placement & appearance</legend>
            <div className="motion-field-grid wide">
              <NumberField
                label={`${label} center X (%)`}
                value={graphic.x}
                min={-2}
                max={3}
                factor={100}
                onChange={(x) => patch({ x })}
              />
              <NumberField
                label={`${label} center Y (%)`}
                value={graphic.y}
                min={-2}
                max={3}
                factor={100}
                onChange={(y) => patch({ y })}
              />
              <NumberField
                label={`${label} width (%)`}
                value={graphic.width}
                min={0.005}
                max={3}
                factor={100}
                step={0.5}
                onChange={(width) => patch({ width })}
              />
              <NumberField
                label={`${label} height (%)`}
                value={graphic.height}
                min={0.005}
                max={3}
                factor={100}
                step={0.5}
                onChange={(height) => patch({ height })}
              />
              <NumberField
                label={`${label} opacity (%)`}
                value={graphic.opacity}
                min={0}
                max={1}
                factor={100}
                onChange={(opacity) => patch({ opacity })}
              />
              <NumberField
                label={`${label} ${graphic.kind === 'image' ? 'image' : 'fill'} opacity (%)`}
                value={graphic.fillOpacity ?? 1}
                min={0}
                max={1}
                factor={100}
                onChange={(fillOpacity) => patch({ fillOpacity })}
              />
              {graphic.kind !== 'ellipse' && (
                <NumberField
                  label={`${label} corner radius (%)`}
                  value={graphic.radius || 0}
                  min={0}
                  max={0.5}
                  factor={100}
                  onChange={(radius) => patch({ radius })}
                />
              )}
              {graphic.kind !== 'image' && (
                <label>
                  Fill color
                  <input
                    aria-label={`${label} fill color`}
                    type="color"
                    value={graphic.color}
                    onChange={(event) => patch({ color: event.target.value })}
                  />
                </label>
              )}
              <label>
                Stroke color
                <input
                  aria-label={`${label} stroke color`}
                  type="color"
                  value={graphic.strokeColor || '#ffffff'}
                  onChange={(event) => patch({ strokeColor: event.target.value })}
                />
              </label>
              <NumberField
                label={`${label} stroke width (px)`}
                value={graphic.strokeWidth || 0}
                min={0}
                max={32}
                step={0.5}
                onChange={(strokeWidth) => patch({ strokeWidth })}
              />
            </div>
          </fieldset>
          <p className="motion-hint">
            Center 50%, 50% is the middle of the canvas. Size follows the canvas, corners follow the
            smaller side of the graphic, and stroke pixels use a 1280px-wide reference.
          </p>
          <MotionTrackEditor
            motion={graphic.motion}
            disabled={disabled}
            onChange={(motion) => patch({ motion })}
            onPreview={preview}
          />
        </fieldset>
      </div>
    </details>
  );
}

export function GraphicPreview({
  graphics,
  assets,
  time,
  width,
  height,
}: {
  graphics: FilmGraphic[];
  assets: FilmAsset[];
  time: number;
  width: number;
  height: number;
}) {
  const prefix = useId().replace(/:/g, '');
  if (!(width > 0) || !(height > 0)) return null;
  const frameTime = Math.floor(time * 24 + 1e-7) / 24;
  return (
    <svg
      className="motion-graphic-preview"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {graphics
        .filter((graphic) => frameTime >= graphic.start && frameTime < graphic.end)
        .map((graphic) => {
          const pose = motionAt(
            graphic.motion,
            motionProgress(graphic.start, graphic.end, frameTime),
          );
          const w = graphic.width * width,
            h = graphic.height * height;
          const radius = (graphic.radius || 0) * Math.min(w, h);
          const stroke = graphic.strokeWidth ? graphic.strokeColor || '#ffffff' : 'none';
          const strokeWidth = ((graphic.strokeWidth || 0) * width) / 1280;
          const transform = `translate(${(graphic.x + pose.x) * width} ${(graphic.y + pose.y) * height}) rotate(${pose.rotation}) scale(${pose.scale * pose.scaleX} ${pose.scale * pose.scaleY})`;
          const image =
            graphic.kind === 'image'
              ? assets.find(
                  (asset) =>
                    asset.kind === 'image' &&
                    asset.id === graphic.assetId &&
                    (!graphic.sha256 || asset.sha256 === graphic.sha256),
                )
              : undefined;
          const clipId = `${prefix}-${graphic.id}`;
          return (
            <g key={graphic.id} transform={transform} opacity={graphic.opacity * pose.opacity}>
              {graphic.kind === 'ellipse' ? (
                <ellipse
                  cx={0}
                  cy={0}
                  rx={w / 2}
                  ry={h / 2}
                  fill={graphic.color}
                  fillOpacity={graphic.fillOpacity ?? 1}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              ) : graphic.kind === 'rect' ? (
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={radius}
                  fill={graphic.color}
                  fillOpacity={graphic.fillOpacity ?? 1}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              ) : image ? (
                <>
                  <defs>
                    <clipPath id={clipId}>
                      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={radius} />
                    </clipPath>
                  </defs>
                  <image
                    href={mediaUrl(image.url)}
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    preserveAspectRatio={
                      graphic.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
                    }
                    opacity={graphic.fillOpacity ?? 1}
                    clipPath={`url(#${clipId})`}
                  />
                  {strokeWidth > 0 && (
                    <rect
                      x={-w / 2}
                      y={-h / 2}
                      width={w}
                      height={h}
                      rx={radius}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                    />
                  )}
                </>
              ) : null}
            </g>
          );
        })}
    </svg>
  );
}
