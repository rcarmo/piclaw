import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { isolateBudgetTestDatabase } from "../budget/fixture.js";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { storeChatMetadata } from "../../src/db/messages.js";
import { ensureChatBranch, archiveChatBranch, permanentDeleteArchivedBranch } from "../../src/db/chat-branches.js";
import { getDb } from "../../src/db/connection.js";
import { ensureBudgetWork, saveBudgetCap } from "../../src/db/budget-limits.js";
import { reserveBudgetRequest, dispatchBudgetRequest, settleBudgetRequest, abandonBudgetRequest, getBudgetRequest, recordBudgetTerminalReceipt } from "../../src/db/budget-request-reservations.js";
import { storeTokenUsage, getTokenUsageTotals, pruneOldTokenUsage, type TokenUsageRecord } from "../../src/db/token-usage.js";
import { initializeBudgetLimitsSchema } from "../../src/db/budget-limits-schema.js";
import { modelRequestAccounting } from "../../src/budget/model-request-accounting.js";
import { evaluateBudget } from "../../src/budget/evaluator.js";
import { getBudgetSettingsState } from "../../src/budget/settings.js";
import { decodeUsageReport, readUsageProjectionEvent, reconcileUsageReports, usageReportMigration } from "../../src/db/usage-report-projection.js";
isolateBudgetTestDatabase();
const binding = { id: "projection-request", workId: "projection-child", chatJid: "web:child", providerId: "fixture", modelId: "fixture-model", accountRef: "synthetic-account", amountMicros: 50 };
const usage = (): TokenUsageRecord => ({ chat_jid: binding.chatJid, run_at: "2026-10-24T12:00:00.000Z", input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 12,
  cost_input: 0.00004, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: 0.00004, model: binding.modelId, provider: binding.providerId,
  api_equivalent_cost_known: true, api_equivalent_cost_microusd: 40, valuation_provenance: "catalogue_estimate" });
const eventId = `usage:invocation:${binding.id}`;
function setup(request = binding) {
  const database = getDb();
  ensureBudgetWork({ id: "projection-parent", chatJid: "web:parent", executionKind: "interactive" });
  ensureBudgetWork({ id: request.workId, chatJid: request.chatJid, parentWorkId: "projection-parent", executionKind: "delegate" });
  saveBudgetCap({ id: "projection-cap", scope: "task", metric: "api_usd_micros", amount: 60, workId: "projection-parent" });
  reserveBudgetRequest(request); dispatchBudgetRequest(request, { authorise() {}, signal: new AbortController().signal });
  return database;
}
const budget = () => evaluateBudget({ workId: "projection-parent", pendingRequest: { amountMicros: 30 } });
function legacyFixture(database: Database) {
  database.exec("ALTER TABLE budget_usage_events DROP COLUMN report_payload_sha256; ALTER TABLE budget_usage_events DROP COLUMN report_payload_json;");
  database.query("DELETE FROM piclaw_schema_migrations WHERE owner=? AND id=?").run(usageReportMigration.owner, usageReportMigration.id);
}

test("canonical usage projection: spent ledger survives mutable report numbers", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  database.exec("UPDATE token_usage SET api_equivalent_cost_microusd=0,catalogue_cost_total=0,cost_total=0,total_tokens=0");
  expect((getBudgetSettingsState("web:parent").caps as any[])[0]).toMatchObject({ known_usage: 40, remaining: 20 });
  expect(budget().action).toBe("pause");
  expect(budget().blockers[0]?.knownUsage).toBe(70);
});
test("canonical usage projection: spent ledger survives missing reporting row", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  database.exec("PRAGMA foreign_keys=OFF; DELETE FROM token_usage; PRAGMA foreign_keys=ON;");
  expect(budget().action).toBe("pause");
  expect(budget().blockers[0]?.knownUsage).toBe(70);
});
test("canonical usage projection: replay repairs from stored owner, never caller observations", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  const event = readUsageProjectionEvent(database, eventId)!;
  expect(decodeUsageReport(event)?.origin.kind).toBe("host_request");
  database.exec("UPDATE token_usage SET input_tokens=999,cost_total=12,api_equivalent_cost_microusd=0,chat_jid='web:moved'");
  storeTokenUsage({ ...usage(), chat_jid: "web:parent", work_id: "projection-parent", usage_event_id: eventId, cost_total: 99 });
  expect(database.query("SELECT id,chat_jid,input_tokens,cost_total FROM token_usage").get()).toEqual({ id: event.token_usage_id, chat_jid: "web:moved", input_tokens: 10, cost_total: 0.00004 });
  expect(readUsageProjectionEvent(database, eventId)).toEqual(event);
  expect(() => settleBudgetRequest(binding, { ...usage(), input_tokens: 11 })).toThrow("conflict");
  expect(database.query("SELECT count(*) n FROM budget_usage_events").get()).toEqual({ n: 1 });
});
test("canonical usage projection: lost ACK and disk reopen restore same numeric FK identity once", () => {
  const database = setup();
  expect(() => { settleBudgetRequest(binding, usage()); throw Error("lost settlement ACK"); }).toThrow("lost settlement ACK");
  const event = readUsageProjectionEvent(database, eventId)!;
  database.exec("PRAGMA foreign_keys=OFF; DELETE FROM token_usage; PRAGMA foreign_keys=ON;");
  const workspace = createTempWorkspace("usage-projection-reopen-");
  const path = join(workspace.store, "reopen.db"); writeFileSync(path, database.serialize());
  const reopened = new Database(path);
  try {
    reopened.exec("PRAGMA foreign_keys=ON");
    initializeBudgetLimitsSchema(reopened);
    expect(settleBudgetRequest(binding, usage(), reopened).state).toBe("settled");
    expect(settleBudgetRequest(binding, usage(), reopened).state).toBe("settled");
    expect(reopened.query("SELECT id,usage_event_id,total_tokens FROM token_usage").get()).toEqual({ id: event.token_usage_id, usage_event_id: eventId, total_tokens: 12 });
    expect(reopened.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(readUsageProjectionEvent(reopened, eventId)).toEqual(event);
    expect(reopened.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 1 });
    expect(reopened.query("SELECT count(*) n FROM budget_usage_events").get()).toEqual({ n: 1 });
  } finally { reopened.close(); workspace.cleanup(); }
});
test("canonical usage projection: payload/report/charge/settlement fault is atomic", () => {
  const database = setup();
  database.exec("CREATE TRIGGER reject_usage_event BEFORE INSERT ON budget_usage_events BEGIN SELECT RAISE(ABORT,'event fault'); END");
  expect(() => settleBudgetRequest(binding, usage())).toThrow("event fault");
  expect(getBudgetRequest(binding.id)?.state).toBe("dispatched");
  expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 0 });
  expect(database.query("SELECT count(*) n FROM budget_usage_events").get()).toEqual({ n: 0 });
});
test("canonical usage projection: cutover captures weaker legacy provenance without inventing request IDs", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  storeTokenUsage({ ...usage(), usage_event_id: null, invocation_id: null, cost_provenance: null });
  legacyFixture(database);
  const before = database.query("SELECT * FROM token_usage ORDER BY id").all();
  const reservation = getBudgetRequest(binding.id);
  const markers = database.query("SELECT * FROM piclaw_schema_migrations WHERE owner<>? ORDER BY owner,id").all(usageReportMigration.owner);
  const userVersion = database.query("PRAGMA user_version").get();
  initializeBudgetLimitsSchema(database);
  expect(database.query("SELECT * FROM piclaw_schema_migrations WHERE owner<>? ORDER BY owner,id").all(usageReportMigration.owner)).toEqual(markers);
  expect(database.query("PRAGMA user_version").get()).toEqual(userVersion);
  const event = readUsageProjectionEvent(database, eventId)!;
  expect(decodeUsageReport(event)?.origin.kind).toBe("legacy_projection_capture");
  expect(database.query("SELECT * FROM token_usage ORDER BY id").all()).toEqual(before);
  expect(getBudgetRequest(binding.id)).toEqual(reservation);
  expect(database.query("SELECT count(*) n FROM budget_usage_events").get()).toEqual({ n: 1 });
  database.exec("UPDATE token_usage SET cost_total=33 WHERE usage_event_id IS NOT NULL");
  initializeBudgetLimitsSchema(database);
  expect(readUsageProjectionEvent(database, eventId)).toEqual(event);
  expect(reconcileUsageReports(database)).toEqual({ projected: 1, unavailable: 0, next: null });
  expect(getTokenUsageTotals(binding.chatJid).runs).toBe(2);
  expect(getTokenUsageTotals(binding.chatJid).cost_total).toBeCloseTo(0.00008);
});
test("canonical usage projection: malformed legacy payload stays unavailable after cache correction", () => {
  const database = setup(); settleBudgetRequest(binding, usage()); legacyFixture(database);
  database.exec("UPDATE token_usage SET input_tokens=-1");
  initializeBudgetLimitsSchema(database);
  expect(decodeUsageReport(readUsageProjectionEvent(database, eventId)!)).toBeNull();
  database.exec("UPDATE token_usage SET input_tokens=10"); initializeBudgetLimitsSchema(database);
  expect(reconcileUsageReports(database)).toEqual({ projected: 0, unavailable: 1, next: null });
  expect(budget().blockers[0]?.knownUsage).toBe(70);
});
test("canonical usage projection: migration fault restores trigger, columns, receipt and old evidence", () => {
  const database = setup(); settleBudgetRequest(binding, usage()); legacyFixture(database);
  database.exec("CREATE TRIGGER reject_capture BEFORE UPDATE ON budget_usage_events BEGIN SELECT RAISE(ABORT,'capture fault'); END");
  const before = database.query("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'budget_usage%' ORDER BY name").all();
  expect(() => initializeBudgetLimitsSchema(database)).toThrow("capture fault");
  expect(database.query("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'budget_usage%' ORDER BY name").all()).toEqual(before);
  expect(database.query("SELECT 1 FROM piclaw_schema_migrations WHERE owner=?").get(usageReportMigration.owner)).toBeNull();
  database.exec("DROP TRIGGER reject_capture");
  expect(() => database.exec("UPDATE budget_usage_events SET accounted_at=accounted_at")).toThrow("immutable");
});
test("canonical usage projection: partial columns, receipt drift and temp shadows fail closed", () => {
  const database = setup();
  const receipt = database.query("SELECT checksum FROM piclaw_schema_migrations WHERE owner=?").get(usageReportMigration.owner) as { checksum: string };
  database.query("UPDATE piclaw_schema_migrations SET checksum='wrong' WHERE owner=?").run(usageReportMigration.owner);
  expect(() => initializeBudgetLimitsSchema(database)).toThrow("schema or receipt");
  database.query("UPDATE piclaw_schema_migrations SET checksum=? WHERE owner=?").run(receipt.checksum, usageReportMigration.owner);
  const trigger = database.query("SELECT sql FROM sqlite_schema WHERE name='budget_usage_events_no_update'").get() as { sql: string };
  database.exec("DROP TRIGGER budget_usage_events_no_update");
  expect(() => initializeBudgetLimitsSchema(database)).toThrow("schema or receipt");
  expect(database.query("SELECT 1 FROM sqlite_schema WHERE name='budget_usage_events_no_update'").get()).toBeNull();
  database.exec(trigger.sql);
  database.exec("CREATE TEMP TABLE token_usage(id INTEGER)");
  expect(() => initializeBudgetLimitsSchema(database)).toThrow("schema shadow"); database.exec("DROP TABLE temp.token_usage");
  legacyFixture(database); database.exec("ALTER TABLE budget_usage_events ADD COLUMN report_payload_json TEXT");
  expect(() => initializeBudgetLimitsSchema(database)).toThrow("Unowned usage report schema");
});
test("canonical usage projection: unknown holds survive reporting reconciliation and cleanup", () => {
  const database = setup(); abandonBudgetRequest(binding);
  storeTokenUsage({ ...usage(), chat_jid: "web:legacy", usage_event_id: null, input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  reconcileUsageReports(database); database.exec("DELETE FROM token_usage");
  expect(getBudgetRequest(binding.id)?.state).toBe("unresolved");
  expect(budget().blockers[0]?.reason).toBe("unknown_pricing");
  expect(database.query("SELECT count(*) n FROM budget_usage_events").get()).toEqual({ n: 0 });
});
test("canonical usage projection: malformed canonical evidence rolls back bounded repair", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  const event = readUsageProjectionEvent(database, eventId)!;
  database.exec("DROP TRIGGER budget_usage_events_no_update");
  database.query("UPDATE budget_usage_events SET report_payload_sha256=? WHERE usage_event_id=?").run("0".repeat(64), eventId);
  database.exec("UPDATE token_usage SET input_tokens=123");
  expect(() => reconcileUsageReports(database)).toThrow("payload hash mismatch");
  expect(database.query("SELECT input_tokens FROM token_usage").get()).toEqual({ input_tokens: 123 });
  database.query("UPDATE budget_usage_events SET report_payload_sha256=? WHERE usage_event_id=?").run(event.report_payload_sha256, eventId);
  expect(reconcileUsageReports(database, { limit: 1 }).projected).toBe(1);
  expect(() => reconcileUsageReports(database, { limit: 0 })).toThrow("limit");
});
for (const providerCost of [0, 0.2]) test(`canonical usage projection: native provider cost ${providerCost} and catalogue valuation survive fresh callback context`, async () => {
  const request = { ...binding, workId: `durable-request:${binding.id}` }, database = setup(request);
  const message = { role: "assistant", provider: binding.providerId, model: binding.modelId, api: "fixture", stopReason: "stop", timestamp: 0, content: [],
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, providerCost, reasoningTokens: 1, cacheReadReported: true,
      cost: { input: 0.00004, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00004 } } };
  const accounting = () => modelRequestAccounting({ authorise() {}, documentedFree: false, usageSource: "compaction" });
  recordBudgetTerminalReceipt(request, { version: 1, requestId: request.id,
    requestBindingSha256: getBudgetRequest(request.id)!.binding_sha256,
    projectedOutcome: JSON.parse(JSON.stringify(message)) }, new Date().toISOString());
  const owner = { signal: new AbortController().signal, assertCurrent() { expect(getDb()).toBe(database); } };
  await accounting().settleRetainedRequest(request, owner);
  await Bun.sleep(5);
  await accounting().settleRetainedRequest(request, owner);
  const row = database.query("SELECT provider_cost_total,catalogue_cost_total,cost_total,cost_provenance,reasoning_tokens,cache_read_reported,usage_source FROM token_usage").get();
  expect(row).toEqual({ provider_cost_total: providerCost, catalogue_cost_total: 0.00004, cost_total: providerCost, cost_provenance: "provider_reported", reasoning_tokens: 1, cache_read_reported: 1, usage_source: "compaction" });
  expect(budget().blockers[0]?.knownUsage).toBe(70);
  expect(reconcileUsageReports(database).projected).toBe(1);
  expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 1 });
});

test("canonical usage projection: legacy catalogue fallback is captured without promoting its provenance", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  storeTokenUsage({ ...usage(), work_id: binding.workId, usage_event_id: "legacy-catalogue-event", api_equivalent_cost_known: null, api_equivalent_cost_microusd: null,
    valuation_provenance: null, catalogue_cost_total: 0.00003, cost_provenance: null });
  const event = readUsageProjectionEvent(database, "legacy-catalogue-event")!;
  expect(decodeUsageReport(event)?.origin.kind).toBe("recorder_event");
  database.exec("UPDATE token_usage SET catalogue_cost_total=0,api_equivalent_cost_microusd=0,total_tokens=0 WHERE usage_event_id='legacy-catalogue-event'");
  expect(budget().blockers[0]?.knownUsage).toBe(100);
  reconcileUsageReports(database);
  expect(database.query("SELECT catalogue_cost_total,cost_provenance,invocation_id FROM token_usage WHERE usage_event_id='legacy-catalogue-event'").get())
    .toEqual({ catalogue_cost_total: 0.00003, cost_provenance: null, invocation_id: null });
});
test("canonical usage projection: unavailable pricing remains unknown in reports and budgets", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  storeTokenUsage({ ...usage(), work_id: binding.workId, usage_event_id: "unpriced-recorder-event", cost_input: 0, cost_total: 0, provider_cost_total: null, catalogue_cost_total: null,
    cost_provenance: "unavailable", api_equivalent_cost_known: false, api_equivalent_cost_microusd: null, valuation_provenance: "unavailable" });
  database.exec("UPDATE token_usage SET total_tokens=0,cost_total=99 WHERE usage_event_id='unpriced-recorder-event'");
  expect(budget().blockers[0]?.reason).toBe("unknown_pricing");
  reconcileUsageReports(database);
  expect(getTokenUsageTotals(binding.chatJid).unavailable_cost_runs).toBe(1);
  expect(getTokenUsageTotals(binding.chatJid).total_tokens).toBe(24);
  expect(getTokenUsageTotals(binding.chatJid).cost_total).toBe(0.00004);
});
test("canonical usage projection: bounded pages, no-op replay and multi-event repair rollback", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  storeTokenUsage({ ...usage(), usage_event_id: "another-event" });
  database.exec("CREATE TRIGGER no_duplicate_report_update BEFORE UPDATE ON token_usage BEGIN SELECT RAISE(ABORT,'redundant report update'); END");
  expect(settleBudgetRequest(binding, usage()).state).toBe("settled");
  expect(reconcileUsageReports(database, { limit: 1 })).toEqual({ projected: 1, unavailable: 0, next: "another-event" });
  expect(reconcileUsageReports(database, { limit: 1, after: "another-event" })).toEqual({ projected: 1, unavailable: 0, next: null });
  database.exec("DROP TRIGGER no_duplicate_report_update; DROP TRIGGER budget_usage_events_no_update; UPDATE token_usage SET input_tokens=123");
  database.query("UPDATE budget_usage_events SET report_payload_sha256=? WHERE usage_event_id=?").run("0".repeat(64), eventId);
  expect(() => reconcileUsageReports(database)).toThrow("payload hash mismatch");
  expect(database.query("SELECT DISTINCT input_tokens FROM token_usage").all()).toEqual([{ input_tokens: 123 }]);
});
test("canonical usage projection: retention deletes only unlinked legacy reporting", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  const event = readUsageProjectionEvent(database, eventId), request = getBudgetRequest(binding.id);
  storeTokenUsage({ ...usage(), usage_event_id: null, invocation_id: null });
  expect(pruneOldTokenUsage(0)).toBe(1);
  expect(readUsageProjectionEvent(database, eventId)).toEqual(event);
  expect(getBudgetRequest(binding.id)).toEqual(request);
  expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 1 });
  expect(budget().blockers[0]?.knownUsage).toBe(70);
});
test("canonical usage projection: a reservation-linked legacy observation cannot be report-pruned", () => {
  const database = setup(); abandonBudgetRequest(binding);
  storeTokenUsage({ ...usage(), work_id: binding.workId, invocation_id: binding.id, usage_event_id: null });
  expect(pruneOldTokenUsage(0)).toBe(0);
  expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 1 });
  expect(budget().blockers[0]).toMatchObject({ reason: "unknown_pricing", knownUsage: 80 });
  expect(getBudgetRequest(binding.id)?.state).toBe("unresolved");
});
test("canonical usage projection: missing settled event cannot free its uncertain capacity", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  database.exec("DROP TRIGGER budget_usage_events_no_delete; DELETE FROM budget_usage_events; DELETE FROM token_usage");
  expect(budget().action).toBe("pause");
  expect(budget().blockers[0]?.reason).toBe("unknown_pricing");
  expect(() => settleBudgetRequest(binding, usage())).toThrow("conflict");
  expect(getBudgetRequest(binding.id)?.state).toBe("settled");
});
test("canonical usage projection: archived purge retains accounting parent and reports actual deletions", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  const event = readUsageProjectionEvent(database, eventId), request = getBudgetRequest(binding.id);
  storeChatMetadata("web:parent", usage().run_at); storeChatMetadata(binding.chatJid, usage().run_at);
  const parent = ensureChatBranch({ chat_jid: "web:parent", agent_name: "parent" });
  ensureChatBranch({ chat_jid: binding.chatJid, root_chat_jid: parent.chat_jid, parent_branch_id: parent.branch_id, agent_name: "child" });
  archiveChatBranch(binding.chatJid);
  expect(permanentDeleteArchivedBranch(binding.chatJid).counts.token_usage).toBe(0);
  expect(readUsageProjectionEvent(database, eventId)).toEqual(event);
  expect(getBudgetRequest(binding.id)).toEqual(request);
  expect(database.query("SELECT id FROM token_usage").get()).toEqual({ id: event!.token_usage_id });
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("canonical usage projection: orphan chat cleanup keeps canonical reporting and removes disposable rows", async () => {
  const database = getDb(), chat = "dream:manual:ghost:0";
  storeChatMetadata(chat, usage().run_at); ensureChatBranch({ chat_jid: chat, agent_name: "ghost" });
  storeTokenUsage({ ...usage(), chat_jid: chat, usage_event_id: "ghost-accounted-event" });
  storeTokenUsage({ ...usage(), chat_jid: chat, usage_event_id: null });
  const startup = await import("../../src/runtime/startup.js");
  expect(startup.cleanupOrphanedActiveChatArtifacts()).toBe(1);
  expect(database.query("SELECT * FROM chats WHERE jid=?").get(chat)).toBeNull();
  expect(database.query("SELECT usage_event_id FROM token_usage WHERE chat_jid=?").all(chat)).toEqual([{ usage_event_id: "ghost-accounted-event" }]);
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("canonical usage projection: stale and completed Dream cleanup preserve accounted usage", async () => {
  const database = getDb(), stale = "dream:manual:stale:0";
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
        return { status: "success", result: "fixture Dream complete" };
      }, disposeChatSession: async () => {},
    } as any });
    expect(result.skipped).toBe(false);
    expect(database.query("SELECT usage_event_id FROM token_usage WHERE chat_jid LIKE 'dream:%' ORDER BY usage_event_id").all())
      .toEqual([{ usage_event_id: "completed-dream-event" }, { usage_event_id: "stale-dream-event" }]);
    expect(database.query("SELECT jid FROM chats WHERE jid LIKE 'dream:%'").all()).toEqual([]);
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { restore(); }
});

test("canonical usage projection: moved cache primary key cannot count the same native event twice", () => {
  const database = setup(); settleBudgetRequest(binding, usage());
  database.exec("PRAGMA foreign_keys=OFF; UPDATE token_usage SET id=id+100; PRAGMA foreign_keys=ON");
  expect(budget().blockers[0]?.knownUsage).toBe(70);
  expect(() => reconcileUsageReports(database)).toThrow("UNIQUE");
  expect(database.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 1 });
});
test("canonical usage projection: pre-cutover model settlement replays its original mapping and hash", async () => {
  const database = setup();
  settleBudgetRequest(binding, { ...usage(), response_model: binding.modelId, api: "fixture", usage_source: "assistant" });
  legacyFixture(database); initializeBudgetLimitsSchema(database);
  const event = readUsageProjectionEvent(database, eventId), request = getBudgetRequest(binding.id);
  // The reporting consumer replays stored canonical ownership, ignoring this
  // fresh provider observation. Preserve the old noncanonical work ID and hash.
  storeTokenUsage({ ...usage(), work_id: binding.workId, invocation_id: binding.id, usage_event_id: eventId,
    provider_cost_total: 0.2, cost_total: 0.2, cost_provenance: 'provider_reported',
    response_model: binding.modelId, api: 'fixture', usage_source: 'assistant' });
  expect(getBudgetRequest(binding.id)?.state).toBe("settled");
  expect(getBudgetRequest(binding.id)?.terminal_receipt_json).toBeNull();
  expect(getBudgetRequest(binding.id)).toEqual(request);
  expect(readUsageProjectionEvent(database, eventId)).toEqual(event);
  expect(database.query("SELECT provider_cost_total,cost_provenance,cost_total FROM token_usage").get())
    .toEqual({ provider_cost_total: null, cost_provenance: null, cost_total: 0.00004 });
});
