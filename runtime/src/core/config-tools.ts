/** Tool integrations, output policy, workspace search, and model scoping configuration. */

import { DAY_MS, DEFAULT_LOG_RETENTION_CAP_MS } from "../utils/log-layout.js";
import { parsePositiveIntStrict } from "../utils/strict-int.js";
import { OPENROUTER_DEFAULT_MAX_TOKENS } from "./openrouter-output-budget.js";
import { pickBoolean, pickNumber, pickString, pickStringArray } from "./config-helpers.js";
import {
  compactionConfig,
  getDomainConfigOptions,
  modelsConfig,
  toolsConfig,
} from "./config-context.js";
import {
  boolField,
  integerField,
  readDomainConfig,
  registerDomainConfig,
  stringField,
  writeDomainConfig,
  writeDomainConfigField,
  type DomainConfigField,
} from "./domain-config.js";

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = parsePositiveIntStrict(value, 0);
  return parsed > 0 ? parsed : undefined;
}

function parsePositiveDurationMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
}

const legacyWorkspaceSearchRoots = pickStringArray(toolsConfig, [
  "workspaceSearchRoots",
  "workspace_search_roots",
  "PICLAW_WORKSPACE_SEARCH_ROOTS",
]);
const legacyWorkspaceSearchExtensions = pickStringArray(toolsConfig, [
  "workspaceSearchExtensions",
  "workspace_search_extensions",
  "PICLAW_WORKSPACE_SEARCH_EXTENSIONS",
]);
const legacySearchMatchMode = pickString(toolsConfig, [
  "searchMatchMode",
  "search_match_mode",
  "PICLAW_SEARCH_MATCH_MODE",
]);
const legacyScopedModelsOnly = pickBoolean(modelsConfig, [
  "scopedModelsOnly",
  "scoped_models_only",
  "PICLAW_SCOPED_MODELS_ONLY",
]);

/** Optional per-tool compaction threshold overrides. */
export interface ToolResultCompactionThresholdPolicy {
  bytes?: number;
  lines?: number;
}

/** Typed provider/tool integration settings migrated from runtime env support. */
export type SearchMatchMode = "or" | "and";

export interface ToolsIntegrationConfig {
  githubCopilotDynamicModels: boolean;
  githubCopilotModelsTimeoutMs: number;
  openRouterDefaultMaxTokens: number;
  mcpToolTimeoutMs: number;
  packageRoot: string;
  unknownModelContextWindow: number;
  scopedModelsOnly: boolean;
  workspaceSearchRoots: string[];
  workspaceSearchExtensions: string[];
  searchMatchMode: SearchMatchMode;
  toolOutputStoreBytes: number;
  toolOutputStoreLines: number;
  toolOutputPreviewLines: number;
  toolOutputPreviewLineChars: number;
  toolOutputRetentionMs: number;
  toolOutputCleanupIntervalMs: number;
  localLitePromptProfileEnabled: boolean;
  toolResultCompactionEnabled: boolean;
  toolResultCompactionTools: string[];
  toolResultCompactionThresholdsByTool: Record<string, ToolResultCompactionThresholdPolicy>;
  toolResultSemanticSummaryEnabled: boolean;
  toolResultSemanticSummaryMaxInputChars: number;
  toolResultSemanticSummaryMaxTokens: number;
  toolResultSemanticSummaryTimeoutMs: number;
}

function parseLegacyCopilotDynamicModels(raw: string): boolean {
  return !/^(0|false|no)$/i.test(raw.trim());
}

const toolsIntegrationDomainSchema = registerDomainConfig<ToolsIntegrationConfig>({
  domain: "tools",
  fields: {
    githubCopilotDynamicModels: boolField({
      key: "githubCopilotDynamicModels",
      owner: "tools",
      defaultValue: true,
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{
        envKey: "PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS",
        replacement: "domains.tools.githubCopilotDynamicModels",
        removalVersion: "3.0.0",
        parse: parseLegacyCopilotDynamicModels,
      }],
    }),
    githubCopilotModelsTimeoutMs: integerField({
      key: "githubCopilotModelsTimeoutMs",
      owner: "tools",
      defaultValue: 3_500,
      min: 500,
      bounds: ">=500 ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{
        envKey: "PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS",
        replacement: "domains.tools.githubCopilotModelsTimeoutMs",
        removalVersion: "3.0.0",
        parse: (raw) => Math.max(500, Number(raw)),
        skipInvalid: true,
      }],
    }),
    openRouterDefaultMaxTokens: integerField({
      key: "openRouterDefaultMaxTokens",
      owner: "providers",
      defaultValue: OPENROUTER_DEFAULT_MAX_TOKENS,
      min: 1_024,
      max: 1_048_576,
      bounds: "1024..1048576 output tokens",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{
        envKey: "PICLAW_OPENROUTER_DEFAULT_MAX_TOKENS",
        replacement: "domains.tools.openRouterDefaultMaxTokens",
        removalVersion: "3.0.0",
        parse: (raw) => Number(raw),
        skipInvalid: true,
      }],
    }),
    mcpToolTimeoutMs: integerField({
      key: "mcpToolTimeoutMs",
      owner: "tools",
      defaultValue: 120_000,
      min: 0,
      bounds: ">=0 ms; 0 disables the outer wrapper timeout",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{
        envKey: "PICLAW_MCP_TOOL_TIMEOUT_MS",
        replacement: "domains.tools.mcpToolTimeoutMs",
        removalVersion: "3.0.0",
        parse: (raw) => Number(raw),
        skipInvalid: true,
      }],
    }),
    packageRoot: stringField({
      key: "packageRoot",
      owner: "tools",
      defaultValue: "",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_PACKAGE_ROOT", replacement: "domains.tools.packageRoot", removalVersion: "3.0.0" }],
    }),
    unknownModelContextWindow: integerField({
      key: "unknownModelContextWindow",
      owner: "tools",
      defaultValue: 64_000,
      min: 1,
      bounds: "positive integer tokens",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW", replacement: "domains.tools.unknownModelContextWindow", removalVersion: "3.0.0", skipInvalid: true }],
    }),
    scopedModelsOnly: boolField({
      key: "scopedModelsOnly",
      owner: "tools",
      defaultValue: legacyScopedModelsOnly ?? false,
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_SCOPED_MODELS_ONLY", replacement: "domains.tools.scopedModelsOnly", removalVersion: "3.0.0", skipInvalid: true }],
    }),
    workspaceSearchRoots: {
      key: "workspaceSearchRoots",
      owner: "workspace",
      type: "json",
      defaultValue: legacyWorkspaceSearchRoots ?? ["notes", ".pi/skills"],
      validate(value: unknown) {
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error("Invalid workspace search roots");
        return value.map((entry) => entry.trim()).filter(Boolean);
      },
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_WORKSPACE_SEARCH_ROOTS", replacement: "domains.tools.workspaceSearchRoots", removalVersion: "3.0.0", parse: (raw) => raw.split(","), skipInvalid: true }],
    },
    workspaceSearchExtensions: {
      key: "workspaceSearchExtensions",
      owner: "workspace",
      type: "json",
      defaultValue: legacyWorkspaceSearchExtensions ?? [],
      validate(value: unknown) {
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error("Invalid workspace search extensions");
        return value.map((entry) => entry.trim()).filter(Boolean);
      },
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_WORKSPACE_SEARCH_EXTENSIONS", replacement: "domains.tools.workspaceSearchExtensions", removalVersion: "3.0.0", parse: (raw) => raw.split(","), skipInvalid: true }],
    },
    searchMatchMode: {
      ...stringField({ key: "searchMatchMode", owner: "workspace", defaultValue: legacySearchMatchMode === "and" ? "and" : "or", allowedValues: ["or", "and"], persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SEARCH_MATCH_MODE", replacement: "domains.tools.searchMatchMode", removalVersion: "3.0.0", parse: (raw) => raw.trim().toLowerCase(), skipInvalid: true }] }),
      validate(value: unknown) {
        return String(value).trim().toLowerCase() === "and" ? "and" : "or";
      },
    } as DomainConfigField<SearchMatchMode>,
    toolOutputStoreBytes: integerField({ key: "toolOutputStoreBytes", owner: "tools", defaultValue: 5_000, min: 500, max: 100_000, bounds: "500..100000 bytes", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TOOL_OUTPUT_STORE_BYTES", replacement: "domains.tools.toolOutputStoreBytes", removalVersion: "3.0.0", skipInvalid: true }] }),
    toolOutputStoreLines: integerField({ key: "toolOutputStoreLines", owner: "tools", defaultValue: 40, min: 1, bounds: "positive integer lines", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TOOL_OUTPUT_STORE_LINES", replacement: "domains.tools.toolOutputStoreLines", removalVersion: "3.0.0", skipInvalid: true }] }),
    toolOutputPreviewLines: integerField({ key: "toolOutputPreviewLines", owner: "tools", defaultValue: 8, min: 1, bounds: "positive integer lines", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TOOL_OUTPUT_PREVIEW_LINES", replacement: "domains.tools.toolOutputPreviewLines", removalVersion: "3.0.0", skipInvalid: true }] }),
    toolOutputPreviewLineChars: integerField({ key: "toolOutputPreviewLineChars", owner: "tools", defaultValue: 200, min: 1, bounds: "positive integer characters", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TOOL_OUTPUT_PREVIEW_LINE_CHARS", replacement: "domains.tools.toolOutputPreviewLineChars", removalVersion: "3.0.0", skipInvalid: true }] }),
    toolOutputRetentionMs: integerField({
      key: "toolOutputRetentionMs",
      owner: "tools",
      defaultValue: DEFAULT_LOG_RETENTION_CAP_MS,
      min: 1,
      max: DEFAULT_LOG_RETENTION_CAP_MS,
      bounds: `1..${DEFAULT_LOG_RETENTION_CAP_MS} ms`,
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [
        { envKey: "PICLAW_TOOL_OUTPUT_RETENTION_MS", replacement: "domains.tools.toolOutputRetentionMs", removalVersion: "3.0.0", parse: (raw) => { const value = parsePositiveInteger(raw); return value === undefined ? undefined : Math.min(DEFAULT_LOG_RETENTION_CAP_MS, value); }, skipInvalid: true },
        { envKey: "PICLAW_TOOL_OUTPUT_RETENTION_DAYS", replacement: "domains.tools.toolOutputRetentionMs", removalVersion: "3.0.0", parse: (raw) => { const days = parsePositiveInteger(raw); return days === undefined ? undefined : Math.min(DEFAULT_LOG_RETENTION_CAP_MS, days * DAY_MS); }, skipInvalid: true },
      ],
    }),
    toolOutputCleanupIntervalMs: integerField({
      key: "toolOutputCleanupIntervalMs",
      owner: "tools",
      defaultValue: 15 * 60 * 1000,
      min: 1,
      bounds: "positive integer ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS", replacement: "domains.tools.toolOutputCleanupIntervalMs", removalVersion: "3.0.0", parse: (raw) => parsePositiveInteger(raw), skipInvalid: true }],
    }),
    localLitePromptProfileEnabled: boolField({
      key: "localLitePromptProfileEnabled", owner: "tools", secretClass: "none", defaultValue: false,
      persistence: "json-config",
      precedence: ["persisted", "default"],
    }),
    toolResultCompactionEnabled: boolField({
      key: "toolResultCompactionEnabled",
      owner: "tools",
      defaultValue: pickBoolean(compactionConfig, ["toolResultCompactionEnabled", "tool_result_compaction_enabled", "PICLAW_TOOL_RESULT_COMPACTION_ENABLED"]) ?? true,
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_RESULT_COMPACTION_ENABLED", replacement: "domains.tools.toolResultCompactionEnabled", removalVersion: "3.0.0", skipInvalid: true }],
    }),
    toolResultCompactionTools: {
      key: "toolResultCompactionTools",
      owner: "tools",
      type: "json",
      defaultValue: parseToolResultCompactionTools(compactionConfig.toolResultCompactionTools ?? compactionConfig.tool_result_compaction_tools) ?? ["bash", "powershell", "exec_batch"],
      validate(value: unknown) {
        if (typeof value !== "string" && !Array.isArray(value)) throw new Error("Invalid tool result compaction tools");
        return normalizeToolResultCompactionTools(value);
      },
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_RESULT_COMPACTION_TOOLS", replacement: "domains.tools.toolResultCompactionTools", removalVersion: "3.0.0", parse: (raw) => raw.trim() ? raw : undefined, skipInvalid: true }],
    },
    toolResultCompactionThresholdsByTool: {
      key: "toolResultCompactionThresholdsByTool",
      owner: "tools",
      type: "json",
      defaultValue: normalizeToolResultCompactionThresholdsByTool(compactionConfig.toolResultThresholdsByTool ?? compactionConfig.tool_result_thresholds_by_tool),
      validate(value: unknown) {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool result compaction thresholds");
        return Object.freeze(normalizeToolResultCompactionThresholdsByTool(value));
      },
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_OUTPUT_STORE_THRESHOLDS_BY_TOOL", replacement: "domains.tools.toolResultCompactionThresholdsByTool", removalVersion: "3.0.0", parse: (raw) => parseToolResultCompactionThresholdsByTool(raw) ?? undefined, skipInvalid: true }],
    },
    toolResultSemanticSummaryEnabled: boolField({
      key: "toolResultSemanticSummaryEnabled",
      owner: "tools",
      defaultValue: pickBoolean(compactionConfig, ["toolResultSemanticSummaryEnabled", "tool_result_semantic_summary_enabled", "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED"]) ?? true,
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED", replacement: "domains.tools.toolResultSemanticSummaryEnabled", removalVersion: "3.0.0", skipInvalid: true }],
    }),
    toolResultSemanticSummaryMaxInputChars: integerField({
      key: "toolResultSemanticSummaryMaxInputChars",
      owner: "tools",
      defaultValue: parsePositiveIntegerWithBounds(
        pickNumber(compactionConfig, ["toolResultSemanticSummaryMaxInputChars", "tool_result_semantic_summary_max_input_chars", "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS"]),
        12_000,
        500,
        200_000,
      ),
      min: 500,
      max: 200_000,
      bounds: "500..200000 characters",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS", replacement: "domains.tools.toolResultSemanticSummaryMaxInputChars", removalVersion: "3.0.0", parse: (raw) => parsePositiveInteger(raw), skipInvalid: true }],
    }),
    toolResultSemanticSummaryMaxTokens: integerField({
      key: "toolResultSemanticSummaryMaxTokens",
      owner: "tools",
      defaultValue: parsePositiveIntegerWithBounds(
        pickNumber(compactionConfig, ["toolResultSemanticSummaryMaxTokens", "tool_result_semantic_summary_max_tokens", "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS"]),
        320,
        64,
        4_096,
      ),
      min: 64,
      max: 4_096,
      bounds: "64..4096 tokens",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS", replacement: "domains.tools.toolResultSemanticSummaryMaxTokens", removalVersion: "3.0.0", parse: (raw) => parsePositiveInteger(raw), skipInvalid: true }],
    }),
    toolResultSemanticSummaryTimeoutMs: integerField({
      key: "toolResultSemanticSummaryTimeoutMs",
      owner: "tools",
      defaultValue: parsePositiveDurationMs(
        pickNumber(compactionConfig, ["toolResultSemanticSummaryTimeoutMs", "tool_result_semantic_summary_timeout_ms", "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS"]),
        12_000,
      ),
      min: 1,
      bounds: "positive integer ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS", replacement: "domains.tools.toolResultSemanticSummaryTimeoutMs", removalVersion: "3.0.0", parse: (raw) => parsePositiveInteger(raw), skipInvalid: true }],
    }),
  },
});

/** Read current tools integration configuration without mutating process.env. */
export function getToolsIntegrationConfig(): Readonly<ToolsIntegrationConfig> {
  return Object.freeze(readDomainConfig(toolsIntegrationDomainSchema, getDomainConfigOptions()));
}


/** Max tool result chars before auto-externalization. Default 5000. */
export let TOOL_OUTPUT_STORE_THRESHOLD = getToolsIntegrationConfig().toolOutputStoreBytes;

function normalizeToolPolicyThreshold(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(1, Math.round(parsed));
}

function normalizeToolResultCompactionThresholdsByTool(
  input: unknown,
): Record<string, ToolResultCompactionThresholdPolicy> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, ToolResultCompactionThresholdPolicy> = {};
  for (const [rawToolName, rawPolicy] of Object.entries(input as Record<string, unknown>)) {
    const toolName = rawToolName.trim().toLowerCase();
    if (!toolName) continue;
    if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) continue;
    const policyRecord = rawPolicy as Record<string, unknown>;
    const bytes = normalizeToolPolicyThreshold(policyRecord.bytes);
    const lines = normalizeToolPolicyThreshold(policyRecord.lines);
    if (bytes === undefined && lines === undefined) continue;
    out[toolName] = {
      ...(bytes !== undefined ? { bytes } : {}),
      ...(lines !== undefined ? { lines } : {}),
    };
  }
  return out;
}

function parseToolResultCompactionThresholdsByTool(
  raw: unknown,
): Record<string, ToolResultCompactionThresholdPolicy> | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return normalizeToolResultCompactionThresholdsByTool(parsed);
    } catch {
      return null;
    }
  }
  return normalizeToolResultCompactionThresholdsByTool(raw);
}

function normalizeToolResultCompactionTools(input: unknown): string[] {
  if (!input) return [];
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\s,]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of source) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseToolResultCompactionTools(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return normalizeToolResultCompactionTools(parsed);
    } catch {
      return normalizeToolResultCompactionTools(raw);
    }
  }
  return normalizeToolResultCompactionTools(raw);
}

export interface ToolResultSemanticSummaryConfig {
  enabled: boolean;
  maxInputChars: number;
  maxTokens: number;
  timeoutMs: number;
}

function parsePositiveIntegerWithBounds(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

const INITIAL_TOOL_POLICY_CONFIG = getToolsIntegrationConfig();

/** Runtime toggle for universal tool-result compaction. Default on. */
export let TOOL_RESULT_COMPACTION_ENABLED = INITIAL_TOOL_POLICY_CONFIG.toolResultCompactionEnabled;

/** Tool names eligible for tool-result compaction. */
export let TOOL_RESULT_COMPACTION_TOOLS = INITIAL_TOOL_POLICY_CONFIG.toolResultCompactionTools;

/** Optional per-tool compaction threshold overrides. */
export let TOOL_RESULT_COMPACTION_THRESHOLDS_BY_TOOL = INITIAL_TOOL_POLICY_CONFIG.toolResultCompactionThresholdsByTool;

/** Semantic summarization config for compacted tool results. */
export let TOOL_RESULT_SEMANTIC_SUMMARY_CONFIG = Object.seal<ToolResultSemanticSummaryConfig>({
  enabled: INITIAL_TOOL_POLICY_CONFIG.toolResultSemanticSummaryEnabled,
  maxInputChars: INITIAL_TOOL_POLICY_CONFIG.toolResultSemanticSummaryMaxInputChars,
  maxTokens: INITIAL_TOOL_POLICY_CONFIG.toolResultSemanticSummaryMaxTokens,
  timeoutMs: INITIAL_TOOL_POLICY_CONFIG.toolResultSemanticSummaryTimeoutMs,
});

export function getToolOutputStoreThreshold(): number {
  return getToolsIntegrationConfig().toolOutputStoreBytes;
}

export function getToolOutputPresentationConfig(): Readonly<{ storeBytes: number; storeLines: number; previewLines: number; previewLineChars: number }> {
  const config = getToolsIntegrationConfig();
  return Object.freeze({
    storeBytes: config.toolOutputStoreBytes,
    storeLines: config.toolOutputStoreLines,
    previewLines: config.toolOutputPreviewLines,
    previewLineChars: config.toolOutputPreviewLineChars,
  });
}

export function setToolOutputStoreThreshold(value: number): number {
  const next = Math.min(100000, Math.max(500, Math.round(value)));
  const resolved = writeDomainConfigField(toolsIntegrationDomainSchema, getDomainConfigOptions(), "toolOutputStoreBytes", next);
  TOOL_OUTPUT_STORE_THRESHOLD = resolved.toolOutputStoreBytes;
  return TOOL_OUTPUT_STORE_THRESHOLD;
}

/** Return whether runtime tool-result compaction is enabled. */
export function getToolResultCompactionEnabled(): boolean {
  return getToolsIntegrationConfig().toolResultCompactionEnabled;
}

/** Return optional per-tool compaction thresholds (tool name -> bytes/lines). */
export function getToolResultCompactionThresholdsByTool(): Readonly<Record<string, ToolResultCompactionThresholdPolicy>> {
  return getToolsIntegrationConfig().toolResultCompactionThresholdsByTool;
}

/** Return tool names currently eligible for tool-result compaction. */
export function getToolResultCompactionTools(): ReadonlyArray<string> {
  return getToolsIntegrationConfig().toolResultCompactionTools;
}

/** Return semantic summarization config for compacted tool results. */
export function getToolResultSemanticSummaryConfig(): Readonly<ToolResultSemanticSummaryConfig> {
  const config = getToolsIntegrationConfig();
  return Object.freeze({
    enabled: config.toolResultSemanticSummaryEnabled,
    maxInputChars: config.toolResultSemanticSummaryMaxInputChars,
    maxTokens: config.toolResultSemanticSummaryMaxTokens,
    timeoutMs: config.toolResultSemanticSummaryTimeoutMs,
  });
}

/** Persist and apply semantic summarization config for compacted tool results. */
export function setToolResultSemanticSummaryConfig(patch: {
  enabled?: boolean;
  maxInputChars?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Readonly<ToolResultSemanticSummaryConfig> {
  const current = getToolResultSemanticSummaryConfig();
  const next: ToolResultSemanticSummaryConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    maxInputChars: patch.maxInputChars === undefined
      ? current.maxInputChars
      : parsePositiveIntegerWithBounds(patch.maxInputChars, current.maxInputChars, 500, 200_000),
    maxTokens: patch.maxTokens === undefined
      ? current.maxTokens
      : parsePositiveIntegerWithBounds(patch.maxTokens, current.maxTokens, 64, 4_096),
    timeoutMs: patch.timeoutMs === undefined
      ? current.timeoutMs
      : parsePositiveDurationMs(patch.timeoutMs, current.timeoutMs),
  };

  const resolved = writeDomainConfig(toolsIntegrationDomainSchema, getDomainConfigOptions(), {
    toolResultSemanticSummaryEnabled: next.enabled,
    toolResultSemanticSummaryMaxInputChars: next.maxInputChars,
    toolResultSemanticSummaryMaxTokens: next.maxTokens,
    toolResultSemanticSummaryTimeoutMs: next.timeoutMs,
  });
  TOOL_RESULT_SEMANTIC_SUMMARY_CONFIG = Object.seal({
    enabled: resolved.toolResultSemanticSummaryEnabled,
    maxInputChars: resolved.toolResultSemanticSummaryMaxInputChars,
    maxTokens: resolved.toolResultSemanticSummaryMaxTokens,
    timeoutMs: resolved.toolResultSemanticSummaryTimeoutMs,
  });
  return getToolResultSemanticSummaryConfig();
}

/** Persist and apply tool names eligible for tool-result compaction. */
export function setToolResultCompactionTools(tools: string[]): string[] {
  const nextTools = normalizeToolResultCompactionTools(tools);
  const resolved = writeDomainConfigField(toolsIntegrationDomainSchema, getDomainConfigOptions(), "toolResultCompactionTools", nextTools);
  TOOL_RESULT_COMPACTION_TOOLS = resolved.toolResultCompactionTools;
  return [...TOOL_RESULT_COMPACTION_TOOLS];
}

/** Persist and apply the runtime tool-result compaction toggle. */
export function setToolResultCompactionEnabled(enabled: boolean): boolean {
  const next = Boolean(enabled);
  const resolved = writeDomainConfigField(toolsIntegrationDomainSchema, getDomainConfigOptions(), "toolResultCompactionEnabled", next);
  TOOL_RESULT_COMPACTION_ENABLED = resolved.toolResultCompactionEnabled;
  return TOOL_RESULT_COMPACTION_ENABLED;
}

/** Typed workspace-search config grouped for FTS root and extension selection. */
export interface WorkspaceSearchConfig {
  roots: string[];
  /** Additional file extensions to index (merged with built-in defaults). */
  extraExtensions: string[];
}

const initialToolsIntegrationConfig = getToolsIntegrationConfig();

/**
 * Stable public config object with live typed-domain values. Some callers keep
 * object identity while tests/settings can change compatibility inputs between
 * reads, so expose accessor properties instead of freezing one startup snapshot.
 */
export const WORKSPACE_SEARCH_CONFIG = Object.freeze<WorkspaceSearchConfig>({
  get roots() { return getToolsIntegrationConfig().workspaceSearchRoots; },
  get extraExtensions() { return getToolsIntegrationConfig().workspaceSearchExtensions; },
});

/** Return grouped workspace-search config for runtime wiring and tests. */
export function getWorkspaceSearchConfig(): Readonly<WorkspaceSearchConfig> {
  return WORKSPACE_SEARCH_CONFIG;
}

// ---------------------------------------------------------------------------
// Search match mode – controls whether multi-word FTS queries use OR or AND.
// ---------------------------------------------------------------------------

/** Return the current FTS match mode ("or" = any keyword, "and" = all keywords). */
export function getSearchMatchMode(): SearchMatchMode {
  return getToolsIntegrationConfig().searchMatchMode;
}

/** Persist and apply the search match mode. */
export function setSearchMatchMode(mode: SearchMatchMode): SearchMatchMode {
  return writeDomainConfigField(toolsIntegrationDomainSchema, getDomainConfigOptions(), "searchMatchMode", mode === "and" ? "and" : "or").searchMatchMode;
}

// ---------------------------------------------------------------------------
// Model scoping – optionally apply Pi enabledModels outside the TUI.
// ---------------------------------------------------------------------------

let SCOPED_MODELS_ONLY = initialToolsIntegrationConfig.scopedModelsOnly;

/** Return true when Piclaw should filter non-TUI model lists by Pi enabledModels. */
export function getScopedModelsOnly(): boolean {
  return getToolsIntegrationConfig().scopedModelsOnly;
}

/** Persist and apply global model scoping for Piclaw list/model-picker surfaces. */
export function setScopedModelsOnly(enabled: boolean): boolean {
  const next = Boolean(enabled);
  writeDomainConfigField(toolsIntegrationDomainSchema, getDomainConfigOptions(), "scopedModelsOnly", next);
  SCOPED_MODELS_ONLY = next;
  return SCOPED_MODELS_ONLY;
}

/** Typed tool-output retention settings grouped for runtime startup wiring. */
export interface ToolOutputConfig {
  retentionMs: number;
  cleanupIntervalMs: number;
}

/** Stable public object with live typed-domain retention values. */
export const TOOL_OUTPUT_CONFIG = Object.freeze<ToolOutputConfig>({
  get retentionMs() { return getToolsIntegrationConfig().toolOutputRetentionMs; },
  get cleanupIntervalMs() { return getToolsIntegrationConfig().toolOutputCleanupIntervalMs; },
});

/** Return the grouped tool-output settings for startup wiring and tests. */
export function getToolOutputConfig(): Readonly<ToolOutputConfig> {
  return TOOL_OUTPUT_CONFIG;
}

export function getLocalLitePromptProfileEnabled(): boolean {
  return getToolsIntegrationConfig().localLitePromptProfileEnabled;
}

export function setLocalLitePromptProfileEnabled(enabled: boolean): boolean {
  writeDomainConfigField(toolsIntegrationDomainSchema, getDomainConfigOptions(), "localLitePromptProfileEnabled", enabled);
  return getLocalLitePromptProfileEnabled();
}
