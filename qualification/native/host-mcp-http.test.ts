import './src/test-guard.js';
import {expect,test,spyOn} from 'bun:test';
import {Database} from 'bun:sqlite';
import {connectMcpHttp} from '../../runtime/durable-engine/src/mcp/client.ts';
import {createMcpAuthority} from '../../runtime/durable-engine/src/mcp/authority.ts';
import {createMcpRuntime} from '../../runtime/durable-engine/src/mcp/runtime.ts';
import {McpConnectionStore} from '../../runtime/durable-engine/src/mcp/connections.ts';
import {createRegistry} from '../../runtime/durable-engine/qualification/durable.ts';
import {BACKGROUND_CONTEXT as context,withAbortSignal} from '../../runtime/durable-engine/qualification/context.ts';
import {StreamableHttpTransport} from '../../runtime/durable-engine/node_modules/@earendil-works/pi-mcp';
const config={id:'fixture',name:'fixture',url:'https://mcp.fixture.invalid/mcp',bearer:'SYNTHETIC_ONLY',allowHttp:false,timeoutSeconds:2};
// Synthetic JSON-RPC endpoint only; public SDK client and constrained transport are real.
function endpoint(onCall:(message:string)=>Promise<void>){
 const prior=globalThis.fetch;
 globalThis.fetch=Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);expect(request.url).toBe(config.url);expect(request.headers.get('authorization')).toBe('Bearer '+config.bearer);
  if(request.method!=='POST')return new Response(null,{status:202});const rpc=await request.json() as any;if(rpc.id===undefined)return new Response(null,{status:202});let result:unknown={};
  if(rpc.method==='initialize')result={protocolVersion:rpc.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  if(rpc.method==='tools/list')result={tools:[{name:'echo',description:'Echo',inputSchema:{type:'object',properties:{message:{type:'string'}},required:['message']}}]};
  if(rpc.method==='tools/call'){await onCall(rpc.params.arguments.message);init?.signal?.throwIfAborted();result={content:[{type:'text',text:rpc.params.arguments.message}]};}
  return Response.json({jsonrpc:'2.0',id:rpc.id,result});
 },{preconnect(){}}) as typeof fetch;
 return()=>{globalThis.fetch=prior;};
}
test('current native HTTP sends require source authority and retain endpoint confinement',async()=>{
 let calls=0,revoked=false;const restore=endpoint(async()=>{calls++;});const authority=createMcpAuthority({assertOwner(){},assertConnection(){},captureSource:async()=>()=>{if(revoked)throw Error('Source revoked');}});
 const connected=await connectMcpHttp(config,fetch,undefined,undefined,authority);
 try{
  await expect(connected.client.callTool('echo',{message:'FORBIDDEN'})).rejects.toThrow();expect(calls).toBe(0);
  const result=await authority.invoke({} as never,context,()=>connected.client.callTool('echo',{message:'NATIVE_HTTP_OK'}));expect(JSON.stringify(result)).toContain('NATIVE_HTTP_OK');expect(calls).toBe(1);
  revoked=true;await expect(authority.invoke({} as never,context,()=>connected.client.callTool('echo',{message:'FORBIDDEN'}))).rejects.toThrow();expect(calls).toBe(1);
 }finally{await authority.cleanup(()=>connected.client.close());restore();}
});
for(const mode of ['abort','revocation'] as const)test(`current native HTTP concurrent calls keep ${mode} and source authority invocation-local`,async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),calls:string[]=[],first={},second={},abort=new AbortController();let revoked=false;
 const restore=endpoint(async message=>{calls.push(message);if(message==='held'){entered.resolve();await release.promise;}}),authority=createMcpAuthority({assertOwner(){},assertConnection(){},captureSource:async api=>()=>{if(api===first&&revoked)throw Error('First source revoked');}});
 const connected=await connectMcpHttp(config,fetch,undefined,undefined,authority);let pending:Promise<boolean>|undefined;
 try{
  pending=authority.invoke(first as never,withAbortSignal(abort.signal,context),()=>connected.client.callTool('echo',{message:'held'},{signal:abort.signal})).then(()=>false,()=>true);await entered.promise;
  expect(JSON.stringify(await authority.invoke(second as never,context,()=>connected.client.callTool('echo',{message:'independent'})))).toContain('independent');
  if(mode==='abort')abort.abort();else revoked=true;release.resolve();expect(await pending).toBe(true);
  expect(JSON.stringify(await authority.invoke(second as never,context,()=>connected.client.callTool('echo',{message:'still-authorised'})))).toContain('still-authorised');expect(calls).toEqual(['held','independent','still-authorised']);
 }finally{release.resolve();await pending;await authority.cleanup(()=>connected.client.close());restore();}
});
test('current native HTTP uncertain disposal retains one rejected runtime close without certification or retry',async()=>{
 const restore=endpoint(async()=>{}),database=new Database(':memory:'),store=new McpConnectionStore(database,()=>{});await store.save({id:config.id,name:config.name,url:config.url,workspaceId:'fixture',enabled:true,transport:'http',auth:'bearer',bearerTokenKeychain:'fixture/reference',allowHttp:false,timeoutSeconds:2});
 const runtime=createMcpRuntime({registry:createRegistry(),store,assertOwner(){},resolveAgent:async()=>undefined,captureSource:async()=>()=>{},async connect(_row,authority,signal){const connected=await connectMcpHttp(config,fetch,undefined,signal,authority);return{...connected,close:()=>connected.client.close()};}});
 const original=StreamableHttpTransport.prototype.close,failure=Error('Synthetic post-close uncertainty');const close=spyOn(StreamableHttpTransport.prototype,'close').mockImplementation(async function(this:StreamableHttpTransport){await original.call(this);throw failure;});
 try{
  await runtime.attach();await runtime.ready();expect(runtime.status('fixture')?.state).toBe('connected');const pending=runtime.close();expect(runtime.close()).toBe(pending);const outcome=await pending.then(()=>null,error=>error);expect(outcome).toBeInstanceOf(AggregateError);expect(await runtime.close().then(()=>null,error=>error)).toBe(outcome);expect(close).toHaveBeenCalledTimes(1);expect(runtime.status('fixture')).toBeUndefined();
 }finally{close.mockRestore();database.close();restore();}
});
