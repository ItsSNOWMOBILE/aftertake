import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{once}from'node:events';import{createServer}from'node:http';import express from'express';
import{scriptDraftRouter}from'../server/script-drafts.js';import{scriptRequestSchema,checkedScriptResult,scriptModelRevision}from'../src/script-draft.js';
const input=scriptRequestSchema.parse({brief:'Coffee beans for slow mornings.',closingLine:'Make mornings yours.',pictures:[{key:'beans:0',name:'Beans into filter',seconds:3},{key:'pour:0',name:'Pouring water',seconds:3},{key:'cup:0',name:'Finished cup',seconds:3}]});
const result={lines:['Start with the beans.','Water meets the grounds.','Make mornings yours.'],receipt:{model:'Qwen3-4B / OpenVINO INT4',revision:scriptModelRevision,weightsSha256:'a'.repeat(64),runtime:'Test contract',device:'CPU',deviceName:'Test CPU',loadSeconds:1,generationSeconds:1,structuredOutput:true}};
test('script contracts preserve explicit closing copy and reject missing, extra or multiline rows',()=>{
 assert.equal(checkedScriptResult(result,input).lines.length,3);
 for(const lines of [result.lines.slice(1),[...result.lines,'Extra line'],['A\nB',...result.lines.slice(1)],['A','B','Changed CTA']])assert.throws(()=>checkedScriptResult({...result,lines},input));
 assert.equal(scriptRequestSchema.safeParse({...input,pictures:[input.pictures[0],input.pictures[0]]}).success,false);
});
test('native script jobs rejoin by content, persist reviewable lines and recover interrupted requests without changing their inputs',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'aftertake-script-test-'));let calls=0,ready=true,finish!:()=>void;const hold=new Promise<void>(r=>finish=r);
 const run=async(requestFile:string,outputFile:string)=>{calls++;const payload=JSON.parse(await readFile(requestFile,'utf8'));assert.deepEqual(payload.request,input);await hold;await writeFile(outputFile,JSON.stringify({requestDigest:payload.requestDigest,result}));};
 const app=express();app.use(express.json());app.use('/api/script-drafts',await scriptDraftRouter({root:data,data,ready:async()=>ready,run}));
 const server=createServer(app).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/script-drafts`;
 const post=async(route:string,body:unknown)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const firstResponse=await post('',input);assert.equal(firstResponse.status,202);const first=await firstResponse.json();
  const repeat=await post('',input);assert.equal(repeat.status,202);assert.equal((await repeat.json()).id,first.id);
  for(let i=0;i<50&&calls===0;i++)await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);
  assert.equal((await post('',{...input,variation:1})).status,409);
  const stored=JSON.parse(await readFile(path.join(data,'script-drafts',first.id+'.json'),'utf8'));assert.equal(stored.requestDigest,first.requestDigest);
  // Simulate a restarted native process while the original worker still owns
  // its result: the route rejoins the record, and output is collected by hash.
  const resumed=express();resumed.use(express.json());resumed.use('/api/script-drafts',await scriptDraftRouter({root:data,data,ready:async()=>false,run:async()=>{throw Error('Should not run after completed output');}}));
  const recovery=createServer(resumed).listen(0,'127.0.0.1');await once(recovery,'listening');const addr=recovery.address();assert.ok(addr&&typeof addr!=='string');const url=`http://127.0.0.1:${addr.port}/api/script-drafts`;
  try{
   assert.equal((await fetch(url+'/'+first.id).then(r=>r.json())).state,'interrupted');
   finish();let job:any;
   for(let i=0;i<50;i++){job=await fetch(url+'/'+first.id).then(r=>r.json());if(job.state==='ready')break;await new Promise(r=>setTimeout(r,10));}
   assert.equal(job.state,'ready');assert.deepEqual(job.result.lines,result.lines);
   const again=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(again.status,200);assert.equal((await again.json()).id,first.id);assert.equal(calls,1);
   const reconciled=await fetch(url+'/'+first.id+'/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal((await reconciled.json()).state,'ready');
  }finally{recovery.close();recovery.closeAllConnections();}
  for(let i=0;i<50;i++){if((await fetch(base+'/'+first.id).then(r=>r.json())).state==='ready')break;await new Promise(r=>setTimeout(r,10));}
  ready=false;assert.equal((await post('',{...input,variation:1})).status,409);
 }finally{
  finish();server.close();server.closeAllConnections();assert.equal(path.dirname(path.resolve(data)),path.resolve(tmpdir()));assert.ok(path.basename(data).startsWith('aftertake-script-test-'));await rm(data,{recursive:true,force:true});
 }
});
