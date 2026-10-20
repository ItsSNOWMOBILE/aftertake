import { apiFetch, browserDemo, mediaUrl, saveMedia } from './transport';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, LoaderCircle, Sparkles, Upload, X } from 'lucide-react';
import { findImportedClip, type Clip, type Engine, type Recipe } from './domain';
import {
  frameEditBusy,
  frameEditRequestSchema,
  type FrameEdit,
  type FrameEditRequest,
} from './frame-edit';
import CreativeRecipePicker from './CreativeRecipePicker';
import { applyFrameCreativeRecipe } from './creative-recipes';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init),
    body = await response.json();
  if (!response.ok) throw Error(body.error || 'Frame edit request failed.');
  return body;
}

export default function FrameEditor({
  recipe,
  clips,
  edits,
  onUpdate,
  onImport,
  onUse,
  onClose,
}: {
  recipe: Recipe;
  clips: Clip[];
  edits: FrameEdit[];
  onUpdate: (edit: FrameEdit) => void;
  onImport: (clip: Clip) => void;
  onUse: (edit: FrameEdit) => boolean;
  onClose: () => void;
}) {
  const history = edits.filter(
    (edit) =>
      edit.request.clip.sha256 === recipe.clip.sha256 &&
      Math.abs(edit.request.trimStart - recipe.trimStart) < 0.001,
  );
  const previous = history[0]?.request;
  const previousSubject = previous?.subject
    ? findImportedClip(
        clips.filter((clip) => clip.kind === 'image'),
        previous.subject,
      )
    : undefined;
  const [prompt, setPrompt] = useState(
      previous?.subject && !previousSubject ? '' : previous?.prompt || '',
    ),
    [seed, setSeed] = useState(previous?.seed ?? recipe.seed);
  const [mode, setMode] = useState<FrameEditRequest['mode']>(previous?.mode || 'fast');
  const [subjectId, setSubjectId] = useState(previousSubject?.id || '');
  const [sending, setSending] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState('');
  const [engine, setEngine] = useState<Engine | null>(null),
    [selected, setSelected] = useState(''),
    [source, setSource] = useState(false);
  const [notice, setNotice] = useState(
    previous?.subject && !previousSubject
      ? `Import the previous subject image (${previous.subject.name}), then choose Reuse these settings.`
      : '',
  );
  const dialog = useRef<HTMLElement>(null),
    direction = useRef<HTMLTextAreaElement>(null),
    input = useRef<HTMLInputElement>(null);
  const recipeInput = useRef<HTMLInputElement>(null);
  const pending = edits.find(frameEditBusy);
  const ending = recipe.pipeline === 'cinema';
  const motion = recipe.pipeline === 'motion-transfer';
  const viewed = history.find((edit) => edit.id === selected) || history[0];
  const subject = clips.find((clip) => clip.id === subjectId && clip.kind === 'image');
  const busy = sending || uploading || Boolean(pending);
  function reuseSettings(edit: FrameEdit) {
    const reference = edit.request.subject
      ? findImportedClip(
          clips.filter((clip) => clip.kind === 'image'),
          edit.request.subject,
        )
      : undefined;
    if (edit.request.subject && !reference) {
      setError(`Import the matching subject image first: ${edit.request.subject.name}`);
      return;
    }
    setPrompt(edit.request.prompt);
    setSeed(edit.request.seed);
    setMode(edit.request.mode);
    setSubjectId(reference?.id || '');
    setError('');
    setNotice('Frame settings loaded. Creating an edited frame makes a new variation.');
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    direction.current?.focus();
    let live = true;
    const check = () =>
      request<Engine>('/api/engine?pipeline=frame-edit')
        .then((value) => {
          if (live) setEngine(value);
        })
        .catch((error) => {
          if (live) setError(error.message);
        });
    void check();
    const interval = setInterval(check, 5000);
    return () => {
      live = false;
      clearInterval(interval);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function generate() {
    setError('');
    setNotice('');
    setSending(true);
    try {
      const edit = await request<FrameEdit>('/api/frame-edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'aftertake-frame-edit/1',
          clip: recipe.clip,
          trimStart: recipe.trimStart,
          prompt,
          seed,
          mode,
          subject,
        }),
      });
      onUpdate(edit);
      setSelected(edit.id);
      setSource(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function act(edit: FrameEdit, action: 'cancel' | 'reconcile') {
    setError('');
    setSending(true);
    try {
      onUpdate(
        await request<FrameEdit>(`/api/frame-edits/${edit.id}/${action}`, { method: 'POST' }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      if (file.size > 100 * 1024 * 1024 || !/\.(png|jpe?g|webp)$/i.test(file.name))
        throw Error('Choose a PNG, JPEG or WebP image under 100 MB.');
      const clip = await request<Clip>(`/api/clips?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      onImport(clip);
      setSubjectId(clip.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    setError('');
    setNotice('');
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a frame recipe under 2 MB.');
      const payload = JSON.parse(await file.text()),
        value = frameEditRequestSchema.parse(payload.request || payload);
      const source = findImportedClip(clips, value.clip);
      if (
        !source ||
        source.sha256 !== recipe.clip.sha256 ||
        Math.abs(value.trimStart - recipe.trimStart) > 0.001
      )
        throw Error(
          'Choose the matching source and starting time before importing this frame recipe.',
        );
      const subject = value.subject
        ? findImportedClip(
            clips.filter((clip) => clip.kind === 'image'),
            value.subject,
          )
        : undefined;
      if (value.subject && !subject)
        throw Error(`Import the matching subject image first: ${value.subject.name}`);
      setPrompt(value.prompt);
      setSeed(value.seed);
      setMode(value.mode);
      setSubjectId(subject?.id || '');
      setNotice('Frame recipe loaded. Create an edited frame to run these settings.');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal frame-editor"
        role="dialog"
        aria-modal="true"
        aria-label={
          motion
            ? 'Create an appearance'
            : ending
              ? 'Create an ending frame'
              : 'Create an edited frame'
        }
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
          if (event.key === 'Tab') {
            const focusable = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),a[href],input:not(:disabled):not([hidden]),textarea:not(:disabled),select:not(:disabled)',
              ) || []),
            ];
            const first = focusable[0],
              last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <button className="modal-close" title="Close frame editor" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="eyebrow">LOCAL APPEARANCE EDIT / QWEN IMAGE EDIT</div>
        <h2>
          {motion
            ? 'Cast a new character.'
            : ending
              ? 'Design the final moment.'
              : 'Give the shot a new appearance.'}
        </h2>
        <p className="frame-editor-intro">
          {motion
            ? 'Change the subject in the starting frame while keeping its pose and framing. Review the appearance, then animate it with your driving clip. Leave room for the full gesture.'
            : ending
              ? 'Edit the starting frame into the ending you imagine. Review the image, then use it as the destination for your video transition.'
              : 'Describe a change to the starting frame. Review the image, then use it to guide your video. Keep the composition and give the new object room inside your painted cue.'}
        </p>
        <div className="frame-editor-grid">
          <div className="frame-editor-preview">
            <div className="frame-preview-tabs">
              <button
                className={source || !viewed?.clip ? 'active' : ''}
                onClick={() => setSource(true)}
              >
                Source frame
              </button>
              <button
                disabled={!viewed?.clip}
                className={!source && viewed?.clip ? 'active' : ''}
                onClick={() => setSource(false)}
              >
                Edited frame
              </button>
              <span>{recipe.trimStart.toFixed(2)}s INTO SOURCE</span>
            </div>
            <img
              src={mediaUrl(
                !source && viewed?.clip
                  ? viewed.clip.url
                  : `/api/thumbnails/${recipe.clip.id}?time=${recipe.trimStart}`,
              )}
              alt={
                !source && viewed?.clip
                  ? ending
                    ? 'Generated ending frame'
                    : 'Generated edited first frame'
                  : 'Selected starting frame before editing'
              }
            />
            {viewed?.clip && (
              <div className="frame-result-actions">
                <button
                  className="button frame-use"
                  disabled={busy}
                  onClick={() => {
                    if (onUse(viewed)) onClose();
                  }}
                >
                  {motion
                    ? 'Use this appearance'
                    : ending
                      ? 'Use as ending frame'
                      : 'Use this edited frame'}
                  <ArrowUpRight size={14} />
                </button>
                <a
                  href={mediaUrl(viewed.clip.url)}
                  onClick={
                    browserDemo
                      ? (event) => {
                          event.preventDefault();
                          void saveMedia(viewed.clip!.url, 'aftertake-edited-frame.png').catch(
                            (error) => setError(error.message),
                          );
                        }
                      : undefined
                  }
                  download={ending ? 'aftertake-ending-frame.png' : 'aftertake-edited-frame.png'}
                  title="Download edited frame"
                >
                  <Download size={16} />
                </a>
                <a
                  href={mediaUrl(`/api/frame-edits/${viewed.id}/recipe`)}
                  download
                  onClick={
                    browserDemo
                      ? (event) => {
                          event.preventDefault();
                          void saveMedia(
                            `/api/frame-edits/${viewed.id}/recipe`,
                            'aftertake-frame-recipe.json',
                          ).catch((error) => setError(error.message));
                        }
                      : undefined
                  }
                >
                  Frame recipe ↗
                </a>
              </div>
            )}
            {viewed && (
              <div className="frame-result-detail">
                <span>
                  {viewed.state === 'succeeded'
                    ? 'READY FOR YOUR REVIEW'
                    : viewed.state.replaceAll('_', ' ').toUpperCase()}{' '}
                  · SEED {viewed.request.seed} · {viewed.request.mode === 'fast' ? '4' : '20'} STEPS
                </span>
                <p>{viewed.request.prompt}</p>
                <button className="button" disabled={busy} onClick={() => reuseSettings(viewed)}>
                  Reuse these settings
                </button>
                {viewed.error && <p className="error-note">{viewed.error}</p>}
                {['output_error', 'connection_lost', 'submission_unknown'].includes(
                  viewed.state,
                ) && (
                  <button
                    className="button"
                    disabled={sending}
                    onClick={() => void act(viewed, 'reconcile')}
                  >
                    Check submitted job
                  </button>
                )}
              </div>
            )}
            {pending && (
              <div className="frame-edit-progress" role="status">
                <LoaderCircle size={16} className="spin" />
                <div>
                  <strong>{pending.stage || pending.state.replaceAll('_', ' ')}</strong>
                  <small>
                    {pending.request.clip.name}
                    {pending.progress !== null ? ` · ${Math.round(pending.progress * 100)}%` : ''}
                  </small>
                </div>
                {pending.jobId && pending.state !== 'finalizing' && (
                  <button disabled={sending} onClick={() => void act(pending, 'cancel')}>
                    Cancel
                  </button>
                )}
                {!pending.jobId && (
                  <button disabled={sending} onClick={() => void act(pending, 'reconcile')}>
                    Check submission
                  </button>
                )}
              </div>
            )}
            {history.length > 1 && (
              <div className="frame-edit-history" aria-label="Previous frame edits">
                {history
                  .filter((edit) => edit.clip)
                  .map((edit) => (
                    <button
                      key={edit.id}
                      className={edit.id === viewed?.id ? 'active' : ''}
                      title={edit.request.prompt}
                      onClick={() => {
                        setSelected(edit.id);
                        setSource(false);
                      }}
                    >
                      <img
                        src={mediaUrl(edit.clip!.url)}
                        alt={`Edited frame, seed ${edit.request.seed}`}
                      />
                      <span>Seed {edit.request.seed}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          <div className="frame-editor-controls">
            <CreativeRecipePicker
              kind="frame"
              hasSubject={Boolean(subject)}
              disabled={busy}
              onLoad={(id) => {
                const next = applyFrameCreativeRecipe(
                  {
                    format: 'aftertake-frame-edit/1',
                    clip: recipe.clip,
                    trimStart: recipe.trimStart,
                    subject: subject ? { ...subject, kind: 'image' } : undefined,
                    prompt,
                    seed,
                    mode,
                  },
                  id,
                );
                setPrompt(next.prompt);
                setMode(next.mode);
                setError('');
                setNotice('Starter loaded. Review the prompt, then choose Create edited frame.');
              }}
            />
            <button
              className="frame-recipe-import"
              disabled={busy}
              onClick={() => recipeInput.current?.click()}
            >
              Import frame recipe ↗
            </button>
            <label htmlFor="frame-direction">WHAT SHOULD CHANGE?</label>
            <textarea
              ref={direction}
              id="frame-direction"
              value={prompt}
              maxLength={2000}
              disabled={busy}
              placeholder={
                motion
                  ? 'Replace the robot with a knitted teddy bear. Keep the starting pose, full-body framing and background.'
                  : ending
                    ? 'Turn the waterfall into a turquoise crystal monolith. Keep the forest and camera framing.'
                    : 'Replace the waterfall with a turquoise crystal monolith. Keep the surrounding forest, framing and lighting unchanged.'
              }
              onChange={(event) => setPrompt(event.target.value)}
            />
            <label htmlFor="frame-subject">
              SUBJECT REFERENCE <span>OPTIONAL</span>
            </label>
            <div className="frame-subject-picker">
              <select
                id="frame-subject"
                value={subjectId}
                disabled={busy}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                <option value="">No additional image</option>
                {clips
                  .filter((clip) => clip.kind === 'image')
                  .map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.name}
                    </option>
                  ))}
              </select>
              <button
                title="Import subject reference"
                disabled={busy || browserDemo}
                onClick={() => input.current?.click()}
              >
                {uploading ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}
              </button>
            </div>
            {subject && (
              <img
                className="frame-subject"
                src={mediaUrl(subject.url)}
                alt="Additional subject reference"
              />
            )}
            <small>
              If using a reference, describe how Picture 2 should appear in Picture 1. Consistency
              varies; inspect the result.
            </small>
            <div className="frame-edit-settings">
              <label>
                QUALITY
                <select
                  aria-label="Frame edit quality"
                  value={mode}
                  disabled={busy}
                  onChange={(event) => setMode(event.target.value as FrameEditRequest['mode'])}
                >
                  <option value="fast">Fast · 4 steps</option>
                  <option value="detail">Detailed · 20 steps</option>
                </select>
              </label>
              <label>
                SEED
                <input
                  aria-label="Frame edit seed"
                  type="number"
                  min={0}
                  max={2 ** 32 - 1}
                  step={1}
                  value={seed}
                  disabled={busy}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value)) setSeed(Math.max(0, Math.min(2 ** 32 - 1, value)));
                  }}
                />
              </label>
            </div>
            <button
              className="button frame-generate"
              disabled={busy || !engine?.ready || prompt.trim().length < 5}
              onClick={() => void generate()}
            >
              {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{' '}
              {pending ? 'Editing a frame…' : 'Create edited frame'}
            </button>
            <small>
              Runs on your local Comfy engine with open weights. Creating a frame does not start a
              video render or replace your current reference.
            </small>
            {engine && !engine.ready && (
              <details className="frame-editor-install">
                <summary>
                  {engine.connected
                    ? 'Install the optional frame-editor models'
                    : 'Start the local engine to create a frame'}
                </summary>
                <p>
                  After installing the normal runtime, download this optional model profile
                  (approximately 24 GB):
                </p>
                <pre>python scripts/download-models.py --frame-edit</pre>
                {engine.missing.length > 0 && (
                  <ul>
                    {engine.missing.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </details>
            )}
            {error && (
              <p className="error-note" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="frame-recipe-notice" role="status">
                {notice}
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
            <input
              ref={input}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
