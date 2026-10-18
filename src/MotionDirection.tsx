import { useEffect, useRef, useState } from 'react';
import { motionGenerationKey, type Clip, type Recipe } from './domain';
import { apiFetch, browserDemo } from './transport';
import {focusFromPaint,type MotionFocus} from './motion-focus';

export default function MotionDirection({ recipe, disabled, onChange }: {
  recipe: Recipe; disabled: boolean; onChange: (transfer: NonNullable<Recipe['transfer']>) => void;
}) {
  const transfer = recipe.transfer || { scope: 'frame' as const };
  const context=motionGenerationKey(recipe),rawInput=useRef<HTMLInputElement>(null),matteInput=useRef<HTMLInputElement>(null);
  const [generation,setGeneration]=useState<Clip|undefined>(transfer.finish?.generation),[matte,setMatte]=useState<Clip|undefined>(transfer.finish?.matte);
  const [uploading,setUploading]=useState(false),[error,setError]=useState('');
  const sceneMatched=!!transfer.reference && Math.abs(Math.log((transfer.reference.width/transfer.reference.height)/(recipe.clip.width/recipe.clip.height)))<.06;
  function changeFocus(key:keyof NonNullable<MotionFocus>,value:number){
    if(!transfer.focus || !Number.isFinite(value))return;
    const focus={...transfer.focus};
    if(key==='x'||key==='y')focus[key]=Math.max(0,Math.min(1-focus[key==='x'?'width':'height'],value/100));
    else focus[key]=Math.max(.05,Math.min(1-focus[key==='width'?'x':'y'],value/100));
    onChange({...transfer,focus});
  }
  useEffect(()=>{setGeneration(transfer.finish?.generation);setMatte(transfer.finish?.matte);},[context,transfer.finish?.generation.sha256,transfer.finish?.matte.sha256]);
  async function importClip(file:File|undefined,kind:'generation'|'matte'){
    if(!file)return;setError('');setUploading(true);
    try{
      if(file.size>100*1024*1024)throw Error('Use a short video under 100 MB.');
      const response=await apiFetch('/api/clips?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      const clip=await response.json();if(!response.ok)throw Error(clip.error || 'Could not import this video.');
      const pair={generation:kind==='generation'?clip:generation,matte:kind==='matte'?clip:matte};
      if(kind==='generation')setGeneration(clip);else setMatte(clip);
      if(pair.generation && pair.matte)onChange({...transfer,finish:{generation:pair.generation,matte:pair.matte,settingsKey:context}});
    }catch(error){setError((error as Error).message);}finally{setUploading(false);}
  }
  return <section className="motion-direction" aria-label="Motion transfer direction">
    <label htmlFor="motion-caption">DRIVING MOTION <span>OPTIONAL</span></label>
    <textarea id="motion-caption" disabled={disabled} value={transfer.motionCaption || ''} maxLength={2000}
      placeholder="A person raises one arm, waves, then lowers it. The camera stays still."
      onChange={event => onChange({ ...transfer, motionCaption: event.target.value })}/>
    <p>Describe the action in the driving video. Your direction above describes the finished character and scene.</p>
    <label htmlFor="motion-strength">MOTION STRENGTH <span>{(transfer.poseStrength ?? 1).toFixed(2)}×</span></label>
    <div className="motion-strength-control">
      <input id="motion-strength" type="range" aria-label="Motion strength" aria-describedby="motion-strength-help" min="0.5" max="1.5" step="0.01"
        disabled={disabled} value={transfer.poseStrength ?? 1} onChange={event => onChange({ ...transfer, poseStrength: Number(event.target.value) })}/>
      <button type="button" aria-label="Reset motion strength" disabled={disabled || (transfer.poseStrength ?? 1) === 1}
        onClick={() => onChange({ ...transfer, poseStrength: undefined })}>Reset</button>
    </div>
    <p id="motion-strength-help">Lower values loosen motion; higher values emphasize it and may exaggerate details. Start at 1.</p>
    <label htmlFor="motion-scope">WHERE TO APPLY IT</label>
    <select id="motion-scope" disabled={disabled} value={transfer.scope} onChange={event => onChange({ ...transfer, scope: event.target.value as 'frame' | 'cue',...(event.target.value==='frame'?{finish:undefined,focus:undefined}:{}) })}>
      <option value="frame">Whole frame</option><option value="cue">Painted and timed cue</option>
    </select>
    <p>{transfer.scope === 'frame' ? 'Animate the appearance image for the whole shot. The driving clip supplies timing and source audio.' : 'Blend the generated character and scene into your painted cue. Give the gesture enough room; the source stays outside it.'}</p>
    {transfer.scope==='cue'&&<div className="motion-focus-controls">
      <label><input type="checkbox" aria-label="Focus on one performer" checked={!!transfer.focus} disabled={disabled || (!sceneMatched && !transfer.focus)}
        onChange={event=>onChange({...transfer,focus:event.target.checked?focusFromPaint(recipe):undefined})}/> Focus on one performer <b>EXPERIMENTAL</b></label>
      <p>{sceneMatched?'Keep the whole gesture inside the box. Matching source and appearance frames share this crop; the result returns to its original position before your cue is applied.':'Choose a scene-matched appearance frame with the same aspect ratio to focus a performer.'}</p>
      {transfer.focus&&<div className="motion-focus-fields">{(['x','y','width','height']as const).map(key=><label key={key}>{({x:'Left',y:'Top',width:'Width',height:'Height'})[key]} %<input type="number" aria-label={`Performer focus ${key}`} min={key==='x'||key==='y'?0:5} max="100" step=".25" value={Number((transfer.focus![key]*100).toFixed(2))} disabled={disabled} onChange={event=>changeFocus(key,Number(event.target.value))}/></label>)}</div>}
    </div>}
    {transfer.scope==='cue'&&<details className="motion-matte"><summary>Finish a saved generation with a tracked matte</summary>
      <p>Import the raw generation from the matching take and a full-length video matte. White keeps the generated subject; black protects the source. The next render composites those exact frames without sampling a new performance.</p>
      <input hidden type="file" accept="video/*,.mp4,.mkv,.mov" ref={rawInput} onChange={e=>{void importClip(e.target.files?.[0],'generation');e.target.value='';}}/>
      <input hidden type="file" accept="video/*,.mp4,.mkv,.mov" ref={matteInput} onChange={e=>{void importClip(e.target.files?.[0],'matte');e.target.value='';}}/>
      <button className="button" disabled={disabled || uploading || browserDemo} onClick={()=>rawInput.current?.click()}>Import raw generation</button>
      <button className="button" disabled={disabled || uploading || browserDemo} onClick={()=>matteInput.current?.click()}>Import video matte</button>
      <p>{generation?`Raw: ${generation.name}`:'Choose the raw MP4 with its Aftertake receipt.'}<br/>{matte?`Matte: ${matte.name}`:'Choose a matte matching the whole shot.'}</p>
      {transfer.finish&&<><p>Saved frames selected. Changing generation settings clears this pair. Timing, paint and color matching remain editable.</p><button onClick={()=>{setGeneration(undefined);setMatte(undefined);onChange({...transfer,finish:undefined});}}>Clear saved generation and matte</button></>}
      {uploading&&<p role="status">Importing video…</p>}{error&&<p role="alert">{error}</p>}
    </details>}
  </section>;
}
