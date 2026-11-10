import {installHistoricalExpenseFixture} from '../../runtime/test/fixtures/historical-expense.js';
import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import { Database } from "bun:sqlite";
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {acquireRuntimeLock} from '../../runtime/src/runtime/single-instance.js';
import { expect, test } from "bun:test";
import { createHostOperationAuthority } from "../../runtime/durable-engine/src/host-operation-authority.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';

async function fixture(financial = false) {
  let root: Database;
  if (financial) { initDatabase();installHistoricalExpenseFixture(getDb()); root = Database.deserialize(getDb().serialize()); await closeDatabase(); }
  else root = new Database(":memory:");
  installTerminalSettlementCompositionSchema(root);
  const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {} }));
  const chatJid = "web:authority";
  const source = value(await work.acceptSource(sealed({ effect: effect("authority:accept"), chatJid,
    sourceId: "authority:source", kind: "message" as const, payloadRef: "authority:payload",
    targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("authority:claim"), chatJid,
    expectedFrontier: 0, newOperationId: "authority:operation", claimedAt: at })))!;
  const inputs = [{ incarnation: "authority:copy", conversationId: 2 as never, chatJid, branchId: "main",
    operationId: claimed.operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId,
    payloadRef: source.payloadRef, requestId: "authority:request", requestHash: "a".repeat(64), submissionId: 42 as never }];
  const before = { operation: claimed.operation, inputs };
  const operation = value(await work.bindHarness(sealed({ effect: effect("authority:bind", claimed.operation.operationId, source.sourceSeq),
    expectedVersion: claimed.operation.version, sessionId: "authority:session", harnessOperationId: "42" })));
  root.exec("CREATE TABLE authority_probe (value TEXT)");
  return { root, before, captured: { operation, inputs } };
}

for (const readonly of [false, true]) test(`captured tool authority ignores financial reporting debt; readonly=${readonly}`, async () => {
  const { root, captured } = await fixture(true);
  let financialChecks = 0;
  const guarded = { ...captured, accountingBarrier: () => { financialChecks++; throw Error("Obsolete expense observer must not run"); } };
  const authority = createHostOperationAuthority(root, guarded, () => {}, readonly);
  try {
    authority.assertCurrent();
    // Historical rows are fixture data, not calls to a retired finance owner.
    root.query("INSERT INTO budget_work(id,chat_jid,execution_kind,created_at,updated_at) VALUES (?,?,'interactive',?,?)").run("historical-request-work",captured.operation.chatJid,at,at);
    const receipt=JSON.stringify({version:1,requestId:"paid-pending",requestBindingSha256:"a".repeat(64),projectedOutcome:{role:"assistant",stopReason:"stop"}});
    root.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at,terminal_receipt_json,terminal_receipt_sha256,terminal_received_at) VALUES (?,?,?,'fixture','fixture','historical-account',?,100,'unresolved',?,?,?,?,?)").run("paid-pending","historical-request-work",captured.operation.chatJid,"a".repeat(64),at,at,receipt,"b".repeat(64),at);
    const financialState = () => ({ request: historicalExpenseRows(root,['budget_request_reservations'])[0],
      work: historicalExpenseRows(root,['budget_work'])[0], reports: root.query("SELECT * FROM token_usage").all() });
    const before = financialState(); financialChecks = 0; let entered = 0;
    expect(() => authority.assertSourceCurrent()).not.toThrow();
    expect(() => authority.assertCurrent()).not.toThrow();
    if (!readonly) expect(await authority.admitWrite(() => { entered++; root.exec("INSERT INTO authority_probe VALUES('independent effect')"); return 7; })).toBe(7);
    else await expect(authority.admitWrite(() => { entered++; })).rejects.toThrow('Read-only host operation authority');
    expect(entered).toBe(readonly ? 0 : 1); expect(financialChecks).toBe(0); expect(financialState()).toEqual(before);
    expect(() => createHostOperationAuthority(root, captured, () => {}, true).assertCurrent()).not.toThrow();
  } finally { root.close(); }
});

for (const readonly of [false, true]) test(`tool authority never reads an obsolete financial observer; readonly=${readonly}`, async () => {
  const { root, captured } = await fixture(); let reads = 0, entered = 0;
  Object.defineProperty(captured, 'accountingBarrier', { get() { reads++; throw Error('obsolete observer unavailable'); } });
  try {
    const authority = createHostOperationAuthority(root, captured, () => {}, readonly);
    const before = root.serialize();
    authority.assertCurrent(); authority.assertSourceCurrent();
    if (!readonly) await authority.admitWrite(() => { entered++; });
    expect(entered).toBe(readonly ? 0 : 1); expect(reads).toBe(0); expect(root.serialize()).toEqual(before);
  } finally { root.close(); }
});

test("host authority requires a bound write harness; pre-ACK readonly checks remain valid without SQL writes", async () => {
  const { root, before } = await fixture();
  try {
    // Roll back the real binding to its committed pre-ACK operation evidence.
    root.query(`UPDATE service_effect_s01_operations SET version=?, harness_operation_id=NULL,
      harness_session_id=NULL WHERE operation_id=?`)
      .run(before.operation.version, before.operation.operationId);
    expect(() => createHostOperationAuthority(root, before, () => {})).toThrow("Bound host harness required for writes");
    const readonly = createHostOperationAuthority(root, before, () => {}, true);
    readonly.assertCurrent();
    let called = false;
    const changes = root.query("SELECT total_changes() AS n").get();
    expect(() => readonly.write(() => { called = true; })).toThrow("Read-only host operation authority");
    expect(called).toBe(false);
    expect(root.query("SELECT total_changes() AS n").get()).toEqual(changes);
  } finally { root.close(); }
});

test("host authority checks exact operation, harness and claimed source evidence", async () => {
  const { root, captured } = await fixture();
  try {
    const authority = createHostOperationAuthority(root, captured, () => {});
    const readonly = createHostOperationAuthority(root, captured, () => {}, true);
    authority.assertCurrent(); readonly.assertCurrent();
    const mutations = [
      "UPDATE service_effect_s01_operations SET version=version+1",
      "UPDATE service_effect_s01_operations SET phase='cancelling'",
      "UPDATE service_effect_s01_operations SET cancellation_source_id='revoked'",
      "UPDATE service_effect_s01_chats SET active_operation_id=NULL",
      "UPDATE service_effect_s01_operations SET harness_operation_id=NULL",
      "UPDATE service_effect_s01_operations SET harness_session_id='other'",
      "UPDATE service_effect_s01_operations SET harness_operation_id='other'",
      "UPDATE service_effect_s01_operations SET harness_session_id=NULL",
      "UPDATE service_effect_s01_sources SET payload_ref='other'",
      "UPDATE service_effect_s01_sources SET source_id='other'",
      "DELETE FROM service_effect_s01_operation_sources",
    ];
    for (const sql of mutations) {
      root.exec("SAVEPOINT mutation");
      try {
        root.exec(sql);
        expect(() => authority.assertSourceCurrent()).toThrow();
        expect(() => readonly.assertSourceCurrent()).toThrow();
        expect(() => authority.assertCurrent()).toThrow(/Stale host (operation|source) authority/);
        expect(() => readonly.assertCurrent()).toThrow(/Stale host (operation|harness|source) authority/);
        let called = false;
        expect(() => authority.write(() => { called = true; })).toThrow(/Stale host/);
        expect(called).toBe(false);
      } finally { root.exec("ROLLBACK TO mutation; RELEASE mutation"); }
    }
  } finally { root.close(); }
});

test('replacement kernel lease revokes captured reads/writes even while immutable binding is unchanged',async()=>{
  const {root,captured}=await fixture(),dir=mkdtempSync(join(process.env.PICLAW_WORKSPACE!,'operation-owner-'));
  const options={lockPath:join(dir,'runtime.lock'),strictOwnership:true,disabled:false};
  const owner=acquireRuntimeLock(options);
  let replacement:ReturnType<typeof acquireRuntimeLock>|undefined;
  try{
    const authority=createHostOperationAuthority(root,captured,()=>owner.assertCurrentOwner());
    const readonly=createHostOperationAuthority(root,captured,()=>owner.assertCurrentOwner(),true);
    authority.assertCurrent();readonly.assertCurrent();
    const before=root.serialize();owner.release();replacement=acquireRuntimeLock(options);
    expect(replacement.record.nonce).not.toBe(owner.record.nonce);
    expect(()=>replacement!.assertCurrentOwner()).not.toThrow();
    expect(()=>authority.assertCurrent()).toThrow();expect(()=>readonly.assertCurrent()).toThrow();
    let called=false;expect(()=>authority.write(()=>{called=true;})).toThrow();expect(called).toBe(false);
    expect(root.serialize()).toEqual(before);
  }finally{replacement?.release();owner.release();root.close();rmSync(dir,{recursive:true,force:true});}
});

test("host writes use root IMMEDIATE transaction and roll back callback work when post-check or callback fails", async () => {
  const { root, captured } = await fixture();
  let allowed = true;
  try {
    const authority = createHostOperationAuthority(root, captured, () => { if (!allowed) throw Error("Owner revoked"); });
    expect(() => authority.write(() => {})).toThrow('Admitted host write transaction required');
    expect(await authority.admitWrite(() => authority.write(() => { expect(root.inTransaction).toBe(true); root.exec("INSERT INTO authority_probe VALUES ('kept')"); return 7; }))).toBe(7);
    await expect(authority.admitWrite(() => {
      root.exec("INSERT INTO authority_probe VALUES ('rollback'); UPDATE service_effect_s01_operations SET version=version+1");
    })).rejects.toThrow("Stale host operation authority");
    authority.assertCurrent();
    await expect(authority.admitWrite(() => { root.exec("INSERT INTO authority_probe VALUES ('owner')"); allowed = false; })).rejects.toThrow("Owner revoked");
    allowed = true;
    await expect(authority.admitWrite(() => { root.exec("INSERT INTO authority_probe VALUES ('throw')"); throw Error("Callback failed"); })).rejects.toThrow("Callback failed");
    expect(root.query("SELECT * FROM authority_probe").all()).toEqual([{ value: "kept" }]);
    allowed = false;
    expect(() => authority.assertCurrent()).toThrow("Owner revoked");
  } finally { root.close(); }
});
