import { repoRoot } from "./src/repo-root.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostRegretsAccountedDecision } from "../../runtime/durable-engine/src/host-regrets-model.ts";
test("accounted adapter refuses absent stored identity without dispatching a model", async () => {
  initDatabase();
  const dir = mkdtempSync(join(tmpdir(), "regrets-account-")), root = getDb();
  const authPath = join(dir, "auth.json"); writeFileSync(authPath, "{}");
  let requests = 0;
  const model = { provider: "fixture", id: "fixture", maxTokens: 1024 } as any;
  try {
    const port = createHostRegretsAccountedDecision({ database: root, operationId: "fixture", chatJid: "fixture", authPath,
      signal: new AbortController().signal, assertCurrent() {}, getAvailable: () => [model],
      async request() { requests++; throw Error("No real model permitted"); } });
    expect(port.getAvailable()).toEqual([model]);
    await expect(port.complete(model, { messages: [] }, {})).rejects.toThrow("cannot be accounted");
    expect(requests).toBe(0);
  } finally { closeDatabase(); rmSync(dir, { recursive: true }); }
});

import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { BACKGROUND_CONTEXT } from "../../runtime/durable-engine/qualification/context.ts";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.ts";
async function fixture() {
  initDatabase();
  const root = getDb();

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
  const operation = value(await work.bindHarness(sealed({ effect: effect("authority:bind", claimed.operation.operationId, source.sourceSeq), expectedVersion: claimed.operation.version, sessionId: "authority:session", harnessOperationId: "42" })));
  root.exec("CREATE TABLE authority_probe (value TEXT)");
  return { root, before, captured: { operation, inputs } };
}

const addon = await import(repoRoot("ADDONS") + "/addons/late-night-regrets/native.ts");
import { createBoundHostRegretsTool } from "../../runtime/durable-engine/src/host-regrets-tool.ts";
import { createHostRegretsBindings } from "../../runtime/durable-engine/src/host-regrets-bindings.ts";
import { initializeBudgetLimitsSchema } from "../../runtime/src/db/budget-limits-schema.ts";
import { createHostOperationAuthority } from "../../runtime/durable-engine/src/host-operation-authority.ts";


for (const outcome of ["success", "error", "cancel", "revoke"] as const) {
  test(`Regrets owned ledger captured authority: ${outcome}`, async () => {
    const { root, captured } = await fixture();
    initializeBudgetLimitsSchema(root);
    const dir = mkdtempSync(join(tmpdir(), "regrets-ledger-"));
    const authPath = join(dir, "auth.json");
    writeFileSync(authPath, JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic", refresh: "synthetic", accountId: "regrets-fixture", expires: Date.now()+60000 } }));
    const controller = new AbortController(), databaseLifetime = new AbortController(); let owned = true, calls = 0;
    const authority = createHostOperationAuthority(root, captured as any, () => { if (!owned) throw Error("revoked"); });
    const model = { provider: "openai-codex", id: "synthetic", api: "openai-codex-responses", maxTokens: 100, contextWindow: 1000,
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } } as any;
    const message = { role: "assistant", content: [{ type: "text", text: '{"decisions":[{"rowid":1,"choice":"review"}]}' }], provider: model.provider, model: model.id, api: model.api,
      stopReason: "stop", timestamp: 1, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
        cost: { input: 0.00001, output: 0.000005, cacheRead: 0, cacheWrite: 0, total: 0.000015 } } } as any;
    try {
      // The host tool wrapper obtains exactly this snapshot via captureToolSource;
      // no nested operation/source or execution ledger is created by this port.
      const sources = root.query("SELECT * FROM service_effect_s01_sources").all();
      const operations = root.query("SELECT * FROM service_effect_s01_operations").all();
      const port = createHostRegretsAccountedDecision({ database: root, operationId: captured.operation.operationId,
        chatJid: captured.operation.chatJid, authPath, signal: controller.signal, assertCurrent: authority.assertCurrent,
        terminalOwner: { signal: databaseLifetime.signal, assertCurrent() { if (getDb() !== root) throw Error('Fixture database owner changed'); } },
        getAvailable: () => [model], async request(_model, _context, _options, dispatch) {
          expect(root.query("SELECT state FROM budget_request_reservations").get()).toEqual({ state: "reserved" });
          await dispatch(); calls++;
          expect(root.query("SELECT state FROM budget_request_reservations").get()).toEqual({ state: "dispatched" });
          if (outcome === "error") throw Error("synthetic provider error");
          if (outcome === "cancel") controller.abort();
          if (outcome === "revoke") owned = false;
          return message;
        } });
      const bindings = { historyDatabase: root, cwd: "/fixture", accessMode: () => "single-user", allowAllChats: () => false,
        async readFile() { return undefined; }, async admitConversationInput() { throw Error("Tool must not admit input"); } };
      const nativeApi = addon.createLateNightRegrets(createHostRegretsBindings({ ...bindings, root, chat: captured.operation.chatJid,
        assertCurrent: authority.assertCurrent, transactionalWrite: authority.admitWrite, readExchanges: addon.readExchanges, accountedDecision: port }));
      await nativeApi.setConfig({ enabled: true, review_scope: "current", decision_model: "openai-codex/synthetic" });
      root.query("INSERT INTO chats(jid) VALUES(?)").run(captured.operation.chatJid);
      root.query("INSERT INTO messages(id,chat_jid,sender,sender_name,content,timestamp,is_bot_message) VALUES('regrets-human',?,'human','Human','Please be concise',?,0)").run(captured.operation.chatJid,new Date(Date.now()-1000).toISOString());
      let captures = 0;
      const tool = createBoundHostRegretsTool(addon, { root, definition: nativeApi.tool as any, bindings,
        runtime: () => ({ async captureToolSource(conversation, task, call) { captures++; expect([conversation,task,call]).toEqual([2,3,"call"]); return captured as any; } }),
        assertOwner() { if (!owned) throw Error("revoked"); }, accountedDecision(operation, actualAuthority) {
          expect(operation).toEqual(captured); actualAuthority.assertCurrent(); return port;
        } });
      const request = tool.execute({}, { callId: "call", conversationId: 2, taskId: 3, output() {}, async details() {} } as any, BACKGROUND_CONTEXT);
      if (outcome === "revoke") await expect(request).rejects.toThrow();
      else {
        const result = await request;
        expect(JSON.stringify(result.output)).toContain(outcome === "success" ? "complete" : "unavailable");
      }
      expect(calls).toBe(1); expect(captures).toBe(1);
      const row = root.query("SELECT state,work_id FROM budget_request_reservations").get() as any;
      expect(row.state).toBe(outcome === "error" ? "unresolved" : "settled");
      const receipt = root.query('SELECT terminal_receipt_json FROM budget_request_reservations').get() as { terminal_receipt_json: string | null };
      if (outcome === 'error') expect(receipt.terminal_receipt_json).toBeNull();
      else expect(JSON.parse(receipt.terminal_receipt_json!).projectedOutcome.usage).toEqual(message.usage);
      expect(root.query("SELECT parent_work_id FROM budget_work WHERE id=?").get(row.work_id)).toEqual({ parent_work_id: `durable-operation:${captured.operation.operationId}` });
      const usage = root.query("SELECT * FROM token_usage").all() as any[];
      expect(usage.length).toBe(outcome === "error" ? 0 : 1);
      if (usage.length) { expect(usage[0].work_id).toBe(row.work_id); expect(usage[0].api_equivalent_cost_microusd).toBe(15); }
      expect(root.query("SELECT * FROM service_effect_s01_sources").all()).toEqual(sources);
      expect(root.query("SELECT * FROM service_effect_s01_operations").all()).toEqual(operations);
    } finally { databaseLifetime.abort(); closeDatabase(); rmSync(dir, { recursive: true }); }
  });
}

for (const recovered of [false, true]) test(`Regrets transport checks late source authority before send; exact recovery=${recovered}`, async () => {
  const { root, captured } = await fixture();
  const dir = mkdtempSync(join(tmpdir(), 'regrets-boundary-')), authPath = join(dir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'synthetic', refresh: 'synthetic', accountId: 'boundary-fixture', expires: Date.now()+60000 } }));
  const signal = new AbortController().signal; let current = true, calls = 0, auths = 0;
  const model = { provider: 'openai-codex', id: 'local', api: 'openai-completions', maxTokens: 100, contextWindow: 1000,
    cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } as any;
  const message = { role: 'assistant', content: [{ type: 'text', text: 'synthetic paid decision' }], provider: model.provider, model: model.id, api: model.api,
    stopReason: 'stop', timestamp: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0.000001, output: 0.000001, cacheRead: 0, cacheWrite: 0, total: 0.000002 } } } as any;
  const source = createHostOperationAuthority(root, captured as any, () => { if (!current) throw Error('source revoked'); });
  try {
    const port = createHostRegretsAccountedDecision({ database: root, operationId: captured.operation.operationId, chatJid: captured.operation.chatJid,
      authPath, signal, assertCurrent: source.assertSourceCurrent, getAvailable: () => [model],
      // Identity DATA only; the actual SDK tool/controller provenance is tested in the factory.
      modelInvocation: { version: 1, domain: 'unit-only', operationId: captured.operation.operationId, conversationId: 2, taskId: 3,
        taskKind: 'pi.tool', phase: 'call', checkpointHash: 'a'.repeat(64) },
      terminalOwner: { signal, assertCurrent() { if (getDb() !== root) throw Error('database changed'); } },
      async request(_model, _context, _options, dispatch) {
        auths++; expect(root.query('SELECT state FROM budget_request_reservations').get()).toEqual({ state: 'reserved' });
        await Bun.sleep(0); if (!recovered) current = false;
        await dispatch(); calls++; return message;
      } });
    if (!recovered) {
      await expect(port.complete(model, { messages: [] }, {})).rejects.toThrow('source revoked');
      expect(calls).toBe(0); expect(root.query('SELECT state FROM budget_request_reservations').get()).toEqual({ state: 'released' });
      expect(root.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
    } else {
      expect(await port.complete(model, { messages: [] }, {})).toEqual(message);
      const facts = root.query('SELECT * FROM budget_request_reservations').all();
      expect(await port.complete(model, { messages: [] }, {})).toEqual(message);
      expect(auths).toBe(1); expect(calls).toBe(1); expect(root.query('SELECT * FROM budget_request_reservations').all()).toEqual(facts);
      expect(root.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
      current = false; await expect(port.complete(model, { messages: [] }, {})).rejects.toThrow('source revoked');
      expect(auths).toBe(1); expect(calls).toBe(1);
    }
  } finally { closeDatabase(); rmSync(dir, { recursive: true }); }
});

import { reserveHostRequest } from "../../runtime/durable-engine/src/host-request-accounting.ts";
test("same host ledger refunds only undispatched reservation, not an uncertain provider error", async () => {
  const { root, captured } = await fixture();
  const dir = mkdtempSync(join(tmpdir(), "regrets-refund-")), authPath = join(dir, "auth.json");
  writeFileSync(authPath, JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic", refresh: "synthetic", accountId: "refund-fixture", expires: Date.now()+60000 } }));
  try {
    const authority = createHostOperationAuthority(root, captured as any, () => {});
    const model = { provider: "openai-codex", id: "synthetic", maxTokens: 100, contextWindow: 1000, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } } as any;
    const reservation = await reserveHostRequest({ database: root, operationId: captured.operation.operationId, chatJid: captured.operation.chatJid,
      authPath, model, signal: new AbortController().signal, assertCurrent: authority.assertCurrent,
      terminalOwner: { signal: new AbortController().signal, assertCurrent() { if (getDb() !== root) throw Error('Fixture database owner changed'); } } });
    expect(root.query("SELECT state FROM budget_request_reservations").get()).toEqual({ state: "reserved" });
    root.exec("CREATE TRIGGER unsent_work_fault BEFORE UPDATE ON budget_work WHEN NEW.status='stopped' BEGIN SELECT RAISE(ABORT,'unsent work fault'); END");
    await expect(reservation!.abandon()).rejects.toThrow('unsent work fault');
    expect(root.query("SELECT state FROM budget_request_reservations").get()).toEqual({ state: "reserved" });
    root.exec('DROP TRIGGER unsent_work_fault');
    await reservation!.abandon();
    const stopped = root.query("SELECT * FROM budget_work WHERE id LIKE 'durable-request:%'").get();
    expect(stopped).toMatchObject({ status: 'stopped' });
    await Bun.sleep(2); await reservation!.abandon();
    expect(root.query("SELECT * FROM budget_work WHERE id LIKE 'durable-request:%'").get()).toEqual(stopped);
    expect(root.query("SELECT state FROM budget_request_reservations").get()).toEqual({ state: "released" });
    expect(root.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 0 });
  } finally { closeDatabase(); rmSync(dir, { recursive: true }); }
});
