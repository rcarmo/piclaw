/**
 * channels/web/agent-status.ts – Agent status/context/models endpoint helpers.
 */

import type { WebAgentBufferEntry } from "./agent-buffers.js";
import { getAddonApiHealthSnapshot } from "../../../addons/addon-api-health.js";
import { getMcpStartupDiagnostics } from "../../../secure/mcp-keychain.js";
import { appendServerTiming, measureAsync, measureSync } from "../http/server-timing.js";

export interface TokenUsageCounterSummary {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_total: number;
  runs: number;
  provider_reported_cost_runs?: number;
  catalogue_estimate_cost_runs?: number;
  unavailable_cost_runs?: number;
  legacy_cost_runs?: number;
}

export interface LatestTokenUsageCounterSummary extends TokenUsageCounterSummary {
  cache_read_reported?: number | null;
  cache_write_reported?: number | null;
  provider_cost_total?: number | null;
  catalogue_cost_total?: number | null;
  cost_provenance?: string | null;
  model?: string | null;
  response_model?: string | null;
  provider?: string | null;
  api?: string | null;
  turns?: number | null;
  run_at?: string | null;
}

export interface AgentTokenUsageContext {
  latest: LatestTokenUsageCounterSummary | null;
  totals: TokenUsageCounterSummary | null;
}

/** Context contract used by web agent status/context/model endpoint handlers. */
export interface AgentStatusContext {
  defaultChatJid: string;
  json(payload: unknown, status?: number): Response;
  getAgentStatus(chatJid: string): Record<string, unknown> | null;
  getExtensionWorkingState(chatJid: string): Record<string, unknown> | null;
  recoverStaleInflightRun(chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
  getContextUsageForChat(
    chatJid: string
  ): Promise<{ tokens: number | null; contextWindow: number | null; percent: number | null; sessionGeneration?: string } | null>;
  getSessionTreeSummaryForChat?(chatJid: string): Promise<{ leafId: string | null; total: number } | null>;
  getTokenUsageForChat(chatJid: string): AgentTokenUsageContext | null;
  getAvailableModels(chatJid: string, options?: { includeProviderDiagnostics?: boolean; includeCatalogue?: boolean }): Promise<unknown>;
  getProviderReadyCompletedForInstance(): boolean;
  getAddonApiHealthSnapshot?: typeof getAddonApiHealthSnapshot;
  getMcpStartupDiagnostics?: typeof getMcpStartupDiagnostics;
}

function resolveChatJid(req: Request, defaultChatJid: string): string {
  const url = new URL(req.url);
  return (url.searchParams.get("chat_jid") || defaultChatJid).trim() || defaultChatJid;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function computeCacheHitRate(record: TokenUsageCounterSummary | null | undefined): number | null {
  if (!record) return null;
  const input = Number(record.input_tokens) || 0;
  const cacheRead = Number(record.cache_read_tokens) || 0;
  const cacheWrite = Number(record.cache_write_tokens) || 0;
  const denominator = input + cacheRead + cacheWrite;
  const cacheReadReported = "cache_read_reported" in record
    ? (record as LatestTokenUsageCounterSummary).cache_read_reported
    : null;
  if (cacheReadReported === 0 || denominator <= 0) return null;
  if (cacheRead <= 0 && cacheReadReported !== 1) return null;
  return (cacheRead / denominator) * 100;
}

function formatTokenUsageRecord(record: LatestTokenUsageCounterSummary | null | undefined): Record<string, unknown> | null {
  if (!record) return null;
  return {
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
    reasoningTokens: record.reasoning_tokens ?? 0,
    cacheReadTokens: record.cache_read_tokens,
    cacheWriteTokens: record.cache_write_tokens,
    cacheReadReported: record.cache_read_reported == null ? null : Boolean(record.cache_read_reported),
    cacheWriteReported: record.cache_write_reported == null ? null : Boolean(record.cache_write_reported),
    totalTokens: record.total_tokens,
    costTotal: record.cost_total,
    providerCostTotal: record.provider_cost_total ?? null,
    catalogueCostTotal: record.catalogue_cost_total ?? null,
    costProvenance: record.cost_provenance ?? null,
    runs: record.runs,
    cacheHitRate: computeCacheHitRate(record),
    model: record.model ?? null,
    responseModel: record.response_model ?? null,
    provider: record.provider ?? null,
    api: record.api ?? null,
    turns: record.turns ?? null,
    runAt: record.run_at ?? null,
  };
}

function formatTokenUsageTotals(record: TokenUsageCounterSummary | null | undefined): Record<string, unknown> | null {
  if (!record) return null;
  return {
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
    reasoningTokens: record.reasoning_tokens ?? 0,
    cacheReadTokens: record.cache_read_tokens,
    cacheWriteTokens: record.cache_write_tokens,
    totalTokens: record.total_tokens,
    costTotal: record.cost_total,
    runs: record.runs,
    cacheHitRate: computeCacheHitRate(record),
    costCoverage: {
      providerReportedRuns: record.provider_reported_cost_runs ?? 0,
      catalogueEstimateRuns: record.catalogue_estimate_cost_runs ?? 0,
      unavailableRuns: record.unavailable_cost_runs ?? 0,
      legacyRuns: record.legacy_cost_runs ?? 0,
    },
  };
}

function formatTokenUsageContext(usage: AgentTokenUsageContext | null): Record<string, unknown> | null {
  if (!usage || (!usage.latest && !usage.totals)) return null;
  return {
    latest: formatTokenUsageRecord(usage.latest),
    totals: formatTokenUsageTotals(usage.totals),
  };
}

function getMcpStartupStatus(
  readDiagnostics: typeof getMcpStartupDiagnostics = getMcpStartupDiagnostics,
): { degraded: boolean; servers: Array<{ server_name: string; reason: string }> } {
  const diagnostics = readDiagnostics();
  return {
    degraded: diagnostics.length > 0,
    servers: diagnostics.map((diagnostic) => ({
      server_name: diagnostic.serverName,
      reason: diagnostic.reason,
    })),
  };
}

function deriveAgentState(status: Record<string, unknown>): string {
  const explicit = readTrimmedString(status.state);
  if (explicit) return explicit;

  const classifier = readTrimmedString(
    status.classifier
      ?? status.recovery_classifier
      ?? status.recoveryClassifier
      ?? status.failure_classifier,
  );

  if (classifier === "recovery_suppressed") return "recovery_suppressed";
  if (classifier === "auth_config" || classifier === "provider_auth") return "blocked_auth";

  const failureCategory = readTrimmedString(status.failure_category ?? status.failureCategory);
  if (failureCategory === "auth_config") return "blocked_auth";

  return "active";
}

export interface AgentStatusSnapshotOptions {
  includeDiagnostics?: boolean;
  includeExtensionWorking?: boolean;
  recoverStaleInflight?: boolean;
}

/** Build the shared status payload independently of HTTP routing authority. */
export function buildAgentStatusSnapshot(
  chatJid: string,
  ctx: AgentStatusContext,
  options: AgentStatusSnapshotOptions = {},
): Record<string, unknown> {
  const includeDiagnostics = options.includeDiagnostics !== false;
  const includeExtensionWorking = options.includeExtensionWorking !== false;
  const diagnostics = includeDiagnostics
    ? {
        addon_api: (ctx.getAddonApiHealthSnapshot ?? getAddonApiHealthSnapshot)(),
        mcp_startup: getMcpStartupStatus(ctx.getMcpStartupDiagnostics),
      }
    : {};
  const extensionWorking = includeExtensionWorking ? ctx.getExtensionWorkingState(chatJid) : null;
  const status = ctx.getAgentStatus(chatJid);
  if (!status) {
    if (options.recoverStaleInflight !== false) {
      ctx.recoverStaleInflightRun(chatJid, { hasActiveStatus: false });
    }
    return {
      status: "idle",
      state: "idle",
      chat_jid: chatJid,
      data: null,
      extension_working: extensionWorking,
      ...diagnostics,
    };
  }

  // The status store retains terminal command events briefly so polling
  // clients cannot miss completion between requests. Retained terminal
  // payloads are observable history, not active work.
  if (status.type === "done" || status.type === "error") {
    const classifier = readTrimmedString(
      status.classifier
        ?? status.recovery_classifier
        ?? status.recoveryClassifier
        ?? status.failure_classifier
        ?? status.failure_category
        ?? status.failureCategory,
    ) || null;
    return {
      status: "idle",
      state: status.type === "done" ? "idle" : deriveAgentState(status),
      chat_jid: chatJid,
      provider: readTrimmedString(status.provider) || null,
      model: readTrimmedString(status.model) || null,
      classifier,
      last_error: status.type === "error"
        ? readTrimmedString(status.detail) || readTrimmedString(status.title) || null
        : null,
      recovery_strategy: readTrimmedString(status.recovery_strategy ?? status.recoveryStrategy ?? status.strategy) || null,
      recovery_suppressed_reason: readTrimmedString(status.recovery_suppressed_reason ?? status.recoverySuppressedReason) || null,
      data: status,
      extension_working: extensionWorking,
      ...diagnostics,
    };
  }

  const turnId = (status.turn_id || status.turnId) as string | undefined;
  let thought: { text: string; totalLines: number } | undefined;
  let draft: { text: string; totalLines: number } | undefined;
  if (turnId) {
    const thoughtBuffer = ctx.getBuffer(turnId, "thought");
    if (thoughtBuffer) thought = { text: thoughtBuffer.text, totalLines: thoughtBuffer.totalLines };
    const draftBuffer = ctx.getBuffer(turnId, "draft");
    if (draftBuffer) draft = { text: draftBuffer.text, totalLines: draftBuffer.totalLines };
  }

  const state = deriveAgentState(status);
  const classifier = readTrimmedString(
    status.classifier
      ?? status.recovery_classifier
      ?? status.recoveryClassifier
      ?? status.failure_classifier
      ?? status.failure_category
      ?? status.failureCategory,
  ) || null;

  return {
    status: "active",
    state,
    chat_jid: chatJid,
    provider: readTrimmedString(status.provider) || null,
    model: readTrimmedString(status.model) || null,
    classifier,
    last_error: readTrimmedString(status.detail) || readTrimmedString(status.title) || null,
    recovery_strategy: readTrimmedString(status.recovery_strategy ?? status.recoveryStrategy ?? status.strategy) || null,
    recovery_suppressed_reason: readTrimmedString(status.recovery_suppressed_reason ?? status.recoverySuppressedReason) || null,
    data: status,
    thought,
    draft,
    extension_working: extensionWorking,
    ...diagnostics,
  };
}

/** Return active/idle agent status plus streamed thought/draft buffers when available. */
export function handleAgentStatusRequest(req: Request, ctx: AgentStatusContext): Response {
  const { result, durationMs } = measureSync(() => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    return ctx.json(buildAgentStatusSnapshot(chatJid, ctx));
  });
  return appendServerTiming(result, {
    name: "agent_status",
    durationMs,
  });
}

/** Build shared context and latest-run usage metadata for an authorised chat. */
export async function buildAgentContextSnapshot(chatJid: string, ctx: AgentStatusContext): Promise<Record<string, unknown>> {
  const cacheUsage = formatTokenUsageContext(ctx.getTokenUsageForChat(chatJid));
  // Read-only endpoint: never claims or clears the active turn/status surface.
  const sessionTree = ctx.getSessionTreeSummaryForChat
    ? { sessionTree: await ctx.getSessionTreeSummaryForChat(chatJid) }
    : {};
  const usage = await ctx.getContextUsageForChat(chatJid);
  if (!usage) {
    return { tokens: null, contextWindow: null, percent: null, sessionGeneration: null, cacheUsage, ...sessionTree };
  }
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
    sessionGeneration: usage.sessionGeneration ?? null,
    cacheUsage,
    ...sessionTree,
  };
}

/** Return context window usage metrics for the requested/default chat. */
export async function handleAgentContextRequest(req: Request, ctx: AgentStatusContext): Promise<Response> {
  const { result, durationMs } = await measureAsync(async () => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    return ctx.json(await buildAgentContextSnapshot(chatJid, ctx));
  });
  return appendServerTiming(result, {
    name: "agent_context",
    durationMs,
  });
}

/** Return available model options for the requested/default chat. */
export async function handleAgentModelsRequest(req: Request, ctx: AgentStatusContext): Promise<Response> {
  const { result, durationMs } = await measureAsync(async () => {
    const chatJid = resolveChatJid(req, ctx.defaultChatJid);
    const payload = await ctx.getAvailableModels(chatJid);
    if (payload && typeof payload === "object") {
      return ctx.json({
        ...payload as Record<string, unknown>,
        oobe: {
          ...((payload as { oobe?: Record<string, unknown> }).oobe ?? {}),
          provider_ready_completed_instance: ctx.getProviderReadyCompletedForInstance(),
        },
      }, 200);
    }
    return ctx.json(payload, 200);
  });
  return appendServerTiming(result, {
    name: "agent_models",
    durationMs,
  });
}

/** Opt-in UI status envelope. Existing status clients keep their response shape.
 * Family routes validate query allowlists before this operator-only handler. */
export async function handleAgentUiSnapshotRequest(req: Request, ctx: AgentStatusContext, extra: {
  getSystemMetrics(): Promise<unknown>;
  getAgentName(): string;
  getProjectRepository?(chatJid: string): unknown;
}): Promise<Response> {
  const chatJid = resolveChatJid(req, ctx.defaultChatJid);
  const { result, durationMs } = await measureAsync(async () => {
    const status = buildAgentStatusSnapshot(chatJid, ctx);
    const sections = await Promise.allSettled([
      ctx.getAvailableModels(chatJid, { includeCatalogue: false, includeProviderDiagnostics: false }),
      buildAgentContextSnapshot(chatJid, ctx),
      extra.getSystemMetrics(),
    ]);
    const [model, context, metrics] = sections;
    return ctx.json({
      status,
      model: model.status === 'fulfilled' ? {
        ...(model.value as Record<string, unknown>),
        oobe: { provider_ready_completed_instance: ctx.getProviderReadyCompletedForInstance() },
      } : null,
      context: context.status === 'fulfilled' ? context.value : null,
      metrics: metrics.status === 'fulfilled' ? metrics.value : null,
      agent_name: extra.getAgentName(),
      project_repository: extra.getProjectRepository?.(chatJid) ?? null,
      errors: sections.flatMap((section, index) => section.status === 'rejected' ? [['model','context','metrics'][index]] : []),
    });
  });
  return appendServerTiming(result, { name: 'agent_ui_snapshot', durationMs });
}
