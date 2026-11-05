import './src/test-guard.js';
import {expect} from 'bun:test';
import {join} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
const applicationTest=isolatedApplicationTest(import.meta.url);

for(const fault of [false,true])applicationTest(`actual native tool and next model request ignore historical expense caps and passive reporting failure=${fault}`,async()=>{
  const file=join(process.env.PICLAW_WORKSPACE!,'native-owned-write.txt');
  const f=await nativeGoalFixture(false,false,attempt=>attempt===1?[{type:'toolCall',id:'native-write',name:'write',arguments:{path:file,content:'One owned native tool effect'}}]:[{type:'text',text:'Native tool completed without financial admission'}]);
  try{
    f.root.query("INSERT INTO budget_caps(id,scope,metric,amount,timezone,created_at,updated_at) VALUES ('historical-tool-cap','instance_daily','api_usd_micros',0,'UTC','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')").run();
    const history=()=>['budget_caps','budget_work','budget_request_reservations','budget_usage_events'].map(table=>f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),before=history();
    if(fault)f.root.exec("CREATE TEMP TRIGGER fail_passive_usage BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT,'synthetic reporting failure'); END");
    const accepted=await f.send('Write the explicitly approved fixture output and reply');await f.entered.promise;expect(existsSync(file)).toBe(false);f.held.release();
    await f.until(()=>f.root.query("SELECT 1 FROM messages WHERE is_bot_message=1 AND content='Native tool completed without financial admission'").get()!==null);
    expect(f.status(accepted.submission_id)).toBe('done');expect(f.calls()).toBe(2);expect(readFileSync(file,'utf8')).toBe('One owned native tool effect');
    const tools=f.root.query("SELECT record FROM tasks WHERE kind=json_quote('pi.tool')").all() as {record:string}[];
    expect(tools).toHaveLength(1);expect(JSON.parse(tools[0]!.record).state).toMatchObject({status:'terminal',outcome:{status:'completed'}});
    const assistants=(f.root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='pi.assistant' ORDER BY id").all() as {record:string}[]).map(row=>JSON.parse(row.record).model[0]);
    expect(assistants.map(message=>message.usage.totalTokens)).toEqual([2,2]);expect(assistants.map(message=>message.stopReason)).toEqual(['toolUse','stop']);
    expect(f.root.query('SELECT count(*) n FROM token_usage').get()).toEqual({n:fault?0:2});expect(history()).toEqual(before);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();
    if(fault)f.root.exec('DROP TRIGGER fail_passive_usage');await f.reopen();
    expect(f.calls()).toBe(2);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(readFileSync(file,'utf8')).toBe('One owned native tool effect');expect(history()).toEqual(before);
  }finally{await f.close();}
},30000);
