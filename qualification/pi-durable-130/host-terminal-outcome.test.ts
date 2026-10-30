import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import type { AssistantMessage } from "../../runtime/src/durable-legacy-sdk.js";
import { projectTerminalOutcome } from "../../runtime/durable-engine/src/host-terminal-outcome.js";
import { parseModelFailure } from "../../runtime/durable-engine/src/host-model-failure.js";
import { reserveHostRequest } from "../../runtime/durable-engine/src/host-request-accounting.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getBudgetRequest } from "../../runtime/src/db/budget-request-reservations.js";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "../../runtime/src/durable-legacy-sdk.js";

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
  expect(JSON.stringify(projected)).not.toContain(secret);
  expect(JSON.stringify(projected)).not.toContain("private.invalid");
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
  revokeSource(): void; sourceChecks(): number; terminal: AssistantMessage;
}) => Promise<void>, withOwner = true) {
  const previousMemory = process.env.PICLAW_DB_IN_MEMORY;
  process.env.PICLAW_DB_IN_MEMORY = "1";
  const authPath = join(process.env.PICLAW_WORKSPACE!, `terminal-auth-${crypto.randomUUID()}.json`);
  const caller = new AbortController(), owner = new AbortController();
  let source = true, checks = 0;
  try {
    initDatabase(); const database = getDb();
    writeFileSync(authPath, JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic", refresh: "synthetic", accountId: "terminal-fixture", expires: Date.now() + 60_000 } }), { mode: 0o600 });
    const model: Model<Api> = { provider: "openai-codex", id: physical.id, api: physical.api, name: "synthetic",
      baseUrl: "https://fixture.invalid", input: ["text"], reasoning: true, contextWindow: 1000, maxTokens: 100,
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
    const request = await reserveHostRequest({ database, operationId: "terminal-fixture-operation", chatJid: "web:terminal-fixture", authPath, model,
      signal: caller.signal, assertCurrent() { checks++; caller.signal.throwIfAborted(); if (!source) throw Error("source revoked"); },
      terminalOwner: withOwner ? { signal: owner.signal, assertCurrent() { owner.signal.throwIfAborted(); } } : undefined });
    if (!request) throw Error("synthetic reservation unavailable");
    await request.dispatch();
    const terminal = { ...reportingMessage(), provider: model.provider, responseModel: `${model.provider}/${model.id}` };
    await body({ request, database, caller, owner, terminal, revokeSource() { source = false; }, sourceChecks() { return checks; } });
  } finally {
    owner.abort(); caller.abort(); closeDatabase(); rmSync(authPath, { force: true });
    if (previousMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = previousMemory;
  }
}

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

test("missing retention owner never falls back to request authority", () => reservedTerminal(async f => {
  const before = getBudgetRequest(f.request.id, f.database);
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
