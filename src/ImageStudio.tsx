import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, ImagePlus, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react';
import type { Clip, Engine } from './domain';
import { imageBusy, imageDimensions, imageDirectionDefaults, imageDirectionOptions, imagePrompt, imageRequestSchema, type ImageGeneration, type ImageRequest } from './image-generation';
import { apiFetch, browserDemo, mediaUrl } from './transport';
import './image-studio.css';

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await apiFetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(value.error || 'The image request failed.'), { image: value.image });
  return value;
}
function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'aftertake-image-recipe.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const initial: ImageRequest = { format: 'aftertake-image/1', name: 'Above the clouds',
  prompt: 'A remote astronomical observatory on a steep rocky ridge above a sea of clouds at sunrise. A vast copper telescope dome, warm lights in the windows, tiny pine trees, distant snow peaks and a soft golden sky. A breathtaking wide establishing shot with realistic scale and rich material detail.',
  style: 'cinematic', aspect: 'landscape', seed: 5090 };

export default function ImageStudio({ images, otherBusy, onUpdate, onUse, onClose }: {
  images: ImageGeneration[]; otherBusy: boolean; onUpdate: (image: ImageGeneration) => void; onUse: (clip: Clip) => void; onClose: () => void;
}) {
  const [request, setRequest] = useState<ImageRequest>(() => { try { return imageRequestSchema.parse(JSON.parse(localStorage.getItem('aftertake-image-draft') || 'null')); } catch { return initial; } });
  const [selected, setSelected] = useState(''), [engine, setEngine] = useState<Engine | null>(null), [error, setError] = useState(''), [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLElement>(null);
  const viewed = images.find(image => image.id === selected) || images[0], pending = images.find(imageBusy);
  const busy = sending || !!pending || otherBusy, dimensions = imageDimensions(request.aspect);
  useEffect(() => { try { localStorage.setItem('aftertake-image-draft', JSON.stringify(request)); } catch { /* Storage may be unavailable. */ } }, [request]);
  useEffect(() => {
    let live = true; const previous = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    const check = () => api<Engine>('/api/engine?pipeline=image-gen').then(value => { if (live) setEngine(value); }).catch(error => { if (live) setError(error.message); });
    void check(); const interval = setInterval(check, 5000);
    return () => { live = false; clearInterval(interval); if (previous?.isConnected) previous.focus(); };
  }, []);
  function change(value: Partial<ImageRequest>) { setRequest(current => ({ ...current, ...value })); }
  async function generate() {
    setError(''); setSending(true);
    try { const image = await api<ImageGeneration>('/api/images', imageRequestSchema.parse(request)); onUpdate(image); setSelected(image.id); }
    catch (error) { const failure = error as Error & { image?: ImageGeneration }; if (failure.image) { onUpdate(failure.image); setSelected(failure.image.id); } setError(failure.message); }
    finally { setSending(false); }
  }
  async function act(image: ImageGeneration, action: 'cancel' | 'reconcile') {
    setSending(true); setError(''); try { onUpdate(await api<ImageGeneration>(`/api/images/${image.id}/${action}`, {})); } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  }
  async function importRecipe(file?: File) {
    if (!file) return; setError('');
    try { if (file.size > 2 * 1024 * 1024) throw Error('Use an image recipe under 2 MB.'); const value = JSON.parse(await file.text()); setRequest(imageRequestSchema.parse(value.request || value)); }
    catch (error) { setError((error as Error).message); }
  }
  return <div className="modal-backdrop image-studio-backdrop" onClick={onClose}><section ref={dialog} className="modal image-studio" role="dialog" aria-modal="true" aria-label="Imagine an image" onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),select:not(:disabled),a[href],summary') || [])].filter(node => node.getClientRects().length);
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  }}>
    <button className="modal-close" aria-label="Close image studio" onClick={onClose}><X size={19}/></button>
    <div className="eyebrow">TEXT → IMAGE / LOCAL Z-IMAGE TURBO</div><h2>Imagine the first frame.</h2>
    <p className="image-intro">Describe a scene, create it with open weights, then animate it in the studio. Every image keeps its seed and actual executed workflow.</p>
    <div className="image-studio-grid"><div className="image-picture-column">
      <div className="image-picture">{viewed?.clip && viewed.state === 'succeeded' ? <img src={mediaUrl(viewed.clip.url)} alt={viewed.request.name}/> : <div><ImagePlus size={34}/><p>{pending ? pending.stage || 'Creating your image…' : viewed?.error ? 'This image did not finish.' : 'A new scene starts with your words.'}</p></div>}</div>
      {viewed?.clip && viewed.state === 'succeeded' && <><div className="image-actions"><button className="button" disabled={busy} onClick={() => { onUse(viewed.clip!); onClose(); }}>Animate this image<ArrowUpRight size={14}/></button><a className="button" href={mediaUrl(viewed.clip.url)} download="aftertake-image.png"><Download size={14}/>PNG</a><button className="button" onClick={() => download({ format: 'aftertake-image/1', request: viewed.request, workflow: viewed.workflow, output: viewed.clip, jobId: viewed.jobId })}>Image recipe ↗</button></div><small>{viewed.clip.width} × {viewed.clip.height} · seed {viewed.request.seed} · {viewed.request.style} · Z-Image Turbo</small></>}
      {viewed && <div className="image-receipt"><p>{viewed.request.prompt}</p><button className="button" disabled={busy} onClick={() => setRequest(viewed.request)}><RotateCcw size={13}/>Reuse settings</button>{viewed.error && <p role="alert">{viewed.error}</p>}{['submission_unknown', 'connection_lost', 'output_error'].includes(viewed.state) && <button className="button" disabled={sending} onClick={() => void act(viewed, 'reconcile')}>Check submitted image</button>}</div>}
      {images.length > 0 && <div className="image-history" aria-label="Image history">{images.map(image => <button key={image.id} className={viewed?.id === image.id ? 'active' : ''} onClick={() => setSelected(image.id)} title={`${image.request.name} · ${image.state} · seed ${image.request.seed}`}>{image.clip && image.state === 'succeeded' ? <img src={mediaUrl(image.clip.url)} alt={image.request.name}/> : <span>{image.request.name}<small>{image.state.replaceAll('_', ' ')}</small></span>}</button>)}</div>}
    </div><div className="image-controls">
      <button className="image-recipe-import" disabled={busy} onClick={() => input.current?.click()}><Upload size={12}/>Import image recipe</button>
      <label>IMAGE NAME<input aria-label="Image name" maxLength={100} value={request.name} disabled={busy} onChange={event => change({ name: event.target.value })}/></label>
      <label>YOUR SCENE<textarea aria-label="Image prompt" rows={7} maxLength={2000} value={request.prompt} disabled={busy} onChange={event => change({ prompt: event.target.value })}/></label>
      <div className="image-settings"><label>FRAME<select aria-label="Image aspect ratio" value={request.aspect} disabled={busy} onChange={event => change({ aspect: event.target.value as ImageRequest['aspect'] })}><option value="landscape">Landscape · 3:2</option><option value="square">Square · 1:1</option><option value="portrait">Portrait · 2:3</option></select></label><label>LOOK<select aria-label="Image style" value={request.style} disabled={busy} onChange={event => change({ style: event.target.value as ImageRequest['style'] })}><option value="none">Your prompt only</option><option value="cinematic">Cinematic</option><option value="photo">Photographic</option><option value="illustration">Illustration</option><option value="product">Product</option><option value="anime">Anime</option></select></label></div>
      <fieldset className="image-direction"><legend>Compose the shot</legend>{(['shot', 'lens', 'lighting'] as const).map(key => <label key={key}>{({ shot: 'SHOT', lens: 'LENS DIRECTION', lighting: 'LIGHT' })[key]}<select aria-label={({ shot: 'Image shot', lens: 'Image lens direction', lighting: 'Image lighting' })[key]} disabled={busy} value={(request.direction || imageDirectionDefaults)[key]} onChange={event => change({ direction: { ...imageDirectionDefaults, ...request.direction, [key]: event.target.value } })}>{imageDirectionOptions[key].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}<small>These choices guide the model through your prompt. Review the image for the framing and light you want.</small></fieldset>
      <details className="image-compiled"><summary>View the exact generation prompt</summary><p>{imagePrompt(request)}</p></details>
      <label>SEED<div className="image-seed"><input aria-label="Image seed" type="number" min={0} max={2 ** 32 - 1} step={1} value={request.seed} disabled={busy} onChange={event => { const seed = Number(event.target.value); if (Number.isInteger(seed)) change({ seed: Math.max(0, Math.min(2 ** 32 - 1, seed)) }); }}/><button className="button" disabled={busy} aria-label="New image seed" onClick={() => change({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })}><RotateCcw size={14}/></button></div></label>
      <button className="button image-generate" disabled={browserDemo || busy || !engine?.ready || !imageRequestSchema.safeParse(request).success} onClick={() => void generate()}>{pending ? <LoaderCircle size={15} className="spin"/> : <ImagePlus size={15}/>} {pending ? 'Creating image…' : 'Create image'}</button>
      <small>{dimensions[0]} × {dimensions[1]} · 8 steps · your local engine. Look choices add wording to the actual prompt.</small>
      {pending && <div className="image-progress" role="status"><strong>{pending.stage || pending.state.replaceAll('_', ' ')}</strong>{pending.progress !== null && <span>{Math.round(pending.progress * 100)}%</span>}{pending.jobId && pending.state !== 'finalizing' && <button disabled={sending} onClick={() => void act(pending, 'cancel')}>Cancel image</button>}</div>}
      {otherBusy && !pending && <p className="image-install">Another generation is active. You can review images while it finishes.</p>}
      {browserDemo ? <p className="image-install">Image generation runs in your local Aftertake studio. Download the source and install the optional Z-Image profile to create new images.</p> : engine && !engine.ready && <details className="image-install" open><summary>{engine.connected ? 'Install the image model profile' : 'Start your local engine'}</summary><p>After installing the runtime, download the public Apache-2.0 Z-Image Turbo profile (20.7 GB):</p><pre>python scripts/download-models.py --image-gen</pre><p>Start the engine with <code>python scripts/engine.py</code>.</p>{engine.missing.map(item => <small key={item}>{item}<br/></small>)}</details>}
      {error && <p role="alert">{error}</p>}
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={event => { void importRecipe(event.target.files?.[0]); event.target.value = ''; }}/>
    </div></div>
  </section></div>;
}
