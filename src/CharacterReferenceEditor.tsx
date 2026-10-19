import { useRef, useState } from 'react';
import type { CharacterFaceBox } from './character';
import type { Clip } from './domain';
import { mediaUrl } from './transport';

type Point = { x: number; y: number };

export default function CharacterReferenceEditor({
  photo,
  value,
  onChange,
  disabled,
  label,
  suppliesOutfit = false,
}: {
  photo: Clip;
  value?: CharacterFaceBox;
  onChange: (box: CharacterFaceBox | undefined) => void;
  disabled: boolean;
  label: string;
  suppliesOutfit?: boolean;
}) {
  const start = useRef<Point | null>(null);
  const [draft, setDraft] = useState<CharacterFaceBox>();
  const focused = draft || value;
  const ratio = value ? (value.width * photo.width) / (value.height * photo.height) : undefined;
  function point(event: React.PointerEvent<HTMLElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }
  function boxBetween(a: Point, b: Point): CharacterFaceBox {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }
  function coordinate(field: keyof CharacterFaceBox, percent: number) {
    if (!value || !Number.isFinite(percent)) return;
    const box = { ...value, [field]: percent / 100 };
    box.x = Math.max(0, Math.min(0.95, box.x));
    box.y = Math.max(0, Math.min(0.95, box.y));
    box.width = Math.max(0.05, Math.min(1 - box.x, box.width));
    box.height = Math.max(0.05, Math.min(1 - box.y, box.height));
    onChange(box);
  }
  return (
    <div className="character-reference-editor">
      <div
        className="character-face-canvas"
        role="group"
        aria-label={`${label} and optional face focus`}
        style={{ aspectRatio: String(photo.width / photo.height) }}
        onPointerDown={(event) => {
          if (disabled) return;
          start.current = point(event);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (start.current) setDraft(boxBetween(start.current, point(event)));
        }}
        onPointerUp={(event) => {
          const origin = start.current;
          start.current = null;
          setDraft(undefined);
          if (!origin || disabled) return;
          const box = boxBetween(origin, point(event));
          if (box.width >= 0.05 && box.height >= 0.05) onChange(box);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDraft(undefined);
        }}
      >
        <img draggable={false} src={mediaUrl(photo.url)} alt={label} />
        {focused && (
          <span
            className="character-face-box"
            style={{
              left: `${focused.x * 100}%`,
              top: `${focused.y * 100}%`,
              width: `${focused.width * 100}%`,
              height: `${focused.height * 100}%`,
            }}
          />
        )}
      </div>
      <p className="character-hint">
        Drag around the whole head, including hair and chin, to focus facial details.
        {suppliesOutfit
          ? ' This primary photo also supplies the outfit when selected below.'
          : ' Use another view of the same person. Clothing in this photo does not set the outfit.'}
      </p>
      <div className="character-face-controls">
        <button
          className="button"
          disabled={disabled}
          onClick={() =>
            onChange({
              x: 0.3,
              y: 0.1,
              width: 0.4,
              height: Math.min(0.8, (0.4 * photo.width) / photo.height),
            })
          }
        >
          {value ? 'Reset face focus' : 'Add face focus'}
        </button>
        {value && (
          <>
            <fieldset disabled={disabled}>
              <legend>{label} · face focus in percent</legend>
              {(['x', 'y', 'width', 'height'] as const).map((field, index) => (
                <label key={field}>
                  {['LEFT', 'TOP', 'WIDTH', 'HEIGHT'][index]}
                  <input
                    aria-label={`${label} face focus ${['left', 'top', 'width', 'height'][index]} percent`}
                    type="number"
                    min={index < 2 ? 0 : 5}
                    max={index < 2 ? 95 : 100}
                    step={0.1}
                    value={Math.round(value[field] * 1000) / 10}
                    onChange={(event) => coordinate(field, Number(event.target.value))}
                  />
                </label>
              ))}
            </fieldset>
            {ratio !== undefined && (ratio < 0.5 || ratio > 2) && (
              <p className="character-reference-error" role="status">
                Include the full head in a roughly square face focus.
              </p>
            )}
            <button className="button" disabled={disabled} onClick={() => onChange(undefined)}>
              Clear face focus
            </button>
          </>
        )}
      </div>
    </div>
  );
}
