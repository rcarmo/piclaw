/**
 * github-copilot-dynamic-models – Piclaw-private patch for GitHub Copilot model discovery.
 *
 * Rationale: see web timeline message 36334. Pi's bundled GitHub Copilot provider uses
 * a static generated model catalog, while private Copilot accounts can expose additional
 * models from https://api.individual.githubcopilot.com/models. This extension is intentionally
 * scoped to github-copilot only and imports chat-capable live model IDs while filtering known
 * non-chat model IDs such as embeddings and trajectory compaction helpers.
 */
import { isModelType, type Api, type Model, type OAuthCredential, type Provider, type RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { getToolsIntegrationConfig } from "../core/config.js";
import { createLogger } from "../utils/logger.js";

const PROVIDER = "github-copilot";
const DEFAULT_BASE_URL = "https://api.individual.githubcopilot.com";
const toolsIntegrationConfig = getToolsIntegrationConfig();
const FETCH_TIMEOUT_MS = toolsIntegrationConfig.githubCopilotModelsTimeoutMs;
const REFRESH_TTL_MS = 15 * 60_000;
const DISABLED = !toolsIntegrationConfig.githubCopilotDynamicModels;

const COPILOT_HEADERS: Record<string, string> = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};

const DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const log = createLogger("extensions.github-copilot-dynamic-models");

type ProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];
type ProviderModelConfig = NonNullable<ProviderConfig["models"]>[number];
type CopilotDynamicModelRuntime = Pick<ModelRuntime, "getModels" | "getProvider" | "registerNativeProvider">;
type FetchLike = typeof fetch;

type CopilotLiveModel = {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  vendor?: unknown;
  supported_endpoints?: unknown;
  capabilities?: {
    family?: unknown;
    limits?: {
      max_context_window_tokens?: unknown;
      max_prompt_tokens?: unknown;
      max_output_tokens?: unknown;
      max_non_streaming_output_tokens?: unknown;
      vision?: unknown;
    };
    supports?: {
      reasoning_effort?: unknown;
      parallel_tool_calls?: unknown;
      tool_calls?: unknown;
    };
  };
  preview?: unknown;
  model_picker_enabled?: unknown;
  policy?: { state?: unknown };
};

let fetchForTests: FetchLike | null = null;

export function setGitHubCopilotDynamicModelsFetchForTests(fetchImpl: FetchLike | null): void {
  fetchForTests = fetchImpl;
}

function getFetch(): FetchLike {
  return fetchForTests ?? fetch;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter((entry): entry is string => Boolean(entry)) : [];
}

const NON_CHAT_MODEL_ID = /(?:^|[-_])(embedding|embeddings)(?:[-_]|$)|^text-embedding-|^trajectory-compaction$/i;
const KNOWN_CHAT_MODEL_ID = /^(gpt|claude|mai|gemini|raptor|grok|xai|o\d|o-)/i;

export function shouldImportGitHubCopilotLiveModelId(id: string): boolean {
  const normalized = id.trim();
  return Boolean(normalized) && !NON_CHAT_MODEL_ID.test(normalized);
}

function getLiveModelId(model: CopilotLiveModel): string | null {
  return stringValue(model.id);
}

function getLiveModelName(model: CopilotLiveModel, id: string): string {
  return stringValue(model.name) ?? stringValue(model.display_name) ?? id;
}

function liveModelEndpoints(model: CopilotLiveModel): string[] {
  return stringArray(model.supported_endpoints).map((entry) => entry.toLowerCase());
}

function liveModelReasoningEfforts(model: CopilotLiveModel): string[] {
  return stringArray(model.capabilities?.supports?.reasoning_effort).map((entry) => entry.toLowerCase());
}

function liveModelSupportsVision(model: CopilotLiveModel): boolean {
  return isObject(model.capabilities?.limits?.vision);
}

function liveModelContextWindow(model: CopilotLiveModel, fallback?: number): number {
  const limits = model.capabilities?.limits;
  return numberValue(limits?.max_context_window_tokens)
    ?? numberValue(limits?.max_prompt_tokens)
    ?? fallback
    ?? 128000;
}

function liveModelMaxTokens(model: CopilotLiveModel, fallback?: number): number {
  const limits = model.capabilities?.limits;
  return numberValue(limits?.max_output_tokens)
    ?? numberValue(limits?.max_non_streaming_output_tokens)
    ?? fallback
    ?? 16384;
}

function hasLiveChatEndpoint(model: CopilotLiveModel): boolean {
  const endpoints = liveModelEndpoints(model);
  return endpoints.some((endpoint) => (
    endpoint.includes("responses")
    || endpoint.includes("chat/completions")
    || endpoint.includes("messages")
  ));
}

function shouldImportGitHubCopilotLiveModel(model: CopilotLiveModel, id: string): boolean {
  if (model.model_picker_enabled === false) return false;
  if (stringValue(model.policy?.state)?.toLowerCase() === "disabled") return false;
  if (model.capabilities?.supports?.tool_calls === false) return false;
  return shouldImportGitHubCopilotLiveModelId(id)
    && (KNOWN_CHAT_MODEL_ID.test(id) || hasLiveChatEndpoint(model));
}

function findTemplate(existing: Model<Api>[], id: string): Model<Api> | undefined {
  const exact = existing.find((model) => model.id === id);
  if (exact) return exact;

  const candidates: string[] = [];
  if (id.startsWith("claude-fable-5")) candidates.push("claude-fable-5");
  if (id.startsWith("claude-opus-4.6")) candidates.push("claude-opus-4.6");
  if (id.startsWith("claude-opus-4.7")) candidates.push("claude-opus-4.7");
  if (id.startsWith("claude-opus-4.8")) candidates.push("claude-opus-4.8");
  if (id.startsWith("claude-sonnet-4.6")) candidates.push("claude-sonnet-4.6");
  if (id.startsWith("gpt-5.6")) candidates.push("gpt-5.6");
  if (id.startsWith("gpt-5.5")) candidates.push("gpt-5.5");
  if (id.startsWith("gpt-5.4")) candidates.push("gpt-5.4");
  if (id.startsWith("gpt-5.3")) candidates.push("gpt-5.3-codex");
  if (id.startsWith("gpt-5")) candidates.push("gpt-5.4", "gpt-5-mini");
  if (id.startsWith("gpt-4.1")) candidates.push("gpt-4.1");
  if (id.startsWith("gpt-4")) candidates.push("gpt-4.1");
  if (id.startsWith("gpt-3.5")) candidates.push("gpt-4.1");
  if (id.startsWith("mai")) candidates.push("gpt-5.5", "gpt-5.4");
  if (id.startsWith("gemini")) candidates.push("gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-pro", "gpt-5.5");
  if (id.startsWith("raptor")) candidates.push("raptor-mini", "gpt-5.5");
  if (id.startsWith("grok") || id.startsWith("xai")) candidates.push("gpt-5.5", "gpt-5.4");
  if (/^o\d|^o-/.test(id)) candidates.push("gpt-5.5", "gpt-5.4");

  for (const candidate of candidates) {
    const match = existing.find((model) => model.id === candidate);
    if (match) return match;
  }
  return undefined;
}

function inferApi(id: string, model: CopilotLiveModel, template?: Model<Api>): Api {
  const endpoints = liveModelEndpoints(model);
  if (id.startsWith("claude")) return "anthropic-messages" as Api;
  if (endpoints.some((endpoint) => endpoint.includes("responses"))) {
    return "openai-responses" as Api;
  }
  if (id.startsWith("gpt-5") || id.startsWith("mai")) return "openai-responses" as Api;
  return template?.api ?? ("openai-completions" as Api);
}

function inferCompat(id: string, api: Api, template?: Model<Api>): Model<Api>["compat"] {
  if (template?.compat) return template.compat;
  if (api === "anthropic-messages") {
    return {
      forceAdaptiveThinking: true,
      ...(id.includes("4.7") || id.includes("4.8") ? { supportsTemperature: false } : {}),
    } as Model<Api>["compat"];
  }
  if (api === "openai-completions") {
    return {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    } as Model<Api>["compat"];
  }
  return undefined;
}

function inferThinkingLevelMap(id: string, model: CopilotLiveModel, template?: Model<Api>): Model<Api>["thinkingLevelMap"] {
  const normalizedId = id.toLowerCase();
  const efforts = new Set(liveModelReasoningEfforts(model).map((effort) => effort.toLowerCase()));

  // Copilot sometimes publishes fixed-effort Claude variants. Do not inherit a
  // broader base-model map for those IDs.
  if (normalizedId.startsWith("claude") && normalizedId.includes("-xhigh")) {
    return { off: null, minimal: null, low: null, medium: null, high: null, xhigh: "xhigh", max: null } as Model<Api>["thinkingLevelMap"];
  }
  if (normalizedId.startsWith("claude") && normalizedId.includes("-high")) {
    return { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null } as Model<Api>["thinkingLevelMap"];
  }

  // 0.80.6 gives native max its own slot. Live capabilities augment a static
  // template instead of collapsing provider max into xhigh.
  const liveMap = efforts.size === 0 ? undefined : {
    off: efforts.has("none") ? "none" : null,
    minimal: efforts.has("minimal") ? "minimal" : efforts.has("low") ? "low" : null,
    ...(efforts.has("low") ? { low: "low" } : {}),
    ...(efforts.has("medium") ? { medium: "medium" } : {}),
    ...(efforts.has("high") ? { high: "high" } : {}),
    ...(efforts.has("xhigh") ? { xhigh: "xhigh" } : {}),
    ...(efforts.has("max") ? { max: "max" } : {}),
  } as Model<Api>["thinkingLevelMap"];

  if (normalizedId.startsWith("claude")) {
    if (template?.thinkingLevelMap) return { ...template.thinkingLevelMap, ...liveMap };
    if (normalizedId.includes("4.6")) return { max: "max" } as Model<Api>["thinkingLevelMap"];
    if (normalizedId.includes("4.7") || normalizedId.includes("4.8") || normalizedId.includes("sonnet-5") || normalizedId.includes("fable-5")) {
      return { xhigh: "xhigh", max: "max" } as Model<Api>["thinkingLevelMap"];
    }
    return liveMap;
  }

  if (template?.thinkingLevelMap) return { ...template.thinkingLevelMap, ...liveMap };
  return liveMap;
}

function inferReasoning(id: string, model: CopilotLiveModel, template?: Model<Api>): boolean {
  if (template?.reasoning !== undefined && template.id === id) return Boolean(template.reasoning);
  if (liveModelReasoningEfforts(model).length > 0) return true;
  if (id.startsWith("claude")) return true;
  if (id.startsWith("gpt-5") || id.startsWith("mai")) return true;
  return Boolean(template?.reasoning);
}

function toProviderModelConfig(model: Model<Api>): ProviderModelConfig {
  return {
    id: model.id,
    name: model.name ?? model.id,
    api: model.api,
    baseUrl: undefined,
    reasoning: Boolean(model.reasoning),
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input ?? ["text"],
    cost: model.cost ?? DEFAULT_COST,
    contextWindow: model.contextWindow ?? 128000,
    maxTokens: model.maxTokens ?? 16384,
    headers: { ...COPILOT_HEADERS },
    compat: model.compat,
  } satisfies ProviderModelConfig;
}

function liveToProviderModelConfig(
  live: CopilotLiveModel,
  existing: Model<Api>[],
): ProviderModelConfig | null {
  const id = getLiveModelId(live);
  if (!id || !shouldImportGitHubCopilotLiveModel(live, id)) return null;

  const template = findTemplate(existing, id);
  const api = inferApi(id, live, template);
  const input: Array<"text" | "image"> = liveModelSupportsVision(live) || template?.input?.includes("image") ? ["text", "image"] : ["text"];
  return {
    id,
    name: getLiveModelName(live, id),
    api,
    baseUrl: undefined,
    reasoning: inferReasoning(id, live, template),
    thinkingLevelMap: inferThinkingLevelMap(id, live, template),
    input,
    cost: template?.cost ?? DEFAULT_COST,
    contextWindow: liveModelContextWindow(live, template?.contextWindow),
    maxTokens: liveModelMaxTokens(live, template?.maxTokens),
    headers: { ...COPILOT_HEADERS },
    compat: inferCompat(id, api, template),
  } satisfies ProviderModelConfig;
}

export function mergeGitHubCopilotDynamicModels(
  existingModels: Model<Api>[],
  liveModels: CopilotLiveModel[],
  options: { includeExisting?: boolean } = {},
): ProviderModelConfig[] {
  const existingGithubModels = existingModels.filter((model) => model.provider === PROVIDER && model.id);
  const merged = new Map<string, ProviderModelConfig>();

  if (options.includeExisting !== false) {
    for (const model of existingGithubModels) {
      merged.set(model.id, toProviderModelConfig(model));
    }
  }

  for (const live of liveModels) {
    const model = liveToProviderModelConfig(live, existingGithubModels);
    if (!model) continue;
    merged.set(model.id, model);
  }

  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function parseLiveModelsPayload(payload: unknown): CopilotLiveModel[] {
  if (Array.isArray(payload)) return payload.filter(isObject) as CopilotLiveModel[];
  if (!isObject(payload)) return [];
  const data = payload.data;
  if (Array.isArray(data)) return data.filter(isObject) as CopilotLiveModel[];
  const models = payload.models;
  if (Array.isArray(models)) return models.filter(isObject) as CopilotLiveModel[];
  return [];
}

export async function fetchGitHubCopilotLiveModels(options: {
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<CopilotLiveModel[]> {
  const baseUrl = options.baseUrl.replace(/\/+$/, "") || DEFAULT_BASE_URL;
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  const timer = setTimeout(() => controller.abort(new Error("GitHub Copilot model refresh timed out")), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  (timer as { unref?: () => void }).unref?.();
  try {
    const response = await (options.fetchImpl ?? getFetch())(`${baseUrl}/models`, {
      headers: { ...COPILOT_HEADERS, ...(options.headers ?? {}), Accept: "application/json", Authorization: `Bearer ${options.apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GitHub Copilot /models failed: ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return parseLiveModelsPayload(await response.json());
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function copilotCredential(credential: RefreshModelsContext["credential"]): OAuthCredential | null {
  return credential?.type === "oauth" && typeof credential.access === "string" && credential.access ? credential : null;
}

function copilotBaseUrl(credential: OAuthCredential): string {
  const tokenMatch = credential.access.match(/proxy-ep=([^;]+)/);
  if (tokenMatch?.[1]) return `https://${tokenMatch[1].replace(/^proxy\./, "api.")}`;
  const enterpriseUrl = typeof credential.enterpriseUrl === "string" ? credential.enterpriseUrl.trim() : "";
  if (enterpriseUrl) {
    try {
      const hostname = new URL(enterpriseUrl.includes("://") ? enterpriseUrl : `https://${enterpriseUrl}`).hostname;
      if (hostname) return `https://copilot-api.${hostname}`;
    } catch (error) {
      log.debug("Ignoring malformed GitHub Copilot enterprise metadata; using the public endpoint", {
        operation: "github_copilot_dynamic_models.enterprise_url_invalid",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return DEFAULT_BASE_URL;
}

function storedProviderModels(context: RefreshModelsContext): Model<Api>[] {
  return [...(context.stored?.models ?? [])].filter((model): model is Model<Api> =>
    isModelType(model, "chat") && model.provider === PROVIDER && Boolean(model.id));
}

function toStoredModel(model: ProviderModelConfig): Model<Api> {
  return {
    ...model,
    provider: PROVIDER,
    // Model consumers inspect baseUrl before ModelRuntime resolves request auth,
    // so every catalog entry must remain structurally complete. This fallback
    // is not the request endpoint: Copilot OAuth toAuth() returns a credential-
    // specific baseUrl and ModelRuntime.prepareRequest() replaces it per request.
    baseUrl: model.baseUrl ?? DEFAULT_BASE_URL,
    headers: model.headers ?? { ...COPILOT_HEADERS },
  } as Model<Api>;
}

export function createGitHubCopilotDynamicModelsProvider(
  modelRuntime: Pick<ModelRuntime, "getModels" | "getProvider">,
): Provider | null {
  const base = modelRuntime.getProvider(PROVIDER);
  if (!base) return null;
  let lastGood: ProviderModelConfig[] = mergeGitHubCopilotDynamicModels([...base.getModels()], []);
  // IDs confirmed by the account's own live /models fetch. Populated only from a
  // successful network refresh - never from the cached store or static catalog -
  // so stale entries can never re-enter the selectable set.
  let liveModelIds: ReadonlySet<string> = new Set<string>();
  let lastNetworkRefreshAt = 0;
  const networkInFlightBySignal = new WeakMap<AbortSignal, Promise<void>>();

  const publishLastGood = (models: ProviderModelConfig[]): void => {
    lastGood = models;
  };

  const restoreStoredAndMerge = async (context: RefreshModelsContext): Promise<{ accepted: boolean; cached: Model<Api>[] }> => {
    const cached = storedProviderModels(context);
    const source = cached.length > 0 ? cached : [...base.getModels()];
    const merged = mergeGitHubCopilotDynamicModels(source, []);
    if (merged.length === 0) return { accepted: true, cached };
    const accepted = await context.publish({
      update: () => publishLastGood(merged),
    });
    return { accepted, cached };
  };

  return {
    ...base,
    // Register as a native provider so Copilot's built-in OAuth, endpoint
    // derivation, filterModels, and stream implementations remain provider-owned.
    // Piclaw only augments the synchronous model list with account-discovered
    // chat-capable model IDs and their context sizes, plus Copilot IDE headers.
    headers: { ...(base.headers ?? {}), ...COPILOT_HEADERS },
    getModels: () => lastGood.map(toStoredModel),
    getAllModels: () => [...lastGood.map(toStoredModel), ...(base.getAllModels?.() ?? []).filter(model => !isModelType(model, 'chat'))],
    refreshModelsAuth: 'credential', // Account catalogue requires OAuth; the inherited pi.dev catalogue does not.
    // Availability filtering stays upstream. We only widen it by IDs the account's
    // own live catalog confirmed, which covers models newer than the login-time
    // `availableModelIds` snapshot. Models present only in the cached/static
    // catalog stay filtered out: requesting them returns 400 model_not_supported.
    filterModels: (models, credential) => {
      const upstream = base.filterModels?.(models, credential) ?? models;
      if (liveModelIds.size === 0) return upstream;
      const allowed = new Set(upstream.map((model) => model.id));
      return models.filter((model) => allowed.has(model.id) || liveModelIds.has(model.id));
    },
    refreshModels: async (context) => {
      const restored = await restoreStoredAndMerge(context);
      if (!restored.accepted || !context.allowNetwork || context.signal.aborted) return;
      if (!context.force && lastNetworkRefreshAt > 0 && Date.now() - lastNetworkRefreshAt < REFRESH_TTL_MS) return;
      const credential = copilotCredential(context.credential);
      if (!credential) return;

      const existing = networkInFlightBySignal.get(context.signal);
      if (existing) {
        await existing;
        return;
      }
      const refresh = (async () => {
        try {
          // Copilot's account-scoped endpoint is authoritative. Do not invoke
          // the wrapped pi.dev catalog refresher here: it shares this provider
          // store, adds a second network dependency, and cannot improve account
          // availability. Preserve any existing validator fields when writing.
          const live = await fetchGitHubCopilotLiveModels({
            baseUrl: copilotBaseUrl(credential),
            apiKey: credential.access,
            signal: context.signal,
          });
          if (context.signal.aborted) return;
          const templates = [...base.getModels(), ...restored.cached];
          const merged = mergeGitHubCopilotDynamicModels(templates, live, { includeExisting: false });
          const published = await context.publish({
            persist: {
              ...context.stored,
              models: merged.map(toStoredModel),
              checkedAt: Date.now(),
            },
            update: () => {
              publishLastGood(merged);
              liveModelIds = new Set(merged.map((model) => model.id));
              lastNetworkRefreshAt = Date.now();
            },
          });
          if (!published) return;
          log.info("Refreshed GitHub Copilot dynamic native provider", {
            operation: "github_copilot_dynamic_models.refresh",
            liveCount: live.length,
            registeredCount: lastGood.length,
          });
        } catch (error) {
          if (!context.signal.aborted) {
            log.warn("GitHub Copilot dynamic model refresh failed; keeping last-good catalog", {
              operation: "github_copilot_dynamic_models.refresh_failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })();
      networkInFlightBySignal.set(context.signal, refresh);
      try {
        await refresh;
      } finally {
        if (networkInFlightBySignal.get(context.signal) === refresh) {
          networkInFlightBySignal.delete(context.signal);
        }
      }
    },
  };
}

export function registerGitHubCopilotDynamicModels(
  modelRuntime: CopilotDynamicModelRuntime,
): void {
  if (DISABLED) return;
  const provider = createGitHubCopilotDynamicModelsProvider(modelRuntime);
  if (!provider) {
    log.warn("GitHub Copilot provider not found; dynamic native provider overlay skipped", {
      operation: "github_copilot_dynamic_models.provider_missing",
    });
    return;
  }
  modelRuntime.registerNativeProvider(provider);
}
