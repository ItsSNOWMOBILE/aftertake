import {execFile} from 'node:child_process';
import path from 'node:path';
import {characterPrompt,type CharacterRequest,type CharacterSelectionRequest} from '../src/character.js';

export function buildCharacterWorkflow(root:string,python:string,value:{id:string;kind:'selection';request:CharacterSelectionRequest}|{
  id:string;kind:'replacement';request:CharacterRequest;selectionRequest:CharacterSelectionRequest}){
  const input={...value,...(value.kind==='replacement'?{prompt:characterPrompt(value.request)}:{})};
  return new Promise<Record<string,any>>((resolve,reject)=>{
    const process=execFile(python,[path.join(root,'scripts/character-workflow.py')],{cwd:root,timeout:15000,maxBuffer:5*1024*1024},(error,stdout,stderr)=>{
      if(error)return reject(Error(stderr.trim()||error.message));
      try{resolve(JSON.parse(stdout));}catch{reject(Error('Could not read the native character workflow.'));}
    });process.stdin?.end(JSON.stringify(input));
  });
}
