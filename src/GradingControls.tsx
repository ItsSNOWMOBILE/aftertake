import { useEffect, useRef, useState } from 'react';
import {
  colorChannels,
  curveChannels,
  defaultCurves,
  defaultSelectiveColor,
  lutDescriptorSchema,
  sampleCurve,
  type GradingCurves,
} from './grading';
import type { FinishingSettings } from './finishing';
import { apiFetch, browserDemo, saveMedia } from './transport';

export default function GradingControls({
  settings,
  disabled,
  onChange,
}: {
  settings: FinishingSettings;
  disabled: boolean;
  onChange: (next: Partial<FinishingSettings>) => void;
}) {
  const [channel, setChannel] = useState<(typeof colorChannels)[number]>('red');
  const [curve, setCurve] = useState<(typeof curveChannels)[number]>('master');
  const [declared, setDeclared] = useState(false),
    [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const points = settings.curves[curve];
  useEffect(() => {
    if (!settings.lut || browserDemo) return;
    let active = true;
    void apiFetch(`/api/finishing/luts/${settings.lut.sha256}/info`)
      .then(async (response) => {
        if (!response.ok)
          throw Error(
            'The LUT companion is missing. Import its matching .cube file before preview/export.',
          );
        if (active) setMessage('Matching LUT companion is available.');
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [settings.lut?.sha256]);
  function changePoint(index: number, key: 'x' | 'y', value: number) {
    if (!Number.isFinite(value)) return;
    const next = points.map((point) => ({ ...point }));
    if (key === 'x')
      value = Math.max(
        index ? next[index - 1].x + 0.000001 : 0,
        Math.min(index < next.length - 1 ? next[index + 1].x - 0.000001 : 1, value),
      );
    else
      value = Math.max(
        index ? next[index - 1].y : 0,
        Math.min(index < next.length - 1 ? next[index + 1].y : 1, value),
      );
    next[index][key] = value;
    onChange({ curves: { ...settings.curves, [curve]: next } });
  }
  function addPoint() {
    let at = 0;
    for (let index = 1; index < points.length - 1; index++)
      if (points[index + 1].x - points[index].x > points[at + 1].x - points[at].x) at = index;
    const next = points.map((point) => ({ ...point }));
    next.splice(at + 1, 0, {
      x: (points[at].x + points[at + 1].x) / 2,
      y: (points[at].y + points[at + 1].y) / 2,
    });
    onChange({ curves: { ...settings.curves, [curve]: next } });
  }
  async function importLut(selected?: File) {
    if (!selected) return;
    setUploading(true);
    setMessage('');
    try {
      if (!selected.name.toLowerCase().endsWith('.cube') || selected.size > 16 * 1024 * 1024)
        throw Error('Choose a .cube file no larger than 16 MiB.');
      const response = await apiFetch('/api/finishing/luts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-LUT-Color-Space': 'srgb' },
        body: await selected.arrayBuffer(),
      });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || 'The LUT could not be imported.');
      const lut = lutDescriptorSchema.parse(value);
      onChange({ lut, lutStrength: 1 });
      setMessage('LUT imported. Review an actual frame before saving the take.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  }
  return (
    <>
      <fieldset className="finishing-grade" disabled={disabled}>
        <legend>Selective HSL</legend>
        <label>
          COLOR CHANNEL
          <select
            aria-label="Selective HSL channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value as typeof channel)}
          >
            {colorChannels.map((name) => (
              <option key={name} value={name}>
                {name[0].toUpperCase() + name.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <p>Adjust neighboring hues smoothly. Neutral grays stay unchanged.</p>
        {(['hueDegrees', 'saturation', 'lightness'] as const).map((key) => (
          <label className="finishing-slider" key={key}>
            <span>
              {key === 'hueDegrees' ? 'Hue' : key === 'saturation' ? 'Saturation' : 'Lightness'}
              <output>
                {settings.selectiveColor[channel][key].toFixed(2)}
                {key === 'hueDegrees' ? '°' : ''}
              </output>
            </span>
            <input
              aria-label={`Selective ${channel} ${key}`}
              type="range"
              min={key === 'hueDegrees' ? -30 : -1}
              max={key === 'hueDegrees' ? 30 : 1}
              step={key === 'hueDegrees' ? 0.5 : 0.01}
              value={settings.selectiveColor[channel][key]}
              onChange={(event) =>
                onChange({
                  selectiveColor: {
                    ...settings.selectiveColor,
                    [channel]: {
                      ...settings.selectiveColor[channel],
                      [key]: Number(event.target.value),
                    },
                  },
                })
              }
            />
          </label>
        ))}
        <button
          className="button"
          type="button"
          onClick={() =>
            onChange({
              selectiveColor: {
                ...settings.selectiveColor,
                [channel]: { ...defaultSelectiveColor[channel] },
              },
            })
          }
        >
          Reset {channel}
        </button>
      </fieldset>
      <fieldset className="finishing-grade" disabled={disabled}>
        <legend>Tone curves</legend>
        <label>
          CURVE CHANNEL
          <select
            aria-label="Tone curve channel"
            value={curve}
            onChange={(event) => setCurve(event.target.value as typeof curve)}
          >
            {curveChannels.map((name) => (
              <option key={name} value={name}>
                {name[0].toUpperCase() + name.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <svg
          className="finishing-curve-graph"
          viewBox="0 0 240 160"
          role="img"
          aria-label={`${curve} monotone tone curve`}
        >
          <path d="M0 80H240M120 0V160M0 160L240 0" fill="none" stroke="#566058" strokeWidth="1" />
          <polyline
            points={sampleCurve(points)
              .map((point) => `${point.x * 240},${(1 - point.y) * 160}`)
              .join(' ')}
            fill="none"
            stroke="#d5e991"
            strokeWidth="2"
          />
          {points.map((point, index) => (
            <circle key={index} cx={point.x * 240} cy={(1 - point.y) * 160} r="3" fill="#eef1eb" />
          ))}
        </svg>
        <p>
          Input runs left to right; output runs bottom to top. Edit monotone points below. Master
          runs before each RGB curve.
        </p>
        <div className="finishing-curve-points">
          {points.map((point, index) => (
            <div key={index}>
              <label>
                Input
                <input
                  aria-label={`${curve} point${index + 1} input`}
                  type="number"
                  min="0"
                  max="1"
                  step=".01"
                  value={point.x}
                  disabled={disabled || index === 0 || index === points.length - 1}
                  onChange={(event) => changePoint(index, 'x', Number(event.target.value))}
                />
              </label>
              <label>
                Output
                <input
                  aria-label={`${curve} point${index + 1} output`}
                  type="number"
                  min="0"
                  max="1"
                  step=".01"
                  value={point.y}
                  onChange={(event) => changePoint(index, 'y', Number(event.target.value))}
                />
              </label>
              <button
                className="button"
                type="button"
                aria-label={`Remove ${curve} point${index + 1}`}
                disabled={disabled || index === 0 || index === points.length - 1}
                onClick={() =>
                  onChange({
                    curves: { ...settings.curves, [curve]: points.filter((_, at) => at !== index) },
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="image-actions">
          <button
            className="button"
            type="button"
            disabled={disabled || points.length >= 16}
            onClick={addPoint}
          >
            Add point
          </button>
          <button
            className="button"
            type="button"
            onClick={() =>
              onChange({
                curves: {
                  ...settings.curves,
                  [curve]: defaultCurves[curve].map((point) => ({ ...point })),
                },
              })
            }
          >
            Reset {curve}
          </button>
          <button
            className="button"
            type="button"
            onClick={() => onChange({ curves: structuredClone(defaultCurves) as GradingCurves })}
          >
            Reset all curves
          </button>
        </div>
      </fieldset>
      <fieldset className="finishing-grade" disabled={disabled || uploading}>
        <legend>3D LUT</legend>
        <p>
          Import a display-referred sRGB .cube, edge 2–64, up to 16 MiB. Log and ACES LUTs need an
          explicit conversion and are not supported here.
        </p>
        <label className="finishing-lut-declaration">
          <input
            type="checkbox"
            checked={declared}
            onChange={(event) => setDeclared(event.target.checked)}
          />
          My LUT expects display-referred sRGB.
        </label>
        <input
          ref={file}
          type="file"
          accept=".cube"
          hidden
          onChange={(event) => void importLut(event.target.files?.[0])}
        />
        <button
          className="button"
          type="button"
          disabled={disabled || uploading || browserDemo || !declared}
          onClick={() => file.current?.click()}
        >
          {uploading ? 'Importing LUT…' : 'Import .cube'}
        </button>
        {settings.lut && (
          <>
            <p className="finishing-lut-info">
              {settings.lut.title} · {settings.lut.size}³ · sRGB
              <br />
              <code>{settings.lut.sha256}</code>
            </p>
            <label className="finishing-slider">
              <span>
                LUT strength<output>{settings.lutStrength.toFixed(2)}</output>
              </span>
              <input
                aria-label="Finishing LUT strength"
                type="range"
                min="0"
                max="1"
                step=".01"
                value={settings.lutStrength}
                onChange={(event) => onChange({ lutStrength: Number(event.target.value) })}
              />
            </label>
            <div className="image-actions">
              <button
                className="button"
                type="button"
                disabled={disabled || browserDemo}
                onClick={() =>
                  void saveMedia(
                    `/api/finishing/luts/${settings.lut!.sha256}`,
                    `${settings.lut!.sha256}.cube`,
                  ).catch((error) => setMessage(error.message))
                }
              >
                Save companion .cube
              </button>
              <button
                className="button"
                type="button"
                onClick={() => {
                  onChange({ lut: null, lutStrength: 0 });
                  setMessage('');
                }}
              >
                Remove LUT
              </button>
            </div>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </fieldset>
    </>
  );
}
