import { expect, test } from "bun:test";

import {
  getProtectedRecoveryControlIntent,
  getTurnOutcomeMarker,
  normalizePost,
  shouldHideTimelineInteraction,
} from "../../web/static/visual/frontend/src/components/message-list/helpers.js";

const typedFields = {
  reason: "post_compaction_tools_required",
  compaction: "succeeded",
  tools_required: true,
  retryable: true,
  recovery_attempts: 2,
};

test("visual timeline hides complete protected-recovery control intents on SSE and reload shapes", () => {
  const block = {
    type: "control_intent",
    intent: "protected_recovery_continuation",
    schema_version: 1,
    label: "Recovery resumed with execution tools",
    source_message_id: "source-123",
    source_row_id: 41,
    thread_id: 41,
    handoff_depth: 2,
    ...typedFields,
  };
  const sse = normalizePost({
    id: 90,
    type: "user",
    content: "Recovery resumed with execution tools",
    content_blocks: [block],
    created_at: "2026-08-25T00:00:00.000Z",
  });
  const reload = normalizePost({
    id: 90,
    timestamp: "2026-08-25T00:00:00.000Z",
    data: {
      type: "user_message",
      content: "Recovery resumed with execution tools",
      content_blocks: [block],
    },
  });

  expect(getProtectedRecoveryControlIntent(sse.content_blocks)).toMatchObject(typedFields);
  const primaryFields = {
    primary_failure_category: "timeout",
    primary_failure_detail: "Timed out after 3600s.",
    primary_failure_elapsed_ms: 3_600_575,
    primary_failure_execution_tools: true,
    primary_failure_had_partial_output: true,
    primary_failure_had_tool_activity: true,
    primary_failure_tool_executions: 403,
  };
  expect(getProtectedRecoveryControlIntent([{ ...block, ...primaryFields }])).toMatchObject(primaryFields);
  expect(getProtectedRecoveryControlIntent([{
    ...block,
    primary_failure_category: "timeout",
  }])).toBeNull();
  expect(shouldHideTimelineInteraction(sse)).toBe(true);
  expect(shouldHideTimelineInteraction(reload)).toBe(true);
});

test("visual timeline preserves typed terminal recovery details and legacy marker fallback", () => {
  const terminal = normalizePost({
    id: 91,
    type: "agent",
    content: "⚠️ Automatic recovery paused",
    content_blocks: [{
      type: "turn_outcome_marker",
      kind: "recovery",
      severity: "warning",
      label: "tools required",
      title: "Automatic recovery paused after successful compaction",
      detail: "Compaction succeeded, but the unfinished task still requires execution tools. The session is preserved.",
      next_action: "Send “continue” to resume from the preserved session state.",
      ...typedFields,
    }],
    created_at: "2026-08-25T00:00:00.000Z",
  });
  const legacyPlaceholder = normalizePost({
    id: 92,
    type: "agent",
    content: "",
    content_blocks: [{
      type: "turn_outcome_marker",
      kind: "recovery",
      severity: "info",
      title: "Recovery resumed with execution tools",
    }],
    created_at: "2026-08-25T00:00:00.000Z",
  });

  expect(getTurnOutcomeMarker(terminal.content_blocks)).toMatchObject({
    ...typedFields,
    next_action: "Send “continue” to resume from the preserved session state.",
  });
  expect(shouldHideTimelineInteraction(terminal)).toBe(false);
  expect(shouldHideTimelineInteraction(legacyPlaceholder)).toBe(true);
});

test("visual timeline tolerates null public content blocks", () => {
  const post = normalizePost({
    id: 90,
    type: "user",
    content: "ordinary message",
    content_blocks: [null],
    created_at: "2026-08-25T00:00:00.000Z",
  });

  expect(getProtectedRecoveryControlIntent(post.content_blocks)).toBeNull();
  expect(getTurnOutcomeMarker(post.content_blocks)).toBeNull();
  expect(shouldHideTimelineInteraction(post)).toBe(false);
});

test("visual timeline does not grant control authority to matching plaintext", () => {
  const prose = normalizePost({
    id: 93,
    type: "user",
    content: "Recovery resumed with execution tools",
    created_at: "2026-08-25T00:00:00.000Z",
  });
  const incomplete = normalizePost({
    id: 94,
    type: "user",
    content: "Recovery resumed with execution tools",
    content_blocks: [{
      type: "control_intent",
      intent: "protected_recovery_continuation",
      schema_version: 1,
    }],
    created_at: "2026-08-25T00:00:00.000Z",
  });

  const envelope = {
    type: "control_intent",
    intent: "protected_recovery_continuation",
    schema_version: 1,
    source_message_id: "source-123",
    source_row_id: 41,
    thread_id: 41,
  };
  const partialTyped = normalizePost({
    id: 95,
    type: "user",
    content: "Recovery resumed with execution tools",
    content_blocks: [{ ...envelope, reason: "tools_required" }],
    created_at: "2026-08-25T00:00:00.000Z",
  });
  const contradictory = normalizePost({
    id: 96,
    type: "user",
    content: "Recovery resumed with execution tools",
    content_blocks: [{
      ...envelope,
      reason: "post_compaction_tools_required",
      compaction: "failed",
      tools_required: true,
      retryable: true,
      recovery_attempts: 1,
    }],
    created_at: "2026-08-25T00:00:00.000Z",
  });

  expect(shouldHideTimelineInteraction(prose)).toBe(false);
  expect(shouldHideTimelineInteraction(incomplete)).toBe(false);
  expect(shouldHideTimelineInteraction(partialTyped)).toBe(false);
  expect(shouldHideTimelineInteraction(contradictory)).toBe(false);
});
