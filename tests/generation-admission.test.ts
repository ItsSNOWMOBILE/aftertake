import {test}from'node:test';
import assert from'node:assert/strict';
import {generationAdmission}from'../server/generation-admission.js';
import {contentDigest}from'../server/edit-plan.js';
import {recipeSchema}from'../src/domain.js';
import {mkdtemp,mkdir,readFile,writeFile,rm}from'node:fs/promises';
import {createServer}from'node:http';
import {spawn}from'node:child_process';
import {once}from'node:events';
import {tmpdir}from'node:os';
import path from'node:path';

test('generation operation keys bind exact inputs while keyless UI calls remain deliberate new work',()=>{
  const first=generationAdmission('one-take',{seed:7,prompt:'A quiet new scene.'},[]);
  const saved={id:'a',state:'submission_unknown',...first.identity};
  const same=generationAdmission('one-take',{prompt:'A quiet new scene.',seed:7},[saved]);
  assert.equal(same.existing,saved);assert.equal(same.conflict,false);
  assert.equal(generationAdmission('one-take',{seed:8,prompt:'A quiet new scene.'},[saved]).conflict,true);
  assert.equal(generationAdmission('different-take',{seed:7,prompt:'A quiet new scene.'},[saved]).existing,undefined);
  assert.deepEqual(generationAdmission(undefined,{seed:7},[saved]).identity,{});
  for(const invalid of ['', 'a'.repeat(129), '../escape', 'space key'])assert.throws(()=>generationAdmission(invalid,{},[]),/generation key/);
});

test('native take admission rejoins persisted records after restart and refuses recovery without original source bytes',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'aftertake-generation-native-'));await mkdir(path.join(directory,'renders'),{recursive:true});
 const recipe=recipeSchema.parse(JSON.parse(await readFile(new URL('../examples/observatory/recipe.json',import.meta.url),'utf8')));
 const id='00000000-0000-4000-8000-000000000001',record={id,recipe,state:'submission_unknown',progress:null,requestKey:'persisted-take',requestDigest:contentDigest(recipe),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),workflow:{}};
 await writeFile(path.join(directory,'renders',id+'.json'),JSON.stringify(record));
 const reservation=createServer().listen(0,'127.0.0.1');await once(reservation,'listening');const address=reservation.address();assert.ok(address&&typeof address!=='string');const port=address.port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 async function start(){
  const child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,PORT:String(port),AFTERTAKE_DATA_DIR:directory,COMFY_BASE_URL:'http://127.0.0.1:9',COMFY_UI_URL:'http://127.0.0.1:8'}});
  let output='';try{await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Native test server did not start: '+output.slice(-1000))),15000);
   child.stdout.on('data',data=>{output+=data.toString();if(output.includes('Aftertake studio:')){clearTimeout(timeout);resolve();}});
   child.stderr.on('data',data=>{output+=data.toString();});child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('exit',()=>{clearTimeout(timeout);reject(Error('Native test server exited: '+output.slice(-1000)));});
  });}catch(error){child.kill();throw error;}
  return child;
 }
 let child=await start();const base=`http://127.0.0.1:${port}`,post=(body:unknown,key:string)=>fetch(base+'/api/renders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/api/workspace').then(r=>r.json())).generationProtocol,1);
  const first=await post(recipe,'persisted-take');assert.equal(first.status,202);assert.equal((await first.json()).id,id);
  assert.equal((await post({...recipe,seed:recipe.seed+1},'persisted-take')).status,409);
  assert.equal((await post(recipe,'deliberate-new-take')).status,409);
  const recovery=await fetch(base+'/api/renders/'+id+'/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(recovery.status,400);
  const stored=JSON.parse(await readFile(path.join(directory,'renders',id+'.json'),'utf8'));assert.equal(stored.state,'submission_unknown');assert.equal(stored.jobId,undefined);assert.equal(stored.requestKey,'persisted-take');
  const stopped=once(child,'exit');child.kill();await stopped;child=await start();
  const resumed=await post(recipe,'persisted-take');assert.equal(resumed.status,202);assert.equal((await resumed.json()).id,id);
  const all=await fetch(base+'/api/renders').then(r=>r.json());assert.equal(all.length,1);
 }finally{
  const stopped=once(child,'exit');child.kill();await stopped;
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('aftertake-generation-native-'));await rm(directory,{recursive:true,force:true});
 }
});
