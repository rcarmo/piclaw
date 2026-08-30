import { expect, test } from "bun:test";

import { TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT } from "../../src/agent-pool/context-pressure-retry.js";
import {
  PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE,
  finishBoundedProtectedRecoveryHandoff,
  runWithProtectedRecoveryHandoff,
} from "../../src/agent-pool/protected-recovery-handoff.js";
import {
  buildProtectedRecoveryControlIntentBlock,
  isProtectedRecoveryControlMessage,
  resolveProtectedRecoveryControlIntent,
  resolveProtectedRecoveryPrompt,
} from "../../src/agent-pool/protected-recovery-control-intent.js";
import type { AgentOutput } from "../../src/agent-pool/contracts.js";
import {
  PROTECTED_RECOVERY_HANDOFF_REASONS,
  buildProtectedRecoveryHandoffMetadata,
  formatProtectedRecoveryHandoff,
  protectedRecoveryHandoffContentBlockFields,
} from "../../src/agent-pool/protected-recovery-handoff-reason.js";

const protectedOutput = (strategyHistory: string[] = []): AgentOutput => ({
  status: "error",
  result: null,
  error: "Protected recovery needs an ordinary turn.",
  requiresToolEnabledContinuation: true,
  recovery: strategyHistory.length > 0
    ? {
        attemptsUsed: 1,
        totalElapsedMs: 1,
        recovered: false,
        exhausted: true,
        lastClassifier: "tool_activity",
        strategyHistory,
        diagnostics: [],
      }
    : undefined,
  protectedRecoveryHandoff: strategyHistory.at(-1) === "compact_then_retry"
    ? buildProtectedRecoveryHandoffMetadata("post_compaction_tools_required", {
        recoveryAttempts: 1,
        compaction: "succeeded",
        toolsRequired: true,
        retryable: true,
      })
    : undefined,
});

test("protected recovery runs exactly one ordinary continuation at the AgentPool boundary", async () => {
  const prompts: string[] = [];
  const observed: AgentOutput[] = [];
  const handoff = buildProtectedRecoveryHandoffMetadata("tools_required", {
    recoveryAttempts: 1,
    toolsRequired: true,
  });
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt, options) => {
      prompts.push(prompt);
      if (prompts.length === 2) {
        expect(options.protectedRecoveryHandoffContext).toEqual(handoff);
      }
      return prompts.length === 1
        ? { ...protectedOutput(), protectedRecoveryHandoff: handoff }
        : { status: "success", result: "finished with tools" };
    },
    (output) => observed.push(output),
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(observed).toHaveLength(2);
  expect(final).toMatchObject({ status: "success", result: "finished with tools" });
});

test("protected handoff preserves pre-tool progress but hides unauthoritative terminal prose", async () => {
  const delivered: string[] = [];
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    { onTurnComplete: (turn) => delivered.push(turn.text) },
    async (prompt, options) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        options.onTurnComplete?.({ text: "committed tool progress", attachments: [], followedByToolUse: true });
        options.onTurnComplete?.({ text: "protected terminal prose", attachments: [] });
        return protectedOutput();
      }
      options.onTurnComplete?.({ text: "ordinary result", attachments: [] });
      return { status: "success", result: "ordinary result" };
    },
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(delivered).toEqual(["committed tool progress", "ordinary result"]);
  expect(final.result).toBe("ordinary result");
});

test("initial turns flush normally when no handoff is required", async () => {
  const delivered: string[] = [];
  await runWithProtectedRecoveryHandoff(
    "finish the task",
    { onTurnComplete: (turn) => delivered.push(turn.text) },
    async (_prompt, options) => {
      options.onTurnComplete?.({ text: "normal result", attachments: [] });
      return { status: "success", result: "normal result" };
    },
  );

  expect(delivered).toEqual(["normal result"]);
});

test("web defers protected recovery without publishing its tool-free terminal prose", async () => {
  const prompts: string[] = [];
  const delivered: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {
      deferToolEnabledContinuation: true,
      onTurnComplete: (turn) => delivered.push(turn.text),
    },
    async (prompt, options) => {
      prompts.push(prompt);
      options.onTurnComplete?.({ text: "committed tool progress", attachments: [], followedByToolUse: true });
      options.onTurnComplete?.({ text: "tools are unavailable in this recovered turn", attachments: [] });
      return protectedOutput();
    },
  );

  expect(prompts).toEqual(["finish the task"]);
  expect(delivered).toEqual(["committed tool progress"]);
  expect(final.requiresToolEnabledContinuation).toBe(true);
});

test("unresolved tool execution never starts an automatic continuation", async () => {
  let calls = 0;
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async () => {
      calls += 1;
      return {
        ...protectedOutput(),
        protectedRecoveryHandoff: buildProtectedRecoveryHandoffMetadata("unresolved_tool_execution", {
          recoveryAttempts: 1,
          toolsRequired: true,
          retryable: true,
        }),
      };
    },
  );

  expect(calls).toBe(1);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
  expect(final.protectedRecoveryHandoff?.reason).toBe("unresolved_tool_execution");
});

test("a persisted unresolved continuation terminalizes before invoking the provider", async () => {
  let calls = 0;
  const handoff = buildProtectedRecoveryHandoffMetadata("unresolved_tool_execution", {
    recoveryAttempts: 2,
    compaction: "succeeded",
    toolsRequired: true,
    retryable: true,
  });
  const final = await runWithProtectedRecoveryHandoff(
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    {
      protectedRecoveryContinuation: true,
      protectedRecoveryContinuationDepth: 1,
      protectedRecoveryHandoffContext: handoff,
    },
    async () => {
      calls += 1;
      return { status: "success", result: "must not run" };
    },
  );

  expect(calls).toBe(0);
  expect(final.protectedRecoveryHandoff).toEqual(handoff);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
});

test("the generated ordinary continuation cannot chain an unprepared recovery", async () => {
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt) => {
      prompts.push(prompt);
      return protectedOutput();
    },
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
  expect(final.result).toBe(PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE);
  expect(final.protectedRecoveryHandoff?.reason).toBe("continuation_generation_exhausted");
});

test("legacy strategy history alone cannot prove successful compaction", async () => {
  let calls = 0;
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async () => {
      calls += 1;
      if (calls === 1) return protectedOutput();
      const { protectedRecoveryHandoff: _typed, ...legacy } = protectedOutput(["compact_then_retry"]);
      return legacy;
    },
  );

  expect(calls).toBe(2);
  expect(final.protectedRecoveryHandoff?.reason).toBe("continuation_generation_exhausted");
});

test("bounded handoff finalization preserves every authoritative typed cause", () => {
  for (const reason of PROTECTED_RECOVERY_HANDOFF_REASONS) {
    const final = finishBoundedProtectedRecoveryHandoff({
      ...protectedOutput(),
      protectedRecoveryHandoff: buildProtectedRecoveryHandoffMetadata(reason, {
        recoveryAttempts: 2,
        toolsRequired: reason === "post_compaction_tools_required"
          || reason === "tools_required"
          || reason === "unresolved_tool_execution",
        retryable: false,
      }),
    });
    expect(final.protectedRecoveryHandoff?.reason).toBe(reason);
    expect(final.protectedRecoveryHandoff?.retryable).toBe(false);
    expect(final.requiresToolEnabledContinuation).toBeUndefined();
  }
});

test("a compacted generated continuation receives one final tool-enabled handoff", async () => {
  const prompts: string[] = [];
  const depths: Array<number | undefined> = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt, options) => {
      prompts.push(prompt);
      depths.push(options.protectedRecoveryContinuationDepth);
      if (prompts.length === 1) return protectedOutput();
      if (prompts.length === 2) return protectedOutput(["compact_then_retry"]);
      return { status: "success", result: "finished after compaction" };
    },
  );

  expect(prompts).toEqual([
    "finish the task",
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
  ]);
  expect(depths).toEqual([undefined, 1, 2]);
  expect(final).toMatchObject({ status: "success", result: "finished after compaction" });
});

test("a second compacted continuation stops at the bounded handoff limit", async () => {
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? protectedOutput()
        : protectedOutput(["compact_then_retry"]);
    },
  );

  expect(prompts).toHaveLength(3);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
  expect(final.protectedRecoveryHandoff?.reason).toBe("post_compaction_tools_required");
  expect(final.result).toContain("paused after successful compaction");
  expect(final.result).toContain("Send “continue”");
});

test("a typed continuation only hands off again after compaction", async () => {
  let calls = 0;
  const final = await runWithProtectedRecoveryHandoff(
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    { protectedRecoveryContinuation: true, protectedRecoveryContinuationDepth: 1 },
    async () => {
      calls += 1;
      return protectedOutput();
    },
  );

  expect(calls).toBe(1);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
  expect(final.result).toBe(PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE);
});

test("all protected-recovery reasons produce safe deterministic content-block fields", () => {
  for (const reason of PROTECTED_RECOVERY_HANDOFF_REASONS) {
    const metadata = buildProtectedRecoveryHandoffMetadata(reason, { recoveryAttempts: 2 });
    const presentation = formatProtectedRecoveryHandoff(metadata);
    expect(protectedRecoveryHandoffContentBlockFields(metadata)).toEqual({
      reason,
      compaction: reason === "post_compaction_tools_required"
        ? "succeeded"
        : reason === "compaction_failed" ? "failed" : "not_attempted",
      tools_required: reason === "post_compaction_tools_required"
        || reason === "tools_required"
        || reason === "unresolved_tool_execution",
      retryable: true,
      recovery_attempts: 2,
    });
    expect(presentation.title.length).toBeGreaterThan(0);
    expect(presentation.detail).toContain("session is preserved");
    expect(presentation.nextAction).toContain("continue");
    expect(JSON.stringify({ metadata, presentation })).not.toContain("provider-secret");
  }
});

test("protected recovery control authority requires the complete typed block", () => {
  const handoff = buildProtectedRecoveryHandoffMetadata("post_compaction_tools_required", {
    recoveryAttempts: 2,
    recoverySourceId: "source-message",
    recoveryGeneration: 1,
  });
  const block = buildProtectedRecoveryControlIntentBlock({
    sourceMessageId: "source-message",
    sourceRowId: 41,
    threadId: 41,
    handoff,
  });

  expect(isProtectedRecoveryControlMessage({ content_blocks: [block] })).toBe(true);
  expect(resolveProtectedRecoveryControlIntent({ content_blocks: [block] })).toMatchObject({
    handoff_depth: 1,
    reason: "post_compaction_tools_required",
    compaction: "succeeded",
    tools_required: true,
    retryable: true,
    recovery_attempts: 2,
    recovery_source_id: "source-message",
    recovery_generation: 1,
  });
  expect(resolveProtectedRecoveryPrompt({ content_blocks: [block] })).toBe(TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...block, label: "Presentation text may change" }],
  })).toBe(true);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ type: "control_intent", intent: "protected_recovery_continuation" }],
  })).toBe(false);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...block, schema_version: 2 }],
  })).toBe(false);
  const legacyBlock = buildProtectedRecoveryControlIntentBlock({
    sourceMessageId: "legacy-source",
    sourceRowId: 42,
    threadId: 42,
  });
  expect(isProtectedRecoveryControlMessage({ content_blocks: [legacyBlock] })).toBe(true);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...legacyBlock, reason: "tools_required" }],
  })).toBe(false);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...block, compaction: "failed" }],
  })).toBe(false);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...block, recovery_generation: undefined }],
  })).toBe(false);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...block, recovery_source_id: undefined }],
  })).toBe(false);
});

test("matching continuation prose does not acquire one-shot control authority", async () => {
  const prompts: string[] = [];
  await runWithProtectedRecoveryHandoff(
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    {},
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? protectedOutput() : { status: "success", result: "done" };
    },
  );

  expect(prompts).toEqual([
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
  ]);
});
