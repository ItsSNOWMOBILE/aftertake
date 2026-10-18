import { apiFetch, browserDemo, mediaUrl } from './transport';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { editReferenceIssue, renderDimensions, type Clip, type Recipe } from './domain';

export default function EditReference({
  recipe,
  clips,
  disabled,
  onImport,
  onChange,
  onCreate,
  creating,
  canCreate,
  purpose = 'edit',
}: {
  recipe: Recipe;
  clips: Clip[];
  disabled: boolean;
  onImport: (clip: Clip) => void;
  onChange: (reference: Recipe['editReference']) => void;
  onCreate: () => void;
  creating: boolean;
  canCreate: boolean;
  purpose?: 'edit' | 'end' | 'motion';
}) {
  const [uploading, setUploading] = useState(false),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    close = useRef<HTMLButtonElement>(null),
    inspect = useRef<HTMLButtonElement>(null);
  const ending = purpose === 'end',
    motion = purpose === 'motion';
  const reference = motion
    ? recipe.transfer?.reference
    : ending
      ? recipe.endFrame
      : recipe.editReference;
  const label = motion ? 'Appearance image' : ending ? 'Ending frame' : 'Edited first frame';
  let aspect = recipe.clip.width / recipe.clip.height;
  if (motion) {
    try {
      const d = renderDimensions(recipe);
      aspect = d.width / d.height;
    } catch {}
  }
  useEffect(() => {
    if (inspecting) close.current?.focus();
  }, [inspecting]);
  function dismiss() {
    setInspecting(false);
    inspect.current?.focus();
  }
  function choose(clip?: Clip) {
    setError('');
    if (!clip) {
      onChange(undefined);
      return;
    }
    const issue = motion
      ? clip.kind === 'image'
        ? null
        : 'Choose a still image.'
      : editReferenceIssue(recipe.clip, clip);
    if (issue) {
      setError(
        ending ? 'Choose an ending image with the same aspect ratio as the starting frame.' : issue,
      );
      return;
    }
    onChange({ ...clip, kind: 'image' });
  }
  async function upload(file?: File) {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      if (file.size > 100 * 1024 * 1024) throw Error('Use an image under 100 MB.');
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw Error('Choose a PNG, JPEG or WebP image.');
      const response = await apiFetch(`/api/clips?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const clip = await response.json();
      if (!response.ok) throw Error(clip.error || `Could not import the ${label.toLowerCase()}.`);
      onImport(clip);
      choose(clip);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function exportFrame() {
    setError('');
    setExporting(true);
    try {
      const response = await apiFetch(
        `/api/clips/${recipe.clip.id}/frame?time=${recipe.trimStart}`,
      );
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.error || 'Could not export the starting frame.');
      }
      const url = URL.createObjectURL(await response.blob()),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'aftertake-starting-frame.png';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="edit-reference" aria-label={label}>
      <div className="edit-reference-heading">
        <ImagePlus size={14} />
        <strong>{label}</strong>
        <span>{motion ? 'REQUIRED' : 'OPTIONAL'}</span>
      </div>
      <p>
        {motion
          ? 'Choose the character and scene to animate. Match the driving shot’s framing and leave room for the full gesture.'
          : ending
            ? 'Give the shot a destination. Choose or create an image with the same aspect ratio, then describe the motion between the two frames.'
            : 'Show the change in a full-frame edit of this shot. Keep the same composition and paint enough room for the new object.'}
      </p>
      <button className="reference-create" disabled={!canCreate} onClick={onCreate}>
        <Sparkles size={12} />
        {creating
          ? 'Review frame edit…'
          : motion
            ? 'Create an appearance'
            : ending
              ? 'Create an ending frame'
              : 'Create an edited frame'}
      </button>
      <button
        className="reference-export"
        disabled={disabled || exporting || browserDemo}
        onClick={() => void exportFrame()}
      >
        {exporting ? <LoaderCircle size={12} className="spin" /> : <ArrowDownToLine size={12} />}{' '}
        {exporting ? 'Extracting frame…' : 'Export starting frame'}
      </button>
      {reference && (
        <div className="reference-asset">
          <button
            ref={inspect}
            title={`Inspect ${label.toLowerCase()}`}
            onClick={() => setInspecting(true)}
          >
            <img
              src={mediaUrl(reference.url)}
              alt={
                motion
                  ? 'Appearance guiding the animated character and scene'
                  : ending
                    ? 'Image guiding the final moment'
                    : 'Edited full frame guiding the masked region'
              }
            />
            <Maximize2 size={13} />
          </button>
          <span title={reference.name}>{reference.name}</span>
          <button
            title={`Remove ${label.toLowerCase()}`}
            disabled={disabled || uploading}
            onClick={() => choose()}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="reference-picker">
        <select
          aria-label={
            motion
              ? 'Choose an appearance image'
              : ending
                ? 'Choose an ending frame'
                : 'Choose an edited first frame'
          }
          value={reference?.id || ''}
          disabled={disabled || uploading}
          onChange={(event) => choose(clips.find((clip) => clip.id === event.target.value))}
        >
          <option value="">
            {reference
              ? motion
                ? 'No appearance image'
                : ending
                  ? 'No ending frame'
                  : 'No edited frame'
              : 'Choose an imported image…'}
          </option>
          {clips
            .filter((clip) => clip.kind === 'image')
            .map((clip) => (
              <option key={clip.id} value={clip.id}>
                {clip.name}
              </option>
            ))}
        </select>
        <button
          disabled={disabled || uploading || browserDemo}
          title={`${reference ? 'Replace' : 'Upload'} ${label.toLowerCase()}`}
          onClick={() => input.current?.click()}
        >
          {uploading ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}
        </button>
      </div>
      <small>
        {motion
          ? 'The image is center-cropped to the driving video’s aspect ratio without stretching. Body proportions and motion can vary; review a short take.'
          : ending
            ? 'Both images guide generation. The final frame can vary from the reference; review the result.'
            : reference
              ? 'Conditions the opening frame in every generation stage. The cue still controls what appears in the final video.'
              : 'Export, edit, then upload. Reference consistency varies by scene.'}
      </small>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
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
      {inspecting && reference && (
        <div className="modal-backdrop" onClick={dismiss}>
          <section
            className="modal reference-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Inspect ${label.toLowerCase()}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') dismiss();
              if (event.key === 'Tab') {
                event.preventDefault();
                close.current?.focus();
              }
            }}
          >
            <button
              ref={close}
              className="modal-close"
              title={`Close ${label.toLowerCase()}`}
              onClick={dismiss}
            >
              <X size={19} />
            </button>
            <div className="eyebrow">{ending ? 'THE FINAL MOMENT' : 'APPEARANCE REFERENCE'}</div>
            <h2>Your {label.toLowerCase()}.</h2>
            <>
              {motion ? (
                <div
                  className="motion-reference-crop"
                  style={{
                    aspectRatio: String(aspect),
                    width: `min(100%, calc(58vh * ${aspect}))`,
                  }}
                >
                  <img
                    src={mediaUrl(reference.url)}
                    alt="Appearance center crop used for motion transfer"
                  />
                </div>
              ) : (
                <img src={mediaUrl(reference.url)} alt={`Full-resolution ${label.toLowerCase()}`} />
              )}
            </>
            <p>
              {motion
                ? 'This preview shows the center crop used for generation. The driving video supplies motion; this image supplies appearance. Match the pose and leave room for the full gesture.'
                : ending
                  ? 'The model generates the motion between your starting frame and this image. This is a soft image constraint, so the finished take can differ.'
                  : 'This image guides generation. The source video still supplies motion and the painted cue controls the final composite.'}
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
