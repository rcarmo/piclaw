/**
 * github-copilot-dynamic-models – Piclaw-private patch for GitHub Copilot model discovery.
 *
 * Rationale: see web timeline message 36334. Pi's bundled GitHub Copilot provider uses
 * a static generated model catalog, while private Copilot accounts can expose additional
 * models from https://api.individual.githubcopilot.com/models. This extension is intentionally
 * scoped to github-copilot only and imports chat-capable live model IDs while filtering known
 * non-chat model IDs such as embeddings and trajectory compaction helpers.
 */
import type { Api, Model, OAuthCredential, Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { createLogger } from "../utils/logger.js";

const PROVIDER = "github-copilot";
const DEFAULT_BASE_URL = "https://api.individual.githubcopilot.com";
const FETCH_TIMEOUT_MS = Math.max(500, Number(process.env.PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS || "3500"));
const DISABLED = /^(0|false|no)$/i.test(process.env.PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS || "1");

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
): ProviderModelConfig[] {
  const existingGithubModels = existingModels.filter((model) => model.provider === PROVIDER && model.id);
  const merged = new Map<string, ProviderModelConfig>();

  for (const model of existingGithubModels) {
    merged.set(model.id, toProviderModelConfig(model));
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

async function storedProviderModels(context: RefreshModelsContext): Promise<Model<Api>[]> {
  const entry = await context.store.read();
  return [...(entry?.models ?? [])].filter((model) => model.provider === PROVIDER && model.id);
}

function toStoredModel(model: ProviderModelConfig): Model<Api> {
  return {
    ...model,
    provider: PROVIDER,
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
  let networkInFlight: Promise<void> | null = null;

  const publishLastGood = (models: ProviderModelConfig[]): void => {
    lastGood = models;
  };

  const readStoredAndMerge = async (context: RefreshModelsContext): Promise<Model<Api>[]> => {
    const cached = await storedProviderModels(context);
    const merged = mergeGitHubCopilotDynamicModels([...base.getModels(), ...cached], []);
    if (merged.length > 0) publishLastGood(merged);
    return cached;
  };

  return {
    ...base,
    // Register as a native provider so Copilot's built-in OAuth, endpoint
    // derivation, filterModels, and stream implementations remain provider-owned.
    // Piclaw only augments the synchronous model list with account-discovered
    // chat-capable model IDs and required Copilot IDE headers.
    headers: { ...(base.headers ?? {}), ...COPILOT_HEADERS },
    getModels: () => lastGood.map(toStoredModel),
    filterModels: (models, credential) => {
      const baseAvailable = base.filterModels?.(models, credential) ?? models;
      const availableIds = new Set(baseAvailable.map((model) => model.id));
      for (const model of lastGood) availableIds.add(model.id);
      return models.filter((model) => availableIds.has(model.id));
    },
    refreshModels: async (context) => {
      await base.refreshModels?.(context);
      const cached = await readStoredAndMerge(context);
      if (!context.allowNetwork || context.signal?.aborted) return;
      const credential = copilotCredential(context.credential);
      if (!credential) return;
      networkInFlight ??= (async () => {
        try {
          const live = await fetchGitHubCopilotLiveModels({
            baseUrl: copilotBaseUrl(credential),
            apiKey: credential.access,
            signal: context.signal,
          });
          if (context.signal?.aborted) return;
          const merged = mergeGitHubCopilotDynamicModels([...base.getModels(), ...cached], live);
          publishLastGood(merged);
          await context.store.write({ models: lastGood.map(toStoredModel), checkedAt: Date.now() });
          log.info("Refreshed GitHub Copilot dynamic native provider", {
            operation: "github_copilot_dynamic_models.refresh",
            liveCount: live.length,
            registeredCount: lastGood.length,
          });
          return;
        } catch (error) {
          if (!context.signal?.aborted) {
            log.warn("GitHub Copilot dynamic model refresh failed; keeping last-good catalog", {
              operation: "github_copilot_dynamic_models.refresh_failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        } finally {
          networkInFlight = null;
        }
      })();
      await networkInFlight;
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
