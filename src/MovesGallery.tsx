import { useId, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { cinemaOptions, movementNotes, type Cinema } from './cinema';
import './moves-gallery.css';

/** A small looping diagram of what the camera does: far, middle and near layers in one frame. */
function MoveDiagram({ move }: { move: Cinema['movement'] }) {
  return (
    <svg className={`move-diagram move-${move}`} viewBox="0 0 80 45" aria-hidden="true">
      <rect width="80" height="45" className="move-sky" />
      <g className="move-scene">
        <g className="move-far">
          <circle cx="62" cy="11" r="4.5" className="move-sun" />
          <path
            d="M-60 31 L-34 17 L-12 27 L4 15 L18 26 L32 12 L52 29 L66 18 L90 27 L112 14 L134 26 L160 31 Z"
            className="move-hills"
          />
          <rect x="-60" y="31" width="220" height="40" className="move-ground" />
        </g>
        <g className="move-mid">
          <circle cx="40" cy="20.5" r="3.6" className="move-subject" />
          <path d="M34.6 36 Q35 25.5 40 25.5 Q45 25.5 45.4 36 Z" className="move-subject" />
        </g>
        <g className="move-near">
          <rect x="66" y="16" width="3.2" height="32" rx="1" className="move-post" />
          <ellipse cx="13" cy="44" rx="11" ry="5" className="move-bush" />
        </g>
      </g>
      <rect width="80" height="45" className="move-frame" />
    </svg>
  );
}

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
        {open ? 'Hide camera moves' : 'Browse camera moves'}
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
              <MoveDiagram move={move} />
              <strong>{label}</strong>
              <small>{movementNotes[move]}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
