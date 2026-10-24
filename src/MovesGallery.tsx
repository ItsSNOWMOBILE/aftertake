import { useId, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { cinemaOptions, movementNotes, promptOnlyMovements, type Cinema } from './cinema';
import './moves-gallery.css';

/** Every card plays a real Animate a frame result (scripts/build-move-previews.py). */
const preview = (move: Cinema['movement'], extension: 'mp4' | 'jpg') =>
  `${import.meta.env.BASE_URL}moves/${move}.${extension}`;

export default function MovesGallery({
  value,
  disabled,
  onChange,
}: {
  value: Cinema['movement'];
  disabled?: boolean;
  onChange: (movement: Cinema['movement']) => void;
}) {
  const [open, setOpen] = useState(false);
  const region = useId();
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="moves-gallery">
      <button
        type="button"
        className="moves-toggle"
        aria-expanded={open}
        aria-controls={region}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Clapperboard size={13} aria-hidden="true" />
        {open ? 'Hide camera moves' : `Browse ${cinemaOptions.movement.length} camera moves`}
      </button>
      {open && (
        <div id={region} className="moves-grid" role="group" aria-label="Camera moves">
          {cinemaOptions.movement.map(([move, label]) => (
            <button
              key={move}
              type="button"
              className="move-card"
              aria-pressed={value === move}
              disabled={disabled}
              onClick={() => onChange(move)}
            >
              <video
                className="move-preview"
                aria-hidden="true"
                src={preview(move, 'mp4')}
                poster={preview(move, 'jpg')}
                muted
                loop
                playsInline
                autoPlay={!reducedMotion}
                preload={reducedMotion ? 'none' : 'metadata'}
              />
              <strong>{label}</strong>
              <small>
                {movementNotes[move]}
                {promptOnlyMovements.has(move) ? ' Prompt guidance.' : ''}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
