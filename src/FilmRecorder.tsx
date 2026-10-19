import { useEffect, useId, useRef, useState } from 'react';
import { Circle, LoaderCircle, Monitor, Square, Trash2, Upload } from 'lucide-react';
import {
  createFilmRecordingSession,
  filmRecordingAvailability,
  idleFilmRecording,
  type FilmRecordingState,
} from './film-recorder';
import './film-recorder.css';

export type FilmRecorderProps = {
  onRecorded: (file: File) => void | Promise<void>;
  disabled?: boolean;
};

export function FilmRecorder({ onRecorded, disabled = false }: FilmRecorderProps) {
  const titleId = useId();
  const [unavailable] = useState(filmRecordingAvailability);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [state, setState] = useState<FilmRecordingState>(idleFilmRecording);
  const [preview, setPreview] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [importError, setImportError] = useState('');
  const mounted = useRef(true);
  const session = useRef<ReturnType<typeof createFilmRecordingSession> | null>(null);
  const active = ['choosing', 'recording', 'stopping'].includes(state.phase);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current?.dispose();
      session.current = null;
    };
  }, []);

  useEffect(() => {
    if (!state.file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(state.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [state.file]);

  function start() {
    if (disabled || unavailable || active || importing) return;
    setNotice('');
    setImportError('');
    session.current ??= createFilmRecordingSession({
      mediaDevices: navigator.mediaDevices,
      Recorder: MediaRecorder,
      onChange: (next) => {
        if (mounted.current) setState(next);
      },
    });
    void session.current.start(includeAudio);
  }

  function discard() {
    session.current?.discard();
    setNotice('');
    setImportError('');
  }

  async function importRecording() {
    if (!state.file || importing || disabled) return;
    setImporting(true);
    setImportError('');
    try {
      await onRecorded(state.file);
      if (mounted.current) setNotice('Recording imported into Film assets.');
    } catch {
      if (mounted.current)
        setImportError('The recording could not be imported. Your preview is retained; try again.');
    } finally {
      if (mounted.current) setImporting(false);
    }
  }

  const seconds = Math.floor(state.elapsedMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <details className="film-recorder">
      <summary id={titleId}>
        <Monitor size={16} aria-hidden="true" /> Record your screen
      </summary>
      <div className="film-recorder-body" aria-labelledby={titleId}>
        <p>
          Capture a real workflow, then review it before importing. Choose a tab, window or screen
          in your browser’s sharing chooser.
        </p>
        {unavailable ? (
          <p className="film-recorder-notice">{unavailable}</p>
        ) : (
          <>
            <label className="film-recorder-audio">
              <input
                type="checkbox"
                checked={includeAudio}
                disabled={active || importing || disabled || Boolean(state.file)}
                onChange={(event) => setIncludeAudio(event.target.checked)}
              />
              Include tab or system audio when available
            </label>
            <p className="film-recorder-hint">
              No microphone. Up to 2 minutes / 96 MB. Requests 30 fps and a visible cursor; actual
              capture and audio depend on your browser and chosen surface.
            </p>
            <div className="film-recorder-actions">
              {!active && !state.file && (
                <button
                  className="button"
                  type="button"
                  disabled={disabled || importing}
                  onClick={start}
                >
                  <Circle size={15} aria-hidden="true" /> Record screen
                </button>
              )}
              {state.phase === 'recording' && (
                <button className="button" type="button" onClick={() => session.current?.stop()}>
                  <Square size={14} aria-hidden="true" /> Stop recording
                </button>
              )}
              {state.phase === 'stopping' && (
                <span className="film-recorder-state" role="status">
                  <LoaderCircle size={15} className="spin" aria-hidden="true" /> Finishing
                  recording…
                </span>
              )}
              {(active || state.file) && (
                <button className="button" type="button" disabled={importing} onClick={discard}>
                  <Trash2 size={15} aria-hidden="true" />
                  {state.phase === 'choosing' ? 'Cancel recording' : 'Discard recording'}
                </button>
              )}
              {(state.phase === 'recording' || state.phase === 'stopping' || state.file) && (
                <span className="film-recorder-stats">
                  {clock} · {(state.bytes / (1024 * 1024)).toFixed(1)} MB ·{' '}
                  {state.audio ? 'With audio' : 'Silent'}
                </span>
              )}
            </div>
            {state.phase === 'choosing' && (
              <p className="film-recorder-notice" role="status">
                Choose what to share in your browser’s dialog. Recording starts after you confirm.
              </p>
            )}
            {state.note && <p className="film-recorder-notice">{state.note}</p>}
          </>
        )}
        {preview && state.file && (
          <div className="film-recorder-result">
            <video
              src={preview}
              controls
              playsInline
              preload="metadata"
              aria-label="Recorded screen preview"
            />
            <div className="film-recorder-actions">
              <button
                className="button"
                type="button"
                disabled={disabled || importing || Boolean(notice)}
                onClick={() => void importRecording()}
              >
                {importing ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
                {importing ? 'Importing recording…' : 'Import into Film'}
              </button>
              <span className="film-recorder-hint">
                Nothing is uploaded until you choose Import.
              </span>
            </div>
          </div>
        )}
        {(state.error || importError) && (
          <p className="film-recorder-error" role="alert">
            {state.error || importError}
          </p>
        )}
        {notice && (
          <p className="film-recorder-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}
