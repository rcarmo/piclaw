import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import {createRegistry,defineExtension,Harness,AgentDoc,type ConversationId,type HookApi,type ToolExecutionResult} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall,contentText} from '@earendil-works/pi-ai';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {defaultMcpRecallSettings} from '../src/mcp/recall-output.ts';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {applicationRetainedDatabase} from '../src/mcp/retained-database.ts';
import {McpConnectionStore} from '../src/mcp/connections.ts';
import {createMcpRuntime} from '../src/mcp/runtime.ts';
import {connectMcpHttp,mcpToolAlias} from '../src/mcp/client.ts';
import {createMcpRecallExtension} from '../src/mcp/recall.ts';
import {createMcpCodemodeTool} from '../src/mcp/codemode.ts';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const payload={items:Array.from({length:50},(_,i)=>({id:i,title:'Item '+i,body:'RAW_VALUE_MARKER '+('detail '+i+' ').repeat(35)}))};
async function fixture(mode:'off'|'observe'|'active'){
 let calls=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){if(req.method==='GET')return new Response(null,{status:405});if(req.method==='DELETE')return new Response(null,{status:200});const rpc=await req.json() as {id?:number;method:string};if(rpc.id===undefined)return new Response(null,{status:202});let result:unknown;switch(rpc.method){case'initialize':result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};break;case'tools/list':result={tools:[{name:'items',inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{items:{type:'array',items:{type:'object',additionalProperties:true}}},required:['items']}}]};break;case'tools/call':calls++;result={content:[{type:'text',text:JSON.stringify(payload)}],structuredContent:payload};break;default:throw Error(rpc.method);}return Response.json({jsonrpc:'2.0',id:rpc.id,result});}});cleanup.push(async()=>{server.stop(true);});
 const dir=mkdtempSync(join(tmpdir(),'mcp-recall-execution-')),file=join(dir,'state.sqlite'),db=new Database(file,{create:true});db.exec('PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA busy_timeout=0;');cleanup.push(async()=>{db.close();rmSync(dir,{recursive:true,force:true});});const store=new McpConnectionStore(db,()=>{});await store.save({id:'fixture',name:'fixture',workspaceId:'workspace',enabled:true,transport:'http',url:server.url.href,credentialUrl:server.url.href,auth:'bearer',bearerTokenKeychain:'fixture/token',allowHttp:true,timeoutSeconds:2,recall:{...defaultMcpRecallSettings(),mode,profiles:[{name:'items',tool:'mcp__v2_fixture_items_*',kind:'json-list',path:'items',fields:['id','title'],maxItems:3}]}});
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);const registry=createRegistry();let harness:Harness;
 registry.install(defineExtension({name:'fixture.codemode',tools:[createMcpCodemodeTool(new CodemodeSandbox())]}));
 const recall=createMcpRecallExtension({harness:()=>harness,connections:store,identityOf:async()=>({owner:'namespace:allowed',agentId:'allowed'}),database:applicationRetainedDatabase(db,()=>{})});registry.install(recall);
 harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(file)),{registry,models},context);cleanup.push(()=>harness.close(context));const root=await harness.root(context);await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);
 const runtime=createMcpRuntime({registry,store,assertOwner(){},resolveAgent:async id=>Number(id)===Number(root.id)?{agentId:'allowed',readOnly:false}:undefined,captureSource:async()=>()=>{},connect:async(config,authority,signal)=>{const c=await connectMcpHttp({...config,bearer:'SYNTHETIC'},fetch,undefined,signal,authority);return{...c,close:()=>c.client.close()};}});cleanup.push(()=>runtime.close());await runtime.attach();await runtime.ready();return{harness,root,faux,db,recall,store,itemsAlias:mcpToolAlias(store.credential('fixture')!,'tool','items'),calls:()=>calls};
}
const script=(alias:string)=>`const value=await tools.${alias}({});if(!value.items[25].body.includes('RAW_VALUE_MARKER'))throw Error('script received a summary');return value;`;
test('MCP-only script projection shortens only the model view and original pages remain retrievable without rerunning',async()=>{
 const f=await fixture('active');let id='';
 f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:script(f.itemsAlias)})],{stopReason:'toolUse'}),request=>{const output=request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)!;expect(output).toContain('[MCP recall mcp_');expect(Buffer.byteLength(output)).toBeLessThan(Buffer.byteLength(JSON.stringify(payload))*.8);id=/mcp_[a-f0-9]{64}/.exec(output)![0];return fauxAssistantMessage([fauxToolCall('codemode',{code:`return (await tools.mcp_recall_retrieve({id:'${id}',mode:'full',maxChars:16000})).text;`})],{stopReason:'toolUse'});},request=>{const output=request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)!;expect(output).toContain('RAW_VALUE_MARKER');expect(output).not.toContain('Script error');return fauxAssistantMessage('Done');}]);
 expect((await(await f.root.submit({type:'input',content:'Synthetic MCP recall'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);expect(f.db.query('SELECT count(*) AS n FROM mcp_recall').get()).toEqual({n:2});
});
for(const mode of ['off','observe'] as const)test('MCP recall '+mode+' preserves script and model values',async()=>{const f=await fixture(mode);f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:script(f.itemsAlias)})],{stopReason:'toolUse'}),request=>{const output=request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)!;expect(output).toContain('RAW_VALUE_MARKER');expect(output).not.toContain('[MCP recall ');return fauxAssistantMessage('Done');}]);expect((await(await f.root.submit({type:'input',content:'Synthetic MCP recall'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);if(mode==='off'){const row=f.db.query("SELECT name FROM sqlite_master WHERE name='mcp_recall'").get();if(row)expect(f.db.query('SELECT count(*) AS n FROM mcp_recall').get()).toEqual({n:0});}});

test('an explicit SDK filter excluding recall keeps the complete MCP script result',async()=>{
 const f=await fixture('active');await f.harness.commit(async tx=>{(await tx.doc(AgentDoc,f.root.id)).tools=['codemode',f.itemsAlias];},context);
 f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:script(f.itemsAlias)})],{stopReason:'toolUse'}),request=>{const output=request.messages.filter(message=>message.role==='toolResult').map(message=>contentText(message.content)).at(-1)!;expect(output).toContain('RAW_VALUE_MARKER');expect(output).not.toContain('[MCP recall ');return fauxAssistantMessage('Done');}]);
 expect((await(await f.root.submit({type:'input',content:'Read permitted MCP values'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);
});

test('resumed projection does not advertise forgotten originals or expose them after revocation',async()=>{
 const f=await fixture('active');let id='';
 f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code:script(f.itemsAlias)})],{stopReason:'toolUse'}),request=>{
  id=/mcp_[a-f0-9]{64}/.exec(request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).at(-1)!)![0];return fauxAssistantMessage('Done');
 }]);
 await (await f.root.submit({type:'input',content:'Capture fixture'},context)).wait(context);
 const grants=JSON.parse(f.db.query<{grants:string},[string]>('SELECT grants FROM mcp_recall WHERE id=?').get(id)!.grants);
 const memo={id,text:'summary reference',mode:'active',handler:'fixture',grants};
 const api={conversationId:f.root.id,memo:async()=>memo} as unknown as HookApi;
 const after=(f.recall.hooks![0]!.handlers as {afterTool:(call:{name:string},result:ToolExecutionResult,api:HookApi,ctx:typeof context)=>Promise<ToolExecutionResult>}).afterTool;
 const original:ToolExecutionResult={output:[{type:'text',text:'original value'}],details:{calls:[{name:f.itemsAlias}]}};
 expect((await after({name:'codemode'},original,api,context)).output?.[0]).toMatchObject({text:'summary reference'});
 f.db.run('DELETE FROM mcp_recall WHERE id=?',[id]);
 expect(await after({name:'codemode'},original,api,context)).toBe(original);
 const {revision,accessEpoch,...row}=f.store.credential('fixture')!;await f.store.save({...row,enabled:false},{expectedRevision:revision});
 const unavailable=await after({name:'codemode'},original,api,context);
 expect(unavailable.isError).toBe(true);expect(JSON.stringify(unavailable)).not.toContain('original value');expect(f.calls()).toBe(1);
});
