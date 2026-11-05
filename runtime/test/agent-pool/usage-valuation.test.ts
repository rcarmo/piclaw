import { describe, expect, test } from "bun:test";
import { valueApiEquivalentCost } from "../../src/agent-pool/usage-valuation.js";
describe("passive usage valuation", () => {
  test("distinguishes unknown zero from documented free valuation", () => {
    const tokens = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 };
    expect(valueApiEquivalentCost({ tokens, costs: { input: 0, output: 0, total: 0 } })).toMatchObject({
      known: false,
      amountMicros: null,
      provenance: "unavailable",
    });
    expect(valueApiEquivalentCost({ tokens, costs: { input: 0, output: 0, total: 0 }, documentedFree: true })).toMatchObject({
      known: true,
      amountMicros: 0,
      provenance: "documented_free",
    });
  });

  test("values categories independently, excludes reasoning, and labels cache fallback", () => {
    expect(valueApiEquivalentCost({
      tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 5, reasoning: 99 },
      costs: { input: 0.001, output: null, cacheRead: null, cacheWrite: null, total: 999 },
      cacheWriteInputFallback: 0.0005,
    })).toMatchObject({
      known: true,
      amountMicros: 1500,
      knownSubtotalMicros: 1500,
      fallbackCategories: ["cacheWrite"],
      unknownCategories: [],
    });
    expect(valueApiEquivalentCost({
      tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
      costs: { input: 0.001, output: null },
    })).toMatchObject({
      known: false,
      amountMicros: null,
      knownSubtotalMicros: 1000,
      unknownCategories: ["output"],
    });
  });
});
