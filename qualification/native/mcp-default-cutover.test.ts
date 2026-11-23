import './src/test-guard.js';
import {expect} from 'bun:test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {initDatabase,getDb,closeDatabase} from '../../runtime/src/db/connection.js';
import {acquireRuntimeLock} from '../../runtime/src/runtime/single-instance.js';
import {createDefaultApplicationRuntime} from '../../runtime/durable-engine/src/default-application-runtime.js';
import {createHostKeychainTool} from '../../runtime/durable-engine/src/host-keychain-tool.js';
import {BACKGROUND_CONTEXT,withAbortSignal} from '../../runtime/durable-engine/qualification/context.js';
import type {ConversationId,TaskId,ToolExecutionApi} from '../../runtime/durable-engine/qualification/durable.js';
import {createRuntimeBaseServices} from '../../runtime/src/runtime/composition.js';
import {createTestCredentialStore} from '../../runtime/test/model-services-fixture.js';
import {AgentPool} from '../../runtime/src/agent-pool.js';
import {WebChannel} from '../../runtime/src/channels/web.js';
import {handleAgentMessage} from '../../runtime/src/channels/web/handlers/agent.js';
import {handleExtensionRoutes} from '../../runtime/src/channels/web/http/extension-routes.js';
import {handleRegisteredAddonConfigApiRequest} from '../../runtime/src/channels/web/handlers/addon-config-api.js';
import {admitAddonLocalRequest} from '../../runtime/src/addons/local-context.js';
import {getPiclawAgentDir} from '../../runtime/src/core/agent-dir.js';
import {setKeychainEntry,setKeyMaterialProviderForTests} from '../../runtime/src/secure/keychain.js';
import {ModelRuntime,ModelRegistry,SettingsManager} from '../../node_modules/@earendil-works/pi-coding-agent';
import {createAssistantMessageEventStream} from '../../node_modules/@earendil-works/pi-ai';

const test=isolatedApplicationTest(import.meta.url),path='/agent/settings/mcp';
test('native keychain checks exact task authority after the asynchronous capture', async () => {
 const controller=new AbortController();let captures=0;
 const api={conversationId:1 as ConversationId,taskId:2 as TaskId,callId:'inventory'} as ToolExecutionApi;
 const revoked=createHostKeychainTool({assertCurrent(){},async captureSourceGuard(call){
  captures++;expect(call).toEqual({conversationId:api.conversationId,taskId:api.taskId,toolCallId:api.callId});
  return ()=>{throw Error('revoked fixture');};
 }});
 expect(revoked.callers).toEqual(['model']);expect(revoked.replay).toBe('unsafe');
 await expect(revoked.execute({action:'list'},api,BACKGROUND_CONTEXT)).rejects.toThrow('revoked fixture');
 const cancelled=createHostKeychainTool({assertCurrent(){},async captureSourceGuard(){
  captures++;controller.abort(Error('cancelled fixture'));return ()=>{throw Error('must not inspect source after cancellation');};
 }});
 await expect(cancelled.execute({action:'list'},api,withAbortSignal(controller.signal,BACKGROUND_CONTEXT))).rejects.toThrow('cancelled fixture');
 expect(captures).toBe(2);
});
test('default outbound MCP migrates references, preserves script values, fences revocation and reopens without replay',async()=>{
 const workspace=process.env.PICLAW_WORKSPACE!;process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const database=getDb();
 const owner=acquireRuntimeLock({lockPath:join(workspace,'mcp-cutover.lock'),strictOwnership:true,disabled:false});
 const originalFetch=globalThis.fetch;let secret='SYNTHETIC_OLD',remoteCalls=0,modelCalls=0;
 const receipts:any[]=[];
 // Only the JSON-RPC endpoint is synthetic. Public SDK transport, client, tools,
 // source capture, code mode, persistence and application routing all execute.
 globalThis.fetch=Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);expect(request.url).toBe('https://mcp.fixture.invalid/mcp');expect(request.headers.get('authorization')).toBe('Bearer '+secret);
  if(request.method!=='POST')return new Response(null,{status:202});
  const rpc=await request.json() as any;if(rpc.id===undefined)return new Response(null,{status:202});let result:unknown={};
  if(rpc.method==='initialize')result={protocolVersion:rpc.params.protocolVersion,capabilities:{tools:{},resources:{}},serverInfo:{name:'fixture',version:'1'}};
  if(rpc.method==='tools/list')result={tools:[{name:'echo',description:'Return a complete structured fixture',inputSchema:{type:'object',properties:{message:{type:'string'}},required:['message']},outputSchema:{type:'object',properties:{message:{type:'string'},lines:{type:'array',items:{type:'string'}},tail:{type:'string'}},required:['message','lines','tail']}}]};
  if(rpc.method==='tools/call'){remoteCalls++;result={content:[{type:'text',text:'STRUCTURED_FIXTURE'}],structuredContent:{message:rpc.params.arguments.message,lines:Array.from({length:3000},(_,i)=>'line '+i),tail:'COMPLETE_TAIL'}};}
  if(rpc.method==='resources/list')result={resources:[{uri:'memory://fixture',name:'Fixture'}]};
  if(rpc.method==='resources/templates/list')result={resourceTemplates:[]};
  if(rpc.method==='resources/read')result={contents:[{uri:'memory://fixture',text:'RESOURCE_OK'}]};
  return Response.json({jsonrpc:'2.0',id:rpc.id,result});
 },{preconnect(){}}) as typeof fetch;
 setKeyMaterialProviderForTests({getKeyMaterial:()=>new TextEncoder().encode('owned-disposable-key')});
 await setKeychainEntry({name:'fixture/mcp',type:'token',secret});
 mkdirSync(join(workspace,'.pi'),{recursive:true});const legacyPath=join(workspace,'.pi/mcp.json');
 const legacy=JSON.stringify({mcpServers:{fixture:{url:'https://mcp.fixture.invalid/mcp',bearerTokenEnv:'FIXTURE_MCP_TOKEN',bearerTokenKeychain:'fixture/mcp',directTools:false}}});writeFileSync(legacyPath,legacy);
 const credentials=createTestCredentialStore({fixture:{type:'api_key',key:'synthetic-only'}}),host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
 const model:any={provider:'fixture',id:'main',name:'main',api:'openai-completions',baseUrl:'https://fixture.invalid',input:['text'],reasoning:false,contextWindow:128000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 let keychainDeclaration: any;
 let requestedTool='codemode';const code="const found=await searchTools('Return a complete structured fixture',{limit:4});if(!JSON.stringify(found).includes('mcp__fixture__echo'))throw Error('MCP discovery lost');const schema=await describeTool('mcp__fixture__echo');if(!JSON.stringify(schema).includes('message'))throw Error('MCP schema lost');const value=await tools.mcp__fixture__echo({message:'DEFAULT_HTTP'});if(value.lines.length!==3000||value.tail!=='COMPLETE_TAIL')throw Error('Script value lost');const resources=await tools.mcp__fixture__resources_list({});if(resources.resources[0].uri!=='memory://fixture')throw Error('Resource list lost');const resource=await tools.mcp__fixture__resource_read({uri:'memory://fixture'});if(resource.contents[0].text!=='RESOURCE_OK')throw Error('Resource value lost');return 'DEFAULT_SCRIPT_OK';";
 const run=(_physical:any,transcript:any)=>{modelCalls++;const stream=createAssistantMessageEventStream(),tool=modelCalls%2===1;if(!tool)receipts.push(transcript.messages.filter((message:any)=>message.role==='toolResult').at(-1));
  const declarations=transcript.messages.flatMap((message:any)=>message.toolsAdded??[]);
  expect(declarations.some((declaration:any)=>declaration.name?.startsWith('mcp__'))).toBe(false);
  if(modelCalls===1){expect(declarations.find((item:any)=>item.name==='codemode')?.description).toContain('searchTools()');expect(JSON.stringify(transcript)).not.toContain('Return a complete structured fixture');}
  keychainDeclaration ??= declarations.find((declaration:any)=>declaration.name==='keychain');
  const message:any={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content:tool?[{type:'toolCall',id:'code-'+modelCalls,name:requestedTool,arguments:requestedTool==='bash'?{command:'seq 1 3000'}:requestedTool==='keychain'?{action:'list',query:'fixture/mcp'}:{code}}]:[{type:'text',text:'Fixture settled.'}],stopReason:tool?'toolUse':'stop',usage:{input:2,output:1,cacheRead:0,cacheWrite:0,totalTokens:3,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message);});return stream;
 };
 host.registerNativeProvider({id:'fixture',name:'Fixture',getModels:()=>[model],auth:{apiKey:{name:'Synthetic',resolve:async()=>({auth:{},source:'fixture'})}},stream:run as any,streamSimple:run as any});await host.refresh({allowNetwork:false});await host.getAvailable();const registry=new ModelRegistry(host),settings=SettingsManager.create(workspace,getPiclawAgentDir());settings.setDefaultModelAndProvider('fixture','main');await settings.flush();
 const services:any={modelRuntime:host,modelRegistry:registry},base=createRuntimeBaseServices({dataDir:workspace});let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined,pool:AgentPool|undefined,channel:WebChannel|undefined;
 const request=(method='GET',body?:unknown,authenticated:boolean|'member'=true)=>{const req=new Request('https://fixture'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(authenticated)admitAddonLocalRequest(req,{kind:'local',userId:'default',username:'default',displayName:'Fixture',role:authenticated==='member'?'member':'admin',mode:'single-user',homeChatJid:'web:default',authentication:{method:'fixture',sessionId:null,expiresAt:null}},()=>!req.signal.aborted);return req;};
 const view=async()=>{const response=await handleExtensionRoutes(request(),path);expect(response?.status,await response?.clone().text()).toBe(200);return response!.json() as Promise<any>;};
 const connected=async()=>{const until=Date.now()+5000;let state:any;do{state=await view();if(state.connections[0]?.status?.state==='connected')return state;await Bun.sleep(10);}while(Date.now()<until);throw Error('MCP discovery did not connect: '+JSON.stringify(state));};
 const send=async(round:number)=>{const response=await handleAgentMessage(channel!,new Request('https://fixture/agent/default/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Owned MCP round '+round})}),'/agent/default/message','web:default','default');expect(response.status).toBe(201);const until=Date.now()+10000;while((database.query('SELECT count(*) n FROM messages WHERE is_bot_message=1').get() as any).n<round&&Date.now()<until)await Bun.sleep(10);expect((database.query('SELECT count(*) n FROM messages WHERE is_bot_message=1').get() as any).n).toBe(round);};
 try{
  backend=await createDefaultApplicationRuntime(owner,async()=>services);pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:registry,...backend.sessionOptions} as any);const bound=backend.bind({queue:base.queue,agentPool:pool});channel=new WebChannel(bound);backend.attachChannel!(channel);
  const routed=await channel.handleRequest(new Request('https://fixture'+path));expect(routed.status,await routed.clone().text()).toBe(200);expect((await routed.json() as any).connections).toHaveLength(1);
  const blocked=await channel.handleRequest(new Request('https://fixture'+path,{method:'POST',headers:{Origin:'https://untrusted.invalid',Host:'fixture','Content-Type':'application/json'},body:JSON.stringify({action:'save'})}));expect(blocked.status).toBe(403);
  const initial=await connected();let connection=initial.connections[0];expect(connection.hasSavedCredentials).toBe(true);expect(JSON.stringify(initial)).not.toContain('fixture/mcp');expect(JSON.stringify(initial)).not.toContain(secret);expect(remoteCalls+modelCalls).toBe(0);
  expect((await handleExtensionRoutes(request('GET',undefined,false),path))?.status).toBe(409);
  expect((await handleExtensionRoutes(request('GET',undefined,'member'),path))?.status).toBe(409);
  expect((await handleExtensionRoutes(request('POST',{action:'save',connection:{id:connection.id,enabled:false},expectedRevision:0}),path))?.status).toBe(409);
  expect((await handleExtensionRoutes(request('POST',{action:'save',connection:{id:connection.id,recall:{...initial.defaults.recall,mode:'observe'}},expectedRevision:connection.revision}),path))?.status).toBe(200);connection=(await connected()).connections[0];
  await send(1);expect(remoteCalls).toBe(1);expect(JSON.stringify(receipts[0])).toContain('DEFAULT_SCRIPT_OK');expect(receipts[0]?.isError).not.toBe(true);
  expect((database.query('SELECT count(*) n FROM mcp_recall').get() as any).n).toBeGreaterThan(0);
  database.run("INSERT INTO mcp_recall(id,digest,owner,conversation,after,tool,kind,grants,sources,handler,bytes,createdAt,lastSeen,hits,pinned,isError,summary,legacy,exact_raw,raw) SELECT 'foreign_'||id,digest,?,conversation,after,tool,kind,grants,sources,handler,bytes,createdAt,lastSeen,hits,pinned,isError,summary,legacy,exact_raw,raw FROM mcp_recall LIMIT 1",[JSON.stringify(['foreign_workspace','synthetic_env','web:foreign'])]);
  const journalBefore=database.query('SELECT count(*) n FROM entries').get();expect((await handleExtensionRoutes(request('POST',{action:'forget_recall',id:connection.id}),path))?.status).toBe(200);
  expect(database.query('SELECT owner FROM mcp_recall').all()).toEqual([{owner:JSON.stringify(['foreign_workspace','synthetic_env','web:foreign'])}]);expect(database.query('SELECT count(*) n FROM entries').get()).toEqual(journalBefore);
  expect((await handleExtensionRoutes(request('POST',{action:'save',connection:{id:connection.id,enabled:false},expectedRevision:connection.revision}),path))?.status).toBe(200);
  await send(2);expect(remoteCalls).toBe(1);expect(receipts[1]?.isError).toBe(true);
  secret='SYNTHETIC_ROTATED';await setKeychainEntry({name:'fixture/mcp',type:'token',secret});
  const disabled=(await view()).connections[0];expect((await handleExtensionRoutes(request('POST',{action:'save',connection:{id:connection.id,enabled:true},expectedRevision:disabled.revision}),path))?.status).toBe(200);await connected();
  await send(3);expect(remoteCalls).toBe(2);expect(JSON.stringify(receipts[2])).toContain('DEFAULT_SCRIPT_OK');expect(readFileSync(legacyPath,'utf8')).toBe(legacy);
  const retired=await handleRegisteredAddonConfigApiRequest(request(),'token-optimizer','config',(body,status=200)=>Response.json(body,{status}));expect(retired).toBeNull();
  requestedTool='bash';await send(4);
  expect(receipts[3]?.isError).not.toBe(true);expect(remoteCalls).toBe(2);
  expect(database.query("SELECT name FROM sqlite_schema WHERE name='retained_tool_outputs'").get()).toBeNull();
  expect(keychainDeclaration).toBeDefined();
  expect(Object.keys(keychainDeclaration.parameters.properties).sort()).toEqual(['action','limit','offset','query']);
  const inventoryBefore=database.query('SELECT name, type, hex(ciphertext) ciphertext FROM keychain_entries ORDER BY name').all();
  requestedTool='keychain';await send(5);
  expect(receipts[4]?.isError).not.toBe(true);
  expect(JSON.parse(receipts[4].content[0].text)).toEqual({count:1,total:1,offset:0,entries:[{name:'fixture/mcp',type:'token',shellEnv:'FIXTURE_MCP'}]});
  expect(JSON.stringify(receipts[4])).not.toContain(secret);
  expect(database.query('SELECT name, type, hex(ciphertext) ciphertext FROM keychain_entries ORDER BY name').all()).toEqual(inventoryBefore);
  expect(remoteCalls).toBe(2);
  expect(database.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
  const before=modelCalls;await backend.close();backend=await createDefaultApplicationRuntime(owner,async()=>services);await connected();expect(remoteCalls).toBe(2);expect(modelCalls).toBe(before);
 }finally{await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();owner.release();setKeyMaterialProviderForTests(null);globalThis.fetch=originalFetch;}
},30000);
