import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createRegistry,Harness,MemoryStorage,defineExtension,defineTool,type ToolExecutionApi,type ConversationId,type TaskId} from '@earendil-works/pi-durable';
import {createCodemodeTool} from '@earendil-works/pi-durable/codemode';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall,contentText} from '@earendil-works/pi-ai';
import {McpConnectionStore} from '../src/mcp/connections.ts';
import {createMcpRuntime} from '../src/mcp/runtime.ts';
import {connectMcpHttp,mcpToolAlias} from '../src/mcp/client.ts';
import {recordingMcpCalls} from '../src/mcp/codemode.ts';

test('MCP receipts preserve a non-waiting SDK call and record its outcome once',async()=>{
 const receipts:Record<string,boolean>={},phases:string[]=[];let starts=0,waits=0;
 const taskId=23 as TaskId,result={taskId,structuredOutput:{original:'kept'},isError:false,diagnostics:[]};
 const api={taskId:7,conversationId:1,callId:'caller',
  async commit(body:any){await body({doc:async()=>receipts,appendEntry:async(_def:any,_conversation:any,{data}:any)=>phases.push(data.phase)});},
  async executeTool(name:string,args:unknown,ctx:unknown,options:unknown){
   starts++;expect(name).toBe('mcp__test__nested');expect(args).toEqual({});expect(ctx).toBe(context);expect(options).toEqual({key:'nested',wait:false});
   return {taskId:result.taskId,async result(ctx:unknown){expect(ctx).toBe(context);waits++;return result;}};
  },
 } as unknown as ToolExecutionApi;
 const handle=await recordingMcpCalls(api).executeTool('mcp__test__nested',{},context,{key:'nested',wait:false});
 expect(handle.taskId).toBe(taskId);expect(waits).toBe(0);expect(phases).toEqual(['start']);
 expect(await handle.result(context)).toBe(result);expect(await handle.result(context)).toBe(result);
 expect(starts).toBe(1);expect(waits).toBe(2);expect(phases).toEqual(['start','end']);
});
test('Code Mode does not record non-MCP calls',async()=>{
 const value={taskId:4 as TaskId,structuredOutput:{kept:true},isError:false,diagnostics:[]};
 const api={commit(){throw Error('Ordinary calls must not create MCP or optimiser receipts');},async executeTool(name:string,args:unknown,ctx:unknown){expect(name).toBe('bash');expect(args).toEqual({command:'fixture'});expect(ctx).toBe(context);return value;}} as unknown as ToolExecutionApi;
 expect(await recordingMcpCalls(api).executeTool('bash',{command:'fixture'},context,{key:'ordinary',wait:true})).toBe(value);
});
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(initialFailures=0){
 let calls=0,source=true,attempts=0,failCalls=false,failClose=false,closes=0;const methods:string[]=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){expect(req.headers.get('authorization')).toBe('Bearer SYNTHETIC');if(req.method==='GET')return new Response(null,{status:405});if(req.method==='DELETE')return new Response(null,{status:200});const rpc=await req.json() as {id?:number;method:string};methods.push(rpc.method);if(rpc.id===undefined)return new Response(null,{status:202});let result:unknown;switch(rpc.method){case'initialize':result={protocolVersion:'2025-03-26',capabilities:{tools:{},resources:{}},serverInfo:{name:'fixture',version:'1'}};break;case'tools/list':result={tools:[{name:'probe',description:'Private fixture description',inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok']}}]};break;case'tools/call':calls++;if(failCalls)return new Response('private failure body',{status:503});result={content:[{type:'text',text:'original'}],structuredContent:{ok:true}};break;case'resources/list':result={resources:[]};break;case'resources/templates/list':result={resourceTemplates:[]};break;case'resources/read':result={contents:[{uri:'memory://catalog',text:'catalog'}]};break;default:throw Error(rpc.method);}return Response.json({jsonrpc:'2.0',id:rpc.id,result});}});cleanup.push(async()=>{server.stop(true);});
 const db=new Database(':memory:');db.exec('PRAGMA busy_timeout=0;');cleanup.push(async()=>db.close());const store=new McpConnectionStore(db,()=>{});
 const saved=await store.save({id:'fixture',name:'fixture',workspaceId:'workspace',enabled:true,transport:'http',url:server.url.href,auth:'bearer',bearerTokenKeychain:'fixture/token',allowHttp:true,timeoutSeconds:2});
 db.query('UPDATE mcp_connections_v1 SET config=? WHERE id=?').run(JSON.stringify({...saved,agentIds:['allowed'],access:{kind:'workspaces',grants:[{workspaceId:'old_workspace',agentIds:['allowed']}]}}),saved.id);
 const registry=createRegistry(),models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const identities=new Map<number,string>();
 const runtime=createMcpRuntime({registry,store,assertOwner(){},resolveAgent:async id=>{const agentId=identities.get(Number(id));return agentId?{agentId,readOnly:false}:undefined;},captureSource:async()=>()=>{if(!source)throw Error('source revoked');},connect:async(config,authority,signal)=>{attempts++;if(attempts<=initialFailures)throw Object.assign(Error('setup fixture unavailable'),{code:'ECONNREFUSED'});const c=await connectMcpHttp({...config,bearer:'SYNTHETIC'},fetch,undefined,signal,authority);return{...c,close:async()=>{closes++;await c.client.close();if(failClose)throw Error('CREDENTIAL_DIAGNOSTIC_SHOULD_NOT_ESCAPE');}};}});
 const codemode=createCodemodeTool({sandbox:new CodemodeSandbox(),models:false});
 registry.install(defineExtension({name:'fixture.codemode',tools:[defineTool({...codemode,execute(args,api,ctx){const agent=api.agent.bind(api);const scoped=new Proxy(api,{get(target,key){if(key==='agent')return async(c:typeof context)=>runtime.visibleAgent(api.conversationId,await agent(c),c);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});return codemode.execute(args,scoped,ctx);}})]}));
 const harness=await Harness.open(new MemoryStorage(),{registry,models},context);cleanup.push(()=>harness.close(context));cleanup.push(async()=>{try{await runtime.close();}catch(error){if(!failClose)throw error;}});
 const root=await harness.root(context);identities.set(Number(root.id),'allowed');await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);
 await runtime.attach();await runtime.ready();return{harness,root,runtime,store,faux,identities,methods,calls:()=>calls,attempts:()=>attempts,failEffects(){failCalls=true;},failCleanup(){failClose=true;},closes:()=>closes,revoke(){source=false;}};
}
function responses(f:Awaited<ReturnType<typeof fixture>>,code:string,expected:string){const config=f.store.credential('fixture')!;code=code.replaceAll('mcp__fixture__probe',mcpToolAlias(config,'tool','probe')).replaceAll('mcp__fixture__resource_read',mcpToolAlias(config,'resource','resource_read'));f.faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code})],{stopReason:'toolUse'}),request=>{const result=request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).join('\n');expect(result).toContain(expected);expect(JSON.stringify(request)).not.toContain('SYNTHETIC');return fauxAssistantMessage('Done');}]);}
test('new runtime registers only deferred MCP tools and preserves real script values/resources',async()=>{const f=await fixture();expect(f.runtime.status('fixture')?.state).toBe('connected');responses(f,"const value=await tools.mcp__fixture__probe({});const r=await tools.mcp__fixture__resource_read({uri:'memory://catalog'});return {ok:value.ok,catalog:r.contents[0].text};",'catalog');expect((await(await f.root.submit({type:'input',content:'Synthetic MCP call'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);expect(f.methods).toContain('resources/read');});
test('an existing scoped MCP server becomes available to every owned conversation, never an unbound conversation',async()=>{
 const f=await fixture();
 const record=await f.harness.commit(tx=>tx.createConversation({ownership:{kind:'ownerless'}}),context);
 const other=(await f.harness.conversation(record.id,context))!;
 await other.configure({model:{provider:'faux',modelId:'faux-1'}},context);
 responses(f,"try{await tools.mcp__fixture__probe({});return 'escaped';}catch{return 'DENIED';}",'DENIED');
 expect((await(await other.submit({type:'input',content:'Unbound conversation'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(0);
 f.identities.set(Number(record.id),'another-agent');
 responses(f,"const found=await searchTools('Private fixture description');if(!JSON.stringify(found).includes('Private fixture description'))throw Error('Tool missing');return (await tools.mcp__fixture__probe({})).ok;",'true');
 expect((await(await other.submit({type:'input',content:'Owned conversation'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);
});
test('source revocation rejects a call before physical I/O and metadata changes withdraw registry tools',async()=>{const f=await fixture();f.revoke();responses(f,"try{await tools.mcp__fixture__probe({});return 'escaped';}catch{return 'SOURCE_DENIED';}",'SOURCE_DENIED');expect((await(await f.root.submit({type:'input',content:'Try revoked source'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(0);const previous=f.store.credential('fixture')!;const{revision,accessEpoch,...input}=previous;await f.store.save({...input,enabled:false},{expectedRevision:revision});await f.runtime.ready();expect(f.runtime.status('fixture')).toBeUndefined();});

test('bounded discovery retries only connection setup and later publishes the actual tools',async()=>{
 const f=await fixture(1);expect(f.attempts()).toBe(1);expect(f.runtime.status('fixture')?.state).toBe('retrying');expect(f.calls()).toBe(0);
 const deadline=Date.now()+2500;while(f.runtime.status('fixture')?.state!=='connected'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 expect(f.runtime.status('fixture')?.state).toBe('connected');expect(f.attempts()).toBe(2);responses(f,"return (await tools.mcp__fixture__probe({})).ok;",'true');
 expect((await(await f.root.submit({type:'input',content:'Call after reconnect'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);
});
test('an unsuccessful remote effect is never automatically replayed',async()=>{
 const f=await fixture();f.failEffects();responses(f,"try{await tools.mcp__fixture__probe({});return 'escaped';}catch{return 'EFFECT_FAILED';}",'EFFECT_FAILED');
 expect((await(await f.root.submit({type:'input',content:'Fail one remote call'},context)).wait(context)).status).toBe('done');expect(f.calls()).toBe(1);expect(f.attempts()).toBe(1);
});

test('uncertain cleanup retains one rejected disposal promise and never certifies or retries it',async()=>{
 const f=await fixture();f.failCleanup();const closing=f.runtime.close();expect(f.runtime.close()).toBe(closing);const first=await closing.then(()=>null,error=>error);expect(first).toBeInstanceOf(AggregateError);expect(JSON.stringify(first.errors.map((error:Error)=>error.message))).not.toContain('CREDENTIAL_DIAGNOSTIC');expect(await f.runtime.close().then(()=>null,error=>error)).toBe(first);expect(f.closes()).toBe(1);
});

for(const mode of ['late-handle','late-error'] as const)test('close joins stale discovery and retains cleanup uncertainty: '+mode,async()=>{
 const{McpClient}=await import('@earendil-works/pi-mcp');const db=new Database(':memory:'),store=new McpConnectionStore(db,()=>{});await store.save({id:'late',name:'late',workspaceId:'workspace',enabled:true,transport:'http',url:'https://fixture.invalid/mcp',auth:'none',allowHttp:false,timeoutSeconds:2});
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let execution=true,closes=0,settled=false;
 const runtime=createMcpRuntime({registry:createRegistry(),store,assertOwner(){if(!execution)throw Error('Execution sealed');},assertCleanupOwner(){},resolveAgent:async()=>undefined,captureSource:async()=>()=>{},async connect(){entered.resolve();await release.promise;if(mode==='late-error')throw new AggregateError([Error('PRIVATE_CLEANUP')],'Startup cleanup uncertain');const client=new McpClient({name:'fixture',version:'1'});return{client,tools:[],async close(){closes++;await client.close();throw Error('PRIVATE_CLEANUP');}};}});
 try{
  await runtime.attach();await entered.promise;execution=false;const closing=runtime.close();void closing.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);release.resolve();const failure=await closing.then(()=>null,error=>error);expect(failure).toBeInstanceOf(AggregateError);expect(JSON.stringify(failure.errors.map((error:Error)=>error.message))).not.toContain('PRIVATE_CLEANUP');expect(await runtime.close().then(()=>null,error=>error)).toBe(failure);expect(closes).toBe(mode==='late-handle'?1:0);
 }finally{release.resolve();await runtime.close().catch(()=>{});db.close();}
});

// Connection fixtures expose the existing adapter port, not a parallel scheduler.
const schema={type:'object' as const,properties:{}};
function syntheticClient(listChanged=false){
 let closed=0;let notify:()=>void=()=>{},onClose:()=>void=()=>{};
 let list:()=>Promise<import('@earendil-works/pi-mcp').Tool[]>=async()=>[{name:'probe',description:'current schema',inputSchema:schema}];
 let call=async(_name:string)=>({content:[{type:'text' as const,text:'exact tool'}]});
 const client={connectionState:'connected',serverCapabilities:{tools:{listChanged}},
  onClose(fn:()=>void){onClose=fn;return()=>{};},onNotification(_method:string,fn:()=>void){notify=fn;return()=>{};},
  listTools:()=>list(),callTool:(name:string)=>call(name),close:async()=>{closed++;},
 } as unknown as import('@earendil-works/pi-mcp').McpClient;
 return {client,tools:[{name:'probe',description:'pre-subscription schema',inputSchema:schema}],close:()=>client.close(),
  get closed(){return closed;},drop:()=>onClose(),changed:()=>notify(),list(fn:typeof list){list=fn;},call(fn:typeof call){call=fn;}};
}
async function localRuntime(connect:Parameters<typeof createMcpRuntime>[0]['connect'],rows:{id:string;name:string;agents:string[]}[]=[{id:'primary',name:'catalog',agents:['allowed']}]){
 const db=new Database(':memory:'),registry=createRegistry(),store=new McpConnectionStore(db,()=>{});
 cleanup.push(async()=>db.close());
 for(const row of rows)await store.save({id:row.id,name:row.name,workspaceId:'workspace',enabled:true,transport:'http',url:'https://fixture.invalid/mcp',auth:'none',allowHttp:false,timeoutSeconds:2});
 const runtime=createMcpRuntime({registry,store,assertOwner(){},resolveAgent:async()=>({agentId:'allowed',readOnly:false}),captureSource:async()=>()=>{},connect});
 cleanup.push(()=>runtime.close());await runtime.attach();await runtime.ready();return {runtime,registry};
}

test('discovery admits exact instance registrations for long names and overlapping connections',async()=>{
 const rows=[{id:'primary',name:'catalog',agents:['allowed']},{id:'other',name:'catalog_aux',agents:['denied']},{id:'long',name:'x'.repeat(90),agents:['allowed']}];
 const f=await localRuntime(async()=>syntheticClient(),rows),extensions=f.registry.snapshot().installed();
 const visible=await f.runtime.visibleAgent(1 as ConversationId,{extensions,callable:extensions.flatMap(ext=>ext.tools??[]),tools:[],deferred:[],sections:[],thinkingLevel:'off'},context);
 expect(visible.extensions.map(ext=>ext.name).sort()).toEqual(['piclaw.mcp.long','piclaw.mcp.other','piclaw.mcp.primary']);
 for(const row of rows)expect(visible.callable.some(tool=>tool.name===mcpToolAlias({...row,url:'https://fixture.invalid/mcp'},'tool','probe'))).toBe(true);
});

test('initial discovery reconciles a list change and publishes only the final burst snapshot',async()=>{
 const connection=syntheticClient(true);const f=await localRuntime(async()=>connection);
 expect(f.runtime.status('primary')?.tools).toEqual(['probe']);
 expect(f.registry.snapshot().extension('piclaw.mcp.primary')?.tools?.[0]?.description).toBe('current schema');
 const first=Promise.withResolvers<Awaited<ReturnType<typeof connection.client.listTools>>>();let lists=0;
 connection.list(async()=>++lists===1?first.promise:[{name:'latest',description:'latest',inputSchema:schema}]);
 connection.changed();await Bun.sleep(0);connection.changed();connection.changed();
 first.resolve([{name:'superseded',description:'superseded',inputSchema:schema}]);
 await f.runtime.ready();expect(lists).toBe(2);expect(f.runtime.status('primary')?.tools).toEqual(['latest']);
});

test('one disconnect spends one retry and old notifications cannot withdraw its successor',async()=>{
 const {McpConnectionClosedError}=await import('@earendil-works/pi-mcp');
 const first=syntheticClient(),second=syntheticClient();let connects=0;
 const f=await localRuntime(async()=>++connects===1?first:second);
 const tool=f.registry.snapshot().extension('piclaw.mcp.primary')?.tools?.[0];if(!tool)throw Error('Fixture tool absent');
 const hold=Promise.withResolvers<never>();let entered=0;first.call(async()=>{entered++;return hold.promise;});
 const api={conversationId:1,details:async()=>{}} as unknown as ToolExecutionApi;
 const calls=Promise.allSettled(Array.from({length:3},()=>tool.execute({} as never,api,context)));
 while(entered<3)await Bun.sleep(0);
 first.drop();hold.reject(new McpConnectionClosedError());await calls;
 expect(f.runtime.status('primary')?.state).toBe('retrying');
 const deadline=Date.now()+2200;while(connects<2&&Date.now()<deadline)await Bun.sleep(10);
 await f.runtime.ready();expect(connects).toBe(2);first.drop();first.changed();
 expect(f.runtime.status('primary')?.state).toBe('connected');expect(first.closed).toBe(1);expect(second.closed).toBe(0);expect(entered).toBe(3);
},4000);

for(const wait of [true,false] as const)test(`nonfatal optional end receipt cannot mask an SDK success (wait=${wait})`,async()=>{
 const {StorageRequestError}=await import('@earendil-works/pi-durable');
 const result={taskId:9 as TaskId,structuredOutput:{exact:'kept'},isError:false,diagnostics:[]};let effects=0,commits=0;
 const wrapped=recordingMcpCalls({taskId:7,conversationId:1,callId:'outer',async snapshot(){return undefined;},
  async commit(body:any){if(++commits===2)throw new StorageRequestError('optional receipt rejected');await body({doc:async()=>({}),appendEntry:async()=>{}});},
  async executeTool(){effects++;return wait?result:{taskId:result.taskId,result:async()=>result};}
 } as unknown as ToolExecutionApi);
 if(wait)expect(await wrapped.executeTool('mcp__test__nested',{},context,{key:'once',wait:true})).toBe(result);
 else expect(await (await wrapped.executeTool('mcp__test__nested',{},context,{key:'once',wait:false})).result(context)).toBe(result);
 expect(effects).toBe(1);expect(commits).toBe(2);
});

test('optional receipt handling preserves cancellation and real storage failures',async()=>{
 const {optionalMcpReceipt}=await import('../src/mcp/codemode.ts');
 const {StorageRequestError}=await import('@earendil-works/pi-durable');
 const {withAbortSignal}=await import('@earendil-works/chord/context');
 const storage=Error('storage lost');
 await expect(optionalMcpReceipt(context,async()=>{throw storage;})).rejects.toBe(storage);
 const cancel=new AbortController();const cancellation=Error('cancelled');
 await expect(optionalMcpReceipt(withAbortSignal(cancel.signal,context),async()=>{cancel.abort(cancellation);throw new StorageRequestError('optional');})).rejects.toBe(cancellation);
});
