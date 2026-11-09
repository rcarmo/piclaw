import { expect, test } from "bun:test";
import { createTempWorkspace } from "../helpers.js";
import { join } from 'node:path';
import { readUsageProjectionEvent } from '../../src/db/usage-report-projection.js';
import * as dbApi from "../../src/db.js";
import { getDb, initDatabase, initializeDatabaseSchema } from "../../src/db/connection.js";
import { installHistoricalExpenseFixture } from '../fixtures/historical-expense.js';
import { Database } from 'bun:sqlite';
import { recordMessageUsage } from "../../src/agent-pool/usage.js";

function financialSnapshot() {
  const database = getDb();
  const tables = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'budget_%' ORDER BY name").all() as {name:string}[];
  return tables.map(({name}) => [name, database.query(`SELECT * FROM ${name} ORDER BY rowid`).all()]);
}

test('fresh roots create passive reports without financial tables, triggers or migration receipts', () => {
  initDatabase(); const database=getDb();
  expect(database.query("SELECT name FROM main.sqlite_schema WHERE name GLOB 'budget_*'").all()).toEqual([]);
  expect(database.query("SELECT * FROM piclaw_schema_migrations WHERE owner IN ('host.budget-request-reservations','host.usage-reports')").all()).toEqual([]);
  expect(readUsageProjectionEvent(database,'absent-historical-event')).toBeNull();
  recordMessageUsage('web:fresh-no-finance',{id:'fresh-usage',role:'assistant',provider:'fixture',usage:{input:1,output:2,providerCost:0}});
  expect(database.query("SELECT total_tokens,provider_cost_total,cost_provenance FROM token_usage WHERE chat_jid='web:fresh-no-finance'").get()).toEqual({total_tokens:3,provider_cost_total:0,cost_provenance:'provider_reported'});
  initializeDatabaseSchema(database);
  expect(database.query("SELECT name FROM main.sqlite_schema WHERE name GLOB 'budget_*'").all()).toEqual([]);
});

test('historical financial schema and opaque evidence reopen without migration, repair or deletion', () => {
  initDatabase(); const workspace=createTempWorkspace('historical-finance-');
  const path=join(workspace.store,'historical.sqlite');let copy=new Database(path);
  try{
    initializeDatabaseSchema(copy);installHistoricalExpenseFixture(copy);
    copy.exec("INSERT INTO budget_work(id,chat_jid,execution_kind,status,created_at,updated_at) VALUES('old','web:old','interactive','paused','old','old'); INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,state,created_at,updated_at) VALUES('unresolved','old','web:old','fixture','unpriced','opaque','binding','unresolved','old','old');");
    const schema=copy.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all();
    const history=copy.query('SELECT * FROM budget_request_reservations').all();
    const receipts=copy.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,id').all();
    copy.close();copy=new Database(path);
    initializeDatabaseSchema(copy);
    expect(copy.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all()).toEqual(schema);
    expect(copy.query('SELECT * FROM budget_request_reservations').all()).toEqual(history);
    expect(copy.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,id').all()).toEqual(receipts);
    expect(copy.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{copy.close();workspace.cleanup();}
});

test("passive token telemetry ignores historical caps/unknown prices and never settles financial history", () => {
  initDatabase(); const database = getDb();installHistoricalExpenseFixture(database);
  database.query(`INSERT INTO budget_work(id,chat_jid,execution_kind,status,created_at,updated_at)
    VALUES('retired-work','web:retired','interactive','paused','2026-01-01','2026-01-01')`).run();
  database.query(`INSERT INTO budget_caps(id,scope,metric,amount,work_id,created_at,updated_at)
    VALUES('retired-zero','task','api_usd_micros',0,'retired-work','2026-01-01','2026-01-01')`).run();
  database.query(`INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,state,created_at,updated_at)
    VALUES('retired-unresolved','retired-work','web:retired','fixture','unpriced','opaque-original-account',?,'unresolved','2026-01-01','2026-01-01')`).run("a".repeat(64));
  const history = financialSnapshot();
  const schema = database.query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all();
  const message = {id:"new-usage-no-finance",role:"assistant",model:"unpriced",provider:"fixture",timestamp:"2026-11-04T20:00:00Z",
    usage:{input:7,output:3,cacheRead:2,cacheWrite:1,totalTokens:13,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  recordMessageUsage("web:retired",message);
  const row = database.query("SELECT * FROM token_usage WHERE invocation_id=?").get(message.id) as any;
  expect(row).toMatchObject({input_tokens:7,output_tokens:3,cache_read_tokens:2,cache_write_tokens:1,total_tokens:13,work_id:null,
    api_equivalent_cost_known:0,valuation_provenance:"unavailable"});
  recordMessageUsage("web:retired",{...message,usage:{...message.usage,input:999}});
  expect(database.query("SELECT * FROM token_usage WHERE invocation_id=?").get(message.id)).toEqual(row);
  expect(financialSnapshot()).toEqual(history);
  expect(database.query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(schema);
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("Core exposes no expense management or financial execution APIs", () => {
  for (const name of ["ensureBudgetWork","getBudgetWork","saveBudgetCap","getBudgetCap","listBudgetCaps","setBudgetCapEnabled",
    "ensureBudgetCapWindow","persistBudgetDecision","markBudgetDecisionNotified","grantBudgetAllowance","setBudgetWarningsOnly",
    "resumeBudgetWork","setBudgetWorkStatus","insertBudgetUsageEvent"]) expect(dbApi).not.toHaveProperty(name);
  for (const name of ["storeTokenUsage","getTokenUsageTotals","getLatestTokenUsage","getTokenUsageByProvider","getTokenUsageByModel"])
    expect(typeof dbApi[name as keyof typeof dbApi]).toBe("function");
});

test('scheduler polling neither delivers nor acknowledges historical expense-stop notifications',async()=>{
  const {createTask}=await import('../../src/db/tasks.js');
  const {createCurrentPiclawScheduledRunStore}=await import('../../src/service-effects/current-piclaw/scheduled-run-store.js');
  const {pollScheduledRunsOnce}=await import('../../src/task-scheduler.js');
  initDatabase();const database=getDb();installHistoricalExpenseFixture(database);
  database.query("INSERT INTO budget_work(id,chat_jid,execution_kind,status,created_at,updated_at) VALUES ('old-scheduled-expense-stop','web:retired-scheduler','scheduled','stopped','2020-01-01','2020-01-01')").run();
  database.query("INSERT INTO budget_decisions(id,work_id,boundary,decision,blockers_json,notification_key,notification_status,created_at) VALUES ('old-undelivered-decision','old-scheduled-expense-stop','model_call','stop','[]','old-notification','pending','2020-01-01')").run();
  createTask({id:'retirement-poll-candidate',chat_jid:'web:retired-scheduler',prompt:'Fixture must not execute',model:null,task_kind:'shell',command:'exit 0',cwd:null,timeout_sec:null,notify_on_complete:false,schedule_type:'once',schedule_value:'2020-01-01T00:00:00.000Z',next_run:'2020-01-01T00:00:00.000Z',status:'active',created_at:'2020-01-01T00:00:00.000Z'});
  database.exec('PRAGMA foreign_keys=ON');
  const history=financialSnapshot(),built=createCurrentPiclawScheduledRunStore(database,{hitFault(){return false;},recordTrace(){}});if(!built.ok)throw Error(built.error._tag);
  let claimed=0,notices=0,nudges=0;
  const deps={queue:{enqueueTask(){throw Error('No fixture occurrence was claimed');}},agentPool:{isDurableRuntime:()=>true},async sendMessage(){notices++;},async sendNudge(){nudges++;}};
  await pollScheduledRunsOnce(deps as import('../../src/task-scheduler.js').SchedulerDeps,{...built.value,async claimDue(){claimed++;return {ok:true,value:[]};}});
  expect(claimed).toBe(1);expect(notices).toBe(0);expect(nudges).toBe(0);expect(financialSnapshot()).toEqual(history);
  expect(database.query("SELECT notification_status FROM budget_decisions WHERE id='old-undelivered-decision'").get()).toEqual({notification_status:'pending'});
});
