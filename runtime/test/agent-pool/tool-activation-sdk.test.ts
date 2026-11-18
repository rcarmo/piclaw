import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAgentSession,ModelRuntime,DefaultResourceLoader,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';
import {InMemoryCredentialStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {Type} from '@sinclair/typebox';

for(const retired of ['activate_tools','reset_active_tools'])test(`real SDK refuses retired ${retired} without changing its allowed tools`,async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'retired-tool-selector-'));
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
 let turns=0,executions=0,forbidden=0;const results:any[]=[];
 runtime.registerProvider('synthetic',{api:'openai-completions',baseUrl:'http://synthetic.invalid',apiKey:'synthetic',models:[{id:'test',name:'Test',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:256}],streamSimple:()=>{
  const stream=createAssistantMessageEventStream();queueMicrotask(()=>{
   const n=turns++,content=n===0?[{type:'toolCall',id:'retired',name:retired,arguments:{names:['forbidden']}}]:n===1?[{type:'toolCall',id:'blocked',name:'forbidden',arguments:{}},{type:'toolCall',id:'allowed',name:'plan',arguments:{}}]:[{type:'text',text:'done'}];
   const message:any={role:'assistant',api:'openai-completions',provider:'synthetic',model:'test',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:n<2?'toolUse':'stop',content};stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
  });return stream;
 }});
 const loader=new DefaultResourceLoader({cwd,agentDir:join(cwd,'profile'),noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,disabledBuiltinExtensions:['codemode','tool-search','mcp'],extensionFactories:[api=>{
  api.registerTool({name:'plan',label:'Plan',description:'Allowed fixture',parameters:Type.Object({}),execute:async()=>{executions++;return{content:[{type:'text',text:'checklist'}]};}});
  api.registerTool({name:'forbidden',label:'Forbidden',description:'Excluded fixture',parameters:Type.Object({}),execute:async()=>{forbidden++;return{content:[{type:'text',text:'FORBIDDEN'}]};}});
 }],systemPromptOverride:()=> 'Test.'});await loader.reload();
 const {session}=await createAgentSession({cwd,agentDir:join(cwd,'profile'),modelRuntime:runtime,model:runtime.getModel('synthetic','test')!,sessionManager:SessionManager.inMemory(cwd),settingsManager:SettingsManager.inMemory({retry:{enabled:false},compaction:{enabled:false}}),resourceLoader:loader});
 try{
  await session.bindExtensions({uiContext:{} as any,commandContextActions:{} as any});session.setActiveToolsByName(['plan']);
  session.subscribe(event=>{if(event.type==='tool_execution_end')results.push({...event.result,isError:event.isError});});await session.prompt('Try retired tool, then allowed and forbidden fixtures');
  expect(executions).toBe(1);expect(forbidden).toBe(0);expect(session.getActiveToolNames()).toEqual(['plan']);
  expect(results.filter(result=>result.isError)).toHaveLength(2);expect(JSON.stringify(results)).toContain(`Tool ${retired} not found`);
 }finally{await session.abort();session.dispose();rmSync(cwd,{recursive:true,force:true});}
},15000);
