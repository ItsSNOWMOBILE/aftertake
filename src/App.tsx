import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, AudioLines, Brush, Check, ChevronDown, CircleHelp, Clapperboard, Download, Film, FolderOpen, Layers2, LoaderCircle, Maximize2, Pause, Play, Plus, Redo2, RotateCcw, Settings2, Share2, SlidersHorizontal, Sparkles, Square, Undo2, Upload, X } from 'lucide-react';
import { cueEnvelope, presets, recipeSchema, renderDimensions, type Clip, type Engine, type Recipe, type Render, type Stroke } from './domain';
import './style.css';
import { spatialMask } from './mask';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const defaultCue = { start: .4, end: 2.9, fade: .4, feather: .055, strokes: [] as Stroke[] };
const makeRecipe = (clip: Clip): Recipe => {
  const r: Recipe = { format: 'aftertake/1', name: 'An ordinary place, otherwise', clip,
    prompt: presets[0].prompt, cue: structuredClone(defaultCue), seed: 42, quality: 'draft', trimStart: 0 };
  r.cue.end = Math.min(r.cue.end, renderDimensions(r).duration);
  return r;
};
const timecode = (seconds: number) => `${Math.floor(seconds).toString().padStart(2, '0')}:${Math.floor((seconds % 1) * 24).toString().padStart(2, '0')}`;
const isBusy = (state: string) => ['submitting', 'queued', 'running', 'canceling', 'connection_lost'].includes(state);

export default function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [engine, setEngine] = useState<Engine>({ connected: false, ready: false, missing: [], message: 'Checking local engine…' });
  const [renders, setRenders] = useState<Render[]>([]);
  const [take, setTake] = useState<Render | null>(null);
  const [mode, setMode] = useState<'source' | 'cue' | 'result' | 'compare'>('cue');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [radius, setRadius] = useState(.13);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [toast, setToast] = useState('');
  const [engineOpen, setEngineOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [compare, setCompare] = useState(50);
  const [trackedPreview, setTrackedPreview] = useState<HTMLImageElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewSerial = useRef(0);
  const video = useRef<HTMLVideoElement>(null);
  const outputVideo = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recipeInput = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const recipeRef = useRef(recipe); recipeRef.current = recipe;

  useEffect(() => {
    api<Clip[]>('/api/clips').then(found => {
      setClips(found);
      let saved: Recipe | null = null;
      try { saved = recipeSchema.parse(JSON.parse(localStorage.getItem('aftertake-project') || 'null')); } catch {}
      if (saved && found.some(c => c.id === saved!.clip.id)) setRecipe(saved);
      else if (found[0]) setRecipe(makeRecipe(found[0]));
    }).catch(error => setToast(error.message));
    api<Render[]>('/api/renders').then(setRenders).catch(error => setToast(error.message));
  }, []);
  useEffect(() => {
    let current = true;
    setEngine({ connected: false, ready: false, missing: [], message: 'Checking the selected workflow…' });
    const check = () => api<Engine>(`/api/engine?pipeline=${recipe?.pipeline || 'structure'}`).then(value => { if (current) setEngine(value); }).catch(() => {});
    void check(); const interval = setInterval(check, 5000);
    return () => { current = false; clearInterval(interval); };
  }, [recipe?.pipeline]);
  useEffect(() => {
    if (recipe) localStorage.setItem('aftertake-project', JSON.stringify(recipe));
  }, [recipe]);
  useEffect(() => { if (toast) { const timeout = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timeout); } }, [toast]);
  useEffect(() => {
    if (!take || !isBusy(take.state)) return;
    const interval = setInterval(() => {
      api<Render>(`/api/renders/${take.id}`).then(updated => {
        setTake(updated); setRenders(all => all.map(r => r.id === updated.id ? updated : r));
        if (updated.state === 'succeeded') { setMode('compare'); setToast('Your take is ready. Scrub or play to compare it with the source.'); }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [take?.id, take?.state]);
  useEffect(() => {
    if (!playing) return;
    let raf: number;
    const tick = () => {
      if (video.current) {
        setTime(Math.max(0, video.current.currentTime - (recipeRef.current?.trimStart || 0)));
        if (outputVideo.current && Math.abs(outputVideo.current.currentTime - (video.current.currentTime - (recipeRef.current?.trimStart || 0))) > .08) {
          outputVideo.current.currentTime = Math.max(0, video.current.currentTime - (recipeRef.current?.trimStart || 0));
        }
      }
      raf = requestAnimationFrame(tick);
    }; raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const change = (partial: Partial<Recipe>) => setRecipe(r => r ? { ...r, ...partial } : r);
  let dimensions = { width: 512, height: 320, fps: 16, frames: 49, duration: 49 / 16 };
  if (recipe) { try { dimensions = renderDimensions(recipe); } catch {} }
  const duration = dimensions.duration;
  const envelope = recipe ? cueEnvelope(time, recipe.cue) : 0;
  const spatialPreview = useMemo(() => recipe ? spatialMask(dimensions.width, dimensions.height, recipe.cue) : null,
    [recipe?.cue.strokes, recipe?.cue.feather, dimensions.width, dimensions.height]);
  const previewKey = JSON.stringify([recipe?.clip.id, recipe?.cue, recipe?.trimStart, recipe?.quality]);
  useEffect(() => { previewSerial.current++; setTrackedPreview(null); }, [previewKey]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !recipe || mode !== 'cue') return;
    const width = dimensions.width, height = dimensions.height;
    el.width = width; el.height = height;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    if (trackedPreview && recipe.cue.tracking === 'flow') {
      const index = Math.min(dimensions.frames - 1, Math.floor(time * dimensions.fps));
      ctx.globalAlpha = .5;
      ctx.drawImage(trackedPreview, (index % 8) * width, Math.floor(index / 8) * height, width, height, 0, 0, width, height);
      ctx.globalAlpha = 1;
      return;
    }
    if (spatialPreview) {
      const pixels = new Uint8ClampedArray(spatialPreview);
      // A faint ghost keeps inactive paint editable. The label states actual strength.
      for (let i = 3; i < pixels.length; i += 4) pixels[i] *= .16 + .35 * envelope;
      ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    }
  }, [spatialPreview, trackedPreview, time, envelope, mode, dimensions.width, dimensions.height]);

  function seek(value: number) {
    setTime(value);
    if (video.current) video.current.currentTime = value + (recipe?.trimStart || 0);
    if (outputVideo.current) outputVideo.current.currentTime = value;
  }
  async function togglePlay() {
    if (!video.current) return;
    if (playing) { video.current.pause(); outputVideo.current?.pause(); setPlaying(false); }
    else {
      if (time >= duration - .1) seek(0);
      try { await video.current.play(); if (outputVideo.current) await outputVideo.current.play(); setPlaying(true); }
      catch { setToast('Playback could not start. Try seeking to the beginning.'); }
    }
  }
  useEffect(() => {
    if (time >= duration && playing) { video.current?.pause(); outputVideo.current?.pause(); setPlaying(false); seek(0); }
  }, [time, duration, playing]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) return;
      if (event.code === 'Space') { event.preventDefault(); void togglePlay(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') { event.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  function undo() {
    setRecipe(r => { if (!r || !r.cue.strokes.length) return r; setRedo(all => [...all, r.cue.strokes.at(-1)!]); return { ...r, cue: { ...r.cue, strokes: r.cue.strokes.slice(0, -1) } }; });
  }
  function pointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
  }
  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!recipe || mode !== 'cue') return;
    if (recipe.cue.tracking === 'flow' && recipe.cue.strokes.length && Math.abs(time - (recipe.cue.anchor || 0)) > 1 / dimensions.fps) {
      seek(recipe.cue.anchor || 0); setToast('Returned to the anchor frame. Paint here to edit the tracked region.'); return;
    }
    video.current?.pause(); outputVideo.current?.pause(); setPlaying(false);
    event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; setRedo([]);
    const point = pointer(event);
    setRecipe(r => r ? { ...r, cue: { ...r.cue, anchor: r.cue.strokes.length ? r.cue.anchor : Math.min(time, duration - 1 / dimensions.fps), strokes: [...r.cue.strokes, { points: [point], radius }] } } : r);
  }
  function extendStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const point = pointer(event);
    setRecipe(r => {
      if (!r) return r;
      const strokes = [...r.cue.strokes], last = strokes.at(-1)!;
      if (last.points.length >= 300) return r;
      strokes[strokes.length - 1] = { ...last, points: [...last.points, point] };
      return { ...r, cue: { ...r.cue, strokes } };
    });
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { setToast('Use a video smaller than 100 MB.'); return; }
    setUploading(true);
    try {
      const clip = await api<Clip>(`/api/clips?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      setClips(all => [...all, clip]); setRecipe(makeRecipe(clip)); setTake(null); setTime(0); setMode('cue');
      setToast('Source imported. Paint the part of the shot you want to transform.');
    } catch (error) { setToast((error as Error).message); } finally { setUploading(false); }
  }
  async function previewMotion() {
    if (!recipe) return;
    const serial = previewSerial.current;
    setPreviewing(true);
    try {
      const result = await api<{ url: string }>('/api/cue-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipe) });
      const img = new Image(); img.src = result.url; await img.decode();
      if (serial === previewSerial.current) { setTrackedPreview(img); setToast('Motion preview ready. Scrub the timeline to inspect the actual render mask.'); }
    } catch (error) { setToast((error as Error).message); } finally { setPreviewing(false); }
  }
  async function render() {
    if (!recipe) return;
    if (!recipe.cue.strokes.length) { setToast('Paint a region on the shot before rendering.'); return; }
    setRendering(true);
    try {
      const result = await api<Render>('/api/renders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipe) });
      setTake(result); setRenders(all => [result, ...all]);
    } catch (error) { setToast((error as Error).message); } finally { setRendering(false); }
  }
  async function exportWorkflow() {
    if (!recipe) return;
    try { download('aftertake-workflow-api.json', await api('/api/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipe) })); }
    catch (error) { setToast((error as Error).message); }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    try {
      const value = recipeSchema.parse(JSON.parse(await file.text()));
      const found = clips.find(c => c.sha256 === value.clip.sha256);
      if (!found) throw new Error(`Import the matching source video first: ${value.clip.name}`);
      setRecipe({ ...value, clip: found }); setTake(null); seek(0); setMode('cue'); setToast('Recipe loaded. Every cue and setting is editable.');
    } catch (error) { setToast((error as Error).message); }
  }
  const hasOutput = Boolean(take?.output);
  const busy = rendering || Boolean(take && isBusy(take.state));
  const selectedPreset = presets.find(p => p.prompt === recipe?.prompt);

  return <div className="app-shell">
    <aside className="rail" aria-label="Studio navigation">
      <div className="brand-mark" aria-label="Aftertake">a<span>↗</span></div>
      <button className="rail-button selected" title="Studio" onClick={() => setMode('cue')}><Clapperboard size={21}/></button>
      <button className="rail-button" title="Import source" onClick={() => fileInput.current?.click()}><FolderOpen size={21}/></button>
      <button className="rail-button" title="Import a recipe" onClick={() => recipeInput.current?.click()}><Layers2 size={21}/></button>
      <div className="rail-bottom"><button className="rail-button" title="Engine settings" onClick={() => setEngineOpen(true)}><Settings2 size={20}/></button><button className="rail-button" title="How it works" onClick={() => setHelpOpen(true)}><CircleHelp size={20}/></button><div className="avatar">J</div></div>
    </aside>
    <header className="header">
      <div className="wordmark">aftertake<span>OPEN STUDIO</span></div>
      <div className="breadcrumb"><span>Workspace</span><span>/</span><input className="project-name" aria-label="Project name" value={recipe?.name || "Untitled film"} disabled={!recipe} maxLength={100} onChange={e => change({ name: e.target.value })}/><ChevronDown size={13}/></div>
      <div className="header-actions"><button className="engine-chip" onClick={() => setEngineOpen(true)}><i className={engine.ready ? 'dot ready' : 'dot'}/>{engine.ready ? 'Local engine ready' : engine.connected ? 'Installing models' : 'Local engine offline'}</button><button className="button subtle" disabled={!recipe} onClick={() => { if (recipe) { download('aftertake-recipe.json', recipe); setToast('Recipe exported. Share it with its source video to let someone remix your take.'); } }}><Share2 size={15}/>Share recipe</button></div>
    </header>
    <aside className="library">
      <div className="library-heading"><span>YOUR PROJECT</span><button title="Import video" onClick={() => fileInput.current?.click()}><Plus size={17}/></button></div>
      <div className="project-title"><div className="project-icon"><Film size={20}/></div><div><strong title={recipe?.name}>{recipe?.name || "Untitled film"}</strong><small>Saved on this device</small></div></div>
      <div className="section-label">SOURCE MATERIAL <span>{clips.length.toString().padStart(2, '0')}</span></div>
      {clips.map(clip => <button className={`source-card ${recipe?.clip.id === clip.id ? 'active' : ''}`} key={clip.id} onClick={() => { setRecipe(makeRecipe(clip)); setTake(null); setTime(0); setMode('cue'); }}>
        <div className="source-thumb"><video src={`${clip.url}#t=1`} preload="metadata" muted/><span>{clip.duration.toFixed(1)}s</span></div><strong>{clip.name.replace(/\.[^.]+$/, '')}</strong><small>{clip.width} × {clip.height} · source video</small>
      </button>)}
      <button className="import-source" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle size={16} className="spin"/> : <Plus size={16}/>} {uploading ? 'Importing…' : 'Import a clip'}</button>
      <div className="section-label looks-label">LOOK EXPLORATIONS <Sparkles size={12}/></div>
      <p className="library-description">A different world.<br/>The same moment.</p>
      {presets.map((preset, idx) => <button key={preset.id} className={`look-card ${preset.id} ${selectedPreset?.id === preset.id ? 'active' : ''}`} onClick={() => change({ prompt: preset.prompt })} disabled={!recipe}>
        <div className="look-art"><div className="orb one"/><div className="orb two"/><span className="look-number">0{idx + 1}</span><ArrowUpRight size={17}/></div><div className="look-caption"><strong>{preset.name}</strong><span>{selectedPreset?.id === preset.id ? <Check size={13}/> : preset.tag}</span></div>
      </button>)}
      <div className="library-foot"><i className="tiny-star">✳</i><p>Make a take.<br/><span>Let someone make it theirs.</span></p></div>
    </aside>
    <main className="workspace">
      <div className="workspace-title"><div><div className="eyebrow">THE DIRECTOR’S DESK <span>01 / COMPOSE</span></div><h1>Direct the impossible<span>.</span></h1></div><button className="icon-button" title="How it works" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/></button></div>
      <div className="viewer-toolbar"><div className="view-tabs">{(['source', 'cue', 'result', 'compare'] as const).map(value => <button key={value} className={mode === value ? 'active' : ''} disabled={['result', 'compare'].includes(value) && !hasOutput} onClick={() => setMode(value)}>{value === 'cue' ? <Brush size={13}/> : value === 'compare' ? <ArrowLeftRight size={13}/> : null}{value === 'cue' ? 'Cue canvas' : value[0].toUpperCase() + value.slice(1)}</button>)}</div><span className="viewer-meta">{dimensions.width} × {dimensions.height}<span> · </span>{dimensions.fps} FPS</span></div>
      <div className="viewer" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}>
        <div className="frame-corner tl"/><div className="frame-corner tr"/><div className="frame-corner bl"/><div className="frame-corner br"/>
        {recipe ? <div className={`shot-frame ${mode === 'cue' ? 'paint-mode' : ''}`} ref={frame} style={{ aspectRatio: `${recipe.clip.width}/${recipe.clip.height}`, maxWidth: `calc(52vh * ${recipe.clip.width / recipe.clip.height})` }}>
          <video ref={video} src={recipe.clip.url} muted playsInline preload="auto" onLoadedMetadata={() => seek(0)} onEnded={() => setPlaying(false)} className={mode === 'result' ? 'hidden-source' : ''}/>
          {hasOutput && (mode === 'result' || mode === 'compare') && <video ref={outputVideo} src={take!.output} muted playsInline preload="auto" className="result-video" style={mode === 'compare' ? { clipPath: `inset(0 ${100 - compare}% 0 0)` } : {}}/>}
          {mode === 'cue' && <canvas ref={canvas} onPointerDown={beginStroke} onPointerMove={extendStroke} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }}/>}
          {mode === 'cue' && !recipe.cue.strokes.length && <div className="paint-hint"><div><Brush size={21}/></div><strong>Where does the impossible begin?</strong><span>Paint a region directly on your shot.</span></div>}
          <div className="shot-label">{mode === 'source' ? 'SOURCE / ORIGINAL' : mode === 'cue' ? 'SPATIAL CUE / EDITABLE' : mode === 'compare' ? 'AFTERTAKE / SOURCE' : 'AFTERTAKE / RENDERED'}</div>
          <div className="shot-time">{timecode(time)}</div>
          {mode === 'cue' && recipe.cue.strokes.length > 0 && <span className="cue-strength">{envelope > 0 ? `EFFECT ${Math.round(envelope * 100)}%` : 'EFFECT INACTIVE · EDITING REGION'}</span>}
          {mode === 'compare' && <div className="compare-line" style={{ left: `${compare}%` }}><span><ArrowLeftRight size={16}/></span></div>}
          {mode === 'compare' && <input className="comparison" type="range" aria-label="Before and after split" min="0" max="100" value={compare} onChange={e => setCompare(Number(e.target.value))}/>}
        </div> : <button className="empty-view" onClick={() => fileInput.current?.click()}><Upload size={32}/><h2>Every impossible shot starts somewhere.</h2><p>Drop a video here, or choose a clip to begin.</p><span>MP4, MOV, WebM · up to 100 MB</span></button>}
        <div className="viewer-bottom"><span><i className="dot ready"/> {mode === 'cue' ? 'Paint to transform · everything else stays' : 'Your source. Your direction.'}</span><button title="Fullscreen viewer" onClick={() => frame.current?.requestFullscreen()}><Maximize2 size={15}/></button></div>
      </div>
      <div className="transport"><div className="transport-left"><button title="Return to start" onClick={() => seek(0)}><RotateCcw size={15}/></button><button className="play-button" title={playing ? 'Pause' : 'Play'} disabled={!recipe} onClick={() => void togglePlay()}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><span>{timecode(time)}<b>/</b>{timecode(duration)}</span></div><div className="brush-tools"><button title="Undo stroke" disabled={!recipe?.cue.strokes.length} onClick={undo}><Undo2 size={16}/></button><button title="Redo stroke" disabled={!redo.length} onClick={() => { if (!recipe || !redo.length) return; change({ cue: { ...recipe.cue, strokes: [...recipe.cue.strokes, redo.at(-1)!] } }); setRedo(all => all.slice(0, -1)); }}><Redo2 size={16}/></button><i/><Brush size={14}/><label>Size<input type="range" min=".02" max=".3" step=".005" value={radius} aria-label="Brush radius" onChange={e => setRadius(Number(e.target.value))}/></label><button title="Clear painted region" disabled={!recipe?.cue.strokes.length} onClick={() => { if (recipe) change({ cue: { ...recipe.cue, strokes: [] } }); }}><X size={15}/></button></div></div>
      <section className="timeline" aria-label="Shot timeline"><div className="timeline-head"><div><AudioLines size={15}/><strong>THE MOMENT IT CHANGES</strong></div><span>Drag time. Shape the transformation.</span></div><div className="ruler">{Array.from({ length: 7 }, (_, i) => <span key={i}>{(duration * i / 6).toFixed(1)}s</span>)}</div><div className="timeline-track"><div className="track-label"><Film size={13}/>SOURCE</div><div className="film-track">{Array.from({ length: 10 }, (_, i) => <div key={i} className="film-cell">{recipe && <video src={`${recipe.clip.url}#t=${recipe.trimStart + duration * i / 10}`} preload="metadata" muted/>}</div>)}</div></div><div className="timeline-track"><div className="track-label"><Sparkles size={13}/>EFFECT</div><div className="effect-track">{recipe && <div className="effect-block" style={{ left: `${recipe.cue.start / duration * 100}%`, width: `${Math.max(0, Math.min(recipe.cue.end, duration) - recipe.cue.start) / duration * 100}%` }}><span>⋮</span><strong>{selectedPreset?.name || 'Custom direction'}</strong><span>⋮</span></div>}</div></div><input className="scrubber" type="range" min="0" max={duration} step={1 / dimensions.fps} value={Math.min(time, duration)} aria-label="Timeline playhead" onChange={e => seek(Number(e.target.value))}/></section>
      <section className="takes"><div className="takes-title"><span>TAKES <b>{renders.length.toString().padStart(2, '0')}</b></span><span>Every experiment belongs here.</span></div>{renders.length ? <div className="take-list">{renders.map((render, index) => <button key={render.id} className={take?.id === render.id ? 'take active' : 'take'} onClick={() => { setTake(render); setRecipe(render.recipe); setMode(render.output ? 'compare' : 'cue'); seek(0); }}><span className="take-index">{String(renders.length - index).padStart(2, '0')}</span><div><strong>{render.recipe.name}</strong><small>{render.recipe.quality} · seed {render.recipe.seed}</small></div><span className={`take-state ${render.state}`}>{render.state.replaceAll('_', ' ')}</span></button>)}</div> : <div className="no-takes"><Clapperboard size={19}/><span>Your first take is waiting to happen.</span><span>Paint → Direct → Render</span></div>}</section>
    </main>
    <aside className="inspector"><div className="inspector-title"><SlidersHorizontal size={16}/><strong>Shot direction</strong><span>01</span></div><div className="inspector-body"><div className="step-label"><b>01</b><span>MAKE IT YOURS</span></div><h2>A little direction.<br/>A different reality.</h2><p className="inspector-intro">Tell the painted part of your shot what to become.</p><label className="input-label" htmlFor="direction">YOUR DIRECTION <Sparkles size={12}/></label><textarea id="direction" value={recipe?.prompt || ''} disabled={!recipe} onChange={e => change({ prompt: e.target.value })} placeholder="A wall of living moss. A pool of molten gold. What happens here?" maxLength={2000}/><div className="prompt-footer"><span>Movement comes from your source.</span><span>{recipe?.prompt.length || 0}</span></div><div className="divider"/><div className="step-label"><b>02</b><span>CHOOSE THE MOMENT</span></div><div className="time-controls"><label>Begins at<input type="number" aria-label="Effect start" min="0" max={Math.max(0, (recipe?.cue.end || duration) - .1)} step=".1" value={recipe?.cue.start || 0} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, start: Math.min(Number(e.target.value), recipe.cue.end - .1) } }); }}/><span>seconds</span></label><label>Ends at<input type="number" aria-label="Effect end" min={(recipe?.cue.start || 0) + .1} max={duration} step=".1" value={recipe?.cue.end || 0} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, end: Math.max(recipe.cue.start + .1, Math.min(duration, Number(e.target.value))) } }); }}/><span>seconds</span></label></div><label className="slider-label">Ease in & out<span>{recipe?.cue.fade.toFixed(1)}s</span><input type="range" min="0" max="1.2" step=".05" value={recipe?.cue.fade || 0} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, fade: Number(e.target.value) } }); }}/></label><label className="slider-label">Blend the edges<span>{Math.round((recipe?.cue.feather || 0) * 100)}%</span><input type="range" min=".005" max=".15" step=".005" value={recipe?.cue.feather || .055} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, feather: Number(e.target.value) } }); }}/></label><div className="tracking-control"><label><input type="checkbox" checked={recipe?.cue.tracking === 'flow'} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, tracking: e.target.checked ? 'flow' : 'static' } }); }}/><span>Follow source motion</span><span className="beta-tag">BETA</span></label><p>{recipe?.cue.tracking === 'flow' ? `Anchored at ${timecode(recipe.cue.anchor || 0)}. Preview the tracked cue before rendering.` : 'The painted region stays fixed in the frame.'}</p>{recipe?.cue.tracking === 'flow' && <button disabled={previewing || !recipe.cue.strokes.length} onClick={() => void previewMotion()}>{previewing ? <LoaderCircle size={12} className="spin"/> : trackedPreview ? <Check size={12}/> : <Play size={12}/>} {previewing ? 'Tracking on CPU…' : trackedPreview ? 'Tracked preview ready' : 'Preview motion'}</button>}</div><div className="divider"/><div className="step-label"><b>03</b><span>MAKE A TAKE</span></div><label className="pipeline-label" htmlFor="pipeline">GENERATION METHOD<select id="pipeline" disabled={!recipe || busy} value={recipe?.pipeline || 'structure'} onChange={e => change({ pipeline: e.target.value as 'structure' | 'inpaint' })}><option value="structure">LTX-2 · structure guidance</option><option value="inpaint">LTX-2.5 · masked edits (experimental)</option></select></label><div className="quality-switch"><button className={recipe?.quality === 'draft' ? 'active' : ''} onClick={() => change({ quality: 'draft' })}><strong>Explore</strong><span>512 px · 16 fps</span></button><button className={recipe?.quality === 'final' ? 'active' : ''} onClick={() => change({ quality: 'final' })}><strong>Finish</strong><span>768 px · 24 fps</span></button></div><div className="seed-row"><label htmlFor="seed">Seed</label><input id="seed" type="number" min="0" max={2 ** 32 - 1} value={recipe?.seed || 0} disabled={!recipe} onChange={e => change({ seed: Math.max(0, Math.min(2 ** 32 - 1, Math.floor(Number(e.target.value)))) })}/><button title="Try a new seed" onClick={() => change({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })}><RotateCcw size={13}/></button></div><div className="model-note"><div><i className="dot ready"/><strong>{recipe?.pipeline === 'inpaint' ? 'LTX-2.5 · open-weight inpainting' : 'LTX-2 · open weights'}</strong></div><p>Runs on your ComfyUI. Every take includes its editable recipe.</p></div>
      {take?.error && <div className="error-note">{take.error}</div>}
      {busy && <div className="render-progress"><div><LoaderCircle size={14} className="spin"/><span>{take?.stage || take?.state.replaceAll('_', ' ') || 'Submitting'}</span><b>{take?.progress != null ? `${Math.round(take.progress * 100)}%` : 'GPU working'}</b></div>{take?.progress != null && <progress max="1" value={take.progress}/>}<button onClick={async () => { if (!take) return; try { setTake(await api(`/api/renders/${take.id}/cancel`, { method: 'POST' })); } catch (error) { setToast((error as Error).message); } }}>Cancel take</button></div>}
      </div><div className="render-footer"><button className="render-button" disabled={!recipe || busy || !engine.ready} onClick={() => void render()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>} {busy ? 'Making your take…' : 'Render take'}<ArrowUpRight size={18}/></button>{!engine.ready && <button className="setup-link" onClick={() => setEngineOpen(true)}>Connect your local engine <ArrowUpRight size={11}/></button>}{hasOutput && <a className="download-video" href={take!.output} download><Download size={14}/>Download video</a>}<button className="export-workflow" disabled={!recipe || !recipe.cue.strokes.length} onClick={() => void exportWorkflow()}><ArrowDownToLine size={12}/>Export ComfyUI workflow</button></div></aside>
    <footer className="statusbar"><span><i className="dot ready"/> YOUR CLIP. YOUR MODELS. YOUR CALL.</span><span>Built with Comfy <b>↗</b><i/>AFTERTAKE 0.1</span></footer>
    <input type="file" ref={fileInput} hidden accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/><input type="file" ref={recipeInput} hidden accept="application/json,.json" onChange={e => { void importRecipe(e.target.files?.[0]); e.target.value = ''; }}/>
    {toast && <div className="toast" role="status"><span>{toast}</span><button title="Dismiss" onClick={() => setToast('')}><X size={15}/></button></div>}
    {(engineOpen || helpOpen) && <div className="modal-backdrop" onClick={() => { setEngineOpen(false); setHelpOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-label={engineOpen ? 'Local engine' : 'How Aftertake works'} onClick={e => e.stopPropagation()}><button className="modal-close" title="Close" onClick={() => { setEngineOpen(false); setHelpOpen(false); }}><X size={19}/></button>{engineOpen ? <><div className="eyebrow">YOUR RENDER ENGINE</div><h2>{engine.ready ? 'Ready when you are.' : 'Bring your own horsepower.'}</h2><p>{engine.message}</p>{engine.gpu && <div className="gpu-detail">{engine.gpu}</div>}{engine.missing.length > 0 && <ul>{engine.missing.map(item => <li key={item}>{item}</li>)}</ul>}<p>The studio uses the official Comfy SDK and a local Comfy v2 proxy. Run these in separate terminals from the project folder:</p><pre>python scripts/setup.py{'\n'}python scripts/engine.py{'\n'}pnpm dev</pre><small>Installation downloads approximately 30 GB of model weights. Runtime and model files stay outside the source repository.</small></> : <><div className="eyebrow">THE AFTERTAKE METHOD</div><h2>Small cues.<br/>Impossible consequences.</h2><ol><li><strong>Bring a moment.</strong> Import a short, steady video. The included room is an original procedural camera study.</li><li><strong>Paint the possibility.</strong> Brush over a region, then choose when the transformation appears.</li><li><strong>Direct the change.</strong> Pick an exploration or write your own visual direction. Render with local open weights.</li><li><strong>Pass it on.</strong> Export the video, share the recipe with the source, or open the graph in ComfyUI.</li></ol><p>Outside the cue, the composite keeps the source pixels before video encoding. Generative results inside the cue are experimental; explore a few takes.</p><small>Space: play/pause · Ctrl/Cmd + Z: undo stroke · Drop a clip anywhere on the viewer.</small></>}</section></div>}
  </div>;
}
