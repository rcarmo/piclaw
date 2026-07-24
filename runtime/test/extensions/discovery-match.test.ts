import { describe, expect, test } from "bun:test";

import {
  addDiscoveryExactPhraseMatches,
  addDiscoveryTokenMatches,
  clampDiscoveryLimit,
  finalizeDiscoveryMatches,
  normalizeDiscoveryText,
  tokenizeDiscoveryText,
  uniqueDiscoveryStrings,
  type DiscoveryMatchAccumulator,
} from "../../src/extensions/discovery-match.js";

describe("discovery-match primitives", () => {
  test("normalizes punctuation, underscores, hyphens, and casing", () => {
    expect(normalizeDiscoveryText("Search_Workspace: SQL/DB + VNC tools!")).toBe("search workspace sql/db + vnc tools");
  });

  test("tokenizes with stop-word filtering and short-token allowlisting", () => {
    expect(tokenizeDiscoveryText("I want to use SQL DB UI and AI tools for x y z search")).toEqual([
      "sql",
      "db",
      "ui",
      "ai",
      "search",
    ]);
  });

  test("deduplicates strings after trimming", () => {
    expect(uniqueDiscoveryStrings([" alpha ", "alpha", "", "beta"])).toEqual(["alpha", "beta"]);
  });

  test("clamps limits to discovery bounds without changing fallback semantics", () => {
    expect(clampDiscoveryLimit(undefined)).toBe(100);
    expect(clampDiscoveryLimit(Number.NaN, 8)).toBe(8);
    expect(clampDiscoveryLimit(0)).toBe(1);
    expect(clampDiscoveryLimit(250)).toBe(200);
    expect(clampDiscoveryLimit(42)).toBe(42);
  });

  test("accumulates token and phrase matches with deduplicated serialized fields", () => {
    const match: DiscoveryMatchAccumulator = { score: 0, matchedTerms: [], matchedSources: [] };
    const tokens = new Set(tokenizeDiscoveryText("generate token usage chart"));

    addDiscoveryTokenMatches(tokens, ["token chart", "token chart"], "jdoc.keywords", 2, match);
    addDiscoveryExactPhraseMatches("generate token usage chart", ["token usage", "usage chart"], "jdoc.domains", 3, match);
    finalizeDiscoveryMatches(match);

    expect(match.score).toBe(10);
    expect(match.matchedTerms).toEqual(["token", "chart", "token usage", "usage chart"]);
    expect(match.matchedSources).toEqual(["jdoc.keywords", "jdoc.domains"]);
  });
});
