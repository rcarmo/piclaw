import { expect, test } from "bun:test";
import { defaultPolicy, effectivePolicy, emitting, inferenceAllowed, parsePolicy } from "../src/core/config.ts";
import { cacheBuckets, emptyBudget, priceUsage, reserve, settle } from "../src/core/accounting.ts";
import { applyTools, emptyEvidence, enoughEvidence, foldEvidence, pendingDelay, restoreTools } from "../src/core/toolprune/evidence.ts";
import fixtures from "./fixtures/upstream.json";

test("installation defaults off, validates controls and respects ancestor Off", () => {
  const p = defaultPolicy();
  expect(parsePolicy(p)).toEqual(p);
  expect(inferenceAllowed(p)).toBe(false);
  expect(emitting(p)).toBe(false);
  p.enabled = true; p.mode = "active";
  expect(inferenceAllowed(effectivePolicy(p, "off", "active"))).toBe(false);
  expect(effectivePolicy(p, "inherit", "observe").mode).toBe("observe");
  expect(inferenceAllowed(effectivePolicy(p, "inherit", "observe"))).toBe(false);
  p.inferenceInObserve = true;
  expect(inferenceAllowed(effectivePolicy(p, "inherit", "observe"))).toBe(true);
  expect(() => parsePolicy({ ...p, redirects: 0 })).toThrow();
  expect(() => parsePolicy({ ...p, extra: true })).toThrow();
});
test("TTL subsets are partitioned, unknown and known-zero prices stay distinct", () => {
  const writes = cacheBuckets(100, { longer: 20 });
  expect(writes).toEqual({ default: 80, longer: 20 });
  expect(() => cacheBuckets(10, { longer: 20 })).toThrow();
  expect(() => cacheBuckets(10, { default: 5 })).toThrow();
  const usage = { input: 10, output: 5, cacheRead: 40, cacheWrite: writes, reasoning: 3 };
  expect(priceUsage(usage, null)).toBeNull();
  expect(priceUsage(usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: { default: 0, longer: 0 } })).toBe(0);
  expect(priceUsage(usage, { input: 1, output: 2, cacheRead: .1, cacheWrite: { default: 1, longer: 2 } })).toBe(144);
});
test("budget reservations enforce joint call/cost caps and settle once", () => {
  const p = defaultPolicy(), state = emptyBudget();
  p.budget.callsPerSession = 2; p.budget.maxCostPerSession = 1;
  expect(reserve(state, "first", "s", "d", .6, p).accepted).toBe(true);
  expect(reserve(state, "second", "s", "d", .6, p).reason).toBe("cost_budget");
  const row = { id: "first", sessionId: "s", purpose: "proposer", model: { provider: "test", id: "test" }, usage: null, cost: .2, durationMs: 5, status: "complete" as const };
  expect(() => settle(state, { ...row, sessionId: "different-session" })).toThrow();
  expect(state.ledger).toHaveLength(0);
  settle(state, row); settle(state, row);
  expect(state.ledger).toHaveLength(1);
  expect(reserve(state, "second", "s", "d", .6, p).accepted).toBe(true);
  expect(reserve(state, "third", "s", "d", 0, p).reason).toBe("call_budget");
  expect(reserve(state, "other", "t", "d", null, p).reason).toBe("unknown_cost");
});
test("112 pinned pruning evidence boundary fixtures match upstream", () => {
  expect(fixtures.upstream).toBe("81e32e56bb3c4c1b4c9756b429be91e3960116ca");
  for (const c of fixtures.cases) expect(enoughEvidence(c.sessions, c.prompts, c.highRisk, defaultPolicy())).toBe(c.expected);
});
test("live evidence gates zero prompts and Off; Auto waits for quiet or maximum age", () => {
  const p = defaultPolicy();p.enabled = true;p.mode = "active";p.pruning = "auto";
  const tools = [{ name: "rare", description: "Rare", revision: "1", protected: false, highRisk: false, exposed: true }];
  let s = emptyEvidence();
  expect(foldEvidence(s, [], tools, 0, p, 0)).toEqual(s);
  for (let i = 0; i < 5; i++) s = foldEvidence(s, [], tools, 1, p, 100+i);
  expect(s.proposal).toEqual(["rare"]);
  expect(pendingDelay(s, p, 1000, 1000)).toBe(600_000);
  expect(pendingDelay(s, p, 3_601_000, 1000)).toBe(0);
  expect(pendingDelay(s, p, s.pending!.since + 86_400_000, s.pending!.since + 86_400_000)).toBe(0);
  expect(applyTools(s, ["rare"], false)).toEqual(["rare"]);
  expect(restoreTools(s)).toEqual(["rare"]);
  expect(applyTools(s, ["rare"], false)).toEqual([]);
  expect(applyTools(s, ["rare"], true)).toEqual(["rare"]);
  const off = { ...p, pruning: "off" as const };
  expect(foldEvidence(s, [], tools, 1, off, 200)).toEqual(s);
});
