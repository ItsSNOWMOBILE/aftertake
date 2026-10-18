import { useEffect, useRef, useState } from 'react';
import { Mic, LoaderCircle, Undo2 } from 'lucide-react';
import { filmDraftSchema, type FilmDraft, type FilmAsset } from './film';
import {
  canonicalJSON,
  narratedRowKeys,
  narratedSettingsSchema,
  narrationFromFilm,
  type NarratedCut as PreparedCut,
} from './narrated-cut';
import { apiFetch, browserDemo } from './transport';
import ScriptDraft from './ScriptDraft';

async function post<T>(route: string, input: unknown): Promise<T> {
  const response = await apiFetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'Could not prepare this cut.');
  return body;
}
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

export default function NarratedCut({
  draft,
  assets,
  pictureNames,
  disabled,
  onAssets,
  onBusy,
  onApply,
  onPreview,
}: {
  draft: FilmDraft;
  assets: FilmAsset[];
  pictureNames: Record<string, string>;
  disabled: boolean;
  onAssets: (assets: FilmAsset[]) => void;
  onBusy: (message: string) => void;
  onApply: (draft: FilmDraft) => void;
  onPreview: (cut: Pick<PreparedCut, 'draft' | 'identity'> | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [lines, setLines] = useState<Record<string, string>>(() =>
      stored('aftertake-narrated-lines', {}),
    );
  const [settings, setSettings] = useState(() => {
    const value = narratedSettingsSchema.safeParse(stored('aftertake-narrated-settings', {}));
    return value.success ? value.data : narratedSettingsSchema.parse({});
  });
  const { voice, speed, look, pace, dissolve } = settings;
  const [preparing, setPreparing] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState('');
  const [candidate, setCandidate] = useState<{ cut: PreparedCut; inputKey: string } | null>(null);
  const [backup, setBackup] = useState<FilmDraft | null>(() => {
    const result = filmDraftSchema.safeParse(stored('aftertake-film-before-narration', null));
    return result.success ? result.data : null;
  });
  const canceled = useRef(false),
    admitted = useRef(false);
  const rowKeys = narratedRowKeys(draft.shots),
    script = rowKeys.map((key) => (typeof lines[key] === 'string' ? lines[key] : ''));
  const existing = narrationFromFilm(draft, assets);
  const inputKey = canonicalJSON({ draft, script, voice, speed, look, pace, dissolve }),
    current = candidate?.inputKey === inputKey;
  const validDraft = filmDraftSchema.safeParse(draft);
  const canPrepare =
    validDraft.success &&
    draft.shots.length > 0 &&
    draft.shots.length <= 16 &&
    script.every((line) => line.trim().length > 0 && line.trim().length <= 240) &&
    draft.name.trim() &&
    speed >= 0.8 &&
    speed <= 1.3;
  useEffect(() => {
    localStorage.setItem('aftertake-narrated-lines', JSON.stringify(lines));
  }, [lines]);
  useEffect(() => {
    localStorage.setItem('aftertake-narrated-settings', JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    if (candidate && !current) onPreview(null);
  }, [candidate, current, onPreview]);
  useEffect(
    () => () => {
      canceled.current = true;
    },
    [],
  );
  async function prepare() {
    if (admitted.current || !canPrepare) return;
    admitted.current = true;
    canceled.current = false;
    setPreparing(true);
    setError('');
    setCandidate(null);
    onPreview(null);
    setProgress('Checking selected pictures…');
    onBusy('Preparing narrated cut…');
    try {
      const snapshot = filmDraftSchema.parse(draft),
        capturedKey = inputKey,
        text = script.map((line) => line.trim());
      const sources = await post<{ id: string; sha256: string }[]>(
        '/api/films/narrated-cuts/sources',
        { shots: snapshot.shots },
      );
      const beats = [];
      for (let index = 0; index < snapshot.shots.length; index++) {
        if (canceled.current)
          throw Error('Preparation stopped. Completed voices remain in your media library.');
        setProgress(`Voicing line ${index + 1} of ${snapshot.shots.length}…`);
        const asset = await post<FilmAsset>('/api/films/narration', {
          text: text[index],
          voice,
          speed,
          ...(look === 'spoken' ? { timedWords: true } : {}),
        });
        onAssets([asset]);
        const shot = snapshot.shots[index],
          picture = sources.find((source) => source.id === (shot.assetId || shot.renderId));
        if (!picture) throw Error('A selected picture is unavailable. Prepare this cut again.');
        beats.push({
          shot,
          text: text[index],
          pictureSHA256: picture.sha256,
          voice: { assetId: asset.id, sha256: asset.sha256 },
        });
      }
      if (canceled.current)
        throw Error('Preparation stopped. Completed voices remain in your media library.');
      setProgress('Pairing pictures, voices and captions…');
      const cut = await post<PreparedCut>('/api/films/narrated-cuts', {
        name: snapshot.name,
        aspect: snapshot.aspect,
        look,
        pace,
        dissolve,
        beats,
      });
      if (canceled.current)
        throw Error('Preparation stopped. Completed voices remain in your media library.');
      setCandidate({ cut, inputKey: capturedKey });
      onPreview({ identity: cut.identity, draft: cut.draft });
      setProgress('');
    } catch (error) {
      setError((error as Error).message);
      setProgress('');
    } finally {
      setPreparing(false);
      admitted.current = false;
      onBusy('');
    }
  }
  function apply() {
    if (!candidate || !current) return;
    const previous = filmDraftSchema.parse(draft);
    localStorage.setItem('aftertake-film-before-narration', JSON.stringify(previous));
    setBackup(previous);
    onApply(filmDraftSchema.parse(candidate.cut.draft));
    setCandidate(null);
    setOpen(false);
  }
  return (
    <details
      className="film-narrated-cut"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Mic size={15} />
        <strong>Make a narrated cut</strong>
        <span>One line per picture</span>
      </summary>
      <p>
        Arrange your pictures below, then write a short line for each. Measured voices set the cut
        lengths and captions. Preview the prepared film before using it.
      </p>
      {draft.shots.length > 0 && draft.shots.length <= 16 && (
        <ScriptDraft
          pictures={draft.shots.map((shot, index) => ({
            key: rowKeys[index],
            name: pictureNames[shot.assetId || shot.renderId!] || `Picture ${index + 1}`,
            seconds: shot.end - shot.start,
          }))}
          disabled={disabled || preparing}
          onUse={(drafted) => {
            setLines((all) => ({
              ...all,
              ...Object.fromEntries(rowKeys.map((key, index) => [key, drafted[index]])),
            }));
            setCandidate(null);
            onPreview(null);
          }}
        />
      )}
      {existing && (
        <div className="narrated-actions">
          <button
            className="film-import"
            disabled={disabled || preparing}
            onClick={() => {
              setLines((all) => ({
                ...all,
                ...Object.fromEntries(rowKeys.map((key, index) => [key, existing.lines[index]])),
              }));
              setSettings(existing.settings);
              setCandidate(null);
              onPreview(null);
            }}
          >
            Use this film's narration
          </button>
          <small>Copy its saved lines, voice and typography settings for a new prepared cut.</small>
        </div>
      )}
      {!draft.shots.length ? (
        <p>
          Add a picture in <b>01 / Picture</b> to start.
        </p>
      ) : draft.shots.length > 16 ? (
        <p>
          Use up to 16 pictures for a narrated cut. The regular Film editor supports longer edits.
        </p>
      ) : (
        <ol className="narrated-lines">
          {draft.shots.map((shot, index) => (
            <li key={rowKeys[index]}>
              <label>
                <span>
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  {pictureNames[shot.assetId || shot.renderId!] || 'Picture unavailable'}
                </span>
                <textarea
                  aria-label={`Spoken line ${index + 1}`}
                  maxLength={240}
                  rows={2}
                  placeholder={
                    index === 0 ? 'Start with your hook.' : 'What happens in this picture?'
                  }
                  value={script[index]}
                  disabled={disabled || preparing}
                  onChange={(event) =>
                    setLines((all) => ({ ...all, [rowKeys[index]]: event.target.value }))
                  }
                />
              </label>
              <small>
                {(shot.end - shot.start).toFixed(2)}s selected · {(script[index] || '').length}/240
              </small>
            </li>
          ))}
        </ol>
      )}
      <div className="narrated-settings">
        <label>
          Voice
          <select
            aria-label="Narrated cut voice"
            disabled={disabled || preparing}
            value={voice}
            onChange={(e) => setSettings({ ...settings, voice: e.target.value as typeof voice })}
          >
            <option value="af_heart">Heart · US</option>
            <option value="af_sarah">Sarah · US</option>
            <option value="am_michael">Michael · US</option>
            <option value="bm_george">George · UK</option>
          </select>
        </label>
        <label>
          Speed
          <input
            aria-label="Narrated cut speed"
            disabled={disabled || preparing}
            type="number"
            min={0.8}
            max={1.3}
            step={0.05}
            value={speed}
            onChange={(e) => setSettings({ ...settings, speed: Number(e.target.value) })}
          />
        </label>
        <label>
          Typography
          <select
            aria-label="Narrated cut typography"
            disabled={disabled || preparing}
            value={look}
            onChange={(e) => setSettings({ ...settings, look: e.target.value as typeof look })}
          >
            <option value="bold">Bold hook + closing line</option>
            <option value="spoken">Follow voice · highlighted words</option>
            <option value="captions">Clean captions</option>
          </select>
        </label>
        <label>
          Pace
          <select
            aria-label="Narrated cut pace"
            disabled={disabled || preparing}
            value={pace}
            onChange={(e) => setSettings({ ...settings, pace: e.target.value as typeof pace })}
          >
            <option value="quick">Quick · short breath</option>
            <option value="relaxed">Relaxed · more breathing room</option>
          </select>
        </label>
        <label>
          Between pictures
          <select
            aria-label="Narrated cut transition"
            disabled={disabled || preparing}
            value={dissolve}
            onChange={(e) => setSettings({ ...settings, dissolve: Number(e.target.value) })}
          >
            <option value={0}>Cut</option>
            <option value={0.125}>Smooth · 3 frames</option>
            <option value={0.25}>Smooth · 6 frames</option>
          </select>
        </label>
      </div>
      <p className="narrated-help">
        Uses the selected In/Out ranges. Shorten a line or extend its Out trim when it needs more
        footage. Captions start with their spoken line; every layer remains editable.
      </p>
      {look === 'spoken' && (
        <p className="narrated-help">
          Word timing comes from the generated voice. Review the highlights and adjust any word in
          Typography. Choosing this style creates a timed voice when one is not already saved.
        </p>
      )}
      {!validDraft.success && (
        <p role="alert">
          Fix the current film before preparing a narrated cut:{' '}
          {validDraft.error.issues[0]?.message}
        </p>
      )}
      <div className="narrated-actions">
        <button
          className="button"
          disabled={browserDemo || disabled || preparing || !canPrepare}
          onClick={() => void prepare()}
        >
          {preparing ? <LoaderCircle className="spin" size={14} /> : <Mic size={14} />}Prepare
          narrated cut
        </button>
        {preparing && (
          <button
            className="film-import"
            onClick={() => {
              canceled.current = true;
              setProgress('Stopping after the current operation…');
            }}
          >
            Stop preparation
          </button>
        )}
        {backup && !preparing && (
          <button
            className="film-import"
            disabled={disabled}
            onClick={() => {
              onApply(backup);
              setBackup(null);
              localStorage.removeItem('aftertake-film-before-narration');
              setCandidate(null);
            }}
          >
            <Undo2 size={12} />
            Restore previous cut
          </button>
        )}
      </div>
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      {candidate &&
        (current ? (
          <div className="narrated-review">
            <strong>Prepared preview · {candidate.cut.duration.toFixed(2)}s</strong>
            <p>
              The prepared cut is in the main viewer. Use it to edit its pictures, titles and
              voices.
            </p>
            <button
              className="film-import"
              disabled={disabled}
              onClick={() =>
                onPreview({ identity: candidate.cut.identity, draft: candidate.cut.draft })
              }
            >
              Preview prepared cut
            </button>
            <ol>
              {candidate.cut.ledger.map((beat, index) => (
                <li key={index}>
                  <span>
                    {beat.voiceStart?.toFixed(2)}–{beat.voiceEnd?.toFixed(2)}s
                  </span>
                  {beat.spokenText}
                </li>
              ))}
            </ol>
            <button className="button" disabled={disabled} onClick={apply}>
              Use this narrated cut
            </button>
          </div>
        ) : (
          <p>Your film or script changed. Prepare the cut again to match these inputs.</p>
        ))}
      {browserDemo && (
        <p className="browser-film-note">
          Local narration and film preparation run in the installed studio.
        </p>
      )}
    </details>
  );
}
