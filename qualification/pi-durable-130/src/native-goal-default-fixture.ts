import './test-guard.js';
import {expect} from 'bun:test';
import {cpSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {installGoalFixture} from '../goal-fixture.js';
import {initDatabase,getDb,closeDatabase} from '../../../runtime/src/db/connection.js';
import {acquireRuntimeLock} from '../../../runtime/src/runtime/single-instance.js';
import {createDefaultApplicationRuntime} from '../../../runtime/durable-engine/src/default-application-runtime.js';
import {createRuntimeBaseServices} from '../../../runtime/src/runtime/composition.js';
import {createTestCredentialStore} from '../../../runtime/test/model-services-fixture.js';
import {AgentPool} from '../../../runtime/src/agent-pool.js';
import {WebChannel} from '../../../runtime/src/channels/web.js';
import {handleAgentMessage} from '../../../runtime/src/channels/web/handlers/agent.js';
import {withExtensionKvAuthority} from '../../../runtime/src/extension-kv-registry.js';
import {ModelRuntime} from '../../../node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import {createAssistantMessageEventStream} from '../../../node_modules/@earendil-works/pi-ai';

const barrier=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};};
export async function nativeGoalFixture(completeReplacement=false,holdGoalAuth=false,program?:(attempt:number,transcript:any)=>any[],beforeAttach?:(channel:WebChannel)=>void,onAuth?:()=>void|Promise<void>){
  const workspace=process.env.PICLAW_WORKSPACE!,pkg=installGoalFixture(workspace);
  const plan=join(workspace,'.pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar');
  cpSync(join(process.env.DURABLE_ADDONS_ROOT!,'addons/plan-sidebar'),plan,{recursive:true,filter:path=>!path.split('/').includes('node_modules')});
  symlinkSync(join(import.meta.dir,'../../../node_modules'),join(plan,'node_modules'));
  process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const root=getDb();
  const owner=acquireRuntimeLock({lockPath:join(workspace,'native-goal-lifecycle.lock'),strictOwnership:true,disabled:false});
  const credentials=createTestCredentialStore({});
  const model:any={provider:'fixture',id:'lifecycle',name:'Fixture',api:'openai-completions',baseUrl:'https://fixture.invalid',input:['text'],reasoning:false,contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
  const entered=barrier(),held=barrier(),authEntered=barrier(),authReleased=barrier();let calls=0,authHeld=false;
  const run=(physical:any,transcript:any)=>{
    const out=createAssistantMessageEventStream(),attempt=++calls;
    void(async()=>{
      if(attempt===1){entered.release();await held.promise;}
      const completed=transcript.messages.some((message:any)=>message.role==='toolResult'&&message.toolName==='goal_complete'&&!message.isError);
      const content=program?program(attempt,transcript):completeReplacement&&attempt>1&&!completed?[{type:'toolCall',id:'complete-new-goal',name:'goal_complete',arguments:{summary:'The replacement goal reached its own accepted input',evidence:['Actual SDK request after stale predecessor was denied']}}]:[{type:'text',text:'Ordinary native reply'}];
      const message:any={role:'assistant',api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content,stopReason:content[0].type==='toolCall'?'toolUse':'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      out.push({type:'done',reason:message.stopReason,message});out.end(message);
    })();return out;
  };
  host.registerNativeProvider({id:model.provider,name:'Fixture',getModels:()=>[model],auth:{apiKey:{name:'Keyless fixture',resolve:async()=>{if(onAuth)await onAuth();if(holdGoalAuth&&calls===1&&!authHeld){authHeld=true;authEntered.release();await authReleased.promise;}return {auth:{},source:'fixture'};}}},stream:run as any,streamSimple:run as any});
  await host.refresh({allowNetwork:false});
  const services:any={modelRuntime:host,modelRegistry:{getAvailable:()=>[model]}};
  let backend=await createDefaultApplicationRuntime(owner,async()=>services),base=createRuntimeBaseServices({dataDir:workspace});
  let pool:AgentPool,channel:WebChannel;
  const bind=()=>{
    pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:services.modelRegistry,...backend.sessionOptions} as any);
    channel=new WebChannel(backend.bind({queue:base.queue,agentPool:pool}));beforeAttach?.(channel);backend.attachChannel!(channel);
    channel.queue.isLaneBusy=()=>{throw Error('Host queue cannot own native Goal input');};
  };bind();
  const addon=await import(pathToFileURL(join(pkg,'index.ts')).href);
  const scope=<T>(body:()=>T)=>withExtensionKvAuthority({extensionId:'goal',chatJid:'web:default',assertCurrent:()=>owner.assertCurrentOwner(),write<U>(run:()=>U):U{return root.transaction(run).immediate();}},body);
  const state=()=>scope(()=>addon.loadThreadGoal('web:default'));
  const command=(text:string)=>pool.applySlashCommand('web:default',text);
  const send=async(content:string,mode='auto')=>{const response=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content,mode})}),'/agent/default/message','web:default','default');expect(response.status).toBe(201);return response.json() as Promise<any>;};
  const queue=async()=>{const response=await channel.handleAgentQueueState(new Request('https://fixture/agent/queue-state?chat_jid=web:default'));expect(response.status).toBe(200);return (await response.json() as any).items as {row_id:number;content:string}[];};
  const until=async(check:()=>boolean|Promise<boolean>)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){if(await check())return;await Bun.sleep(10);}throw Error('Native Goal lifecycle boundary not reached');};
  const status=(id:number)=>(root.query('SELECT status FROM submissions WHERE id=?').get(id) as {status:string}|null)?.status;
  const stop=async()=>{const tool=addon.createGoalTools(()=> 'web:default',{async run(_name:string,_args:unknown,_ctx:unknown,body:()=>Promise<unknown>){return scope(body);}}).find((tool:any)=>tool.name==='goal_stop');return tool.execute('operator-stop',{reason:'user_needed',summary:'Stop the queued autonomous control'},undefined,undefined,{get sessionManager(){throw Error('Legacy Goal session forbidden');}});};
  return {root,owner,modelRuntime:host,model,get backend(){return backend;},get channel(){return channel;},get pool(){return pool;},entered,held,authEntered,authReleased,scope,state,command,send,queue,until,status,stop,calls:()=>calls,
    async reopen(){await backend.close();await channel.stop();await base.queue.shutdown();await pool.shutdown();backend=await createDefaultApplicationRuntime(owner,async()=>services);base=createRuntimeBaseServices({dataDir:workspace});bind();},
    async close(){held.release();authReleased.release();await backend.close();await channel.stop();await base.queue.shutdown();await pool.shutdown();await closeDatabase();owner.release();},
  };
}

