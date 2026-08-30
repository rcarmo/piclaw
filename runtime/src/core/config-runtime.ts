/** Agent, session, compaction, recovery, watchdog, and operational runtime configuration. */

import { resolve } from "path";
import { readJsonConfig, writeJsonConfig } from "./config-store.js";
import { pickBoolean, pickNumber, pickString } from "./config-helpers.js";
import {
  compactionConfig,
  DATA_DIR,
  getConfigPath,
  getDomainConfigOptions,
  piclawConfig,
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

// ---------------------------------------------------------------------------
// Agent timeout settings – how long a single agent turn may run.
// ---------------------------------------------------------------------------

/** Typed agent turn timeout settings grouped for runtime and handler wiring. */
export interface AgentRuntimeConfig {
  timeoutMs: number;
  backgroundTimeoutMs: number;
}

interface AgentDomainConfig extends AgentRuntimeConfig {
  toolUseMessageBudget: number;
  midTurnToolExecutionHardCeiling: number;
}

const legacyTurnMaxToolUseMessages = pickNumber(piclawConfig, [
  "turnMaxToolExecutions",
  "turn_max_tool_executions",
  "turnMaxToolUseMessages",
  "turn_max_tool_use_messages",
  "toolUseBudget",
  "tool_use_budget",
  "PICLAW_TURN_MAX_TOOL_EXECUTIONS",
  "PICLAW_TURN_MAX_TOOL_USE_MESSAGES",
  "midTurnToolExecutionHardCeiling",
  "mid_turn_tool_execution_hard_ceiling",
  "PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING",
]);
const configMidTurnToolExecutionHardCeiling = pickNumber(piclawConfig, [
  "midTurnToolExecutionHardCeiling",
  "mid_turn_tool_execution_hard_ceiling",
  "PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING",
]);

const agentRuntimeDomainSchema = registerDomainConfig<AgentDomainConfig>({
  domain: "agent",
  fields: {
    timeoutMs: integerField({
      key: "timeoutMs",
      owner: "agent-runtime",
      defaultValue: 3_600_000,
      min: 1,
      bounds: "positive integer ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [
        { envKey: "PICLAW_AGENT_TIMEOUT", replacement: "domains.agent.timeoutMs", removalVersion: "3.0.0", parse: (raw) => Number.parseInt(raw, 10), skipInvalid: true },
        { envKey: "AGENT_TIMEOUT", replacement: "domains.agent.timeoutMs", removalVersion: "3.0.0", parse: (raw) => Number.parseInt(raw, 10), skipInvalid: true },
      ],
    }),
    backgroundTimeoutMs: integerField({
      key: "backgroundTimeoutMs",
      owner: "agent-runtime",
      defaultValue: 0,
      min: 0,
      bounds: ">=0 ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [
        { envKey: "PICLAW_BACKGROUND_AGENT_TIMEOUT", replacement: "domains.agent.backgroundTimeoutMs", removalVersion: "3.0.0", parse: (raw) => Number.parseInt(raw, 10), skipInvalid: true },
        { envKey: "AGENT_TIMEOUT_BACKGROUND", replacement: "domains.agent.backgroundTimeoutMs", removalVersion: "3.0.0", parse: (raw) => Number.parseInt(raw, 10), skipInvalid: true },
      ],
    }),
    toolUseMessageBudget: integerField({
      key: "toolUseMessageBudget",
      owner: "agent-runtime",
      defaultValue: legacyTurnMaxToolUseMessages ?? 64,
      min: 1,
      max: 512,
      bounds: "1..512 completed tool executions (Settings writes clamp to >=8)",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [
        { envKey: "PICLAW_TURN_MAX_TOOL_EXECUTIONS", replacement: "domains.agent.toolUseMessageBudget", removalVersion: "3.0.0", skipInvalid: true },
        { envKey: "PICLAW_TURN_MAX_TOOL_USE_MESSAGES", replacement: "domains.agent.toolUseMessageBudget", removalVersion: "3.0.0", skipInvalid: true },
        { envKey: "PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING", replacement: "domains.agent.toolUseMessageBudget", removalVersion: "3.0.0", parse: (raw) => { const value = Number(raw); return Number.isFinite(value) && value > 0 ? Math.min(512, Math.max(1, Math.round(value))) : undefined; }, skipInvalid: true },
      ],
    }),
    midTurnToolExecutionHardCeiling: integerField({
      key: "midTurnToolExecutionHardCeiling",
      owner: "agent-runtime",
      defaultValue: configMidTurnToolExecutionHardCeiling ?? 48,
      min: 1,
      max: 512,
      bounds: "1..512 executed tools",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING", replacement: "domains.agent.midTurnToolExecutionHardCeiling", removalVersion: "3.0.0", parse: (raw) => { const value = Number(raw); return Number.isFinite(value) && value > 0 ? Math.min(512, Math.max(1, Math.round(value))) : 0; }, skipInvalid: true }],
    }),
  },
});

const AGENT_DOMAIN_CONFIG = readDomainConfig(agentRuntimeDomainSchema, getDomainConfigOptions());

/** Typed Dream/AutoDream scheduling and execution settings. */
export interface DreamConfig {
  cron: string;
  backupKeep: number;
  model: string;
  agentTimeoutMs: number;
}

const DEFAULT_DREAM_AGENT_TIMEOUT_MS = 6 * 60 * 1000;
const dreamAgentTimeoutFallback = AGENT_DOMAIN_CONFIG.backgroundTimeoutMs > 0
  ? AGENT_DOMAIN_CONFIG.backgroundTimeoutMs
  : DEFAULT_DREAM_AGENT_TIMEOUT_MS;

const dreamDomainSchema = registerDomainConfig<DreamConfig>({
  domain: "dream",
  fields: {
    cron: stringField({
      key: "cron",
      owner: "dream",
      defaultValue: "0 1 * * *",
      nonEmpty: true,
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_DREAM_CRON", replacement: "domains.dream.cron", removalVersion: "3.0.0", skipInvalid: true }],
    }),
    backupKeep: integerField({
      key: "backupKeep",
      owner: "dream",
      defaultValue: 10,
      min: 1,
      bounds: "positive integer backups",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{
        envKey: "PICLAW_DREAM_BACKUP_KEEP",
        replacement: "domains.dream.backupKeep",
        removalVersion: "3.0.0",
        parse: (raw) => Math.max(1, Number.parseInt(raw, 10) || 10),
      }],
    }),
    model: stringField({
      key: "model",
      owner: "dream",
      defaultValue: "",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_DREAM_MODEL", replacement: "domains.dream.model", removalVersion: "3.0.0" }],
    }),
    agentTimeoutMs: integerField({
      key: "agentTimeoutMs",
      owner: "dream",
      defaultValue: dreamAgentTimeoutFallback,
      min: 1,
      bounds: "positive integer ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{
        envKey: "PICLAW_DREAM_AGENT_TIMEOUT_MS",
        replacement: "domains.dream.agentTimeoutMs",
        removalVersion: "3.0.0",
        parse: (raw) => Number.parseInt(raw, 10),
        skipInvalid: true,
      }],
    }),
  },
});

/** Read current Dream settings without mutating compatibility environment aliases. */
export function getDreamConfig(): Readonly<DreamConfig> {
  return Object.freeze(readDomainConfig(dreamDomainSchema, getDomainConfigOptions()));
}

/** Grouped agent turn timeout settings. */
export const AGENT_RUNTIME_CONFIG = Object.freeze<AgentRuntimeConfig>({
  timeoutMs: AGENT_DOMAIN_CONFIG.timeoutMs,
  backgroundTimeoutMs: AGENT_DOMAIN_CONFIG.backgroundTimeoutMs,
});

/** Return grouped agent timeout settings for runtime wiring and tests. */
export function getAgentRuntimeConfig(): Readonly<AgentRuntimeConfig> {
  return AGENT_RUNTIME_CONFIG;
}

/** Typed session-pool capacity and memory-pressure policy. */
export interface SessionPoolConfig {
  mainIdleTtlMs: number;
  sideIdleTtlMs: number;
  cleanupIntervalMs: number;
  mainSessionPoolMaxSize: number;
  memoryPressureRssBytes: number;
  memoryPressureMainIdleTtlMs: number;
  memoryPressureMainSessionPoolMaxSize: number;
}

const sessionPoolDomainSchema = registerDomainConfig<SessionPoolConfig>({
  domain: "sessionPool",
  fields: {
    mainIdleTtlMs: integerField({ key: "mainIdleTtlMs", owner: "agent-runtime", defaultValue: 180_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_MAIN_SESSION_IDLE_TTL_MS", replacement: "domains.sessionPool.mainIdleTtlMs", removalVersion: "3.0.0", skipInvalid: true },
      { envKey: "PICLAW_SESSION_IDLE_TTL_MS", replacement: "domains.sessionPool.mainIdleTtlMs and sideIdleTtlMs", removalVersion: "3.0.0", skipInvalid: true },
    ] }),
    sideIdleTtlMs: integerField({ key: "sideIdleTtlMs", owner: "agent-runtime", defaultValue: 60_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_SIDE_SESSION_IDLE_TTL_MS", replacement: "domains.sessionPool.sideIdleTtlMs", removalVersion: "3.0.0", skipInvalid: true },
      { envKey: "PICLAW_SESSION_IDLE_TTL_MS", replacement: "domains.sessionPool.mainIdleTtlMs and sideIdleTtlMs", removalVersion: "3.0.0", skipInvalid: true },
    ] }),
    cleanupIntervalMs: integerField({ key: "cleanupIntervalMs", owner: "agent-runtime", defaultValue: 30_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_CLEANUP_INTERVAL_MS", replacement: "domains.sessionPool.cleanupIntervalMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    mainSessionPoolMaxSize: integerField({ key: "mainSessionPoolMaxSize", owner: "agent-runtime", defaultValue: 1, min: 0, bounds: "non-negative integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_MAIN_SESSION_POOL_MAX_SIZE", replacement: "domains.sessionPool.mainSessionPoolMaxSize", removalVersion: "3.0.0", skipInvalid: true },
      { envKey: "PICLAW_SESSION_POOL_MAX_SIZE", replacement: "domains.sessionPool.mainSessionPoolMaxSize", removalVersion: "3.0.0", skipInvalid: true },
    ] }),
    memoryPressureRssBytes: integerField({ key: "memoryPressureRssBytes", owner: "agent-runtime", defaultValue: 384 * 1024 * 1024, min: 0, bounds: "non-negative integer bytes", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES", replacement: "domains.sessionPool.memoryPressureRssBytes", removalVersion: "3.0.0", skipInvalid: true }] }),
    memoryPressureMainIdleTtlMs: integerField({ key: "memoryPressureMainIdleTtlMs", owner: "agent-runtime", defaultValue: 60_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS", replacement: "domains.sessionPool.memoryPressureMainIdleTtlMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    memoryPressureMainSessionPoolMaxSize: integerField({ key: "memoryPressureMainSessionPoolMaxSize", owner: "agent-runtime", defaultValue: 1, min: 0, bounds: "non-negative integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE", replacement: "domains.sessionPool.memoryPressureMainSessionPoolMaxSize", removalVersion: "3.0.0", skipInvalid: true }] }),
  },
});

/** Return session-pool capacity and pressure settings resolved for a new pool instance. */
export function getSessionPoolConfig(): Readonly<SessionPoolConfig> {
  return readDomainConfig(sessionPoolDomainSchema, getDomainConfigOptions());
}

// ---------------------------------------------------------------------------
// Operational add-on, agent-control, and recording storage settings.
// ---------------------------------------------------------------------------

export interface AddonsConfig {
  apiFailureBackoffMs: number;
}

const addonsDomainSchema = registerDomainConfig<AddonsConfig>({
  domain: "addons",
  fields: {
    apiFailureBackoffMs: integerField({
      key: "apiFailureBackoffMs",
      owner: "addons",
      defaultValue: 60_000,
      min: 1,
      bounds: "positive integer ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_ADDON_API_FAILURE_BACKOFF_MS", replacement: "domains.addons.apiFailureBackoffMs", removalVersion: "3.0.0", parse: (raw) => Number(raw), skipInvalid: true }],
    }),
  },
});

export function getAddonsConfig(): Readonly<AddonsConfig> {
  return Object.freeze(readDomainConfig(addonsDomainSchema, getDomainConfigOptions()));
}

export interface AgentControlConfig {
  abortSettleTimeoutMs: number;
}

const agentControlDomainSchema = registerDomainConfig<AgentControlConfig>({
  domain: "agentControl",
  fields: {
    abortSettleTimeoutMs: integerField({
      key: "abortSettleTimeoutMs",
      owner: "agent-control",
      defaultValue: 1000,
      min: 0,
      max: 10_000,
      bounds: "0..10000 ms",
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_ABORT_SETTLE_TIMEOUT_MS", replacement: "domains.agentControl.abortSettleTimeoutMs", removalVersion: "3.0.0", parse: (raw) => { const value = Number(raw); return Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.round(value))) : 1000; } }],
    }),
  },
});

export function getAgentControlConfig(): Readonly<AgentControlConfig> {
  return Object.freeze(readDomainConfig(agentControlDomainSchema, getDomainConfigOptions()));
}

export interface SessionRecordingsConfig {
  directory: string;
}

const sessionRecordingsDomainSchema = registerDomainConfig<SessionRecordingsConfig>({
  domain: "sessionRecordings",
  fields: {
    directory: stringField({
      key: "directory",
      owner: "storage",
      defaultValue: resolve(DATA_DIR, "session-recordings"),
      nonEmpty: true,
      persistence: "json-config",
      precedence: ["compat-env", "persisted", "default"],
      secretClass: "none",
      compatibilityEnv: [{ envKey: "PICLAW_RECORDINGS_DIR", replacement: "domains.sessionRecordings.directory", removalVersion: "3.0.0", skipInvalid: true }],
    }),
  },
});

export function getSessionRecordingsConfig(): Readonly<SessionRecordingsConfig> {
  return Object.freeze(readDomainConfig(sessionRecordingsDomainSchema, getDomainConfigOptions()));
}

/** Directory for persisted Pi session files. */
export const SESSIONS_DIR = resolve(DATA_DIR, "sessions");

const configSessionMaxSizeMb = pickNumber(piclawConfig, [
  "sessionMaxSizeMb",
  "session_max_size_mb",
  "PICLAW_SESSION_MAX_SIZE_MB",
]);
const configSessionAutoRotate = pickBoolean(piclawConfig, [
  "sessionAutoRotate",
  "session_auto_rotate",
  "PICLAW_SESSION_AUTO_ROTATE",
]);
const configSessionMaxLines = pickNumber(piclawConfig, [
  "sessionMaxLines",
  "session_max_lines",
  "PICLAW_SESSION_MAX_LINES",
]);
const configSessionMaxCompactions = pickNumber(piclawConfig, [
  "sessionMaxCompactions",
  "session_max_compactions",
  "maxCompactionsBeforeRotation",
  "max_compactions_before_rotation",
  "PICLAW_SESSION_MAX_COMPACTIONS",
]);
const configCompactionTimeoutMs = pickNumber(compactionConfig, [
  "timeoutMs",
  "timeout_ms",
  "compactionTimeoutMs",
  "PICLAW_COMPACTION_TIMEOUT_MS",
]);
const configCompactionBackoffBaseMs = pickNumber(compactionConfig, [
  "backoffBaseMs",
  "backoff_base_ms",
  "compactionBackoffBaseMs",
  "PICLAW_COMPACTION_BACKOFF_BASE_MS",
]);
const configCompactionBackoffMaxMs = pickNumber(compactionConfig, [
  "backoffMaxMs",
  "backoff_max_ms",
  "compactionBackoffMaxMs",
  "PICLAW_COMPACTION_BACKOFF_MAX_MS",
]);
const PROGRESS_WATCHDOG_ENABLED_CONFIG_KEYS = [
  "progressWatchdogEnabled",
  "progress_watchdog_enabled",
  "watchdogEnabled",
  "PICLAW_PROGRESS_WATCHDOG_ENABLED",
];
const PROGRESS_WATCHDOG_TIMEOUT_CONFIG_KEYS = [
  "progressWatchdogTimeoutMs",
  "progress_watchdog_timeout_ms",
  "watchdogTimeoutMs",
  "PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS",
];
const configProgressWatchdogEnabled = pickBoolean(compactionConfig, PROGRESS_WATCHDOG_ENABLED_CONFIG_KEYS);
const configProgressWatchdogTimeoutMs = pickNumber(compactionConfig, PROGRESS_WATCHDOG_TIMEOUT_CONFIG_KEYS);
const configSmartCompactionMethod = pickString(compactionConfig, [
  "smartCompactionMethod",
  "smart_compaction_method",
  "PICLAW_SMART_COMPACTION_METHOD",
]);
const configAutoCompactionEnabled = pickBoolean(compactionConfig, [
  "autoCompactionEnabled",
  "auto_compaction_enabled",
  "PICLAW_AUTO_COMPACTION_ENABLED",
]);
const configCompactionThresholdPercent = pickNumber(compactionConfig, ["thresholdPercent", "threshold_percent", "PICLAW_COMPACTION_THRESHOLD_PERCENT"]);
const configCompactionMaxThresholdTokens = pickNumber(compactionConfig, ["maxThresholdTokens", "max_threshold_tokens", "compactionMaxThresholdTokens", "PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS"]);
const configAutoCompactionScope = pickString(compactionConfig, ["autoCompactionScope", "auto_compaction_scope", "autoCompactScope", "PICLAW_AUTO_COMPACTION_SCOPE"]);
const configCompactionHardCeilingPercent = pickNumber(compactionConfig, ["hardCeilingPercent", "hard_ceiling_percent", "compactionHardCeilingPercent", "PICLAW_COMPACTION_HARD_CEILING_PERCENT"]);
const configCompactionWarningThreshold = pickNumber(compactionConfig, ["warningThreshold", "warning_threshold", "repeatedWarningThreshold", "PICLAW_COMPACTION_WARNING_THRESHOLD"]);
const configCompactionBackoffDecayFactor = pickNumber(compactionConfig, ["backoffDecayFactor", "backoff_decay_factor", "PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR"]);
const configSystemPromptOverheadTokens = pickNumber(compactionConfig, ["systemPromptOverheadTokens", "system_prompt_overhead_tokens", "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS"]);
const configCompactionRequestOverheadTokens = pickNumber(compactionConfig, ["compactionRequestOverheadTokens", "compaction_request_overhead_tokens", "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS"]);
const configTokenEstimateSafetyMultiplier = pickNumber(compactionConfig, ["tokenEstimateSafetyMultiplier", "token_estimate_safety_multiplier", "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER"]);
const configProgressiveCompaction = pickBoolean(compactionConfig, ["progressiveCompaction", "progressive_compaction", "PICLAW_PROGRESSIVE_COMPACTION"]);
const configSmartCompactionReasoning = pickString(compactionConfig, ["smartCompactionReasoning", "smart_compaction_reasoning", "PICLAW_SMART_COMPACTION_REASONING"]);
const configRemoteCompactionEnabled = pickBoolean(compactionConfig, ["remoteCompactionEnabled", "remote_compaction_enabled"]);
const configRemoteCompactionTimeoutMs = pickNumber(compactionConfig, ["remoteCompactionTimeoutMs", "remote_compaction_timeout_ms"]);
/** Typed session-file safeguards grouped for runtime/session wiring. */
export interface SessionStorageConfig {
  maxSizeMb: number;
  maxSizeBytes: number;
  maxLines: number;
  maxCompactionsBeforeRotation: number;
  autoRotate: boolean;
}

export type AutoCompactionScope = "total" | "body_after_prefix";
export type SmartCompactionMethod = "selective" | "pipelined";

export interface CompactionRuntimeConfig {
  /** Piclaw-managed auto-compaction toggle. Independent from upstream AgentSession suppression. */
  autoCompactionEnabled: boolean;
  /** Processing method captured once at the start of each smart compaction. */
  smartCompactionMethod: SmartCompactionMethod;
  /** Optional provider/model used only for local smart compaction. Empty uses the active model. */
  compactionModel: string;
  /** Attempt explicitly supported provider-native compaction before the selected local method. */
  remoteCompactionEnabled: boolean;
  /** Provider-native compaction request deadline. */
  remoteCompactionTimeoutMs: number;
  timeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  progressWatchdogEnabled: boolean;
  progressWatchdogTimeoutMs: number;
  /** Context utilization % at which auto-compaction triggers (0-100). Default 80. */
  thresholdPercent: number;
  /** Optional absolute cap for auto-compaction threshold tokens. 0 disables; disabled by default. */
  maxThresholdTokens: number;
  /** Token-accounting scope for auto-compaction threshold checks. Default total. */
  autoCompactionScope: AutoCompactionScope;
  /** Full-window utilization % that always triggers compaction even for scoped growth. Default 100. */
  hardCeilingPercent: number;
  /** Emit a warning after this many successful auto-compactions in one chat. 0 disables. */
  warningThreshold: number;
  /** Multiplier applied to backoff duration after a successful compaction (0-1). Default 0.5. */
  backoffDecayFactor: number;
  /** Conservative token overhead reserved for system prompt/tools/skills. Default 4000. */
  systemPromptOverheadTokens: number;
  /** Conservative token overhead reserved for side-channel compaction requests. Default 1000. */
  compactionRequestOverheadTokens: number;
  /** Safety multiplier applied to estimated tokens. Default 1.1. */
  tokenEstimateSafetyMultiplier: number;
  /** Force progressive smart compaction. Default false. */
  progressiveCompaction: boolean;
  /** Optional default reasoning effort for smart compaction phases. Empty means phase defaults. */
  smartCompactionReasoning: string;
}

interface CompactionDomainConfig {
  autoCompactionEnabled: boolean;
  smartCompactionMethod: SmartCompactionMethod;
  model: string;
  remoteCompactionEnabled: boolean;
  remoteCompactionTimeoutMs: number;
  timeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  thresholdPercent: number;
  maxThresholdTokens: number;
  autoCompactionScope: AutoCompactionScope;
  hardCeilingPercent: number;
  warningThreshold: number;
  backoffDecayFactor: number;
  idleAutoCompactionDelayMs: number;
  prePromptForegroundMs: number;
  systemPromptOverheadTokens: number;
  compactionRequestOverheadTokens: number;
  tokenEstimateSafetyMultiplier: number;
  progressiveCompaction: boolean;
  smartCompactionReasoning: string;
}

function boundedNumberField(options: Omit<DomainConfigField<number>, "type" | "validate"> & { minExclusive?: number; minInclusive?: number; maxInclusive?: number }): DomainConfigField<number> {
  return {
    ...options,
    type: "number",
    validate(value: unknown) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric domain config value for ${options.key}`);
      if (options.minExclusive !== undefined && parsed <= options.minExclusive) throw new Error(`Domain config value below minimum for ${options.key}`);
      if (options.minInclusive !== undefined && parsed < options.minInclusive) throw new Error(`Domain config value below minimum for ${options.key}`);
      if (options.maxInclusive !== undefined && parsed > options.maxInclusive) throw new Error(`Domain config value above maximum for ${options.key}`);
      return parsed;
    },
  };
}

function parseSmartCompactionCompatibilityValue(raw: string): string | undefined {
  return raw.trim() ? normalizeSmartCompactionMethod(raw, "selective") : undefined;
}

function parseAutoCompactionScopeCompatibilityValue(raw: string): string | undefined {
  return raw.trim() ? normalizeAutoCompactionScope(raw, "total") : undefined;
}

function parseProgressiveCompactionCompatibilityValue(raw: string): boolean {
  return raw.trim() === "1";
}

const COMPACTION_REASONING_EFFORT_VALUES = ["", "minimal", "low", "medium", "high"] as const;

function normalizeCompactionModel(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const separator = normalized.indexOf("/");
  if (separator <= 0 || separator === normalized.length - 1) {
    throw new Error("Compaction model must use provider/model syntax");
  }
  return normalized;
}

function normalizeCompactionReasoningFallback(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if ((COMPACTION_REASONING_EFFORT_VALUES as readonly string[]).includes(normalized)) return normalized;
  throw new Error("Invalid smart compaction reasoning effort");
}

const compactionDomainSchema = registerDomainConfig<CompactionDomainConfig>({
  domain: "compaction",
  fields: {
    autoCompactionEnabled: boolField({ key: "autoCompactionEnabled", owner: "core", defaultValue: configAutoCompactionEnabled ?? true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_AUTO_COMPACTION_ENABLED", replacement: "domains.compaction.autoCompactionEnabled", removalVersion: "3.0.0", skipInvalid: true }] }),
    smartCompactionMethod: {
      ...stringField({ key: "smartCompactionMethod", owner: "core", defaultValue: normalizeSmartCompactionMethod(configSmartCompactionMethod, "selective"), allowedValues: ["selective", "pipelined"], persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SMART_COMPACTION_METHOD", replacement: "domains.compaction.smartCompactionMethod", removalVersion: "3.0.0", parse: parseSmartCompactionCompatibilityValue, skipInvalid: true }] }),
      validate: (value: unknown) => {
        if (value === undefined) throw new Error("Invalid smart compaction method");
        return normalizeSmartCompactionMethod(value, "selective");
      },
    } as DomainConfigField<SmartCompactionMethod>,
    model: {
      ...stringField({ key: "model", owner: "core", defaultValue: "", persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }),
      validate: normalizeCompactionModel,
    } as DomainConfigField<string>,
    remoteCompactionEnabled: boolField({ key: "remoteCompactionEnabled", owner: "core", defaultValue: configRemoteCompactionEnabled ?? false, persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }),
    remoteCompactionTimeoutMs: integerField({ key: "remoteCompactionTimeoutMs", owner: "core", defaultValue: Number.isFinite(configRemoteCompactionTimeoutMs) && (configRemoteCompactionTimeoutMs ?? 0) > 0 ? Math.round(Number(configRemoteCompactionTimeoutMs)) : 300_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none" }),
    timeoutMs: integerField({ key: "timeoutMs", owner: "core", defaultValue: Number.isFinite(configCompactionTimeoutMs) && (configCompactionTimeoutMs ?? 0) > 0 ? Math.round(Number(configCompactionTimeoutMs)) : 300_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_TIMEOUT_MS", replacement: "domains.compaction.timeoutMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    backoffBaseMs: integerField({ key: "backoffBaseMs", owner: "core", defaultValue: Number.isFinite(configCompactionBackoffBaseMs) && (configCompactionBackoffBaseMs ?? 0) > 0 ? Math.round(Number(configCompactionBackoffBaseMs)) : 15 * 60_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_BACKOFF_BASE_MS", replacement: "domains.compaction.backoffBaseMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    backoffMaxMs: integerField({ key: "backoffMaxMs", owner: "core", defaultValue: Number.isFinite(configCompactionBackoffMaxMs) && (configCompactionBackoffMaxMs ?? 0) > 0 ? Math.round(Number(configCompactionBackoffMaxMs)) : 6 * 60 * 60_000, min: 1, bounds: "positive integer ms; normalized >= backoffBaseMs", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_BACKOFF_MAX_MS", replacement: "domains.compaction.backoffMaxMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    thresholdPercent: boundedNumberField({ key: "thresholdPercent", owner: "core", defaultValue: typeof configCompactionThresholdPercent === "number" && configCompactionThresholdPercent > 0 && configCompactionThresholdPercent <= 100 ? configCompactionThresholdPercent : 80, minExclusive: 0, maxInclusive: 100, bounds: ">0..100 percent", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_THRESHOLD_PERCENT", replacement: "domains.compaction.thresholdPercent", removalVersion: "3.0.0", skipInvalid: true }] }),
    maxThresholdTokens: integerField({ key: "maxThresholdTokens", owner: "core", defaultValue: parseOptionalNonNegativeInt(configCompactionMaxThresholdTokens, 0), min: 0, bounds: "non-negative integer tokens", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS", replacement: "domains.compaction.maxThresholdTokens", removalVersion: "3.0.0", skipInvalid: true }] }),
    autoCompactionScope: {
      ...stringField({ key: "autoCompactionScope", owner: "core", defaultValue: normalizeAutoCompactionScope(configAutoCompactionScope, "total"), allowedValues: ["total", "body_after_prefix"], persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_AUTO_COMPACTION_SCOPE", replacement: "domains.compaction.autoCompactionScope", removalVersion: "3.0.0", parse: parseAutoCompactionScopeCompatibilityValue, skipInvalid: true }] }),
      validate: (value: unknown) => {
        if (value === undefined) throw new Error("Invalid auto-compaction scope");
        return normalizeAutoCompactionScope(value, "total");
      },
    } as DomainConfigField<AutoCompactionScope>,
    hardCeilingPercent: boundedNumberField({ key: "hardCeilingPercent", owner: "core", defaultValue: typeof configCompactionHardCeilingPercent === "number" && configCompactionHardCeilingPercent > 0 && configCompactionHardCeilingPercent <= 100 ? configCompactionHardCeilingPercent : 100, minExclusive: 0, maxInclusive: 100, bounds: ">0..100 percent", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_HARD_CEILING_PERCENT", replacement: "domains.compaction.hardCeilingPercent", removalVersion: "3.0.0", skipInvalid: true }] }),
    warningThreshold: integerField({ key: "warningThreshold", owner: "core", defaultValue: typeof configCompactionWarningThreshold === "number" && configCompactionWarningThreshold >= 0 ? Math.round(configCompactionWarningThreshold) : 3, min: 0, bounds: "non-negative integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_WARNING_THRESHOLD", replacement: "domains.compaction.warningThreshold", removalVersion: "3.0.0", skipInvalid: true }] }),
    backoffDecayFactor: boundedNumberField({ key: "backoffDecayFactor", owner: "core", defaultValue: typeof configCompactionBackoffDecayFactor === "number" && configCompactionBackoffDecayFactor > 0 && configCompactionBackoffDecayFactor <= 1 ? configCompactionBackoffDecayFactor : 0.5, minExclusive: 0, maxInclusive: 1, bounds: ">0..1", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR", replacement: "domains.compaction.backoffDecayFactor", removalVersion: "3.0.0", skipInvalid: true }] }),
    idleAutoCompactionDelayMs: integerField({ key: "idleAutoCompactionDelayMs", owner: "agent-runtime", defaultValue: 5_000, min: 0, bounds: "non-negative integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS", replacement: "domains.compaction.idleAutoCompactionDelayMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    prePromptForegroundMs: integerField({ key: "prePromptForegroundMs", owner: "web", defaultValue: 250, min: 0, bounds: "non-negative integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_PREPROMPT_COMPACTION_FOREGROUND_MS", replacement: "domains.compaction.prePromptForegroundMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    systemPromptOverheadTokens: integerField({ key: "systemPromptOverheadTokens", owner: "agent-runtime", defaultValue: typeof configSystemPromptOverheadTokens === "number" && configSystemPromptOverheadTokens > 0 ? Math.round(configSystemPromptOverheadTokens) : 4_000, min: 1, bounds: "positive integer tokens", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS", replacement: "domains.compaction.systemPromptOverheadTokens", removalVersion: "3.0.0", skipInvalid: true }] }),
    compactionRequestOverheadTokens: integerField({ key: "compactionRequestOverheadTokens", owner: "agent-runtime", defaultValue: typeof configCompactionRequestOverheadTokens === "number" && configCompactionRequestOverheadTokens > 0 ? Math.round(configCompactionRequestOverheadTokens) : 1_000, min: 1, bounds: "positive integer tokens", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS", replacement: "domains.compaction.compactionRequestOverheadTokens", removalVersion: "3.0.0", skipInvalid: true }] }),
    tokenEstimateSafetyMultiplier: boundedNumberField({ key: "tokenEstimateSafetyMultiplier", owner: "agent-runtime", defaultValue: typeof configTokenEstimateSafetyMultiplier === "number" && configTokenEstimateSafetyMultiplier >= 1 ? configTokenEstimateSafetyMultiplier : 1.1, minInclusive: 1, bounds: ">=1", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER", replacement: "domains.compaction.tokenEstimateSafetyMultiplier", removalVersion: "3.0.0", skipInvalid: true }] }),
    progressiveCompaction: boolField({ key: "progressiveCompaction", owner: "core", defaultValue: configProgressiveCompaction ?? false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_PROGRESSIVE_COMPACTION", replacement: "domains.compaction.progressiveCompaction", removalVersion: "3.0.0", parse: parseProgressiveCompactionCompatibilityValue, skipInvalid: true }] }),
    smartCompactionReasoning: {
      ...stringField({ key: "smartCompactionReasoning", owner: "core", defaultValue: configSmartCompactionReasoning === undefined ? "" : normalizeCompactionReasoningFallback(configSmartCompactionReasoning), allowedValues: COMPACTION_REASONING_EFFORT_VALUES, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SMART_COMPACTION_REASONING", replacement: "domains.compaction.smartCompactionReasoning", removalVersion: "3.0.0", parse: (raw) => raw.trim().toLowerCase(), skipInvalid: true }] }),
      validate: normalizeCompactionReasoningFallback,
    } as DomainConfigField<string>,
  },
});

let compactionDomainConfigOverride: CompactionDomainConfig | null = null;

function getCompactionDomainConfig(): CompactionDomainConfig {
  const resolved = compactionDomainConfigOverride ?? readDomainConfig(compactionDomainSchema, getDomainConfigOptions());
  return resolved.backoffMaxMs < resolved.backoffBaseMs
    ? { ...resolved, backoffMaxMs: resolved.backoffBaseMs }
    : { ...resolved };
}

/** Return idle auto-compaction delay resolved for this scheduling decision. */
export function getIdleAutoCompactionDelayMs(): number {
  return getCompactionDomainConfig().idleAutoCompactionDelayMs;
}

/** Return foreground pre-prompt compaction wait resolved for this web request. */
export function getPrePromptCompactionForegroundMs(): number {
  return getCompactionDomainConfig().prePromptForegroundMs;
}

export function getSystemPromptOverheadTokenConfig(): number {
  return getCompactionDomainConfig().systemPromptOverheadTokens;
}

export function getCompactionRequestOverheadTokenConfig(): number {
  return getCompactionDomainConfig().compactionRequestOverheadTokens;
}

export function getTokenEstimateSafetyMultiplierConfig(): number {
  return getCompactionDomainConfig().tokenEstimateSafetyMultiplier;
}

export function getProgressiveCompactionConfig(): boolean {
  return getCompactionDomainConfig().progressiveCompaction;
}

export function getSmartCompactionReasoningFallback(): string {
  return getCompactionDomainConfig().smartCompactionReasoning;
}

export type SessionIsolationLevel = "none" | "summary" | "full";

interface SessionDomainConfig {
  maxSizeMb: number;
  maxLines: number;
  maxCompactionsBeforeRotation: number;
  autoRotate: boolean;
  isolation: SessionIsolationLevel;
}

const sessionDomainSchema = registerDomainConfig<SessionDomainConfig>({
  domain: "session",
  fields: {
    maxSizeMb: integerField({ key: "maxSizeMb", owner: "session-runtime", defaultValue: configSessionMaxSizeMb ?? 32, min: 1, max: 256, bounds: "1..256 MiB", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_MAX_SIZE_MB", replacement: "domains.session.maxSizeMb", removalVersion: "3.0.0", skipInvalid: true }] }),
    maxLines: integerField({ key: "maxLines", owner: "session-runtime", defaultValue: configSessionMaxLines ?? 8000, min: 100, max: 50000, bounds: "100..50000 lines", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_MAX_LINES", replacement: "domains.session.maxLines", removalVersion: "3.0.0", skipInvalid: true }] }),
    maxCompactionsBeforeRotation: integerField({ key: "maxCompactionsBeforeRotation", owner: "session-runtime", defaultValue: configSessionMaxCompactions ?? 3, min: 1, max: 20, bounds: "1..20 compactions", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_MAX_COMPACTIONS", replacement: "domains.session.maxCompactionsBeforeRotation", removalVersion: "3.0.0", skipInvalid: true }] }),
    autoRotate: boolField({ key: "autoRotate", owner: "session-runtime", defaultValue: configSessionAutoRotate ?? true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_AUTO_ROTATE", replacement: "domains.session.autoRotate", removalVersion: "3.0.0", skipInvalid: true }] }),
    isolation: stringField({ key: "isolation", owner: "session-runtime", defaultValue: "none", allowedValues: ["none", "summary", "full"], persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_ISOLATION", replacement: "domains.session.isolation", removalVersion: "3.0.0", parse: (raw) => raw.trim().toLowerCase(), skipInvalid: true }] }) as DomainConfigField<SessionIsolationLevel>,
  },
});

function toSessionStorageConfig(config: SessionDomainConfig): SessionStorageConfig {
  return {
    maxSizeMb: config.maxSizeMb,
    maxSizeBytes: config.maxSizeMb * 1024 * 1024,
    maxLines: config.maxLines,
    maxCompactionsBeforeRotation: config.maxCompactionsBeforeRotation,
    autoRotate: config.autoRotate,
  };
}

const SESSION_DOMAIN_CONFIG = readDomainConfig(sessionDomainSchema, getDomainConfigOptions());

/** Grouped session-file safeguards. */
export let SESSION_STORAGE_CONFIG = Object.freeze<SessionStorageConfig>(toSessionStorageConfig(SESSION_DOMAIN_CONFIG));

/** Return grouped session-file safeguards for runtime wiring and tests. */
export function getSessionStorageConfig(): Readonly<SessionStorageConfig> {
  return SESSION_STORAGE_CONFIG;
}

/** Persist and apply session storage settings so new turns use them immediately. */
export function setSessionStorageConfig(patch: { maxSizeMb?: number; maxLines?: number; maxCompactionsBeforeRotation?: number; autoRotate?: boolean }): Readonly<SessionStorageConfig> {
  const nextMaxSizeMb = Number.isFinite(patch.maxSizeMb)
    ? Math.min(256, Math.max(1, Math.round(Number(patch.maxSizeMb))))
    : SESSION_STORAGE_CONFIG.maxSizeMb;
  const nextAutoRotate = typeof patch.autoRotate === "boolean"
    ? patch.autoRotate
    : SESSION_STORAGE_CONFIG.autoRotate;
  const nextMaxLines = Number.isFinite(patch.maxLines)
    ? Math.min(50000, Math.max(100, Math.round(Number(patch.maxLines))))
    : SESSION_STORAGE_CONFIG.maxLines;
  const nextMaxCompactions = Number.isFinite(patch.maxCompactionsBeforeRotation)
    ? Math.min(20, Math.max(1, Math.round(Number(patch.maxCompactionsBeforeRotation))))
    : SESSION_STORAGE_CONFIG.maxCompactionsBeforeRotation;

  const resolved = writeDomainConfig(sessionDomainSchema, getDomainConfigOptions(), {
    maxSizeMb: nextMaxSizeMb,
    autoRotate: nextAutoRotate,
    maxLines: nextMaxLines,
    maxCompactionsBeforeRotation: nextMaxCompactions,
  });
  Object.assign(SESSION_DOMAIN_CONFIG, resolved);
  SESSION_STORAGE_CONFIG = Object.freeze<SessionStorageConfig>(toSessionStorageConfig(resolved));
  return SESSION_STORAGE_CONFIG;
}

/** Return the effective cross-session isolation policy. */
export function getSessionIsolationLevel(): SessionIsolationLevel {
  return SESSION_DOMAIN_CONFIG.isolation;
}

/** Persist and apply cross-session isolation without mutating compatibility env aliases. */
export function setSessionIsolationLevel(level: SessionIsolationLevel): SessionIsolationLevel {
  const resolved = writeDomainConfigField(sessionDomainSchema, getDomainConfigOptions(), "isolation", level);
  Object.assign(SESSION_DOMAIN_CONFIG, resolved);
  return resolved.isolation;
}

export interface SessionPersistenceConfig {
  filePreloadSanitizeMinBytes: number;
  toolResultMaxPersistBytes: number;
  toolResultPreviewChars: number;
}

const sessionPersistenceDomainSchema = registerDomainConfig<SessionPersistenceConfig>({
  domain: "sessionPersistence",
  fields: {
    filePreloadSanitizeMinBytes: integerField({ key: "filePreloadSanitizeMinBytes", owner: "session-runtime", defaultValue: 1024 * 1024, min: 1, bounds: "positive integer bytes", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES", replacement: "domains.sessionPersistence.filePreloadSanitizeMinBytes", removalVersion: "3.0.0", skipInvalid: true }] }),
    toolResultMaxPersistBytes: integerField({ key: "toolResultMaxPersistBytes", owner: "session-runtime", defaultValue: 256 * 1024, min: 1, bounds: "positive integer bytes", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_TOOL_RESULT_MAX_PERSIST_BYTES", replacement: "domains.sessionPersistence.toolResultMaxPersistBytes", removalVersion: "3.0.0", skipInvalid: true }] }),
    toolResultPreviewChars: integerField({ key: "toolResultPreviewChars", owner: "session-runtime", defaultValue: 4096, min: 1, bounds: "positive integer characters", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_TOOL_RESULT_PREVIEW_CHARS", replacement: "domains.sessionPersistence.toolResultPreviewChars", removalVersion: "3.0.0", skipInvalid: true }] }),
  },
});

const SESSION_PERSISTENCE_CONFIG = Object.freeze<SessionPersistenceConfig>(
  readDomainConfig(sessionPersistenceDomainSchema, getDomainConfigOptions()),
);

/** Return session persistence sanitization limits captured at module startup. */
export function getSessionPersistenceConfig(): Readonly<SessionPersistenceConfig> {
  return SESSION_PERSISTENCE_CONFIG;
}

export interface RecoveryPolicyConfig {
  loopGuardEnabled: boolean;
  loopGuardMaxFailures: number;
  loopGuardWindowMs: number;
  automaticRecoveryEnabled: boolean;
  transientRecoveryEnabled: boolean;
  transientRecoveryToolsEnabled: boolean;
  /** Zero inherits the normalized retry max-attempt setting. */
  automaticRecoveryMaxAttempts: number;
  automaticRecoveryTotalBudgetMs: number;
}

const recoveryPolicyDomainSchema = registerDomainConfig<RecoveryPolicyConfig>({
  domain: "recovery",
  fields: {
    loopGuardEnabled: boolField({ key: "loopGuardEnabled", owner: "agent-runtime", defaultValue: true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_RECOVERY_LOOP_GUARD_ENABLED", replacement: "domains.recovery.loopGuardEnabled", removalVersion: "3.0.0", skipInvalid: true }] }),
    loopGuardMaxFailures: integerField({ key: "loopGuardMaxFailures", owner: "agent-runtime", defaultValue: 3, min: 1, bounds: "positive integer failures", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_RECOVERY_LOOP_GUARD_MAX_FAILURES", replacement: "domains.recovery.loopGuardMaxFailures", removalVersion: "3.0.0", skipInvalid: true }] }),
    loopGuardWindowMs: integerField({ key: "loopGuardWindowMs", owner: "agent-runtime", defaultValue: 10 * 60 * 1000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_RECOVERY_LOOP_GUARD_WINDOW_MS", replacement: "domains.recovery.loopGuardWindowMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    automaticRecoveryEnabled: boolField({ key: "automaticRecoveryEnabled", owner: "agent-runtime", defaultValue: true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TURN_AUTO_RECOVERY_ENABLED", replacement: "domains.recovery.automaticRecoveryEnabled", removalVersion: "3.0.0", skipInvalid: true }] }),
    transientRecoveryEnabled: boolField({ key: "transientRecoveryEnabled", owner: "agent-runtime", defaultValue: true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TURN_TRANSIENT_RECOVERY_ENABLED", replacement: "domains.recovery.transientRecoveryEnabled", removalVersion: "3.0.0", skipInvalid: true }] }),
    transientRecoveryToolsEnabled: boolField({ key: "transientRecoveryToolsEnabled", owner: "agent-runtime", defaultValue: false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED", replacement: "domains.recovery.transientRecoveryToolsEnabled", removalVersion: "3.0.0", skipInvalid: true }] }),
    automaticRecoveryMaxAttempts: integerField({ key: "automaticRecoveryMaxAttempts", owner: "agent-runtime", defaultValue: 0, min: 0, bounds: "0 inherits retry max; otherwise positive integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS", replacement: "domains.recovery.automaticRecoveryMaxAttempts", removalVersion: "3.0.0", parse: (raw) => { const parsed = Number(raw); return Number.isInteger(parsed) && parsed > 0 ? parsed : -1; }, skipInvalid: true }] }),
    automaticRecoveryTotalBudgetMs: integerField({ key: "automaticRecoveryTotalBudgetMs", owner: "agent-runtime", defaultValue: 360_000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS", replacement: "domains.recovery.automaticRecoveryTotalBudgetMs", removalVersion: "3.0.0", skipInvalid: true }] }),
  },
});

/** Return recovery-loop and automatic-recovery policy resolved for this attempt. */
export function getRecoveryPolicyConfig(): Readonly<RecoveryPolicyConfig> {
  return readDomainConfig(recoveryPolicyDomainSchema, getDomainConfigOptions());
}

export type AutomaticRecoveryPolicyPatch = Partial<Pick<RecoveryPolicyConfig,
  "automaticRecoveryEnabled" | "automaticRecoveryMaxAttempts" | "automaticRecoveryTotalBudgetMs"
>>;

/** Persist automatic-recovery policy without rewriting compatibility environment variables. */
export function setAutomaticRecoveryPolicyConfig(patch: AutomaticRecoveryPolicyPatch): Readonly<RecoveryPolicyConfig> {
  const current = getRecoveryPolicyConfig();
  const nextEnabled = patch.automaticRecoveryEnabled === undefined
    ? current.automaticRecoveryEnabled
    : patch.automaticRecoveryEnabled;
  if (typeof nextEnabled !== "boolean") throw new Error("automaticRecoveryEnabled must be boolean");

  const nextMaxAttempts = patch.automaticRecoveryMaxAttempts === undefined
    ? current.automaticRecoveryMaxAttempts
    : patch.automaticRecoveryMaxAttempts;
  if (!Number.isInteger(nextMaxAttempts) || nextMaxAttempts < 0) {
    throw new Error("automaticRecoveryMaxAttempts must be a non-negative integer");
  }

  const nextTotalBudgetMs = patch.automaticRecoveryTotalBudgetMs === undefined
    ? current.automaticRecoveryTotalBudgetMs
    : patch.automaticRecoveryTotalBudgetMs;
  if (!Number.isInteger(nextTotalBudgetMs) || nextTotalBudgetMs < 1) {
    throw new Error("automaticRecoveryTotalBudgetMs must be a positive integer");
  }

  return writeDomainConfig(recoveryPolicyDomainSchema, getDomainConfigOptions(), {
    automaticRecoveryEnabled: nextEnabled,
    automaticRecoveryMaxAttempts: nextMaxAttempts,
    automaticRecoveryTotalBudgetMs: nextTotalBudgetMs,
  });
}

export interface WebRecoveryConfig {
  stalePreflightRecoveryMs: number;
  stalePreflightBackoffMs: number;
}

const webRecoveryDomainSchema = registerDomainConfig<WebRecoveryConfig>({
  domain: "webRecovery",
  fields: {
    stalePreflightRecoveryMs: integerField({ key: "stalePreflightRecoveryMs", owner: "web", defaultValue: 4 * 60 * 1000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_STALE_PREFLIGHT_RECOVERY_MS", replacement: "domains.webRecovery.stalePreflightRecoveryMs", removalVersion: "3.0.0", skipInvalid: true }] }),
    stalePreflightBackoffMs: integerField({ key: "stalePreflightBackoffMs", owner: "web", defaultValue: 4 * 60 * 60 * 1000, min: 1, bounds: "positive integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_STALE_PREFLIGHT_BACKOFF_MS", replacement: "domains.webRecovery.stalePreflightBackoffMs", removalVersion: "3.0.0", skipInvalid: true }] }),
  },
});

/** Return stale-preflight recovery timing policy resolved for this scan. */
export function getWebRecoveryConfig(): Readonly<WebRecoveryConfig> {
  return readDomainConfig(webRecoveryDomainSchema, getDomainConfigOptions());
}

export interface ProgressWatchdogConfig {
  enabled: boolean;
  timeoutMs: number;
  escalateOnStall: boolean;
  externalMonitorEnabled: boolean;
}

const progressWatchdogDomainSchema = registerDomainConfig<ProgressWatchdogConfig>({
  domain: "watchdog",
  fields: {
    enabled: boolField({ key: "enabled", owner: "core", defaultValue: configProgressWatchdogEnabled ?? false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_PROGRESS_WATCHDOG_ENABLED", replacement: "domains.watchdog.enabled", removalVersion: "3.0.0", skipInvalid: true }] }),
    timeoutMs: integerField({ key: "timeoutMs", owner: "core", defaultValue: Number.isFinite(configProgressWatchdogTimeoutMs) ? Math.max(0, Math.round(Number(configProgressWatchdogTimeoutMs))) : 300_000, min: 0, bounds: "non-negative integer ms", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS", replacement: "domains.watchdog.timeoutMs", removalVersion: "3.0.0", parse: (raw) => { const normalized = raw.trim().toLowerCase(); if (["off", "false", "disabled", "no"].includes(normalized)) return 0; return Number(raw); }, skipInvalid: true }] }),
    escalateOnStall: boolField({ key: "escalateOnStall", owner: "core", defaultValue: false, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
      { envKey: "PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL", replacement: "domains.watchdog.escalateOnStall", removalVersion: "3.0.0", parse: (raw) => ["1", "true", "yes", "on", "restart", "exit"].includes(raw.trim().toLowerCase()), skipInvalid: true },
      { envKey: "PICLAW_PROGRESS_WATCHDOG_ESCALATE_ON_STALL", replacement: "domains.watchdog.escalateOnStall", removalVersion: "3.0.0", parse: (raw) => ["1", "true", "yes", "on", "restart", "exit"].includes(raw.trim().toLowerCase()), skipInvalid: true },
    ] }),
    externalMonitorEnabled: boolField({ key: "externalMonitorEnabled", owner: "core", defaultValue: true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_EXTERNAL_PROGRESS_WATCHDOG", replacement: "domains.watchdog.externalMonitorEnabled", removalVersion: "3.0.0", parse: (raw) => !["0", "false", "off", "disabled", "no"].includes(raw.trim().toLowerCase()), skipInvalid: true }] }),
  },
});

let progressWatchdogConfigOverride: Partial<Pick<ProgressWatchdogConfig, "enabled" | "timeoutMs">> | null = null;

/** Return progress-watchdog policy resolved for the current operation. */
export function getProgressWatchdogConfig(): Readonly<ProgressWatchdogConfig> {
  return Object.freeze({
    ...readDomainConfig(progressWatchdogDomainSchema, getDomainConfigOptions()),
    ...(progressWatchdogConfigOverride ?? {}),
  });
}

/** Authoritative completed tool-execution budget for one user turn. */
export let TOOL_USE_BUDGET = AGENT_DOMAIN_CONFIG.toolUseMessageBudget;
/** @deprecated Use TOOL_USE_BUDGET; retained for API compatibility. */
export let TOOL_USE_MESSAGE_BUDGET = TOOL_USE_BUDGET;

export function getToolUseBudget(): number {
  return readDomainConfig(agentRuntimeDomainSchema, getDomainConfigOptions()).toolUseMessageBudget;
}

/** @deprecated Use getToolUseBudget(); the setting counts completed tool executions. */
export function getToolUseMessageBudget(): number {
  return getToolUseBudget();
}

/** @deprecated The former per-attempt ceiling is now the authoritative per-turn budget. */
export function getMidTurnToolExecutionHardCeiling(): number {
  return getToolUseBudget();
}

/** Persist and apply the authoritative tool-execution budget for subsequent turns. */
export function setToolUseBudget(budget: number): number {
  const nextBudget = Number.isFinite(budget)
    ? Math.min(512, Math.max(8, Math.round(Number(budget))))
    : TOOL_USE_BUDGET;
  const resolved = writeDomainConfigField(
    agentRuntimeDomainSchema,
    getDomainConfigOptions(),
    "toolUseMessageBudget",
    nextBudget,
  );
  Object.assign(AGENT_DOMAIN_CONFIG, resolved);
  TOOL_USE_BUDGET = resolved.toolUseMessageBudget;
  TOOL_USE_MESSAGE_BUDGET = TOOL_USE_BUDGET;
  return TOOL_USE_BUDGET;
}

/** @deprecated Use setToolUseBudget(); retained for API compatibility. */
export function setToolUseMessageBudget(budget: number): number {
  return setToolUseBudget(budget);
}

function parseOptionalNonNegativeInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.round(parsed));
}

function parsePositiveDurationMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
}

function parseOptionalNonNegativeDurationMs(value: unknown, fallback: number): number {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (trimmed && ["0", "off", "false", "disabled", "no"].includes(trimmed)) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
}

export function normalizeSmartCompactionMethod(
  value: unknown,
  fallback: SmartCompactionMethod = "selective",
): SmartCompactionMethod {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "traditional_pipelined" || normalized === "pipelined") return "pipelined";
  if (normalized === "selective") return "selective";
  return fallback;
}

function normalizeAutoCompactionScope(value: unknown, fallback: AutoCompactionScope): AutoCompactionScope {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "body_after_prefix" || normalized === "bodyafterprefix") return "body_after_prefix";
  if (normalized === "total") return "total";
  return fallback;
}

function parsePercentWithBounds(value: unknown, fallback: number, minExclusive = 0, maxInclusive = 100): number {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= minExclusive || parsed > maxInclusive) return fallback;
  return parsed;
}

export function enforceProgressWatchdogSafety(config: CompactionRuntimeConfig): CompactionRuntimeConfig {
  // Watchdog supervision is opt-in. The in-process compaction timeout remains
  // independent, and callers may keep a timeout value configured while the
  // watchdog is disabled.
  return config;
}

export function getProgressWatchdogSafetyWarning(): string | null {
  return null;
}

export function getCompactionRuntimeConfig(): Readonly<CompactionRuntimeConfig> {
  const domain = getCompactionDomainConfig();
  const resolved: CompactionRuntimeConfig = {
    autoCompactionEnabled: domain.autoCompactionEnabled,
    smartCompactionMethod: domain.smartCompactionMethod,
    compactionModel: domain.model,
    remoteCompactionEnabled: domain.remoteCompactionEnabled,
    remoteCompactionTimeoutMs: domain.remoteCompactionTimeoutMs,
    timeoutMs: domain.timeoutMs,
    backoffBaseMs: domain.backoffBaseMs,
    backoffMaxMs: domain.backoffMaxMs,
    progressWatchdogEnabled: getProgressWatchdogConfig().enabled,
    progressWatchdogTimeoutMs: getProgressWatchdogConfig().timeoutMs,
    thresholdPercent: domain.thresholdPercent,
    maxThresholdTokens: domain.maxThresholdTokens,
    autoCompactionScope: domain.autoCompactionScope,
    hardCeilingPercent: domain.hardCeilingPercent,
    warningThreshold: domain.warningThreshold,
    backoffDecayFactor: domain.backoffDecayFactor,
    systemPromptOverheadTokens: domain.systemPromptOverheadTokens,
    compactionRequestOverheadTokens: domain.compactionRequestOverheadTokens,
    tokenEstimateSafetyMultiplier: domain.tokenEstimateSafetyMultiplier,
    progressiveCompaction: domain.progressiveCompaction,
    smartCompactionReasoning: domain.smartCompactionReasoning,
  };
  // Preserve the backoff ordering invariant for direct environment/config-file
  // overrides just as the settings setter does. A max below the base would
  // otherwise shorten the very first failure delay and collapse the series.
  if (resolved.backoffMaxMs < resolved.backoffBaseMs) {
    resolved.backoffMaxMs = resolved.backoffBaseMs;
  }
  return Object.freeze(enforceProgressWatchdogSafety(resolved));
}

export interface CompactionRuntimeConfigPatch {
  autoCompactionEnabled?: boolean;
  smartCompactionMethod?: SmartCompactionMethod;
  compactionModel?: string;
  remoteCompactionEnabled?: boolean;
  remoteCompactionTimeoutMs?: number;
  timeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  progressWatchdogEnabled?: boolean;
  progressWatchdogTimeoutMs?: number;
  thresholdPercent?: number;
  maxThresholdTokens?: number;
  autoCompactionScope?: AutoCompactionScope;
  hardCeilingPercent?: number;
  warningThreshold?: number;
  backoffDecayFactor?: number;
  systemPromptOverheadTokens?: number;
  compactionRequestOverheadTokens?: number;
  tokenEstimateSafetyMultiplier?: number;
  progressiveCompaction?: boolean;
  smartCompactionReasoning?: string;
}

function applyCompactionRuntimeConfig(
  patch: CompactionRuntimeConfigPatch,
  persist: boolean,
): Readonly<CompactionRuntimeConfig> {
  const current = getCompactionRuntimeConfig();
  const next: CompactionRuntimeConfig = {
    autoCompactionEnabled: typeof patch.autoCompactionEnabled === "boolean"
      ? patch.autoCompactionEnabled
      : current.autoCompactionEnabled,
    smartCompactionMethod: patch.smartCompactionMethod === undefined
      ? current.smartCompactionMethod
      : normalizeSmartCompactionMethod(patch.smartCompactionMethod, current.smartCompactionMethod),
    compactionModel: patch.compactionModel === undefined ? current.compactionModel : String(patch.compactionModel).trim(),
    remoteCompactionEnabled: typeof patch.remoteCompactionEnabled === "boolean"
      ? patch.remoteCompactionEnabled
      : current.remoteCompactionEnabled,
    remoteCompactionTimeoutMs: patch.remoteCompactionTimeoutMs === undefined
      ? current.remoteCompactionTimeoutMs
      : parsePositiveDurationMs(patch.remoteCompactionTimeoutMs, current.remoteCompactionTimeoutMs),
    timeoutMs: patch.timeoutMs === undefined ? current.timeoutMs : parsePositiveDurationMs(patch.timeoutMs, current.timeoutMs),
    backoffBaseMs: patch.backoffBaseMs === undefined ? current.backoffBaseMs : parsePositiveDurationMs(patch.backoffBaseMs, current.backoffBaseMs),
    backoffMaxMs: patch.backoffMaxMs === undefined ? current.backoffMaxMs : parsePositiveDurationMs(patch.backoffMaxMs, current.backoffMaxMs),
    progressWatchdogEnabled: typeof patch.progressWatchdogEnabled === "boolean"
      ? patch.progressWatchdogEnabled
      : current.progressWatchdogEnabled,
    progressWatchdogTimeoutMs: patch.progressWatchdogTimeoutMs === undefined
      ? current.progressWatchdogTimeoutMs
      : parseOptionalNonNegativeDurationMs(patch.progressWatchdogTimeoutMs, current.progressWatchdogTimeoutMs),
    thresholdPercent: typeof patch.thresholdPercent === "number" && patch.thresholdPercent > 0 && patch.thresholdPercent <= 100
      ? patch.thresholdPercent
      : current.thresholdPercent,
    maxThresholdTokens: patch.maxThresholdTokens === undefined
      ? current.maxThresholdTokens
      : parseOptionalNonNegativeInt(patch.maxThresholdTokens, current.maxThresholdTokens),
    autoCompactionScope: patch.autoCompactionScope === undefined
      ? current.autoCompactionScope
      : normalizeAutoCompactionScope(patch.autoCompactionScope, current.autoCompactionScope),
    hardCeilingPercent: patch.hardCeilingPercent === undefined
      ? current.hardCeilingPercent
      : parsePercentWithBounds(patch.hardCeilingPercent, current.hardCeilingPercent),
    warningThreshold: patch.warningThreshold === undefined
      ? current.warningThreshold
      : parseOptionalNonNegativeDurationMs(patch.warningThreshold, current.warningThreshold),
    backoffDecayFactor: typeof patch.backoffDecayFactor === "number" && patch.backoffDecayFactor > 0 && patch.backoffDecayFactor <= 1
      ? patch.backoffDecayFactor
      : current.backoffDecayFactor,
    systemPromptOverheadTokens: patch.systemPromptOverheadTokens === undefined
      ? current.systemPromptOverheadTokens
      : parseOptionalNonNegativeInt(patch.systemPromptOverheadTokens, current.systemPromptOverheadTokens) || current.systemPromptOverheadTokens,
    compactionRequestOverheadTokens: patch.compactionRequestOverheadTokens === undefined
      ? current.compactionRequestOverheadTokens
      : parseOptionalNonNegativeInt(patch.compactionRequestOverheadTokens, current.compactionRequestOverheadTokens) || current.compactionRequestOverheadTokens,
    tokenEstimateSafetyMultiplier: typeof patch.tokenEstimateSafetyMultiplier === "number" && patch.tokenEstimateSafetyMultiplier >= 1
      ? patch.tokenEstimateSafetyMultiplier
      : current.tokenEstimateSafetyMultiplier,
    progressiveCompaction: typeof patch.progressiveCompaction === "boolean"
      ? patch.progressiveCompaction
      : current.progressiveCompaction,
    smartCompactionReasoning: patch.smartCompactionReasoning === undefined
      ? current.smartCompactionReasoning
      : normalizeCompactionReasoningFallback(patch.smartCompactionReasoning),
  };

  if (next.backoffMaxMs < next.backoffBaseMs) {
    next.backoffMaxMs = next.backoffBaseMs;
  }

  if (persist) {
    const config = readJsonConfig(getConfigPath());
    const compaction =
      config.compaction && typeof config.compaction === "object"
        ? { ...(config.compaction as Record<string, unknown>) }
        : {};
    const clearKeys = [
      "autoCompactionEnabled",
      "auto_compaction_enabled",
      "PICLAW_AUTO_COMPACTION_ENABLED",
      "smartCompactionMethod",
      "smart_compaction_method",
      "PICLAW_SMART_COMPACTION_METHOD",
      "model",
      "compactionModel",
      "compaction_model",
      "remoteCompactionEnabled",
      "remote_compaction_enabled",
      "remoteCompactionTimeoutMs",
      "remote_compaction_timeout_ms",
      "timeoutMs",
      "timeout_ms",
      "compactionTimeoutMs",
      "backoffBaseMs",
      "backoff_base_ms",
      "compactionBackoffBaseMs",
      "backoffMaxMs",
      "backoff_max_ms",
      "compactionBackoffMaxMs",
      "progressWatchdogEnabled",
      "progress_watchdog_enabled",
      "watchdogEnabled",
      "progressWatchdogTimeoutMs",
      "progress_watchdog_timeout_ms",
      "watchdogTimeoutMs",
      "PICLAW_PROGRESS_WATCHDOG_ENABLED",
      "PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS",
      "thresholdPercent",
      "threshold_percent",
      "PICLAW_COMPACTION_THRESHOLD_PERCENT",
      "maxThresholdTokens",
      "max_threshold_tokens",
      "compactionMaxThresholdTokens",
      "PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS",
      "autoCompactionScope",
      "auto_compaction_scope",
      "autoCompactScope",
      "PICLAW_AUTO_COMPACTION_SCOPE",
      "hardCeilingPercent",
      "hard_ceiling_percent",
      "compactionHardCeilingPercent",
      "PICLAW_COMPACTION_HARD_CEILING_PERCENT",
      "warningThreshold",
      "warning_threshold",
      "repeatedWarningThreshold",
      "PICLAW_COMPACTION_WARNING_THRESHOLD",
      "backoffDecayFactor",
      "backoff_decay_factor",
      "PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR",
      "PICLAW_COMPACTION_TIMEOUT_MS",
      "PICLAW_COMPACTION_BACKOFF_BASE_MS",
      "PICLAW_COMPACTION_BACKOFF_MAX_MS",
      "systemPromptOverheadTokens",
      "system_prompt_overhead_tokens",
      "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS",
      "compactionRequestOverheadTokens",
      "compaction_request_overhead_tokens",
      "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS",
      "tokenEstimateSafetyMultiplier",
      "token_estimate_safety_multiplier",
      "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER",
      "progressiveCompaction",
      "progressive_compaction",
      "PICLAW_PROGRESSIVE_COMPACTION",
      "smartCompactionReasoning",
      "smart_compaction_reasoning",
      "PICLAW_SMART_COMPACTION_REASONING",
    ];
    for (const key of clearKeys) {
      delete compaction[key];
      delete config[key];
    }
    config.compaction = compaction;
    writeJsonConfig(getConfigPath(), config);
  }

  const compactionDomainPatch: CompactionDomainConfig = {
    autoCompactionEnabled: next.autoCompactionEnabled,
    smartCompactionMethod: next.smartCompactionMethod,
    model: next.compactionModel,
    remoteCompactionEnabled: next.remoteCompactionEnabled,
    remoteCompactionTimeoutMs: next.remoteCompactionTimeoutMs,
    timeoutMs: next.timeoutMs,
    backoffBaseMs: next.backoffBaseMs,
    backoffMaxMs: next.backoffMaxMs,
    thresholdPercent: next.thresholdPercent,
    maxThresholdTokens: next.maxThresholdTokens,
    autoCompactionScope: next.autoCompactionScope,
    hardCeilingPercent: next.hardCeilingPercent,
    warningThreshold: next.warningThreshold,
    backoffDecayFactor: next.backoffDecayFactor,
    idleAutoCompactionDelayMs: getCompactionDomainConfig().idleAutoCompactionDelayMs,
    prePromptForegroundMs: getCompactionDomainConfig().prePromptForegroundMs,
    systemPromptOverheadTokens: next.systemPromptOverheadTokens,
    compactionRequestOverheadTokens: next.compactionRequestOverheadTokens,
    tokenEstimateSafetyMultiplier: next.tokenEstimateSafetyMultiplier,
    progressiveCompaction: next.progressiveCompaction,
    smartCompactionReasoning: next.smartCompactionReasoning,
  };
  if (persist) {
    const resolvedDomain = writeDomainConfig(compactionDomainSchema, getDomainConfigOptions(), compactionDomainPatch);
    compactionDomainConfigOverride = null;
    Object.assign(next, getCompactionDomainConfig(), resolvedDomain);
    if (next.backoffMaxMs < next.backoffBaseMs) next.backoffMaxMs = next.backoffBaseMs;
  } else if (!persist) {
    compactionDomainConfigOverride = {
      autoCompactionEnabled: next.autoCompactionEnabled,
      smartCompactionMethod: next.smartCompactionMethod,
      model: next.compactionModel,
      remoteCompactionEnabled: next.remoteCompactionEnabled,
      remoteCompactionTimeoutMs: next.remoteCompactionTimeoutMs,
      timeoutMs: next.timeoutMs,
      backoffBaseMs: next.backoffBaseMs,
      backoffMaxMs: next.backoffMaxMs,
      thresholdPercent: next.thresholdPercent,
      maxThresholdTokens: next.maxThresholdTokens,
      autoCompactionScope: next.autoCompactionScope,
      hardCeilingPercent: next.hardCeilingPercent,
      warningThreshold: next.warningThreshold,
      backoffDecayFactor: next.backoffDecayFactor,
      idleAutoCompactionDelayMs: getCompactionDomainConfig().idleAutoCompactionDelayMs,
      prePromptForegroundMs: getCompactionDomainConfig().prePromptForegroundMs,
      systemPromptOverheadTokens: next.systemPromptOverheadTokens,
      compactionRequestOverheadTokens: next.compactionRequestOverheadTokens,
      tokenEstimateSafetyMultiplier: next.tokenEstimateSafetyMultiplier,
      progressiveCompaction: next.progressiveCompaction,
      smartCompactionReasoning: next.smartCompactionReasoning,
    };
  }

  if (persist && (patch.progressWatchdogEnabled !== undefined || patch.progressWatchdogTimeoutMs !== undefined)) {
    const resolvedWatchdog = writeDomainConfig(progressWatchdogDomainSchema, getDomainConfigOptions(), {
      ...(patch.progressWatchdogEnabled !== undefined ? { enabled: next.progressWatchdogEnabled } : {}),
      ...(patch.progressWatchdogTimeoutMs !== undefined ? { timeoutMs: next.progressWatchdogTimeoutMs } : {}),
    });
    progressWatchdogConfigOverride = null;
    next.progressWatchdogEnabled = resolvedWatchdog.enabled;
    next.progressWatchdogTimeoutMs = resolvedWatchdog.timeoutMs;
  } else if (!persist) {
    progressWatchdogConfigOverride = {
      enabled: next.progressWatchdogEnabled,
      timeoutMs: next.progressWatchdogTimeoutMs,
    };
  }

  return getCompactionRuntimeConfig();
}

export function setCompactionRuntimeConfig(
  patch: CompactionRuntimeConfigPatch,
): Readonly<CompactionRuntimeConfig> {
  return applyCompactionRuntimeConfig(patch, true);
}

/** Test-only runtime override that cannot rewrite the workspace config file. */
export function resetCompactionRuntimeConfigForTests(): void {
  if (process.env.PICLAW_DB_IN_MEMORY !== "1" && process.env.NODE_ENV !== "test") {
    throw new Error("resetCompactionRuntimeConfigForTests requires a test runtime");
  }
  compactionDomainConfigOverride = null;
  progressWatchdogConfigOverride = null;
}

export function setCompactionRuntimeConfigForTests(
  patch: CompactionRuntimeConfigPatch,
): Readonly<CompactionRuntimeConfig> {
  if (process.env.PICLAW_DB_IN_MEMORY !== "1" && process.env.NODE_ENV !== "test") {
    throw new Error("setCompactionRuntimeConfigForTests requires a test runtime");
  }
  const envKeys = [
    "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS",
    "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS",
    "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER",
    "PICLAW_PROGRESSIVE_COMPACTION",
    "PICLAW_SMART_COMPACTION_REASONING",
  ];
  for (const key of envKeys) delete process.env[key];
  const result = applyCompactionRuntimeConfig(patch, false);
  // Prevent process-env precedence from leaking this test override into later
  // module reloads; in-memory tests use the domain overrides directly.
  for (const key of envKeys) delete process.env[key];
  return result;
}
