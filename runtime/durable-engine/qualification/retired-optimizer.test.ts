import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createModels} from '@earendil-works/pi-ai';
import {AgentDoc,Harness,InboxDoc,createRegistry,defineDoc,defineDocFamily,defineEntry,defineExtension,defineTask,type ConversationId,type SubmissionId} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {retireOptimizerWork,restoreIdleOptimizerMasks} from '../src/retired-optimizer.ts';

const names=['inference','fold','checkpoint','guard-judge','auto-publication','fit'] as const;
const retired=names.map(kind=>defineTask<{id:string},{phase:'run'},null>({name:`token-economizer.${kind}`,version:1,initial:()=>({phase:'run'}),phases:{async run(){throw Error('Retired optimiser task must never run');}},async abort(){throw Error('Retired optimiser executable must not be installed');}}));
const ordinary=defineTask<null,{phase:'run'},null>({name:'fixture.ordinary-work',version:1,initial:()=>({phase:'run'}),phases:{async run(){throw Error('The removal fixture must stay paused');}},async abort(){throw Error('Ordinary work must not be aborted');}});
const Fact=defineEntry<{section:string;injectedIds:string[]}>('token-economizer.fact-context');
const Mask=defineDoc({kind:'piclaw.token-optimizer.mask',version:1,scope:'conversation',history:'latest',fork:'current',initial:()=>({initialized:true,baseline:{remove:['operator']},rendered:{remove:['operator','learned']},owned:['learned']}),checkpointWhen:()=>false});
const scope={host:'piclaw.native',repository:'fixture',environment:'fixture'},actor=JSON.stringify(['web:default','formerly-enabled']);
const Sessions=defineDoc({kind:'piclaw.token-optimizer.sessions',version:1,scope:'session',initial:():{sessions:Record<string,{host:{id:string;scope:typeof scope;conversationId:ConversationId}}> }=>({sessions:{}}),checkpointWhen:()=>false});
const Runs=defineDocFamily<{inputs:SubmissionId[];decisions:{id:string;runId:string;action:string;mode:string;status:string;submissionId:SubmissionId}[]},null>({kind:'token-economizer.run',version:1,scope:'session',family:true,initial:()=>({inputs:[],decisions:[]}),checkpointWhen:()=>false});
const decisionId='historical redirect receipt',runId='legacy accepted run',historicalRequest='token-economizer-'+createHash('sha256').update(decisionId).digest('hex');
const fact={section:'Historical fixture fact',injectedIds:['fact:keep']};
const owner=()=>{};

test('SDK removal retires only historical optimiser work while paused and is idempotent after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'retired-optimizer-')),file=join(dir,'state.sqlite');
 const open=async(legacy:boolean)=>{
  const registry=createRegistry();registry.install(defineExtension({name:'fixture.ordinary',tasks:[ordinary]}));
  if(legacy)registry.install(defineExtension({name:'fixture.retired-codec-seed',tasks:retired}));
  return Harness.open(await SqliteStorage.open(new BunSqliteDatabase(file)),{registry,models:createModels()},context);
 };
 let current:Harness|undefined;
 try{
  current=await open(true);const seeded=current,maintenance=await seeded.root(context),chat=await seeded.createConversation({ownership:{kind:'ownerless'}},context),idle=await seeded.createConversation({ownership:{kind:'ownerless'}},context),restricted=await seeded.createConversation({ownership:{kind:'ownerless'}},context);
  const ids=await seeded.commit(async tx=>{
   const redirect=await tx.createSubmission({type:'input',conversationId:chat.id,requestId:historicalRequest,status:'queued'});
   const input=await tx.createSubmission({type:'input',conversationId:chat.id,requestId:'accepted input',status:'queued'});
   const inbox=await tx.doc(InboxDoc,chat.id);
   inbox.items.push({id:redirect.id,mode:'steer',content:'Old advisory',entry:{kind:'token-economizer.redirect',data:{decisionId,runId}}});
   inbox.items.push({id:input.id,mode:'followUp',content:'Keep the accepted ordinary prompt.'});
   (await tx.doc(Sessions)).sessions[actor]={host:{id:actor,scope,conversationId:chat.id}};
   const run=await tx.doc(Runs,JSON.stringify([JSON.stringify([scope.host,scope.repository,scope.environment]),actor]),null);
   run.inputs=[input.id];run.decisions.push({id:decisionId,runId,action:'redirect',mode:'active',status:'queued',submissionId:redirect.id});
   for(const conv of [chat,idle,restricted]){
    const mask=await tx.doc(Mask,conv.id),agent=await tx.doc(AgentDoc,conv.id);
    agent.tools=conv.id===restricted.id?{remove:['external']} : {remove:[...mask.rendered.remove]};
   }
   const entry=await tx.appendEntry(Fact,chat.id,{data:fact});
   const tasks=[];for(const task of retired)tasks.push(await tx.createTask(task,{id:task.definition.name},{ownership:{kind:'conversation'},conversationId:maintenance.id,background:true}));
   const keep=await tx.createTask(ordinary,null,{ownership:{kind:'conversation'},conversationId:chat.id});
   return {entry,redirect,input,keep,tasks};
  },context);
  await seeded.close(context);current=undefined;
  for(let round=0;round<2;round++){
   const harness=current=await open(false),before=await harness.inspect(context);
   expect(before.scheduling).toBe('paused');
   expect(await retireOptimizerWork(harness,before,context,owner)).toBe(round===0);
   const after=await harness.inspect(context);expect(after.scheduling).toBe('paused');
   await restoreIdleOptimizerMasks(harness,[chat.id,idle.id,restricted.id],after,context,owner);
   for(const id of ids.tasks)expect(await harness.getTask(id,context)).toMatchObject({id,state:{status:'terminal',outcome:{status:'orphaned'}}});
   expect(after.tasks.map(t=>t.record.id)).toEqual([ids.keep]);
   expect(after.submissions).toEqual([ids.input]);
   expect(await harness.commit(tx=>tx.submission(ids.redirect.id),context)).toMatchObject({status:'unanswered',reason:'aborted'});
   expect((await harness.snapshot(InboxDoc,chat.id,context))?.items).toEqual([{id:ids.input.id,mode:'followUp',content:'Keep the accepted ordinary prompt.'}]);
   expect(await harness.commit(tx=>tx.entry(ids.entry.id),context)).toEqual(ids.entry);
   expect((await harness.snapshot(AgentDoc,chat.id,context))?.tools).toEqual({remove:['operator','learned']});
   expect((await harness.snapshot(AgentDoc,idle.id,context))?.tools).toEqual({remove:['operator']});
   expect((await harness.snapshot(AgentDoc,restricted.id,context))?.tools).toEqual({remove:['external']});
   await harness.close(context);current=undefined;
  }
 }finally{try{await current?.close(context);}finally{rmSync(dir,{recursive:true,force:true});}}
},15_000);

test('retirement refuses a historical task that owns an ordinary conversation without making an abort mark',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'retired-optimizer-owner-')),file=join(dir,'state.sqlite');
 const registry=createRegistry();registry.install(defineExtension({name:'fixture.ordinary',tasks:[ordinary]}));
 const legacy=createRegistry();legacy.install(defineExtension({name:'fixture.seed',tasks:[retired[0]!,ordinary]}));
 const open=async(r:typeof registry)=>Harness.open(await SqliteStorage.open(new BunSqliteDatabase(file)),{registry:r,models:createModels()},context);
 let harness:Harness|undefined;
 try{
  const seeded=harness=await open(legacy),root=await seeded.root(context);
  const retiredId=await root.commit(tx=>tx.createTask(retired[0]!,{id:'owns-child'},{background:true,ownership:{kind:'conversation'}}),context);
  const child=await seeded.createConversation({ownership:{kind:'task',taskId:retiredId}},context);
  const activeId=await child.commit(tx=>tx.createTask(ordinary,null,{ownership:{kind:'conversation'}}),context);
  await seeded.close(context);harness=await open(registry);
  const before=await harness.inspect(context);
  await expect(retireOptimizerWork(harness,before,context,owner)).rejects.toThrow('Unsupported retired optimiser task ownership');
  expect(await harness.inspect(context)).toEqual(before);
  expect((await harness.getTask(retiredId,context))?.abortRequested).not.toBe(true);
  expect((await harness.getTask(activeId,context))?.abortRequested).not.toBe(true);
 }finally{try{await harness?.close(context);}finally{rmSync(dir,{recursive:true,force:true});}}
},15_000);
