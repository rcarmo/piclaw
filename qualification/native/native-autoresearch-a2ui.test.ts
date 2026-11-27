import './src/test-guard.js';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import type { Model, AssistantMessage } from '../../node_modules/@earendil-works/pi-ai';
import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.ts';
import { getMessageByRowId, createWebSession } from '../../runtime/src/db.ts';
import { setWebTotpSecret } from '../../runtime/src/core/config.ts';
import { initializeWebAddonMessagingRuntime } from '../../runtime/src/runtime/startup.ts';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.ts';
import { getPiclawAgentDir } from '../../runtime/src/core/agent-dir.ts';
import { createTestCredentialStore } from '../../runtime/test/model-services-fixture.ts';
import { AgentPool } from '../../runtime/src/agent-pool.ts';
import { PiclawModelRegistry } from '../../runtime/src/agent-pool/model-services.js';
import { auditInstalledApplicationAddonSources } from '../../runtime/durable-engine/src/host-extension-catalog.js';
import { createRuntimeBaseServices } from '../../runtime/src/runtime/composition.ts';
import { WebChannel } from '../../runtime/src/channels/web.ts';
import { createDefaultApplicationRuntime } from '../../runtime/durable-engine/src/default-application-runtime.ts';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { createAssistantMessageEventStream, type JsonObject } from '../../node_modules/@earendil-works/pi-ai';
import { buildA2uiAction } from '../../runtime/src/channels/web/a2ui/action.ts';
import { CLASSIC_A2UI_CATALOG, isA2uiSurfaceBlock } from '../../runtime/src/channels/web/a2ui/surface.ts';

const applicationTest = isolatedApplicationTest(import.meta.url);

applicationTest('packed Autoresearch binds the native tool and consumes a later authenticated A2UI action', async () => {
  const workspace=process.env.PICLAW_WORKSPACE!;
  const absoluteRoot=fileURLToPath(new URL('../../',import.meta.url));
  const source=process.env.DURABLE_AUTORESEARCH_ROOT;
  assert(source, 'Missing pinned Autoresearch fixture');
  const {packAddon}=await import(pathToFileURL(join(source,'scripts/lib/pack-addon.ts')).href) as {packAddon(addonDir:string,outPath:string):void};
  const archive=join(workspace,'autoresearch-candidate.tgz');
  packAddon(join(source,'addons/autoresearch'),archive);
  const bins=join(workspace,'fixture-bin'), project=join(workspace,'fixture-project');
  const state=join(workspace,'tmux-synthetic-state'), log=join(workspace,'tmux-synthetic-log');
  mkdirSync(bins);mkdirSync(project);writeFileSync(join(project,'hello.txt'),'synthetic project');
  writeFileSync(join(bins,'pi'), 'console.log("fixture direct 100K")\n',{mode:0o755});
  writeFileSync(join(bins,'tmux'), `#!/bin/sh
  printf '%s\\n' "$1" >> '${log}'
  case "$1" in
   list-sessions) exit 1;;
   new-session) : > '${state}';;
   has-session) test -f '${state}';;
   send-keys) :;;
   kill-session) rm -f '${state}';;
   *) exit 91;;
  esac
  `,{mode:0o755});
  process.env.PATH=bins+':'+process.env.PATH;
  process.env.GIT_AUTHOR_NAME='Fixture';process.env.GIT_AUTHOR_EMAIL='fixture@example.invalid';
  process.env.GIT_COMMITTER_NAME='Fixture';process.env.GIT_COMMITTER_EMAIL='fixture@example.invalid';
  const nm=join(workspace,'.pi/extensions/node_modules');
  const pkg=join(nm,'@rcarmo/piclaw-addon-autoresearch'); mkdirSync(pkg,{recursive:true});
  assert.equal(Bun.spawnSync(['tar','-xzf',archive,'-C',pkg]).exitCode,0);
  symlinkSync(join(absoluteRoot,'node_modules/typebox'),join(nm,'typebox'));
  const launchSource=join(pkg,'launch-surface.ts');
  const pinned=readFileSync(launchSource);
  writeFileSync(launchSource,Buffer.concat([pinned,Buffer.from('\n// fixture mutation\n')]));
  assert.throws(()=>auditInstalledApplicationAddonSources(workspace),/Unqualified installed add-on package before evaluation/);
  writeFileSync(launchSource,pinned);
  process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();
  setWebTotpSecret('AAAAAAAAAAAAAAAA');
  const cookie=`piclaw_session=${crypto.randomUUID()}`; createWebSession(cookie.slice(cookie.indexOf('=')+1),'default',600,'totp');
  mkdirSync(getPiclawAgentDir(),{recursive:true});
  const lock=acquireRuntimeLock({lockPath:join(workspace,'native-a2ui-fixture.lock'),strictOwnership:true,disabled:false});
  const credentials=createTestCredentialStore({});
  const model:Model<"openai-completions">={provider:'fixture',id:'direct',name:'Fixture',api:'openai-completions',baseUrl:'https://fixture.invalid',input:['text'],reasoning:false,contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const models=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
  const results=new Map<string,string>();
  let expectedTool='start_autoresearch';
  const rpcCatalogue = 'urn:fixture:renderer-rpc:1';
  const rendererCall = {version:'1.0',callRendererFunction:{functionCallId:'native-renderer-1',
    callFunction:{'@call':'inspectLabel',catalogId:rpcCatalogue,args:{label:'Classic'}},
  }};
  let rendererToolArgs: {message:JsonObject;post_id?:number;revision?:number} = {message:rendererCall};
  let latestUserInput = '';
  let invalidForm = false, latestToolError = false;
  const invalidDraft = {fallback:'Rejected A2UI draft',messages:[{version:'1.0',createSurface:{surfaceId:'invalid-fixture',
    catalogId:CLASSIC_A2UI_CATALOG,components:[{id:'root',component:'NotAComponent'}],
  }}]};
  const syncedForm = {fallback:'Native model sync form',keep_active:true,messages:[{version:'1.0',createSurface:{surfaceId:'draft',
    catalogId:CLASSIC_A2UI_CATALOG,sendDataModel:true,dataModel:{name:'Initial',other:'Metadata seed'},components:[
      {id:'root',component:'Column',children:['name','memo','submit']},
      {id:'name',component:'TextField',label:'Name',value:{'@path':'/name'}},
      {id:'memo',component:'TextField',label:'Memo',value:{'@path':'/other'}},
      {id:'submit',component:'Button',child:'label',action:{event:{name:'saveName',context:{name:{'@path':'/name'}}}}},
      {id:'label',component:'Text',text:'Save'},
    ],
  }}]};
  type StreamArgs = Parameters<Parameters<typeof models.registerNativeProvider>[0]["streamSimple"]>;
  const run = (physical: StreamArgs[0], transcript: StreamArgs[1]) => {
   const sequence=transcript.messages, from=sequence.findLastIndex(m=>m.role==='user');
   const name=expectedTool;
   const user = sequence[from];
   if (user?.role === 'user') latestUserInput = typeof user.content === 'string' ? user.content : user.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
   const tool=sequence.slice(from+1).find(m=>m.role==='toolResult'&&m.toolName===name);
   if(tool?.role === 'toolResult') {
     results.set(name,JSON.stringify(tool.content));
     latestToolError = tool.isError;
   }
   const stop = tool || name === 'none';
   const body:AssistantMessage["content"]=stop?[{type:'text',text:`Fixture returned ${name}`}]:[{type:'toolCall',id:`fixture-${name}`,name,
     arguments:name==='start_autoresearch'?{project_dir:project,prompt:'Synthetic trial',max_iterations:2}:
       name==='stop_autoresearch'?{generate_report:false}:name==='send_a2ui'?(invalidForm?invalidDraft:syncedForm):
       name==='call_a2ui_renderer'?rendererToolArgs:{}}];
   const reason = stop ? 'stop' : 'toolUse';
   const message:AssistantMessage={role:'assistant',api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content:body,stopReason:reason,usage:{input:5,output:2,cacheRead:0,cacheWrite:0,totalTokens:7,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   const out=createAssistantMessageEventStream();out.push({type:'done',reason,message});out.end(message);return out;
  };
  models.registerNativeProvider({id:model.provider,name:'Fixture',getModels:()=>[model],auth:{apiKey:{name:'Fixture',resolve:async()=>({auth:{},source:'fixture'})}},stream:run,streamSimple:run});
  await models.refresh({allowNetwork:false});
  const services={modelRuntime:models,modelRegistry:new PiclawModelRegistry(models),credentialStore:credentials,agentDir:getPiclawAgentDir()};
  const base=createRuntimeBaseServices({dataDir:workspace});
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  let pool: AgentPool | undefined;
  let channel: WebChannel | undefined;
  const waitFor=async<T>(probe:()=>T|null|undefined,label:string):Promise<T>=>{let result;for(let i=0;i<400;i++){result=probe();if(result)return result;await Bun.sleep(20);}throw Error(label);};
  try {
   backend=await createDefaultApplicationRuntime(lock,async()=>services);
   pool=new AgentPool({credentialStore:credentials,modelRuntime:models,modelRegistry:services.modelRegistry,...backend.sessionOptions} as any);
   channel=new WebChannel(backend.bind({queue:base.queue,agentPool:pool}));
   assert(backend.attachChannel);
   backend.attachChannel(channel);
   await initializeWebAddonMessagingRuntime(pool, channel);
   assert.deepEqual(readFileSync(log,'utf8').trim().split('\n'),['list-sessions']);
   const request=(route:string,body:unknown,headers:Record<string,string>={})=>channel!.handleRequest(new Request('https://fixture'+route,{method:'POST',headers:{'content-type':'application/json',origin:'https://fixture',cookie,...headers},body:JSON.stringify(body)}));
   const issue=async(content:string,extra:Record<string,unknown>={})=>{const response=await request('/agent/default/message',{content,...extra});assert.equal(response.status,201);return await response.json() as { thread_id:number };};
   const chat='web:default';
   const launch=await issue('Launch picker');
   const lookup=db.query<{rowid:number;thread_id:number},[string]>('SELECT rowid,thread_id FROM messages WHERE content=?');
   const post=await waitFor(()=>lookup.get('Configure and launch the Autoresearch experiment.'),'native picker did not publish');
   assert.equal(post.thread_id,launch.thread_id);
   const block=getMessageByRowId(chat,post.rowid)!.data.content_blocks!.find(isA2uiSurfaceBlock)!;
   await waitFor(()=>results.get('start_autoresearch'),'start tool did not return');
   assert(results.get('start_autoresearch')!.includes('Model picker posted'));
   await waitFor(()=>db.query('SELECT rowid FROM messages WHERE is_terminal_agent_reply=1 AND thread_id=?').get(launch.thread_id),'initial model turn did not finish');
   assert(!existsSync(state));
   const button=block.surface.components.find(c=>c.component==='Button')!;
   const message=buildA2uiAction(block.surface,button.id,new Map<string,unknown>([['/model',['fixture/direct']],['/sandbox',true]]),new Date().toISOString());
   const payload={chat_jid:chat,post_id:post.rowid,thread_id:post.thread_id,revision:block.revision,request_id:crypto.randomUUID(),message};
   assert.equal((await request('/agent/a2ui-action',payload,{cookie:''})).status,401);
   assert.equal((await request('/agent/a2ui-action',payload)).status,200);
   assert(existsSync(state));
   assert.equal((await request('/agent/a2ui-action',payload)).status,409);
   assert.equal(readFileSync(log,'utf8').split('\n').filter(x=>x==='new-session').length,1);
   assert.equal(getMessageByRowId(chat,post.rowid)!.data.content_blocks!.find(isA2uiSurfaceBlock)!.state,'completed');
   expectedTool='autoresearch_status'; const status=await issue('Read experiment');
   await waitFor(()=>results.get('autoresearch_status'),'status tool did not return');
   assert(results.get('autoresearch_status')!.includes('Status: running'));
   await waitFor(()=>db.query('SELECT rowid FROM messages WHERE is_terminal_agent_reply=1 AND thread_id=?').get(status.thread_id),'status turn did not settle');
   expectedTool='stop_autoresearch'; const stopped=await issue('Stop experiment');
   await waitFor(()=>results.get('stop_autoresearch'),'stop tool did not return');
   assert(results.get('stop_autoresearch')!.includes('stopped'));
   assert(!existsSync(state));
   const settled = (thread: number) => db.query('SELECT count(*) AS total FROM messages WHERE is_terminal_agent_reply=1 AND thread_id=?').get(thread) as {total:number};
   await waitFor(() => settled(stopped.thread_id).total || undefined, 'stop turn did not settle');
   expectedTool='send_a2ui';
   const unnegotiated=await issue('Unnegotiated form request');
   await waitFor(() => settled(unnegotiated.thread_id).total || undefined, 'unnegotiated turn did not settle');
   assert.equal(lookup.get(syncedForm.fallback),null,'a turn without a renderer offer must not publish a form');
   const capabilities = {'1.0':{supportedCatalogIds:[CLASSIC_A2UI_CATALOG]}};
   const offer = {metadata:{a2uiRendererCapabilities:capabilities}};
   const discovery = (authenticated: boolean) => channel!.handleRequest(new Request('https://fixture/agent/a2ui-capabilities', {headers:authenticated ? {cookie} : {}}));
   const denied = await discovery(false);
   assert.equal(denied.status,302);
   assert.equal(denied.headers.get('location'),'/login');
   const advertised = await discovery(true);
   assert.equal(advertised.status,200);
   assert.deepEqual(await advertised.json(),{metadata:{a2uiAgentCapabilities:{'1.0':{...capabilities['1.0'],acceptsInlineCatalogs:false}}}});
   const unsupported=await issue('Unsupported catalogue request',{metadata:{a2uiRendererCapabilities:{'1.0':{supportedCatalogIds:['https://fixture.invalid/catalog']}}}});
   await waitFor(() => settled(unsupported.thread_id).total || undefined, 'unsupported catalogue turn did not settle');
   assert.equal(lookup.get(syncedForm.fallback),null);
   const form=await issue('Create synced form',offer);
   const syncPost=await waitFor(() => lookup.get(syncedForm.fallback), 'sync form did not publish');
   await waitFor(() => settled(form.thread_id).total || undefined, 'sync publication did not settle');
   const syncBlock=getMessageByRowId(chat,syncPost.rowid)!.data.content_blocks!.find(isA2uiSurfaceBlock)!;
   assert(syncBlock.surface.sendDataModel);
   expectedTool='none';
   const drafts = (revision: number) => [{surface_id:syncBlock.surface.surfaceId,revision,edits:[{component_id:'name',value:'Unsaved browser draft'}]}];
   const plain=await issue('Ordinary renderer message',{...offer,a2ui_drafts:drafts(1)});
   await waitFor(() => settled(plain.thread_id).total || undefined, 'ordinary turn did not settle');
   assert.equal(String(latestUserInput),'Ordinary renderer message');
   assert(lookup.get('Ordinary renderer message'));
   const forged = [{...drafts(1)[0]!,edits:[{component_id:'label',value:'Not an input'}]}];
   assert.equal((await request('/agent/default/message',{content:'Reject forged draft',...offer,a2ui_drafts:forged})).status,400);
   assert.equal(lookup.get('Reject forged draft'),null);
   const actionMessage=buildA2uiAction(syncBlock.surface,'submit',new Map([['/name','Edited']]),new Date().toISOString());
   const extensions={rendererExample:{note:'Private renderer extension',operation:'opaque'}};
   const syncedAction={...offer,chat_jid:chat,post_id:syncPost.rowid,thread_id:form.thread_id,revision:1,request_id:crypto.randomUUID(),
     message:{...actionMessage,action:{...actionMessage.action,metadata:{extensions}}},
     a2ui_drafts:[{...drafts(1)[0]!,edits:[{component_id:'memo',value:'Action-only model edit'}]}]};
   assert.equal((await request('/agent/a2ui-action',syncedAction)).status,201);
   assert.equal((await request('/agent/a2ui-action',syncedAction)).status,200);
   await waitFor(() => settled(form.thread_id).total===2 || undefined, 'synced action did not settle');
   const visibleAction=latestUserInput;
   assert.equal(visibleAction,'Submitted saveName\nname: "Edited"');
   assert(!latestUserInput.includes('A2UI renderer metadata'));
   const actionRow=lookup.get(visibleAction) as {rowid:number};
   assert(actionRow);
   assert(!JSON.stringify(getMessageByRowId(chat,actionRow.rowid)).includes('Private renderer extension'));
   const changedExtension={...syncedAction,message:{...syncedAction.message,action:{...syncedAction.message.action,
     metadata:{extensions:{rendererExample:'Changed after acceptance'}},
   }}};
   assert.equal((await request('/agent/a2ui-action',changedExtension)).status,409);
   const after=await issue('Read latest model',{metadata:{...offer.metadata,a2uiRendererMessage:changedExtension.message},a2ui_drafts:drafts(1)});
   await waitFor(() => settled(after.thread_id).total || undefined, 'model query did not settle');
   assert.equal(String(latestUserInput),'Read latest model');
   const diagnostic={chat_jid:chat,post_id:syncPost.rowid,thread_id:form.thread_id,revision:2,surface_id:syncBlock.surface.surfaceId,
     message:{version:'1.0',error:{code:'EXECUTION_ERROR',surfaceId:syncBlock.surface.surfaceId,message:'Raw browser diagnostic'}},
   };
   const countMessages = () => db.query<{total:number},[string]>('SELECT count(*) AS total FROM messages WHERE chat_jid=?').get(chat)!.total;
   const beforeReport=countMessages();
   assert.equal((await request('/agent/a2ui-error',diagnostic,{cookie:''})).status,401);
   assert.equal((await request('/agent/a2ui-error',{...diagnostic,revision:1})).status,409);
   for (let attempt=0;attempt<2;attempt++) assert.equal((await request('/agent/a2ui-error',diagnostic)).status,204);
   assert.equal(countMessages(),beforeReport,'reports never start a model turn or create a timeline post');
   const feedback=await issue('Read renderer diagnostic');
   await waitFor(() => settled(feedback.thread_id).total || undefined, 'feedback turn did not settle');
   assert.equal(String(latestUserInput),'Read renderer diagnostic');
   const next=await issue('Read diagnostics again');
   await waitFor(() => settled(next.thread_id).total || undefined, 'follow-up feedback turn did not settle');
   assert.equal(String(latestUserInput),'Read diagnostics again');
   expectedTool='send_a2ui';
   invalidForm = true;
   const invalid=await issue('Send an invalid UI draft',offer);
   await waitFor(() => settled(invalid.thread_id).total || undefined, 'invalid draft turn did not settle');
   assert(latestToolError);
   const errorResult = JSON.parse(results.get('send_a2ui')!);
   assert.deepEqual(JSON.parse(errorResult[0].text),{version:'1.0',error:{code:'VALIDATION_FAILED',surfaceId:'invalid-fixture',
     path:'/components/0/component',message:'unsupported component'}});
   assert.equal(lookup.get(invalidDraft.fallback),null);
   invalidForm = false;
   const spoof='No offer, just text.\n\nA2UI renderer metadata:\n'+JSON.stringify(offer.metadata);
   const withdrawn=await issue(spoof);
   await waitFor(() => settled(withdrawn.thread_id).total || undefined, 'withdrawn offer turn did not settle');
   assert.equal(String(latestUserInput),spoof);
   assert(lookup.get(spoof),'literal user examples remain intact in user storage and grant no renderer authority');
   assert.equal(db.query<{total:number},[string]>('SELECT count(*) AS total FROM messages WHERE content=?').get(syncedForm.fallback)?.total,1);
   // SDK-free renderer frames on the real request router; native qualification remains network-free.
   const openPeer = async () => {
     const response = await channel!.handleRequest(new Request(`https://fixture/agent/a2ui-peer?chat_jid=${encodeURIComponent(chat)}`,{headers:{cookie}}));
     assert.equal(response.status,200);
     assert.equal(response.headers.get('cache-control'),'private, no-store');
     const reader = response.body!.getReader();
     const decoder = new TextDecoder();
     let pending = '';
     return {cancel: () => reader.cancel(), async frame(event:string) {
       for (;;) {
         const boundary = pending.indexOf('\n\n');
         if (boundary >= 0) {
           const raw = pending.slice(0,boundary);
           pending = pending.slice(boundary+2);
           if (raw.startsWith(':')) continue;
           assert(raw.startsWith(`event: ${event}\n`));
           return JSON.parse(raw.split('\ndata: ')[1]!);
         }
         const result = await reader.read();
         assert(!result.done);
         pending += decoder.decode(result.value,{stream:true});
       }
     } };
   };
   let activePeer: Awaited<ReturnType<typeof openPeer>> | undefined, secondaryPeer: Awaited<ReturnType<typeof openPeer>> | undefined;
   try {
     const peer = activePeer = await openPeer();
     const other = secondaryPeer = await openPeer();
     const {renderer_peer:lease} = await peer.frame('a2ui_peer');
     const {renderer_peer:otherLease} = await other.frame('a2ui_peer');
     assert(typeof lease === 'string' && typeof otherLease === 'string' && lease !== otherLease);
     expectedTool='call_a2ui_renderer';
     const peerOffer = {renderer_peer:lease,metadata:{a2uiRendererCapabilities:{'1.0':{
       supportedCatalogIds:[CLASSIC_A2UI_CATALOG,rpcCatalogue],
     }}}};
     const invoked = await issue('Invoke the accepted renderer',peerOffer);
     assert.deepEqual(await peer.frame('a2ui_call'),{message:rendererCall});
     assert(!latestUserInput.includes(lease));
     const message={version:'1.0',rendererFunctionResponse:{functionCallId:'native-renderer-1',value:'CLASSIC'}};
     const reply = (renderer_peer: string) => request('/agent/a2ui-renderer-reply',{chat_jid:chat,renderer_peer,message});
     assert.equal((await reply(otherLease)).status,409);
     assert.equal((await reply(lease)).status,204);
     assert.equal((await reply(lease)).status,409);
     await waitFor(() => settled(invoked.thread_id).total || undefined,'renderer RPC turn did not settle');
     assert.equal(latestToolError,false);
     const toolReply = () => JSON.parse(JSON.parse(results.get('call_a2ui_renderer')!)[0].text);
     assert.deepEqual(toolReply(),message);
     const boundCall = {version:'1.0',callRendererFunction:{surfaceId:syncBlock.surface.surfaceId,functionCallId:'native-renderer-bound',
       callFunction:{'@call':'inspectLabel',catalogId:rpcCatalogue,args:{label:{'@path':'/name'}}},
     }};
     rendererToolArgs={message:boundCall,post_id:syncPost.rowid,revision:2};
     await issue('Invoke the current surface',{...peerOffer,thread_id:form.thread_id});
     assert.deepEqual(await peer.frame('a2ui_call'),{message:boundCall,source:{post_id:syncPost.rowid,thread_id:form.thread_id,revision:2}});
     const boundReply={version:'1.0',rendererFunctionResponse:{functionCallId:'native-renderer-bound',value:'Edited'}};
     const privateDraft='Private reverse reply draft';
     const replyDrafts=[{surface_id:syncBlock.surface.surfaceId,revision:2,edits:[{component_id:'name',value:privateDraft}]}];
     const submitBoundReply=(extra:Record<string,unknown>)=>request('/agent/a2ui-renderer-reply',{chat_jid:chat,renderer_peer:lease,message:boundReply,...extra});
     assert.equal((await submitBoundReply({metadata:{a2uiRendererDataModel:{version:'1.0',surfaces:{forged:{}}}}})).status,400);
     assert.equal((await submitBoundReply({a2ui_drafts:[{...replyDrafts[0],edits:[{component_id:'label',value:privateDraft}]}]})).status,400);
     assert.equal((await submitBoundReply({a2ui_drafts:replyDrafts})).status,204);
     await waitFor(() => settled(form.thread_id).total===3 || undefined,'bound renderer RPC did not settle');
     assert.deepEqual(toolReply(),boundReply);
     assert.equal(JSON.parse(results.get('call_a2ui_renderer')!).length,1,'renderer replies contain only the requested function response');
     assert(!results.get('call_a2ui_renderer')!.includes('A2UI renderer metadata:'));
     const lastAnswer=db.query<{rowid:number},[number]>('SELECT rowid FROM messages WHERE is_terminal_agent_reply=1 AND thread_id=? ORDER BY rowid DESC LIMIT 1').get(form.thread_id)!;
     const activity=await channel!.handleRequest(new Request(`https://fixture/agent/turn-activity?chat_jid=${encodeURIComponent(chat)}&message_id=${lastAnswer.rowid}`,{headers:{cookie}}));
     assert.equal(activity.status,200);
     const publicActivity=await activity.text();
     assert(!publicActivity.includes(privateDraft),'private reply metadata must not appear in turn activity');
     assert(publicActivity.includes('native-renderer-bound'));
     assert.equal(getMessageByRowId(chat,syncPost.rowid)!.data.content_blocks!.find(isA2uiSurfaceBlock)!.surface.dataModel.name,'Edited');
     rendererToolArgs={...rendererToolArgs,revision:1};
     await issue('Try an obsolete surface revision',{...peerOffer,thread_id:form.thread_id});
     await waitFor(() => settled(form.thread_id).total===4 || undefined,'obsolete renderer RPC did not settle');
     assert.equal(toolReply().rendererFunctionResponse.error.code,'INVALID_FUNCTION_CALL');
     const functionCallId='native-malformed-delivery';
     rendererToolArgs={message:{...rendererCall,callRendererFunction:{...rendererCall.callRendererFunction,functionCallId}}};
     const failed=await issue('Report a malformed renderer invocation',peerOffer);
     assert.deepEqual(await peer.frame('a2ui_call'),{message:rendererToolArgs.message});
     const report={chat_jid:chat,renderer_peer:lease,message:{version:'1.0',error:{code:'INVALID_FUNCTION_CALL',functionCallId,message:'Untrusted renderer text'}}};
     assert.equal((await request('/agent/a2ui-renderer-reply',{...report,renderer_peer:otherLease})).status,409);
     assert.equal((await request('/agent/a2ui-renderer-reply',report)).status,204);
     await waitFor(()=>settled(failed.thread_id).total || undefined,'malformed renderer diagnostic did not settle');
     assert.equal(latestToolError,true);
     assert.deepEqual(toolReply(),{version:'1.0',error:{code:'INVALID_FUNCTION_CALL',functionCallId,message:'The renderer rejected a malformed invocation.'}});
   } finally { await Promise.allSettled([activePeer?.cancel(),secondaryPeer?.cancel()]); }
   console.log('Packed Autoresearch starts in the default SDK host; authenticated action starts the synthetic process once after the model turn, with bound status and stop.');
  } finally {await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();lock.release();}

}, 30_000);
