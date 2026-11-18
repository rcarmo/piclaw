import { createHash } from "node:crypto";
import { join } from "node:path";

import { readStoredCredential, type ModelRuntime } from "@earendil-works/pi-coding-agent";

import { getPiclawAgentDir } from "../core/agent-dir.js";
import { createLogger } from "../utils/logger.js";

export interface ProviderUsageWindow {
  label: string;
  used_percent: number | null;
  remaining_percent: number | null;
  window_minutes: number | null;
  resets_at: string | null;
  reset_description: string | null;
}

export type ProviderUsageAvailability =
  | "available"
  | "authentication_required"
  | "authentication_failed"
  | "temporary_failure"
  | "malformed_response";

export interface ProviderUsageSnapshot {
  provider: "openai-codex" | "github-copilot" | "openrouter" | "zai";
  source: string;
  availability: ProviderUsageAvailability;
  stale: boolean;
  refresh_failure: Exclude<ProviderUsageAvailability, "available"> | null;
  plan: string | null;
  fetched_at: string;
  primary: ProviderUsageWindow | null;
  secondary: ProviderUsageWindow | null;
  credits_remaining: number | null;
  credits_unlimited: boolean;
  key_usage_usd: number | null;
  key_limit_usd: number | null;
  key_limit_remaining_usd: number | null;
  key_limit_configured: boolean | null;
  key_limit_unlimited: boolean;
  key_limit_reset: string | null;
  key_usage_daily_usd: number | null;
  key_usage_weekly_usd: number | null;
  key_usage_monthly_usd: number | null;
  is_free_tier: boolean | null;
  include_byok_in_limit: boolean | null;
  hint_short: string;
}

type CachedUsage = {
  expiresAt: number;
  value: ProviderUsageSnapshot | null;
  credentialFingerprint: string | null;
};
type SupportedProviderId = ProviderUsageSnapshot["provider"];
type UsageModelRuntime = Pick<ModelRuntime, "getAuth">;
type ResolvedProviderAuth = Awaited<ReturnType<UsageModelRuntime["getAuth"]>>;
type OpenRouterAuthResolution = {
  resolved: ResolvedProviderAuth;
  failed: boolean;
  fingerprint: string;
};

// Internal cache policy, not a user-facing runtime setting.
const USAGE_CACHE_TTL_MS = 60_000;
const usageCache = new Map<string, CachedUsage>();
const usageRefreshInFlight = new Map<string, Promise<ProviderUsageSnapshot | null>>();
const activeCredentialFingerprints = new Map<string, string>();
const log = createLogger("agent-pool.provider-usage");

function baseUsageSnapshot(): Pick<
  ProviderUsageSnapshot,
  | "availability"
  | "stale"
  | "refresh_failure"
  | "key_usage_usd"
  | "key_limit_usd"
  | "key_limit_remaining_usd"
  | "key_limit_configured"
  | "key_limit_unlimited"
  | "key_limit_reset"
  | "key_usage_daily_usd"
  | "key_usage_weekly_usd"
  | "key_usage_monthly_usd"
  | "is_free_tier"
  | "include_byok_in_limit"
> {
  return {
    availability: "available",
    stale: false,
    refresh_failure: null,
    key_usage_usd: null,
    key_limit_usd: null,
    key_limit_remaining_usd: null,
    key_limit_configured: null,
    key_limit_unlimited: false,
    key_limit_reset: null,
    key_usage_daily_usd: null,
    key_usage_weekly_usd: null,
    key_usage_monthly_usd: null,
    is_free_tier: null,
    include_byok_in_limit: null,
  };
}

function clampPercent(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000);
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatResetDescription(date: Date | null): string | null {
  if (!date) return null;
  const deltaMs = date.getTime() - Date.now();
  if (!Number.isFinite(deltaMs)) return null;
  if (deltaMs <= 0) return "resets soon";
  const totalMinutes = Math.max(1, Math.round(deltaMs / 60000));
  if (totalMinutes < 60) return `resets in ~${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const mins = totalMinutes % 60;
    return mins > 0 ? `resets in ~${totalHours}h ${mins}m` : `resets in ~${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `resets in ~${days}d ${hours}h`;
}

function makeWindow(label: string, usedInput: unknown, resetInput: unknown, windowMinutes: number | null): ProviderUsageWindow | null {
  const used = clampPercent(usedInput);
  if (used == null) return null;
  const resetDate = parseDate(resetInput);
  return {
    label,
    used_percent: used,
    remaining_percent: clampPercent(100 - used),
    window_minutes: windowMinutes,
    resets_at: resetDate?.toISOString() ?? null,
    reset_description: formatResetDescription(resetDate),
  };
}

function compactPercent(value: number | null): string | null {
  return value == null ? null : `${Math.round(value)}%`;
}

function codexWindowLabel(minutes: number | null, compact = false): string {
  if (minutes === null) return 'window';
  if (minutes === 10080) return compact ? 'wk' : 'week';
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function codexWindow(value: any): ProviderUsageWindow | null {
  const seconds = value?.limit_window_seconds;
  const minutes = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
  return makeWindow(codexWindowLabel(minutes), value?.used_percent, value?.reset_at, minutes);
}

function buildCodexHint(primary: ProviderUsageWindow | null, secondary: ProviderUsageWindow | null, credits: number | null, unlimited: boolean): string {
  const parts: string[] = [];
  const p1 = compactPercent(primary?.remaining_percent ?? null);
  const p2 = compactPercent(secondary?.remaining_percent ?? null);
  if (p1) parts.push(`${codexWindowLabel(primary!.window_minutes, true)} ${p1}`);
  if (p2) parts.push(`${codexWindowLabel(secondary!.window_minutes, true)} ${p2}`);
  if (unlimited) parts.push("credits ∞");
  else if (credits != null && Number.isFinite(credits)) parts.push(`credits ${credits.toFixed(credits >= 100 ? 0 : 1).replace(/\.0$/, "")}`);
  return parts.join(" • ");
}

/** Premium requests are the limiting Copilot quota; the chat counter stays in the snapshot only. */
function buildCopilotHint(primary: ProviderUsageWindow | null): string {
  return primary?.remaining_percent != null ? `premium ${compactPercent(primary.remaining_percent)}` : "";
}

function buildZaiHint(primary: ProviderUsageWindow | null, secondary: ProviderUsageWindow | null): string {
  return [
    primary?.remaining_percent != null ? `5h ${compactPercent(primary.remaining_percent)}` : null,
    secondary?.remaining_percent != null ? `tools ${compactPercent(secondary.remaining_percent)}` : null,
  ].filter(Boolean).join(" • ");
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 0.01 ? 2 : 4)}`;
}

function buildOpenRouterHint(usage: number, limit: number | null, remaining: number | null, unlimited: boolean): string {
  const parts = [limit === null ? `${formatUsd(usage)} spent` : `${formatUsd(usage)} / ${formatUsd(limit)}`];
  if (remaining !== null) parts.push(`${formatUsd(remaining)} left`);
  else if (unlimited) parts.push("no key limit");
  return parts.join(" • ");
}

function openRouterFailureSnapshot(
  availability: Exclude<ProviderUsageAvailability, "available">,
  hintShort: string,
): ProviderUsageSnapshot {
  return {
    ...baseUsageSnapshot(),
    provider: "openrouter",
    source: "openrouter-key-api",
    availability,
    plan: null,
    fetched_at: new Date().toISOString(),
    primary: null,
    secondary: null,
    credits_remaining: null,
    credits_unlimited: false,
    hint_short: hintShort,
  };
}

async function fetchCodexUsage(modelRuntime: UsageModelRuntime, authPath: string): Promise<ProviderUsageSnapshot | null> {
  const resolved = await modelRuntime.getAuth("openai-codex");
  const stored = readStoredCredential("openai-codex", authPath) as { accountId?: unknown } | undefined;
  const token = resolved?.auth.apiKey;
  const accountId = typeof stored?.accountId === "string" ? stored.accountId : null;
  if (!token || !accountId) return null;
  const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "ChatGPT-Account-Id": accountId, "User-Agent": "PiClaw" },
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as any;
  const primary = codexWindow(payload?.rate_limit?.primary_window);
  const secondary = codexWindow(payload?.rate_limit?.secondary_window);
  const credits = payload?.credits?.balance != null ? Number(payload.credits.balance) : null;
  const unlimited = Boolean(payload?.credits?.unlimited);
  return { ...baseUsageSnapshot(), provider: "openai-codex", source: "chatgpt-usage-api", plan: typeof payload?.plan_type === "string" ? payload.plan_type : null, fetched_at: new Date().toISOString(), primary, secondary, credits_remaining: Number.isFinite(credits) ? credits : null, credits_unlimited: unlimited, hint_short: buildCodexHint(primary, secondary, Number.isFinite(credits) ? credits : null, unlimited) };
}

async function fetchGitHubCopilotUsage(modelRuntime: UsageModelRuntime, authPath: string): Promise<ProviderUsageSnapshot | null> {
  const resolved = await modelRuntime.getAuth("github-copilot"); // canonical refresh/serialization owner
  if (!resolved) return null;
  const stored = readStoredCredential("github-copilot", authPath) as { refresh?: unknown } | undefined;
  const githubToken = typeof stored?.refresh === "string" ? stored.refresh : null;
  if (!githubToken) return null;
  const res = await fetch("https://api.github.com/copilot_internal/user", {
    headers: { Authorization: `token ${githubToken}`, Accept: "application/json", "Editor-Version": "vscode/1.96.2", "Editor-Plugin-Version": "copilot-chat/0.26.7", "User-Agent": "GitHubCopilotChat/0.26.7", "X-Github-Api-Version": "2025-04-01" },
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as any;
  const reset = parseDate(payload?.quota_reset_date);
  const window = (label: string, value: any): ProviderUsageWindow | null => value ? {
    label,
    used_percent: clampPercent(100 - Number(value.percent_remaining ?? value.remaining / value.entitlement * 100)),
    remaining_percent: clampPercent(value.percent_remaining ?? value.remaining / value.entitlement * 100),
    window_minutes: null,
    resets_at: reset?.toISOString() ?? null,
    reset_description: formatResetDescription(reset),
  } : null;
  const primary = window("premium", payload?.quota_snapshots?.premium_interactions);
  const secondary = window("chat", payload?.quota_snapshots?.chat);
  return { ...baseUsageSnapshot(), provider: "github-copilot", source: "github-copilot-internal-api", plan: typeof payload?.copilot_plan === "string" ? payload.copilot_plan : null, fetched_at: new Date().toISOString(), primary, secondary, credits_remaining: null, credits_unlimited: false, hint_short: buildCopilotHint(primary) };
}

async function resolveOpenRouterAuth(modelRuntime: UsageModelRuntime): Promise<OpenRouterAuthResolution> {
  try {
    const resolved = await modelRuntime.getAuth("openrouter");
    const token = resolved?.auth.apiKey;
    return {
      resolved,
      failed: false,
      fingerprint: token
        ? `sha256:${createHash("sha256").update(token).digest("hex")}`
        : "missing",
    };
  } catch {
    return { resolved: undefined, failed: true, fingerprint: "authentication_failed" };
  }
}

async function fetchOpenRouterUsage(auth: OpenRouterAuthResolution): Promise<ProviderUsageSnapshot> {
  if (auth.failed) return openRouterFailureSnapshot("authentication_failed", "OpenRouter authentication failed");
  const token = auth.resolved?.auth.apiKey;
  if (!token) return openRouterFailureSnapshot("authentication_required", "OpenRouter login required");

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "PiClaw" },
    });
  } catch {
    return openRouterFailureSnapshot("temporary_failure", "OpenRouter usage temporarily unavailable");
  }
  if (res.status === 401 || res.status === 403) {
    return openRouterFailureSnapshot("authentication_failed", "OpenRouter authentication failed");
  }
  if (!res.ok) return openRouterFailureSnapshot("temporary_failure", "OpenRouter usage temporarily unavailable");

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    return openRouterFailureSnapshot("malformed_response", "OpenRouter returned invalid usage data");
  }
  const data = payload?.data;
  const usage = nonNegativeNumber(data?.usage);
  if (!data || usage === null) {
    return openRouterFailureSnapshot("malformed_response", "OpenRouter returned incomplete usage data");
  }

  const limitWasReported = Object.hasOwn(data, "limit");
  const limit = nonNegativeNumber(data.limit);
  const limitConfigured = !limitWasReported ? null : data.limit === null ? false : limit === null ? null : true;
  const unlimited = limitWasReported && data.limit === null;
  const remaining = nonNegativeNumber(data.limit_remaining);
  const limitReset = typeof data.limit_reset === "string" && data.limit_reset.trim()
    ? data.limit_reset.trim()
    : null;
  const freeTier = typeof data.is_free_tier === "boolean" ? data.is_free_tier : null;
  const includeByok = typeof data.include_byok_in_limit === "boolean" ? data.include_byok_in_limit : null;
  const snapshot: ProviderUsageSnapshot = {
    ...baseUsageSnapshot(),
    provider: "openrouter",
    source: "openrouter-key-api",
    availability: "available",
    plan: freeTier === true ? "free" : freeTier === false ? "paid" : null,
    fetched_at: new Date().toISOString(),
    primary: null,
    secondary: null,
    credits_remaining: null,
    credits_unlimited: false,
    key_usage_usd: usage,
    key_limit_usd: limit,
    key_limit_remaining_usd: remaining,
    key_limit_configured: limitConfigured,
    key_limit_unlimited: unlimited,
    key_limit_reset: limitReset,
    key_usage_daily_usd: nonNegativeNumber(data.usage_daily),
    key_usage_weekly_usd: nonNegativeNumber(data.usage_weekly),
    key_usage_monthly_usd: nonNegativeNumber(data.usage_monthly),
    is_free_tier: freeTier,
    include_byok_in_limit: includeByok,
    hint_short: buildOpenRouterHint(usage, limit, remaining, unlimited),
  };
  return snapshot;
}

async function fetchZaiUsage(modelRuntime: UsageModelRuntime): Promise<ProviderUsageSnapshot | null> {
  const token = (await modelRuntime.getAuth("zai"))?.auth.apiKey;
  if (!token) return null;
  const res = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "PiClaw" } });
  if (!res.ok) return null;
  const payload = (await res.json()) as any;
  const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : null;
  if (!limits) return null;
  const tokens = limits.find((limit: any) => limit?.type === "TOKENS_LIMIT") ?? null;
  const tools = limits.find((limit: any) => limit?.type === "TIME_LIMIT") ?? null;
  const reset = (value: unknown) => typeof value === "number" ? value / 1000 : value;
  const primary = makeWindow("5h", tokens?.percentage, reset(tokens?.nextResetTime), 300);
  const secondary = makeWindow("tools", tools?.percentage, reset(tools?.nextResetTime), null);
  return { ...baseUsageSnapshot(), provider: "zai", source: "zai-usage-api", plan: typeof payload?.data?.level === "string" ? payload.data.level : null, fetched_at: new Date().toISOString(), primary, secondary, credits_remaining: null, credits_unlimited: false, hint_short: buildZaiHint(primary, secondary) };
}

function isSupportedProviderId(providerId: string): providerId is SupportedProviderId {
  return providerId === "openai-codex" || providerId === "github-copilot" || providerId === "openrouter" || providerId === "zai";
}

async function fetchProviderUsage(
  modelRuntime: UsageModelRuntime,
  providerId: SupportedProviderId,
  authPath: string,
  openRouterAuth?: OpenRouterAuthResolution,
): Promise<ProviderUsageSnapshot | null> {
  if (providerId === "openai-codex") return fetchCodexUsage(modelRuntime, authPath);
  if (providerId === "github-copilot") return fetchGitHubCopilotUsage(modelRuntime, authPath);
  if (providerId === "openrouter") return fetchOpenRouterUsage(openRouterAuth ?? await resolveOpenRouterAuth(modelRuntime));
  return fetchZaiUsage(modelRuntime);
}

function readCachedProviderUsage(
  providerId: SupportedProviderId,
  options: { allowStale?: boolean },
  credentialFingerprint: string | null,
): ProviderUsageSnapshot | null {
  const cached = usageCache.get(providerId);
  if (!cached || cached.credentialFingerprint !== credentialFingerprint) return null;
  return options.allowStale === true || cached.expiresAt > Date.now() ? cached.value : null;
}

export function peekProviderUsage(providerId: string, options: { allowStale?: boolean } = {}): ProviderUsageSnapshot | null {
  if (!isSupportedProviderId(providerId)) return null;
  const credentialFingerprint = activeCredentialFingerprints.get(providerId) ?? null;
  return readCachedProviderUsage(providerId, options, credentialFingerprint);
}

/** Read cached usage only when it belongs to the runtime's current credential. Does not call the provider API. */
export async function peekProviderUsageForRuntime(
  modelRuntime: UsageModelRuntime,
  providerId: string,
  options: { allowStale?: boolean } = {},
): Promise<ProviderUsageSnapshot | null> {
  if (!isSupportedProviderId(providerId)) return null;
  const fingerprint = await resolveProviderUsageAccountRef(modelRuntime, providerId) ?? "missing";
  activeCredentialFingerprints.set(providerId, fingerprint);
  return readCachedProviderUsage(providerId, options, fingerprint);
}

function resolveUsageAuthPath(modelRuntime: UsageModelRuntime, authPath?: string): string {
  return authPath ?? (modelRuntime as UsageModelRuntime & { authPath?: string }).authPath ?? join(getPiclawAgentDir(), "auth.json");
}

function storedProviderIdentity(providerId: string, authPath: string): string | undefined {
  const stored = readStoredCredential(providerId, authPath) as Record<string, unknown> | undefined;
  const identity = providerId === "openai-codex" ? stored?.accountId : providerId === "github-copilot" ? stored?.refresh : undefined;
  return typeof identity === "string" ? identity : undefined;
}

/** Read only stored identity; never resolves credentials or performs auth/network work. */
export function readStoredProviderUsageAccountRef(providerId: string, authPath: string): string | null {
  if (providerId !== "openai-codex" && providerId !== "github-copilot") return null;
  try {
    const identity = storedProviderIdentity(providerId, authPath);
    return identity ? `${providerId}:sha256:${createHash("sha256").update(identity).digest("hex")}` : null;
  } catch { return null; }
}

/** Return a non-secret identity for binding cached quota evidence to the active credential/account. */
export async function resolveProviderUsageAccountRef(
  modelRuntime: UsageModelRuntime,
  providerId: string,
  authPath?: string,
): Promise<string | null> {
  if (!isSupportedProviderId(providerId)) return null;
  try {
    const path = resolveUsageAuthPath(modelRuntime, authPath);
    const stored = storedProviderIdentity(providerId, path);
    const identity = stored !== undefined ? stored : (await modelRuntime.getAuth(providerId))?.auth.apiKey ?? null;
    return identity ? `${providerId}:sha256:${createHash("sha256").update(identity).digest("hex")}` : null;
  } catch {
    return null;
  }
}

export async function warmProviderUsage(modelRuntime: UsageModelRuntime, providerId: string, authPath?: string): Promise<ProviderUsageSnapshot | null> {
  if (!isSupportedProviderId(providerId)) return null;
  const openRouterAuth = providerId === "openrouter" ? await resolveOpenRouterAuth(modelRuntime) : undefined;
  const credentialFingerprint = await resolveProviderUsageAccountRef(modelRuntime, providerId, authPath) ?? "missing";
  activeCredentialFingerprints.set(providerId, credentialFingerprint);
  const cachedCandidate = usageCache.get(providerId);
  const cached = cachedCandidate?.credentialFingerprint === credentialFingerprint
    ? cachedCandidate
    : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const refreshKey = `${providerId}:${credentialFingerprint ?? "default"}`;
  const existing = usageRefreshInFlight.get(refreshKey);
  if (existing) return existing;
  const refreshPromise = (async () => {
    let value: ProviderUsageSnapshot | null;
    try {
      const refreshed = await fetchProviderUsage(
        modelRuntime,
        providerId,
        resolveUsageAuthPath(modelRuntime, authPath),
        openRouterAuth,
      );
      const refreshFailure = refreshed?.availability === "available"
        ? null
        : refreshed?.availability ?? "temporary_failure";
      value = refreshFailure && cached?.value?.availability === "available"
        ? { ...cached.value, stale: true, refresh_failure: refreshFailure }
        : refreshed;
    } catch {
      log.debug("Provider usage refresh failed; returning the cached usage snapshot when available.", { providerId, hasCachedValue: cached?.value != null, classification: "temporary_failure" });
      value = cached?.value
        ? { ...cached.value, stale: true, refresh_failure: "temporary_failure" }
        : null;
    }
    if (activeCredentialFingerprints.get(providerId) === credentialFingerprint) {
      usageCache.set(providerId, {
        expiresAt: Date.now() + USAGE_CACHE_TTL_MS,
        value,
        credentialFingerprint,
      });
    } else {
      value = null;
    }
    usageRefreshInFlight.delete(refreshKey);
    return value;
  })();
  usageRefreshInFlight.set(refreshKey, refreshPromise);
  return refreshPromise;
}

export async function getProviderUsage(modelRuntime: UsageModelRuntime, providerId: string, authPath?: string): Promise<ProviderUsageSnapshot | null> {
  if (!isSupportedProviderId(providerId)) return null;
  return warmProviderUsage(modelRuntime, providerId, authPath);
}

export function clearProviderUsageCache(): void {
  usageCache.clear();
  usageRefreshInFlight.clear();
  activeCredentialFingerprints.clear();
}
