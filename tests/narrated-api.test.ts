import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {filmRouter} from '../server/films.js';

test('native narrated-cut preparation verifies actual bytes and retains the same editable project after a reconnect',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'aftertake-narrated-test-')),assets=path.join(directory,'films/assets');
  await mkdir(assets,{recursive:true});
  const picture='00000000-0000-4000-8000-000000000001',voice='00000000-0000-4000-8000-000000000002';
  const pictureBytes=Buffer.from('admitted picture bytes'),voiceBytes=Buffer.from('admitted complete voice bytes');
  const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  for(const [id,kind,extension,bytes,duration,extra]of [
    [picture,'video','.mp4',pictureBytes,10,{}],
    [voice,'audio','.wav',voiceBytes,1.4,{narration:{text:'A slower morning.',voice:'af_heart',speed:1.05,model:'Kokoro',modelSha256:'a'.repeat(64),voicesSha256:'b'.repeat(64),runner:'CPU'}}],
  ]as const){
    await writeFile(path.join(assets,id+extension),bytes);
    await writeFile(path.join(assets,id+'.json'),JSON.stringify({id,kind,extension,name:kind,url:'/asset',duration,sha256:hash(bytes),createdAt:'now',...extra}));
  }
  async function start(){
    const app=express();app.use(express.json());app.use('/api/films',await filmRouter(directory,directory,process.execPath,new Map()));
    app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:error.message}));
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    return {server,base:`http://127.0.0.1:${address.port}/api/films`};
  }
  let live=await start();
  const post=(route:string,body:unknown)=>fetch(live.base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const input={name:'Coffee',aspect:'portrait',beats:[{shot:{assetId:picture,start:0,end:5},pictureSHA256:hash(pictureBytes),text:'A slower morning.',voice:{assetId:voice,sha256:hash(voiceBytes)}}]};
  try{
    const source=await post('/narrated-cuts/sources',{shots:input.beats.map(beat=>beat.shot)});assert.equal(source.status,200);
    assert.equal((await source.json())[0].sha256,hash(pictureBytes));
    const [first,second]=await Promise.all([post('/narrated-cuts',input),post('/narrated-cuts',input)]);
    assert.equal(first.status,200);assert.equal(second.status,200);
    const record=await first.json();assert.deepEqual(await second.json(),record);
    assert.equal(record.draft.audio[0].sourceEnd,1.4);assert.equal(record.draft.titles[0].text,'A slower morning.');
    await new Promise<void>(resolve=>live.server.close(()=>resolve()));live=await start();
    const resumed=await post('/narrated-cuts',input);assert.equal(resumed.status,200);assert.deepEqual(await resumed.json(),record);
    await writeFile(path.join(assets,picture+'.mp4'),'changed picture');
    assert.equal((await post('/narrated-cuts/sources',{shots:input.beats.map(beat=>beat.shot)})).status,400);
    assert.equal((await post('/narrated-cuts',input)).status,400);
    await writeFile(path.join(assets,picture+'.mp4'),pictureBytes);await writeFile(path.join(assets,voice+'.wav'),'changed voice');
    assert.equal((await post('/narrated-cuts',input)).status,400);
  }finally{
    await new Promise<void>(resolve=>live.server.close(()=>resolve()));
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('aftertake-narrated-test-'));
    await rm(directory,{recursive:true,force:true});
  }
});
