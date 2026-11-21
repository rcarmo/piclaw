import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {Harness,MemoryStorage,createRegistry,type Task,type JsonObject,type ConversationId} from '@earendil-works/pi-durable';
import {createModels} from '@earendil-works/pi-ai';
import {SessionsDoc,JobsDoc,KnowledgeDoc,ClassifiersDoc} from '#token-optimizer/pi-durable';
import {GuardJobsDoc,AutoWaitersDoc} from '#token-optimizer/state';
import {sessionKey,scopeKey} from '#token-optimizer/core';
import {createNativeTokenOptimizer} from '../src/token-optimizer.ts';
import {createOptimizerAuthority} from '../src/token-optimizer-authority.ts';
import {TokenOptimizerConfiguration} from '../src/token-optimizer-config.ts';
import {applicationRetainedDatabase} from '../src/mcp/retained-database.ts';
const kinds=['inference','fold','checkpoint','guard-judge','auto-publication','fit'] as const;
for(const suffix of kinds)test('SDK optimiser source correlation: '+suffix,async()=>{
 const database=new Database(':memory:');database.exec('CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const registry=createRegistry(),models=createModels(),agents:{agentId:string;durableId:ConversationId}[]=[];let harness:Harness,current=true;
 const native=createNativeTokenOptimizer({workspaceId:'workspace',workspaceRoot:process.env.PICLAW_WORKSPACE!,environmentRevision:'owned',registry,models,harness:()=>harness,configuration:new TokenOptimizerConfiguration(database,()=>{}),agents:async()=>agents,plan:async()=>null,readSavedOutput:async()=>({status:'unavailable'}),database:applicationRetainedDatabase(database,()=>{})});registry.install(native.optimizer.extension);
 harness=await Harness.open(new MemoryStorage(),{registry,models},context);
 try{
  const root=await harness.root(context);agents.push({agentId:'root_agent',durableId:root.id});await native.start(root,agents[0]!);const host=native.host(root.id),key=sessionKey(host.scope,host.id),scope=scopeKey(host.scope),kind='token-economizer.'+suffix;
  const authority=createOptimizerAuthority({workspaceId:'workspace',environmentRevision:'owned',registry,extension:native.optimizer.extension,assertOwner(){},agents:async()=>current?agents:[]});
  expect((await harness.inspect(context)).scheduling).toBe('paused');
  // The registry erases task generics. These six pinned SDK definitions take
  // JSON objects, persist a phase checkpoint and return null.
  const definition=native.optimizer.extension.tasks!.find(task=>task.definition.name===kind)! as Task<JsonObject,{phase:string},null,object>;expect(definition).toBeDefined();
  const repository=JSON.stringify([host.scope.host,host.scope.repository]);
  const id='fixture_'+suffix,input=suffix==='inference'||suffix==='guard-judge'?{id}:suffix==='auto-publication'?{repository}:suffix==='fit'?{key,host,scope}:{key,host};
  // Public SDK admission creates a real queued task, not a kind-only fake record.
  const taskId=await harness.commit(tx=>tx.createTask(definition,JSON.parse(JSON.stringify(input)),{ownership:{kind:'conversation'},conversationId:root.id,background:true}),context),record=(await harness.inspect(context)).tasks.find(task=>task.record.id===taskId)!.record;
  expect(record.state.status).not.toBe('terminal');expect(await authority.task(harness,record)).toBe(false);
  await harness.commit(async tx=>{
   if(suffix==='inference'){
    const request={id,purpose:'output-summary' as const,model:{provider:'fixture',id:'small'},prompt:'Synthetic source fixture',maxOutputTokens:10,deadlineMs:1000};
    (await tx.doc(JobsDoc)).jobs[id]={id,sessionKey:key,account:'fixture',runId:null,revision:'fixture',digest:'fixture',conversationId:host.conversationId,request,created:1,deadline:1001,taskId,status:'queued',result:null,error:null};
   }else if(suffix==='guard-judge'){
    (await tx.doc(GuardJobsDoc)).jobs[id]={effect:{id,runId:'fixture_run',segment:0,digest:'Synthetic complete failures'},host,sessionKey:key,model:null,writerModel:null,classifier:null,threshold:0.9,template:true,status:'queued',result:null,features:null,revision:'fixture',artifactId:null,sampleId:'fixture',reuse:null,compactFull:null};
   }else if(suffix==='auto-publication')(await tx.doc(AutoWaitersDoc)).repositories[repository]={task:taskId,items:[{scope:host.scope,sessionKey:key,host}]};
   else if(suffix==='fit')(await tx.doc(ClassifiersDoc,scope,null)).fitTask=taskId;
   else (await tx.doc(KnowledgeDoc,scope,host.scope)).foldQueue.push(key);
  },context);
  expect(await authority.task(harness,record)).toBe(true);
  if(suffix==='auto-publication'){
   await harness.commit(async tx=>{
    const waiter=(await tx.doc(AutoWaitersDoc)).repositories[repository];
    waiter.items[0].scope={...host.scope,repository:'other-workspace'};
   },context);
   expect(await authority.task(harness,record)).toBe(false);
   await harness.commit(async tx=>{
    (await tx.doc(AutoWaitersDoc)).repositories[repository].items[0].scope=host.scope;
   },context);
  }
  for(const changed of [{...record,kind:'token-economizer.foreign'},{...record,owner:taskId},{...record,version:record.version+1},{...record,background:false},{...record,conversationId:(Number(root.id)+100) as typeof root.id},{...record,input:{...JSON.parse(JSON.stringify(input)),unbound:true}}])expect(await authority.task(harness,changed)).toBe(false);
  current=false;expect(await authority.task(harness,record)).toBe(false);current=true;
  await harness.commit(async tx=>{
   if(suffix==='inference')(await tx.doc(JobsDoc)).jobs[id].taskId=null;
   else if(suffix==='guard-judge')(await tx.doc(GuardJobsDoc)).jobs[id].effect.id='foreign';
   else if(suffix==='auto-publication')(await tx.doc(AutoWaitersDoc)).repositories[repository].task=null;
   else if(suffix==='fit')(await tx.doc(ClassifiersDoc,scope,null)).fitTask=null;
   else (await tx.doc(KnowledgeDoc,scope,host.scope)).foldQueue=[];
  },context);
  expect(await authority.task(harness,record)).toBe(false);
  expect((await harness.snapshot(SessionsDoc,context))?.hosts[key]).toEqual(host);
 }finally{await native.detach();await harness.close(context);database.close();}
});
