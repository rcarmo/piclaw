import { beforeEach, afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { storeChatMetadata } from "../../src/db/messages.js";
import { ensureChatBranch, archiveChatBranch, permanentDeleteArchivedBranch } from "../../src/db/chat-branches.js";
import { initDatabase, closeDatabase, getDb, initializeDatabaseSchema } from "../../src/db/connection.js";
import { storeTokenUsage, getTokenUsageTotals, pruneOldTokenUsage, type TokenUsageRecord } from "../../src/db/token-usage.js";
import { installHistoricalExpenseFixture } from "../fixtures/historical-expense.js";
import { recordMessageUsage } from "../../src/agent-pool/usage.js";
import {usageReportRecord} from "../../src/db/usage-report-projection.js";
import {createHash} from "node:crypto";
import * as projectionApi from "../../src/db/usage-report-projection.js";
beforeEach(async()=>{await closeDatabase();initDatabase();installHistoricalExpenseFixture(getDb());});
afterEach(()=>closeDatabase());
const binding = { id: "projection-request", workId: "projection-child", chatJid: "web:child", providerId: "fixture", modelId: "fixture-model", accountRef: "synthetic-account", amountMicros: 50 };
const usage = (): TokenUsageRecord => ({ chat_jid: binding.chatJid, run_at: "2026-10-24T12:00:00.000Z", input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 12,
  cost_input: 0.00004, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: 0.00004, model: binding.modelId, provider: binding.providerId,
  api_equivalent_cost_known: true, api_equivalent_cost_microusd: 40, valuation_provenance: "catalogue_estimate" });
const usageReportMigration={owner:"host.usage-reports",id:"event-payload-v1"};
const eventId = `usage:invocation:${binding.id}`;
const historicalFinance=(database=getDb())=>['budget_work','budget_caps','budget_cap_revisions','budget_cap_windows','budget_request_reservations','budget_usage_events'].map(table=>database.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
const historicalReport=():TokenUsageRecord=>({...usage(),work_id:binding.workId,invocation_id:binding.id,usage_event_id:eventId,usage_source:'assistant'});
// Historical fixture data only. No financial validation, repair or runtime decoder.
const historicalEvent=(database:Database,id:string)=>database.query('SELECT * FROM budget_usage_events WHERE usage_event_id=?').get(id) as any;
const payloadData=(event:any)=>event.report_payload_json?JSON.parse(event.report_payload_json):null;
function historicalPayload(record:TokenUsageRecord,origin:object){
  const {provider_cost_currency:_newMetadata,...originalColumns}=usageReportRecord(record);
  const json=JSON.stringify({version:1,origin,execution_kind:record.execution_kind??null,record:originalColumns});
  return{json,hash:createHash('sha256').update(json).digest('hex')};
}
// Fixed synthetic historical rows. These fixtures install no financial admission,
// dispatch, settlement or repair owner, and never derive a charge from live work.
function seedHistoricalWork(){
  const database=getDb();
  database.query("INSERT INTO budget_work(id,chat_jid,execution_kind,parent_work_id,created_at,updated_at) VALUES ('projection-parent','web:parent','interactive',NULL,'2020-01-01','2020-01-01'),('projection-child','web:child','delegate','projection-parent','2020-01-01','2020-01-01')").run();
  database.query("INSERT INTO budget_caps(id,scope,metric,amount,work_id,created_at,updated_at) VALUES ('projection-cap','task','api_usd_micros',60,'projection-parent','2020-01-01','2020-01-01')").run();
  database.query("INSERT INTO budget_cap_revisions(cap_id,revision,scope,metric,amount,enabled,work_id,recorded_at) VALUES ('projection-cap',1,'task','api_usd_micros',60,1,'projection-parent','2020-01-01')").run();
  return database;
}
function seedHistoricalProjection(report=historicalReport()){
  const database=seedHistoricalWork();storeTokenUsage(report,database);
  const id=(database.query('SELECT id FROM token_usage WHERE usage_event_id=?').get(eventId) as {id:number}).id;
  const payload=historicalPayload(report,{kind:'host_request',request_id:binding.id,binding_sha256:'a'.repeat(64),settlement_sha256:'b'.repeat(64)});
  database.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at,settlement_sha256,usage_event_id) VALUES ('projection-request','projection-child','web:child','fixture','fixture-model','synthetic-account',?,50,'settled','2020-01-01','2020-01-01',?,?)").run('a'.repeat(64),'b'.repeat(64),eventId);
  database.query("INSERT INTO budget_usage_events(usage_event_id,token_usage_id,work_id,chat_jid,invocation_id,accounted_at,api_usd_micros,api_usd_known,valuation_provenance,usage_source,report_payload_json,report_payload_sha256) VALUES (?,?, 'projection-child','web:child','projection-request',?,40,1,'catalogue_estimate','assistant',?,?)").run(eventId,id,report.run_at,payload.json,payload.hash);
  return database;
}
function seedHistoricalHold(){
  const database=seedHistoricalWork();
  database.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at) VALUES ('projection-request','projection-child','web:child','fixture','fixture-model','synthetic-account',?,50,'unresolved','2020-01-01','2020-01-01')").run('a'.repeat(64));
  return database;
}
function legacyFixture(database: Database) {
  database.exec("ALTER TABLE budget_usage_events DROP COLUMN report_payload_sha256; ALTER TABLE budget_usage_events DROP COLUMN report_payload_json;");
  database.query("DELETE FROM piclaw_schema_migrations WHERE owner=? AND id=?").run(usageReportMigration.owner, usageReportMigration.id);
}

test("historical usage projection: mutable report numbers cannot change original financial evidence", () => {
  const database=seedHistoricalProjection(),history=historicalFinance();
  database.exec("UPDATE token_usage SET api_equivalent_cost_microusd=0,catalogue_cost_total=0,cost_total=0,total_tokens=0");
  expect(historicalFinance()).toEqual(history);
  expect(payloadData(historicalEvent(database,eventId)!)?.record).toMatchObject({total_tokens:12,api_equivalent_cost_microusd:40});
});
test("historical usage projection: missing report cannot erase original financial evidence", () => {
  const database=seedHistoricalProjection(),history=historicalFinance();
  database.exec("PRAGMA foreign_keys=OFF; DELETE FROM token_usage; PRAGMA foreign_keys=ON");
  expect(historicalFinance()).toEqual(history);
  expect(payloadData(historicalEvent(database,eventId)!)?.record.total_tokens).toBe(12);
  expect(database.query('SELECT * FROM token_usage').all()).toEqual([]);
});
test("passive usage: duplicate event identity neither repairs a changed report nor adopts fresh caller observations", () => {
  const database=seedHistoricalProjection(),event=historicalEvent(database,eventId)!,history=historicalFinance();
  expect(payloadData(event)?.origin.kind).toBe('host_request');
  database.exec("UPDATE token_usage SET input_tokens=999,cost_total=12,api_equivalent_cost_microusd=0,chat_jid='web:moved'");
  const changed=database.query('SELECT * FROM token_usage').all();
  storeTokenUsage({...usage(),chat_jid:'web:parent',work_id:'projection-parent',usage_event_id:eventId,cost_total:99});
  expect(database.query('SELECT * FROM token_usage').all()).toEqual(changed);
  expect(historicalFinance()).toEqual(history);expect(payloadData(event)?.record.input_tokens).toBe(10);
});
test("historical usage projection: reopen retains missing-report uncertainty and exact FK anchor without financial repair", () => {
  const database=seedHistoricalProjection(),history=historicalFinance(),event=historicalEvent(database,eventId)!;
  database.exec("PRAGMA foreign_keys=OFF; DELETE FROM token_usage; PRAGMA foreign_keys=ON");
  const workspace=createTempWorkspace('usage-projection-reopen-'),path=join(workspace.store,'reopen.db');writeFileSync(path,database.serialize());
  const reopened=new Database(path);
  try{
    reopened.exec('PRAGMA foreign_keys=ON');initializeDatabaseSchema(reopened);initializeDatabaseSchema(reopened);
    expect(historicalFinance(reopened)).toEqual(history);expect(historicalEvent(reopened,eventId)).toEqual(event);
    expect(reopened.query('SELECT * FROM token_usage').all()).toEqual([]);
    expect(reopened.query('PRAGMA foreign_key_check').all()).toHaveLength(1);
    expect(payloadData(event)?.record.total_tokens).toBe(12);
  }finally{reopened.close();workspace.cleanup();}
});
test("passive usage: failed report insertion changes neither prior reports nor historical finance", () => {
  const database=seedHistoricalProjection(),history=historicalFinance(),reports=database.query('SELECT * FROM token_usage').all();
  database.exec("CREATE TEMP TRIGGER reject_passive_report BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT,'report fault'); END");
  expect(()=>storeTokenUsage({...usage(),usage_event_id:'new-observation'})).toThrow('report fault');
  expect(database.query('SELECT * FROM token_usage').all()).toEqual(reports);expect(historicalFinance()).toEqual(history);
});
test("historical usage projection: opening old event schema never backfills or reconstructs provider evidence", () => {
  const database=seedHistoricalProjection();legacyFixture(database);
  const before=historicalFinance(),schema=database.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all();
  const markers=database.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,id').all();
  initializeDatabaseSchema(database);
  expect(historicalFinance()).toEqual(before);expect(database.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all()).toEqual(schema);
  expect(database.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,id').all()).toEqual(markers);
  expect(database.query('PRAGMA table_info(budget_usage_events)').all()).not.toContainEqual(expect.objectContaining({name:'report_payload_json'}));
  expect(payloadData(historicalEvent(database,eventId)!)).toBeNull();
  expect(historicalFinance()).toEqual(before);
});
test("historical usage projection: partial financial schema and old receipt drift stay opaque during ordinary startup", () => {
  const database=seedHistoricalProjection();
  database.query("UPDATE piclaw_schema_migrations SET checksum='opaque-historical-checksum' WHERE owner=?").run(usageReportMigration.owner);
  database.exec('DROP TRIGGER budget_usage_events_no_update');
  const history=historicalFinance(),schema=database.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all();
  const markers=database.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,id').all();
  initializeDatabaseSchema(database);
  expect(historicalFinance()).toEqual(history);expect(database.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all()).toEqual(schema);
  expect(database.query('SELECT * FROM piclaw_schema_migrations ORDER BY owner,id').all()).toEqual(markers);
  recordMessageUsage('web:no-financial-repair',{role:'assistant',id:'opaque-ledger-independent-report',usage:{input:1,output:1}});
  expect(getTokenUsageTotals('web:no-financial-repair').total_tokens).toBe(2);expect(historicalFinance()).toEqual(history);
});
test("historical usage projection: unknown holds remain inert and unchanged during report cleanup", () => {
  const database=seedHistoricalHold(),history=historicalFinance();
  storeTokenUsage({...usage(),chat_jid:'web:legacy',usage_event_id:null,input_tokens:0,output_tokens:0,total_tokens:0});
  initializeDatabaseSchema(database);database.exec('DELETE FROM token_usage');
  expect(historicalFinance()).toEqual(history);
  expect(database.query('SELECT state FROM budget_request_reservations').get()).toEqual({state:'unresolved'});
});
test("historical usage projection: malformed old hashes stay opaque without modifying history or reports", () => {
  const database=seedHistoricalProjection(),event=historicalEvent(database,eventId)!;
  database.exec('DROP TRIGGER budget_usage_events_no_update');
  database.query('UPDATE budget_usage_events SET report_payload_sha256=? WHERE usage_event_id=?').run('0'.repeat(64),eventId);
  database.exec('UPDATE token_usage SET input_tokens=123');
  const history=historicalFinance(),reports=database.query('SELECT * FROM token_usage').all();
  expect(projectionApi).not.toHaveProperty('decodeUsageReport');initializeDatabaseSchema(database);
  expect(historicalFinance()).toEqual(history);expect(database.query('SELECT * FROM token_usage').all()).toEqual(reports);
  expect(payloadData(event)?.record.input_tokens).toBe(10);
});
for (const providerCost of [0, 0.2]) test(`canonical usage projection: native provider cost ${providerCost} and catalogue valuation survive fresh callback context`, async () => {
  const database=seedHistoricalProjection(),history=historicalFinance();
  const message={id:'current-passive-provider',role:'assistant',provider:binding.providerId,model:binding.modelId,api:'fixture',stopReason:'stop',timestamp:Date.parse(usage().run_at),content:[],usage:{input:10,output:2,cacheRead:0,cacheWrite:0,totalTokens:12,providerCost,reasoningTokens:1,cacheReadReported:true,cost:{input:0.00004,output:0,cacheRead:0,cacheWrite:0,total:0.00004}}};
  recordMessageUsage(binding.chatJid,message,'compaction');await Bun.sleep(5);recordMessageUsage(binding.chatJid,message,'compaction');
  expect(database.query("SELECT provider_cost_total,catalogue_cost_total,cost_total,cost_provenance,reasoning_tokens,cache_read_reported,usage_source FROM token_usage WHERE invocation_id='current-passive-provider'").get()).toEqual({provider_cost_total:providerCost,catalogue_cost_total:0.00004,cost_total:providerCost,cost_provenance:'provider_reported',reasoning_tokens:1,cache_read_reported:1,usage_source:'compaction'});
  expect(database.query('SELECT count(*) n FROM token_usage').get()).toEqual({n:2});expect(historicalFinance()).toEqual(history);
});

test("passive usage: legacy catalogue fallback is retained without promoting provenance or creating an expense event", () => {
  const database=seedHistoricalProjection(),history=historicalFinance();
  const observation={...usage(),work_id:binding.workId,usage_event_id:'legacy-catalogue-event',api_equivalent_cost_known:null,api_equivalent_cost_microusd:null,valuation_provenance:null,catalogue_cost_total:0.00003,cost_provenance:null};
  storeTokenUsage(observation);storeTokenUsage({...observation,catalogue_cost_total:99});
  expect(database.query("SELECT catalogue_cost_total,cost_provenance,invocation_id FROM token_usage WHERE usage_event_id='legacy-catalogue-event'").get()).toEqual({catalogue_cost_total:0.00003,cost_provenance:null,invocation_id:null});
  expect(historicalEvent(database,'legacy-catalogue-event')).toBeNull();expect(historicalFinance()).toEqual(history);
});
test("passive usage: unavailable pricing remains unknown without denying token observation", () => {
  const database=seedHistoricalProjection(),history=historicalFinance();
  storeTokenUsage({...usage(),work_id:binding.workId,usage_event_id:'unpriced-observation',cost_input:0,cost_total:0,provider_cost_total:null,catalogue_cost_total:null,cost_provenance:'unavailable',api_equivalent_cost_known:false,api_equivalent_cost_microusd:null,valuation_provenance:'unavailable'});
  expect(getTokenUsageTotals(binding.chatJid).unavailable_cost_runs).toBe(1);expect(getTokenUsageTotals(binding.chatJid).total_tokens).toBe(24);expect(getTokenUsageTotals(binding.chatJid).cost_total).toBeNull();expect(database.query('SELECT cost_total FROM token_usage WHERE usage_event_id=?').get(eventId)).toEqual({cost_total:0.00004});expect(historicalFinance()).toEqual(history);
});
test("historical usage projection: duplicate observation performs no repair and the active reconciliation API is absent", () => {
  const database=seedHistoricalProjection(),history=historicalFinance(),reports=database.query('SELECT * FROM token_usage').all();
  database.exec("CREATE TEMP TRIGGER no_report_update BEFORE UPDATE ON token_usage BEGIN SELECT RAISE(ABORT,'redundant report update'); END");
  storeTokenUsage({...usage(),usage_event_id:eventId});
  expect(database.query('SELECT * FROM token_usage').all()).toEqual(reports);expect(historicalFinance()).toEqual(history);
  expect(projectionApi).not.toHaveProperty('reconcileUsageReports');
  const event=historicalEvent(database,eventId)!,record=historicalReport(),encoded=historicalPayload(record,{kind:'recorder_event'});
  expect(payloadData({...event,report_payload_json:encoded.json,report_payload_sha256:encoded.hash})?.origin).toEqual({kind:'recorder_event'});
});
test("canonical usage projection: retention deletes only unlinked legacy reporting", () => {
  const database = seedHistoricalProjection();
  const event = historicalEvent(database, eventId), request = database.query("SELECT * FROM budget_request_reservations WHERE id=?").get(binding.id);
  storeTokenUsage({ ...usage(), usage_event_id: null, invocation_id: null });
  expect(pruneOldTokenUsage(0)).toBe(1);
  expect(historicalEvent(database, eventId)).toEqual(event);
  expect(database.query("SELECT * FROM budget_request_reservations WHERE id=?").get(binding.id)).toEqual(request);
  expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 1 });
  expect(database.query("SELECT state FROM budget_request_reservations").get()).toEqual({state:"settled"});
});
test("historical usage projection: a hold-linked legacy observation cannot be report-pruned", () => {
  const database=seedHistoricalHold(),history=historicalFinance();
  storeTokenUsage({...usage(),work_id:binding.workId,invocation_id:binding.id,usage_event_id:null});
  expect(pruneOldTokenUsage(0)).toBe(0);expect(database.query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});expect(historicalFinance()).toEqual(history);
});
test("historical usage projection: missing old event stays uncertain without fabricating another charge or settlement", () => {
  const database=seedHistoricalProjection();
  database.exec('DROP TRIGGER budget_usage_events_no_delete; DELETE FROM budget_usage_events; DELETE FROM token_usage');
  const history=historicalFinance();initializeDatabaseSchema(database);
  expect(historicalFinance()).toEqual(history);expect(database.query('SELECT state FROM budget_request_reservations').get()).toEqual({state:'settled'});
  expect(database.query('SELECT * FROM budget_usage_events').all()).toEqual([]);expect(database.query('SELECT * FROM token_usage').all()).toEqual([]);
});
test("canonical usage projection: archived purge retains accounting parent and reports actual deletions", () => {
  const database = seedHistoricalProjection();
  const event = historicalEvent(database, eventId), request = database.query("SELECT * FROM budget_request_reservations WHERE id=?").get(binding.id);
  storeChatMetadata("web:parent", usage().run_at); storeChatMetadata(binding.chatJid, usage().run_at);
  const parent = ensureChatBranch({ chat_jid: "web:parent", agent_name: "parent" });
  ensureChatBranch({ chat_jid: binding.chatJid, root_chat_jid: parent.chat_jid, parent_branch_id: parent.branch_id, agent_name: "child" });
  archiveChatBranch(binding.chatJid);
  expect(permanentDeleteArchivedBranch(binding.chatJid).counts.token_usage).toBe(0);
  expect(historicalEvent(database, eventId)).toEqual(event);
  expect(database.query("SELECT * FROM budget_request_reservations WHERE id=?").get(binding.id)).toEqual(request);
  expect(database.query("SELECT id FROM token_usage").get()).toEqual({ id: event!.token_usage_id });
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("canonical usage projection: orphan chat cleanup keeps canonical reporting and removes disposable rows", async () => {
  const database = getDb(), chat = "dream:manual:ghost:0";
  storeChatMetadata(chat, usage().run_at); ensureChatBranch({ chat_jid: chat, agent_name: "ghost" });
  const historical={...usage(),chat_jid:chat,usage_event_id:'ghost-accounted-event'};
  storeTokenUsage(historical);
  const id=(database.query('SELECT id FROM token_usage WHERE usage_event_id=?').get(historical.usage_event_id) as {id:number}).id;
  const payload=historicalPayload(historical,{kind:'recorder_event'});
  database.query("INSERT INTO budget_usage_events(usage_event_id,token_usage_id,work_id,chat_jid,invocation_id,accounted_at,api_usd_micros,api_usd_known,valuation_provenance,usage_source,report_payload_json,report_payload_sha256) VALUES (?, ?,NULL,?,NULL,?,40,1,'catalogue_estimate','assistant',?,?)").run(historical.usage_event_id,id,chat,historical.run_at,payload.json,payload.hash);
  storeTokenUsage({ ...usage(), chat_jid: chat, usage_event_id: null });
  const startup = await import("../../src/runtime/startup.js");
  expect(startup.cleanupOrphanedActiveChatArtifacts()).toBe(1);
  expect(database.query("SELECT * FROM chats WHERE jid=?").get(chat)).toBeNull();
  expect(database.query("SELECT usage_event_id FROM token_usage WHERE chat_jid=?").all(chat)).toEqual([{ usage_event_id: "ghost-accounted-event" }]);
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("canonical usage projection: durable Dream leaves legacy and accounted reporting bytes untouched", async () => {
  const database = getDb(), stale = "dream:manual:stale:0";
  let reports: unknown[] = [];
  const restore = setEnv({ PICLAW_DREAM_MODEL: "", PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1" });
  try {
    storeChatMetadata(stale, usage().run_at); ensureChatBranch({ chat_jid: stale, agent_name: "stale" });
    storeTokenUsage({ ...usage(), chat_jid: stale, usage_event_id: "stale-dream-event" });
    storeTokenUsage({ ...usage(), chat_jid: stale, usage_event_id: null });
    const dream = await import("../../src/dream.js");
    const result = await dream.runDreamAgentTurn({ chatJid: "web:default", mode: "manual", days: 1, agentPool: {
      isDurableRuntime:()=>true,dispatchDreamOperation: async () => {
        const chat='dream:manual:fixture:completed';
        storeTokenUsage({ ...usage(), chat_jid: chat, usage_event_id: "completed-dream-event" });
        storeTokenUsage({ ...usage(), chat_jid: chat, usage_event_id: null });
        reports = database.query("SELECT * FROM token_usage WHERE chat_jid LIKE 'dream:%' ORDER BY id").all();
        return { status: "success", result: "fixture Dream complete" };
      }, disposeChatSession: async () => {},
    } as any });
    expect(result.skipped).toBe(false);
    expect(reports).toHaveLength(4);
    expect(database.query("SELECT * FROM token_usage WHERE chat_jid LIKE 'dream:%' ORDER BY id").all()).toEqual(reports);
    expect(database.query("SELECT jid FROM chats WHERE jid LIKE 'dream:%'").all()).toEqual([{jid:stale}]);
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { restore(); }
});

test("historical usage projection: moved report key cannot duplicate an observation or repair historical ownership", () => {
  const database=seedHistoricalProjection(),history=historicalFinance();
  database.exec('PRAGMA foreign_keys=OFF; UPDATE token_usage SET id=id+100; PRAGMA foreign_keys=ON');
  const reports=database.query('SELECT * FROM token_usage').all();storeTokenUsage({...usage(),usage_event_id:eventId});
  expect(database.query('SELECT * FROM token_usage').all()).toEqual(reports);expect(getTokenUsageTotals(binding.chatJid).total_tokens).toBe(12);expect(historicalFinance()).toEqual(history);
  expect(database.query('PRAGMA foreign_key_check').all()).toHaveLength(1);
});
test("historical usage projection: pre-cutover mapping and hashes cannot be rebound by a fresh provider report", async () => {
  const database=seedHistoricalProjection({...historicalReport(),response_model:binding.modelId,api:'fixture',usage_source:'assistant'});
  initializeDatabaseSchema(database);
  const history=historicalFinance(),reports=database.query('SELECT * FROM token_usage').all(),event=historicalEvent(database,eventId)!;
  storeTokenUsage({...usage(),work_id:binding.workId,invocation_id:binding.id,usage_event_id:eventId,provider_cost_total:0.2,cost_total:0.2,cost_provenance:'provider_reported',response_model:binding.modelId,api:'fixture',usage_source:'assistant'});
  expect(historicalFinance()).toEqual(history);expect(database.query('SELECT * FROM token_usage').all()).toEqual(reports);
  expect(payloadData(event)?.origin.kind).toBe('host_request');
  expect(database.query('SELECT terminal_receipt_json FROM budget_request_reservations').get()).toEqual({terminal_receipt_json:null});
});
