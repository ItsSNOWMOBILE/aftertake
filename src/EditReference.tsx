import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ImagePlus, LoaderCircle, Maximize2, Sparkles, Upload, X } from 'lucide-react';
import { editReferenceIssue, type Clip, type Recipe } from './domain';

export default function EditReference({ recipe, clips, disabled, onImport, onChange, onCreate, creating, canCreate }: {
  recipe: Recipe; clips: Clip[]; disabled: boolean; onImport: (clip: Clip) => void;
  onChange: (reference: Recipe['editReference']) => void;
  onCreate: () => void; creating: boolean; canCreate: boolean;
}) {
  const [uploading, setUploading] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const input = useRef<HTMLInputElement>(null), close = useRef<HTMLButtonElement>(null), inspect = useRef<HTMLButtonElement>(null);
  const reference = recipe.editReference;
  useEffect(() => { if (inspecting) close.current?.focus(); }, [inspecting]);
  function dismiss() { setInspecting(false); inspect.current?.focus(); }
  function choose(clip?: Clip) {
    setError('');
    if (!clip) { onChange(undefined); return; }
    const issue = editReferenceIssue(recipe.clip, clip);
    if (issue) { setError(issue); return; }
    onChange({ ...clip, kind: 'image' });
  }
  async function upload(file?: File) {
    if (!file) return;
    setError(''); setUploading(true);
    try {
      if (file.size > 100 * 1024 * 1024) throw Error('Use an image under 100 MB.');
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw Error('Choose a PNG, JPEG or WebP image.');
      const response = await fetch(`/api/clips?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const clip = await response.json();
      if (!response.ok) throw Error(clip.error || 'Could not import the edited first frame.');
      onImport(clip); choose(clip);
    } catch (error) { setError((error as Error).message); }
    finally { setUploading(false); }
  }
  async function exportFrame() {
    setError(''); setExporting(true);
    try {
      const response = await fetch(`/api/clips/${recipe.clip.id}/frame?time=${recipe.trimStart}`);
      if (!response.ok) { const body = await response.json(); throw Error(body.error || 'Could not export the starting frame.'); }
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'aftertake-starting-frame.png'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError((error as Error).message); }
    finally { setExporting(false); }
  }
  return <section className="edit-reference" aria-label="Edited first frame">
    <div className="edit-reference-heading"><ImagePlus size={14}/><strong>Edited first frame</strong><span>OPTIONAL</span></div>
    <p>Show the change in a full-frame edit of this shot. Keep the same composition and paint enough room for the new object.</p>
    <button className="reference-create" disabled={!canCreate} onClick={onCreate}><Sparkles size={12}/>{creating ? 'Review frame edit…' : 'Create an edited frame'}</button>
    <button className="reference-export" disabled={disabled || exporting} onClick={() => void exportFrame()}>{exporting ? <LoaderCircle size={12} className="spin"/> : <ArrowDownToLine size={12}/>} {exporting ? 'Extracting frame…' : 'Export starting frame'}</button>
    {reference && <div className="reference-asset"><button ref={inspect} title="Inspect edited first frame" onClick={() => setInspecting(true)}><img src={reference.url} alt="Edited full frame guiding the masked region"/><Maximize2 size={13}/></button><span title={reference.name}>{reference.name}</span><button title="Remove edited first frame" disabled={disabled || uploading} onClick={() => choose()}><X size={14}/></button></div>}
    <div className="reference-picker"><select aria-label="Choose an edited first frame" value={reference?.id || ''} disabled={disabled || uploading} onChange={event => choose(clips.find(clip => clip.id === event.target.value))}><option value="">{reference ? 'No edited frame' : 'Choose an imported image…'}</option>{clips.filter(clip => clip.kind === 'image').map(clip => <option key={clip.id} value={clip.id}>{clip.name}</option>)}</select><button disabled={disabled || uploading} title={reference ? 'Replace edited first frame' : 'Upload edited first frame'} onClick={() => input.current?.click()}>{uploading ? <LoaderCircle size={14} className="spin"/> : <Upload size={14}/>}</button></div>
    <small>{reference ? 'Conditions the opening frame in every generation stage. The cue still controls what appears in the final video.' : 'Export, edit, then upload. Reference consistency varies by scene.'}</small>
    {error && <p className="error-note" role="alert">{error}</p>}
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/>
    {inspecting && reference && <div className="modal-backdrop" onClick={dismiss}><section className="modal reference-modal" role="dialog" aria-modal="true" aria-label="Inspect edited first frame" onClick={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') dismiss(); if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); } }}><button ref={close} className="modal-close" title="Close edited first frame" onClick={dismiss}><X size={19}/></button><div className="eyebrow">APPEARANCE REFERENCE</div><h2>Your edited first frame.</h2><img src={reference.url} alt="Full-resolution edited first frame"/><p>This image guides generation. The source video still supplies motion and the painted cue controls the final composite.</p></section></div>}
  </section>;
}
