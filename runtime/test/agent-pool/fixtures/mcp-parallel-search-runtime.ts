/** Scripted model, real PiClaw session/bridge/adapter; deterministic MCP HTTP fixture. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {AssistantMessage,Model,Provider,ToolCall} from '@earendil-works/pi-ai';
const root=process.env.PICLAW_WORKSPACE!,mode=process.argv[2]??'normal';assert(root);assert.equal(process.env.PARALLEL_API_KEY,undefined);
process.env.PI_CODING_AGENT_DIR=join(root,'agent');process.env.PICLAW_PI_AGENT_DIR=join(root,'agent');
mkdirSync(join(root,'.piclaw'),{recursive:true});mkdirSync(join(root,'.pi'),{recursive:true});
writeFileSync(join(root,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}),{mode:0o600});
const saved={url:'https://explicit.invalid/mcp',disabled:true,includeTools:['custom']};
writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{saved}}));
const {createParallelSearchDraft}=await import('../../../web/src/ui/mcp-server-settings-model.js');
const {hydrateMcpKeychainCredentials,getPreparedMcpConfig,resetMcpStartupStateForTests}=await import('../../../src/secure/mcp-keychain.js');
const {McpCodemodeController,resetMcpCodemodeRuntimeForTests}=await import('../../../src/agent-pool/mcp-codemode-runtime.js');
resetMcpStartupStateForTests();resetMcpCodemodeRuntimeForTests();await hydrateMcpKeychainCredentials(root,()=>{throw Error('No credentials');});
assert.deepEqual(getPreparedMcpConfig().mcpServers,{saved}); // unconfigured startup adds no server
const controller=new McpCodemodeController({blockMcpAdmissions(){},async fenceMcpAndSnapshot(){return[];},resumeMcpAdmissions(){},async quarantineMcpRuntime(){throw Error('Unexpected quarantine');}});
const draft=createParallelSearchDraft([])!;
const preview=controller.inspectServers(draft);assert(!getPreparedMcpConfig().mcpServers['parallel-search']);
await controller.applyServers({revision:preview.revision,acknowledgeInterruptions:true},()=>{},new AbortController().signal);
assert.deepEqual(getPreparedMcpConfig().mcpServers.saved,saved);
assert.deepEqual(JSON.parse(readFileSync(join(root,'.pi/mcp.json'),'utf8')).mcpServers['parallel-search'],draft.patch);
assert.equal(createParallelSearchDraft([{name:'parallel-search'}]),null);
assert.throws(()=>controller.inspectServers(draft),/name|already exists/);
assert.throws(()=>controller.inspectServers({...draft,name:'saved'}),/already exists/);
// Exercise deliberate settings overrides through the same resolver, never fallback.
if(mode==='disabled'||mode==='excluded'||mode==='timeout'){
 const patch=mode==='disabled'?{disabled:true}:mode==='excluded'?{excludeTools:['web_search']}:{requestTimeoutMs:40};
 const next=controller.inspectServers({name:draft.name,action:'update',patch});
 await controller.applyServers({revision:next.revision,acknowledgeInterruptions:true},()=>{},new AbortController().signal);
}
const realFetch=globalThis.fetch,requests:Array<{method:string;rpc?:string;tool?:string;url:string;ua:string|null}>=[];
let toolEntered!:()=>void;const entered=new Promise<void>(resolve=>{toolEntered=resolve;});let aborted=0;
const fixtureFetch:typeof fetch=Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const request=new Request(input,init);const url=request.url;
 assert.equal(url,'https://search.parallel.ai/mcp');assert.equal(request.headers.get('authorization'),null);
 assert.equal(request.headers.get('user-agent'),'PiClaw (+https://github.com/rcarmo/piclaw)');
 let rpc:any=null;if(request.method==='POST')rpc=JSON.parse(await request.text());
 requests.push({method:request.method,rpc:rpc?.method,tool:rpc?.params?.name,url,ua:request.headers.get('user-agent')});
 if(request.method!=='POST')return new Response(null,{status:request.method==='GET'?405:200});
 if(rpc.id===undefined)return new Response(null,{status:202});
 const response=(result:unknown)=>Response.json({jsonrpc:'2.0',id:rpc.id,result});
 if(rpc.method==='initialize')return response({protocolVersion:rpc.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'parallel-test',version:'1'}});
 if(rpc.method==='tools/list')return response({tools:[
  {name:'web_search',description:'Search web sources',inputSchema:{type:'object',properties:{objective:{type:'string'},search_queries:{type:'array',items:{type:'string'}}},required:['objective','search_queries']}},
  {name:'web_fetch',description:'Fetch source pages',inputSchema:{type:'object',properties:{urls:{type:'array',items:{type:'string'}}},required:['urls']}},
  {name:'unrelated',description:'Not allowed',inputSchema:{type:'object',properties:{}}},
 ]});
 if(rpc.method==='resources/list')return response({resources:[]});
 if(rpc.method==='prompts/list')return response({prompts:[]});
 assert.equal(rpc.method,'tools/call');toolEntered();
 if(mode==='timeout'||mode==='cancel')return await new Promise<Response>((_,reject)=>{const stop=()=>{aborted++;reject(new DOMException('Aborted','AbortError'));};if(request.signal.aborted)stop();else request.signal.addEventListener('abort',stop,{once:true});});
 if(mode==='error')return response({isError:true,content:[{type:'text',text:'Synthetic service failure'}]});
 if(rpc.params.name==='web_search'){assert.deepEqual(rpc.params.arguments,{objective:'Find Bun documentation',search_queries:['Bun runtime documentation']});return response({content:[{type:'text',text:JSON.stringify({results:[{url:'https://bun.sh/docs',title:'Bun docs',excerpts:['Bun runs TypeScript.']}]})}]});}
 assert.equal(rpc.params.name,'web_fetch');assert.deepEqual(rpc.params.arguments,{urls:['https://bun.sh/docs']});
 return response({content:[{type:'text',text:JSON.stringify({results:[{url:'https://bun.sh/docs',excerpts:['Bun runtime documentation content.']}]})}]});
},{preconnect(){throw Error('Unexpected preconnect');}}) as typeof fetch;
globalThis.fetch=fixtureFetch;
const {ModelRuntime,SettingsManager}=await import('@earendil-works/pi-coding-agent');
const {InMemoryCredentialStore,createAssistantMessageEventStream}=await import('@earendil-works/pi-ai');
const {createSessionInDir}=await import('../../../src/agent-pool/session.js');
const {initDatabase,closeDatabase}=await import('../../../src/db/connection.js');initDatabase();
const modelRuntime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
const model:Model<'openai-completions'>={id:'scripted',provider:'parallel-fixture',name:'Scripted fixture',api:'openai-completions',baseUrl:'https://unused.invalid',reasoning:false,input:['text'],contextWindow:128000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
let pending:ToolCall|undefined,consumed=0;
const stream=(_model:unknown,context:any)=>{
 const call=pending;pending=undefined;
 const last=context.messages?.at(-1);let text='done';
 if(!call&&last?.role==='toolResult'){consumed++;text=JSON.stringify(last.content);}
 const message:AssistantMessage={role:'assistant',content:call?[call]:[{type:'text',text}],api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:call?'toolUse':'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
 const result=createAssistantMessageEventStream();result.push({type:'done',reason:call?'toolUse':'stop',message});return result;
};
const provider:Provider={id:model.provider,name:'Scripted fixture',getModels:()=>[model],auth:{apiKey:{name:'No credential',login:async()=>{throw Error('Forbidden');},resolve:async()=>({auth:{},source:'synthetic'})}},stream,streamSimple:stream};
modelRuntime.registerNativeProvider(provider);await modelRuntime.refresh({allowNetwork:false});
const settingsManager=SettingsManager.inMemory();settingsManager.applyOverrides({defaultProvider:model.provider,defaultModel:model.id,compaction:{enabled:false},retry:{enabled:false}});
const runtime=await createSessionInDir(join(root,'session'),{modelRuntime,settingsManager,tools:[],extensionFactories:[pi=>{pi.on('tool_call',event=>{if(mode==='permission'&&event.toolName==='mcp')return {block:true,reason:'Fixture permission denied'};});}]});
try{
 await runtime.session.bindExtensions({mode:'rpc',onError:event=>{throw Error(event.error);}});
 assert(runtime.session.getAllTools().some(tool=>tool.name==='mcp'));assert.equal(requests.length,0,'lazy startup must not connect');
 async function execute(id:string,args:Record<string,unknown>){pending={type:'toolCall',id,name:'mcp',arguments:args};await runtime.session.prompt('Scripted MCP fixture');assert.equal(pending,undefined);const result=runtime.session.messages.findLast(m=>m.role==='toolResult'&&m.toolCallId===id);assert(result&&result.role==='toolResult');return result;}
 let searchTool='web_search',fetchTool='web_fetch';
 if(mode==='normal'){
  const cold=await execute('cold-discovery',{search:'parallel-search'});assert.equal((cold.details as any)?.count,0);assert.equal(requests.length,0);
  const connected=await execute('connect',{connect:'parallel-search'});assert.equal(connected.isError,false);assert.equal((connected.details as any)?.error,undefined);
  const discovery=await execute('discovery',{search:'parallel-search'});
  const matches=(discovery.details as {matches:Array<{tool:string}>}).matches;
  searchTool=matches.find(match=>match.tool.endsWith('web_search'))?.tool!;fetchTool=matches.find(match=>match.tool.endsWith('web_fetch'))?.tool!;
  assert(searchTool&&fetchTool,JSON.stringify(discovery));assert.equal(matches.length,2);
  const description=await execute('describe',{describe:searchTool});assert(JSON.stringify(description).includes('objective'));
 }
 const args={server:'parallel-search',tool:searchTool,args:JSON.stringify({objective:'Find Bun documentation',search_queries:['Bun runtime documentation']})};
 if(mode==='cancel'){
  const call=execute('cancel',args);await entered;await runtime.session.abort();await call;assert(requests.some(r=>r.rpc==='notifications/cancelled'),JSON.stringify(requests));assert.equal(requests.filter(r=>r.tool).length,1);
 }else{
  const result=await execute('search',args);
  if(mode==='normal'){
   assert.equal(result.isError,false,JSON.stringify(result));assert(JSON.stringify(result).includes('https://bun.sh/docs'));
   const fetchResult=await execute('fetch',{server:'parallel-search',tool:fetchTool,args:JSON.stringify({urls:['https://bun.sh/docs']})});
   assert.equal(fetchResult.isError,false,JSON.stringify(fetchResult));assert(JSON.stringify(fetchResult).includes('Bun runtime documentation content.'));
   const denied=await execute('filtered',{server:'parallel-search',tool:'unrelated',args:'{}'});assert.equal((denied.details as any)?.error,'tool_not_found',JSON.stringify(denied));
   assert(consumed>=7,'scripted model must consume tool results');
   assert(requests.some(r=>r.rpc==='initialize'));assert(requests.some(r=>r.rpc==='tools/list'));
   assert.deepEqual(requests.filter(r=>r.tool).map(r=>r.tool),['web_search','web_fetch']);
  }else{
   if(mode==='disabled'||mode==='excluded')assert((result.details as any)?.error,JSON.stringify(result));else assert.equal(result.isError,true,JSON.stringify(result));
   if(mode==='error')assert(JSON.stringify(result).includes('Synthetic service failure'));
   if(mode==='disabled'||mode==='excluded'||mode==='permission')assert.equal(requests.filter(r=>r.tool).length,0);
   if(mode==='disabled'||mode==='permission')assert.equal(requests.length,0);
   if(mode==='timeout')assert(requests.some(r=>r.rpc==='notifications/cancelled'),JSON.stringify(requests));
  }
 }
 console.log(JSON.stringify({status:'pass',mode,scriptedModel:true,actualPiclawSession:true,consumed,requests,aborted}));
}finally{await runtime.dispose();globalThis.fetch=realFetch;closeDatabase();resetMcpStartupStateForTests();resetMcpCodemodeRuntimeForTests();}
