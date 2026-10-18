import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Download,LoaderCircle,Plus,RotateCcw,ScanFace,Upload,X} from 'lucide-react';
import {apiFetch,browserDemo,mediaUrl} from './transport';
import {findImportedClip,type Clip,type Engine} from './domain';
import {characterBusy,characterRequestSchema,characterSelectionKey,characterSelectionSchema,
  type CharacterJob,type CharacterRequest,type CharacterSelectionRequest} from './character';
import './character-studio.css';

async function api<T>(url:string,init?:RequestInit){
  const response=await apiFetch(url,init),body=await response.json();
  if(!response.ok)throw Object.assign(Error(body.error||'Character request failed.'),{character:body.character});return body as T;
}
function download(value:unknown,filename='aftertake-character-recipe.json'){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
type Point={x:number;y:number};
type FaceBox=NonNullable<CharacterRequest['faceBox']>;
export default function CharacterStudio({clips,jobs,initialSource,otherBusy,onUpdate,onImport,onUse,onClose,onFilmAdded}:{
  clips:Clip[];jobs:CharacterJob[];initialSource?:Clip;otherBusy:boolean;onUpdate:(job:CharacterJob)=>void;
  onImport:(clip:Clip)=>void;onUse:(clip:Clip)=>void;onClose:()=>void;onFilmAdded?:()=>void;
}){
  const videos=clips.filter(c=>c.kind!=='image'),photos=clips.filter(c=>c.kind==='image');
  const [sourceId,setSourceId]=useState(initialSource?.kind!=='image'?initialSource?.id||videos[0]?.id||'':videos[0]?.id||'');
  const source=videos.find(c=>c.id===sourceId);
  const [referenceId,setReferenceId]=useState(photos[0]?.id||''),[trimStart,setTrimStart]=useState(0);
  const reference=photos.find(c=>c.id===referenceId);
  const [duration,setDuration]=useState(Math.min(5,source?.duration||5)),[positive,setPositive]=useState<Point[]>([]),[negative,setNegative]=useState<Point[]>([]);
  const [pointMode,setPointMode]=useState<'positive'|'negative'>('positive'),[cursor,setCursor]=useState<Point>({x:.5,y:.5});
  const [selectionId,setSelectionId]=useState(''),[resultId,setResultId]=useState('');
  const [sourceReviewId,setSourceReviewId]=useState('');
  const [name,setName]=useState('A new character, the same moment'),[prompt,setPrompt]=useState(''),[seed,setSeed]=useState(509101);
  const [faceBox,setFaceBox]=useState<FaceBox>(),[faceDraft,setFaceDraft]=useState<FaceBox>();
  const [wardrobe,setWardrobe]=useState<'reference'|'source'>('reference');
  const [view,setView]=useState<'frame'|'source'|'selection'|'result'>('frame');
  const [sending,setSending]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [engine,setEngine]=useState<Engine|null>(null),[selectionEngine,setSelectionEngine]=useState<Engine|null>(null);
  const dialog=useRef<HTMLElement>(null),fileInput=useRef<HTMLInputElement>(null),recipeInput=useRef<HTMLInputElement>(null);
  const uploadRole=useRef<'source'|'reference'>('source'),faceStart=useRef<Point|null>(null);
  const pending=jobs.find(characterBusy),locked=sending||uploading||Boolean(pending)||otherBusy;
  const selectionRequest:CharacterSelectionRequest|undefined=source?{format:'aftertake-character-selection/1',clip:source,trimStart,duration,positive,negative}:undefined;
  const key=selectionRequest?characterSelectionKey(selectionRequest):'';
  const matching=jobs.filter(j=>j.kind==='selection'&&characterSelectionKey(j.request as CharacterSelectionRequest)===key);
  const selection=matching.find(j=>j.id===selectionId)||matching[0];
  const selectionReady=selection?.state==='succeeded'&&selection.selection&&!selection.selection.emptyFrames.length;
  const replacements=jobs.filter(j=>j.kind==='replacement'&&jobs.some(s=>s.id===(j.request as CharacterRequest).selectionId&&s.kind==='selection'&&(s.request as CharacterSelectionRequest).clip.sha256===source?.sha256));
  const viewed=replacements.find(j=>j.id===resultId)||replacements[0];
  const resultSelection=viewed?jobs.find(j=>j.id===(viewed.request as CharacterRequest).selectionId):undefined;
  const sourceReview=jobs.find(j=>j.id===sourceReviewId)||selection;
  const sourceRange=sourceReview?.request as CharacterSelectionRequest|undefined;
  const request:CharacterRequest|undefined=reference&&selection?{format:'aftertake-character/1',name,selectionId:selection.id,reference:{...reference,kind:'image'},faceBox,wardrobe,prompt,seed}:undefined;
  const previewSelection=view==='source'?sourceReview:selection;
  const aspect=view==='result'&&viewed?.clip?viewed.clip.width/viewed.clip.height:(view==='selection'||view==='source')&&previewSelection?.selection?previewSelection.selection.width/previewSelection.selection.height:(source?source.width/source.height:16/9);
  useEffect(()=>{
    const old=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    return()=>{if(old?.isConnected)old.focus();};
  },[]);
  useEffect(()=>{let live=true;const check=()=>Promise.all([api<Engine>('/api/engine?pipeline=character-swap'),api<Engine>('/api/engine?pipeline=character-selection')]).then(([all,selection])=>{if(live){setEngine(all);setSelectionEngine(selection);}}).catch(()=>{});
    void check();const id=setInterval(check,5000);return()=>{live=false;clearInterval(id);};},[]);
  function changeSource(id:string){const clip=videos.find(c=>c.id===id);setSourceId(id);setTrimStart(0);setDuration(Math.min(5,clip?.duration||5));setPositive([]);setNegative([]);setSelectionId('');setResultId('');setView('frame');setError('');}
  function range(start:number,length:number){if(!source)return;setTrimStart(Math.max(0,Math.min(source.duration-1,start)));setDuration(Math.max(1,Math.min(15,source.duration-start,length)));setPositive([]);setNegative([]);setSelectionId('');setView('frame');}
  function point(event:React.PointerEvent<HTMLElement>):Point{const b=event.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))};}
  function addPoint(p:Point){if(locked||!source)return;const list=pointMode==='positive'?positive:negative;if(list.length>=12){setError('Use up to 12 points of each kind. Clear a point before adding another.');return;}
    (pointMode==='positive'?setPositive:setNegative)([...list,p]);setSelectionId('');setView('frame');setError('');}
  function focusCoordinate(field:keyof FaceBox,value:number){if(!faceBox||!Number.isFinite(value))return;
    const box={...faceBox,[field]:value/100};
    box.x=Math.max(0,Math.min(.95,box.x));box.y=Math.max(0,Math.min(.95,box.y));
    box.width=Math.max(.05,Math.min(1-box.x,box.width));box.height=Math.max(.05,Math.min(1-box.y,box.height));
    setFaceBox(box);setError('');}
  async function upload(file?:File){if(!file)return;setUploading(true);setError('');try{
    const clip=await api<Clip>(`/api/clips?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});onImport(clip);
    if(uploadRole.current==='reference'){if(clip.kind!=='image')throw Error('Choose a still photo for the character reference.');setReferenceId(clip.id);setFaceBox(undefined);}
    else{if(clip.kind==='image')throw Error('Choose a video for the source performance.');setSourceId(clip.id);setTrimStart(0);setDuration(Math.min(5,clip.duration));setPositive([]);setNegative([]);setSelectionId('');setView('frame');}
  }catch(e){setError((e as Error).message);}finally{setUploading(false);}}
  async function submit(kind:'selection'|'replacement'){
    setSending(true);setError('');setNotice('');try{
      const body=kind==='selection'?characterSelectionSchema.parse(selectionRequest):characterRequestSchema.parse(request);
      const job=await api<CharacterJob>(`/api/characters/${kind==='selection'?'selections':'replacements'}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});
      onUpdate(job);if(kind==='selection'){setSelectionId(job.id);setView('selection');}else{setResultId(job.id);setView('result');}
    }catch(e){const failure=e as Error&{character?:CharacterJob};if(failure.character){onUpdate(failure.character);
      if(failure.character.kind==='selection'){setSelectionId(failure.character.id);setView('selection');}
      else{setResultId(failure.character.id);setView('result');}}
      setError(failure.message);}finally{setSending(false);}
  }
  async function act(job:CharacterJob,action:'cancel'|'reconcile'){setSending(true);setError('');try{onUpdate(await api<CharacterJob>(`/api/characters/${job.id}/${action}`,{method:'POST'}));}catch(e){setError((e as Error).message);}finally{setSending(false);}}
  function reuse(job:CharacterJob){const r=job.request as CharacterRequest,s=jobs.find(j=>j.id===r.selectionId);if(!s)return setError('This result is missing its original person selection.');
    const selected=s.request as CharacterSelectionRequest,clip=findImportedClip(clips,selected.clip),photo=findImportedClip(clips,r.reference);
    if(!clip||!photo)return setError('Import the matching source video and character photo before reusing this recipe.');
    setSourceId(clip.id);setReferenceId(photo.id);setTrimStart(selected.trimStart);setDuration(selected.duration);setPositive(selected.positive);setNegative(selected.negative);
    setSelectionId(s.id);setName(r.name);setPrompt(r.prompt);setSeed(r.seed);setFaceBox(r.faceBox);setWardrobe(r.wardrobe||'reference');setView('selection');setNotice('Settings restored. Review the selection before creating a new take.');
  }
  async function importRecipe(file?:File){if(!file)return;try{if(file.size>2*1024*1024)throw Error('Use a character recipe under 2 MB.');
    const value=JSON.parse(await file.text());if(value.format!=='aftertake-character-recipe/1')throw Error('Choose an Aftertake character recipe.');
    const s=characterSelectionSchema.parse(value.selection),clip=findImportedClip(clips,s.clip);if(!clip)throw Error(`Import the matching source video first: ${s.clip.name}`);
    setSourceId(clip.id);setTrimStart(s.trimStart);setDuration(s.duration);setPositive(s.positive);setNegative(s.negative);setSelectionId('');setView('frame');
    if(value.replacement){const r=characterRequestSchema.parse(value.replacement),photo=findImportedClip(clips,r.reference);setName(r.name);setPrompt(r.prompt);setSeed(r.seed);setFaceBox(r.faceBox);setWardrobe(r.wardrobe||'reference');setReferenceId(photo?.id||'');if(!photo)setNotice(`Import the matching character photo: ${r.reference.name}`);}
  }catch(e){setError((e as Error).message);}}
  async function addToFilm(clip:Clip){setSending(true);setError('');try{const response=await apiFetch(clip.url);if(!response.ok)throw Error('The character video is unavailable.');
    await api(`/api/films/assets?name=${encodeURIComponent(clip.name+'.mp4')}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await response.blob()});onFilmAdded?.();setNotice('Added to film media. Open Film editing to place it in your cut.');
  }catch(e){setError((e as Error).message);}finally{setSending(false);}}
  const focusedFace=faceDraft||faceBox;
  const status=view==='result'?viewed:view==='selection'?selection:pending;
  return <div className="modal-backdrop character-backdrop" onClick={onClose}><section ref={dialog} className="modal character-studio" role="dialog" aria-modal="true" aria-label="Replace a character" onClick={e=>e.stopPropagation()} onKeyDown={event=>{
    if(event.key==='Escape'){event.stopPropagation();onClose();}
    if(event.key==='Tab'){const nodes=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"],summary')||[])].filter(n=>n.getClientRects().length);
      if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0]?.focus();}}
  }}>
    <button className="modal-close" aria-label="Close character studio" onClick={onClose}><X size={19}/></button>
    <div className="eyebrow">CHARACTER REPLACEMENT</div><h2>Same performance. New character.</h2>
    <p className="character-intro">Choose the person in your shot, then replace them with someone from a reference photo. Review the tracked selection before generating.</p>
    <div className="character-grid"><div className="character-view-column">
      <div className="character-view-tabs" aria-label="Character preview"><button className={view==='frame'?'active':''} onClick={()=>setView('frame')}>Select person</button><button disabled={!source} className={view==='source'?'active':''} onClick={()=>{setSourceReviewId(view==='result'?resultSelection?.id||'':'');setView('source');}}>Watch source</button><button disabled={!selection?.selection} className={view==='selection'?'active':''} onClick={()=>setView('selection')}>Tracked selection</button><button disabled={!viewed} className={view==='result'?'active':''} onClick={()=>setView('result')}>Result</button></div>
      <div className={`character-stage ${view==='frame'?'character-pick':''}`} style={{aspectRatio:String(aspect)}} role={view==='frame'?'button':undefined} tabIndex={view==='frame'?0:undefined}
        aria-label={view==='frame'?'Choose the person: click the image, or use arrow keys then Enter to add a point':undefined}
        onPointerDown={e=>{if(view==='frame'){const p=point(e);setCursor(p);addPoint(p);}}} onKeyDown={e=>{
          if(view!=='frame')return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const step=e.shiftKey?.001:.01;setCursor(p=>({x:Math.max(0,Math.min(1,p.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0))),y:Math.max(0,Math.min(1,p.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)))}));}
          if(e.key==='Enter'||e.key===' '){e.preventDefault();addPoint(cursor);}
        }}>
        {view==='frame'&&source?<><img draggable={false} src={mediaUrl(`/api/thumbnails/${source.id}?time=${trimStart}`)} alt="First frame of your selected source range"/>{([...positive.map((p,i)=>({...p,kind:'positive',label:`+${i+1}`})),...negative.map((p,i)=>({...p,kind:'negative',label:`âˆ’${i+1}`}))]).map(p=><span key={p.label} className={`character-point ${p.kind}`} style={{left:`${p.x*100}%`,top:`${p.y*100}%`}}>{p.label}</span>)}<span className="character-keyboard-cursor" style={{left:`${cursor.x*100}%`,top:`${cursor.y*100}%`}}>+</span></>:
          view==='source'&&source?<video key={(sourceReview?.selection?sourceReview.id:source.id)+trimStart} src={mediaUrl(sourceReview?.selection?`/api/characters/${sourceReview.id}/source`:source.url)} controls playsInline onLoadedMetadata={e=>{e.currentTarget.currentTime=sourceReview?.selection?0:trimStart;}} onTimeUpdate={e=>{const start=sourceReview?.selection?0:trimStart;if(e.currentTarget.currentTime>start+(sourceRange?.duration||duration))e.currentTarget.currentTime=start;}}/>:
          view==='selection'&&selection?.selection?<video key={selection.id} src={mediaUrl(`/api/characters/${selection.id}/preview`)} controls playsInline loop/>:
          view==='result'&&viewed?.clip?<video key={viewed.id} src={mediaUrl(viewed.clip.url)} controls playsInline/>:
          <div className="character-empty">{status&&characterBusy(status)?<LoaderCircle className="spin" size={28}/>:<ScanFace size={32}/>}<p>{status&&characterBusy(status)?status.stage||'Preparing your character jobâ€¦':source?'Click the person to begin.':'Import a source video to begin.'}</p></div>}
      </div>
      {view==='frame'&&<><div className="character-point-tools"><button disabled={locked} className={pointMode==='positive'?'active':''} onClick={()=>setPointMode('positive')}>+ Select person</button><button disabled={locked} className={pointMode==='negative'?'active':''} onClick={()=>setPointMode('negative')}>âˆ’ Exclude person</button><button disabled={locked||!(pointMode==='positive'?positive:negative).length} onClick={()=>{(pointMode==='positive'?setPositive:setNegative)(all=>all.slice(0,-1));setSelectionId('');}}>Undo point</button><button disabled={locked||!positive.length&&!negative.length} onClick={()=>{setPositive([]);setNegative([]);setSelectionId('');}}>Clear</button></div><p className="character-hint">Click inside the person you want. Add an exclusion on another person if they overlap. Arrow keys move the keyboard cursor; Enter places a point.</p></>}
      {matching.length>0&&<label className="character-selection-version">TRACKED SELECTION<select aria-label="Tracked selection version" value={selection?.id||''} onChange={e=>{setSelectionId(e.target.value);setView('selection');}}>{matching.map(j=><option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleTimeString()} Â· {j.state.replaceAll('_',' ')}</option>)}</select></label>}
      {selection?.selection&&<p className={`character-selection-status ${selectionReady?'ready':''}`}>{selectionReady?<Check size={14}/>:null}{selection.selection.emptyFrames.length?`Tracking lost the person in ${selection.selection.emptyFrames.length} frames. Choose a clearer or shorter range before replacing them.`:`${selection.selection.frames} tracked frames Â· ${(selection.selection.frames/24).toFixed(2)}s. Check hands, hair and overlapping people in the preview.`}</p>}
      {status?.error&&<p role="alert" className="character-error">{status.error}</p>}
      {status&&['connection_lost','submission_unknown','output_error'].includes(status.state)&&<button className="button" disabled={sending} onClick={()=>void act(status,'reconcile')}>Check this submitted job</button>}
      {view==='result'&&viewed?.clip&&<><div className="character-output-actions"><button className="button" disabled={locked} onClick={()=>{onUse(viewed.clip!);onClose();}}>Use as source<ArrowUpRight size={13}/></button><button className="button" disabled={sending||browserDemo} onClick={()=>void addToFilm(viewed.clip!)}>Add to film</button><a className="button" href={mediaUrl(viewed.clip.url)} download="aftertake-character.mp4"><Download size={13}/>MP4</a><button className="button" onClick={()=>{const s=jobs.find(j=>j.id===(viewed.request as CharacterRequest).selectionId);download({format:'aftertake-character-recipe/1',selection:s?.request,replacement:viewed.request,workflow:viewed.workflow,jobId:viewed.jobId,output:viewed.clip});}}>Recipe â†—</button></div><p className="character-hint">{viewed.clip.width} Ã— {viewed.clip.height} Â· 24 fps Â· seed {(viewed.request as CharacterRequest).seed}. Review identity, hands and motion before using this take.</p><button className="button" disabled={locked} onClick={()=>reuse(viewed)}><RotateCcw size={13}/>Reuse these settings</button></>}
      {view==='result'&&viewed?.clip&&resultSelection&&<details className="character-native-workflow"><summary>Continue in ComfyUI</summary><p className="character-hint">Export the executed API workflow and tracked mask. On this engine, its uploaded source and reference files are already available. On another engine, load the matching original photo, prepared source, mask and original audio source into their loader nodes.</p><div className="character-output-actions"><button className="button" onClick={()=>download(viewed.workflow,'aftertake-character-workflow-api.json')}>ComfyUI workflow â†—</button><a className="button" href={mediaUrl(`/api/characters/${resultSelection.id}/mask`)} download="aftertake-person-mask.mkv">Tracked mask</a><a className="button" href={mediaUrl(`/api/characters/${resultSelection.id}/source`)} download="aftertake-prepared-source.mp4">Prepared source</a></div></details>}
      {replacements.length>0&&<div className="character-history" aria-label="Character take history">{replacements.map(job=><button key={job.id} className={viewed?.id===job.id?'active':''} onClick={()=>{setResultId(job.id);setView('result');}}>{job.clip?<img src={mediaUrl(`/api/thumbnails/${job.clip.id}?time=0`)} alt={(job.request as CharacterRequest).name}/>:<ScanFace size={21}/>}<span>{(job.request as CharacterRequest).name}<small>{job.state.replaceAll('_',' ')}</small></span></button>)}</div>}
    </div><div className="character-controls">
      <button className="character-recipe-import" disabled={locked} onClick={()=>recipeInput.current?.click()}><Upload size={12}/>Import character recipe</button>
      <div className="character-step"><span>01</span><h3>The source performance</h3></div>
      <label>SOURCE VIDEO<select aria-label="Character source video" value={sourceId} disabled={locked} onChange={e=>changeSource(e.target.value)}><option value="">Choose a video</option>{videos.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button className="button" disabled={locked||browserDemo} onClick={()=>{uploadRole.current='source';fileInput.current?.click();}}><Plus size={13}/>Import video</button>
      <div className="character-range"><label>START Â· SECONDS<input aria-label="Character source start" type="number" min={0} max={Math.max(0,(source?.duration||1)-1)} step=".1" value={trimStart} disabled={locked||!source} onChange={e=>range(Number(e.target.value),duration)}/></label><label>LENGTH Â· SECONDS<input aria-label="Character source duration" type="number" min={1} max={Math.min(15,(source?.duration||15)-trimStart)} step=".1" value={duration} disabled={locked||!source} onChange={e=>range(trimStart,Number(e.target.value))}/></label></div>
      <p className="character-hint">Use one continuous shot, 1â€“15 seconds. Changing the range clears the selection points.</p>
      <button className="button character-track" disabled={browserDemo||locked||!selectionEngine?.ready||!characterSelectionSchema.safeParse(selectionRequest).success} onClick={()=>void submit('selection')}>{pending?.kind==='selection'?<LoaderCircle size={14} className="spin"/>:<ScanFace size={14}/>}Track selected person</button>
      <div className="character-step"><span>02</span><h3>The replacement character</h3></div>
      <label>REFERENCE PHOTO<select aria-label="Character reference photo" value={referenceId} disabled={locked} onChange={e=>{setReferenceId(e.target.value);setFaceBox(undefined);}}><option value="">Choose a photo</option>{photos.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button className="button" disabled={locked||browserDemo} onClick={()=>{uploadRole.current='reference';fileInput.current?.click();}}><Upload size={13}/>Import photo</button>
      {reference&&<><div className="character-face-canvas" style={{aspectRatio:String(reference.width/reference.height)}} aria-label="Character photo and optional face focus" onPointerDown={e=>{if(locked)return;faceStart.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!faceStart.current)return;const p=point(e),s=faceStart.current;setFaceDraft({x:Math.min(p.x,s.x),y:Math.min(p.y,s.y),width:Math.abs(p.x-s.x),height:Math.abs(p.y-s.y)});}} onPointerUp={e=>{const s=faceStart.current;faceStart.current=null;setFaceDraft(undefined);if(!s)return;const p=point(e),box={x:Math.min(p.x,s.x),y:Math.min(p.y,s.y),width:Math.abs(p.x-s.x),height:Math.abs(p.y-s.y)};if(box.width>=.05&&box.height>=.05)setFaceBox(box);else setError('Drag a box around the whole head to focus the face.');}} onPointerCancel={()=>{faceStart.current=null;setFaceDraft(undefined);}}><img draggable={false} src={mediaUrl(reference.url)} alt="Your original character photo"/>{focusedFace&&<span className="character-face-box" style={{left:`${focusedFace.x*100}%`,top:`${focusedFace.y*100}%`,width:`${focusedFace.width*100}%`,height:`${focusedFace.height*100}%`}}/>}</div><p className="character-hint">Optional face focus: drag a box around the whole head, including hair and chin. The original photo still supplies clothing.</p>{faceBox&&<button className="button" disabled={locked} onClick={()=>setFaceBox(undefined)}>Clear face focus</button>}</>}
      {reference&&<div className="character-face-controls"><button className="button" disabled={locked} onClick={()=>setFaceBox({x:.3,y:.1,width:.4,height:Math.min(.8,.4*reference.width/reference.height)})}>{faceBox?'Reset face focus':'Add face focus'}</button>{faceBox&&<fieldset disabled={locked}><legend>Face focus Â· percent of photo</legend>{(['x','y','width','height'] as const).map((field,i)=><label key={field}>{['LEFT','TOP','WIDTH','HEIGHT'][i]}<input aria-label={`Face focus ${['left','top','width','height'][i]} percent`} type="number" min={i<2?0:5} max={i<2?95:100} step={.1} value={Math.round(faceBox[field]*1000)/10} onChange={e=>focusCoordinate(field,Number(e.target.value))}/></label>)}</fieldset>}</div>}
      <div className="character-step"><span>03</span><h3>Direct the take</h3></div>
      <label>OUTFIT<select aria-label="Character outfit" value={wardrobe} disabled={locked} onChange={e=>setWardrobe(e.target.value as 'reference'|'source')}><option value="reference">Use the reference photo outfit</option><option value="source">Keep the source outfit</option></select></label>
      <label>TAKE NAME<input aria-label="Character take name" value={name} maxLength={100} disabled={locked} onChange={e=>setName(e.target.value)}/></label>
      <label>EXTRA DIRECTION Â· OPTIONAL<textarea aria-label="Character extra direction" rows={3} value={prompt} maxLength={2000} disabled={locked} placeholder="Preserve the cup and the original gesture." onChange={e=>setPrompt(e.target.value)}/></label>
      <label>SEED<div className="character-seed"><input aria-label="Character seed" type="number" min={0} max={2**32-1} step={1} value={seed} disabled={locked} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n))setSeed(Math.max(0,Math.min(2**32-1,n)));}}/><button className="button" aria-label="New character seed" disabled={locked} onClick={()=>setSeed(crypto.getRandomValues(new Uint32Array(1))[0])}><RotateCcw size={13}/></button></div></label>
      <button className="button character-generate" disabled={browserDemo||locked||!engine?.ready||!selectionReady||!characterRequestSchema.safeParse(request).success} onClick={()=>void submit('replacement')}><ScanFace size={15}/>Replace selected person</button>
      <p className="character-hint">H3 Character Swap V1.5 Â· 24 fps Â· source audio retained. This is generative editing: review the finished likeness and motion.</p>
      {pending&&<div className="character-progress" role="status"><strong>{pending.stage||pending.state.replaceAll('_',' ')}</strong>{pending.progress!==null&&<span>{Math.round(pending.progress*100)}% reported by Comfy</span>}{pending.jobId&&pending.state!=='finalizing'&&<button disabled={sending} onClick={()=>void act(pending,'cancel')}>Cancel job</button>}</div>}
      {otherBusy&&!pending&&<p className="character-hint">Another generation is active. You can review character takes while it finishes.</p>}
      {browserDemo?<p className="character-install">Character replacement runs in the local studio. <a href="../cast/h3.html" target="_blank" rel="noreferrer">Review the recorded H3 take and workflow ↗</a>, or install the optional character profile to generate your own take.</p>:engine&&!engine.ready&&<details className="character-install" open><summary>{engine.connected?'Install the character profile':'Start the local engine'}</summary><pre>python scripts/setup.py --character-swap</pre><p>The full profile is 43.9 GB, including SAM3. Models keep their publishersâ€™ licenses.</p><pre>python scripts/engine.py --safe-weight-copies --no-node-cache</pre><p>FFmpeg and FFprobe must be on the engine PATH. Use <code>--ffmpeg-bin</code> if they are installed in another folder.</p>{engine.missing.map(item=><small key={item}>{item}<br/></small>)}</details>}
      <a className="character-model-link" href="https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA" target="_blank" rel="noreferrer">Model details and usage terms â†—</a>
      {notice&&<p className="character-notice" role="status">{notice}</p>}{error&&<p className="character-error" role="alert">{error}</p>}
      <input ref={fileInput} type="file" hidden accept="video/*,image/png,image/jpeg,image/webp,.mkv" onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/>
      <input ref={recipeInput} type="file" hidden accept="application/json,.json" onChange={e=>{void importRecipe(e.target.files?.[0]);e.target.value='';}}/>
    </div></div>
  </section></div>;
}
