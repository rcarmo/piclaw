import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import type { AssistantMessage } from "../../runtime/src/durable-legacy-sdk.js";
import { projectTerminalOutcome, decodeStoredTerminalOutcome } from "../../runtime/durable-engine/src/host-terminal-outcome.js";
import { parseModelFailure } from "../../runtime/durable-engine/src/host-model-failure.js";
import { reserveHostRequest, assertOperationAccountingReady } from "../../runtime/durable-engine/src/host-request-accounting.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getBudgetRequest, type BudgetModelInvocation } from "../../runtime/src/db/budget-request-reservations.js";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "../../runtime/src/durable-legacy-sdk.js";
import { Database } from 'bun:sqlite';
import { createTempWorkspace, setEnv } from '../../runtime/test/helpers.js';
import { resolveRuntimeConfigPaths } from '../../runtime/src/core/config-paths.js';

const physical = { provider: "fixture", id: "physical-model", api: "openai-responses" };
const secret = "SYNTHETIC-PRIVATE-CREDENTIAL";
function message(): AssistantMessage {
  return {
    role: "assistant", provider: physical.provider, model: physical.id, api: physical.api,
    stopReason: "toolUse", timestamp: 123456, durationMs: 32, endTurn: false,
    responseId: "response-1", responseModel: "fixture/physical-model",
    thinkingLevel: "high", providerThinkingLevel: "provider-effort",
    content: [
      { type: "text", text: "final text", textSignature: '{"v":1,"id":"sig","phase":"final_answer"}' },
      { type: "thinking", thinking: "", thinkingSignature: "opaque-redacted", redacted: true },
      { type: "thinking", thinking: "visible thinking", thinkingSignature: "opaque-thinking", redacted: false },
      { type: "toolCall", id: "call-1", name: "tool", arguments: { nested: [null, true, 2, { value: "argument" }] },
        thoughtSignature: "opaque-tool", namespace: "tools", argumentsError: "invalid original arguments" },
    ],
    usage: { input: 11, output: 7, cacheRead: 3, cacheWrite: 5, cacheWrite1h: 2, reasoning: 4, totalTokens: 26,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 } },
  };
}
function reportingMessage() {
  const original = message();
  Object.assign(original.usage, { providerCost: 0.25, provider_cost: 0.5, reasoningTokens: 3, reasoning_tokens: 2,
    cacheReadReported: false, cacheWriteReported: true });
  return original;
}
function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, enumerable: true, writable: true });
}
function expectFrozen(value: unknown): void {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) expectFrozen(child);
  }
}

test("projects exact SDK content, continuity fields and all allowlisted reporting facts", () => {
  const original = reportingMessage();
  const projected = projectTerminalOutcome(original, physical);
  expect(isDeepStrictEqual(projected, original)).toBe(true);
  expect(Object.is(projected, original)).toBe(false);
  expect(Object.is(projected.content, original.content)).toBe(false);
  expect(Object.is(projected.usage, original.usage)).toBe(false);
  expect(Object.is(projected.usage.cost, original.usage.cost)).toBe(false);
  expectFrozen(projected);
  expect(JSON.parse(JSON.stringify(projected))).toEqual(original);
});

test("mutation after capture cannot change frozen evidence, including nested tool arguments", () => {
  const original = reportingMessage(), projected = projectTerminalOutcome(original, physical);
  const evidence = JSON.stringify(projected);
  original.model = "mutated";
  original.content.push({ type: "text", text: "later" });
  original.usage.input = 999;
  original.usage.cost.total = 999;
  const tool = original.content[3];
  if (tool.type !== "toolCall") throw Error("fixture");
  tool.arguments.nested = ["later"];
  tool.thoughtSignature = "later";
  expect(JSON.stringify(projected)).toBe(evidence);
  expect(Reflect.set(projected.usage.cost, "total", 999)).toBe(false);
  expect(Reflect.set(projected.content[3], "name", "later")).toBe(false);
  expect(JSON.stringify(projected)).toBe(evidence);
});

test("unknown credentials, headers, diagnostics and provider data are excluded at every allowlist boundary", () => {
  const original = reportingMessage();
  for (const target of [original, original.usage, original.usage.cost, ...original.content]) {
    Object.assign(target, { apiKey: secret, headers: { authorization: secret }, providerData: { token: secret } });
  }
  Object.assign(original, { rawStopReason: secret, diagnostics: [{ message: secret }], errorMessage: secret });
  // Excluded unknown values must not be traversed, cloned or serialized.
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  Object.assign(original, { privateCycle: cycle, privateHandle: new Proxy({}, { get() { throw Error("must not read"); } }) });
  const projected = projectTerminalOutcome(original, physical);
  expect(projected).toEqual(projectTerminalOutcome(reportingMessage(), physical));
  expect(JSON.stringify(projected)).not.toContain(secret);
});

for (const stopReason of ["stop", "length", "toolUse"] as const) test(`preserves successful ${stopReason} without normalizing content or usage`, () => {
  const original = message(); original.stopReason = stopReason;
  expect(isDeepStrictEqual(projectTerminalOutcome(original, physical), original)).toBe(true);
});

for (const [diagnostic, category, httpStatus] of [
  ["HTTP 401 invalid api key", "authentication", 401],
  ["HTTP 429 rate limit", "rate_limit", 429],
  ["HTTP 429 insufficient_quota billing", "quota", 429],
  ["HTTP 504 timeout", "timeout", 504],
  ["ECONNRESET", "transport", undefined],
  ["HTTP 503 unavailable", "unavailable", 503],
  ["maximum context length exceeded", "context_limit", undefined],
  ["unrecognized", "unknown", undefined],
  ["timeout " + "x".repeat(8193), "unknown", undefined],
] as const) test(`error projection is bounded ${category}, not raw diagnostics or private partial output`, () => {
  const original = reportingMessage(); original.stopReason = "error";
  original.errorMessage = `${diagnostic} Authorization: Bearer ${secret} https://private.invalid`;
  original.content = [{ type: "text", text: secret }, { type: "thinking", thinking: secret, thinkingSignature: secret }];
  const projected = projectTerminalOutcome(original, physical);
  expect(projected.stopReason).toBe("error");
  expect(projected.content).toEqual([]);
  expect(projected.usage).toEqual(original.usage);
  expect(projected.timestamp).toBe(original.timestamp);
  expect(projected.durationMs).toBe(original.durationMs);
  expect(parseModelFailure(projected.errorMessage)).toEqual({ phase: "provider", category,
    ...(httpStatus === undefined ? {} : { httpStatus }) });
  expect(projected.errorMessage!.length).toBeLessThan(256);
  expect(isDeepStrictEqual(decodeStoredTerminalOutcome(JSON.stringify(projected), physical), projected)).toBe(true);
  expect(JSON.stringify(projected)).not.toContain(secret);
  expect(JSON.stringify(projected)).not.toContain("private.invalid");
});

test("stored outcome recovery must preserve its original bounded provider classification", () => {
  const original = message(); original.stopReason = "error"; original.errorMessage = "ECONNRESET synthetic provider interruption";
  const first = projectTerminalOutcome(original, physical);
  const recovered = decodeStoredTerminalOutcome(JSON.stringify(first), physical);
  expect(recovered.errorMessage).toBe(first.errorMessage);
  expect(parseModelFailure(recovered.errorMessage)).toEqual({ phase: "provider", category: "transport" });
  expect(recovered.usage).toEqual(first.usage);
});

test("stored success decoder preserves the exact projected outcome without granting execution", () => {
  const projected = projectTerminalOutcome(reportingMessage(), physical);
  const decoded = decodeStoredTerminalOutcome(JSON.stringify(projected), physical);
  expect(isDeepStrictEqual(decoded, projected)).toBe(true); expectFrozen(decoded);
  expect(Object.is(decoded, projected)).toBe(false);
  expect(() => decodeStoredTerminalOutcome(JSON.stringify(projected), { ...physical, id: "other" })).toThrow();
});

test("stored decoder rejects raw errors and unknown fields instead of projecting them away", () => {
  const raw = reportingMessage(); raw.stopReason = "error"; raw.errorMessage = secret;
  expect(() => decodeStoredTerminalOutcome(JSON.stringify(raw), physical)).toThrow();
  const success = projectTerminalOutcome(reportingMessage(), physical);
  for (const location of ["message", "usage", "cost", "content"] as const) {
    const value = JSON.parse(JSON.stringify(success));
    const target = location === "message" ? value : location === "usage" ? value.usage : location === "cost" ? value.usage.cost : value.content[0];
    target.unqualifiedPrivateField = secret;
    expect(() => decodeStoredTerminalOutcome(JSON.stringify(value), physical)).toThrow();
  }
  for (const invalid of ["not json", "null", "[]", "{}"])
    expect(() => decodeStoredTerminalOutcome(invalid, physical)).toThrow();
});

test("aborted retains its original stop reason and usage without retaining abort reasons or partial tools", () => {
  const original = reportingMessage(); original.stopReason = "aborted"; original.errorMessage = secret;
  original.content = [{ type: "toolCall", id: secret, name: secret, arguments: { secret } }];
  const projected = projectTerminalOutcome(original, physical);
  expect(projected.stopReason).toBe("aborted");
  expect(projected.content).toEqual([]);
  expect(projected.usage).toEqual(original.usage);
  expect(parseModelFailure(projected.errorMessage)).toEqual({ phase: "provider", category: "aborted" });
  expect(JSON.stringify(projected)).not.toContain(secret);
});

test("rejects wrong physical provider, model, API, response model and role", () => {
  for (const key of ["provider", "model", "api", "responseModel", "role"]) {
    const original = message(); define(original, key, "wrong");
    expect(() => projectTerminalOutcome(original, physical)).toThrow("Invalid terminal model outcome");
  }
  for (const key of ["provider", "id", "api"]) {
    expect(() => projectTerminalOutcome(message(), { ...physical, [key]: "wrong" })).toThrow();
  }
  for (const responseModel of [undefined, physical.id, `${physical.provider}/${physical.id}`]) {
    const original = message(); original.responseModel = responseModel;
    expect(projectTerminalOutcome(original, physical).responseModel).toBe(responseModel);
  }
});

for (const stopReason of ["pending", "deferred"] as const) test(`rejects nonterminal ${stopReason}`, () => {
  const original = message(); original.stopReason = stopReason;
  expect(() => projectTerminalOutcome(original, physical)).toThrow();
});
test("rejects deferred/private handles even on an otherwise final success or failure", () => {
  for (const stopReason of ["stop", "error", "aborted"] as const) {
    const original = message(); original.stopReason = stopReason;
    original.deferred = { provider: physical.provider, modelId: physical.id, api: physical.api, id: secret, data: { credential: secret } };
    expect(() => projectTerminalOutcome(original, physical)).toThrow();
  }
});

test("zero remains zero, unknown reporting stays absent, and no cost or usage is synthesized", () => {
  const original = message();
  original.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const projected = projectTerminalOutcome(original, physical);
  expect(projected.usage).toEqual(original.usage);
  for (const key of ["reasoning", "cacheWrite1h", "providerCost", "provider_cost", "reasoningTokens", "reasoning_tokens", "cacheReadReported", "cacheWriteReported"]) {
    expect(Object.hasOwn(projected.usage, key)).toBe(false);
  }
  define(original.usage, "providerCost", 0); define(original.usage, "reasoning", 0); define(original.usage, "cacheReadReported", false);
  expect(projectTerminalOutcome(original, physical).usage).toEqual(original.usage);
  for (const key of ["usage", "cost", "totalTokens", "total"]) {
    const incomplete = message();
    const target = key === "usage" ? incomplete : key === "total" ? incomplete.usage.cost : incomplete.usage;
    Reflect.deleteProperty(target, key);
    expect(() => projectTerminalOutcome(incomplete, physical)).toThrow();
  }
});

test("negative finite telemetry is retained as fact, never clamped or promoted to billing validity", () => {
  const original = reportingMessage();
  for (const key of Object.keys(original.usage)) if (key !== "cost" && !key.endsWith("Reported")) define(original.usage, key, -0.5);
  for (const key of Object.keys(original.usage.cost)) define(original.usage.cost, key, -0.25);
  expect(projectTerminalOutcome(original, physical).usage).toEqual(original.usage);
});

for (const value of [NaN, Infinity, -Infinity, undefined, null, "1", 1n, () => 1]) test(`rejects invalid retained numeric telemetry (${typeof value}, ${String(value)})`, () => {
  for (const location of ["input", "cost", "providerCost", "timestamp", "argument"]) {
    const original = message();
    if (location === "input") define(original.usage, "input", value);
    else if (location === "cost") define(original.usage.cost, "total", value);
    else if (location === "providerCost") { if (value === undefined) continue; define(original.usage, "providerCost", value); }
    else if (location === "timestamp") define(original, "timestamp", value);
    else {
      if (value === null || typeof value === "string") continue; // These ARE legitimate JSON arguments.
      original.content = [{ type: "toolCall", id: "call", name: "tool", arguments: {} }];
      define(original.content[0], "arguments", { value });
    }
    expect(() => projectTerminalOutcome(original, physical)).toThrow();
  }
});

test("cycles, lossy JSON, exotic objects and deep tool arguments reject before serialization", () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let deep: object = {}; for (let i = 0; i < 66; i++) deep = { deep };
  const sparse = Array(2); sparse[1] = "value";
  const symbol = { [Symbol("private")]: 1 };
  const hidden = Object.defineProperty({}, "hidden", { value: 1 });
  for (const value of [cyclic, deep, sparse, symbol, hidden, new Date(), new Map(), { toJSON() { throw Error("must not run"); } }]) {
    const original = message();
    original.content = [{ type: "toolCall", id: "call", name: "tool", arguments: {} }];
    define(original.content[0], "arguments", { value });
    expect(() => projectTerminalOutcome(original, physical)).toThrow();
  }
});

async function reservedTerminal(body: (fixture: {
  request: NonNullable<Awaited<ReturnType<typeof reserveHostRequest>>>;
  database: ReturnType<typeof getDb>; caller: AbortController; owner: AbortController;
  revokeSource(): void; sourceChecks(): number; terminal: AssistantMessage; model: Model<Api>; authPath: string;
  prepareAgain(changes?: Partial<Parameters<typeof reserveHostRequest>[0]>): ReturnType<typeof reserveHostRequest>;
}) => Promise<void>, withOwner = true, file = false, settings: { modelInvocation?: BudgetModelInvocation; dispatch?: boolean } = {}) {
  const workspace = createTempWorkspace('host-terminal-integration-');
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  const previousMemory = process.env.PICLAW_DB_IN_MEMORY;
  process.env.PICLAW_DB_IN_MEMORY = "1";
  const authPath = join(process.env.PICLAW_WORKSPACE!, `terminal-auth-${crypto.randomUUID()}.json`);
  const caller = new AbortController(), owner = new AbortController();
  let source = true, checks = 0;
  try {
    const paths = resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_DB_IN_MEMORY: file ? '0' : '1' } });
    initDatabase(paths); const database = getDb();
    if (file) {
      expect(database.query("SELECT file FROM pragma_database_list WHERE name='main'").get()).toEqual({ file: paths.databasePath });
      expect(database.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    }
    writeFileSync(authPath, JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic", refresh: "synthetic", accountId: "terminal-fixture", expires: Date.now() + 60_000 } }), { mode: 0o600 });
    const model: Model<Api> = { provider: "openai-codex", id: physical.id, api: physical.api, name: "synthetic",
      baseUrl: "https://fixture.invalid", input: ["text"], reasoning: true, contextWindow: 1000, maxTokens: 100,
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
    const options: Parameters<typeof reserveHostRequest>[0] = { database, operationId: "terminal-fixture-operation", chatJid: "web:terminal-fixture", authPath, model,
      modelInvocation: settings.modelInvocation,
      signal: caller.signal, assertCurrent() { checks++; caller.signal.throwIfAborted(); if (!source) throw Error("source revoked"); },
      terminalOwner: withOwner ? { signal: owner.signal, assertCurrent() { owner.signal.throwIfAborted(); } } : undefined };
    const request = await reserveHostRequest(options);
    if (!request) throw Error("synthetic reservation unavailable");
    if (withOwner && settings.dispatch !== false) await request.dispatch();
    const terminal = { ...reportingMessage(), provider: model.provider, responseModel: `${model.provider}/${model.id}` };
    await body({ request, database, caller, owner, terminal, model, authPath,
      prepareAgain(changes = {}) {
        const signal = changes.signal ?? new AbortController().signal;
        return reserveHostRequest({ ...options, signal,
          assertCurrent() { checks++; signal.throwIfAborted(); if (!source) throw Error('source revoked'); }, ...changes });
      },
      revokeSource() { source = false; }, sourceChecks() { return checks; } });
  } finally {
    owner.abort(); caller.abort(); closeDatabase(); rmSync(authPath, { force: true });
    if (previousMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = previousMemory;
    restore(); workspace.cleanup();
  }
}

const invocation = (): BudgetModelInvocation => ({ version: 1, domain: 'owned-recovery-contract', operationId: 'terminal-fixture-operation',
  conversationId: 1, taskId: 2, taskKind: 'pi.generation', phase: 'request', checkpointHash: 'a'.repeat(64) });

test('native logical invocation reuses an exact retained terminal and charge identity without a new reservation', () => reservedTerminal(async f => {
  const receipt = await f.request.retainTerminal(f.terminal);
  const works = f.database.query('SELECT id FROM budget_work ORDER BY id').all(); f.caller.abort();
  const recovered = await f.prepareAgain();
  expect(recovered?.id).toBe(f.request.id); expect(recovered?.recoveredTerminal).toEqual(JSON.parse(receipt.bodyJson).projectedOutcome);
  expect(f.database.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
  expect(f.database.query('SELECT id FROM budget_work ORDER BY id').all()).toEqual(works);
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
  await expect(recovered!.dispatch()).rejects.toThrow('invalid_state');
  const row = getBudgetRequest(f.request.id, f.database); await f.prepareAgain();
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(row);
  expect(f.database.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
}, true, false, { modelInvocation: invocation() }));

test('native stored outcome preserves old price, receipt time and original bounded provider classification', () => reservedTerminal(async f => {
  f.terminal.stopReason = 'error'; f.terminal.errorMessage = 'ECONNRESET ' + secret;
  await f.request.settle(f.terminal);
  const before = getBudgetRequest(f.request.id, f.database), charges = f.database.query('SELECT * FROM budget_usage_events').all();
  const recovered = await f.prepareAgain({ model: { ...f.model, maxTokens: 200, cost: { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 } } });
  expect(recovered?.id).toBe(f.request.id); expect(parseModelFailure(recovered?.recoveredTerminal?.errorMessage)).toEqual({ phase: 'provider', category: 'transport' });
  expect(JSON.stringify(recovered?.recoveredTerminal)).not.toContain(secret);
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before); expect(f.database.query('SELECT * FROM budget_usage_events').all()).toEqual(charges);
}, true, false, { modelInvocation: invocation() }));

for (const changed of ['account', 'source', 'owner', 'caller'] as const) test(`native recovered terminal keeps its request-scoped authority after preparation; changed=${changed}`, () => reservedTerminal(async f => {
  await f.request.settle(f.terminal);
  const caller = new AbortController(), recovered = await f.prepareAgain({ signal: caller.signal });
  expect(recovered?.recoveredTerminal).toBeDefined(); expect(() => recovered!.assertRecoveredCurrent()).not.toThrow();
  const before = getBudgetRequest(f.request.id, f.database), charges = f.database.query('SELECT * FROM budget_usage_events').all();
  if (changed === 'account') writeFileSync(f.authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'synthetic', refresh: 'synthetic', accountId: 'switched-after-prepare', expires: Date.now() + 60000 } }));
  if (changed === 'source') f.revokeSource();
  if (changed === 'owner') f.owner.abort();
  if (changed === 'caller') caller.abort();
  expect(() => recovered!.assertRecoveredCurrent()).toThrow();
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before); expect(f.database.query('SELECT * FROM budget_usage_events').all()).toEqual(charges);
}, true, false, { modelInvocation: invocation() }));

for (const mode of ['priced', 'unpriced', 'no-account'] as const) test(`native next invocation cannot bypass a pending paid terminal via ${mode} admission`, () => reservedTerminal(async f => {
  await f.request.retainTerminal(f.terminal);
  const before = getBudgetRequest(f.request.id, f.database), works = f.database.query('SELECT * FROM budget_work ORDER BY id').all();
  if (mode === 'no-account') writeFileSync(f.authPath, '{}');
  const changed = { ...invocation(), checkpointHash: 'b'.repeat(64) };
  await expect(f.prepareAgain({ modelInvocation: changed, ...(mode === 'unpriced' ? { model: { ...f.model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } } : {}) })).rejects.toThrow('budget_denied');
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before); expect(f.database.query('SELECT * FROM budget_work ORDER BY id').all()).toEqual(works);
  expect(f.database.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
}, true, false, { modelInvocation: invocation() }));

test('native hard first-receipt failure cannot disappear behind an unresolved receipt-less hold', () => reservedTerminal(async f => {
  f.database.exec("CREATE TRIGGER reject_receipt BEFORE UPDATE OF terminal_receipt_json ON budget_request_reservations WHEN NEW.terminal_receipt_json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'receipt write failed'); END");
  await expect(f.request.retainTerminal(f.terminal)).rejects.toThrow('receipt write failed');
  await f.request.abandon();
  const held = getBudgetRequest(f.request.id, f.database);
  expect(held?.state).toBe('unresolved'); expect(held?.terminal_receipt_json).toBeNull();
  expect(() => assertOperationAccountingReady(f.database, invocation().operationId)).toThrow('budget_denied');
  expect(() => assertOperationAccountingReady(f.database, invocation().operationId, true)).toThrow('budget_denied');
  await expect(f.prepareAgain({ modelInvocation: { ...invocation(), checkpointHash: 'b'.repeat(64) } })).rejects.toThrow('budget_denied');
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(held);
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
}, true, false, { modelInvocation: invocation() }));

test('native exact sibling receipts can reconcile without granting another send or deadlocking each other', () => reservedTerminal(async f => {
  const secondScope = { ...invocation(), checkpointHash: 'b'.repeat(64) };
  const second = (await f.prepareAgain({ modelInvocation: secondScope }))!; await second.dispatch();
  await f.request.retainTerminal(f.terminal); await second.retainTerminal(f.terminal);
  expect(() => assertOperationAccountingReady(f.database, invocation().operationId)).toThrow('budget_denied');
  const firstRecovered = (await f.prepareAgain())!;
  expect(firstRecovered.id).toBe(f.request.id); expect(firstRecovered.recoveredTerminal).toBeDefined();
  expect(() => firstRecovered.assertRecoveredCurrent()).not.toThrow();
  expect(() => assertOperationAccountingReady(f.database, invocation().operationId)).toThrow('budget_denied');
  const secondRecovered = (await f.prepareAgain({ modelInvocation: secondScope }))!;
  expect(secondRecovered.id).toBe(second.id); expect(secondRecovered.recoveredTerminal).toBeDefined();
  expect(() => assertOperationAccountingReady(f.database, invocation().operationId)).not.toThrow();
  expect(f.database.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 2 });
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 2 });
  await expect(firstRecovered.dispatch()).rejects.toThrow('invalid_state'); await expect(secondRecovered.dispatch()).rejects.toThrow('invalid_state');
}, true, false, { modelInvocation: invocation() }));

test('native definitely-unsent logical invocation reuses its exact reserved binding and dispatches once', () => reservedTerminal(async f => {
  const before = getBudgetRequest(f.request.id, f.database), recovered = await f.prepareAgain();
  expect(recovered?.id).toBe(f.request.id); expect(recovered?.recoveredTerminal).toBeUndefined();
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before);
  await recovered!.dispatch(); expect(getBudgetRequest(f.request.id, f.database)?.state).toBe('dispatched');
  await expect(f.request.dispatch()).rejects.toThrow('invalid_state');
  expect(f.database.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
}, true, false, { modelInvocation: invocation(), dispatch: false }));

for (const released of [false, true]) test(`native consumed or unknown logical invocation cannot create another paid send; released=${released}`, () => reservedTerminal(async f => {
  if (released) await f.request.abandon();
  const before = getBudgetRequest(f.request.id, f.database), works = f.database.query('SELECT * FROM budget_work ORDER BY id').all();
  await expect(f.prepareAgain()).rejects.toThrow('budget_denied');
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before); expect(f.database.query('SELECT * FROM budget_work ORDER BY id').all()).toEqual(works);
  expect(f.database.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
}, true, false, { modelInvocation: invocation(), dispatch: !released }));

for (const account of ['changed', 'removed']) test(`native existing invocation never falls through to a fresh or unaccounted send when account is ${account}`, () => reservedTerminal(async f => {
  await f.request.retainTerminal(f.terminal); const before = getBudgetRequest(f.request.id, f.database);
  writeFileSync(f.authPath, JSON.stringify(account === 'removed' ? {} : { 'openai-codex': { type: 'oauth', access: 'synthetic', refresh: 'synthetic', accountId: 'changed-fixture', expires: Date.now() + 60000 } }));
  await expect(f.prepareAgain()).rejects.toThrow('conflict'); expect(getBudgetRequest(f.request.id, f.database)).toEqual(before);
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(f.database.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
}, true, false, { modelInvocation: invocation() }));

test('native legacy hold without exact attempt attribution is preserved and blocks a recovery resend', () => reservedTerminal(async f => {
  await f.request.abandon(); const before = getBudgetRequest(f.request.id, f.database);
  await expect(f.prepareAgain({ modelInvocation: invocation() })).rejects.toThrow('budget_denied');
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before);
  expect(f.database.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
}));

test("actual native settlement retains safe evidence after caller/source cancellation and charges/completes once", () => reservedTerminal(async f => {
  const checks = f.sourceChecks(); f.caller.abort(); f.revokeSource();
  Object.assign(f.terminal, { apiKey: secret, headers: { authorization: secret } });
  await f.request.settle(f.terminal);
  const row = getBudgetRequest(f.request.id, f.database)!;
  expect(row.state).toBe('settled'); expect(row.terminal_receipt_json).not.toBeNull();
  expect(row.terminal_receipt_json).not.toContain(secret);
  expect(JSON.parse(row.terminal_receipt_json!).projectedOutcome.usage).toEqual(f.terminal.usage);
  expect(f.sourceChecks()).toBe(checks);
  const work = f.database.query('SELECT * FROM budget_work WHERE id=?').get(row.work_id);
  expect(work).toMatchObject({ status: 'completed', closed_at: row.terminal_received_at });
  await Bun.sleep(2); await f.request.settle(f.terminal); await f.request.abandon();
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(row);
  expect(f.database.query('SELECT * FROM budget_work WHERE id=?').get(row.work_id)).toEqual(work);
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
  expect(f.database.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
}));

test("native status-write fault rolls charge back, preserves prior receipt and exact recovery does not reset completion", () => reservedTerminal(async f => {
  f.database.exec("CREATE TRIGGER native_work_fault BEFORE UPDATE ON budget_work WHEN NEW.id LIKE 'durable-request:%' AND NEW.status='completed' BEGIN SELECT RAISE(ABORT,'native work fault'); END");
  await expect(f.request.settle(f.terminal)).rejects.toThrow('native work fault');
  const held = getBudgetRequest(f.request.id, f.database)!;
  expect(held.state).toBe('dispatched'); expect(held.terminal_receipt_json).not.toBeNull();
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(f.database.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
  await f.request.abandon();
  const marked = getBudgetRequest(f.request.id, f.database)!;
  expect(marked).toEqual({ ...held, state: 'unresolved', updated_at: marked.updated_at });
  await f.request.abandon(); expect(getBudgetRequest(f.request.id, f.database)).toEqual(marked);
  f.database.exec('DROP TRIGGER native_work_fault');
  await f.request.settle(f.terminal);
  const recovered = getBudgetRequest(f.request.id, f.database)!;
  expect(recovered.state).toBe('settled');
  expect(recovered.terminal_receipt_json).toBe(held.terminal_receipt_json);
  expect(recovered.terminal_receipt_sha256).toBe(held.terminal_receipt_sha256);
  expect(recovered.terminal_received_at).toBe(held.terminal_received_at);
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
}));

test("native unknown valuation preserves original safe receipt and hold without a charge", () => reservedTerminal(async f => {
  f.terminal.usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  await expect(f.request.settle(f.terminal)).rejects.toThrow('settlement unresolved');
  const row = getBudgetRequest(f.request.id, f.database)!;
  expect(row.state).toBe('unresolved'); expect(row.terminal_receipt_json).not.toBeNull();
  expect(JSON.parse(row.terminal_receipt_json!).projectedOutcome.usage).toEqual(f.terminal.usage);
  await f.request.abandon(); expect(getBudgetRequest(f.request.id, f.database)).toEqual(row);
  expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(f.database.query('SELECT status FROM budget_work WHERE id=?').get(row.work_id)).toEqual({ status: 'active' });
}));

test("native settlement survives an actual writer beyond five seconds with responsive event loop and exact original evidence", () => reservedTerminal(async f => {
  const path = (f.database.query("SELECT file FROM pragma_database_list WHERE name='main'").get() as { file: string }).file;
  const writer = new Database(path), started = performance.now(); let ticks = 0;
  writer.exec('BEGIN IMMEDIATE');
  const pulse = setInterval(() => { ticks++; }, 10);
  const release = setTimeout(() => writer.exec('COMMIT'), 5200);
  const deadline = setTimeout(() => f.owner.abort(Error('owned native settlement deadline')), 10000);
  const original = JSON.stringify(f.terminal), pending = f.request.settle(f.terminal);
  // The financial producer must detach its payload before the first wait.
  f.terminal.content.length = 0; f.terminal.usage.input = 999;
  try {
    await pending;
    expect(performance.now() - started).toBeGreaterThanOrEqual(5000); expect(ticks).toBeGreaterThan(20);
    const row = getBudgetRequest(f.request.id, f.database)!;
    expect(row.state).toBe('settled'); expect(row.terminal_receipt_json).not.toBeNull();
    const preserved = JSON.parse(row.terminal_receipt_json!).projectedOutcome;
    expect(preserved.content).toEqual(JSON.parse(original).content); expect(preserved.usage).toEqual(JSON.parse(original).usage);
    expect(f.database.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
    expect(f.database.query('SELECT status,closed_at FROM budget_work WHERE id=?').get(row.work_id)).toEqual({ status: 'completed', closed_at: row.terminal_received_at });
  } finally {
    clearInterval(pulse); clearTimeout(release); clearTimeout(deadline);
    if (writer.inTransaction) writer.exec('ROLLBACK');
    await Promise.allSettled([pending]); writer.close();
  }
}, true, true), 15000);

test("actual reserved request retains safe paid facts after caller cancellation without a new dispatch or charge", () => reservedTerminal(async f => {
  const checks = f.sourceChecks(); f.caller.abort(); f.revokeSource();
  Object.assign(f.terminal, { apiKey: secret, headers: { authorization: secret } });
  const receipt = await f.request.retainTerminal(f.terminal);
  const row = getBudgetRequest(f.request.id, f.database)!;
  expect(row.state).toBe("dispatched");
  expect(row.terminal_receipt_json).toBe(receipt.bodyJson);
  expect(f.sourceChecks()).toBe(checks);
  expect(JSON.stringify(JSON.parse(receipt.bodyJson).projectedOutcome)).not.toContain(secret);
  expect(JSON.parse(receipt.bodyJson).projectedOutcome.usage).toEqual(f.terminal.usage);
  await Bun.sleep(2);
  expect(await f.request.retainTerminal(f.terminal)).toEqual(receipt);
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(row);
  expect(f.database.query("SELECT count(*) n FROM token_usage").get()).toEqual({ n: 0 });
  expect(f.database.query("SELECT status FROM budget_work WHERE id=?").get(row.work_id)).toEqual({ status: "active" });
}));

test("retention owner revocation blocks even a stored paid-fact readback without rewriting it", () => reservedTerminal(async f => {
  await f.request.retainTerminal(f.terminal);
  const before = getBudgetRequest(f.request.id, f.database);
  const denied = Error("database owner ended"); f.owner.abort(denied);
  await expect(f.request.retainTerminal(f.terminal)).rejects.toBe(denied);
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before);
}));

test("wrong physical outcome cannot populate an actual request receipt", () => reservedTerminal(async f => {
  const before = getBudgetRequest(f.request.id, f.database);
  await expect(f.request.retainTerminal({ ...f.terminal, model: "wrong" })).rejects.toThrow("Invalid terminal");
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before);
}));

test("missing retention owner never falls back to request authority or dispatches paid work", () => reservedTerminal(async f => {
  const before = getBudgetRequest(f.request.id, f.database);
  await expect(f.request.dispatch()).rejects.toThrow("Terminal receipt owner unavailable");
  await expect(f.request.retainTerminal(f.terminal)).rejects.toThrow("Terminal receipt owner unavailable");
  expect(getBudgetRequest(f.request.id, f.database)).toEqual(before);
}, false));

test("getters and proxies cannot execute at input, usage, cost, content, array or argument boundaries", () => {
  let executed = 0;
  const hostile = () => { executed++; throw Error("must not execute"); };
  for (const mode of ["getter", "proxy"] as const) {
    for (const location of ["message", "usage", "cost", "content", "array", "arguments", "expected"]) {
      const original = message(); let input = original; let expected = { ...physical };
      const getter = Object.defineProperty({}, "credential", { enumerable: true, get: hostile });
      const poisoned = <T extends object>(target: T): T => mode === "getter" ? Object.defineProperty(target, "credential", { enumerable: true, get: hostile })
        : new Proxy(target, { get: hostile, ownKeys: hostile, getPrototypeOf: hostile, getOwnPropertyDescriptor: hostile });
      if (location === "message") input = poisoned(original);
      else if (location === "usage") define(original, "usage", poisoned(original.usage));
      else if (location === "cost") define(original.usage, "cost", poisoned(original.usage.cost));
      else if (location === "content") original.content[0] = poisoned(original.content[0]);
      else if (location === "array") define(original, "content", mode === "getter" ? Object.defineProperty([], "0", { enumerable: true, get: hostile }) : poisoned(original.content));
      else if (location === "arguments") {
        original.content = [{ type: "toolCall", id: "call", name: "tool", arguments: {} }];
        define(original.content[0], "arguments", { nested: mode === "getter" ? getter : poisoned({}) });
      } else expected = poisoned(expected);
      expect(() => projectTerminalOutcome(input, expected)).toThrow();
      expect(executed).toBe(0);
    }
  }
});
