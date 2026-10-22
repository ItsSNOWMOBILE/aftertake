import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import AftertakeBrand from './AftertakeBrand';
import { rememberStartScreen, startScreenWanted, startTasks, type StartTask } from './start-tasks';
import './start-screen.css';

export default function StartScreen({
  onChoose,
  onClose,
}: {
  onChoose: (task: StartTask) => void;
  onClose: () => void;
}) {
  const heading = useId();
  const dialog = useRef<HTMLElement>(null);
  const [showAtStart, setShowAtStart] = useState(startScreenWanted);
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const preview = (id: StartTask, extension: 'mp4' | 'jpg') =>
    `${import.meta.env.BASE_URL}start/${id}.${extension}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('.start-card')?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <section
      ref={dialog}
      className="start-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
        if (event.key === 'Tab') {
          const nodes = [
            ...(dialog.current?.querySelectorAll<HTMLElement>('button, input') || []),
          ].filter((node) => !node.hasAttribute('disabled'));
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
      <header className="start-header">
        <AftertakeBrand />
        <h1 id={heading}>What do you want to make?</h1>
        <p>
          Every tool runs open-weight models on your own GPU; Comfy Cloud is optional, studio by
          studio.
        </p>
      </header>
      <div className="start-grid">
        {startTasks.map((task) => (
          <button key={task.id} className="start-card" onClick={() => onChoose(task.id)}>
            <video
              aria-hidden="true"
              src={preview(task.id, 'mp4')}
              poster={preview(task.id, 'jpg')}
              muted
              loop
              playsInline
              autoPlay={!reducedMotion}
              preload={reducedMotion ? 'none' : 'auto'}
            />
            <span className="start-card-text">
              <strong>{task.title}</strong>
              <small>{task.line}</small>
            </span>
            <ArrowRight className="start-card-arrow" size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <footer className="start-footer">
        <label>
          <input
            type="checkbox"
            checked={showAtStart}
            onChange={(event) => {
              setShowAtStart(event.target.checked);
              rememberStartScreen(event.target.checked);
            }}
          />
          Show this when Aftertake opens
        </label>
        <button className="button" onClick={onClose}>
          Go to my workspace
        </button>
      </footer>
    </section>
  );
}
