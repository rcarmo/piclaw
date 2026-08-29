import { describe, expect, it, vi } from "vitest";
import { createStreamingEventHandler } from "../../../../src/channels/web/sse/agent-events.js";

function makeHandler(
  formatThinkingLevel?: (level: string) => string,
  includeThoughtFull = false,
  displayUpdateIntervalMs = 0,
  includeDraftFull = false,
) {
  const statuses: Record<string, unknown>[] = [];
  const emitter = {
    status: vi.fn((payload: Record<string, unknown>) => statuses.push(payload)),
    thought: vi.fn(),
    thoughtDelta: vi.fn(),
    draft: vi.fn(),
    draftDelta: vi.fn(),
    response: vi.fn(),
    generatedWidgetOpen: vi.fn(),
    generatedWidgetDelta: vi.fn(),
    generatedWidgetFinal: vi.fn(),
    generatedWidgetClose: vi.fn(),
    generatedWidgetError: vi.fn(),
    modelChanged: vi.fn(),
  };
  const handler = createStreamingEventHandler({
    emitter,
    agentId: "agent-1",
    threadId: "thread-1",
    turnId: "turn-1",
    formatThinkingLevel,
    includeThoughtFull: () => includeThoughtFull,
    includeDraftFull: () => includeDraftFull,
    displayUpdateIntervalMs,
  });
  return { handler, statuses, emitter };
}

describe("web SSE tool execution events", () => {
  it("retains concurrent active-tool state, refreshes heartbeats, and exits tool execution on the final end", () => {
    const { handler, statuses } = makeHandler();

    handler({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "sleep 10" } } as any);
    handler({ type: "tool_execution_start", toolCallId: "tool-2", toolName: "read", args: { path: "README.md" } } as any);
    handler({
      type: "tool_execution_heartbeat",
      emittedAt: "2026-08-07T12:00:10.000Z",
      activeToolCount: 2,
      activeToolNames: ["bash", "read"],
      activeTools: [
        { toolCallId: "tool-1", toolName: "bash", startedAt: "2026-08-07T12:00:00.000Z", lastEventAt: "2026-08-07T12:00:00.000Z" },
        { toolCallId: "tool-2", toolName: "read", startedAt: "2026-08-07T12:00:01.000Z", lastEventAt: "2026-08-07T12:00:01.000Z" },
      ],
    } as any);
    handler({
      type: "tool_execution_update",
      toolCallId: "tool-2",
      toolName: "read",
      args: { path: "README.md" },
      partialResult: { content: [{ type: "text", text: "latest output" }] },
    } as any);
    handler({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "bash", isError: false, durationMs: 10000 } as any);
    handler({ type: "tool_execution_end", toolCallId: "tool-2", toolName: "read", isError: false, durationMs: 11000 } as any);

    expect(statuses[1]).toMatchObject({
      type: "tool_call",
      active_tool_count: 2,
      active_tools: [
        expect.objectContaining({ tool_call_id: "tool-1", tool_name: "bash" }),
        expect.objectContaining({ tool_call_id: "tool-2", tool_name: "read" }),
      ],
    });
    expect(statuses[2]).toMatchObject({
      watchdog_heartbeat: true,
      last_event_at: "2026-08-07T12:00:10.000Z",
      active_tool_count: 2,
    });
    expect(statuses[3]).toMatchObject({
      type: "tool_status",
      tool_call_id: "tool-2",
      output_preview: "latest output",
      active_tool_count: 2,
    });
    expect(statuses[4]).toMatchObject({
      type: "tool_status",
      tool_call_id: "tool-2",
      active_tool_count: 1,
      last_completed_tool: expect.objectContaining({ tool_call_id: "tool-1", status: "completed" }),
    });
    expect(statuses[5]).toMatchObject({
      type: "waiting",
      phase: "post_tool_model",
      title: "Waiting for model...",
      active_tool_count: 0,
      last_completed_tool: expect.objectContaining({ tool_call_id: "tool-2", status: "completed" }),
    });
  });

  it("preserves cumulative thought and advances the post-tool phase on model output", () => {
    const { handler, statuses, emitter } = makeHandler(undefined, true);

    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } } as any);
    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "before tool" } } as any);
    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "before tool" } } as any);
    handler({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "README.md" } } as any);
    handler({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", isError: false } as any);

    expect(statuses.at(-1)).toMatchObject({ type: "waiting", phase: "post_tool_model", title: "Waiting for model..." });

    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } } as any);
    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "after tool" } } as any);
    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "after tool" } } as any);

    expect(statuses.at(-1)).toMatchObject({ type: "thinking", phase: "thinking", title: "Thinking..." });
    expect(emitter.thought).toHaveBeenLastCalledWith(expect.objectContaining({
      text: "before tool\n\nafter tool",
      total_lines: 3,
    }));
    const thoughtDeltaPayloads = emitter.thoughtDelta.mock.calls.map(([payload]) => payload);
    expect(thoughtDeltaPayloads.filter((payload) => payload.reset === true)).toHaveLength(1);
    expect(thoughtDeltaPayloads.map((payload) => payload.delta).join(""))
      .toBe("before tool\n\nafter tool");
  });
});

describe("web SSE display update coalescing", () => {
  it("coalesces burst Draft snapshots and ordered deltas to the configured display rate", async () => {
    const { emitter } = makeHandler(undefined, false, 25);
    const includeDraftFull = vi.fn(() => true);
    const coalescedEmitter = {
      ...emitter,
      draft: vi.fn(),
      draftDelta: vi.fn(),
    };
    const burstHandler = createStreamingEventHandler({
      emitter: coalescedEmitter,
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      includeDraftFull,
      displayUpdateIntervalMs: 25,
    });

    burstHandler({ type: "message_update", assistantMessageEvent: { type: "text_start" } } as any);
    burstHandler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "a" } } as any);
    burstHandler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "b" } } as any);
    burstHandler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "c" } } as any);

    expect(coalescedEmitter.draft).not.toHaveBeenCalled();
    expect(coalescedEmitter.draftDelta).toHaveBeenCalledTimes(1);
    expect(coalescedEmitter.draftDelta).toHaveBeenLastCalledWith(expect.objectContaining({ reset: true, delta: "" }));

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(coalescedEmitter.draft).toHaveBeenCalledTimes(1);
    expect(coalescedEmitter.draft).toHaveBeenLastCalledWith(expect.objectContaining({ text: "abc" }));
    expect(coalescedEmitter.draftDelta).toHaveBeenCalledTimes(2);
    expect(coalescedEmitter.draftDelta).toHaveBeenLastCalledWith(expect.objectContaining({ delta: "abc" }));
    const resetOrder = coalescedEmitter.draftDelta.mock.invocationCallOrder[0];
    const snapshotOrder = coalescedEmitter.draft.mock.invocationCallOrder[0];
    const deltaOrder = coalescedEmitter.draftDelta.mock.invocationCallOrder[1];
    expect(resetOrder).toBeLessThan(snapshotOrder);
    expect(snapshotOrder).toBeLessThan(deltaOrder);
  });

  it("bounds a dense mixed display burst without losing final Draft or Thought text", async () => {
    const { handler, emitter, statuses } = makeHandler(undefined, true, 20, true);

    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } } as any);
    for (let index = 0; index < 200; index += 1) {
      handler({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: `t${index},` } } as any);
    }
    handler({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "" } } as any);
    handler({ type: "message_update", assistantMessageEvent: { type: "text_start" } } as any);
    for (let index = 0; index < 200; index += 1) {
      handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `d${index},` } } as any);
    }
    handler({ type: "message_end", message: { role: "assistant", stopReason: "stop" } } as any);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const thoughtDeltaText = emitter.thoughtDelta.mock.calls.map(([payload]) => payload.delta || "").join("");
    const draftDeltaText = emitter.draftDelta.mock.calls.map(([payload]) => payload.delta || "").join("");
    expect(thoughtDeltaText).toBe(Array.from({ length: 200 }, (_, index) => `t${index},`).join(""));
    expect(draftDeltaText).toBe(Array.from({ length: 200 }, (_, index) => `d${index},`).join(""));
    expect(emitter.thought.mock.calls.length).toBeLessThan(10);
    expect(emitter.thoughtDelta.mock.calls.length).toBeLessThan(10);
    expect(emitter.draft.mock.calls.length).toBeLessThan(10);
    expect(emitter.draftDelta.mock.calls.length).toBeLessThan(10);
    expect(statuses.filter((payload) => payload.type === "thinking")).toHaveLength(2);
  });

  it("flushes the latest coalesced tool output before the tool completion lifecycle status", () => {
    const { handler, statuses } = makeHandler(undefined, false, 1000);

    handler({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "run" } } as any);
    handler({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "run" },
      partialResult: { content: [{ type: "text", text: "first" }] },
    } as any);
    handler({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "run" },
      partialResult: { content: [{ type: "text", text: "latest" }] },
    } as any);

    expect(statuses).toHaveLength(1);

    handler({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "bash", isError: false } as any);

    expect(statuses).toHaveLength(3);
    expect(statuses[1]).toMatchObject({ type: "tool_status", output_preview: "latest" });
    expect(statuses[2]).toMatchObject({ type: "waiting", last_completed_tool: expect.objectContaining({ tool_call_id: "tool-1" }) });
  });
});

describe("web SSE MCP tool identity", () => {
  it("includes the MCP server, selected tool, operation, and readable title", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "tool_execution_start",
      toolCallId: "tool-mcp-1",
      toolName: "mcp",
      args: { server: "memento", tool: "memory_search", args: { query: "draft metadata" } },
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "tool_call",
      title: "mcp: memento → memory_search",
      tool_name: "mcp",
      mcp_operation: "call",
      mcp_server: "memento",
      mcp_tool: "memory_search",
      mcp_target: "memory_search",
    });
    expect(statuses[0].active_tools).toContainEqual(expect.objectContaining({
      title: "mcp: memento → memory_search",
      mcp_server: "memento",
      mcp_tool: "memory_search",
    }));

    handler({
      type: "tool_execution_update",
      toolCallId: "tool-mcp-1",
      toolName: "mcp",
      partialResult: { content: [{ type: "text", text: "searching" }] },
    } as any);
    handler({ type: "tool_execution_end", toolCallId: "tool-mcp-1", toolName: "mcp", isError: false } as any);

    expect(statuses[1]).toMatchObject({
      type: "tool_status",
      title: "mcp: memento → memory_search",
      mcp_server: "memento",
      mcp_tool: "memory_search",
      output_preview: "searching",
    });
    expect(statuses[2]).toMatchObject({
      type: "waiting",
      last_completed_tool: expect.objectContaining({
        title: "mcp: memento → memory_search",
        mcp_server: "memento",
        mcp_tool: "memory_search",
      }),
    });
  });
});

describe("web SSE thinking level events", () => {
  it("reports legacy raw levels with their display labels", () => {
    const { handler, emitter } = makeHandler((level) => level === "xhigh" ? "max" : level);

    handler({ type: "thinking_level_changed", level: "xhigh" } as any);

    expect(emitter.modelChanged).toHaveBeenCalledWith(expect.objectContaining({
      thinking_level: "xhigh",
      thinking_level_label: "max",
    }));
  });
});

describe("web SSE provider retry events", () => {
  it("includes the selected model in rate-limit retry status", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "model_select",
      model: { provider: "azure-openai", id: "gpt-5-4" },
    } as any);
    handler({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 30000,
      errorMessage: "Azure OpenAI API error (429): RateLimitReached. Retry-After: 30",
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "intent",
      title: "Rate limited (HTTP 429) on azure-openai/gpt-5-4 — retrying (attempt 1/3, 30s delay)",
    });
    expect(String(statuses[0].detail)).toContain("model: azure-openai/gpt-5-4");
  });

  it("includes the selected model when the rate-limit retry budget is exhausted", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "model_select",
      model: { provider: "azure-openai", id: "gpt-5-4" },
    } as any);
    handler({
      type: "auto_retry_end",
      success: false,
      finalError: "Azure OpenAI error: Retry budget exhausted. Azure rate limit exceeded. Wait about 30s before retrying.",
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "error",
      title: "Rate limited (HTTP 429) on azure-openai/gpt-5-4 — retry budget exhausted",
    });
  });

  it("renders OAuth refresh 5xx retries as bounded server errors without HTML response bodies", () => {
    const { handler, statuses } = makeHandler();
    const raw = [
      "OAuth refresh failed for github-copilot: 502 Bad Gateway: ",
      "<!DOCTYPE html><html><head><title>Unicorn! &middot; GitHub</title>",
      "<style>body { color: red; }</style></head><body>",
      `<img src="data:image/png;base64,${"A".repeat(2048)}">`,
      "</body></html>",
    ].join("");

    handler({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2_000,
      errorMessage: raw,
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "intent",
      title: "GitHub Copilot server error — retrying (attempt 1/3, 2s delay)",
      classifier: "network",
      failure_category: "network",
    });
    const rendered = JSON.stringify(statuses[0]);
    expect(rendered).toContain("502 Bad Gateway");
    expect(rendered).not.toContain("<!DOCTYPE");
    expect(rendered).not.toContain("<style>");
    expect(rendered).not.toContain("base64");
    expect(rendered).not.toContain("Unicorn!");
  });
});

describe("web SSE summarization retry events", () => {
  it("surfaces compaction and branch-summary retry lifecycle", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "summarization_retry_scheduled",
      source: "compaction",
      reason: "overflow",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 1500,
      errorMessage: "socket connection was closed",
    } as any);
    handler({
      type: "summarization_retry_attempt_start",
      source: "branchSummary",
    } as any);
    handler({ type: "summarization_retry_finished" } as any);

    expect(statuses[0]).toMatchObject({
      type: "intent",
      title: "Retrying compaction summary (attempt 2/3, 2s delay)",
      detail: "socket connection was closed",
      intent_key: "summarization_retry",
      source: "compaction",
      reason: "overflow",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 1500,
    });
    expect(statuses[1]).toMatchObject({
      type: "intent",
      title: "Retrying branch summary now",
      intent_key: "summarization_retry",
      source: "branchSummary",
    });
    expect(statuses[2]).toMatchObject({
      type: "intent",
      title: "Summary retry finished",
      intent_key: "summarization_retry",
    });
  });
});

describe("web SSE agent compaction events", () => {
  it("includes structured Piclaw trigger fields on compaction start and end", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "compaction_start",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      source: "pre_prompt_auto_compaction",
      chatJid: "web:test",
    } as any);
    handler({
      type: "compaction_end",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      aborted: false,
      source: "pre_prompt_auto_compaction",
      chatJid: "web:test",
      tokensBefore: 100_000,
      estimatedTokensAfter: 40_000,
      estimatedTokensAfterSource: "upstream",
      safetyAdjustedTokensAfter: 46_000,
      reductionPercent: 60,
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "intent",
      title: "Smart compaction",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      source: "pre_prompt_auto_compaction",
      chatJid: "web:test",
    });
    expect(statuses[1]).toMatchObject({
      type: "intent",
      title: "Smart compaction complete",
      reason: "threshold",
      trigger: "pre_prompt",
      piclawReason: "pre_prompt",
      willRetry: false,
      aborted: false,
      tokensBefore: 100_000,
      estimatedTokensAfter: 40_000,
      estimatedTokensAfterSource: "upstream",
      safetyAdjustedTokensAfter: 46_000,
      reductionPercent: 60,
    });
    expect(String(statuses[1].detail)).toContain("Compaction result estimate");
  });

  it("uses willRetry as the retry status source for recovery compaction", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "compaction_end",
      reason: "overflow",
      trigger: "recovery",
      piclawReason: "recovery",
      willRetry: true,
      aborted: false,
      source: "automatic_recovery",
      tokensBefore: 120_000,
      estimatedTokensAfter: 60_000,
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "intent",
      title: "Retrying after auto-compaction",
      reason: "overflow",
      trigger: "recovery",
      piclawReason: "recovery",
      willRetry: true,
      aborted: false,
      source: "automatic_recovery",
    });
  });

  it("keeps context usage as a separate fresh estimate payload", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "context_usage_update",
      tokens: 42_000,
      contextWindow: 128_000,
      percent: 32.8,
      estimated: true,
      source: "compaction",
      phase: "after_threshold_compaction",
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "context_usage",
      context_usage: {
        tokens: 42_000,
        contextWindow: 128_000,
        percent: 32.8,
        estimated: true,
        source: "compaction",
        phase: "after_threshold_compaction",
      },
    });
  });

  it("marks compaction suppression as non-retry structured compaction telemetry", () => {
    const { handler, statuses } = makeHandler();

    handler({
      type: "compaction_suppressed",
      reason: "previous_failure",
      failureCount: 2,
      detail: "provider body with secret-token",
      errorMessage: "Compaction timed out with secret-token",
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "intent",
      title: "Compaction temporarily suppressed",
      reason: "previous_failure",
      willRetry: false,
      detail: "Automatic compaction is paused after 2 recent failures.",
    });
    expect(JSON.stringify(statuses[0])).not.toContain("secret-token");
  });
});

describe("web SSE recovery events", () => {
  it("does not expose provider diagnostics when bounded recovery is exhausted", () => {
    const { handler, statuses } = makeHandler();
    const sensitiveDiagnostic = "provider payload: secret-token timeout stack";

    handler({
      type: "recovery_end",
      outcome: "exhausted",
      attemptsUsed: 2,
      classifier: "timeout",
      errorMessage: sensitiveDiagnostic,
    } as any);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      type: "error",
      title: "Automatic recovery exhausted",
      detail: "The bounded recovery path ended without a terminal reply.",
      classifier: "timeout",
    });
    expect(JSON.stringify(statuses[0])).not.toContain(sensitiveDiagnostic);
  });

  it("sanitizes recovery-start reasons and errors", () => {
    const { handler, statuses } = makeHandler();
    const sensitiveDiagnostic = "provider payload: secret-token raw body";

    handler({
      type: "recovery_start",
      strategy: "retry",
      attempt: 1,
      maxAttempts: 2,
      classifier: "unknown",
      reason: sensitiveDiagnostic,
      errorMessage: sensitiveDiagnostic,
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "intent",
      title: "Recovering interrupted response",
      classifier: "unknown",
    });
    expect(JSON.stringify(statuses[0])).not.toContain(sensitiveDiagnostic);
  });

  it("whitelists compaction telemetry without forwarding summaries or errors", () => {
    const { handler, statuses } = makeHandler();
    const sensitiveDiagnostic = "summary with tool output and secret-token";

    handler({
      type: "compaction_end",
      reason: "overflow",
      trigger: "recovery",
      errorMessage: sensitiveDiagnostic,
      result: { summary: sensitiveDiagnostic, tokensBefore: 100, estimatedTokensAfter: 50 },
    } as any);

    expect(statuses[0]).toMatchObject({
      type: "error",
      title: "Compaction failed",
      tokensBefore: 100,
      estimatedTokensAfter: 50,
    });
    expect(JSON.stringify(statuses[0])).not.toContain(sensitiveDiagnostic);
    expect(statuses[0]).not.toHaveProperty("result");
    expect(statuses[0]).not.toHaveProperty("errorMessage");
  });
});
