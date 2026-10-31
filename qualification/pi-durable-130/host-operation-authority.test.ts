import './src/test-guard.js';
import { Database } from "bun:sqlite";
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {acquireRuntimeLock} from '../../runtime/src/runtime/single-instance.js';
import { expect, test } from "bun:test";
import { createHostOperationAuthority } from "../../runtime/durable-engine/src/host-operation-authority.js";
import { assertOperationAccountingReady } from '../../runtime/durable-engine/src/host-request-accounting.js';
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { ensureBudgetWork } from '../../runtime/src/db/budget-limits.js';
import { reserveBudgetRequest, dispatchBudgetRequest, recordBudgetTerminalReceipt, getBudgetRequest } from '../../runtime/src/db/budget-request-reservations.js';

async function fixture(financial = false) {
  let root: Database;
  if (financial) { initDatabase(); root = Database.deserialize(getDb().serialize()); closeDatabase(); }
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

for (const readonly of [false, true]) test(`captured tool authority repeats the pending accounting barrier before its effect; readonly=${readonly}`, async () => {
  const { root, captured } = await fixture(true);
  const guarded = { ...captured, accountingBarrier: () => assertOperationAccountingReady(root, captured.operation.operationId) };
  const authority = createHostOperationAuthority(root, guarded, () => {}, readonly);
  try {
    authority.assertCurrent();
    const operationWork = `durable-operation:${captured.operation.operationId}`;
    ensureBudgetWork({ id: operationWork, chatJid: captured.operation.chatJid, executionKind: 'interactive' }, root);
    const binding = { id: 'paid-pending', workId: 'durable-request:paid-pending', chatJid: captured.operation.chatJid, providerId: 'fixture', modelId: 'fixture', accountRef: 'generation', amountMicros: 100 };
    ensureBudgetWork({ id: binding.workId, chatJid: binding.chatJid, executionKind: 'interactive', parentWorkId: operationWork }, root);
    reserveBudgetRequest(binding, {}, root);
    dispatchBudgetRequest(binding, { authorise() {}, signal: new AbortController().signal }, root);
    recordBudgetTerminalReceipt(binding, { version: 1, requestId: binding.id, requestBindingSha256: getBudgetRequest(binding.id, root)!.binding_sha256,
      projectedOutcome: { role: 'assistant', provider: binding.providerId, model: binding.modelId, api: 'openai-completions', stopReason: 'stop', usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0.00003, output: 0.00001, cacheRead: 0, cacheWrite: 0, total: 0.00004 } } } }, at, root);
    const before = root.serialize(); let entered = 0;
    expect(() => authority.assertCurrent()).toThrow('budget_denied');
    if (!readonly) await expect(authority.admitWrite(() => { entered++; root.exec("INSERT INTO authority_probe VALUES('must not write')"); })).rejects.toThrow('budget_denied');
    expect(entered).toBe(0); expect(root.serialize()).toEqual(before);
    // Model/prompt source capture is not a tool grant. It can still reach the
    // exact reservation recovery path rather than being denied prematurely.
    expect(() => createHostOperationAuthority(root, captured, () => {}, true).assertCurrent()).not.toThrow();
  } finally { root.close(); }
});

for (const readonly of [false, true]) for (const invalid of ['value', 'async', 'reject'] as const) test(`captured accounting callback stays synchronous and fail closed; ${invalid}, readonly=${readonly}`, async () => {
  const { root, captured } = await fixture(); let entered = 0;
  try {
    const accountingBarrier = invalid === 'value' ? () => true : invalid === 'async' ? () => Promise.resolve() : () => Promise.reject(Error('synthetic guard rejection'));
    const authority = createHostOperationAuthority(root, { ...captured, accountingBarrier }, () => {}, readonly);
    const before = root.serialize();
    expect(() => authority.assertCurrent()).toThrow('Accounting barrier must be synchronous');
    if (!readonly) await expect(authority.admitWrite(() => { entered++; })).rejects.toThrow('Accounting barrier must be synchronous');
    expect(entered).toBe(0); expect(root.serialize()).toEqual(before); await Promise.resolve();
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
