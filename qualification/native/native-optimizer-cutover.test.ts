import './src/test-guard.js';
import {expect} from 'bun:test';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {initDatabase,getDb,closeDatabase} from '../../runtime/src/db/connection.js';
import {acquireRuntimeLock} from '../../runtime/src/runtime/single-instance.js';
import {createDefaultApplicationRuntime} from '../../runtime/durable-engine/src/default-application-runtime.js';
import {createRuntimeBaseServices} from '../../runtime/src/runtime/composition.js';
import {createTestCredentialStore} from '../../runtime/test/model-services-fixture.js';
import {AgentPool} from '../../runtime/src/agent-pool.js';
import {WebChannel} from '../../runtime/src/channels/web.js';
import {handleAgentMessage} from '../../runtime/src/channels/web/handlers/agent.js';
import {ModelRuntime,ModelRegistry,SettingsManager} from '../../node_modules/@earendil-works/pi-coding-agent';
import {createAssistantMessageEventStream} from '../../node_modules/@earendil-works/pi-ai';
import {admitAddonLocalRequest} from '../../runtime/src/addons/local-context.js';
import {handleRegisteredAddonConfigApiRequest} from '../../runtime/src/channels/web/handlers/addon-config-api.js';
import {getPiclawAgentDir} from '../../runtime/src/core/agent-dir.js';
const test=isolatedApplicationTest(import.meta.url),json=(body:unknown,status=200)=>Response.json(body,{status});
for(const loop of ['rules','judge'] as const)test(`default application owns imported optimiser ${loop} tasks and SDK steering without host effects or replay`,async()=>{
 const workspace=process.env.PICLAW_WORKSPACE!;process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const database=getDb();
 const owner=acquireRuntimeLock({lockPath:join(workspace,'optimizer-cutover.lock'),strictOwnership:true,disabled:false});
 const credentials=createTestCredentialStore({fixture:{type:'api_key',key:'synthetic-only'}}),host=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
 const model=(id:string)=>({provider:'fixture',id,name:id,api:'openai-completions' as const,baseUrl:'https://fixture.invalid',input:['text' as const],reasoning:false,contextWindow:128000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}),main=model('main'),judge=model('judge');let mainCalls=0,judgeCalls=0,calibrationCalls=0,calibrating=loop==='judge';const judgeEntered=Promise.withResolvers<void>();
 const run=(physical:any,transcript:any)=>{const stream=createAssistantMessageEventStream();let content:any[],stopReason:'stop'|'toolUse'='stop';
  if(physical.id==='judge'){judgeCalls++;judgeEntered.resolve();content=[{type:'text',text:JSON.stringify({stuck:true,confidence:1,reason:'Repeated complete failed checks'})}];}
  else if(calibrating){calibrationCalls++;if(calibrationCalls%2){stopReason='toolUse';content=[{type:'toolCall',id:'calibrate-'+calibrationCalls,name:'bash',arguments:{command:'bun test '+join(workspace,'calibration.test.ts')}}];}else content=[{type:'text',text:'Calibration verified.'}];}
  else{mainCalls++;const redirected=database.query("SELECT 1 FROM entries WHERE json_extract(record,'$.kind')=? LIMIT 1").get(loop==='rules'?'piclaw.token-optimizer.goal-context':'token-economizer.redirect');if(redirected||mainCalls>12)content=[{type:'text',text:'Cutover fixture finished.'}];else{stopReason='toolUse';content=[{type:'toolCall',id:'check-'+mainCalls,name:'bash',arguments:{command:"printf 'AssertionError: repeated fixture\\n'; bun test /no-such-owned-cutover-fixture.test.ts"}}];}}
  const message:any={role:'assistant',api:physical.api,provider:physical.provider,model:physical.id,timestamp:Date.now(),content,stopReason,usage:{input:2,output:1,cacheRead:0,cacheWrite:0,totalTokens:3,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};queueMicrotask(async()=>{if(loop==='judge'&&physical.id==='main'&&!calibrating&&mainCalls===3)await judgeEntered.promise;stream.push({type:'done',reason:stopReason,message});stream.end(message);});return stream;
 };
 host.registerNativeProvider({id:'fixture',name:'Fixture',getModels:()=>[main,judge],auth:{apiKey:{name:'Synthetic',resolve:async()=>({auth:{},source:'fixture'})}},stream:run as any,streamSimple:run as any});await host.refresh({allowNetwork:false});await host.getAvailable();const registry=new ModelRegistry(host),settings=SettingsManager.create(workspace,getPiclawAgentDir());settings.setDefaultModelAndProvider('fixture','main');await settings.flush();
 const services:any={modelRuntime:host,modelRegistry:registry},base=createRuntimeBaseServices({dataDir:workspace});let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined,pool:AgentPool|undefined,channel:WebChannel|undefined;
 const request=(method:string,body?:unknown)=>{const req=new Request('http://fixture/agent/addons/api/token-optimizer/config',{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});admitAddonLocalRequest(req,{kind:'local',userId:'default',username:'default',displayName:'Fixture',role:'admin',mode:'single-user',homeChatJid:'web:default',authentication:{method:'fixture',sessionId:null,expiresAt:null}},()=>!req.signal.aborted);return req;};
 try{
  backend=await createDefaultApplicationRuntime(owner,async()=>services);pool=new AgentPool({credentialStore:credentials,modelRuntime:host,modelRegistry:registry,...backend.sessionOptions} as any);const bound=backend.bind({queue:base.queue,agentPool:pool});channel=new WebChannel(bound);backend.attachChannel!(channel);
  const get=await handleRegisteredAddonConfigApiRequest(request('GET'),'token-optimizer','config',json);expect(get?.status).toBe(200);const snapshot=await get!.json() as any;expect(snapshot.config.policy.enabled).toBe(false);expect(mainCalls+judgeCalls).toBe(0);
  const config=snapshot.config;Object.assign(config.policy,{oversightMode:'active',loop,goalChecks:loop==='rules',redirects:1,generativeModel:{provider:'fixture',id:'judge'},thresholds:{min_turns:2,gate_min_turns:2,gate_error_outputs:1,error_outputs:1,backstop_mult:1}});
  config.policy.savers.templates=true;
  const save=await handleRegisteredAddonConfigApiRequest(request('POST',{config,expectedRevision:snapshot.revision}),'token-optimizer','config',json);expect(save?.status,await save?.clone().text()).toBe(200);
  if(loop==='judge'){
   writeFileSync(join(workspace,'calibration.test.ts'),"import{test,expect}from'bun:test';test('owned calibration',()=>expect(1).toBe(1));\n");
   for(let round=1;round<=5;round++){
    const reply=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Calibrate a completed verification '+round})}),'/agent/default/message','web:default','default');expect(reply.status).toBe(201);
    const until=Date.now()+5000;let samples=0;while(samples<round&&Date.now()<until){const view=await handleRegisteredAddonConfigApiRequest(request('GET'),'token-optimizer','config',json);const state=await view!.json() as any;samples=state.status[0]?.process?.calibrationSamples??0;if(samples<round)await Bun.sleep(10);}expect(samples).toBe(round);
   }
   calibrating=false;
  }
  const admitted=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Exercise repeated complete failed checks'})}),'/agent/default/message','web:default','default');expect(admitted.status,await admitted.clone().text()).toBe(201);
  const deadline=Date.now()+15000;while((database.query('SELECT count(*) n FROM messages WHERE is_bot_message=1').get() as {n:number}).n<(loop==='judge'?6:1)&&Date.now()<deadline)await Bun.sleep(10);
  const statusResponse=await handleRegisteredAddonConfigApiRequest(request('GET'),'token-optimizer','config',json);const status=await statusResponse!.json();
  const debug={judgeCalls,status,tasks:database.query("SELECT record FROM tasks WHERE kind LIKE '%token-economizer%'").all()};
  expect(mainCalls,JSON.stringify(debug)).toBeLessThanOrEqual(12);expect(database.query("SELECT count(*) n FROM entries WHERE json_extract(record,'$.kind')=?").get(loop==='rules'?'piclaw.token-optimizer.goal-context':'token-economizer.redirect'),JSON.stringify(debug)).toEqual({n:1});
  expect(database.query('SELECT count(*) n FROM messages WHERE is_bot_message=1').get()).toEqual({n:loop==='judge'?6:1});expect(database.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
  if(loop==='judge')expect(judgeCalls).toBeGreaterThan(0);else expect(judgeCalls).toBe(0);
  const before=mainCalls+judgeCalls;await backend.close();backend=await createDefaultApplicationRuntime(owner,async()=>services);expect(mainCalls+judgeCalls).toBe(before);
 }finally{judgeEntered.resolve();await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();await closeDatabase();owner.release();}
},30000);
