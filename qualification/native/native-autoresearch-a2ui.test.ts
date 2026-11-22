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
import { createAssistantMessageEventStream } from '../../node_modules/@earendil-works/pi-ai';
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
  let latestUserInput = '';
  const syncedForm = {fallback:'Native model sync form',keep_active:true,messages:[{version:'1.0',createSurface:{surfaceId:'draft',
    catalogId:CLASSIC_A2UI_CATALOG,sendDataModel:true,dataModel:{name:'Initial',other:'Metadata seed'},components:[
      {id:'root',component:'Column',children:['name','submit']},
      {id:'name',component:'TextField',label:'Name',value:{'@path':'/name'}},
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
   if(tool) results.set(name,JSON.stringify(tool.content));
   const stop = tool || name === 'none';
   const body:AssistantMessage["content"]=stop?[{type:'text',text:`Fixture returned ${name}`}]:[{type:'toolCall',id:`fixture-${name}`,name,
     arguments:name==='start_autoresearch'?{project_dir:project,prompt:'Synthetic trial',max_iterations:2}:
       name==='stop_autoresearch'?{generate_report:false}:name==='send_a2ui'?syncedForm:{}}];
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
   const issue=async(content:string)=>{const response=await request('/agent/default/message',{content});assert.equal(response.status,201);return await response.json() as { thread_id:number };};
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
   const form=await issue('Create synced form');
   const syncPost=await waitFor(() => lookup.get(syncedForm.fallback), 'sync form did not publish');
   await waitFor(() => settled(form.thread_id).total || undefined, 'sync publication did not settle');
   const syncBlock=getMessageByRowId(chat,syncPost.rowid)!.data.content_blocks!.find(isA2uiSurfaceBlock)!;
   assert(syncBlock.surface.sendDataModel);
   const modelFor = (name:string) => JSON.stringify({a2uiRendererDataModel:{version:'1.0',surfaces:{[syncBlock.surface.surfaceId]:{name,other:'Metadata seed'}}}});
   expectedTool='none';
   const plain=await issue('Ordinary renderer message');
   await waitFor(() => settled(plain.thread_id).total || undefined, 'ordinary turn did not settle');
   assert.equal(latestUserInput,`Ordinary renderer message\n\nA2UI renderer metadata:\n${modelFor('Initial')}`);
   const syncedAction={chat_jid:chat,post_id:syncPost.rowid,thread_id:form.thread_id,revision:1,request_id:crypto.randomUUID(),
     message:buildA2uiAction(syncBlock.surface,'submit',new Map([['/name','Edited']]),new Date().toISOString())};
   assert.equal((await request('/agent/a2ui-action',syncedAction)).status,201);
   assert.equal((await request('/agent/a2ui-action',syncedAction)).status,200);
   await waitFor(() => settled(form.thread_id).total===2 || undefined, 'synced action did not settle');
   assert.equal(latestUserInput,`Submitted saveName\nname: "Edited"\n\nA2UI renderer metadata:\n${modelFor('Edited')}`);
   assert(lookup.get('Submitted saveName\nname: "Edited"'));
   const after=await issue('Read latest model');
   await waitFor(() => settled(after.thread_id).total || undefined, 'model query did not settle');
   assert.equal(latestUserInput,`Read latest model\n\nA2UI renderer metadata:\n${modelFor('Edited')}`);
   console.log('Packed Autoresearch starts in the default SDK host; authenticated action starts the synthetic process once after the model turn, with bound status and stop.');
  } finally {await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();lock.release();}

}, 30_000);
