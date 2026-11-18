import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createRegistry,defineExtension,defineTool,Harness,ToolResultEntry} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {createCodemodeExtension} from '@earendil-works/pi-durable/codemode';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {Type} from 'typebox';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall,contentText} from '@earendil-works/pi-ai';
import {defaultPolicy} from '#token-optimizer/core';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {applicationRetainedDatabase,conversationLineage,captureMark} from '../src/mcp/retained-database.ts';
import {createToolOutputStore} from '../src/mcp/tool-output-store.ts';
import {createOptimizerOutputExtension,createToolOutputTools} from '../src/token-optimizer-output.ts';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const big=Array.from({length:400},(_,i)=>`line ${i+1}: ${i===249?'NEEDLE_VALUE':'synthetic log detail with enough text'}`).join('\n');
async function fixture(mode:'off'|'observe'|'active'){
 const dir=mkdtempSync(join(tmpdir(),'optimizer-output-')),file=join(dir,'state.sqlite'),db=new Database(file,{create:true});db.exec('PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA busy_timeout=0;');cleanups.push(async()=>{db.close();rmSync(dir,{recursive:true,force:true});});const store=createToolOutputStore(applicationRetainedDatabase(db,()=>{}));
 let harness:Harness,calls=0;const policy={...defaultPolicy(),enabled:mode!=='off',mode,offloadOutputs:true,reduceOutputs:false};
 const scope=async(id:Parameters<typeof conversationLineage>[1])=>({owner:'namespace:agent',lineage:await conversationLineage(harness,id,context)});
 const registry=createRegistry(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 registry.install(createCodemodeExtension({sandbox:new CodemodeSandbox(),models:false}));
 registry.install(defineExtension({name:'fixture.tools',tools:[defineTool({name:'bash',parameters:Type.Object({command:Type.String()}),description:'Synthetic owned fixture',replay:'unsafe',structuredOutputSchema:Type.Object({output:Type.String(),exitCode:Type.Integer(),truncated:Type.Boolean()}),async execute(){calls++;return{output:[{type:'text' as const,text:big}],structuredOutput:{output:big,exitCode:0,truncated:false},details:{fullOutputPath:'/owned/fixture.log',exitCode:0}};}}),...createToolOutputTools(store,scope)]}));
 registry.install(createOptimizerOutputExtension({policyFor:async()=>policy,scope,mark:id=>captureMark(harness,id,context),store}));
 harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(file)),{registry,models},context);cleanups.push(()=>harness.close(context));const root=await harness.root(context);await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);
 return{root,harness,db,faux,calls:()=>calls,policy,store};
}
test('active output offload shortens model context and bounded retrieval never reruns the effect',async()=>{
 const f=await fixture('active');let id='',shown='';f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'synthetic log'})],{stopReason:'toolUse'}),request=>{shown=request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)!;expect(shown).toContain('[Stored bash output out_');expect(Buffer.byteLength(shown)).toBeLessThan(Buffer.byteLength(big)*.6);id=/out_[a-f0-9]{32}/.exec(shown)![0];return fauxAssistantMessage([fauxToolCall('read_tool_output',{id,start:249,lines:2})],{stopReason:'toolUse'});},request=>{const output=JSON.parse(request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)!);expect(output.text).toContain('NEEDLE_VALUE');return fauxAssistantMessage('Done');}]);
 expect((await(await f.root.submit({type:'input',content:'Read synthetic log'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);const entries=(await f.root.entries({order:'ascending'},1000,undefined,context)).items;const result=entries.find(ToolResultEntry.is)!;const message=result.model![0]!;expect(message.role==='toolResult'&&message.details).toMatchObject({optimizerRawOutput:big,optimizerOffload:{id,applied:true}});expect(f.db.query('SELECT count(*) AS n FROM retained_tool_outputs').get()).toEqual({n:1});
});
for(const mode of ['off','observe'] as const)test(mode+' preserves the complete model result without storing a deferred copy',async()=>{const f=await fixture(mode);f.faux.setResponses([fauxAssistantMessage([fauxToolCall('bash',{command:'synthetic log'})],{stopReason:'toolUse'}),request=>{expect(request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)).toBe(big);return fauxAssistantMessage('Done');}]);expect((await(await f.root.submit({type:'input',content:'Inspect'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);const exists=f.db.query("SELECT name FROM sqlite_master WHERE name='retained_tool_outputs'").get();if(exists)expect(f.db.query('SELECT count(*) AS n FROM retained_tool_outputs').get()).toEqual({n:0});});
test('nested scripts keep the full original value before the emitted model result is offloaded',async()=>{const f=await fixture('active');f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:"const value=await tools.bash({command:'synthetic log'});if(!value.output.includes('line 150:'))throw Error('script got a preview');return value.output;"})],{stopReason:'toolUse'}),request=>{const output=request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)!;expect(output).toContain('[Stored codemode output out_');expect(output).not.toContain('Script error');return fauxAssistantMessage('Done');}]);expect((await(await f.root.submit({type:'input',content:'Process raw log'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);});
