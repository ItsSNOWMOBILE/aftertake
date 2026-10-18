import {z} from 'zod';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import type {Clip,Engine} from '../src/domain.js';
import {characterRequestSchema,characterSelectionSchema,type CharacterJob} from '../src/character.js';
import {clipMediaRoute} from './generation-tools.js';
type Result={data:any;images?:{data:string;mimeType:string}[]};
type Register=(name:string,description:string,schema:z.ZodType,run:(input:any)=>Promise<Result>,readOnly?:boolean)=>void;
const requestId=z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function summary(job:CharacterJob){return {id:job.id,kind:job.kind,state:job.state,stage:job.stage,progress:job.progress,
  error:job.error,jobId:job.jobId,requestKey:job.requestKey,selection:job.selection,clip:job.clip,request:job.request};}
export function registerCharacterTools({tool,api,bytes,root,python,state}: {tool:Register;
  api:<T=any>(route:string,body?:unknown,key?:string)=>Promise<T>;bytes:(route:string)=>Promise<Buffer>;root:string;python:string;state:string}){
  tool('aftertake_character_workspace','Inspect character replacement profiles, studio sources/photos, saved person selections and completed character takes. Track a person, inspect the actual overlay, then replace them from an original reference photo.',z.object({}),async()=>{
    const[jobs,clips,selectionEngine,renderEngine]=await Promise.all([api<CharacterJob[]>('/api/characters'),api<Clip[]>('/api/clips'),
      api<Engine>('/api/engine?pipeline=character-selection'),api<Engine>('/api/engine?pipeline=character-swap')]);
    return {data:{selectionEngine,renderEngine,clips,jobs:jobs.slice(0,25).map(summary),workflow:[
      'Use one continuous source shot, 1–15 seconds. Select points on one person; exclusion points disambiguate other people.',
      'Call aftertake_track_character with a stable requestId, then inspect its real tracked overlay with aftertake_inspect_character.',
      'Reject missing limbs, other selected people or lost tracking. Make a deliberate new selection if necessary.',
      'Use the original photo directly. An optional faceBox crops the real head; it does not generate a new face.',
      'Call aftertake_replace_character with the inspected mask hash and a separate stable requestId. Timeouts require status/reconciliation, not a new request.',
      'Inspect the resulting clip for likeness, hands, occlusions and continuation joins. Technical checks do not certify appearance.',
      'A completed take is a studio clip. Inspect or promote its clipId with the existing studio-to-film tools, then edit it in the same film plan.'
    ]}};
  });
  tool('aftertake_track_character','Track a user-selected person with native SAM3 and save a lossless mask plus review video. Keep this requestId and the original inputs to rejoin the same SDK job.',
    z.object({requestId,request:characterSelectionSchema}),async input=>({data:summary(await api<CharacterJob>('/api/characters/selections',input.request,input.requestId))}),false);
  tool('aftertake_replace_character','Replace the reviewed person with a reference photo using native H3 Character Swap V1.5. Supply the inspected mask hash. Preserves the source performance and audio; likeness and articulation require visual review.',
    z.object({requestId,maskSha256:digest,request:characterRequestSchema}),async input=>{
      const selection=await api<CharacterJob>('/api/characters/'+input.request.selectionId);
      if(selection.kind!=='selection'||selection.state!=='succeeded'||selection.selection?.emptyFrames.length||selection.selection?.maskSha256!==input.maskSha256)
        throw Error('That mask differs from the inspected selection. Review the current overlay before replacing the character.');
      return {data:summary(await api<CharacterJob>('/api/characters/replacements',input.request,input.requestId))};
    },false);
  tool('aftertake_character_status','Rejoin a recorded character job by its stable requestId or native record id. Reading status never launches another generation.',
    z.object({id:uuid.optional(),requestId:requestId.optional()}).refine(v=>!!v.id!==!!v.requestId,'Choose exactly one id or requestId.'),async input=>{
      const job=input.id?await api<CharacterJob>('/api/characters/'+input.id):(await api<CharacterJob[]>('/api/characters')).find(j=>j.requestKey===input.requestId);
      if(!job)throw Error('No saved character job matches that identifier.');return {data:summary(job)};
    });
  tool('aftertake_character_action','Cancel active character work or reconcile an uncertain submission/output download using its original record and SDK key. Does not create a replacement job.',
    z.object({id:uuid,action:z.enum(['cancel','reconcile'])}),async input=>({data:summary(await api<CharacterJob>(`/api/characters/${input.id}/${input.action}`,{}))}),false);
  tool('aftertake_inspect_character','Decode real review frames from a completed SAM3 overlay or H3 take. Inspect the selected person, fingers, hair, props and background before accepting a mask or using the result.',
    z.object({id:uuid,times:z.array(z.number().min(0).max(15)).min(1).max(8).default([0])}),async input=>{
      const job=await api<CharacterJob>('/api/characters/'+input.id);
      if(job.state!=='succeeded')throw Error('Wait for this character job to finish before inspecting its frames.');
      const duration=job.kind==='selection'?(job.selection?.frames||0)/24:job.clip?.duration||0;
      if(input.times.some((t:number)=>t>=duration))throw Error('Choose review times inside the completed video.');
      const route=job.kind==='selection'?`/api/characters/${job.id}/preview`:clipMediaRoute(job.clip!);
      const data=await bytes(route),sha256=hash(data);
      if(job.clip&&sha256!==job.clip.sha256)throw Error('The character video differs from its saved bytes.');
      const folder=path.join(state,'character-review',sha256);await mkdir(folder,{recursive:true});
      const source=path.join(folder,'source.mp4');await writeFile(source,data);
      const images=[],frames=[];const exec=promisify(execFile);
      for(const time of input.times){const file=path.join(folder,`frame-${String(time).replace('.','_')}.jpg`);
        await exec(python,[path.join(root,'scripts/thumbnail.py'),source,file,String(time),'960'],{timeout:30000,windowsHide:true,
          env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'}});
        images.push({mimeType:'image/jpeg',data:(await readFile(file)).toString('base64')});frames.push({time,file});}
      return {data:{id:job.id,kind:job.kind,sha256,maskSha256:job.selection?.maskSha256,duration,frames,note:'Actual decoded frames. Review appearance and motion; frame clocks alone do not prove quality.'},images};
    });
  tool('aftertake_character_recipe','Retrieve the source-bound selection, original reference/crop, seed, SDK job id, actual executed graph and output hash for a character take.',
    z.object({id:uuid}),async({id})=>{
      const job=await api<CharacterJob>('/api/characters/'+id),selection=job.kind==='selection'?job:
        await api<CharacterJob>('/api/characters/'+('selectionId'in job.request?job.request.selectionId:''));
      return {data:{format:'aftertake-character-recipe/1',selection:selection.request,replacement:job.kind==='replacement'?job.request:undefined,
        workflow:job.workflow,jobId:job.jobId,output:job.clip,selectionInfo:selection.selection}};
    });
}
