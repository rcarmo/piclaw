// Kintsugi9be0a5e regression port. Core supports SQLite; MemoryStorage is a
// behaviour fixture. Existing portable JSONL witnesses remain untouched.
import {afterEach,expect,spyOn,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {AssistantEntry,CompactionEntry,ResetEntry,ToolResultEntry,createRegistry,defineEntry,defineExtension,defineTool,Harness,MemoryStorage} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {Type} from 'typebox';
import {SessionsDoc} from '#token-optimizer/pi-durable';
import {sessionKey} from '#token-optimizer/core';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {createOptimizerCodemodeTool} from '../src/optimizer-codemode.ts';
import {createNativeTokenOptimizer,type CoreOptimizerAgent} from '../src/token-optimizer.ts';
import {TokenOptimizerConfiguration} from '../src/token-optimizer-config.ts';
import {optimizerEntries,optimizerEvidenceBytes,optimizerModelFree,optimizerSections,readOptimizerContext} from '../src/token-optimizer-source.ts';
import {boundOptimizerHistoryReads,optimizerHistoryRead,optimizerOversizedEntry,optimizerReadBudget,OptimizerTaskPayloadSkipped} from '../src/optimizer-history-read.ts';
import type {SqliteExecutor,SqliteValue} from '@earendil-works/pi-durable/storage/sqlite';
import {applicationRetainedDatabase} from '../src/mcp/retained-database.ts';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function settleLearning(harness:Harness){
 const waited=new Set<number>();for(;;){const pending=(await harness.inspect(context)).tasks.filter(row=>['token-economizer.fold','token-economizer.checkpoint'].includes(row.record.kind)&&!waited.has(row.record.id));if(!pending.length)return;for(const row of pending){await harness.waitForTask(row.record.id,context);waited.add(row.record.id);}}
}
async function setup(kind:'memory'|'sqlite'='memory'){
 const dir=mkdtempSync(join(tmpdir(),'optimizer-checkpoint-')),file=join(dir,'state.sqlite'),database=new Database(kind==='sqlite'?file:':memory:',{create:true});database.exec('PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA busy_timeout=0;CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 cleanups.push(async()=>{database.close();rmSync(dir,{recursive:true,force:true});});
 const configuration=new TokenOptimizerConfiguration(database,()=>{},"fixture"),registry=createRegistry(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000}),sandbox=new CodemodeSandbox(),agents:CoreOptimizerAgent[]=[];models.setProvider(faux.provider);let harness:Harness,failureOutput='pytest: command not found';cleanups.push(()=>sandbox.close());
 registry.install(defineExtension({name:'fixture.checkpoint-tools',tools:[createOptimizerCodemodeTool(sandbox),defineTool({name:'bash',description:'Synthetic failure',parameters:Type.Object({command:Type.String()}),structuredOutputSchema:Type.Object({output:Type.String(),exitCode:Type.Integer(),aborted:Type.Boolean(),timedOut:Type.Boolean(),truncated:Type.Boolean()}),replay:'safe',async execute(){return{structuredOutput:{output:failureOutput,exitCode:1,aborted:false,timedOut:false,truncated:false},details:{exitCode:1,aborted:false,timedOut:false}};}})]}));
 const native=createNativeTokenOptimizer({workspaceId:'fixture',workspaceRoot:dir,environmentRevision:'owned-checkpoint',models,registry,harness:()=>harness,configuration,database:applicationRetainedDatabase(database,()=>{}),readSavedOutput:async()=>({status:'unavailable'}),agents:async()=>agents,plan:async()=>null});registry.install(native.optimizer.extension);
 harness=await Harness.open(kind==='sqlite'?await SqliteStorage.open(new BunSqliteDatabase(file)):new MemoryStorage(),{models,registry},context);cleanups.push(async()=>{try{await native.close();}finally{await harness.close(context);}});
 const conversation=await harness.root(context);await conversation.configure({model:{provider:'faux',modelId:'faux-1'}},context);agents.push({agentId:'agent',durableId:conversation.id});await native.attach();return{harness,conversation,native,configuration,faux,host:native.host(conversation.id),fail(output:string){failureOutput=output;}};
}
for(const kind of ['memory','sqlite'] as const)test(`native ${kind}: learning resumes past a tool result whose call is at the checkpoint`,async()=>{
 const f=await setup(kind);f.fail('pytest: command not found');f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'pytest'})],{stopReason:'toolUse'}),fauxAssistantMessage('Earlier reply')]);
 await(await f.conversation.submit({type:'input',content:'Check with pytest'},context)).wait(context);
 const entries=await Array.fromAsync(optimizerEntries(f.conversation,{after:0,upTo:Infinity})),call=entries.find(entry=>AssistantEntry.is(entry)&&entry.model?.some(message=>message.role==='assistant'&&message.content.some(block=>block.type==='toolCall')))!;
 expect(entries.some(entry=>entry.id>call.id&&ToolResultEntry.is(entry))).toBe(true);
 const config=f.configuration.snapshot();Object.assign(config.policy,{enabled:true,mode:'active',microSkills:'envfacts',loop:'off'});await f.configuration.configure(config);
 await f.harness.commit(async tx=>{const session=(await tx.doc(SessionsDoc)).sessions[sessionKey(f.host.scope,f.host.id)]!;session.learning={cutoff:String(call.id),credits:{confirms:[],contradicts:[],exercises:[]},ticks:0,lastProposalAt:null,requested:0,processed:0,lastRun:null,toolCounted:false};},context);
 f.fail('ruff: command not found');f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:"await tools.bash({command:'ruff'});"})],{stopReason:'toolUse'}),fauxAssistantMessage('Later reply')]);await(await f.conversation.submit({type:'input',content:'Check with ruff'},context)).wait(context);
 for(let n=0;n<100;n++){await settleLearning(f.harness);const state=(await f.native.optimizer.status(f.host)).session;if(state?.foldError||state?.learning?.processed)break;await Bun.sleep(5);}
 const state=await f.native.optimizer.status(f.host);expect(state.session?.foldError).toBeNull();expect(state.session?.learning?.processed).toBe(1);expect(Number(state.session?.learning?.cutoff)).toBeGreaterThan(call.id);expect(state.knowledge?.environment.facts.map(fact=>fact.id)).toEqual(['absent_tool:ruff']);
 const trajectory=await f.native.domain.trajectory(f.host,null,String(call.id));expect(trajectory.kind==='ready'&&trajectory.observations.map(observation=>observation.command)).toEqual(['ruff']);
});
test('a checkpoint consumes bounded pages and joins a call to its result across a page boundary',async()=>{
 const f=await setup('sqlite'),c=f.conversation;
 const noise=defineEntry<{text:string}>('fixture.checkpoint-padding');
 const resultText='x'.repeat(65_536)+'\n1 passed in 0.01s';
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const {call,result,sourceEnd}=await c.commit(async tx=>{
  const call=await tx.appendEntry(AssistantEntry,c.id,{model:[{role:'assistant',content:[{type:'toolCall',id:'page-call',name:'bash',arguments:{command:'pytest'}}],api:'openai-completions',provider:'faux',model:'faux-1',stopReason:'toolUse',timestamp:1,usage}]});
  for(let n=0;n<40;n++)await tx.appendEntry(noise,c.id,{data:{text:'unused body '.repeat(4096)}});
  const result=await tx.appendEntry(ToolResultEntry,c.id,{data:{diagnostics:[]},model:[{role:'toolResult',toolCallId:'page-call',toolName:'bash',content:[{type:'text',text:resultText}],isError:false,timestamp:2}]});
  const sourceEnd=await tx.appendEntry(noise,c.id,{data:{text:'original end'}});
  return {call,result,sourceEnd};
 },context);
 const real=f.harness.conversation.bind(f.harness),read=c.entries.bind(c),limits:number[]=[];
 const page=spyOn(c,'entries').mockImplementation((query,limit,cursor,ctx)=>{limits.push(limit);return read(query,limit,cursor,ctx);});
 const lookup=spyOn(f.harness,'conversation').mockImplementation((id,ctx)=>id===c.id?Promise.resolve(c):real(id,ctx));
 try{
  const actual=await f.native.domain.trajectory(f.host,String(sourceEnd.id));
  expect(limits.filter(limit=>limit>1).length).toBeGreaterThan(1);
  expect(Math.max(...limits)).toBeLessThanOrEqual(32);
  expect(actual).toMatchObject({kind:'ready',cutoff:String(sourceEnd.id),observations:[{command:'pytest',output:resultText.slice(-16_384),coverage:'partial'}]});
  expect((await c.entries({minEntryId:result.id,maxEntryId:result.id},1,undefined,context)).items[0]).toEqual(result);
  expect(call.id).toBeLessThan(result.id);
 }finally{lookup.mockRestore();page.mockRestore();}
},15_000);

test('native optimiser starts an existing history without materialising its model context', async () => {
 const f = await setup('sqlite');
 const config = f.configuration.snapshot(); config.policy.enabled = true; config.policy.mode = 'active';
 await f.configuration.configure(config);
 const historical = await f.harness.createConversation({ownership:{kind:'ownerless'}},context);
 const padding = defineEntry<{text:string}>('fixture.startup-history');
 for (let n=0;n<66;n++) await historical.commit(tx=>tx.appendEntry(padding,historical.id,{data:{text:`${n}:`+'saved text '.repeat(1024)}}),context);
 const read = historical.entries.bind(historical), limits:number[]=[];
 const paged = spyOn(historical,'entries').mockImplementation((query,limit,cursor,ctx)=>{limits.push(limit);return read(query,limit,cursor,ctx);});
 const materialised = spyOn(historical,'context').mockImplementation(async()=>{throw Error('Optimiser tried to read the entire model context');});
 try {
  const host = await f.native.start(historical,{agentId:'historical'},'resume');
  expect(host?.conversationId).toBe(historical.id);
  expect(materialised).not.toHaveBeenCalled();
  expect(limits.filter(limit=>limit>1).length).toBeGreaterThan(1);
  expect(Math.max(...limits)).toBeLessThanOrEqual(32);
  expect((await historical.entries({},100,undefined,context)).items.filter(padding.is)).toHaveLength(66);
 }finally{materialised.mockRestore();paged.mockRestore();}
},15_000);

test('the bounded metadata read follows SDK compaction, fork and reset visibility',async()=>{
 const f=await setup('sqlite'), c=f.conversation;
 const section=(value:string|null)=>({role:'system' as const,content:'',timestamp:0,sections:{'token-economizer':value,unrelated:'not optimizer metadata'}});
 const noise=defineEntry<{text:string}>('fixture.startup-range');
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const {head,at}=await c.commit(async tx=>{
  await tx.appendEntry(noise,c.id,{data:{text:'initial'},model:[section('not in the retained range')]});
  const head=(await tx.appendEntry(noise,c.id,{data:{text:'kept'},model:[section('carried later patch')]})).id;
  await tx.appendEntry(AssistantEntry,c.id,{model:[{role:'assistant',api:'openai-completions',provider:'piclaw',model:'codemode-template',stopReason:'stop',timestamp:1,usage,content:[{type:'text',text:'Run complete'}]}]});
  const at=(await tx.appendEntry(CompactionEntry,c.id,{head,data:{reason:'manual'},model:[section('head contribution')]})).id;
  for(let n=0;n<34;n++)await tx.appendEntry(noise,c.id,{data:{text:`after-head-${n}`}});
  return {head,at};
 },context);
 const compare=async (conversation:typeof c)=>{
  const view=await conversation.context(context);
  expect(await readOptimizerContext(conversation)).toEqual({sections:optimizerSections(view.entries),
   visibleHistory:view.entries.some(row=>Boolean(row.model?.length)),modelFree:optimizerModelFree(view.entries.findLast(AssistantEntry.is)),
   tail:(await conversation.entries({},1,undefined,context)).items[0]?.id});
 };
 await compare(c);
 expect(await readOptimizerContext(c)).toMatchObject({sections:{'token-economizer':'carried later patch'},modelFree:true});
 const child=await c.fork(at,{ownership:{kind:'ownerless'}},context);
 await child.commit(tx=>tx.appendEntry(noise,child.id,{data:{text:'own correction'},model:[section(null)]}),context);
 await compare(child);
 expect((await readOptimizerContext(child)).sections).toEqual({});
 expect((await readOptimizerContext(c)).sections['token-economizer']).toBe('carried later patch');
 await c.commit(tx=>tx.appendEntry(ResetEntry,c.id,{head:'self'}),context);
 await compare(c);
 expect(await readOptimizerContext(c)).toMatchObject({sections:{},modelFree:false,visibleHistory:false});
 expect(head).toBeLessThan(at);
},15_000);

test('checkpoint bounds derived evidence, keeps the newest results and marks missing evidence partial',async()=>{
 const f=await setup('sqlite'),c=f.conversation;
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const {last,oldest}=await c.commit(async tx=>{
  let last:Awaited<ReturnType<typeof c.entries>>['items'][number]|undefined, oldest=0;
  for(let n=0;n<40;n++) {
   const callId=`evidence-${n}`;
   await tx.appendEntry(AssistantEntry,c.id,{model:[{role:'assistant',content:[{type:'toolCall',id:callId,name:'bash',arguments:{command:`pytest case-${n}`}}],api:'openai-completions',provider:'faux',model:'faux-1',stopReason:'toolUse',timestamp:n,usage}]});
   last=await tx.appendEntry(ToolResultEntry,c.id,{data:{diagnostics:[]},model:[{role:'toolResult',toolCallId:callId,toolName:'bash',content:[{type:'text',text:`case-${n}\n`+'x'.repeat(18_000)}],isError:false,timestamp:n}]});
   if (n===0) oldest=last.id;
  }
  return {last:last!.id,oldest};
 },context);
 const result=await f.native.domain.trajectory(f.host,String(last));
 expect(result.kind).toBe('ready');if(result.kind!=='ready')throw Error(result.reason);
 expect(result.cutoff).toBe(String(last));expect(result.partial).toBe(true);
 expect(result.observations.length).toBeLessThan(40);
 expect(Buffer.byteLength(JSON.stringify(result.observations))).toBeLessThanOrEqual(optimizerEvidenceBytes);
 expect(result.observations.at(-1)?.command).toBe('pytest case-39');
 expect(result.observations.some(row=>row.command==='pytest case-0')).toBe(false);
 expect((await c.entries({minEntryId:oldest as typeof last,maxEntryId:oldest as typeof last},1,undefined,context)).items).toHaveLength(1);
},15_000);

test('the optimiser SQLite adapter checks size and shared slots before fetching any entry payload',async()=>{
 const scan='SELECT record FROM entries WHERE conversation_id = ? ORDER BY id DESC LIMIT ?';
 const reads:{sql:string;params:SqliteValue[]}[]=[];
 const absent=async()=>{};
 const executor:SqliteExecutor={exec:absent,run:absent,runCounted:async()=>0,
  async get<T extends object>(sql:string,...params:SqliteValue[]){
   reads.push({sql,params});
   return (sql.startsWith('SELECT octet_length')?{bytes:256000}:{record:'original task'}) as unknown as T;
  },
  async all<T extends object>(sql:string,...params:SqliteValue[]){
   reads.push({sql,params});
   if(sql.startsWith('SELECT id, conversation_id'))return [{id:3,conversation_id:1,bytes:256000},{id:2,conversation_id:1,bytes:64},{id:1,conversation_id:1,bytes:32}] as unknown as T[];
   if(sql.startsWith('SELECT id, record'))return [{id:2,record:'permitted payload'}] as unknown as T[];
   return [{record:'unmodified'}] as unknown as T[];
  }};
 const wrapped=boundOptimizerHistoryReads(executor),budget=optimizerReadBudget();budget.remaining=1;
 const rows=await optimizerHistoryRead.run(budget,()=>wrapped.all<{record:string}>(scan,1,3));
 const payloadReads=reads.filter(read=>read.sql.startsWith('SELECT id, record'));
 expect(payloadReads.map(read=>read.params)).toEqual([[2]]);
 expect(JSON.parse(rows[0]!.record)).toMatchObject({id:3,kind:optimizerOversizedEntry});
 expect(rows[1]!.record).toBe('permitted payload');
 expect(JSON.parse(rows[2]!.record)).toMatchObject({id:1,kind:optimizerOversizedEntry});
 expect(budget.partial).toBe(true);expect(budget.remaining).toBe(0);
 await expect(optimizerHistoryRead.run(budget,()=>wrapped.all('SELECT record FROM entries WHERE id = ?',3))).rejects.toThrow('Unrecognised optimiser history scan');
 expect(await wrapped.all(scan,1,3)).toEqual([{record:'unmodified'}]);
 const task='SELECT record FROM tasks WHERE id = ?';
 await expect(optimizerHistoryRead.run(optimizerReadBudget(),()=>wrapped.get(task,17))).rejects.toBeInstanceOf(OptimizerTaskPayloadSkipped);
 expect(reads.filter(read=>read.sql===task)).toEqual([]);
 expect(await wrapped.get(task,17)).toEqual({record:'original task'});
});

test('rolling history excludes old and oversized inputs without changing the original journal',async()=>{
 const f=await setup('sqlite'),c=f.conversation;
 const padding=defineEntry<{text:string}>('fixture.rolling-history');
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const {old,newest,oversized}=await c.commit(async tx=>{
  async function result(n:string,output:string){
   await tx.appendEntry(AssistantEntry,c.id,{model:[{role:'assistant',content:[{type:'toolCall',id:n,name:'bash',arguments:{command:`pytest ${n}`}}],api:'openai-completions',provider:'faux',model:'faux-1',stopReason:'toolUse',timestamp:1,usage}]});
   return (await tx.appendEntry(ToolResultEntry,c.id,{data:{diagnostics:[]},model:[{role:'toolResult',toolCallId:n,toolName:'bash',content:[{type:'text',text:output}],isError:false,timestamp:2}]})).id;
  }
  const old=await result('old','not in the rolling window');
  for(let n=0;n<520;n++)await tx.appendEntry(padding,c.id,{data:{text:`row ${n}`}});
  const oversized=await result('oversized','x'.repeat(180_000));
  return {old,oversized,newest:await result('recent','recent proof')};
 },context);
 const result=await f.native.domain.trajectory(f.host,String(newest));
 expect(result).toMatchObject({kind:'ready',partial:true,cutoff:String(newest),observations:[{command:'pytest recent',output:'recent proof'}]});
 expect((await c.entries({minEntryId:old,maxEntryId:old},1,undefined,context)).items).toHaveLength(1);
 const ordinary=(await c.entries({minEntryId:oversized,maxEntryId:oversized},1,undefined,context)).items[0];
 expect(JSON.stringify(ordinary).length).toBeGreaterThan(180_000);
},15_000);

test('a tool result without a matching call or durable task is still unreadable',async()=>{
 const f=await setup();await f.harness.commit(tx=>tx.appendEntry(ToolResultEntry,f.conversation.id,{data:{diagnostics:[]},model:[{role:'toolResult',toolCallId:'missing',toolName:'bash',content:[],isError:false,timestamp:1}]}),context);
 expect(await f.native.domain.trajectory(f.host,null)).toEqual({kind:'unreadable',reason:'Tool result has no visible originating arguments'});
});
