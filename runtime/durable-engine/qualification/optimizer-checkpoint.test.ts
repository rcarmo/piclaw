// Kintsugi9be0a5e regression port. Core supports SQLite; MemoryStorage is a
// behaviour fixture. Existing portable JSONL witnesses remain untouched.
import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {AssistantEntry,ToolResultEntry,createRegistry,defineExtension,defineTool,Harness,MemoryStorage} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {Type} from 'typebox';
import {SessionsDoc} from '#token-optimizer/pi-durable';
import {sessionKey} from '#token-optimizer/core';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {createOptimizerCodemodeTool} from '../src/optimizer-codemode.ts';
import {createNativeTokenOptimizer,type CoreOptimizerAgent} from '../src/token-optimizer.ts';
import {TokenOptimizerConfiguration} from '../src/token-optimizer-config.ts';
import {optimizerEntries} from '../src/token-optimizer-source.ts';
import {applicationRetainedDatabase} from '../src/mcp/retained-database.ts';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function settleLearning(harness:Harness){
 const waited=new Set<number>();for(;;){const pending=(await harness.inspect(context)).tasks.filter(row=>['token-economizer.fold','token-economizer.checkpoint'].includes(row.record.kind)&&!waited.has(row.record.id));if(!pending.length)return;for(const row of pending){await harness.waitForTask(row.record.id,context);waited.add(row.record.id);}}
}
async function setup(kind:'memory'|'sqlite'='memory'){
 const dir=mkdtempSync(join(tmpdir(),'optimizer-checkpoint-')),file=join(dir,'state.sqlite'),database=new Database(kind==='sqlite'?file:':memory:',{create:true});database.exec('PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA busy_timeout=0;CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 cleanups.push(async()=>{database.close();rmSync(dir,{recursive:true,force:true});});
 const configuration=new TokenOptimizerConfiguration(database,()=>{}),registry=createRegistry(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000}),sandbox=new CodemodeSandbox(),agents:CoreOptimizerAgent[]=[];models.setProvider(faux.provider);let harness:Harness,failureOutput='pytest: command not found';cleanups.push(()=>sandbox.close());
 registry.install(defineExtension({name:'fixture.checkpoint-tools',tools:[createOptimizerCodemodeTool(sandbox),defineTool({name:'bash',description:'Synthetic failure',parameters:Type.Object({command:Type.String()}),structuredOutputSchema:Type.Object({output:Type.String(),exitCode:Type.Integer(),aborted:Type.Boolean(),timedOut:Type.Boolean(),truncated:Type.Boolean()}),replay:'safe',async execute(){return{structuredOutput:{output:failureOutput,exitCode:1,aborted:false,timedOut:false,truncated:false},details:{exitCode:1,aborted:false,timedOut:false}};}})]}));
 const native=createNativeTokenOptimizer({workspaceId:'fixture',workspaceRoot:dir,environmentRevision:'owned-checkpoint',models,registry,harness:()=>harness,configuration,database:applicationRetainedDatabase(database,()=>{}),readSavedOutput:async()=>({status:'unavailable'}),agents:async()=>agents,plan:async()=>null});registry.install(native.optimizer.extension);
 harness=await Harness.open(kind==='sqlite'?await SqliteStorage.open(new BunSqliteDatabase(file)):new MemoryStorage(),{models,registry},context);cleanups.push(async()=>{try{await native.close();}finally{await harness.close(context);}});
 const conversation=await harness.root(context);await conversation.configure({model:{provider:'faux',modelId:'faux-1'}},context);agents.push({agentId:'agent',durableId:conversation.id});await native.attach();return{harness,conversation,native,configuration,faux,host:native.host(conversation.id),fail(output:string){failureOutput=output;}};
}
for(const kind of ['memory','sqlite'] as const)test(`native ${kind}: learning resumes past a tool result whose call is at the checkpoint`,async()=>{
 const f=await setup(kind);f.fail('pytest: command not found');f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'pytest'})],{stopReason:'toolUse'}),fauxAssistantMessage('Earlier reply')]);
 await(await f.conversation.submit({type:'input',content:'Check with pytest'},context)).wait(context);
 const entries=await optimizerEntries(f.conversation,{after:0,upTo:Infinity}),call=entries.find(entry=>AssistantEntry.is(entry)&&entry.model?.some(message=>message.role==='assistant'&&message.content.some(block=>block.type==='toolCall')))!;
 expect(entries.some(entry=>entry.id>call.id&&ToolResultEntry.is(entry))).toBe(true);
 const config=f.configuration.snapshot();Object.assign(config.policy,{enabled:true,mode:'active',microSkills:'envfacts',loop:'off'});await f.configuration.configure(config);
 await f.harness.commit(async tx=>{const session=(await tx.doc(SessionsDoc)).sessions[sessionKey(f.host.scope,f.host.id)]!;session.learning={cutoff:String(call.id),credits:{confirms:[],contradicts:[],exercises:[]},ticks:0,lastProposalAt:null,requested:0,processed:0,lastRun:null,toolCounted:false};},context);
 f.fail('ruff: command not found');f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:"await tools.bash({command:'ruff'});"})],{stopReason:'toolUse'}),fauxAssistantMessage('Later reply')]);await(await f.conversation.submit({type:'input',content:'Check with ruff'},context)).wait(context);
 for(let n=0;n<100;n++){await settleLearning(f.harness);const state=(await f.native.optimizer.status(f.host)).session;if(state?.foldError||state?.learning?.processed)break;await Bun.sleep(5);}
 const state=await f.native.optimizer.status(f.host);expect(state.session?.foldError).toBeNull();expect(state.session?.learning?.processed).toBe(1);expect(Number(state.session?.learning?.cutoff)).toBeGreaterThan(call.id);expect(state.knowledge?.environment.facts.map(fact=>fact.id)).toEqual(['absent_tool:ruff']);
 const trajectory=await f.native.domain.trajectory(f.host,null,String(call.id));expect(trajectory.kind==='ready'&&trajectory.observations.map(observation=>observation.command)).toEqual(['ruff']);
});
test('a tool result without a matching call or durable task is still unreadable',async()=>{
 const f=await setup();await f.harness.commit(tx=>tx.appendEntry(ToolResultEntry,f.conversation.id,{data:{diagnostics:[]},model:[{role:'toolResult',toolCallId:'missing',toolName:'bash',content:[],isError:false,timestamp:1}]}),context);
 expect(await f.native.domain.trajectory(f.host,null)).toEqual({kind:'unreadable',reason:'Tool result has no visible originating arguments'});
});
