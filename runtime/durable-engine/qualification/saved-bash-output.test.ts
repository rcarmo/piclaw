import {expect,test} from 'bun:test';
import {mkdtempSync,writeFileSync,unlinkSync,linkSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {Harness,MemoryStorage,createRegistry,defineExtension,defineTool} from '@earendil-works/pi-durable';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import {withTaskModelRequestScope} from '../src/task-model-boundary-shim.ts';
import {retainBashOutputFile,readOwnedBashOutput} from '../src/saved-bash-output.ts';
import type {SavedOutputRead} from '../src/bash-output.ts';
for(const mode of ['owned','different-path','replacement','hard-link','symlink','missing','bounded','revoked'] as const)test('task-owned saved bash output: '+mode,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'saved-bash-boundary-')),path=join(dir,'output.log'),other=join(dir,'other.log'),registry=createRegistry(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const original=mode==='bounded'?'x'.repeat(4*1024*1024+100):'OWNED ORIGINAL';writeFileSync(path,original);writeFileSync(other,'FOREIGN FILE');let allowed=true,harness:Harness,seen:SavedOutputRead|undefined,denied=false;
 const check=()=>{if(!allowed)throw Error('Saved-output source revoked');};
 registry.install(defineExtension({name:'fixture.saved-bash',tools:[defineTool({name:'probe',description:'Trusted guarded-bash file-binding fixture',parameters:Type.Object({}),replay:'unsafe',async execute(_args,api){
  await retainBashOutputFile(api,path,check);
  if(mode==='replacement'){unlinkSync(path);writeFileSync(path,'REPLACED FILE');}
  if(mode==='hard-link')linkSync(path,join(dir,'hard-link'));
  if(mode==='symlink'){unlinkSync(path);symlinkSync(other,path);}
  if(mode==='missing')unlinkSync(path);
  if(mode==='revoked')allowed=false;
  try{seen=await readOwnedBashOutput(harness,mode==='different-path'?other:path,check);}catch(error){denied=error instanceof Error&&error.message==='Saved-output source revoked';}
  return{output:[{type:'text',text:'Probe complete'}]};
 }})]}));
 harness=await Harness.open(new MemoryStorage(),{registry:withTaskModelRequestScope(registry),models},context);
 try{
  const root=await harness.root(context);await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);faux.setResponses([fauxAssistantMessage([fauxToolCall('probe',{})],{stopReason:'toolUse'}),fauxAssistantMessage('Done')]);
  expect((await(await root.submit({type:'input',content:'Exercise the owned fixture'},context)).wait(context)).status).toBe('done');
  if(mode==='owned')expect(seen).toEqual({status:'available',text:original,truncated:false});
  else if(mode==='bounded'){expect(seen?.status).toBe('available');if(seen?.status==='available'){expect(seen.text.length).toBe(4*1024*1024);expect(seen.truncated).toBe(true);}}
  else if(mode==='revoked'){expect(denied).toBe(true);expect(seen).toBeUndefined();}
  else expect(seen).toEqual({status:'unavailable'});
  expect(await readOwnedBashOutput(harness,path,()=>{})).toEqual({status:'unavailable'});
 }finally{await harness.close(context);rmSync(dir,{recursive:true,force:true});}
});
