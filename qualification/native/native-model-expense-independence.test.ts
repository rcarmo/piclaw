import {installHistoricalExpenseFixture} from '../../runtime/test/fixtures/historical-expense.js';
import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {join} from 'node:path';
import {getPiclawAgentDir} from '../../runtime/src/core/agent-dir.js';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {initDatabase,getDb,closeDatabase} from '../../runtime/src/db/connection.js';
import {storeChatMetadata} from '../../runtime/src/db/messages.js';
import {acquireRuntimeLock} from '../../runtime/src/runtime/single-instance.js';
import {createTestCredentialStore} from '../../runtime/test/model-services-fixture.js';
import {createRuntimeBaseServices} from '../../runtime/src/runtime/composition.js';
import {AgentPool} from '../../runtime/src/agent-pool.js';
import {WebChannel} from '../../runtime/src/channels/web.js';
import {createDefaultApplicationRuntime} from '../../runtime/durable-engine/src/default-application-runtime.js';
import {PiclawModelRegistry} from '../../runtime/src/agent-pool/model-services.js';
import {ModelRuntime,SessionManager} from '../../node_modules/@earendil-works/pi-coding-agent';

const applicationTest=isolatedApplicationTest(import.meta.url);
for(const when of ['before-startup','after-startup'] as const)applicationTest(`native model/catalogue/routing metadata ignores inert historical expense caps: ${when}`,async()=>{
  const workspace=process.env.PICLAW_WORKSPACE!;process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const root=getDb();
  const owner=acquireRuntimeLock({lockPath:join(workspace,'model-expense-independent.lock'),strictOwnership:true,disabled:false});
  const model:any={provider:'fixture',id:'approved',name:'Approved',api:'openai-completions',baseUrl:'https://fixture.invalid',input:['text'],reasoning:false,contextWindow:100000,maxTokens:1000,cost:{input:0.25,output:1.25,cacheRead:0,cacheWrite:0}},other={...model,id:'approved-b',name:'Other'};
  const credentials=createTestCredentialStore({});
  const runtime=await ModelRuntime.create({credentials,modelsPath:null,modelsStore:{read:async()=>undefined,write:async()=>{},delete:async()=>{}},allowModelNetwork:false,refreshOnCreate:false});
  let calls=0;const deny=()=>{calls++;throw Error('Model metadata cannot invoke a provider');};
  runtime.registerNativeProvider({id:model.provider,name:'Fixture',getModels:()=>[model,other],auth:{apiKey:{name:'Keyless fixture',resolve:async()=>({auth:{},source:'fixture'})}},stream:deny,streamSimple:deny});
  await runtime.refresh({allowNetwork:false});await runtime.getAvailable();const modelRegistry=new PiclawModelRegistry(runtime),services={modelRuntime:runtime,modelRegistry,credentialStore:credentials,agentDir:getPiclawAgentDir()};
  const seed=()=>{installHistoricalExpenseFixture(root);return root.query("INSERT INTO budget_caps(id,scope,metric,amount,timezone,created_at,updated_at) VALUES ('historical-zero','instance_daily','api_usd_micros',0,'UTC','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')").run();};
  if(when==='before-startup')seed();
  const sdkSpies=[spyOn(SessionManager,'create'),spyOn(SessionManager,'open'),spyOn(SessionManager,'inMemory')];
  let backend:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined,pool:AgentPool|undefined,channel:WebChannel|undefined;
  const base=createRuntimeBaseServices({dataDir:workspace});
  try{
    backend=await createDefaultApplicationRuntime(owner,async()=>services);
    pool=new AgentPool({credentialStore:credentials,modelRuntime:runtime,modelRegistry,...backend.sessionOptions} as any);
    const bound=backend.bind({queue:base.queue,agentPool:pool});channel=new WebChannel(bound);
    if(when==='after-startup')seed();
    const financial=()=>historicalExpenseRows(root,['budget_caps','budget_work','budget_request_reservations','budget_usage_events','token_usage']);
    const before=financial(),first=backend.sessionOptions.getDurableSession!('web:default')!,identity=first.sessionId;
    const catalogue=await pool.getAvailableModels('web:default',{includeProviderUsage:false,includeProviderDiagnostics:false});
    expect(catalogue.model_options?.find(entry=>entry.provider===model.provider&&entry.id===model.id)?.pricing).toMatchObject({input_per_million:0.25,output_per_million:1.25});
    await first.setModel!({provider:other.provider,modelId:other.id});expect(await first.readModel!()).toBe(`${other.provider}/${other.id}`);
    const created=await pool.createRootChatSession('expense-independent-model-metadata');await bound.prepareInputSourceAdmission!(created.chat_jid);
    expect(await backend.sessionOptions.getDurableSession!(created.chat_jid)!.readModel!()).toBe(`${model.provider}/${model.id}`);
    storeChatMetadata('web:expense-model-revoked',new Date().toISOString());const conversations=root.query('SELECT * FROM conversations ORDER BY id').all();
    const revoked=spyOn(modelRegistry,'getAvailable').mockReturnValue([]);
    try{await expect(bound.prepareInputSourceAdmission!('web:expense-model-revoked')).rejects.toThrow('Host model no longer available');}finally{revoked.mockRestore();}
    expect(root.query('SELECT * FROM conversations ORDER BY id').all()).toEqual(conversations);expect(root.query('SELECT * FROM tasks').all()).toEqual([]);expect(calls).toBe(0);expect(financial()).toEqual(before);
    await backend.close();backend=await createDefaultApplicationRuntime(owner,async()=>services);
    const reopened=backend.sessionOptions.getDurableSession!('web:default')!;
    expect(reopened.sessionId).toBe(identity);expect(await reopened.readModel!()).toBe(`${other.provider}/${other.id}`);expect(backend.sessionOptions.getDurableSession!(created.chat_jid)).toBeDefined();
    expect(financial()).toEqual(before);expect(calls).toBe(0);for(const spy of sdkSpies)expect(spy).not.toHaveBeenCalled();
    await backend.close();await expect(reopened.setModel!({provider:model.provider,modelId:model.id})).rejects.toThrow();expect(financial()).toEqual(before);
  }finally{await backend?.close();await channel?.stop();await base.queue.shutdown();await pool?.shutdown();for(const spy of sdkSpies)spy.mockRestore();await closeDatabase();owner.release();}
},30000);
