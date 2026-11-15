import {installHistoricalExpenseFixture} from '../../runtime/test/fixtures/historical-expense.js';
import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import * as hostModels from '../../runtime/durable-engine/src/host-models.js';
const applicationTest=isolatedApplicationTest(import.meta.url);
const financial=['budget_work','budget_caps','budget_request_reservations','budget_usage_events'];

for(const auth of ['denied','expense-cap-changed'] as const)applicationTest(`actual factory provider authority remains independent of expense ownership: ${auth}`,async()=>{
  let armed=false,resolutions=0;
  const secret='FIXTURE_PRIVATE_AUTH_KEY';
  const f=await nativeGoalFixture(false,false,undefined,undefined,()=>{
    if(!armed)return;resolutions++;
    if(auth==='denied')throw Error('Invalid API key: '+secret);
    installHistoricalExpenseFixture(f.root);
    f.root.query("INSERT INTO budget_caps(id,scope,metric,amount,timezone,created_at,updated_at) VALUES ('changed-during-auth','instance_daily','api_usd_micros',0,'UTC','2020-01-01','2020-01-01')").run();
  });
  const snapshot=()=>historicalExpenseRows(f.root,financial);
  try{
    armed=true;const receipt=await f.send('One independently accepted request');
    if(auth==='expense-cap-changed'){await f.entered.promise;f.held.release();}
    await f.until(()=>f.root.query('SELECT 1 FROM messages WHERE is_bot_message=1').get()!==null);
    expect(resolutions).toBe(1);expect(f.calls()).toBe(auth==='denied'?0:1);
    const assistants=f.root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='pi.assistant'").all() as {record:string}[];
    expect(assistants).toHaveLength(1);
    const result=JSON.parse(assistants[0]!.record).model[0];
    expect(result.stopReason).toBe(auth==='denied'?'error':'stop');expect(JSON.stringify(result)).not.toContain(secret);
    const replies=f.root.query('SELECT content FROM messages WHERE is_bot_message=1').all() as {content:string}[];
    expect(replies).toHaveLength(1);expect(replies[0]!.content).not.toContain(secret);
    if(auth==='denied'){expect(replies[0]!.content).toContain('Turn failed');expect(f.status(receipt.submission_id)).toBe('unanswered');expect(result.usage.totalTokens).toBe(0);}
    else{expect(replies[0]!.content).toBe('Ordinary native reply');expect(f.status(receipt.submission_id)).toBe('done');expect(result.usage.totalTokens).toBe(2);}
    expect(historicalExpenseRows(f.root,['budget_work'])[0]).toEqual([]);expect(historicalExpenseRows(f.root,['budget_request_reservations'])[0]).toEqual([]);expect(historicalExpenseRows(f.root,['budget_usage_events'])[0]).toEqual([]);
    expect(f.root.query('SELECT state FROM service_effect_s01_sources').all()).toEqual([{state:'consumed'}]);
    const before=snapshot(),sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all(),messages=f.root.query('SELECT * FROM messages ORDER BY rowid').all();
    await f.reopen();expect(resolutions).toBe(1);expect(f.calls()).toBe(auth==='denied'?0:1);expect(snapshot()).toEqual(before);
    expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.root.query('SELECT * FROM messages ORDER BY rowid').all()).toEqual(messages);
    for(const table of ['service_effect_s01_operations','service_effect_s02_commits'])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{await f.close();}
},30000);

applicationTest('actual factory mandatory event fence preserves original usage but never publishes a provider success after source failure',async()=>{
  const create=hostModels.createHostModels;let fences=0,events=0;
  const observed:any[]=[];
  const spy=spyOn(hostModels,'createHostModels').mockImplementation((host,approved,policy)=>{
    const capture=policy.captureSourceGuard;
    let source:(()=>void)|undefined;
    return create(host,approved,{...policy,
      async captureSourceGuard(signal){source=await capture?.(signal);if(!source)throw Error('Real native source guard required');return source;},
      observeUsage(message,scope){observed.push(structuredClone(message));policy.observeUsage?.(message,scope);},
      captureEventObserver(){return {assertCurrent(){source!();fences++;throw Error('FIXTURE_PRIVATE_FENCE_FAILURE');},onEvent(){events++;}};},
    });
  });
  const f=await nativeGoalFixture(false,false,()=>[{type:'text',text:'Provider success must remain unpublished after source failure'}]);
  try{
    const accepted=await f.send('One source-fenced native request');await f.entered.promise;f.held.release();
    await f.until(()=>f.root.query('SELECT 1 FROM messages WHERE is_bot_message=1').get()!==null);
    expect(fences).toBe(1);expect(events).toBe(0);expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({stopReason:'stop',usage:{totalTokens:2},content:[{type:'text',text:'Provider success must remain unpublished after source failure'}]});
    const rows=f.root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='pi.assistant'").all() as {record:string}[];
    expect(rows).toHaveLength(1);const failed=JSON.parse(rows[0]!.record).model[0];expect(failed.stopReason).toBe('error');expect(failed.errorMessage).toContain('phase=source');expect(failed.usage.totalTokens).toBe(2);expect(JSON.stringify(failed)).not.toContain('FIXTURE_PRIVATE_FENCE_FAILURE');
    const published=f.root.query('SELECT content FROM messages WHERE is_bot_message=1').all() as {content:string}[];expect(published).toHaveLength(1);expect(published[0]!.content).toContain('Turn failed');expect(published[0]!.content).not.toContain('Provider success');
    expect(f.status(accepted.submission_id)).toBe('unanswered');expect(f.calls()).toBe(1);
    await f.until(()=>(f.root.query('SELECT count(*) n FROM token_usage').get() as {n:number}).n===1);
    expect(f.root.query('SELECT input_tokens,output_tokens,total_tokens FROM token_usage').all()).toEqual([{input_tokens:1,output_tokens:1,total_tokens:2}]);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();
    await f.reopen();expect(f.calls()).toBe(1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(observed).toHaveLength(1);
    for(const table of ['service_effect_s01_operations','service_effect_s02_commits',...financial])expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }finally{spy.mockRestore();await f.close();}
},30000);
