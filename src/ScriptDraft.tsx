import{useEffect,useState}from'react';
import{Sparkles,LoaderCircle}from'lucide-react';
import{apiFetch,browserDemo}from'./transport';
import{canonicalJSON}from'./narrated-cut';
import{scriptRequestSchema,type ScriptDraft as Draft}from'./script-draft';

type Picture={key:string;name:string;seconds:number};
function saved<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
async function request(route:string,body?:unknown){const r=await apiFetch('/api/script-drafts'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not draft these lines.');return data;}

export default function ScriptDraft({pictures,disabled,onUse}:{pictures:Picture[];disabled:boolean;onUse:(lines:string[])=>void}){
  const[brief,setBrief]=useState<string>(()=>saved('aftertake-script-brief','')),[closing,setClosing]=useState<string>(()=>saved('aftertake-script-closing',''));
  const[descriptions,setDescriptions]=useState<Record<string,string>>(()=>saved('aftertake-script-pictures',{}));
  const[variation,setVariation]=useState<number>(()=>saved('aftertake-script-variation',0));
  const[job,setJob]=useState<Draft|null>(null),[error,setError]=useState(''),[sending,setSending]=useState(false),[health,setHealth]=useState<{ready:boolean;error?:string}|null>(null);
  const[loaded,setLoaded]=useState(false);
  const input=scriptRequestSchema.safeParse({brief,closingLine:closing,variation,pictures:pictures.map(p=>({...p,name:descriptions[p.key]??p.name}))});
  const current=!!(job&&input.success&&canonicalJSON(job.request)===canonicalJSON(input.data)),busy=sending||job?.state==='drafting';
  useEffect(()=>{localStorage.setItem('aftertake-script-brief',JSON.stringify(brief));},[brief]);
  useEffect(()=>{localStorage.setItem('aftertake-script-closing',JSON.stringify(closing));},[closing]);
  useEffect(()=>{localStorage.setItem('aftertake-script-pictures',JSON.stringify(descriptions));},[descriptions]);
  useEffect(()=>{localStorage.setItem('aftertake-script-variation',JSON.stringify(variation));},[variation]);
  useEffect(()=>{
    if(browserDemo)return;let canceled=false;
    void request('/health').then(data=>{if(!canceled)setHealth(data);}).catch(()=>{if(!canceled)setHealth({ready:false,error:'The local script service is unavailable. Restart the studio with the current code.'});});
    const id=saved<string>('aftertake-script-job','');
    if(id)void request('/'+encodeURIComponent(id)).then(data=>{if(!canceled)setJob(data);}).catch(()=>{}).finally(()=>{if(!canceled)setLoaded(true);});else setLoaded(true);
    return()=>{canceled=true;};
  },[]);
  useEffect(()=>{
    if(!job||!['drafting','interrupted'].includes(job.state))return;let canceled=false;
    const timer=setInterval(()=>{void request('/'+job.id).then(data=>{if(!canceled)setJob(data);}).catch(err=>{if(!canceled)setError(err.message);});},1200);
    return()=>{canceled=true;clearInterval(timer);};
  },[job?.id,job?.state]);
  async function draft(){
    if(!input.success||busy)return;setSending(true);setError('');
    const next=job&&current?variation+1:variation;
    try{const result:Draft=await request('',{...input.data,variation:next});setVariation(next);setJob(result);localStorage.setItem('aftertake-script-job',JSON.stringify(result.id));}
    catch(error){setError((error as Error).message);}finally{setSending(false);}
  }
  async function rejoin(){if(!job||sending)return;setSending(true);setError('');try{setJob(await request('/'+job.id+'/reconcile',{}));}catch(err){setError((err as Error).message);}finally{setSending(false);}}
  return <details className="script-draft"><summary><Sparkles size={13}/><strong>Draft from a brief</strong><span>Optional · local script model</span></summary>
    <p>Describe the product, audience and tone. Give each picture a useful description; this text model uses your words to suggest short spoken lines.</p>
    <label>Your brief<textarea aria-label="Script brief" rows={3} maxLength={1600} value={brief} disabled={disabled||busy} placeholder="Coffee beans for slow morning coffee fans. Warm, simple language. Use only these facts." onChange={event=>setBrief(event.target.value)}/></label>
    <label>Closing line · optional<input aria-label="Script closing line" maxLength={100} value={closing} disabled={disabled||busy} placeholder="Make mornings yours." onChange={event=>setClosing(event.target.value)}/></label>
    <div className="script-pictures">{pictures.map((picture,index)=><label key={picture.key}>Picture {index+1} · {picture.seconds.toFixed(2)}s<input aria-label={`Picture ${index+1} description`} maxLength={160} value={descriptions[picture.key]??picture.name} disabled={disabled||busy} onChange={event=>setDescriptions(all=>({...all,[picture.key]:event.target.value}))}/></label>)}</div>
    <div className="narrated-actions"><button className="film-import" disabled={browserDemo||disabled||busy||!loaded||!health?.ready||!input.success||variation>=999||job?.state==='interrupted'} onClick={()=>void draft()}>{busy?<LoaderCircle className="spin" size={13}/>:<Sparkles size={13}/>} {busy?'Drafting locally…':job&&current?'Draft another version':'Draft spoken lines'}</button></div>
    {!browserDemo&&health&&!health.ready&&<p>{health.error||<>Install the optional script model to draft locally: <code>python scripts/setup-script.py</code>. You can always write your lines below.</>}</p>}
    {browserDemo&&<p>Local script drafting runs in the installed studio. Your written lines stay editable here.</p>}
    {job?.state==='interrupted'&&<div className="script-rejoin"><p>The studio restarted during this draft. Rejoin the same request to collect or resume it.</p><button className="film-import" disabled={disabled||sending} onClick={()=>void rejoin()}>Rejoin script draft</button></div>}
    {job?.state==='failed'&&<p role="alert">{job.error}</p>}{error&&<p role="alert">{error}</p>}
    {job?.state==='ready'&&job.result&&<div className="script-candidate"><strong>Review the draft</strong><p>Check that the lines describe your product accurately. Use them to replace the written lines below, then edit before preparing the film.</p><ol>{job.result.lines.map((line,index)=><li key={index}>{line}</li>)}</ol>
      <button className="film-import" disabled={disabled||!current||busy} onClick={()=>onUse(job.result!.lines)}>Use these draft lines</button>
      {!current&&<p>The brief, pictures or closing line changed. Draft again to match them.</p>}
      <details className="script-receipt"><summary>Local draft details</summary><p>{job.result.receipt.model} · {job.result.receipt.deviceName} · {job.result.receipt.generationSeconds.toFixed(1)}s generation. Original wording is a model suggestion; every spoken line remains editable.</p></details>
    </div>}
  </details>;
}
