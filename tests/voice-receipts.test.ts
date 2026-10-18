import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {filmRouter} from '../server/films.js';
import {filmManifestSchema,portableVoiceSource,type FilmAsset} from '../src/film.js';

const pictureId='00000000-0000-4000-8000-000000000001',voiceId='00000000-0000-4000-8000-000000000002';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const voice:FilmAsset={id:voiceId,name:'voice.wav',kind:'audio',extension:'.wav',url:'/unused',createdAt:new Date().toISOString(),duration:1.25,sha256:digest('voice bytes'),
 narration:{text:'Hello world.',voice:'af_heart',speed:1.05,timedWords:true,model:'Kokoro',modelSha256:'a'.repeat(64),voicesSha256:'b'.repeat(64),runner:'CPU',
  wordTiming:{method:'kokoro-phoneme-durations/1',words:[{text:'Hello',start:.1,end:.4},{text:'world.',start:.5,end:1.1}]}}};
const project=()=>({format:'aftertake-film/2',name:'A portable cut',aspect:'portrait',shots:[{assetId:pictureId,sha256:digest('picture bytes'),start:0,end:2}],
 audio:[{assetId:voiceId,sha256:voice.sha256,start:.125,sourceStart:0,sourceEnd:voice.duration,volume:1,asset:portableVoiceSource(voice)!}]});

async function workspace(run:(directory:string)=>Promise<void>){
 const directory=await mkdtemp(path.join(tmpdir(),'aftertake-voice-receipts-')),folder=path.join(directory,'films','assets');await mkdir(folder,{recursive:true});
 try{
  for(const asset of [{id:pictureId,name:'picture.png',kind:'image',extension:'.png',duration:30,sha256:digest('picture bytes')},
   {...voice,narration:undefined}]){
   await writeFile(path.join(folder,asset.id+'.json'),JSON.stringify({...asset,createdAt:voice.createdAt}));
   await writeFile(path.join(folder,asset.id+asset.extension),asset.kind==='audio'?'voice bytes':'picture bytes');
  }
  await run(directory);
 }finally{
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('aftertake-voice-receipts-'));
  await rm(directory,{recursive:true,force:true});
 }
}
async function service(directory:string){
 const app=express();app.use(express.json());app.use('/films',await filmRouter(directory,directory,process.execPath,new Map()));
 app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:error.message});});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}/films`;
 return {post:(route:string,body:unknown)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
  assets:()=>fetch(base+'/assets').then(r=>r.json())as Promise<FilmAsset[]>,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}

test('film restore preserves timed voice provenance, reuses audio without a voice runtime and survives restart',async()=>workspace(async directory=>{
 let api=await service(directory);
 try{
  const response=await api.post('/resolve',project());assert.equal(response.status,200);const draft=await response.json();
  assert.deepEqual(draft.audio,[{assetId:voiceId,start:.125,sourceStart:0,sourceEnd:1.25,volume:1}]);
  const restored=(await api.assets()).find(a=>a.id===voiceId)!;assert.deepEqual(restored.narration,voice.narration);assert.equal(restored.narrationOrigin,'imported');
  const input={text:'Hello world.',voice:'af_heart',speed:1.05,timedWords:true};
  assert.equal((await api.post('/narration',input)).status,200);
  for(const plain of [{text:input.text,voice:input.voice,speed:input.speed},{...input,timedWords:false}]){
    const response=await api.post('/narration',plain);assert.equal(response.status,200);assert.equal((await response.json()).id,voiceId);
  }
  assert.equal((await api.post('/narration',{...input,text:'A genuinely different line.'})).status,409);
  await api.close();api=await service(directory);
  const reused=await api.post('/narration',input);assert.equal(reused.status,200);assert.equal((await reused.json()).id,voiceId);
  assert.deepEqual((await api.assets()).find(a=>a.id===voiceId)!.narration?.wordTiming,voice.narration!.wordTiming);
 }finally{await api.close();}
}));

test('older failed timing receipts can be regenerated after a mapper upgrade, while current failures remain cached',async()=>workspace(async directory=>{
 const file=path.join(directory,'films/assets',voiceId+'.json');
 const narration={...voice.narration!,wordTiming:undefined,wordTimingError:'Written words could not be mapped.'};
 await writeFile(file,JSON.stringify({...voice,narration}));let api=await service(directory);
 const input={text:'Hello world.',voice:'af_heart',speed:1.05,timedWords:true};
 try{assert.equal((await api.post('/narration',input)).status,409);}finally{await api.close();}
 await writeFile(file,JSON.stringify({...voice,narration:{...narration,wordTimingMapper:'phoneme-boundaries/2'}}));api=await service(directory);
 try{const response=await api.post('/narration',input);assert.equal(response.status,200);const cached=await response.json();assert.equal(cached.id,voiceId);assert.equal(cached.narration.wordTimingMapper,'phoneme-boundaries/2');assert.equal((await api.assets()).length,2);}finally{await api.close();}
}));

test('receipt import rejects changed identities, durations and word timing before changing saved metadata',async()=>workspace(async directory=>{
 const api=await service(directory);
 try{
  const invalid=[project(),project(),project(),project(),project()];
  invalid[0].audio[0].asset.sha256='c'.repeat(64);
  invalid[1].audio[0].asset.duration=2;
  invalid[2].audio[0].asset.narration!.wordTiming!.words[1].end=1.5;
  invalid[3].audio[0].asset.narration!.wordTiming!.words[1].text='else.';
  invalid[4].shots[0].sha256='d'.repeat(64);
  for(const input of invalid){assert.equal((await api.post('/resolve',input)).status,400);assert.equal((await api.assets()).find(a=>a.id===voiceId)!.narration,undefined);}
  const input=project();await writeFile(path.join(directory,'films','assets',voiceId+'.wav'),'different bytes');
  assert.equal((await api.post('/resolve',input)).status,400);assert.equal((await api.assets()).find(a=>a.id===voiceId)!.narration,undefined);
 }finally{await api.close();}
}));

test('identical WAVs retain separate receipts without overwriting or duplicating them on repeated concurrent import',async()=>workspace(async directory=>{
 const api=await service(directory);
 try{
  const upper=project(),lower=project();lower.audio[0].asset.narration!.text='hello world.';lower.audio[0].asset.narration!.wordTiming!.words[0].text='hello';
  const results=await Promise.all([api.post('/resolve',upper),api.post('/resolve',lower),api.post('/resolve',upper)]);
  assert.ok(results.every(r=>r.status===200));const drafts=await Promise.all(results.map(r=>r.json()));
  assert.equal(drafts[0].audio[0].assetId,drafts[2].audio[0].assetId);assert.notEqual(drafts[0].audio[0].assetId,drafts[1].audio[0].assetId);
  const voices=(await api.assets()).filter(a=>a.kind==='audio');assert.equal(voices.length,2);assert.ok(voices.every(a=>a.sha256===voice.sha256&&a.narrationOrigin==='imported'));
  assert.deepEqual(new Set(voices.map(a=>a.narration!.text)),new Set(['Hello world.','hello world.']));
  for(const input of [lower,upper])assert.equal((await api.post('/resolve',input)).status,200);
  assert.equal((await api.assets()).filter(a=>a.kind==='audio').length,2);
 }finally{await api.close();}
}));

test('portable voice sources omit local identity/URLs and legacy receipt-free projects still parse',()=>{
 const source=portableVoiceSource(voice)!;assert.deepEqual(Object.keys(source).sort(),['duration','kind','narration','sha256']);
 const native=project();native.audio[0].asset={...voice}as typeof source;assert.equal(filmManifestSchema.parse(native).audio![0].asset?.narration?.text,'Hello world.');
 const legacy=project();delete(legacy.audio[0]as{asset?:unknown}).asset;assert.ok(filmManifestSchema.safeParse(legacy).success);
 assert.equal(portableVoiceSource({...voice,narration:undefined}),undefined);
});
