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

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { buildPreview, createToolTitleTracker, resolveMcpToolStatusIdentity, type AgentProfileBuilder } from "../agent/agent-utils.js";
import { formatProviderError, sanitizeProviderErrorDetail } from "../handlers/provider-error-format.js";
import { classifyOpaqueAgentFailure } from "../../../agent-pool/automatic-recovery.js";
import { createDisplayUpdateCoalescer } from "./display-update-coalescer.js";

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
  modelChanged: (payload: Record<string, unknown>) => void;
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
    modelChanged: (payload) => channel.broadcastEvent("model_changed", withAgentProfile(payload)),
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

function formatStatusTokenCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.max(0, Math.round(value)));
}

function describeCompactionTokenChange(event: Record<string, unknown>): string | undefined {
  const result = readJsonRecord(event.result);
  const tokensBefore = readWidgetNumber(event.tokensBefore) ?? readWidgetNumber(result?.tokensBefore);
  const estimatedTokensAfter = readWidgetNumber(event.estimatedTokensAfter) ?? readWidgetNumber(result?.estimatedTokensAfter);
  const safetyAdjustedTokensAfter = readWidgetNumber(event.safetyAdjustedTokensAfter);
  const reductionPercent = readWidgetNumber(event.reductionPercent);
  const source = typeof event.estimatedTokensAfterSource === "string" ? event.estimatedTokensAfterSource : null;
  const parts = [
    tokensBefore !== null && estimatedTokensAfter !== null
      ? `Compaction result estimate: ${formatStatusTokenCount(tokensBefore)} → ${formatStatusTokenCount(estimatedTokensAfter)} tokens${source ? ` (${source})` : ""}`
      : estimatedTokensAfter !== null
        ? `Compaction result estimate: ${formatStatusTokenCount(estimatedTokensAfter)} tokens${source ? ` (${source})` : ""}`
        : null,
    reductionPercent !== null ? `${reductionPercent.toFixed(1)}% smaller` : null,
    safetyAdjustedTokensAfter !== null ? `safety-adjusted ${formatStatusTokenCount(safetyAdjustedTokensAfter)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function readAllowedString(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

const SAFE_COMPACTION_REASONS = ["manual", "overflow", "threshold", "idle", "previous_failure"] as const;
const SAFE_COMPACTION_TRIGGERS = ["manual", "recovery", "pre_prompt", "idle"] as const;
const SAFE_COMPACTION_SOURCES = [
  "automatic_recovery", "compaction_recovery", "pre_prompt", "pre_prompt_auto_compaction",
  "idle", "manual",
] as const;
const SAFE_RECOVERY_CLASSIFIERS = [
  "disabled", "budget_exhausted", "auth_config", "recovery_suppressed",
  "stale_progress_watchdog", "session_corruption", "non_recoverable", "tool_activity",
  "completed_turn_output", "context_pressure", "tool_history_pressure", "thinking_only_stop",
  "length_stop", "transient", "compaction_failure", "unknown",
] as const;

function buildCompactionStatusFields(event: Record<string, unknown>): Record<string, unknown> {
  const result = readJsonRecord(event.result);
  const tokensBefore = readWidgetNumber(event.tokensBefore) ?? readWidgetNumber(result?.tokensBefore);
  const estimatedTokensAfter = readWidgetNumber(event.estimatedTokensAfter) ?? readWidgetNumber(result?.estimatedTokensAfter);
  const safetyAdjustedTokensAfter = readWidgetNumber(event.safetyAdjustedTokensAfter);
  const reductionPercent = readWidgetNumber(event.reductionPercent);
  return {
    reason: readAllowedString(event.reason, SAFE_COMPACTION_REASONS),
    trigger: readAllowedString(event.trigger, SAFE_COMPACTION_TRIGGERS),
    piclawReason: readAllowedString(event.piclawReason, SAFE_COMPACTION_TRIGGERS)
      ?? readAllowedString(event.trigger, SAFE_COMPACTION_TRIGGERS),
    willRetry: event.willRetry === true,
    aborted: event.aborted === true,
    skipped: event.skipped === true,
    source: readAllowedString(event.source, SAFE_COMPACTION_SOURCES),
    chatJid: typeof event.chatJid === "string" ? event.chatJid : null,
    ...(typeof event.targetContextWindow === "number" && Number.isFinite(event.targetContextWindow) ? { targetContextWindow: event.targetContextWindow } : {}),
    ...(typeof event.targetModelLabel === "string" ? { targetModelLabel: event.targetModelLabel } : {}),
    ...(tokensBefore !== null ? { tokensBefore } : {}),
    ...(estimatedTokensAfter !== null ? { estimatedTokensAfter } : {}),
    ...(event.estimatedTokensAfterSource === "upstream" || event.estimatedTokensAfterSource === "fallback"
      ? { estimatedTokensAfterSource: event.estimatedTokensAfterSource }
      : {}),
    ...(safetyAdjustedTokensAfter !== null ? { safetyAdjustedTokensAfter } : {}),
    ...(reductionPercent !== null ? { reductionPercent } : {}),
  };
}

function modelLabelFromEventModel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { provider?: unknown; id?: unknown };
  const provider = readWidgetString(record.provider);
  const id = readWidgetString(record.id);
  return provider && id ? `${provider}/${id}` : null;
}

const TOOL_OUTPUT_STATUS_PREVIEW_BYTES = 12 * 1024;
const TOOL_OUTPUT_STATUS_PREVIEW_LINES = 100;

function readToolOutputText(result: unknown): string {
  const record = readJsonRecord(result);
  const content = Array.isArray(record?.content) ? record.content : [];
  return content
    .map((block) => {
      const item = readJsonRecord(block);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildToolOutputStatusPreview(result: unknown): Record<string, unknown> {
  const text = readToolOutputText(result).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text) return {};

  const allLines = text.split("\n");
  const lineTrimmed = allLines.length > TOOL_OUTPUT_STATUS_PREVIEW_LINES;
  const lineWindow = lineTrimmed ? allLines.slice(-TOOL_OUTPUT_STATUS_PREVIEW_LINES).join("\n") : text;
  const buffer = Buffer.from(lineWindow, "utf8");
  const byteTrimmed = buffer.length > TOOL_OUTPUT_STATUS_PREVIEW_BYTES;
  const preview = byteTrimmed
    ? buffer.subarray(buffer.length - TOOL_OUTPUT_STATUS_PREVIEW_BYTES).toString("utf8")
    : lineWindow;
  const details = readJsonRecord(result)?.details as Record<string, unknown> | undefined;

  return {
    output_preview: preview,
    output_total_lines: allLines.length,
    output_preview_lines: preview ? preview.split("\n").length : 0,
    output_truncated: lineTrimmed || byteTrimmed || Boolean(details?.truncation),
    ...(typeof details?.fullOutputPath === "string" ? { full_output_path: details.fullOutputPath } : {}),
  };
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
  formatThinkingLevel?: (level: string) => string;
  onThoughtBuffer?: (text: string, totalLines: number) => void;
  onThinkingComplete?: (text: string, totalLines: number, durationMs: number) => void;
  onDraftBuffer?: (text: string, totalLines: number) => void;
  /** Maximum display-update cadence. Set to 0 in synchronous unit tests. */
  displayUpdateIntervalMs?: number;
}

/** Callable streaming handler with an explicit display flush for lifecycle ordering. */
export interface StreamingEventHandler {
  (event: AgentSessionEvent): void;
  flushDisplayUpdates(): void;
}

/** Create an event handler that translates agent session events to SSE broadcasts. */
export function createStreamingEventHandler(options: StreamingEventHandlerOptions): StreamingEventHandler {
  const thoughtPreviewLines = options.thoughtPreviewLines ?? 8;
  const draftPreviewLines = options.draftPreviewLines ?? 8;
  const previewMaxCharsPerLine = options.previewMaxCharsPerLine ?? 160;
  const displayUpdateIntervalMs = Math.max(0, options.displayUpdateIntervalMs ?? 100);

  let thoughtBuffer = "";
  let thoughtSegmentBuffer = "";
  let thoughtSegmentPrefix = "";
  let thoughtStartedAt = 0;
  let draftBuffer = "";
  let thoughtHasDelta = false;
  let thoughtDeltaActive = false;
  let draftDeltaActive = false;
  const { remember, lookup, forget } = createToolTitleTracker();
  type ActiveToolStatus = {
    toolCallId: string;
    toolName: string;
    title: string;
    args: unknown;
    startedAt: string;
    lastProgressAt: string;
    heartbeatAt: string;
    status: string;
    output: Record<string, unknown>;
  };
  const toolExecutionContext = new Map<string, { toolName: string; args: unknown }>();
  const toolStartedAt = new Map<string, string>();
  const activeToolStatuses = new Map<string, ActiveToolStatus>();
  const widgetStreams = new Map<number, { toolCallId: string | null; widgetId: string | null }>();
  const displayUpdates = createDisplayUpdateCoalescer({
    intervalMs: displayUpdateIntervalMs,
    // Keep the established snapshot-before-delta wire order. Current clients
    // ignore bounded snapshots after full-delta mode starts; older clients can
    // still use snapshots while full-delta clients append the ordered batch.
    order: ["thought-snapshot", "thought-delta", "draft-snapshot", "draft-delta", "tool-status"],
  });
  const flushDisplayUpdates = () => displayUpdates.flush();

  const emitThoughtSnapshot = (payload: Record<string, unknown>) =>
    displayUpdates.queue("thought-snapshot", payload, options.emitter.thought);
  const emitThoughtDelta = (payload: Record<string, unknown>) => payload.reset
    ? displayUpdates.emitImmediate(payload, options.emitter.thoughtDelta)
    : displayUpdates.queue("thought-delta", payload, options.emitter.thoughtDelta, { mergeDelta: true });
  const emitDraftSnapshot = (payload: Record<string, unknown>) =>
    displayUpdates.queue("draft-snapshot", payload, options.emitter.draft);
  const emitDraftDelta = (payload: Record<string, unknown>) => payload.reset
    ? displayUpdates.emitImmediate(payload, options.emitter.draftDelta)
    : displayUpdates.queue("draft-delta", payload, options.emitter.draftDelta, { mergeDelta: true });

  const withMcpStatusIdentity = (toolName: string, args: unknown): Record<string, unknown> => {
    const identity = resolveMcpToolStatusIdentity(toolName, args);
    if (!identity) return {};
    return {
      mcp_operation: identity.operation,
      mcp_server: identity.server,
      mcp_tool: identity.tool,
      mcp_target: identity.target,
    };
  };

  const toActiveToolSnapshot = (state: ActiveToolStatus): Record<string, unknown> => ({
    tool_call_id: state.toolCallId,
    tool_name: state.toolName,
    title: state.title,
    tool_args: state.args,
    ...withMcpStatusIdentity(state.toolName, state.args),
    status: state.status,
    started_at: state.startedAt,
    last_progress_at: state.lastProgressAt,
    heartbeat_at: state.heartbeatAt,
    ...state.output,
  });

  const emitActiveToolStatus = (
    state: ActiveToolStatus,
    extra: Record<string, unknown> = {},
    coalesce = false,
  ) => {
    const activeTools = Array.from(activeToolStatuses.values()).map(toActiveToolSnapshot);
    const payload = {
      ...base,
      type: state.output.output_preview ? "tool_status" : "tool_call",
      title: state.title,
      status: state.status,
      tool_call_id: state.toolCallId,
      tool_name: state.toolName,
      tool_args: state.args,
      ...withMcpStatusIdentity(state.toolName, state.args),
      started_at: state.startedAt,
      last_event_at: state.heartbeatAt || state.lastProgressAt,
      last_progress_at: state.lastProgressAt,
      heartbeat_at: state.heartbeatAt,
      active_tool_count: activeTools.length,
      active_tools: activeTools,
      ...state.output,
      ...extra,
    };
    if (coalesce) displayUpdates.queue("tool-status", payload, options.emitter.status);
    else displayUpdates.emitImmediate(payload, options.emitter.status);
  };

  const base = {
    thread_id: options.threadId,
    agent_id: options.agentId,
    turn_id: options.turnId,
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

  const describeNetworkError = (message?: string): string => {
    if (!message) return "Network error";
    if (/ENOTFOUND|getaddrinfo|dns/i.test(message)) return "DNS lookup failed";
    if (/ECONNREFUSED|connection.*refused/i.test(message)) return "Connection refused";
    if (/ETIMEDOUT|timed? out/i.test(message)) return "Connection timed out";
    if (/ECONNRESET|connection.*(?:ended|closed)|websocket.*(?:closed|ended|1006)|socket hang up/i.test(message)) return "Connection closed";
    if (/fetch failed/i.test(message)) return "Network request failed";
    return "Network error";
  };

  let pendingRateLimit: { message: string } | null = null;
  let pendingRateLimitTimer: ReturnType<typeof setTimeout> | null = null;
  let currentModelLabel: string | null = null;

  const appendModelContext = (detail: string | undefined): string | undefined => {
    if (!currentModelLabel) return detail;
    if (detail?.includes(currentModelLabel)) return detail;
    return [detail, `model: ${currentModelLabel}`].filter(Boolean).join(" — ");
  };

  const rateLimitTitle = (message?: string): string => {
    const baseTitle = describeRateLimit(message);
    return currentModelLabel ? `${baseTitle} on ${currentModelLabel}` : baseTitle;
  };

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
        title: rateLimitTitle(detail),
        detail: appendModelContext(detail),
      });
      pendingRateLimit = null;
      pendingRateLimitTimer = null;
    }, 0);
  };

  const handleStreamingEvent = ((event: AgentSessionEvent) => {
    const eventType = (event as { type?: string }).type;
    const messageUpdateType = event.type === "message_update"
      ? (event.assistantMessageEvent as { type?: string } | undefined)?.type
      : null;
    const isCoalescibleDisplayEvent = messageUpdateType === "thinking_delta"
      || messageUpdateType === "text_delta"
      || eventType === "tool_execution_update";
    if (!isCoalescibleDisplayEvent) flushDisplayUpdates();

    if (eventType === "thinking_level_changed" || eventType === "thinking_level_select") {
      const record = event as { level?: unknown; previousLevel?: unknown; previous_level?: unknown };
      const level = readWidgetString(record.level);
      if (level) {
        const previousLevel = readWidgetString(record.previousLevel, record.previous_level);
        options.emitter.modelChanged({
          ...base,
          thinking_level: level,
          thinking_level_label: options.formatThinkingLevel?.(level) ?? level,
          previous_thinking_level: previousLevel,
          previous_thinking_level_label: previousLevel
            ? (options.formatThinkingLevel?.(previousLevel) ?? previousLevel)
            : null,
        });
      }
    }

    if (eventType === "model_select") {
      const record = event as { model?: unknown; previousModel?: unknown; source?: unknown };
      const model = modelLabelFromEventModel(record.model);
      if (model) {
        currentModelLabel = model;
        options.emitter.modelChanged({
          ...base,
          model,
          previous_model: modelLabelFromEventModel(record.previousModel),
          source: readWidgetString(record.source),
        });
      }
    }

    if (event.type === "message_update") {
      const messageEvent = event.assistantMessageEvent;
      if (messageEvent.type === "thinking_start") {
        flushDisplayUpdates();
        thoughtSegmentBuffer = "";
        thoughtSegmentPrefix = thoughtBuffer ? "\n\n" : "";
        thoughtStartedAt = Date.now();
        thoughtHasDelta = false;
        const now = new Date().toISOString();
        options.emitter.status({
          ...base,
          type: "thinking",
          title: "Thinking...",
          phase: "thinking",
          started_at: now,
          last_event_at: now,
        });
        if (options.includeThoughtFull?.() && !thoughtDeltaActive) {
          thoughtDeltaActive = true;
          emitThoughtDelta({
            ...base,
            delta: thoughtBuffer,
            reset: true,
          });
        }
      }
      if (messageEvent.type === "thinking_delta") {
        const shouldSendDelta = Boolean(options.includeThoughtFull?.());
        if (!thoughtHasDelta && thoughtSegmentPrefix) {
          thoughtBuffer += thoughtSegmentPrefix;
          if (shouldSendDelta && thoughtDeltaActive) {
            emitThoughtDelta({ ...base, delta: thoughtSegmentPrefix });
          }
        }
        thoughtSegmentBuffer += messageEvent.delta;
        thoughtBuffer += messageEvent.delta;
        thoughtHasDelta = true;
        const { preview, totalLines } = buildPreview(
          thoughtBuffer,
          thoughtPreviewLines,
          previewMaxCharsPerLine
        );
        options.onThoughtBuffer?.(thoughtBuffer, totalLines);
        emitThoughtSnapshot({
          ...base,
          text: preview,
          total_lines: totalLines,
        });
        if (shouldSendDelta && !thoughtDeltaActive) {
          thoughtDeltaActive = true;
          emitThoughtDelta({
            ...base,
            delta: thoughtBuffer,
            reset: true,
          });
        } else if (shouldSendDelta) {
          emitThoughtDelta({
            ...base,
            delta: messageEvent.delta,
          });
        } else {
          thoughtDeltaActive = false;
        }
      }
      if (messageEvent.type === "thinking_end") {
        flushDisplayUpdates();
        const completedThought = messageEvent.content || thoughtSegmentBuffer;
        if (!thoughtHasDelta && completedThought) {
          thoughtBuffer += `${thoughtSegmentPrefix}${completedThought}`;
        }
        const { preview, totalLines } = buildPreview(
          thoughtBuffer,
          thoughtPreviewLines,
          previewMaxCharsPerLine
        );
        options.onThoughtBuffer?.(thoughtBuffer, totalLines);
        const thinkingDurationMs = thoughtStartedAt > 0 ? Date.now() - thoughtStartedAt : 0;
        const completedThoughtLines = completedThought ? completedThought.split("\n").length : 0;
        options.onThinkingComplete?.(completedThought, completedThoughtLines, thinkingDurationMs);
        emitThoughtSnapshot({
          ...base,
          text: preview,
          total_lines: totalLines,
        });
        const shouldSendDelta = Boolean(options.includeThoughtFull?.());
        if (shouldSendDelta && !thoughtHasDelta && completedThought) {
          if (!thoughtDeltaActive) {
            thoughtDeltaActive = true;
            emitThoughtDelta({
              ...base,
              delta: thoughtBuffer,
              reset: true,
            });
          } else {
            emitThoughtDelta({
              ...base,
              delta: `${thoughtSegmentPrefix}${completedThought}`,
            });
          }
        } else if (!shouldSendDelta) {
          thoughtDeltaActive = false;
        }
      }
      if (messageEvent.type === "toolcall_start") {
        flushDisplayUpdates();
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
        flushDisplayUpdates();
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
          tool_call_id: messageEvent.toolCall.id,
          tool_name: messageEvent.toolCall.name,
          tool_args: messageEvent.toolCall.arguments,
          ...withMcpStatusIdentity(messageEvent.toolCall.name, messageEvent.toolCall.arguments),
          active_tool_count: activeToolStatuses.size,
          active_tools: Array.from(activeToolStatuses.values()).map(toActiveToolSnapshot),
        });
      }
      if (messageEvent.type === "text_start") {
        flushDisplayUpdates();
        draftBuffer = "";
        draftDeltaActive = false;
        const now = new Date().toISOString();
        options.emitter.status({
          ...base,
          type: "thinking",
          title: "Writing response...",
          phase: "drafting",
          started_at: now,
          last_event_at: now,
        });
        options.onDraftBuffer?.(draftBuffer, 0);
        if (options.includeDraftFull?.()) {
          draftDeltaActive = true;
          emitDraftDelta({
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
        emitDraftSnapshot({
          ...base,
          text: preview,
          total_lines: totalLines,
          kind: "draft",
          mode: "replace",
        });
        const shouldSendDelta = Boolean(options.includeDraftFull?.());
        if (shouldSendDelta && !draftDeltaActive) {
          draftDeltaActive = true;
          emitDraftDelta({
            ...base,
            delta: draftBuffer,
            reset: true,
          });
        } else if (shouldSendDelta) {
          emitDraftDelta({
            ...base,
            delta: messageEvent.delta,
          });
        } else {
          draftDeltaActive = false;
        }
      }
    }

    if (event.type === "tool_execution_start") {
      const startedAt = new Date().toISOString();
      const title = remember(event.toolCallId, event.toolName, event.args);
      const state: ActiveToolStatus = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        title,
        args: event.args,
        startedAt,
        lastProgressAt: startedAt,
        heartbeatAt: startedAt,
        status: "Working...",
        output: {},
      };
      toolStartedAt.set(event.toolCallId, startedAt);
      toolExecutionContext.set(event.toolCallId, { toolName: event.toolName, args: event.args });
      activeToolStatuses.set(event.toolCallId, state);
      emitActiveToolStatus(state);
    }

    if (event.type === "tool_execution_update") {
      const lastEventAt = new Date().toISOString();
      const priorContext = toolExecutionContext.get(event.toolCallId) || null;
      const toolName = event.toolName || priorContext?.toolName || "tool";
      const args = event.args ?? priorContext?.args ?? null;
      const title = lookup(event.toolCallId, toolName, args);
      const startedAt = toolStartedAt.get(event.toolCallId) || lastEventAt;
      toolStartedAt.set(event.toolCallId, startedAt);
      toolExecutionContext.set(event.toolCallId, { toolName, args });
      const outputPreview = buildToolOutputStatusPreview((event as { partialResult?: unknown }).partialResult);
      const state: ActiveToolStatus = {
        toolCallId: event.toolCallId,
        toolName,
        title,
        args,
        startedAt,
        lastProgressAt: lastEventAt,
        heartbeatAt: lastEventAt,
        status: Object.keys(outputPreview).length > 0 ? "Streaming output..." : "Working...",
        output: outputPreview,
      };
      activeToolStatuses.set(event.toolCallId, state);
      emitActiveToolStatus(state, {}, true);
    }

    if (eventType === "tool_execution_heartbeat") {
      const heartbeatEvent = event as unknown as {
        emittedAt?: unknown;
        activeTools?: Array<{ toolCallId?: unknown; toolName?: unknown; startedAt?: unknown; lastEventAt?: unknown }>;
      };
      const heartbeatAt = readWidgetString(heartbeatEvent.emittedAt) || new Date().toISOString();
      for (const snapshot of heartbeatEvent.activeTools || []) {
        const toolCallId = readWidgetString(snapshot.toolCallId);
        if (!toolCallId) continue;
        const existing = activeToolStatuses.get(toolCallId);
        if (existing) {
          activeToolStatuses.set(toolCallId, { ...existing, heartbeatAt });
          continue;
        }
        const toolName = readWidgetString(snapshot.toolName) || "tool";
        const startedAt = readWidgetString(snapshot.startedAt) || heartbeatAt;
        activeToolStatuses.set(toolCallId, {
          toolCallId,
          toolName,
          title: toolName,
          args: null,
          startedAt,
          lastProgressAt: readWidgetString(snapshot.lastEventAt) || startedAt,
          heartbeatAt,
          status: "Working...",
          output: {},
        });
      }
      const primary = Array.from(activeToolStatuses.values())[0];
      if (primary) emitActiveToolStatus(primary, { watchdog_heartbeat: true });
    }

    if (event.type === "tool_execution_end") {
      flushDisplayUpdates();
      const lastEventAt = new Date().toISOString();
      const toolContext = toolExecutionContext.get(event.toolCallId) || null;
      const activeTool = activeToolStatuses.get(event.toolCallId) || null;
      const title = activeTool?.title || lookup(event.toolCallId, event.toolName, toolContext?.args);
      const startedAt = activeTool?.startedAt || toolStartedAt.get(event.toolCallId) || lastEventAt;
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
      const reportedDurationMs = (event as unknown as { durationMs?: unknown }).durationMs;
      const completedTool = {
        tool_call_id: event.toolCallId,
        tool_name: toolContext?.toolName || event.toolName,
        title,
        tool_args: toolContext?.args,
        ...withMcpStatusIdentity(toolContext?.toolName || event.toolName, toolContext?.args),
        started_at: startedAt,
        completed_at: lastEventAt,
        duration_ms: typeof reportedDurationMs === "number"
          ? reportedDurationMs
          : Math.max(0, Date.parse(lastEventAt) - Date.parse(startedAt)),
        status: event.isError ? "failed" : "completed",
        is_error: Boolean(event.isError),
      };
      forget(event.toolCallId);
      activeToolStatuses.delete(event.toolCallId);
      toolExecutionContext.delete(event.toolCallId);
      toolStartedAt.delete(event.toolCallId);
      const remainingTool = Array.from(activeToolStatuses.values())[0];
      if (remainingTool) {
        emitActiveToolStatus(remainingTool, { last_completed_tool: completedTool });
      } else {
        options.emitter.status({
          ...base,
          type: "waiting",
          title: event.isError ? "Reviewing failed tool result..." : "Waiting for model...",
          phase: "post_tool_model",
          started_at: lastEventAt,
          last_event_at: lastEventAt,
          active_tool_count: 0,
          active_tools: [],
          last_completed_tool: completedTool,
        });
      }
    }

    if (event.type === "message_end") {
      flushDisplayUpdates();
      const message = event.message as { role?: string; stopReason?: string; errorMessage?: string };
      const safeErrorMessage = sanitizeProviderErrorDetail(message?.errorMessage);
      if (message?.role === "assistant" && message.stopReason === "error" && classifyOpaqueAgentFailure(safeErrorMessage) === "rate_limit") {
        pendingRateLimit = { message: safeErrorMessage || "429" };
        scheduleRateLimitIntent();
      }
    }

    // Surface provider/API errors and retries so the user sees what's happening
    // instead of silent waiting. These events are emitted by the upstream
    // agent-session for any provider (not just Azure).
    if (event.type === "auto_retry_start") {
      const e = event as { attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string };
      const delaySec = e.delayMs ? Math.round(e.delayMs / 1000) : "?";
      const errorMessage = sanitizeProviderErrorDetail(e.errorMessage) || "";
      const failureCategory = classifyOpaqueAgentFailure(errorMessage);
      const isRateLimit = failureCategory === "rate_limit";
      if (isRateLimit) {
        pendingRateLimit = null;
        if (pendingRateLimitTimer) {
          clearTimeout(pendingRateLimitTimer);
          pendingRateLimitTimer = null;
        }
      }
      const providerError = formatProviderError(errorMessage);
      const isNetwork = failureCategory === "network";
      const retrySuffix = `retrying (attempt ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"}, ${delaySec}s delay)`;
      const title = isRateLimit
        ? `${rateLimitTitle(errorMessage)} — ${retrySuffix}`
        : providerError
          ? `${providerError.title} — ${retrySuffix}`
          : isNetwork
            ? `${describeNetworkError(errorMessage)} — ${retrySuffix}`
            : `Retrying after error (attempt ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"}, ${delaySec}s delay)`;
      const detail = providerError?.detail || sanitizeProviderErrorDetail(errorMessage);
      options.emitter.status({
        ...base,
        type: "intent",
        title,
        detail: appendModelContext(detail || undefined),
        classifier: failureCategory,
        failure_category: failureCategory,
      });
    }

    if (event.type === "auto_retry_end") {
      const e = event as { success?: boolean; attempt?: number; finalError?: string };
      if (!e.success) {
        const finalError = sanitizeProviderErrorDetail(e.finalError) || "Request failed after retries";
        const providerError = formatProviderError(finalError);
        const failureCategory = classifyOpaqueAgentFailure(finalError);
        const title = failureCategory === "rate_limit"
          ? `${rateLimitTitle(finalError)} — retry budget exhausted`
          : providerError
            ? `${providerError.title} — retry budget exhausted`
            : failureCategory === "network"
              ? `${describeNetworkError(finalError)} — retry budget exhausted`
              : sanitizeProviderErrorDetail(finalError) || finalError;
        options.emitter.status({
          ...base,
          type: "error",
          title,
          detail: appendModelContext(providerError?.detail || undefined),
          state: failureCategory === "auth_config" ? "blocked_auth" : "failed",
          classifier: failureCategory,
          failure_category: failureCategory,
        });
      }
    }

    if (event.type === "summarization_retry_scheduled") {
      const e = event as { source?: string; reason?: string; attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string };
      const source = e.source === "branchSummary" ? "branch" : "compaction";
      const delaySec = e.delayMs ? Math.round(e.delayMs / 1000) : "?";
      options.emitter.status({
        ...base,
        type: "intent",
        title: `Retrying ${source} summary (attempt ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"}, ${delaySec}s delay)`,
        detail: sanitizeProviderErrorDetail(e.errorMessage || undefined) || undefined,
        intent_key: "summarization_retry",
        source: e.source ?? null,
        reason: e.reason ?? null,
        attempt: e.attempt ?? null,
        maxAttempts: e.maxAttempts ?? null,
        delayMs: e.delayMs ?? null,
      });
    }

    if (event.type === "summarization_retry_attempt_start") {
      const e = event as { source?: string; reason?: string };
      const source = e.source === "branchSummary" ? "branch" : "compaction";
      options.emitter.status({
        ...base,
        type: "intent",
        title: `Retrying ${source} summary now`,
        intent_key: "summarization_retry",
        source: e.source ?? null,
        reason: e.reason ?? null,
      });
    }

    if (event.type === "summarization_retry_finished") {
      options.emitter.status({
        ...base,
        type: "intent",
        title: "Summary retry finished",
        intent_key: "summarization_retry",
      });
    }

    if (event.type === "compaction_start") {
      const e = event as Record<string, unknown>;
      const reason = typeof e.reason === "string" ? e.reason : undefined;
      const trigger = typeof e.trigger === "string" ? e.trigger : undefined;
      const willRetry = e.willRetry === true;
      const title = willRetry || reason === "overflow"
        ? "Compacting context"
        : reason === "threshold" || reason === "idle" || trigger === "pre_prompt" || trigger === "idle"
          ? "Smart compaction"
          : "Compacting context";
      const detail = willRetry || reason === "overflow"
        ? "Recovering from context pressure so the turn can continue."
        : reason === "threshold" || trigger === "pre_prompt"
          ? "Shrinking recent context before continuing the turn."
          : reason === "idle" || trigger === "idle"
            ? "Tidying context after the turn finished."
            : undefined;
      options.emitter.status({
        ...base,
        type: "intent",
        title,
        detail,
        intent_key: "compaction",
        started_at: new Date().toISOString(),
        ...buildCompactionStatusFields(e),
      });
    }

    if (event.type === "compaction_end") {
      const e = event as { errorMessage?: string; willRetry?: boolean; aborted?: boolean; reason?: string; trigger?: string } & Record<string, unknown>;
      const tokenDetail = describeCompactionTokenChange(e);
      const fields = buildCompactionStatusFields(e);
      if (e.errorMessage) {
        options.emitter.status({
          ...base,
          type: "error",
          title: "Compaction failed",
          detail: tokenDetail,
          ...fields,
        });
      } else if (e.skipped) {
        options.emitter.status({
          ...base,
          type: "intent",
          title: "Compaction skipped",
          detail: "The session was already compact enough to continue safely.",
          ...fields,
        });
      } else if (e.willRetry) {
        options.emitter.status({
          ...base,
          type: "intent",
          title: "Retrying after auto-compaction",
          detail: tokenDetail,
          ...fields,
        });
      } else if (e.aborted) {
        options.emitter.status({
          ...base,
          type: "intent",
          title: e.reason === "manual" || e.trigger === "manual" ? "Compaction cancelled" : "Auto-compaction cancelled",
          ...fields,
        });
      } else {
        options.emitter.status({
          ...base,
          type: "intent",
          title: e.reason === "idle" || e.reason === "threshold" || e.trigger === "pre_prompt" || e.trigger === "idle" ? "Smart compaction complete" : "Compaction complete",
          detail: tokenDetail,
          ...fields,
        });
      }
    }

    const customEventType = (event as { type?: string }).type;

    if (customEventType === "context_usage_update") {
      const e = event as { tokens?: number; contextWindow?: number; percent?: number | null; estimated?: boolean; source?: string; phase?: string };
      options.emitter.status({
        ...base,
        type: "context_usage",
        context_usage: {
          tokens: typeof e.tokens === "number" && Number.isFinite(e.tokens) ? e.tokens : null,
          contextWindow: typeof e.contextWindow === "number" && Number.isFinite(e.contextWindow) ? e.contextWindow : null,
          percent: typeof e.percent === "number" && Number.isFinite(e.percent) ? e.percent : null,
          estimated: e.estimated === true,
          source: typeof e.source === "string" ? e.source : null,
          phase: typeof e.phase === "string" ? e.phase : null,
        },
      });
    }

    if (customEventType === "compaction_warning") {
      const e = event as { detail?: string; compactionCount?: number; warningThreshold?: number };
      const count = typeof e.compactionCount === "number" && Number.isFinite(e.compactionCount) ? e.compactionCount : null;
      const threshold = typeof e.warningThreshold === "number" && Number.isFinite(e.warningThreshold) ? e.warningThreshold : null;
      const detail = [
        count != null ? `${count} successful auto-compactions in this chat` : null,
        threshold != null ? `warning threshold ${threshold}` : null,
      ].filter(Boolean).join(" — ") || "Repeated automatic compaction was detected.";
      options.emitter.status({
        ...base,
        type: "intent",
        title: "Repeated auto-compaction",
        detail,
        intent_key: "compaction",
        started_at: new Date().toISOString(),
      });
    }

    if (customEventType === "compaction_suppressed") {
      const e = event as { failureCount?: number };
      const failureCount = typeof e.failureCount === "number" && Number.isFinite(e.failureCount) ? e.failureCount : null;
      const detail = failureCount != null
        ? `Automatic compaction is paused after ${failureCount} recent failure${failureCount === 1 ? "" : "s"}.`
        : "Automatic compaction is temporarily paused after a recent failure.";
      options.emitter.status({
        ...base,
        type: "intent",
        title: "Compaction temporarily suppressed",
        detail,
        intent_key: "compaction",
        started_at: new Date().toISOString(),
        reason: "previous_failure",
        willRetry: false,
      });
    }

    if (customEventType === "recovery_start") {
      const e = event as { strategy?: string; attempt?: number; maxAttempts?: number; delayMs?: number; classifier?: string; failureCategory?: string };
      const strategy = e.strategy === "compact_then_retry"
        ? "Compacting context and continuing"
        : "Recovering interrupted response";
      const delaySuffix = e.strategy === "retry" && typeof e.delayMs === "number"
        ? ` · ${Math.max(0, Math.round(e.delayMs / 1000))}s delay`
        : "";
      const classifier = readAllowedString(e.classifier, SAFE_RECOVERY_CLASSIFIERS);
      const classifierDetail = classifier ? classifier.replaceAll("_", " ") : null;
      const detail = `Attempt ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"}${delaySuffix}${classifierDetail ? ` — ${classifierDetail}` : ""}`;
      options.emitter.status({
        ...base,
        type: "intent",
        title: strategy,
        detail,
        classifier,
        failure_category: typeof e.failureCategory === "string" && /^[a-z_]+$/.test(e.failureCategory)
          ? e.failureCategory
          : null,
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
          classifier: e.classifier ?? null,
          intent_key: "recovery",
        });
      } else if (e.outcome === "exhausted") {
        options.emitter.status({
          ...base,
          type: "error",
          title: "Automatic recovery exhausted",
          detail: "The bounded recovery path ended without a terminal reply.",
          classifier: e.classifier ?? null,
          intent_key: "recovery",
        });
      }
    }
  }) as StreamingEventHandler;
  handleStreamingEvent.flushDisplayUpdates = flushDisplayUpdates;
  return handleStreamingEvent;
}
