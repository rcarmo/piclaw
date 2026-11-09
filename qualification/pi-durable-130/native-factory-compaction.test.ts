import {installHistoricalExpenseFixture} from '../../runtime/test/fixtures/historical-expense.js';
import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {Harness,createRegistry} from '../../runtime/durable-engine/qualification/durable.js';
import {createModels} from '../../runtime/durable-engine/qualification/ai.js';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.js';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.js';
import {HostConversationRuntime} from '../../runtime/durable-engine/src/host-runtime.js';
import {context} from './src/fixture.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

async function seedHistory(f:Awaited<ReturnType<typeof nativeGoalFixture>>){
  const first=await f.send('Baseline accepted native conversation');await f.entered.promise;f.held.release();await f.until(()=>f.status(first.submission_id)==='done');
  const binding=f.root.query("SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid='web:default' LIMIT 1").get() as {conversation_id:number};
  const path=(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
  await f.backend.close();
  const forbidden=async():Promise<never>=>{throw Error('History seeding must not resolve credentials or execute a model');};
  const harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path,{root:f.root,assertOwner:()=>f.owner.assertCurrentOwner(),fenceTransactions:true})),{models:createModels({authContext:{env:forbidden,fileExists:forbidden}}),registry:createRegistry()},context);
  try{
    expect((await harness.inspect(context)).scheduling).toBe('paused');
    const conversation=(await harness.conversation(binding.conversation_id as any,context))!;
    await conversation.commit(async tx=>{
      for(let index=0;index<6;index++)await tx.appendEntry(conversation.id,{kind:'pi.user',model:[{role:'user',content:`Historical fact ${index}: `+'Preserve the accepted decision. '.repeat(100),timestamp:index}]});
    },context);
  }finally{await harness.close(context);}
  await f.reopen();return binding.conversation_id;
}

for(const reportingFault of [false,true])applicationTest(`actual factory manual compaction uses SDK source/task authority without financial gates: report-fault=${reportingFault}`,async()=>{
  const open=Harness.open;
  const settings=spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>open.call(Harness,storage,{...options,settings:()=>{
    const current=typeof options.settings==='function'?options.settings():options.settings;
    return {...current,compaction:{...current?.compaction,enabled:false,keepRecentTokens:1}};
  }},ctx));
  const f=await nativeGoalFixture(false,false,()=>[{type:'text',text:'Native summary preserves the accepted decision'}]);
  const checked:{taskId:number;conversationId:number}[]=[];
  const validate=HostConversationRuntime.prototype.assertMaintenanceRequest;
  const source=spyOn(HostConversationRuntime.prototype,'assertMaintenanceRequest').mockImplementation(function(this:HostConversationRuntime,scope){
    validate.call(this,scope);checked.push({taskId:scope.taskId,conversationId:scope.conversationId});
    for(const bad of [{...scope,taskId:-1},{...scope,conversationId:-1},{...scope,phase:'select'},{...scope,signal:AbortSignal.abort()}])expect(()=>validate.call(this,bad)).toThrow();
  });
  try{
    const id=await seedHistory(f),beforeCalls=f.calls(),inputRows=f.root.query('SELECT * FROM submissions ORDER BY id').all(),sources=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all();
    const financial=()=>historicalExpenseRows(f.root,['budget_work','budget_caps','budget_request_reservations','budget_usage_events']),before=financial();
    installHistoricalExpenseFixture(f.root);
    for(const table of ['budget_work','budget_request_reservations','budget_usage_events'])for(const action of ['INSERT','UPDATE'])f.root.exec(`CREATE TEMP TRIGGER no_finance_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Retired financial owner must not run'); END`);
    if(reportingFault)f.root.exec("CREATE TEMP TRIGGER fail_compaction_report BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT,'Synthetic passive compaction report fault'); END");
    const position=f.backend.sessionOptions.getDurableSession!('web:default')!,identity=position.sessionId,model=await position.readModel!();
    expect(await position.compact!('Retain the accepted decision')).toEqual({compacted:true});
    expect(position.sessionId).toBe(identity);expect(await position.readModel!()).toBe(model);
    expect(f.calls()).toBe(beforeCalls+1);expect(checked.length).toBeGreaterThan(0);expect(checked.every(scope=>scope.conversationId===id)).toBe(true);
    const tasks=f.root.query("SELECT record FROM tasks WHERE kind=json_quote('pi.compaction')").all() as {record:string}[];expect(tasks).toHaveLength(1);
    const task=JSON.parse(tasks[0]!.record);expect(task).toMatchObject({conversationId:id,input:{reason:'manual'},state:{status:'terminal',outcome:{status:'completed'}}});
    expect(checked.every(scope=>scope.taskId===task.id)).toBe(true);
    expect(f.root.query("SELECT count(*) n FROM entries WHERE json_extract(record,'$.kind')='pi.compaction'").get()).toEqual({n:1});
    expect(f.root.query("SELECT total_tokens FROM token_usage WHERE usage_source='compaction'").all()).toEqual(reportingFault?[]:[{total_tokens:2}]);
    expect(financial()).toEqual(before);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(sources);
    const inputs=(f.root.query('SELECT record FROM submissions ORDER BY id').all() as {record:string}[]).filter(row=>JSON.parse(row.record).type==='input');expect(inputs).toHaveLength(inputRows.length);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();await f.reopen();expect(f.calls()).toBe(beforeCalls+1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(financial()).toEqual(before);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{source.mockRestore();settings.mockRestore();await f.close();}
},30000);

for(const threshold of ['blocking','background'] as const)for(const reportingFault of [false,true])applicationTest(`actual factory ${threshold} compaction has exact SDK source authority and no financial owner: report-fault=${reportingFault}`,async()=>{
  let enabled=false;const open=Harness.open;
  const settings=spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>open.call(Harness,storage,{...options,settings:()=>{
    const current=typeof options.settings==='function'?options.settings():options.settings;
    return {...current,compaction:{...current?.compaction,enabled,keepRecentTokens:1,reserveTokens:threshold==='blocking'?99999:1000,backgroundTokens:threshold==='blocking'?0:99000}};
  }},ctx));
  const f=await nativeGoalFixture(false,false,()=>[{type:'text',text:'Native automatic summary and reply'}]);
  const captures:{taskId:number;conversationId:number}[]=[];
  const capture=HostConversationRuntime.prototype.captureAutomaticCompaction;
  const source=spyOn(HostConversationRuntime.prototype,'captureAutomaticCompaction').mockImplementation(async function(this:HostConversationRuntime,scope,binding){
    const result=await capture.call(this,scope,binding);captures.push({taskId:scope.taskId,conversationId:scope.conversationId});
    expect(()=>capture.call(this,{...scope,phase:'select'},binding)).toThrow();expect(()=>capture.call(this,{...scope,signal:AbortSignal.abort()},binding)).toThrow();
    await expect(capture.call(this,{...scope,taskId:-1},binding)).rejects.toThrow('Exact automatic compaction task required');
    if(binding)expect(()=>capture.call(this,scope,{...binding,chatJid:'web:foreign'})).toThrow();
    if(threshold==='background')await expect(capture.call(this,scope)).rejects.toThrow('Exact automatic compaction source required');
    return result;
  });
  try{
    const id=await seedHistory(f),beforeCalls=f.calls();
    const financial=()=>historicalExpenseRows(f.root,['budget_work','budget_caps','budget_request_reservations','budget_usage_events']),before=financial();
    installHistoricalExpenseFixture(f.root);
    for(const table of ['budget_work','budget_request_reservations','budget_usage_events'])for(const action of ['INSERT','UPDATE'])f.root.exec(`CREATE TEMP TRIGGER no_auto_finance_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Retired automatic financial owner must not run'); END`);
    if(reportingFault)f.root.exec("CREATE TEMP TRIGGER fail_auto_compaction_report BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT,'Synthetic passive automatic report fault'); END");
    enabled=true;const accepted=await f.send('Continue after native automatic compaction');await f.until(()=>f.status(accepted.submission_id)==='done');
    await f.until(()=>(f.root.query("SELECT count(*) n FROM entries WHERE json_extract(record,'$.kind')='pi.compaction'").get() as {n:number}).n===1);
    const tasks=f.root.query("SELECT record FROM tasks WHERE kind=json_quote('pi.compaction')").all() as {record:string}[];expect(tasks).toHaveLength(1);
    const task=JSON.parse(tasks[0]!.record);expect(task).toMatchObject({conversationId:id,input:{reason:'threshold'},background:threshold==='background',state:{status:'terminal',outcome:{status:'completed'}}});
    if(threshold==='blocking')expect(task.owner).toBeGreaterThan(0);else expect(task.owner).toBeUndefined();
    expect(captures).toEqual([{taskId:task.id,conversationId:id}]);expect(f.calls()).toBe(beforeCalls+2);
    if(!reportingFault)await f.until(()=>(f.root.query("SELECT count(*) n FROM token_usage WHERE usage_source='compaction'").get() as {n:number}).n===1);
    expect(f.root.query("SELECT total_tokens FROM token_usage WHERE usage_source='compaction'").all()).toEqual(reportingFault?[]:[{total_tokens:2}]);
    expect(financial()).toEqual(before);const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all(),sources=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all();
    enabled=false;await f.reopen();expect(f.calls()).toBe(beforeCalls+2);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(sources);expect(financial()).toEqual(before);
    for(const table of ['service_effect_s01_operations','service_effect_s02_commits'])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{source.mockRestore();settings.mockRestore();await f.close();}
},30000);

applicationTest('actual factory aborts the exact admitted manual compaction during credential wait and never replays it on reopen',async()=>{
  const open=Harness.open;const settings=spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>open.call(Harness,storage,{...options,settings:()=>{
    const current=typeof options.settings==='function'?options.settings():options.settings;return {...current,compaction:{...current?.compaction,enabled:false,keepRecentTokens:1}};
  }},ctx));
  let hold=false,entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const f=await nativeGoalFixture(false,false,undefined,undefined,async()=>{if(hold){entered();await held;}});
  try{
    const id=await seedHistory(f),beforeCalls=f.calls(),sources=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all();hold=true;
    const position=f.backend.sessionOptions.getDurableSession!('web:default')!;
    const pending=position.compact!('This summary will be cancelled');const result=Promise.allSettled([pending]);
    await ready;expect(f.calls()).toBe(beforeCalls);
    const target=await position.readAbortScope!();expect(target).toMatchObject({kind:'sdk',conversationId:id,submissionIds:[]});expect(target&&'taskId'in target&&target.taskId).toBeGreaterThan(0);
    const aborting=position.abort!(target!);
    await f.until(()=>f.root.query("SELECT 1 FROM tasks WHERE id=? AND (json_extract(record,'$.abortRequested')=1 OR json_extract(record,'$.state.status')='terminal')").get((target as any).taskId)!==null);
    release();expect(await aborting).toBe(true);expect((await result)[0]!.status).toBe('rejected');expect(f.calls()).toBe(beforeCalls);
    const task=JSON.parse((f.root.query('SELECT record FROM tasks WHERE id=?').get((target as any).taskId) as {record:string}).record);expect(task.state).toMatchObject({status:'terminal',outcome:{status:'aborted'}});
    expect(f.root.query("SELECT * FROM entries WHERE json_extract(record,'$.kind')='pi.compaction'").all()).toEqual([]);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();hold=false;await f.reopen();expect(f.calls()).toBe(beforeCalls);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(sources);
    for(const table of ['budget_work','budget_request_reservations','budget_usage_events','service_effect_s01_operations','service_effect_s02_commits'])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{release();settings.mockRestore();await f.close();}
},30000);

applicationTest('actual factory background source capture can wait while the SDK publishes its parent reply, then finishes once without host settlement',async()=>{
  let enabled=false;const open=Harness.open;const settings=spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>open.call(Harness,storage,{...options,settings:()=>{
    const current=typeof options.settings==='function'?options.settings():options.settings;return {...current,compaction:{...current?.compaction,enabled,keepRecentTokens:1,reserveTokens:1000,backgroundTokens:99000}};
  }},ctx));
  const f=await nativeGoalFixture(false,false,()=>[{type:'text',text:'Parent reply is SDK-owned while background source capture waits'}]);
  let entered!:()=>void,release!:()=>void,held=false,captures=0;
  const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const capture=HostConversationRuntime.prototype.captureAutomaticCompaction;
  const source=spyOn(HostConversationRuntime.prototype,'captureAutomaticCompaction').mockImplementation(async function(this:HostConversationRuntime,...args:Parameters<typeof capture>){
    if(enabled&&!held){held=true;entered();await gate;}
    captures++;return capture.apply(this,args);
  });
  try{
    await seedHistory(f);const beforeCalls=f.calls(),messages=(f.root.query('SELECT count(*) n FROM messages WHERE is_bot_message=1').get() as {n:number}).n;
    enabled=true;const accepted=await f.send('Continue independently of the background source read');await ready;
    await f.until(()=>f.status(accepted.submission_id)==='done');await f.until(()=>(f.root.query('SELECT count(*) n FROM messages WHERE is_bot_message=1').get() as {n:number}).n===messages+1);
    expect(captures).toBe(0);expect(f.calls()).toBe(beforeCalls+1);expect(f.root.query("SELECT * FROM entries WHERE json_extract(record,'$.kind')='pi.compaction'").all()).toEqual([]);
    await f.until(()=>f.channel.getAgentStatus('web:default')?.phase==='compaction');expect(f.channel.getAgentStatus('web:default')).toMatchObject({sdk_observation:true,phase:'compaction'});
    release();await f.until(()=>(f.root.query("SELECT count(*) n FROM entries WHERE json_extract(record,'$.kind')='pi.compaction'").get() as {n:number}).n===1);
    expect(captures).toBe(1);expect(f.calls()).toBe(beforeCalls+2);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();enabled=false;await f.reopen();expect(f.calls()).toBe(beforeCalls+2);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);
    for(const table of ['budget_work','budget_request_reservations','budget_usage_events','service_effect_s01_operations','service_effect_s02_commits'])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{release();source.mockRestore();settings.mockRestore();await f.close();}
},30000);

applicationTest('actual factory resumes only the original paused manual SDK task while an unscoped historical expense hold stays inert',async()=>{
  const open=Harness.open;const settings=spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>open.call(Harness,storage,{...options,settings:()=>{
    const current=typeof options.settings==='function'?options.settings():options.settings;return {...current,compaction:{...current?.compaction,enabled:false,keepRecentTokens:1}};
  }},ctx));
  const f=await nativeGoalFixture(false,false,()=>[{type:'text',text:'Original recovered native summary'}]);
  try{
    const id=await seedHistory(f),beforeCalls=f.calls(),sources=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all();await f.backend.close();
    const path=(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
    const forbidden=async():Promise<never>=>{throw Error('Paused task setup must not execute a model or read credentials');};
    const harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path,{root:f.root,assertOwner:()=>f.owner.assertCurrentOwner(),fenceTransactions:true})),{models:createModels({authContext:{env:forbidden,fileExists:forbidden}}),registry:createRegistry()},context);
    let taskId:number;
    try{expect((await harness.inspect(context)).scheduling).toBe('paused');taskId=await (await harness.conversation(id as any,context))!.compact('Recover this exact manual task',context);expect(f.calls()).toBe(beforeCalls);}finally{await harness.close(context);}
    const domain=(f.root.query("SELECT incarnation FROM piclaw_durable_bindings_v1 WHERE chat_jid='web:default' LIMIT 1").get() as {incarnation:string}).incarnation,work=`durable-maintenance:${domain}:${taskId!}`;
    installHistoricalExpenseFixture(f.root);
    f.root.query("INSERT INTO budget_work(id,chat_jid,execution_kind,status,created_at,updated_at) VALUES (?,'web:default','side_prompt','active','2020-01-01','2020-01-01')").run(work);
    f.root.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at) VALUES ('historical-unscoped-summary',?,'web:default','fixture','lifecycle','historical-account',?,50,'unresolved','2020-01-01','2020-01-01')").run(work,'a'.repeat(64));
    const financial=()=>historicalExpenseRows(f.root,['budget_work','budget_request_reservations','budget_usage_events']),before=financial();
    await f.reopen();await f.backend.sessionOptions.getDurableSession!('web:default')!.reconcileMaintenance!();
    await f.until(()=>f.root.query("SELECT 1 FROM tasks WHERE id=? AND json_extract(record,'$.state.status')='terminal'").get(taskId!)!==null);
    const tasks=f.root.query("SELECT id,record FROM tasks WHERE kind=json_quote('pi.compaction')").all() as {id:number;record:string}[];expect(tasks.map(task=>task.id)).toEqual([taskId!]);expect(JSON.parse(tasks[0]!.record).state).toMatchObject({status:'terminal',outcome:{status:'completed'}});
    expect(f.calls()).toBe(beforeCalls+1);expect(financial()).toEqual(before);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(sources);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();await f.reopen();expect(f.calls()).toBe(beforeCalls+1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(financial()).toEqual(before);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{settings.mockRestore();await f.close();}
},30000);
