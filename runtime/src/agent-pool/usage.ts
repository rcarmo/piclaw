/**
 * agent-pool/usage.ts – Extract and persist LLM token usage from session events.
 *
 * Persists provider-reported usage from assistant messages plus Earendil 0.81
 * usage metadata on tool results, branch summaries, and compaction entries.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { storeTokenUsage } from "../db.js";
import { valueApiEquivalentCost } from "./usage-valuation.js";

export type UsageRecordSource = "assistant" | "tool" | "compaction" | "branch_summary" | "unknown";

interface UsageCarrier {
  id?: unknown;
  messageId?: unknown;
  toolCallId?: unknown;
  role?: unknown;
  usage?: unknown;
  timestamp?: unknown;
  model?: unknown;
  responseModel?: unknown;
  provider?: unknown;
  api?: unknown;
}

interface UsageMetadata {
  source: UsageRecordSource;
  timestamp?: unknown;
  model?: unknown;
  responseModel?: unknown;
  provider?: unknown;
  api?: unknown;
  turns?: number | null;
  eventId?: string | null;
  invocationId?: string | null;
  contextTier?: unknown;
}

type SessionWithUsageRecorder = AgentSession & {
  __piclawUsageRecorderInstalled?: boolean;
  __piclawUsageRecorderChatJid?: string;
  subscribe: (handler: (event: AgentSessionEvent) => void) => () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asOptionalNonNegativeNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function asOptionalBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function usageEventId(chatJid: string, usage: Record<string, unknown>, metadata: UsageMetadata): string {
  const invocationId = firstString(usage.invocationId, usage.invocation_id, usage.usageEventId, usage.usage_event_id);
  // Provider/session invocation identities are authoritative across reporting
  // contexts. Do not include the chat JID: a parent replay of a child's usage
  // must resolve to the original charge rather than create an instance-wide
  // duplicate under a second chat.
  if (invocationId) return `usage:invocation:${invocationId}`;
  if (metadata.eventId) return `usage:${metadata.source}:event:${metadata.eventId}`;
  const canonical = JSON.stringify({
    chatJid,
    source: metadata.source,
    timestamp: metadata.timestamp ?? null,
    model: metadata.model ?? null,
    responseModel: metadata.responseModel ?? null,
    provider: metadata.provider ?? null,
    api: metadata.api ?? null,
    usage,
  });
  return `usage:${metadata.source}:sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function extractReasoningTokens(usage: Record<string, unknown>): number {
  const outputDetails = asRecord(usage.outputTokensDetails)
    ?? asRecord(usage.output_tokens_details)
    ?? asRecord(usage.completion_tokens_details);
  return firstNumber(
    usage.reasoningTokens,
    usage.reasoning_tokens,
    usage.reasoning,
    outputDetails?.reasoning_tokens,
    outputDetails?.reasoningTokens,
  );
}

function normalizeRunAt(timestamp: unknown): string {
  if (typeof timestamp === "string" || typeof timestamp === "number") {
    const ts = new Date(timestamp);
    if (!Number.isNaN(ts.getTime())) return ts.toISOString();
  }
  return new Date().toISOString();
}

function hasUsageTokensOrCost(usage: Record<string, unknown>): boolean {
  const cost = asRecord(usage.cost) ?? {};
  return (cost.totalFromProvider === true && asOptionalNonNegativeNumber(cost.total) !== null)
    || asOptionalNonNegativeNumber(usage.providerCost, usage.provider_cost) !== null || [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.totalTokens,
    usage.total,
    extractReasoningTokens(usage),
    cost.input,
    cost.output,
    cost.cacheRead,
    cost.cacheWrite,
    cost.total,
    usage.providerCost,
    usage.provider_cost,
  ].some((value) => typeof value === "number" && Number.isFinite(value) && value !== 0);
}

function storeUsageRecord(chatJid: string, usage: Record<string, unknown>, metadata: UsageMetadata): void {
  if (!hasUsageTokensOrCost(usage)) return;

  const input = asNumber(usage, "input");
  const output = asNumber(usage, "output");
  const cacheRead = asNumber(usage, "cacheRead");
  const cacheWrite = asNumber(usage, "cacheWrite");
  const reasoningTokens = extractReasoningTokens(usage);
  const totalTokens =
    asNumber(usage, "totalTokens") ||
    asNumber(usage, "total") ||
    input + output + cacheRead + cacheWrite;

  const cost = asRecord(usage.cost) ?? {};
  const costInput = asNumber(cost, "input");
  const costOutput = asNumber(cost, "output");
  const costCacheRead = asNumber(cost, "cacheRead");
  const costCacheWrite = asNumber(cost, "cacheWrite");
  // SDK category costs are catalogue-derived; its total may instead be an
  // actual provider bill. Never value the catalogue using that billed total.
  const categoryEstimate = costInput + costOutput + costCacheRead + costCacheWrite;
  const catalogueCostCandidate = cost.totalFromProvider === true ? categoryEstimate
    : asOptionalNonNegativeNumber(cost.total) ?? categoryEstimate;
  // Zero category costs alone do not prove a known free catalogue tariff.
  const catalogueCostTotal = catalogueCostCandidate > 0 ? catalogueCostCandidate : null;
  const providerCostTotal = (cost.totalFromProvider === true ? asOptionalNonNegativeNumber(cost.total) : null)
    ?? asOptionalNonNegativeNumber(usage.providerCost, usage.provider_cost);
  const providerCostCurrency = providerCostTotal === null ? null : cost.totalFromProvider === true ? "USD"
    : firstString(usage.providerCostCurrency, usage.provider_cost_currency)?.toUpperCase() ?? null;
  const costTotal = providerCostTotal ?? catalogueCostTotal ?? 0;
  const costProvenance = providerCostTotal !== null
    ? "provider_reported"
    : catalogueCostTotal !== null
      ? "catalogue_estimate"
      : "unavailable";
  const provider = asStringOrNull(metadata.provider);
  const cacheWriteFallback = cacheWrite > 0
    && (provider === "openai" || provider === "openai-codex")
    && asOptionalNonNegativeNumber(cost.cacheWrite) === null
    && input > 0
    && costInput > 0
    ? costInput / input * cacheWrite
    : null;
  const valuation = valueApiEquivalentCost({
    tokens: { input, output, cacheRead, cacheWrite, reasoning: reasoningTokens },
    costs: {
      input: asOptionalNonNegativeNumber(cost.input),
      output: asOptionalNonNegativeNumber(cost.output),
      cacheRead: asOptionalNonNegativeNumber(cost.cacheRead),
      cacheWrite: asOptionalNonNegativeNumber(cost.cacheWrite),
      total: asOptionalNonNegativeNumber(cost.total),
    },
    cacheWriteInputFallback: cacheWriteFallback,
    documentedFree: usage.documentedFree === true || usage.pricing_provenance === "documented_free",
  });
  const eventId = usageEventId(chatJid, usage, metadata);

  storeTokenUsage({
    chat_jid: chatJid,
    run_at: normalizeRunAt(metadata.timestamp),
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoningTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cache_read_reported: asOptionalBoolean(usage.cacheReadReported, usage.cache_read_reported),
    cache_write_reported: asOptionalBoolean(usage.cacheWriteReported, usage.cache_write_reported),
    total_tokens: totalTokens,
    cost_input: costInput,
    cost_output: costOutput,
    cost_cache_read: costCacheRead,
    cost_cache_write: costCacheWrite,
    cost_total: costTotal,
    provider_cost_total: providerCostTotal,
    provider_cost_currency: providerCostCurrency,
    catalogue_cost_total: catalogueCostTotal,
    cost_provenance: costProvenance,
    model: asStringOrNull(metadata.model),
    response_model: asStringOrNull(metadata.responseModel),
    provider: asStringOrNull(metadata.provider),
    api: asStringOrNull(metadata.api),
    usage_source: metadata.source,
    turns: metadata.turns ?? null,
    invocation_id: metadata.invocationId ?? metadata.eventId ?? null,
    usage_event_id: eventId,
    api_equivalent_cost_microusd: valuation.amountMicros,
    api_equivalent_cost_known: valuation.known,
    valuation_provenance: valuation.provenance,
    api_equivalent_known_subtotal_microusd: valuation.knownSubtotalMicros,
    api_equivalent_unknown_categories: JSON.stringify(valuation.unknownCategories),
    pricing_currency: "USD",
    pricing_source: "pi-ai Usage.cost category totals",
    pricing_version: "pi-ai-usage-cost-v1",
    pricing_context_tier: asStringOrNull(metadata.contextTier ?? usage.contextTier ?? usage.context_tier),
    pricing_cache_fallbacks: JSON.stringify(valuation.fallbackCategories),
  });
}

/**
 * Extract token usage from an assistant message and store it in the database.
 * Kept for direct side-prompt streams and existing call sites/tests.
 */
export function recordMessageUsage(chatJid: string, message: unknown, source: UsageRecordSource = "assistant"): void {
  const msg = asRecord(message) as UsageCarrier | null;
  if (!msg || msg.role !== "assistant") return;

  const usage = asRecord(msg.usage);
  if (!usage) return;

  storeUsageRecord(chatJid, usage, {
    source,
    timestamp: msg.timestamp,
    model: msg.model,
    responseModel: msg.responseModel,
    provider: msg.provider,
    api: msg.api,
    turns: 1,
    eventId: firstString(msg.id, msg.messageId),
    invocationId: firstString(msg.id, msg.messageId),
    contextTier: usage.contextTier ?? usage.context_tier,
  });
}

/** Extract and persist Earendil 0.81 usage metadata from a session event. */
export function recordSessionEventUsage(chatJid: string, event: unknown): void {
  const eventRecord = asRecord(event);
  const eventType = eventRecord?.type;
  if (!eventRecord || typeof eventType !== "string") return;

  if (eventType === "message_end") {
    const message = asRecord(eventRecord.message) as UsageCarrier | null;
    if (!message) return;

    if (message.role === "assistant") {
      recordMessageUsage(chatJid, message);
      return;
    }

    if (message.role === "toolResult" || message.role === "tool_result") {
      const usage = asRecord(message.usage);
      if (!usage) return;
      storeUsageRecord(chatJid, usage, {
        source: "tool",
        timestamp: message.timestamp,
        model: message.model ?? usage.model,
        responseModel: message.responseModel ?? usage.responseModel ?? usage.response_model,
        provider: message.provider ?? usage.provider,
        api: message.api ?? usage.api,
        turns: 0,
        eventId: firstString(message.id, message.messageId, message.toolCallId),
        invocationId: firstString(message.toolCallId, message.id, message.messageId),
      });
    }
    return;
  }

  if (eventType === "session_compact") {
    const entry = asRecord(eventRecord.compactionEntry);
    const usage = asRecord(entry?.usage);
    if (!usage) return;
    storeUsageRecord(chatJid, usage, {
      source: "compaction",
      timestamp: entry?.timestamp,
      model: entry?.model ?? usage.model,
      responseModel: entry?.responseModel ?? usage.responseModel ?? usage.response_model,
      provider: entry?.provider ?? usage.provider,
      api: entry?.api ?? usage.api,
      turns: 0,
      eventId: firstString(entry?.id, eventRecord.id),
      invocationId: firstString(entry?.id, eventRecord.id),
    });
    return;
  }

  if (eventType === "session_tree") {
    const entry = asRecord(eventRecord.summaryEntry);
    if (entry?.type !== "branch_summary") return;
    const usage = asRecord(entry.usage);
    if (!usage) return;
    storeUsageRecord(chatJid, usage, {
      source: "branch_summary",
      timestamp: entry.timestamp,
      model: entry.model ?? usage.model,
      responseModel: entry.responseModel ?? usage.responseModel ?? usage.response_model,
      provider: entry.provider ?? usage.provider,
      api: entry.api ?? usage.api,
      turns: 0,
      eventId: firstString(entry.id, eventRecord.id),
      invocationId: firstString(entry.id, eventRecord.id),
    });
  }
}

/** Install one per-session usage recorder so compaction/tree events are captured outside prompt subscriptions. */
export function installSessionUsageRecorder(
  session: AgentSession,
  chatJid: string,
  onWarn?: (message: string, details: Record<string, unknown>) => void,
): void {
  const target = session as SessionWithUsageRecorder;
  target.__piclawUsageRecorderChatJid = chatJid;
  if (target.__piclawUsageRecorderInstalled) return;
  target.__piclawUsageRecorderInstalled = true;

  target.subscribe((event) => {
    const currentChatJid = target.__piclawUsageRecorderChatJid ?? chatJid;
    try {
      recordSessionEventUsage(currentChatJid, event);
    } catch (err) {
      onWarn?.("Failed to persist session usage metadata", {
        operation: "session_usage_recorder.record_event_usage",
        chatJid: currentChatJid,
        eventType: (event as { type?: unknown })?.type ?? null,
        err,
      });
    }
  });
}
