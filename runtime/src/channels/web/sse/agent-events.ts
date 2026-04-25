/**
 * web/agent-events.ts – Transforms pi-agent session events into SSE broadcasts.
 *
 * Subscribes to the agent session's event stream and translates events
 * (text deltas, tool calls, message completions) into SSE payloads for the
 * web UI. Also manages draft/thought buffer accumulation and auto-compaction
 * status broadcasts.
 *
 * Consumers: channels/web.ts wires this up during agent runs.
 */

import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { buildPreview, createToolTitleTracker, type AgentProfileBuilder } from "../agent/agent-utils.js";

/** Interface for broadcasting agent events to SSE clients. */
export interface AgentEventEmitter {
  status: (payload: Record<string, unknown>) => void;
  thought: (payload: Record<string, unknown>) => void;
  thoughtDelta: (payload: Record<string, unknown>) => void;
  draft: (payload: Record<string, unknown>) => void;
  draftDelta: (payload: Record<string, unknown>) => void;
  response: (payload: object) => void;
  generatedWidgetOpen: (payload: Record<string, unknown>) => void;
  generatedWidgetDelta: (payload: Record<string, unknown>) => void;
  generatedWidgetFinal: (payload: Record<string, unknown>) => void;
  generatedWidgetClose: (payload: Record<string, unknown>) => void;
  generatedWidgetError: (payload: Record<string, unknown>) => void;
}

/** Create an AgentEventEmitter that broadcasts via the given SSE hub. */
export function createAgentEventEmitter(
  channel: WebChannelLike,
  withAgentProfile: AgentProfileBuilder
): AgentEventEmitter {
  return {
    status: (payload) => channel.broadcastEvent("agent_status", withAgentProfile(payload)),
    thought: (payload) => channel.broadcastEvent("agent_thought", withAgentProfile(payload)),
    thoughtDelta: (payload) => channel.broadcastEvent("agent_thought_delta", withAgentProfile(payload)),
    draft: (payload) => channel.broadcastEvent("agent_draft", withAgentProfile(payload)),
    draftDelta: (payload) => channel.broadcastEvent("agent_draft_delta", withAgentProfile(payload)),
    response: (payload) => channel.broadcastEvent("agent_response", withAgentProfile(payload)),
    generatedWidgetOpen: (payload) => channel.broadcastEvent("generated_widget_open", withAgentProfile(payload)),
    generatedWidgetDelta: (payload) => channel.broadcastEvent("generated_widget_delta", withAgentProfile(payload)),
    generatedWidgetFinal: (payload) => channel.broadcastEvent("generated_widget_final", withAgentProfile(payload)),
    generatedWidgetClose: (payload) => channel.broadcastEvent("generated_widget_close", withAgentProfile(payload)),
    generatedWidgetError: (payload) => channel.broadcastEvent("generated_widget_error", withAgentProfile(payload)),
  };
}

function readJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : null;
}

function readWidgetString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function readWidgetNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildGeneratedWidgetPayload(
  args: unknown,
  base: Record<string, unknown>,
  defaults?: { toolCallId?: string | null; widgetId?: string | null; status?: string; error?: string | null }
): Record<string, unknown> {
  const record = readJsonRecord(args) ?? {};
  const artifactRecord = readJsonRecord(record.artifact) ?? {};
  const svg = readWidgetString(artifactRecord.svg, record.svg);
  const html = readWidgetString(artifactRecord.html, record.html, record.w, record.content);
  const requestedKind = readWidgetString(artifactRecord.kind, record.kind);
  const kind = requestedKind === "svg" || (!!svg && requestedKind !== "html") ? "svg" : "html";
  const title = readWidgetString(record.title, record.name) || "Generated widget";
  const subtitle = readWidgetString(record.subtitle) || "";
  const description = readWidgetString(record.description) || subtitle;
  const toolCallId = readWidgetString(record.tool_call_id, record.toolCallId, defaults?.toolCallId) || null;
  const widgetId = readWidgetString(record.widget_id, record.widgetId, defaults?.widgetId, toolCallId) || null;
  const status = readWidgetString(record.status, defaults?.status) || (html || svg ? "streaming" : "loading");
  const payload: Record<string, unknown> = {
    ...base,
    tool_call_id: toolCallId,
    widget_id: widgetId,
    title,
    subtitle,
    description,
    status,
    artifact: {
      kind,
      ...(kind === "svg" ? (svg ? { svg } : {}) : (html ? { html } : {})),
    },
  };

  const width = readWidgetNumber(record.width);
  const height = readWidgetNumber(record.height);
  if (width !== null) payload.width = width;
  if (height !== null) payload.height = height;
  if (defaults?.error) payload.error = defaults.error;
  return payload;
}

/** Options for the streaming event handler: emitter, callbacks, buffers. */
export interface StreamingEventHandlerOptions {
  emitter: AgentEventEmitter;
  agentId: string;
  threadId: string;
  turnId: string;
  thoughtPreviewLines?: number;
  draftPreviewLines?: number;
  previewMaxCharsPerLine?: number;
  includeThoughtFull?: () => boolean;
  includeDraftFull?: () => boolean;
  onThoughtBuffer?: (text: string, totalLines: number) => void;
  onDraftBuffer?: (text: string, totalLines: number) => void;
}

/** Create an event handler that translates agent session events to SSE broadcasts. */
export function createStreamingEventHandler(options: StreamingEventHandlerOptions): (event: AgentSessionEvent) => void {
  const thoughtPreviewLines = options.thoughtPreviewLines ?? 8;
  const draftPreviewLines = options.draftPreviewLines ?? 8;
  const previewMaxCharsPerLine = options.previewMaxCharsPerLine ?? 160;

  let thoughtBuffer = "";
  let draftBuffer = "";
  let thoughtHasDelta = false;
  let thoughtDeltaActive = false;
  let draftDeltaActive = false;
  const { remember, lookup, forget } = createToolTitleTracker();
  const toolExecutionContext = new Map<string, { toolName: string; args: unknown }>();
  const widgetStreams = new Map<number, { toolCallId: string | null; widgetId: string | null }>();

  const base = {
    thread_id: options.threadId,
    agent_id: options.agentId,
    turn_id: options.turnId,
  };

  const isRateLimitError = (message?: string): boolean => {
    if (!message) return false;
    return /429|rate.?limit|too many requests|requests per minute|tokens per minute|rpm|tpm/i.test(message);
  };

  const describeRateLimit = (message?: string): string => {
    const lower = (message || "").toLowerCase();
    const hasTpm = /(tpm|tokens per minute|token per minute)/.test(lower);
    const hasRpm = /(rpm|requests per minute|request per minute)/.test(lower);
    if (hasTpm && hasRpm) return "Rate limited (TPM/RPM)";
    if (hasTpm) return "Rate limited (TPM)";
    if (hasRpm) return "Rate limited (RPM)";
    return "Rate limited (HTTP 429)";
  };

  let pendingRateLimit: { message: string } | null = null;
  let pendingRateLimitTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRateLimitIntent = () => {
    if (pendingRateLimitTimer) return;
    pendingRateLimitTimer = setTimeout(() => {
      if (!pendingRateLimit) {
        pendingRateLimitTimer = null;
        return;
      }
      const detail = pendingRateLimit.message;
      options.emitter.status({
        ...base,
        type: "intent",
        title: describeRateLimit(detail),
        detail,
      });
      pendingRateLimit = null;
      pendingRateLimitTimer = null;
    }, 0);
  };

  return (event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      const messageEvent = event.assistantMessageEvent;
      if (messageEvent.type === "thinking_start") {
        thoughtBuffer = "";
        thoughtHasDelta = false;
        thoughtDeltaActive = false;
        if (options.includeThoughtFull?.()) {
          thoughtDeltaActive = true;
          options.emitter.thoughtDelta({
            ...base,
            delta: "",
            reset: true,
          });
        }
      }
      if (messageEvent.type === "thinking_delta") {
        thoughtBuffer += messageEvent.delta;
        thoughtHasDelta = true;
        const { preview, totalLines } = buildPreview(
          thoughtBuffer,
          thoughtPreviewLines,
          previewMaxCharsPerLine
        );
        options.onThoughtBuffer?.(thoughtBuffer, totalLines);
        options.emitter.thought({
          ...base,
          text: preview,
          total_lines: totalLines,
        });
        const shouldSendDelta = Boolean(options.includeThoughtFull?.());
        if (shouldSendDelta && !thoughtDeltaActive) {
          thoughtDeltaActive = true;
          options.emitter.thoughtDelta({
            ...base,
            delta: thoughtBuffer,
            reset: true,
          });
        } else if (shouldSendDelta) {
          options.emitter.thoughtDelta({
            ...base,
            delta: messageEvent.delta,
          });
        } else {
          thoughtDeltaActive = false;
        }
      }
      if (messageEvent.type === "thinking_end") {
        thoughtBuffer = messageEvent.content || thoughtBuffer;
        const { preview, totalLines } = buildPreview(
          thoughtBuffer,
          thoughtPreviewLines,
          previewMaxCharsPerLine
        );
        options.onThoughtBuffer?.(thoughtBuffer, totalLines);
        options.emitter.thought({
          ...base,
          text: preview,
          total_lines: totalLines,
        });
        const shouldSendDelta = Boolean(options.includeThoughtFull?.());
        if (shouldSendDelta && !thoughtHasDelta) {
          thoughtDeltaActive = true;
          options.emitter.thoughtDelta({
            ...base,
            delta: thoughtBuffer,
            reset: true,
          });
        } else if (!shouldSendDelta) {
          thoughtDeltaActive = false;
        }
      }
      if (messageEvent.type === "toolcall_start") {
        const partial: any = messageEvent.partial;
        const block = partial?.content?.[messageEvent.contentIndex];
        if (block?.type === "toolCall" && block?.name === "show_widget") {
          const toolCallId = readWidgetString(block?.id) || null;
          const payload = buildGeneratedWidgetPayload(block?.arguments, base, {
            toolCallId,
            widgetId: `widget-${options.turnId}-${messageEvent.contentIndex}`,
          });
          widgetStreams.set(messageEvent.contentIndex, {
            toolCallId: readWidgetString(payload.tool_call_id) || toolCallId,
            widgetId: readWidgetString(payload.widget_id),
          });
          options.emitter.generatedWidgetOpen(payload);
        }
      }
      if (messageEvent.type === "toolcall_delta") {
        const partial: any = messageEvent.partial;
        const block = partial?.content?.[messageEvent.contentIndex];
        const prior = widgetStreams.get(messageEvent.contentIndex);
        if ((block?.type === "toolCall" && block?.name === "show_widget") || prior) {
          const toolCallId = readWidgetString(block?.id, prior?.toolCallId) || null;
          const payload = buildGeneratedWidgetPayload(block?.arguments, base, {
            toolCallId,
            widgetId: prior?.widgetId || `widget-${options.turnId}-${messageEvent.contentIndex}`,
            status: "streaming",
          });
          widgetStreams.set(messageEvent.contentIndex, {
            toolCallId: readWidgetString(payload.tool_call_id) || toolCallId,
            widgetId: readWidgetString(payload.widget_id) || prior?.widgetId || null,
          });
          options.emitter.generatedWidgetDelta(payload);
        }
      }
      if (messageEvent.type === "toolcall_end") {
        const title = remember(
          messageEvent.toolCall.id,
          messageEvent.toolCall.name,
          messageEvent.toolCall.arguments
        );
        if (messageEvent.toolCall.name === "show_widget") {
          const payload = buildGeneratedWidgetPayload(messageEvent.toolCall.arguments, base, {
            toolCallId: messageEvent.toolCall.id,
            widgetId: messageEvent.toolCall.id,
            status: "final",
          });
          options.emitter.generatedWidgetFinal(payload);
          for (const [contentIndex, state] of widgetStreams.entries()) {
            if (state.toolCallId === messageEvent.toolCall.id) {
              widgetStreams.delete(contentIndex);
              break;
            }
          }
        }
        toolExecutionContext.set(messageEvent.toolCall.id, {
          toolName: messageEvent.toolCall.name,
          args: messageEvent.toolCall.arguments,
        });
        options.emitter.status({
          ...base,
          type: "tool_call",
          title,
          tool_name: messageEvent.toolCall.name,
          tool_args: messageEvent.toolCall.arguments,
        });
      }
      if (messageEvent.type === "text_start") {
        draftBuffer = "";
        draftDeltaActive = false;
        options.onDraftBuffer?.(draftBuffer, 0);
        options.emitter.draft({
          ...base,
          text: "",
          total_lines: 0,
          kind: "draft",
          mode: "replace",
        });
        if (options.includeDraftFull?.()) {
          draftDeltaActive = true;
          options.emitter.draftDelta({
            ...base,
            delta: "",
            reset: true,
          });
        }
      }
      if (messageEvent.type === "text_delta") {
        draftBuffer += messageEvent.delta;
        const { preview, totalLines } = buildPreview(
          draftBuffer,
          draftPreviewLines,
          previewMaxCharsPerLine
        );
        options.onDraftBuffer?.(draftBuffer, totalLines);
        options.emitter.draft({
          ...base,
          text: preview,
          total_lines: totalLines,
          kind: "draft",
          mode: "replace",
        });
        const shouldSendDelta = Boolean(options.includeDraftFull?.());
        if (shouldSendDelta && !draftDeltaActive) {
          draftDeltaActive = true;
          options.emitter.draftDelta({
            ...base,
            delta: draftBuffer,
            reset: true,
          });
        } else if (shouldSendDelta) {
          options.emitter.draftDelta({
            ...base,
            delta: messageEvent.delta,
          });
        } else {
          draftDeltaActive = false;
        }
      }
    }

    if (event.type === "tool_execution_start") {
      const title = remember(event.toolCallId, event.toolName, event.args);
      toolExecutionContext.set(event.toolCallId, { toolName: event.toolName, args: event.args });
      options.emitter.status({
        ...base,
        type: "tool_call",
        title,
        tool_name: event.toolName,
        tool_args: event.args,
      });
    }

    if (event.type === "tool_execution_update") {
      const title = lookup(event.toolCallId, event.toolName, event.args);
      toolExecutionContext.set(event.toolCallId, { toolName: event.toolName, args: event.args });
      options.emitter.status({
        ...base,
        type: "tool_status",
        title,
        status: "Working...",
        tool_name: event.toolName,
        tool_args: event.args,
      });
    }

    if (event.type === "tool_execution_end") {
      const title = lookup(event.toolCallId, event.toolName);
      const toolContext = toolExecutionContext.get(event.toolCallId) || null;
      if (event.toolName === "show_widget" && event.isError) {
        let matchedState: { toolCallId: string | null; widgetId: string | null } | null = null;
        for (const [contentIndex, state] of widgetStreams.entries()) {
          if (state.toolCallId === event.toolCallId) {
            matchedState = state;
            widgetStreams.delete(contentIndex);
            break;
          }
        }
        options.emitter.generatedWidgetError({
          ...base,
          tool_call_id: event.toolCallId,
          widget_id: matchedState?.widgetId || event.toolCallId,
          title: "Generated widget",
          subtitle: "",
          description: "",
          status: "error",
          error: "Widget generation failed.",
          artifact: { kind: "html" },
        });
      }
      forget(event.toolCallId);
      options.emitter.status({
        ...base,
        type: "tool_status",
        title,
        status: event.isError ? "Failed" : "Done",
        tool_name: toolContext?.toolName || event.toolName,
        tool_args: toolContext?.args,
      });
      toolExecutionContext.delete(event.toolCallId);
    }

    if (event.type === "message_end") {
      const message = event.message as { role?: string; stopReason?: string; errorMessage?: string };
      if (message?.role === "assistant" && message.stopReason === "error" && isRateLimitError(message.errorMessage)) {
        pendingRateLimit = { message: message.errorMessage || "429" };
        scheduleRateLimitIntent();
      }
    }

    // Surface provider/API errors and retries so the user sees what's happening
    // instead of silent waiting. These events are emitted by the upstream
    // agent-session for any provider (not just Azure).
    if (event.type === "auto_retry_start") {
      const e = event as { attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string };
      const delaySec = e.delayMs ? Math.round(e.delayMs / 1000) : "?";
      const errorMessage = e.errorMessage || "";
      const isRateLimit = isRateLimitError(errorMessage);
      if (isRateLimit) {
        pendingRateLimit = null;
        if (pendingRateLimitTimer) {
          clearTimeout(pendingRateLimitTimer);
          pendingRateLimitTimer = null;
        }
      }
      const title = isRateLimit
        ? `${describeRateLimit(errorMessage)} — retrying (attempt ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"}, ${delaySec}s delay)`
        : `Retrying after error (attempt ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"}, ${delaySec}s delay)`;
      options.emitter.status({
        ...base,
        type: "intent",
        title,
        detail: errorMessage || undefined,
      });
    }

    if (event.type === "auto_retry_end") {
      const e = event as { success?: boolean; attempt?: number; finalError?: string };
      if (!e.success) {
        const finalError = e.finalError || "Request failed after retries";
        const title = isRateLimitError(finalError)
          ? `${describeRateLimit(finalError)} — retry budget exhausted`
          : finalError;
        options.emitter.status({
          ...base,
          type: "error",
          title,
        });
      }
    }

    if (event.type === "compaction_start") {
      const reason = (event as { reason?: string }).reason;
      const title = reason === "overflow"
        ? "Compacting context"
        : reason === "threshold"
          ? "Smart compaction"
          : "Compacting context";
      const detail = reason === "overflow"
        ? "Recovering from context pressure so the turn can continue."
        : reason === "threshold"
          ? "Shrinking recent context before continuing the turn."
          : undefined;
      options.emitter.status({
        ...base,
        type: "intent",
        title,
        detail,
        intent_key: "compaction",
        started_at: new Date().toISOString(),
      });
    }

    if (event.type === "compaction_end") {
      const e = event as { errorMessage?: string; willRetry?: boolean; aborted?: boolean; reason?: string };
      if (e.errorMessage) {
        options.emitter.status({
          ...base,
          type: "error",
          title: e.errorMessage,
        });
      } else if (e.willRetry) {
        options.emitter.status({
          ...base,
          type: "intent",
          title: "Retrying after auto-compaction",
        });
      } else if (e.aborted) {
        options.emitter.status({
          ...base,
          type: "intent",
          title: e.reason === "manual" ? "Compaction cancelled" : "Auto-compaction cancelled",
        });
      }
    }

    const customEventType = (event as { type?: string }).type;

    if (customEventType === "recovery_start") {
      const e = event as { strategy?: string; attempt?: number; maxAttempts?: number; delayMs?: number; reason?: string };
      const strategy = e.strategy === "compact_then_retry"
        ? "Compacting context and continuing"
        : "Recovering interrupted response";
      const delaySuffix = e.strategy === "retry" && typeof e.delayMs === "number"
        ? ` · ${Math.max(0, Math.round(e.delayMs / 1000))}s delay`
        : "";
      const detail = `Attempt ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"}${delaySuffix}${e.reason ? ` — ${e.reason}` : ""}`;
      options.emitter.status({
        ...base,
        type: "intent",
        title: strategy,
        detail,
        intent_key: "recovery",
        started_at: new Date().toISOString(),
      });
    }

    if (customEventType === "recovery_end") {
      const e = event as { outcome?: string; attemptsUsed?: number; classifier?: string | null; errorMessage?: string };
      if (e.outcome === "recovered") {
        options.emitter.status({
          ...base,
          type: "intent",
          title: "Recovered after automatic continuation",
          detail: `Attempts: ${e.attemptsUsed ?? 0}${e.classifier ? ` · ${e.classifier}` : ""}`,
          intent_key: "recovery",
        });
      } else if (e.outcome === "exhausted") {
        options.emitter.status({
          ...base,
          type: "error",
          title: "Automatic recovery exhausted",
          detail: e.errorMessage || undefined,
          intent_key: "recovery",
        });
      }
    }
  };
}
