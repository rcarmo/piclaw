import {afterEach,expect,test} from 'bun:test';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createRegistry,Harness,MemoryStorage} from '@earendil-works/pi-durable';
import {createCodemodeExtension} from '@earendil-works/pi-durable/codemode';
import {CodemodeSandbox} from '@earendil-works/pi-codemode';
import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall,contentText} from '@earendil-works/pi-ai';
import {connectMcpHttp,mcpEndpoint,mcpFailure,mcpToolsExtension} from '../src/mcp/client.ts';
import {canonicalMcpAccess,mcpAgentAllowed,mcpAccessOverlaps} from '../src/mcp/policy.ts';
import {createMcpAuthority,type McpAuthority} from '../src/mcp/authority.ts';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const config={id:'fixture',name:'fixture',url:'https://fixture.invalid/mcp',bearer:'SYNTHETIC_TOKEN',allowHttp:false,timeoutSeconds:2};
test('MCP endpoint and diagnostic confinement',()=>{
 expect(mcpEndpoint(config.url)).toBe(config.url);
 expect(()=>mcpEndpoint('http://127.0.0.1/mcp')).toThrow();
 expect(mcpEndpoint('http://127.0.0.1/mcp',true)).toBe('http://127.0.0.1/mcp');
 for(const url of ['https://u:p@fixture.invalid/mcp','https://fixture.invalid/mcp?token=x','https://fixture.invalid/mcp#x','file:///tmp/x'])expect(()=>mcpEndpoint(url,true)).toThrow();
 expect(mcpFailure(Error(config.bearer))).not.toContain(config.bearer);
});
test('bearer is never forwarded through redirects',async()=>{
 let leaked=0;const destination=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){leaked++;return new Response('leak');}});cleanups.push(async()=>{destination.stop(true);});
 const redirect=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.redirect(destination.url,307);}});cleanups.push(async()=>{redirect.stop(true);});
 await expect(connectMcpHttp({...config,url:redirect.url.href,allowHttp:true})).rejects.toThrow();expect(leaked).toBe(0);
});
test('MCP grants retain explicit workspace and Agent boundaries',()=>{
 const grant={workspaceId:'a',agentIds:[],enabled:true,access:{kind:'workspaces' as const,grants:[{workspaceId:'a',agentIds:['one','one']}]}};
 expect(canonicalMcpAccess(grant.access)).toEqual({kind:'workspaces',grants:[{workspaceId:'a',agentIds:['one']}]});
 expect(mcpAgentAllowed(grant,'a','one')).toBe(true);expect(mcpAgentAllowed(grant,'a','two')).toBe(false);expect(mcpAgentAllowed(grant,'b','one')).toBe(false);
 expect(mcpAgentAllowed({...grant,enabled:false},'a','one')).toBe(false);expect(mcpAccessOverlaps(grant,{...grant,workspaceId:'b',access:{kind:'workspaces',grants:[{workspaceId:'b',agentIds:'all'}]}})).toBe(false);
});
async function serverFixture(outputSchema:unknown,result:unknown,resourceOnly=false,authority?:McpAuthority){
 let calls=0;const methods:string[]=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  expect(req.headers.get('authorization')).toBe('Bearer '+config.bearer);
  if(req.method==='GET')return new Response(null,{status:405});if(req.method==='DELETE')return new Response(null,{status:200});
  const rpc=await req.json() as {id?:number;method:string;params?:{cursor?:string}};methods.push(rpc.method);if(rpc.id===undefined)return new Response(null,{status:202});
  let value;
  switch(rpc.method){
   case 'initialize':value={protocolVersion:'2025-03-26',capabilities:{...(resourceOnly?{}:{tools:{}}),resources:{}},serverInfo:{name:'fixture',version:'1'}};break;
   case 'tools/list':if(resourceOnly)throw Error('Resource-only server must not get tools/list');value={tools:[{name:'probe',inputSchema:{type:'object',properties:{}},outputSchema}]};break;
   case 'tools/call':calls++;value=result;break;
   case 'resources/list':value={resources:[{uri:rpc.params?.cursor?'memory://second':'memory://first',name:'resource'}],nextCursor:rpc.params?.cursor?undefined:'second'};break;
   case 'resources/templates/list':value={resourceTemplates:[]};break;
   case 'resources/read':value={contents:[{uri:'memory://first',text:'Resource content'}]};break;
   default:throw Error('Unexpected '+rpc.method);
  }
  return Response.json({jsonrpc:'2.0',id:rpc.id,result:value});
 }});cleanups.push(async()=>{server.stop(true);});
 const c=await connectMcpHttp({...config,url:server.url.href,allowHttp:true},fetch,undefined,undefined,authority);cleanups.push(()=>authority?authority.cleanup(()=>c.client.close()):c.client.close());return {...c,calls:()=>calls,methods};
}
test('resource-only discovery and resource cursor pagination use the public client',async()=>{
 const c=await serverFixture(undefined,{},true);expect(c.tools).toEqual([]);expect(c.methods).not.toContain('tools/list');
 expect((await c.client.listResources()).map(r=>r.uri)).toEqual(['memory://first','memory://second']);expect((await c.client.readResource('memory://first')).contents[0]).toMatchObject({text:'Resource content'});
});
test('actual fetch boundary refuses missing or revoked source without sending a tool effect',async()=>{
 let source=true;
 const authority=createMcpAuthority({assertOwner(){},assertConnection(){},captureSource:async()=>()=>{if(!source)throw Error('revoked');}});
 const c=await serverFixture(undefined,{content:[{type:'text',text:'safe'}]},false,authority);
 await expect(c.client.callTool('probe',{})).rejects.toThrow();expect(c.calls()).toBe(0);
 const api={} as Parameters<typeof authority.invoke>[0];
 await authority.invoke(api,context,()=>c.client.callTool('probe',{}));expect(c.calls()).toBe(1);
 source=false;await expect(authority.invoke(api,context,()=>c.client.callTool('probe',{}))).rejects.toThrow('revoked');expect(c.calls()).toBe(1);
});
const payload={status:'success',data:{ready:true}},text=JSON.stringify(payload);
for(const fixture of [
 {name:'schema-less text and structured',schema:undefined,result:{content:[{type:'text',text}],structuredContent:payload},expected:text,error:false},
 {name:'schema-less structured-only',schema:undefined,result:{content:[],structuredContent:payload},expected:JSON.stringify(payload,null,2),error:false},
 {name:'schema-less null',schema:undefined,result:{content:[],structuredContent:null},expected:'null',error:false},
 {name:'structured',schema:{type:'object',properties:{status:{type:'string'}},required:['status']},result:{content:[{type:'text',text}],structuredContent:payload},expected:payload,error:false},
 {name:'declared schema violation',schema:{type:'object',properties:{status:{type:'string'}},required:['status']},result:{content:[],structuredContent:{status:42}},expected:undefined,error:true},
 {name:'explicit error',schema:undefined,result:{content:[{type:'text',text}],structuredContent:payload,isError:true},expected:undefined,error:true},
])test('MCP original nested value: '+fixture.name,async()=>{
 const c=await serverFixture(fixture.schema,fixture.result);
 const registry=createRegistry(),sandbox=new CodemodeSandbox();registry.install(createCodemodeExtension({sandbox,models:false}));registry.install(mcpToolsExtension(config,c.tools,async()=>c.client));
 const models=createModels(),faux=fauxProvider({tokensPerSecond:100000});models.setProvider(faux.provider);
 const harness=await Harness.open(new MemoryStorage(),{registry,models},context);cleanups.push(()=>harness.close(context));
 const root=await harness.root(context);await root.configure({model:{provider:'faux',modelId:'faux-1'}},context);
 const code=`let rejected=false,value;try{value=await tools.mcp__fixture__probe({});}catch{rejected=true;}if(rejected!==${fixture.error})throw Error('Error status changed');if(!rejected&&JSON.stringify(value)!==JSON.stringify(${JSON.stringify(fixture.expected)}))throw Error('Original value changed');return 'ORIGINAL_VALUE_OK';`;
 faux.setResponses([fauxAssistantMessage([fauxToolCall('codemode',{code})],{stopReason:'toolUse'}),request=>{
  const output=request.messages.filter(m=>m.role==='toolResult').map(m=>contentText(m.content)).join('\n');expect(output).toContain('ORIGINAL_VALUE_OK');expect(JSON.stringify(request)).not.toContain(config.bearer);return fauxAssistantMessage('Done');
 }]);
 expect((await(await root.submit({type:'input',content:'Synthetic MCP contract'},context)).wait(context)).status).toBe('done');expect(c.calls()).toBe(1);
});

test('explicit anonymous HTTP uses the public client without forwarding any bearer material',async()=>{
 let requests=0;const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){requests++;expect(request.headers.get('authorization')).toBeNull();if(request.method!=='POST')return new Response(null,{status:202});const rpc=await request.json() as any;if(rpc.id===undefined)return new Response(null,{status:202});return Response.json({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='initialize'?{protocolVersion:rpc.params.protocolVersion,capabilities:{},serverInfo:{name:'public',version:'1'}}:{}});}});cleanups.push(async()=>{server.stop(true);});
 const connected=await connectMcpHttp({...config,url:server.url.href,allowHttp:true,auth:'none',bearer:'MUST_NOT_BE_FORWARDED'});cleanups.push(()=>connected.client.close());expect(connected.tools).toEqual([]);expect(requests).toBeGreaterThan(0);
});
