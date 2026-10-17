import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, AudioLines, Brush, Check, ChevronDown, CircleHelp, Clapperboard, Download, Eraser, Film, FolderOpen, Layers2, LoaderCircle, Maximize2, Pause, Play, Plus, Redo2, RotateCcw, Settings2, Share2, SlidersHorizontal, Sparkles, Undo2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { cueEnvelope, presets, presetPrompt, projectSchema, renderDimensions, renderSettingsKey, type Clip, type Engine, type Recipe, type Render, type Stroke } from './domain';
import './style.css';
import FilmDesk from './FilmDesk';
import RecipeLibrary from './RecipeLibrary';
import { applyTemplate, type Template } from './templates';
import { spatialMask } from './mask';
import { cameraTracks, cinemaLooks, cinemaOptions, cinemaPrompt, defaultCinema, savedLookSchema, type Cinema, type SavedLook } from './cinema';

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
const framePrompt = 'A calm, realistic continuous shot of this place. Fine textures stay coherent, with gentle natural motion.';
const makeRecipe = (clip: Clip): Recipe => {
  const r: Recipe = { format: 'aftertake/1', name: 'An ordinary place, otherwise', clip,
    prompt: presetPrompt(presets[0], 'inpaint'), pipeline: 'inpaint', cue: structuredClone(defaultCue), seed: 42, quality: 'draft', trimStart: 0 };
  r.cue.end = Math.min(r.cue.end, renderDimensions(r).duration);
  if (clip.kind === 'image') { r.pipeline = 'cinema'; r.cinema = { ...defaultCinema }; r.prompt = framePrompt; }
  return r;
};
const timecode = (seconds: number, fps = 24) => `${Math.floor(seconds).toString().padStart(2, '0')}:${Math.floor((seconds % 1) * fps).toString().padStart(2, '0')}`;
const isBusy = (state: string) => ['submitting', 'queued', 'running', 'finalizing', 'canceling', 'connection_lost'].includes(state);

export default function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [engine, setEngine] = useState<Engine>({ connected: false, ready: false, missing: [], message: 'Checking local engine…' });
  const [renders, setRenders] = useState<Render[]>([]);
  const [take, setTake] = useState<Render | null>(null);
  const [mode, setMode] = useState<'source' | 'cue' | 'result' | 'compare'>('cue');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [radius, setRadius] = useState(.13);
  const [brushMode, setBrushMode] = useState<'paint' | 'erase'>('paint');
  const [brushPosition, setBrushPosition] = useState<{ x: number; y: number } | null>(null);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [toast, setToast] = useState('');
  const [engineOpen, setEngineOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [exampleWorkspace, setExampleWorkspace] = useState(false);
  const [exampleCount, setExampleCount] = useState(3);
  const [exampleNames, setExampleNames] = useState<Record<string, string>>({});
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>(() => {
    try { return savedLookSchema.array().max(30).parse(JSON.parse(localStorage.getItem('aftertake-looks') || '[]')); } catch { return []; }
  });
  const [lookName, setLookName] = useState('My film look');
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
    Promise.all([api<Clip[]>('/api/clips'), api<Render[]>('/api/renders'), api<{ examples: boolean; exampleCount: number; exampleNames: Record<string, string>; featuredRenderId?: string }>('/api/workspace')]).then(([found, history, workspace]) => {
      setClips(found);
      setRenders(history); setExampleWorkspace(workspace.examples); setExampleCount(workspace.exampleCount); setExampleNames(workspace.exampleNames || {});
      let saved: Recipe | null = null;
      try { saved = projectSchema.parse(JSON.parse(localStorage.getItem('aftertake-project') || 'null')); } catch {}
      if (saved && found.some(c => c.id === saved!.clip.id)) {
        setRecipe(saved); setMode(saved.pipeline === 'cinema' ? 'source' : 'cue');
        const match = history.find(r => renderSettingsKey(r.recipe) === renderSettingsKey(saved!));
        if (match) {
          setTake(match); setMode(match.output ? 'compare' : match.recipe.pipeline === 'cinema' ? 'source' : 'cue');
          if (saved.name === match.recipe.name && workspace.exampleNames?.[match.id]) setRecipe({ ...saved, name: workspace.exampleNames[match.id] });
        }
      }
      else if (workspace.examples && history.length) {
        const featured = history.find(r => r.id === workspace.featuredRenderId) || history[0];
        setRecipe({ ...featured.recipe, name: workspace.exampleNames?.[featured.id] || featured.recipe.name }); setTake(featured); setMode(featured.output ? 'compare' : 'cue');
      }
      else if (found[0]) {
        const initial = makeRecipe(found.find(c => c.id === 'a7e24e70-2168-4e9c-b97f-06ae1401f558') || found[0]);
        setRecipe(initial); setMode(initial.pipeline === 'cinema' ? 'source' : 'cue');
      }
    }).catch(error => setToast(error.message));
  }, []);
  useEffect(() => {
    let current = true;
    setEngine({ connected: false, ready: false, missing: [], message: 'Checking the selected workflow…' });
    const profile = recipe?.pipeline === 'cinema' && recipe.cinema?.guidance === 'tracks' ? 'motion' : recipe?.pipeline || 'structure';
    const check = () => api<Engine>(`/api/engine?pipeline=${profile}`).then(value => { if (current) setEngine(value); }).catch(() => {});
    void check(); const interval = setInterval(check, 5000);
    return () => { current = false; clearInterval(interval); };
  }, [recipe?.pipeline, recipe?.cinema?.guidance]);
  useEffect(() => {
    if (recipe) localStorage.setItem('aftertake-project', JSON.stringify(recipe));
  }, [recipe]);
  useEffect(() => { if (toast) { const timeout = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timeout); } }, [toast]);
  useEffect(() => { video.current?.pause(); outputVideo.current?.pause(); setPlaying(false); }, [mode]);
  useEffect(() => { if (libraryOpen) { video.current?.pause(); outputVideo.current?.pause(); setPlaying(false); } }, [libraryOpen]);
  useEffect(() => {
    const pending = renders.filter(r => isBusy(r.state));
    if (!pending.length) return;
    const interval = setInterval(() => {
      for (const render of pending) {
        api<Render>(`/api/renders/${render.id}`).then(updated => {
          setTake(current => current?.id === updated.id ? updated : current);
          setRenders(all => all.map(r => r.id === updated.id ? updated : r));
          if (updated.state === 'succeeded' && take?.id === updated.id) { setMode('compare'); setToast('Your take is ready. Scrub or play to compare it with the source.'); }
        }).catch(() => {});
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [renders.filter(r => isBusy(r.state)).map(r => r.id).join(','), take?.id]);
  useEffect(() => {
    if (!playing) return;
    let raf: number;
    const tick = () => {
      if (recipeRef.current?.pipeline === 'cinema') {
        if (outputVideo.current) setTime(outputVideo.current.currentTime);
      } else if (video.current) {
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
  function changeQuality(quality: Recipe['quality']) {
    if (!recipe) return;
    const next = { ...recipe, quality }, d = renderDimensions(next);
    const end = Math.min(next.cue.end, d.duration);
    next.cue = { ...next.cue, end, start: Math.max(0, Math.min(next.cue.start, end - .1)),
      anchor: Math.min(next.cue.anchor || 0, d.duration - 1 / d.fps) };
    setRecipe(next);
    if (time > d.duration) seek(0);
  }
  function changePipeline(pipeline: Recipe['pipeline']) {
    if (!recipe) return;
    video.current?.pause(); outputVideo.current?.pause(); setPlaying(false); setTake(null); setTime(0);
    if (pipeline === 'cinema') {
      change({ pipeline, cinema: recipe.cinema || { ...defaultCinema }, prompt: framePrompt });
      setMode('source');
      if (video.current) video.current.currentTime = recipe.trimStart;
      return;
    }
    if (recipe.pipeline === 'cinema') { change({ pipeline, prompt: presetPrompt(presets[0], pipeline) }); setMode('cue'); return; }
    const preset = presets.find(p => p.prompt === recipe.prompt || presetPrompt(p, 'inpaint') === recipe.prompt);
    change({ pipeline, ...(preset ? { prompt: presetPrompt(preset, pipeline) } : {}) });
  }
  function changeSourceStart(value: number) {
    if (!recipe || !Number.isFinite(value)) return;
    const trimStart = Math.max(0, Math.min(recipe.clip.duration - (recipe.pipeline === 'cinema' ? .05 : .6), value));
    const next = { ...recipe, trimStart }, d = renderDimensions(next);
    const end = Math.min(recipe.cue.end, d.duration);
    next.cue = { ...recipe.cue, end, start: Math.max(0, Math.min(recipe.cue.start, end - .1)), strokes: [], anchor: 0 };
    setRecipe(next); setTake(null); setMode(recipe.pipeline === 'cinema' ? 'source' : 'cue'); setTime(0); setRedo([]);
    video.current?.pause(); setPlaying(false);
    if (video.current) video.current.currentTime = trimStart;
    setToast(recipe.pipeline === 'cinema' ? 'Reference frame changed. The new take will begin here.' : 'Source range changed. Paint a region on this part of the clip.');
  }
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
    if (video.current) video.current.currentTime = (recipe?.pipeline === 'cinema' ? 0 : value) + (recipe?.trimStart || 0);
    if (outputVideo.current) outputVideo.current.currentTime = value;
  }
  async function togglePlay() {
    if (!video.current && !outputVideo.current) return;
    if (playing) { video.current?.pause(); outputVideo.current?.pause(); setPlaying(false); }
    else {
      if (time >= duration - .1) seek(0);
      try {
        if (recipe?.pipeline === 'cinema') {
          if (!outputVideo.current) { setToast('Render a take to play the new camera movement. The source is a still reference.'); return; }
          await outputVideo.current.play();
        } else { await video.current?.play(); if (outputVideo.current) await outputVideo.current.play(); }
        setPlaying(true);
      }
      catch (error) { console.error('Playback could not start:', error); setMediaError(true); setToast('Video preview unavailable. Retry after the render finishes.'); }
    }
  }
  useEffect(() => {
    if (time >= duration && playing) { video.current?.pause(); outputVideo.current?.pause(); setPlaying(false); seek(0); }
  }, [time, duration, playing]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (libraryOpen || engineOpen || helpOpen || sourceOpen) return;
      if ((event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) return;
      if (event.code === 'Space') { event.preventDefault(); void togglePlay(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') { event.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  function undo() {
    setRecipe(r => { if (!r || !r.cue.strokes.length) return r; setRedo(all => [...all, r.cue.strokes.at(-1)!]); return { ...r, cue: { ...r.cue, strokes: r.cue.strokes.slice(0, -1) } }; });
  }
  function selectClip(clip: Clip) {
    video.current?.pause(); outputVideo.current?.pause(); setPlaying(false);
    const next = makeRecipe(clip);
    if (recipe?.pipeline === 'cinema') { next.pipeline = 'cinema'; next.cinema = recipe.cinema; next.prompt = framePrompt; }
    setRecipe(next); setTake(null); setTime(0); setMode(next.pipeline === 'cinema' ? 'source' : 'cue');
    setRedo([]); setBrushPosition(null); setMediaError(false); setSourceOpen(false);
  }
  function selectTake(render: Render) {
    video.current?.pause(); outputVideo.current?.pause(); setPlaying(false);
    setTake(render); setRecipe({ ...render.recipe, name: exampleNames[render.origin?.renderId || render.id] || render.recipe.name }); setMode(render.output ? 'compare' : render.recipe.pipeline === 'cinema' ? 'source' : 'cue');
    setTime(0); setRedo([]); setBrushPosition(null); setMediaError(false);
    if (video.current) video.current.currentTime = render.recipe.trimStart;
    if (outputVideo.current) outputVideo.current.currentTime = 0;
  }
  function pointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
  }
  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!recipe || recipe.pipeline === 'cinema' || mode !== 'cue') return;
    if (recipe.cue.strokes.length >= 100) { setToast('This cue has 100 strokes. Undo or clear a stroke before adding another.'); return; }
    if (recipe.cue.tracking === 'flow' && recipe.cue.strokes.length && Math.abs(time - (recipe.cue.anchor || 0)) > 1 / dimensions.fps) {
      seek(recipe.cue.anchor || 0); setToast('Returned to the anchor frame. Paint here to edit the tracked region.'); return;
    }
    video.current?.pause(); outputVideo.current?.pause(); setPlaying(false);
    event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; setRedo([]);
    const point = pointer(event);
    setRecipe(r => r ? { ...r, cue: { ...r.cue, anchor: r.cue.strokes.length ? r.cue.anchor : Math.min(time, duration - 1 / dimensions.fps), strokes: [...r.cue.strokes, { points: [point], radius, mode: brushMode }] } } : r);
  }
  function extendStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    setBrushPosition(pointer(event));
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
      setClips(all => [...all, clip]); selectClip(clip);
      setToast(clip.kind === 'image' ? 'Reference imported. Direct the scene and camera, then render a new shot.' : 'Source imported. Paint a region, or choose Animate a frame.');
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
    if (recipe.pipeline !== 'cinema' && !recipe.cue.strokes.some(stroke => stroke.mode !== 'erase')) { setToast('Paint a region on the shot before rendering.'); return; }
    setRendering(true);
    try {
      const result = await api<Render>('/api/renders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipe) });
      setTake(result); setMode(recipe.pipeline === 'cinema' ? 'source' : 'cue'); seek(0); setRenders(all => [result, ...all]);
    } catch (error) { setToast((error as Error).message); } finally { setRendering(false); }
  }
  async function exportWorkflow() {
    if (!recipe) return;
    try { download('aftertake-workflow-api.json', take?.workflow && renderSettingsKey(recipe) === renderSettingsKey(take.recipe)
      ? take.workflow : await api('/api/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipe) })); }
    catch (error) { setToast((error as Error).message); }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    try {
      const value = projectSchema.parse(JSON.parse(await file.text()));
      const found = clips.find(c => c.sha256 === value.clip.sha256);
      if (!found) throw new Error(`Import the matching source video first: ${value.clip.name}`);
      setRecipe({ ...value, clip: found }); setTake(null); seek(0); setMode(value.pipeline === 'cinema' ? 'source' : 'cue'); setToast('Recipe loaded. Every cue and setting is editable.');
    } catch (error) { setToast((error as Error).message); }
  }
  const hasOutput = Boolean(take?.output);
  const isCinema = recipe?.pipeline === 'cinema';
  const filmSettings = recipe?.cinema || defaultCinema;
  const framingTracks = isCinema && filmSettings.guidance === 'tracks' ? cameraTracks(dimensions.width, dimensions.height, dimensions.frames, filmSettings.movement) : [];
  function changeFilmSetting(key: 'movement' | 'lens' | 'lighting' | 'palette', value: string) {
    const next = { ...filmSettings, [key]: value } as Cinema;
    if (next.movement === 'orbit') next.guidance = 'prompt';
    change({ cinema: next });
  }
  function saveFilmLook() {
    const parsed = savedLookSchema.safeParse({ name: lookName, settings: filmSettings });
    if (!parsed.success) { setToast('Give this look a name of 1 to 40 characters.'); return; }
    const next = [...savedLooks.filter(look => look.name !== parsed.data.name), parsed.data].slice(-30);
    setSavedLooks(next); localStorage.setItem('aftertake-looks', JSON.stringify(next));
    setToast('Film look saved on this device. Apply it to another source to reuse these settings.');
  }
  const settingsChanged = Boolean(take && recipe && renderSettingsKey(recipe) !== renderSettingsKey(take.recipe));
  const outputAudio = Boolean(take?.recipe.clip.hasAudio && take.recipe.pipeline !== 'cinema' &&
    (take.workflow?.['21'] as { inputs?: { source_audio?: unknown } } | undefined)?.inputs?.source_audio);
  const hearingOutput = mode === 'result' || mode === 'compare';
  const canHear = hearingOutput ? outputAudio : Boolean(recipe?.clip.hasAudio && !isCinema);
  const activeTake = take && isBusy(take.state) ? take : renders.find(r => isBusy(r.state));
  const busy = rendering || Boolean(activeTake);
  function useTemplate(item: Template) {
    if (!recipe || busy) return;
    try {
      video.current?.pause(); outputVideo.current?.pause(); setPlaying(false); setTime(0); setTake(null);
      const next = applyTemplate(recipe, item); setRecipe(next); setMode(next.pipeline === 'cinema' ? 'source' : 'cue');
      if (video.current) video.current.currentTime = next.trimStart;
      setLibraryOpen(false); setToast(next.pipeline === 'cinema' ? 'Camera recipe applied. Your source and scene direction stay yours.' : 'Effect applied to your source. Paint a region or adjust your existing cue, then render a new take.');
    } catch (error) { setToast((error as Error).message); }
  }
  function openExample(render: Render, clip: Clip) {
    setClips(all => all.some(item => item.id === clip.id) ? all : [...all, clip]);
    setRenders(all => all.some(item => item.id === render.id) ? all : [render, ...all]);
    selectTake(render); setLibraryOpen(false); setToast('Pre-rendered example opened. Every setting is editable; rendering changes uses your local engine.');
  }
  const selectedPreset = presets.find(p => presetPrompt(p, recipe?.pipeline) === recipe?.prompt);
  useEffect(() => {
    if (!mediaError || busy) return;
    const retry = setTimeout(() => { video.current?.load(); outputVideo.current?.load(); }, 2000);
    return () => clearTimeout(retry);
  }, [busy, mediaError]);

  return <div className="app-shell">
    <aside className="rail" aria-label="Studio navigation">
      <div className="brand-mark" aria-label="Aftertake">a<span>↗</span></div>
      <button className="rail-button selected" title="Studio" onClick={() => setMode('cue')}><Clapperboard size={21}/></button>
      <button className="rail-button" title="Effects and camera recipes" onClick={() => setLibraryOpen(true)}><Sparkles size={21}/></button>
      <button className="rail-button" title="Import source" onClick={() => fileInput.current?.click()}><FolderOpen size={21}/></button>
      <button className="rail-button" title="Import a recipe" onClick={() => recipeInput.current?.click()}><Layers2 size={21}/></button>
      <div className="rail-bottom"><button className="rail-button" title="Engine settings" onClick={() => setEngineOpen(true)}><Settings2 size={20}/></button><button className="rail-button" title="How it works" onClick={() => setHelpOpen(true)}><CircleHelp size={20}/></button><div className="avatar">J</div></div>
    </aside>
    <header className="header">
      <div className="wordmark">aftertake<span>{exampleWorkspace ? 'EXAMPLE WORKSPACE' : 'OPEN STUDIO'}</span></div>
      <div className="breadcrumb"><span>Workspace</span><span>/</span><input className="project-name" aria-label="Project name" value={recipe?.name || "Untitled film"} disabled={!recipe} maxLength={100} onChange={e => change({ name: e.target.value })}/><ChevronDown size={13}/></div>
      <div className="header-actions"><button className="compact-source" title="Choose or import source" onClick={() => setSourceOpen(true)}><FolderOpen size={17}/></button><button className="engine-chip" onClick={() => setEngineOpen(true)}><i className={engine.ready ? 'dot ready' : 'dot'}/>{engine.ready ? 'Local engine ready' : engine.connected ? 'Installing models' : 'Local engine offline'}</button><button className="button browse-recipes" onClick={() => setLibraryOpen(true)}><Sparkles size={14}/>Recipes</button><button className="button subtle" disabled={!recipe} onClick={() => { if (recipe) { download('aftertake-recipe.json', recipe); setToast('Recipe exported. Share it with its source video to let someone remix your take.'); } }}><Share2 size={15}/>Share recipe</button></div>
    </header>
    <aside className="library">
      <div className="library-heading"><span>YOUR PROJECT</span><button title="Import video" onClick={() => fileInput.current?.click()}><Plus size={17}/></button></div>
      <div className="project-title"><div className="project-icon"><Film size={20}/></div><div><strong title={recipe?.name}>{recipe?.name || "Untitled film"}</strong><small>Saved on this device</small></div></div>
      <div className="section-label">SOURCE MATERIAL <span>{clips.length.toString().padStart(2, '0')}</span></div>
      {clips.map(clip => <button className={`source-card ${recipe?.clip.id === clip.id ? 'active' : ''}`} key={clip.id} onClick={() => selectClip(clip)}>
        <div className="source-thumb"><img src={`/api/thumbnails/${clip.id}?time=${Math.min(1, clip.duration / 2)}`} alt="" loading="lazy" decoding="async"/><span>{clip.kind === 'image' ? 'STILL' : `${clip.duration.toFixed(1)}s`}</span></div><strong>{clip.name.replace(/\.[^.]+$/, '')}</strong><small>{clip.width} × {clip.height} · {clip.kind === 'image' ? 'reference image' : 'source video'}</small>
      </button>)}
      <button className="import-source" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle size={16} className="spin"/> : <Plus size={16}/>} {uploading ? 'Importing…' : 'Import source'}</button>
      <div className="section-label looks-label">LOOK EXPLORATIONS <Sparkles size={12}/></div>
      <p className="library-description">A different world.<br/>The same moment.</p>
      {!isCinema && presets.map((preset, idx) => <button key={preset.id} className={`look-card ${preset.id} ${selectedPreset?.id === preset.id ? 'active' : ''}`} onClick={() => change({ prompt: presetPrompt(preset, recipe?.pipeline) })} disabled={!recipe}>
        <div className="look-art"><div className="orb one"/><div className="orb two"/><span className="look-number">0{idx + 1}</span><ArrowUpRight size={17}/></div><div className="look-caption"><strong>{preset.name}</strong><span>{selectedPreset?.id === preset.id ? <Check size={13}/> : preset.tag}</span></div>
      </button>)}
      {isCinema && <div className="film-look-list">{[...cinemaLooks, ...savedLooks].map((look, index) => <button key={`${look.name}-${index}`} onClick={() => change({ cinema: { ...look.settings } })} disabled={!recipe || busy}><span className={`film-look-swatch ${look.settings.palette}`}/><span><strong>{look.name}</strong><small>{look.settings.lens} · {look.settings.lighting}</small></span><ArrowUpRight size={14}/></button>)}</div>}
      <button className="browse-library" onClick={() => setLibraryOpen(true)}><Sparkles size={14}/><span>Browse real recipes</span><ArrowUpRight size={14}/></button>
      <div className="library-foot"><i className="tiny-star">✳</i><p>Make a take.<br/><span>Let someone make it theirs.</span></p></div>
    </aside>
    <main className="workspace">
      <div className="workspace-title"><div><div className="eyebrow">THE DIRECTOR’S DESK <span>01 / COMPOSE</span></div><h1>Direct the impossible<span>.</span></h1></div><button className="icon-button" title="How it works" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/></button></div>
      {exampleWorkspace && <div className="example-note">{exampleCount} real, pre-rendered examples. Explore their settings and export recipes. A local engine generates new takes.</div>}
      <div className="creation-modes" aria-label="Creation mode"><button className={!isCinema ? 'active' : ''} disabled={!recipe || busy || recipe.clip.kind === 'image'} onClick={() => { if (isCinema) changePipeline('inpaint'); }}><Brush size={17}/><span><strong>Transform a region</strong><small>Change part of an existing video</small></span></button><button className={isCinema ? 'active' : ''} disabled={!recipe || busy} onClick={() => { if (!isCinema) changePipeline('cinema'); }}><Clapperboard size={18}/><span><strong>Animate a frame</strong><small>A new shot from your reference</small></span></button></div>
      <div className="viewer-toolbar"><div className="view-tabs">{(['source', 'cue', 'result', 'compare'] as const).map(value => <button key={value} className={mode === value ? 'active' : ''} disabled={(value === 'cue' && isCinema) || (['result', 'compare'].includes(value) && !hasOutput)} onClick={() => setMode(value)}>{value === 'cue' ? <Brush size={13}/> : value === 'compare' ? <ArrowLeftRight size={13}/> : null}{value === 'cue' ? 'Cue canvas' : value[0].toUpperCase() + value.slice(1)}</button>)}</div><span className="viewer-meta">{dimensions.width} × {dimensions.height}<span> · </span>{dimensions.fps} FPS</span></div>
      <div className="viewer" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}>
        <div className="frame-corner tl"/><div className="frame-corner tr"/><div className="frame-corner bl"/><div className="frame-corner br"/>
        {recipe ? <div className={`shot-frame ${mode === 'cue' ? 'paint-mode' : ''}`} ref={frame} style={{ aspectRatio: `${recipe.clip.width}/${recipe.clip.height}`, maxWidth: `calc(52vh * ${recipe.clip.width / recipe.clip.height})` }}>
          {recipe.clip.kind === 'image' ? <img className="reference-image" src={recipe.clip.url} alt="Reference frame for the new shot"/> : <video ref={video} src={recipe.clip.url} muted={!audioEnabled || hearingOutput || isCinema} playsInline preload="auto" onLoadedMetadata={() => seek(0)} onLoadedData={() => setMediaError(false)} onError={() => setMediaError(true)} onEnded={() => setPlaying(false)} className={mode === 'result' ? 'hidden-source' : ''}/>}
          {hasOutput && (mode === 'result' || mode === 'compare') && <video ref={outputVideo} src={take!.output} onLoadedMetadata={() => { if (outputVideo.current) outputVideo.current.currentTime = time; }} onEnded={() => setPlaying(false)} muted={!audioEnabled || !outputAudio} playsInline preload="auto" onLoadedData={() => setMediaError(false)} onError={() => setMediaError(true)} className="result-video" style={mode === 'compare' ? { clipPath: `inset(0 ${100 - compare}% 0 0)` } : {}}/>}
          {mediaError && <button className="media-retry" onClick={() => { video.current?.load(); outputVideo.current?.load(); }}><RotateCcw size={16}/><strong>Retry video preview</strong><span>{busy ? 'The GPU is rendering. Try again when the take is ready.' : 'Reload the preview after GPU memory is released.'}</span></button>}
          {mode === 'source' && framingTracks.length > 0 && <svg className="framing-overlay" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} preserveAspectRatio="none" role="img" aria-label="Motion guide: screen-space framing trajectories"><defs><marker id="framing-arrow" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0L7 3L0 6" fill="#d5e991"/></marker></defs>{framingTracks.map((track, index) => <g key={index}><path d={track.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')} fill="none" stroke="#d5e991" strokeWidth="1.2" markerEnd="url(#framing-arrow)"/><circle cx={track[0].x} cy={track[0].y} r="3" fill="#d5e991"/></g>)}</svg>}
          {mode === 'cue' && !isCinema && <canvas ref={canvas} onPointerDown={beginStroke} onPointerMove={extendStroke} onPointerLeave={() => setBrushPosition(null)} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }}/>}
          {mode === 'cue' && !isCinema && brushPosition && <div className={`brush-cursor ${brushMode}`} style={{ left: `${brushPosition.x * 100}%`, top: `${brushPosition.y * 100}%`, width: `${radius * 2 * Math.min(1, recipe.clip.height / recipe.clip.width) * 100}%`, height: `${radius * 2 * Math.min(1, recipe.clip.width / recipe.clip.height) * 100}%` }}/>}
          {mode === 'cue' && !isCinema && !recipe.cue.strokes.length && <div className="paint-hint"><div><Brush size={21}/></div><strong>Where does the impossible begin?</strong><span>Paint a region directly on your shot.</span></div>}
          <div className="shot-label">{mode === 'source' ? isCinema ? 'REFERENCE / FIRST FRAME' : 'SOURCE / ORIGINAL' : mode === 'cue' ? 'SPATIAL CUE / EDITABLE' : mode === 'compare' ? 'AFTERTAKE / SOURCE' : 'AFTERTAKE / RENDERED'}</div>
          <div className="shot-time">{timecode(time, dimensions.fps)}</div>
          {mode === 'cue' && !isCinema && recipe.cue.strokes.length > 0 && <span className="cue-strength">{envelope > 0 ? `EFFECT ${Math.round(envelope * 100)}%` : 'EFFECT INACTIVE · EDITING REGION'}</span>}
          {mode === 'compare' && <div className="compare-line" style={{ left: `${compare}%` }}><span><ArrowLeftRight size={16}/></span></div>}
          {mode === 'compare' && <input className="comparison" type="range" aria-label="Before and after split" min="0" max="100" value={compare} onChange={e => setCompare(Number(e.target.value))}/>}
        </div> : <button className="empty-view" onClick={() => fileInput.current?.click()}><Upload size={32}/><h2>Every impossible shot starts somewhere.</h2><p>Drop a video here, or choose a clip to begin.</p><span>MP4, MOV, WebM · up to 100 MB</span></button>}
        <div className="viewer-bottom"><span><i className="dot ready"/> {mode === 'cue' ? brushMode === 'erase' ? 'Erase to protect - source stays here' : 'Paint to transform - everything else stays' : 'Your source. Your direction.'}</span><button title="Fullscreen viewer" onClick={() => frame.current?.requestFullscreen()}><Maximize2 size={15}/></button></div>
      </div>
      {settingsChanged && hasOutput && <div className="changed-note">Settings changed. Result shows the last rendered take.</div>}
      <div className="transport"><div className="transport-left"><button title="Return to start" onClick={() => seek(0)}><RotateCcw size={15}/></button><button className="play-button" title={playing ? 'Pause' : 'Play'} disabled={!recipe} onClick={() => void togglePlay()}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button><span>{timecode(time, dimensions.fps)}<b>/</b>{timecode(duration, dimensions.fps)}</span><button title={canHear ? audioEnabled ? "Mute source audio" : "Unmute source audio" : "This preview has no audio"} aria-pressed={audioEnabled && canHear} disabled={!canHear} onClick={() => setAudioEnabled(value => !value)}>{audioEnabled && canHear ? <Volume2 size={15}/> : <VolumeX size={15}/>}</button></div><div className={isCinema ? "brush-tools cinema-hidden" : "brush-tools"}><button title="Undo stroke" disabled={!recipe?.cue.strokes.length} onClick={undo}><Undo2 size={16}/></button><button title="Redo stroke" disabled={!redo.length} onClick={() => { if (!recipe || !redo.length) return; change({ cue: { ...recipe.cue, strokes: [...recipe.cue.strokes, redo.at(-1)!] } }); setRedo(all => all.slice(0, -1)); }}><Redo2 size={16}/></button><i/><button className={brushMode === 'paint' ? 'tool-active' : ''} title="Paint region" aria-pressed={brushMode === 'paint'} onClick={() => setBrushMode('paint')}><Brush size={14}/></button><button className={brushMode === 'erase' ? 'tool-active' : ''} title="Erase region" aria-pressed={brushMode === 'erase'} onClick={() => setBrushMode('erase')}><Eraser size={14}/></button><label>Size<input type="range" min=".02" max=".5" step=".005" value={radius} aria-label="Brush radius" onChange={e => setRadius(Number(e.target.value))}/></label><button title="Clear painted region" disabled={!recipe?.cue.strokes.length} onClick={() => { if (recipe) change({ cue: { ...recipe.cue, strokes: [] } }); }}><X size={15}/></button></div></div>
      <section className="timeline" aria-label="Shot timeline"><div className="timeline-head"><div><AudioLines size={15}/><strong>{isCinema ? 'YOUR NEW SHOT' : 'THE MOMENT IT CHANGES'}</strong></div><span>{isCinema ? 'One reference frame. New motion.' : 'Drag time. Shape the transformation.'}</span></div><div className="ruler">{Array.from({ length: 7 }, (_, i) => <span key={i}>{(duration * i / 6).toFixed(1)}s</span>)}</div><div className="timeline-track"><div className="track-label"><Film size={13}/>SOURCE</div><div className="film-track">{Array.from({ length: 10 }, (_, i) => <div key={i} className="film-cell">{recipe && <img src={`/api/thumbnails/${recipe.clip.id}?time=${recipe.trimStart + (isCinema ? 0 : duration * i / 10)}`} alt="" loading="lazy" decoding="async"/>}</div>)}</div></div><div className="timeline-track"><div className="track-label"><Sparkles size={13}/>EFFECT</div><div className="effect-track">{recipe && <div className="effect-block" style={{ left: `${(isCinema ? 0 : recipe.cue.start / duration * 100)}%`, width: `${(isCinema ? 100 : Math.max(0, Math.min(recipe.cue.end, duration) - recipe.cue.start) / duration * 100)}%` }}><span>⋮</span><strong>{isCinema ? cinemaOptions.movement.find(([value]) => value === filmSettings.movement)?.[1] : selectedPreset?.name || 'Custom direction'}</strong><span>⋮</span></div>}</div></div><input className="scrubber" type="range" min="0" max={duration} step={1 / dimensions.fps} value={Math.min(time, duration)} aria-label="Timeline playhead" onChange={e => seek(Number(e.target.value))}/></section>
      <section className="takes"><div className="takes-title"><span>TAKES <b>{renders.length.toString().padStart(2, '0')}</b></span><span>Every experiment belongs here.</span></div>{renders.length ? <div className="take-list">{renders.map((render, index) => <button key={render.id} className={take?.id === render.id ? 'take active' : 'take'} onClick={() => selectTake(render)}><span className="take-index">{String(renders.length - index).padStart(2, '0')}</span><div><strong>{exampleNames[render.id] || render.recipe.name}</strong><small>{render.origin ? "example · " : ""}{render.recipe.quality} · seed {render.recipe.seed}</small></div><span className={`take-state ${render.state}`}>{render.state.replaceAll('_', ' ')}</span></button>)}</div> : <div className="no-takes"><Clapperboard size={19}/><span>Your first take is waiting to happen.</span><span>Paint → Direct → Render</span></div>}</section>
      <FilmDesk renders={renders} titles={exampleNames}/>
    </main>
    <aside className="inspector"><div className="inspector-title"><SlidersHorizontal size={16}/><strong>Shot direction</strong><span>01</span></div><div className="inspector-body"><div className="step-label"><b>01</b><span>MAKE IT YOURS</span></div><h2>A little direction.<br/>A different reality.</h2><p className="inspector-intro">{isCinema ? 'Describe the scene and action in your new shot.' : 'Tell the painted part of your shot what to become.'}</p><label className="input-label" htmlFor="direction">YOUR DIRECTION <Sparkles size={12}/></label><textarea id="direction" value={recipe?.prompt || ''} disabled={!recipe} onChange={e => change({ prompt: e.target.value })} placeholder="A wall of living moss. A pool of molten gold. What happens here?" maxLength={2000}/><div className="prompt-footer"><span>{isCinema ? 'Your reference sets the opening frame.' : recipe?.pipeline === 'inpaint' ? 'Describe only the painted region.' : 'Movement comes from your source.'}</span><span>{recipe?.prompt.length || 0}</span></div><div className="divider"/><div className="step-label"><b>02</b><span>{isCinema ? 'DIRECT THE CAMERA' : 'CHOOSE THE MOMENT'}</span></div><label className="source-start">Source starts at<input type="number" aria-label="Source starts at" min="0" max={Math.max(0, (recipe?.clip.duration || 1) - (isCinema ? .05 : .6))} step=".1" value={recipe?.trimStart || 0} disabled={!recipe || busy || recipe.clip.kind === 'image'} onChange={e => changeSourceStart(Number(e.target.value))}/><span>seconds into your clip</span></label>{isCinema ? <div className="cinema-controls">{(['movement', 'lens', 'lighting', 'palette'] as const).map(key => <label key={key}>{({ movement: 'Camera movement', lens: 'Lens character', lighting: 'Lighting', palette: 'Color grade' })[key]}<select aria-label={({ movement: 'Camera movement', lens: 'Lens character', lighting: 'Lighting', palette: 'Color grade' })[key]} value={filmSettings[key]} disabled={!recipe || busy} onChange={e => changeFilmSetting(key, e.target.value)}>{cinemaOptions[key].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}<label className="framing-toggle"><input type="checkbox" aria-label="Guide framing with motion tracks" checked={filmSettings.guidance === 'tracks'} disabled={!recipe || busy || filmSettings.movement === 'orbit'} onChange={e => change({ cinema: { ...filmSettings, guidance: e.target.checked ? 'tracks' : 'prompt' } })}/><span>Guide framing with tracks <b>EXPERIMENTAL</b></span></label>{filmSettings.guidance === 'tracks' && <p>The source view shows the exact screen-space trajectories sent to the motion adapter. Review the result; these are framing hints, not a reconstructed 3D camera.</p>}<p>Camera, lens and lighting guide the model through your prompt. Motion can vary. Color grading is applied consistently after generation.</p><details className="compiled-direction"><summary>View the exact generation prompt</summary><p>{cinemaPrompt(recipe?.prompt || '', filmSettings)}</p></details><div className="save-film-look"><input aria-label="Film look name" maxLength={40} value={lookName} onChange={e => setLookName(e.target.value)}/><button disabled={!recipe || busy} onClick={saveFilmLook}>Save look</button></div></div> : <><div className="time-controls"><label>Begins at<input type="number" aria-label="Effect start" min="0" max={Math.max(0, (recipe?.cue.end || duration) - .1)} step=".1" value={recipe?.cue.start || 0} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, start: Math.min(Number(e.target.value), recipe.cue.end - .1) } }); }}/><span>seconds</span></label><label>Ends at<input type="number" aria-label="Effect end" min={(recipe?.cue.start || 0) + .1} max={duration} step=".1" value={recipe?.cue.end || 0} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, end: Math.max(recipe.cue.start + .1, Math.min(duration, Number(e.target.value))) } }); }}/><span>seconds</span></label></div><label className="slider-label">Ease in & out<span>{recipe?.cue.fade.toFixed(1)}s</span><input type="range" min="0" max="1.2" step=".05" value={recipe?.cue.fade || 0} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, fade: Number(e.target.value) } }); }}/></label><label className="slider-label">Blend the edges<span>{Math.round((recipe?.cue.feather || 0) * 100)}%</span><input type="range" min=".005" max=".15" step=".005" value={recipe?.cue.feather || .055} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, feather: Number(e.target.value) } }); }}/></label><div className="tracking-control"><label><input type="checkbox" checked={recipe?.cue.tracking === 'flow'} disabled={!recipe} onChange={e => { if (recipe) change({ cue: { ...recipe.cue, tracking: e.target.checked ? 'flow' : 'static' } }); }}/><span>Follow source motion</span><span className="beta-tag">BETA</span></label><p>{recipe?.cue.tracking === 'flow' ? `Anchored at ${timecode(recipe.cue.anchor || 0, dimensions.fps)}. Preview the tracked cue before rendering.` : 'The painted region stays fixed in the frame.'}</p>{recipe?.cue.tracking === 'flow' && <button disabled={previewing || !recipe.cue.strokes.length} onClick={() => void previewMotion()}>{previewing ? <LoaderCircle size={12} className="spin"/> : trackedPreview ? <Check size={12}/> : <Play size={12}/>} {previewing ? 'Tracking on CPU…' : trackedPreview ? 'Tracked preview ready' : 'Preview motion'}</button>}</div></>}<div className="divider"/><div className="step-label"><b>03</b><span>MAKE A TAKE</span></div><label className="pipeline-label" htmlFor="pipeline">GENERATION METHOD<select id="pipeline" disabled={!recipe || busy} value={recipe?.pipeline || 'structure'} onChange={e => changePipeline(e.target.value as Recipe['pipeline'])}><option value="cinema">LTX-2.5 · reference-frame animation</option><option disabled={recipe?.clip.kind === 'image'} value="structure">LTX-2 · structure guidance</option><option disabled={recipe?.clip.kind === 'image'} value="inpaint">LTX-2.5 · masked edits (experimental)</option></select></label><div className="quality-switch"><button className={recipe?.quality === 'draft' ? 'active' : ''} onClick={() => changeQuality('draft')}><strong>Explore</strong><span>{filmSettings.guidance === 'tracks' && isCinema ? 'Guided · 16 fps' : '512 px · 16 fps'}</span></button><button className={recipe?.quality === 'final' ? 'active' : ''} onClick={() => changeQuality('final')}><strong>Finish</strong><span>768 px · 24 fps</span></button></div><div className="seed-row"><label htmlFor="seed">Seed</label><input id="seed" type="number" min="0" max={2 ** 32 - 1} value={recipe?.seed || 0} disabled={!recipe} onChange={e => change({ seed: Math.max(0, Math.min(2 ** 32 - 1, Math.floor(Number(e.target.value)))) })}/><button title="Try a new seed" onClick={() => change({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })}><RotateCcw size={13}/></button></div><div className="model-note"><div><i className="dot ready"/><strong>{isCinema ? 'LTX-2.5 · reference-frame animation' : recipe?.pipeline === 'inpaint' ? 'LTX-2.5 · open-weight inpainting' : 'LTX-2 · open weights'}</strong></div><p>Runs on your ComfyUI. Every take includes its editable recipe.</p></div>
      {take?.error && take.state !== 'succeeded' && <div className="error-note">{take.error}</div>}
      {busy && <div className="render-progress"><div><LoaderCircle size={14} className="spin"/><span>{activeTake?.stage || activeTake?.state.replaceAll('_', ' ') || 'Submitting'}</span><b>{activeTake?.progress != null ? `${Math.round(activeTake.progress * 100)}% of step` : 'GPU working'}</b></div>{activeTake?.progress != null && <progress max="1" value={activeTake.progress}/>} <button onClick={async () => { if (!activeTake) return; try { const updated = await api<Render>(`/api/renders/${activeTake.id}/cancel`, { method: 'POST' }); setRenders(all => all.map(r => r.id === updated.id ? updated : r)); setTake(current => current?.id === updated.id ? updated : current); } catch (error) { setToast((error as Error).message); } }}>Cancel take</button></div>}
      </div><div className="render-footer"><button className="render-button" disabled={!recipe || busy || !engine.ready} onClick={() => void render()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>} {busy ? 'Making your take…' : 'Render take'}<ArrowUpRight size={18}/></button>{!engine.ready && <button className="setup-link" onClick={() => setEngineOpen(true)}>Connect your local engine <ArrowUpRight size={11}/></button>}{hasOutput && <a className="download-video" href={take!.output} download><Download size={14}/>Download video</a>}{take?.guideOutput && <a className="download-video" href={take.guideOutput} download><Download size={14}/>Download motion guide</a>}<button className="export-workflow" disabled={!recipe || (!isCinema && !recipe.cue.strokes.some(s => s.mode !== 'erase'))} onClick={() => void exportWorkflow()}><ArrowDownToLine size={12}/>Export ComfyUI workflow</button></div></aside>
    <footer className="statusbar"><span><i className="dot ready"/> YOUR CLIP. YOUR MODELS. YOUR CALL.</span><span>Built with Comfy <b>↗</b><i/>AFTERTAKE 0.1</span></footer>
    <input type="file" ref={fileInput} hidden accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v,image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/><input type="file" ref={recipeInput} hidden accept="application/json,.json" onChange={e => { void importRecipe(e.target.files?.[0]); e.target.value = ''; }}/>
    {libraryOpen && <RecipeLibrary current={recipe} busy={busy} onClose={() => setLibraryOpen(false)} onApply={useTemplate} onOpen={openExample}/>}
    {sourceOpen && <div className="modal-backdrop" onClick={() => setSourceOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="Source clips" onClick={e => e.stopPropagation()}><button className="modal-close" title="Close source clips" onClick={() => setSourceOpen(false)}><X size={19}/></button><div className="eyebrow">SOURCE MATERIAL</div><h2>Choose a moment.</h2><div className="source-choices">{clips.map(clip => <button key={clip.id} onClick={() => selectClip(clip)}><Film size={17}/><span><strong>{clip.name}</strong><small>{clip.width} x {clip.height} - {clip.kind === 'image' ? 'still image' : `${clip.duration.toFixed(1)} seconds`}</small></span></button>)}</div><button className="button" onClick={() => fileInput.current?.click()}><Plus size={15}/>Import source</button></section></div>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button title="Dismiss" onClick={() => setToast('')}><X size={15}/></button></div>}
    {(engineOpen || helpOpen) && <div className="modal-backdrop" onClick={() => { setEngineOpen(false); setHelpOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-label={engineOpen ? 'Local engine' : 'How Aftertake works'} onClick={e => e.stopPropagation()}><button className="modal-close" title="Close" onClick={() => { setEngineOpen(false); setHelpOpen(false); }}><X size={19}/></button>{engineOpen ? <><div className="eyebrow">YOUR RENDER ENGINE</div><h2>{engine.ready ? 'Ready when you are.' : 'Bring your own horsepower.'}</h2><p>{engine.message}</p>{engine.gpu && <div className="gpu-detail">{engine.gpu}</div>}{engine.missing.length > 0 && <ul>{engine.missing.map(item => <li key={item}>{item}</li>)}</ul>}<p>The studio uses the official Comfy SDK and a local Comfy v2 proxy. Install the runtime first, then run the engine and studio in separate terminals:</p><pre>python scripts/setup.py{recipe?.pipeline === 'inpaint' || isCinema ? ' --inpaint' : ''}{'\n'}python scripts/engine.py{'\n'}pnpm dev</pre>{recipe?.pipeline === 'inpaint' && <><p>Masked edits also need the <a href="https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-In-Outpainting" target="_blank" rel="noreferrer">inpainting adapter from Lightricks</a>. Complete its publisher access flow, download the file, then run:</p><pre>python scripts/import-adapter.py /path/to/ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors</pre></>}{isCinema && <p>Optional framing tracks need the public motion-control adapter:</p>}{isCinema && <pre>python scripts/download-models.py --motion</pre>}<small>{recipe?.pipeline === 'inpaint' || isCinema ? 'This profile downloads approximately 42 GB of weights.' : 'This profile downloads approximately 28 GB of weights.'} Runtime and model files stay outside the source repository.</small></> : <><div className="eyebrow">THE AFTERTAKE METHOD</div><h2>Small cues.<br/>Impossible consequences.</h2><ol><li><strong>Bring a moment.</strong> Import a short, steady video. The included room is an original procedural camera study.</li><li><strong>Paint the possibility.</strong> Brush over a region, then choose when the transformation appears.</li><li><strong>Direct the change.</strong> Pick an exploration or write your own visual direction. Render with local open weights.</li><li><strong>Pass it on.</strong> Export the video, share the recipe with the source, or open the graph in ComfyUI.</li></ol><p>Outside the cue, the composite keeps the source pixels before video encoding. Generative results inside the cue are experimental; explore a few takes.</p><small>Space: play/pause · Ctrl/Cmd + Z: undo stroke · Drop a clip anywhere on the viewer.</small></>}</section></div>}
  </div>;
}
