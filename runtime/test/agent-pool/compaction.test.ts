import { beforeEach, expect, test } from "bun:test";

import "../helpers.js";
import {
  computeAutoCompactionTokenStatus,
  estimateContextTokensFromSession,
  finalizeRecoveryCompactionOutcome,
  getAutoCompactionTokenStatusForSession,
  maybeAutoCompactSessionBeforePrompt,
  noteCompactionFailure,
  noteCompactionSuccess,
  runCompactionWithTimeout,
  scheduleIdleAutoCompaction,
} from "../../src/agent-pool/compaction.js";
import { getChatAutoCompactionWindow, getChatCompactionBackoff, initDatabase, setChatCompactionBackoff } from "../../src/db.js";
import { recordCompactionCancellationReason } from "../../src/agent-pool/compaction-cancel-reason.js";
import { getActivePiclawCompactionTrigger } from "../../src/agent-pool/compaction-trigger-context.js";
import { getSessionActivitySnapshot } from "../../src/extensions/session-status.js";

beforeEach(() => {
  initDatabase();
});

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeSession(messages: any[], usageTokens?: number): any {
  return {
    getContextUsage: usageTokens === undefined ? undefined : () => ({ tokens: usageTokens }),
    sessionManager: {
      buildSessionContext: () => ({ messages }),
    },
  };
}

test("1.05M context models do not compact at 181k but do compact near the 80% threshold", () => {
  const session = (usageTokens: number) => ({
    getContextUsage: () => ({ tokens: usageTokens }),
    model: { provider: "github-copilot", id: "gpt-5.6-sol", contextWindow: 1_050_000 },
    sessionManager: {
      getLeafId: () => `leaf-${usageTokens}`,
      getEntries: () => [{ id: `entry-${usageTokens}` }],
      buildSessionContext: () => ({ messages: [{ role: "user", content: "small prompt" }] }),
    },
  });

  const low = getAutoCompactionTokenStatusForSession(session(181_080) as any, "web:1m-low")!;
  expect(low.contextTokens).toBe(199_188);
  expect(low.tokenStatus.autoCompactionScopeLimit).toBe(836_800);
  expect(low.tokenStatus.tokenLimitReached).toBe(false);

  const threshold = getAutoCompactionTokenStatusForSession(session(760_727) as any, "web:1m-threshold")!;
  expect(threshold.contextTokens).toBeGreaterThanOrEqual(836_800);
  expect(threshold.tokenStatus.autoCompactionScopeLimit).toBe(836_800);
  expect(threshold.tokenStatus.tokenLimitReached).toBe(true);
});

test("computeAutoCompactionTokenStatus supports body-after-prefix growth plus hard ceiling", () => {
  const scoped = computeAutoCompactionTokenStatus({
    activeContextTokens: 70_000,
    contextWindow: 100_000,
    thresholdPercent: 75,
    hardCeilingPercent: 95,
    overheadTokens: 5_000,
    scope: "body_after_prefix",
    window: { ordinal: 3, baselineTokens: 50_000, prefillTokens: 50_000 },
  });

  expect(scoped.autoCompactionScopeTokens).toBe(20_000);
  expect(scoped.autoCompactionScopeLimit).toBe(71_250);
  expect(scoped.tokenLimitReached).toBe(false);
  expect(scoped.windowOrdinal).toBe(3);

  const hardCeiling = computeAutoCompactionTokenStatus({
    activeContextTokens: 96_000,
    contextWindow: 100_000,
    thresholdPercent: 75,
    hardCeilingPercent: 95,
    overheadTokens: 5_000,
    scope: "body_after_prefix",
    window: { ordinal: 3, baselineTokens: 50_000, prefillTokens: 50_000 },
  });

  expect(hardCeiling.autoCompactionScopeTokens).toBe(46_000);
  expect(hardCeiling.fullContextWindowLimitReached).toBe(true);
  expect(hardCeiling.tokenLimitReached).toBe(true);
});

test("computeAutoCompactionTokenStatus scales proportionally for huge-context models by default", () => {
  const status = computeAutoCompactionTokenStatus({
    activeContextTokens: 750_000,
    contextWindow: 1_000_000,
    thresholdPercent: 75,
    hardCeilingPercent: 95,
    overheadTokens: 4_000,
    scope: "total",
  });

  expect(status.autoCompactionScopeLimit).toBe(747_000);
  expect(status.fullContextWindowLimit).toBe(946_200);
  expect(status.tokenLimitReached).toBe(true);
});

test("computeAutoCompactionTokenStatus honors an explicitly configured absolute cap", () => {
  const status = computeAutoCompactionTokenStatus({
    activeContextTokens: 250_000,
    contextWindow: 1_000_000,
    thresholdPercent: 75,
    hardCeilingPercent: 95,
    overheadTokens: 4_000,
    maxThresholdTokens: 240_000,
    scope: "total",
  });

  expect(status.autoCompactionScopeLimit).toBe(240_000);
  expect(status.fullContextWindowLimit).toBe(946_200);
  expect(status.tokenLimitReached).toBe(true);
});

test("shared session token status supports mid-turn scoped checks and hard ceiling", () => {
  const previousScope = process.env.PICLAW_AUTO_COMPACTION_SCOPE;
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  const previousHardCeiling = process.env.PICLAW_COMPACTION_HARD_CEILING_PERCENT;
  process.env.PICLAW_AUTO_COMPACTION_SCOPE = "body_after_prefix";
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "75";
  process.env.PICLAW_COMPACTION_HARD_CEILING_PERCENT = "95";
  try {
    const chatJid = "web:midturn-scoped";
    let usageTokens = 50_000;
    let leafId = "leaf-1";
    const session = {
      ...makeSession([{ role: "user", content: [{ type: "text", text: "x" }] }], usageTokens),
      getContextUsage: () => ({ tokens: usageTokens }),
      sessionManager: {
        getLeafId: () => leafId,
        getEntries: () => [leafId],
        buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
      },
      model: { provider: "test", id: "midturn", contextWindow: 100_000 },
    };
    getAutoCompactionTokenStatusForSession(session as any, chatJid);

    usageTokens = 70_000;
    leafId = "leaf-2";
    const scoped = getAutoCompactionTokenStatusForSession(session as any, chatJid)!;
    expect(scoped.tokenStatus.autoCompactionScopeTokens).toBe(22_000);
    expect(scoped.tokenStatus.tokenLimitReached).toBe(false);

    usageTokens = 95_000;
    leafId = "leaf-3";
    const hard = getAutoCompactionTokenStatusForSession(session as any, chatJid)!;
    expect(hard.tokenStatus.fullContextWindowLimitReached).toBe(true);
    expect(hard.tokenStatus.tokenLimitReached).toBe(true);
  } finally {
    if (previousScope === undefined) delete process.env.PICLAW_AUTO_COMPACTION_SCOPE;
    else process.env.PICLAW_AUTO_COMPACTION_SCOPE = previousScope;
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
    if (previousHardCeiling === undefined) delete process.env.PICLAW_COMPACTION_HARD_CEILING_PERCENT;
    else process.env.PICLAW_COMPACTION_HARD_CEILING_PERCENT = previousHardCeiling;
  }
});

test("body-after-prefix auto-compaction resets the persisted window after success", async () => {
  const previousScope = process.env.PICLAW_AUTO_COMPACTION_SCOPE;
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  const previousWarning = process.env.PICLAW_COMPACTION_WARNING_THRESHOLD;
  process.env.PICLAW_AUTO_COMPACTION_SCOPE = "body_after_prefix";
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "50";
  process.env.PICLAW_COMPACTION_WARNING_THRESHOLD = "0";
  try {
    const chatJid = "web:body-prefix-reset";
    let usageTokens = 40_000;
    let leafId = "leaf-1";
    const session = {
      ...makeSession([{ role: "user", content: [{ type: "text", text: "x" }] }], usageTokens),
      getContextUsage: () => ({ tokens: usageTokens }),
      sessionManager: {
        getLeafId: () => leafId,
        getEntries: () => [leafId],
        buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
      },
      model: { provider: "test", id: "window-reset", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      async compact() {
        usageTokens = 12_000;
      },
    };

    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      chatJid,
      { onWarn: () => undefined, onInfo: () => undefined },
      () => undefined,
    );
    expect(getChatAutoCompactionWindow(chatJid).prefillTokens).toBe(44_000);

    usageTokens = 92_000;
    leafId = "leaf-2";
    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      chatJid,
      { onWarn: () => undefined, onInfo: () => undefined },
      () => undefined,
    );

    const state = getChatAutoCompactionWindow(chatJid);
    expect(state.ordinal).toBe(2);
    expect(state.baselineTokens).toBe(13_200);
    expect(state.prefillTokens).toBe(13_200);
    expect(state.successCount).toBe(1);
  } finally {
    if (previousScope === undefined) delete process.env.PICLAW_AUTO_COMPACTION_SCOPE;
    else process.env.PICLAW_AUTO_COMPACTION_SCOPE = previousScope;
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
    if (previousWarning === undefined) delete process.env.PICLAW_COMPACTION_WARNING_THRESHOLD;
    else process.env.PICLAW_COMPACTION_WARNING_THRESHOLD = previousWarning;
  }
});

test("noteCompactionSuccess resets scoped baseline for manual/model/recovery compactions without incrementing warning counters", () => {
  const previousScope = process.env.PICLAW_AUTO_COMPACTION_SCOPE;
  process.env.PICLAW_AUTO_COMPACTION_SCOPE = "body_after_prefix";
  try {
    for (const reason of ["manual", "model_downshift", "recovery"] as const) {
      const chatJid = `web:${reason}-finalizer`;
      let usageTokens = 80_000;
      const session = {
        ...makeSession([{ role: "user", content: [{ type: "text", text: "x" }] }], usageTokens),
        getContextUsage: () => ({ tokens: usageTokens }),
        model: { provider: "test", id: reason, contextWindow: 100_000 },
      };

      expect(getAutoCompactionTokenStatusForSession(session as any, chatJid)?.tokenStatus.prefillTokens).toBe(88_000);
      usageTokens = 12_000;
      const finalized = noteCompactionSuccess(session as any, chatJid, reason, { countSuccess: false });

      expect(finalized.ordinal).toBe(2);
      expect(finalized.prefillTokens).toBe(13_200);
      expect(finalized.successCount).toBe(0);
      expect(getAutoCompactionTokenStatusForSession(session as any, chatJid)?.tokenStatus.autoCompactionScopeTokens).toBe(0);
    }
  } finally {
    if (previousScope === undefined) delete process.env.PICLAW_AUTO_COMPACTION_SCOPE;
    else process.env.PICLAW_AUTO_COMPACTION_SCOPE = previousScope;
  }
});

test("maybeAutoCompactSessionBeforePrompt uses pending input projection", async () => {
  const previousScope = process.env.PICLAW_AUTO_COMPACTION_SCOPE;
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  process.env.PICLAW_AUTO_COMPACTION_SCOPE = "total";
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "75";
  try {
    let compactCalls = 0;
    const session = {
      ...makeSession([{ role: "user", content: [{ type: "text", text: "near threshold" }] }], 65_000),
      model: { provider: "test", id: "pending-projection", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      async compact() {
        compactCalls += 1;
      },
    };

    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      "web:pending-projection",
      { onWarn: () => undefined, onInfo: () => undefined },
      () => undefined,
      10_000,
    );

    expect(compactCalls).toBe(1);
  } finally {
    if (previousScope === undefined) delete process.env.PICLAW_AUTO_COMPACTION_SCOPE;
    else process.env.PICLAW_AUTO_COMPACTION_SCOPE = previousScope;
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
  }
});

test("estimateContextTokensFromSession trusts native usage before compaction when it is higher", () => {
  const session = makeSession([
    { role: "user", content: [{ type: "text", text: "hello" }] },
    { role: "assistant", content: [{ type: "text", text: "hi" }] },
  ], 123_456);

  expect(estimateContextTokensFromSession(session)).toBe(123_456);
});

test("estimateContextTokensFromSession does not let stale native usage undercount current context", () => {
  const session = makeSession([
    { role: "user", content: [{ type: "text", text: "small prompt" }] },
    { role: "toolResult", content: [{ type: "text", text: "x".repeat(20_000) }] },
  ], 100);

  expect(estimateContextTokensFromSession(session)).toBeGreaterThan(4_000);
});

test("estimateContextTokensFromSession clamps cached estimates to fresh provider usage", () => {
  let usageTokens = 100_000;
  const session = {
    getContextUsage: () => ({ tokens: usageTokens }),
    sessionManager: {
      getLeafId: () => "leaf-provider-cache",
      getEntries: () => ["same-entry-count"],
      buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "small" }] }] }),
    },
  } as any;

  expect(estimateContextTokensFromSession(session)).toBe(100_000);
  usageTokens = 321_100;
  expect(estimateContextTokensFromSession(session)).toBe(321_100);
});

test("estimateContextTokensFromSession uses provider usage once it is fresh after compaction", () => {
  let providerTokens: number | null = null;
  const session = {
    getContextUsage: () => ({ tokens: providerTokens }),
    sessionManager: {
      getLeafId: () => "leaf-compacted-cache",
      getEntries: () => ["same-entry-count"],
      buildSessionContext: () => ({
        messages: [
          { role: "compactionSummary", summary: "small summary", tokensBefore: 150_000 },
          { role: "assistant", content: [{ type: "text", text: "kept" }] },
        ],
      }),
    },
  } as any;

  expect(estimateContextTokensFromSession(session)).toBeLessThan(150_000);
  providerTokens = 200_000;
  expect(estimateContextTokensFromSession(session)).toBe(200_000);
});

test("getAutoCompactionTokenStatusForSession uses fresh provider usage above threshold despite cached lower estimate", () => {
  let usageTokens = 213_300;
  const chatJid = "web:fresh-provider-threshold";
  const session = {
    getContextUsage: () => ({ tokens: usageTokens }),
    model: { provider: "openai-codex", id: "gpt-5.5", contextWindow: 372_000 },
    sessionManager: {
      getLeafId: () => "leaf-threshold",
      getEntries: () => ["same-entry-count"],
      buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "small" }] }] }),
    },
  } as any;

  const before = getAutoCompactionTokenStatusForSession(session, chatJid)!;
  expect(before.rawContextTokens).toBe(213_300);
  expect(before.tokenStatus.tokenLimitReached).toBe(false);

  usageTokens = 321_100;
  const after = getAutoCompactionTokenStatusForSession(session, chatJid)!;
  expect(after.rawContextTokens).toBe(321_100);
  expect(after.tokenStatus.tokenLimitReached).toBe(true);
});

test("maybeAutoCompactSessionBeforePrompt triggers from fresh provider usage even after a cached lower estimate", async () => {
  const previousScope = process.env.PICLAW_AUTO_COMPACTION_SCOPE;
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  process.env.PICLAW_AUTO_COMPACTION_SCOPE = "total";
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "75";
  try {
    let usageTokens = 213_300;
    let compactCalls = 0;
    const chatJid = "web:fresh-provider-auto-compact";
    const session = {
      getContextUsage: () => ({ tokens: usageTokens }),
      model: { provider: "openai-codex", id: "gpt-5.5", contextWindow: 372_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 96_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      sessionManager: {
        getLeafId: () => "leaf-auto-threshold",
        getEntries: () => ["same-entry-count"],
        buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "small" }] }] }),
      },
      async compact() {
        compactCalls += 1;
        usageTokens = 50_000;
      },
    } as any;

    await maybeAutoCompactSessionBeforePrompt(session, chatJid, { onInfo: () => undefined, onWarn: () => undefined }, () => undefined);
    expect(compactCalls).toBe(0);

    usageTokens = 321_100;
    await maybeAutoCompactSessionBeforePrompt(session, chatJid, { onInfo: () => undefined, onWarn: () => undefined }, () => undefined);
    expect(compactCalls).toBe(1);
  } finally {
    if (previousScope === undefined) delete process.env.PICLAW_AUTO_COMPACTION_SCOPE;
    else process.env.PICLAW_AUTO_COMPACTION_SCOPE = previousScope;
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
  }
});

test("runCompactionWithTimeout preserves extension-recorded cancellation reasons", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5000";
  try {
    const session = makeSession([]);

    const result = await runCompactionWithTimeout(session, "web:recorded-cancel", {}, async () => {
      recordCompactionCancellationReason(session.sessionManager, "Smart compaction summary too short");
      throw new Error("Compaction cancelled");
    });

    expect(result).toEqual({ ok: false, errorMessage: "Smart compaction summary too short" });
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
  }
});

test("runCompactionWithTimeout disposes its timeout after successful completion", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5";
  try {
    let aborts = 0;
    const session = {
      ...makeSession([]),
      abortCompaction: () => {
        aborts += 1;
      },
    };

    const result = await runCompactionWithTimeout(session, "web:timer-disposal", {}, async () => "done");
    expect(result).toEqual({ ok: true, result: "done" });

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(aborts).toBe(0);
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
  }
});

test("runCompactionWithTimeout joins concurrent compaction calls for the same chat", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5000";
  try {
    const release = deferred<string>();
    const warnings: string[] = [];
    let calls = 0;
    const session = makeSession([]);
    const options = { onWarn: (message: string) => warnings.push(message) };

    const first = runCompactionWithTimeout(session, "web:test", options, async () => {
      calls += 1;
      return await release.promise;
    });
    await Promise.resolve();
    const second = runCompactionWithTimeout(session, "web:test", options, async () => {
      calls += 1;
      return "second";
    });

    release.resolve("first");

    const ownerOutcome = await first;
    const joinedOutcome = await second;
    expect(ownerOutcome).toEqual({ ok: true, result: "first" });
    expect(joinedOutcome).toEqual({ ok: true, result: "first" });
    expect(ownerOutcome.joined).toBe(false);
    expect(joinedOutcome.joined).toBe(true);
    expect(ownerOutcome.generationId).toBe(joinedOutcome.generationId);
    expect(calls).toBe(1);
    expect(warnings).toEqual(["Compaction already in progress; joining existing compaction"]);
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
  }
});

test("joined recovery failure finalizes backoff exactly once", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5000";
  try {
    const chatJid = "web:joined-recovery-failure";
    const release = deferred<void>();
    const session = makeSession([]);
    let calls = 0;
    const compact = async () => {
      calls += 1;
      await release.promise;
      throw new Error("provider unavailable");
    };

    const first = runCompactionWithTimeout(session, chatJid, {}, compact, "recovery");
    await Promise.resolve();
    const second = runCompactionWithTimeout(session, chatJid, {}, compact, "recovery");
    release.resolve();

    const ownerOutcome = await first;
    const joinedOutcome = await second;
    finalizeRecoveryCompactionOutcome(session, chatJid, ownerOutcome);
    finalizeRecoveryCompactionOutcome(session, chatJid, joinedOutcome);

    expect(calls).toBe(1);
    expect(ownerOutcome.joined).toBe(false);
    expect(joinedOutcome.joined).toBe(true);
    expect(getChatCompactionBackoff(chatJid)).toMatchObject({
      failureCount: 1,
      lastErrorMessage: "provider unavailable",
    });
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
  }
});

test("runCompactionWithTimeout serializes but does not join compactions from replaced sessions", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5000";
  try {
    const firstRelease = deferred<string>();
    const firstSession = makeSession([]);
    const replacementSession = makeSession([]);
    let replacementCalls = 0;

    const first = runCompactionWithTimeout(firstSession, "web:replaced-session", {}, async () => await firstRelease.promise);
    await Promise.resolve();
    const replacement = runCompactionWithTimeout(replacementSession, "web:replaced-session", {}, async () => {
      replacementCalls += 1;
      return "replacement";
    });
    await Promise.resolve();
    expect(replacementCalls).toBe(0);

    firstRelease.resolve("old-session");
    expect(await first).toEqual({ ok: true, result: "old-session" });
    expect(await replacement).toEqual({ ok: true, result: "replacement" });
    expect(replacementCalls).toBe(1);
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
  }
});

test("runCompactionWithTimeout keeps the single-flight lock until timed-out compaction settles", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5";
  try {
    const release = deferred<void>();
    let calls = 0;
    let aborts = 0;
    const session = {
      ...makeSession([]),
      isCompacting: true,
      abortCompaction: () => {
        aborts += 1;
        // Simulate abort causing the compaction to settle shortly after
        setTimeout(() => release.resolve(), 10);
      },
    };
    const options = { onWarn: () => undefined };

    const first = await runCompactionWithTimeout(session, "web:timeout-settle", options, async () => {
      calls += 1;
      await release.promise;
      return "late";
    });

    // First call timed out, but settlement grace waited for the compaction
    // promise to settle — so the lock is already released by the time the
    // caller gets the result.
    expect(first.ok).toBe(false);
    expect(calls).toBe(1);
    expect(aborts).toBe(1);

    // Second call should now succeed independently (lock was released
    // after settlement).
    const second = await runCompactionWithTimeout(session, "web:timeout-settle", options, async () => {
      calls += 1;
      return "second";
    });
    expect(second).toEqual({ ok: true, result: "second" });
    expect(calls).toBe(2);
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
  }
});

test("compaction timeout grace preserves zero and rejects malformed non-negative env values", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  const previousGrace = process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5";
  process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS = "0oops";
  try {
    const never = deferred<void>();
    let calls = 0;
    const session = {
      ...makeSession([]),
      isCompacting: true,
      abortCompaction: () => undefined,
    };
    const compact = async () => {
      calls += 1;
      await never.promise;
      return "impossible";
    };

    const ownerPromise = runCompactionWithTimeout(session, "web:timeout-quarantine", {}, compact);
    await Bun.sleep(25);
    expect(getSessionActivitySnapshot("web:timeout-quarantine")?.isCompacting).toBe(true);

    never.resolve();
    const owner = await ownerPromise;
    expect(owner.ok).toBe(false);
    expect(owner.joined).toBe(false);
    expect(calls).toBe(1);
    expect(getSessionActivitySnapshot("web:timeout-quarantine")?.isCompacting).toBe(false);
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
    if (previousGrace === undefined) delete process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS;
    else process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS = previousGrace;
  }
});

test("compaction max-work-units env rejects malformed positive suffixes", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  const previousMaxWorkUnits = process.env.PICLAW_COMPACTION_MAX_WORK_UNITS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "5000";
  process.env.PICLAW_COMPACTION_MAX_WORK_UNITS = "123oops";
  try {
    const session = makeSession([]);
    let observedMaxWorkUnits: unknown;
    const result = await runCompactionWithTimeout(session, "web:max-work-units", {}, async () => {
      observedMaxWorkUnits = getActivePiclawCompactionTrigger()?.maxWorkUnits;
      return "done";
    });

    expect(result).toEqual({ ok: true, result: "done" });
    expect(observedMaxWorkUnits).toBe(1_000_000);
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
    if (previousMaxWorkUnits === undefined) delete process.env.PICLAW_COMPACTION_MAX_WORK_UNITS;
    else process.env.PICLAW_COMPACTION_MAX_WORK_UNITS = previousMaxWorkUnits;
  }
});

test("idle auto-compaction delay env preserves zero and rejects malformed suffixes", async () => {
  const previousDelay = process.env.PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS;
  try {
    const session = {
      ...makeSession([{ role: "user", content: "large" }], 90_000),
      model: { provider: "test", id: "idle-delay", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      compact: async () => undefined,
    };

    process.env.PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS = "0";
    let zeroDelayFired = false;
    scheduleIdleAutoCompaction(session as any, "web:idle-zero-delay", {}, () => {
      zeroDelayFired = true;
    });
    await Bun.sleep(25);
    expect(zeroDelayFired).toBe(true);

    process.env.PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS = "0oops";
    let malformedDelayFired = false;
    scheduleIdleAutoCompaction(session as any, "web:idle-malformed-delay", {}, () => {
      malformedDelayFired = true;
    });
    await Bun.sleep(25);
    expect(malformedDelayFired).toBe(false);
  } finally {
    if (previousDelay === undefined) delete process.env.PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS;
    else process.env.PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS = previousDelay;
  }
});

test("a late timed-out compaction cannot clear a replacement generation's active state", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  const previousGrace = process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "20";
  process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS = "5";
  const chatJid = "web:late-compaction-generation";

  try {
    const oldRelease = deferred<string>();
    const replacementRelease = deferred<string>();
    const oldSession = {
      ...makeSession([]),
      isCompacting: true,
      abortCompaction: () => undefined,
    };
    const replacementSession = makeSession([]);

    const first = await runCompactionWithTimeout(oldSession, chatJid, {}, async () => await oldRelease.promise);
    expect(first.ok).toBe(false);

    const replacement = runCompactionWithTimeout(
      replacementSession,
      chatJid,
      {},
      async () => await replacementRelease.promise,
    );
    await Promise.resolve();
    expect(getSessionActivitySnapshot(chatJid)?.isCompacting).toBe(true);

    oldRelease.resolve("late-old-result");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSessionActivitySnapshot(chatJid)?.isCompacting).toBe(true);

    replacementRelease.resolve("replacement-result");
    expect(await replacement).toEqual({ ok: true, result: "replacement-result" });
    expect(getSessionActivitySnapshot(chatJid)?.isCompacting).toBe(false);
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
    if (previousGrace === undefined) delete process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS;
    else process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS = previousGrace;
  }
});

test("late cancellation cleanup cannot consume a replacement generation's reason", async () => {
  const previousTimeout = process.env.PICLAW_COMPACTION_TIMEOUT_MS;
  const previousGrace = process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS;
  process.env.PICLAW_COMPACTION_TIMEOUT_MS = "50";
  process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS = "0";
  const chatJid = "web:late-cancellation-reason";

  try {
    const oldRelease = deferred<void>();
    const replacementRelease = deferred<void>();
    const oldStarted = deferred<void>();
    const replacementStarted = deferred<void>();
    const session = {
      ...makeSession([]),
      isCompacting: true,
      abortCompaction: () => undefined,
    };
    const replacementSession = {
      ...makeSession([]),
      isCompacting: true,
      abortCompaction: () => undefined,
    };

    const old = runCompactionWithTimeout(session, chatJid, {}, async () => {
      recordCompactionCancellationReason(session.sessionManager, "old generation reason");
      oldStarted.resolve();
      await oldRelease.promise;
      throw new Error("Compaction cancelled");
    });
    await oldStarted.promise;
    expect((await old).ok).toBe(false);

    const replacement = runCompactionWithTimeout(replacementSession, chatJid, {}, async () => {
      recordCompactionCancellationReason(replacementSession.sessionManager, "replacement generation reason");
      replacementStarted.resolve();
      await replacementRelease.promise;
      throw new Error("Compaction cancelled");
    });
    await replacementStarted.promise;

    oldRelease.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    replacementRelease.resolve();

    expect(await replacement).toEqual({ ok: false, errorMessage: "replacement generation reason" });
  } finally {
    if (previousTimeout === undefined) delete process.env.PICLAW_COMPACTION_TIMEOUT_MS;
    else process.env.PICLAW_COMPACTION_TIMEOUT_MS = previousTimeout;
    if (previousGrace === undefined) delete process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS;
    else process.env.PICLAW_COMPACTION_SETTLEMENT_GRACE_MS = previousGrace;
  }
});

test("maybeAutoCompactSessionBeforePrompt subtracts overhead before threshold checks", async () => {
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  const previousOverhead = process.env.PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS;
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "75";
  process.env.PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS = "4000";
  try {
    const events: any[] = [];
    let compactCalls = 0;
    const session = {
      ...makeSession([
        { role: "user", content: [{ type: "text", text: "x".repeat(4000) }] },
      ], 73_000),
      model: { provider: "test", id: "effective-window", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      async compact() {
        compactCalls += 1;
      },
    };

    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      "web:effective-window",
      { onWarn: () => undefined, onInfo: () => undefined },
      (event) => events.push(event),
    );

    expect(compactCalls).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "compaction_start",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      source: "pre_prompt_auto_compaction",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "compaction_end",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      aborted: false,
      source: "pre_prompt_auto_compaction",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "context_usage_update",
      source: "compaction",
      phase: "after_threshold_compaction",
      estimated: true,
      contextWindow: 100_000,
    }));
  } finally {
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
    if (previousOverhead === undefined) delete process.env.PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS;
    else process.env.PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS = previousOverhead;
  }
});

test("maybeAutoCompactSessionBeforePrompt emits normalized failure compaction-end events", async () => {
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "75";
  try {
    const events: any[] = [];
    const session = {
      ...makeSession([{ role: "user", content: [{ type: "text", text: "x" }] }], 90_000),
      model: { provider: "test", id: "failure-shape", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      async compact() {
        throw new Error("model failed");
      },
    };

    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      "web:failure-shape",
      { onWarn: () => undefined, onInfo: () => undefined },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(expect.objectContaining({
      type: "compaction_end",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      aborted: false,
      source: "pre_prompt_auto_compaction",
      errorMessage: "Pre-prompt compaction failed: model failed",
    }));
  } finally {
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
  }
});

test("maybeAutoCompactSessionBeforePrompt emits normalized cancellation compaction-end events", async () => {
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "75";
  try {
    const events: any[] = [];
    const session = {
      ...makeSession([{ role: "user", content: [{ type: "text", text: "x" }] }], 90_000),
      model: { provider: "test", id: "cancel-shape", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      async compact() {
        throw new Error("Compaction cancelled");
      },
    };

    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      "web:cancel-shape",
      { onWarn: () => undefined, onInfo: () => undefined },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(expect.objectContaining({
      type: "compaction_end",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      aborted: true,
      source: "pre_prompt_auto_compaction",
      errorMessage: "Compaction cancelled",
    }));
  } finally {
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
  }
});

test("maybeAutoCompactSessionBeforePrompt emits repeated-compaction warning at threshold", async () => {
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  const previousWarning = process.env.PICLAW_COMPACTION_WARNING_THRESHOLD;
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "50";
  process.env.PICLAW_COMPACTION_WARNING_THRESHOLD = "2";
  try {
    const chatJid = "web:repeated-warning";
    let usageTokens = 90_000;
    let leafId = "leaf-1";
    const events: any[] = [];
    const session = {
      ...makeSession([{ role: "user", content: [{ type: "text", text: "x" }] }], usageTokens),
      getContextUsage: () => ({ tokens: usageTokens }),
      sessionManager: {
        getLeafId: () => leafId,
        getEntries: () => [leafId],
        buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
      },
      model: { provider: "test", id: "warning", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      async compact() {
        usageTokens = 10_000;
      },
    };

    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      chatJid,
      { onWarn: () => undefined, onInfo: () => undefined },
      (event) => events.push(event),
    );
    usageTokens = 90_000;
    leafId = "leaf-2";
    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      chatJid,
      { onWarn: () => undefined, onInfo: () => undefined },
      (event) => events.push(event),
    );

    expect(events).toContainEqual(expect.objectContaining({
      type: "compaction_warning",
      reason: "repeated_successes",
      compactionCount: 2,
      warningThreshold: 2,
    }));
  } finally {
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
    if (previousWarning === undefined) delete process.env.PICLAW_COMPACTION_WARNING_THRESHOLD;
    else process.env.PICLAW_COMPACTION_WARNING_THRESHOLD = previousWarning;
  }
});

test("noteCompactionFailure starts a fresh failure series after stale persisted state", () => {
  const chatJid = `web:stale-compaction-failure-${Date.now()}`;
  setChatCompactionBackoff(chatJid, {
    chatJid,
    failureCount: 9,
    lastFailedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    backoffUntil: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastErrorMessage: "Historical failure",
  });

  noteCompactionFailure(chatJid, "Fresh failure");

  const backoff = getChatCompactionBackoff(chatJid);
  expect(backoff?.failureCount).toBe(1);
  expect(backoff?.lastErrorMessage).toBe("Fresh failure");
  expect(Date.parse(backoff?.backoffUntil || "")).toBeGreaterThan(Date.now());
});

test("maybeAutoCompactSessionBeforePrompt retries after non-cancellation backoff expires", async () => {
  const previousThreshold = process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
  process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = "75";
  try {
    const events: any[] = [];
    const warnings: string[] = [];
    let compactCalls = 0;
    const chatJid = "web:previous-failure";
    setChatCompactionBackoff(chatJid, {
      chatJid,
      failureCount: 1,
      lastFailedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      backoffUntil: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      lastErrorMessage: "Compaction timed out after 180s",
    });
    const session = {
      ...makeSession([
        { role: "user", content: [{ type: "text", text: "x".repeat(4000) }] },
      ], 80_000),
      model: { provider: "test", id: "large", contextWindow: 100_000 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25_000 }) },
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      async compact() {
        compactCalls += 1;
      },
    };

    await maybeAutoCompactSessionBeforePrompt(
      session as any,
      chatJid,
      { onWarn: (message) => warnings.push(message), onInfo: () => undefined },
      (event) => events.push(event),
    );

    expect(compactCalls).toBe(1);
    expect(warnings).not.toContain("Pre-prompt auto-compaction suppressed for chat after recent failures");
    expect(events).toContainEqual(expect.objectContaining({ type: "compaction_start" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "compaction_end", aborted: false }));
    expect(getChatCompactionBackoff(chatJid)).toBeNull();
  } finally {
    if (previousThreshold === undefined) delete process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT;
    else process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT = previousThreshold;
  }
});

test("estimateContextTokensFromSession ignores stale assistant usage after compaction", () => {
  const stalePreCompactionUsage = {
    input: 220_000,
    output: 8_000,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 228_000,
  };
  const session = makeSession([
    {
      role: "compactionSummary",
      summary: "short compacted summary",
      tokensBefore: 228_000,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "kept assistant message" }],
      usage: stalePreCompactionUsage,
      stopReason: "stop",
    },
    {
      role: "toolResult",
      content: [{ type: "text", text: "small result" }],
    },
  ]);

  const estimated = estimateContextTokensFromSession(session);

  expect(estimated).toBeLessThan(100);
  expect(estimated).not.toBe(230_000);
});
