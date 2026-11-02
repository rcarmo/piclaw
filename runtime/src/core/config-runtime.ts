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
    mainSessionPoolMaxSize: integerField({ key: "mainSessionPoolMaxSize", owner: "agent-runtime", defaultValue: 4, min: 0, bounds: "non-negative integer", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [
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
const configAutoCompactionEnabled = pickBoolean(compactionConfig, [
  "autoCompactionEnabled",
  "auto_compaction_enabled",
  "PICLAW_AUTO_COMPACTION_ENABLED",
]);
const configSystemPromptOverheadTokens = pickNumber(compactionConfig, ["systemPromptOverheadTokens", "system_prompt_overhead_tokens", "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS"]);
const configCompactionRequestOverheadTokens = pickNumber(compactionConfig, ["compactionRequestOverheadTokens", "compaction_request_overhead_tokens", "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS"]);
const configTokenEstimateSafetyMultiplier = pickNumber(compactionConfig, ["tokenEstimateSafetyMultiplier", "token_estimate_safety_multiplier", "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER"]);
export interface CompactionRuntimeConfig {
  autoCompactionEnabled: boolean;
  progressWatchdogEnabled: boolean;
  progressWatchdogTimeoutMs: number;
  systemPromptOverheadTokens: number;
  compactionRequestOverheadTokens: number;
  tokenEstimateSafetyMultiplier: number;
}

interface CompactionDomainConfig {
  autoCompactionEnabled: boolean;
  systemPromptOverheadTokens: number;
  compactionRequestOverheadTokens: number;
  tokenEstimateSafetyMultiplier: number;
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

const compactionDomainSchema = registerDomainConfig<CompactionDomainConfig>({
  domain: "compaction",
  // Preserve historical values without resolving them or accepting stale writes.
  retiredKeys: [
    "thresholdPercent", "maxThresholdTokens", "autoCompactionScope", "hardCeilingPercent",
    "warningThreshold", "backoffDecayFactor", "idleAutoCompactionDelayMs", "prePromptForegroundMs",
    "smartCompactionMethod", "model", "compactionModel", "remoteCompactionEnabled", "remoteCompactionTimeoutMs",
    "timeoutMs", "backoffBaseMs", "backoffMaxMs", "progressiveCompaction", "smartCompactionReasoning",
  ],
  fields: {
    autoCompactionEnabled: boolField({ key: "autoCompactionEnabled", owner: "core", defaultValue: configAutoCompactionEnabled ?? true, persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_AUTO_COMPACTION_ENABLED", replacement: "domains.compaction.autoCompactionEnabled", removalVersion: "3.0.0", skipInvalid: true }] }),
    systemPromptOverheadTokens: integerField({ key: "systemPromptOverheadTokens", owner: "agent-runtime", defaultValue: typeof configSystemPromptOverheadTokens === "number" && configSystemPromptOverheadTokens > 0 ? Math.round(configSystemPromptOverheadTokens) : 4_000, min: 1, bounds: "positive integer tokens", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS", replacement: "domains.compaction.systemPromptOverheadTokens", removalVersion: "3.0.0", skipInvalid: true }] }),
    compactionRequestOverheadTokens: integerField({ key: "compactionRequestOverheadTokens", owner: "agent-runtime", defaultValue: typeof configCompactionRequestOverheadTokens === "number" && configCompactionRequestOverheadTokens > 0 ? Math.round(configCompactionRequestOverheadTokens) : 1_000, min: 1, bounds: "positive integer tokens", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS", replacement: "domains.compaction.compactionRequestOverheadTokens", removalVersion: "3.0.0", skipInvalid: true }] }),
    tokenEstimateSafetyMultiplier: boundedNumberField({ key: "tokenEstimateSafetyMultiplier", owner: "agent-runtime", defaultValue: typeof configTokenEstimateSafetyMultiplier === "number" && configTokenEstimateSafetyMultiplier >= 1 ? configTokenEstimateSafetyMultiplier : 1.1, minInclusive: 1, bounds: ">=1", persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER", replacement: "domains.compaction.tokenEstimateSafetyMultiplier", removalVersion: "3.0.0", skipInvalid: true }] }),
  },
});

let compactionDomainConfigOverride: CompactionDomainConfig | null = null;

function getCompactionDomainConfig(): CompactionDomainConfig {
  return { ...(compactionDomainConfigOverride ?? readDomainConfig(compactionDomainSchema, getDomainConfigOptions())) };
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

export type SessionIsolationLevel = "none" | "summary" | "full";

interface SessionDomainConfig {
  isolation: SessionIsolationLevel;
}

const sessionDomainSchema = registerDomainConfig<SessionDomainConfig>({
  domain: "session",
  retiredKeys: ["maxSizeMb","maxLines","maxCompactionsBeforeRotation","autoRotate"],
  fields: {
    isolation: stringField({ key: "isolation", owner: "session-runtime", defaultValue: "none", allowedValues: ["none", "summary", "full"], persistence: "json-config", precedence: ["compat-env", "persisted", "default"], secretClass: "none", compatibilityEnv: [{ envKey: "PICLAW_SESSION_ISOLATION", replacement: "domains.session.isolation", removalVersion: "3.0.0", parse: (raw) => raw.trim().toLowerCase(), skipInvalid: true }] }) as DomainConfigField<SessionIsolationLevel>,
  },
});

const SESSION_DOMAIN_CONFIG = readDomainConfig(sessionDomainSchema, getDomainConfigOptions());

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

function parseOptionalNonNegativeDurationMs(value: unknown, fallback: number): number {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (trimmed && ["0", "off", "false", "disabled", "no"].includes(trimmed)) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
}

export function getProgressWatchdogSafetyWarning(): string | null {
  return null;
}

/** Reject a native/UI change which a valid compatibility override would mask.
 * Reuse the domain field parser and precedence; never rewrite process env. */
export function assertAutoCompactionSettingWritable(enabled: boolean): void {
  const field = compactionDomainSchema.fields.autoCompactionEnabled;
  const env = getDomainConfigOptions().env ?? process.env;
  for (const alias of field.compatibilityEnv ?? []) {
    const raw = env[alias.envKey];
    if (raw === undefined) continue;
    let enforced: boolean;
    try { enforced = field.validate(alias.parse ? alias.parse(raw) : raw); }
    catch (error) { if (alias.skipInvalid) continue; throw error; }
    if (enforced !== enabled) throw Error(`autoCompactionEnabled is overridden by ${alias.envKey}. No settings were changed.`);
    return;
  }
}

export function getCompactionRuntimeConfig(): Readonly<CompactionRuntimeConfig> {
  const domain = getCompactionDomainConfig();
  return Object.freeze({
    autoCompactionEnabled: domain.autoCompactionEnabled,
    progressWatchdogEnabled: getProgressWatchdogConfig().enabled,
    progressWatchdogTimeoutMs: getProgressWatchdogConfig().timeoutMs,
    systemPromptOverheadTokens: domain.systemPromptOverheadTokens,
    compactionRequestOverheadTokens: domain.compactionRequestOverheadTokens,
    tokenEstimateSafetyMultiplier: domain.tokenEstimateSafetyMultiplier,
  });
}

export interface CompactionRuntimeConfigPatch {
  autoCompactionEnabled?: boolean;
  progressWatchdogEnabled?: boolean;
  progressWatchdogTimeoutMs?: number;
  systemPromptOverheadTokens?: number;
  compactionRequestOverheadTokens?: number;
  tokenEstimateSafetyMultiplier?: number;
}

function applyCompactionRuntimeConfig(
  patch: CompactionRuntimeConfigPatch,
  persist: boolean,
): Readonly<CompactionRuntimeConfig> {
  const retired=Object.keys(patch).filter(key=>compactionDomainSchema.retiredKeys?.includes(key));
  if(retired.length)throw Error("Retired compaction configuration fields: "+retired.join(", ")+". No settings were changed.");
  const current = getCompactionRuntimeConfig();
  const next: CompactionRuntimeConfig = {
    autoCompactionEnabled: typeof patch.autoCompactionEnabled === "boolean"
      ? patch.autoCompactionEnabled
      : current.autoCompactionEnabled,
    progressWatchdogEnabled: typeof patch.progressWatchdogEnabled === "boolean"
      ? patch.progressWatchdogEnabled
      : current.progressWatchdogEnabled,
    progressWatchdogTimeoutMs: patch.progressWatchdogTimeoutMs === undefined
      ? current.progressWatchdogTimeoutMs
      : parseOptionalNonNegativeDurationMs(patch.progressWatchdogTimeoutMs, current.progressWatchdogTimeoutMs),
    systemPromptOverheadTokens: patch.systemPromptOverheadTokens === undefined
      ? current.systemPromptOverheadTokens
      : parseOptionalNonNegativeInt(patch.systemPromptOverheadTokens, current.systemPromptOverheadTokens) || current.systemPromptOverheadTokens,
    compactionRequestOverheadTokens: patch.compactionRequestOverheadTokens === undefined
      ? current.compactionRequestOverheadTokens
      : parseOptionalNonNegativeInt(patch.compactionRequestOverheadTokens, current.compactionRequestOverheadTokens) || current.compactionRequestOverheadTokens,
    tokenEstimateSafetyMultiplier: typeof patch.tokenEstimateSafetyMultiplier === "number" && patch.tokenEstimateSafetyMultiplier >= 1
      ? patch.tokenEstimateSafetyMultiplier
      : current.tokenEstimateSafetyMultiplier,
  };

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
      "progressWatchdogEnabled",
      "progress_watchdog_enabled",
      "watchdogEnabled",
      "progressWatchdogTimeoutMs",
      "progress_watchdog_timeout_ms",
      "watchdogTimeoutMs",
      "PICLAW_PROGRESS_WATCHDOG_ENABLED",
      "PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS",

      "systemPromptOverheadTokens",
      "system_prompt_overhead_tokens",
      "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS",
      "compactionRequestOverheadTokens",
      "compaction_request_overhead_tokens",
      "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS",
      "tokenEstimateSafetyMultiplier",
      "token_estimate_safety_multiplier",
      "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER",
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
    systemPromptOverheadTokens: next.systemPromptOverheadTokens,
    compactionRequestOverheadTokens: next.compactionRequestOverheadTokens,
    tokenEstimateSafetyMultiplier: next.tokenEstimateSafetyMultiplier,
  };
  if (persist) {
    const resolvedDomain = writeDomainConfig(compactionDomainSchema, getDomainConfigOptions(), compactionDomainPatch);
    compactionDomainConfigOverride = null;
    Object.assign(next, getCompactionDomainConfig(), resolvedDomain);
  } else if (!persist) {
    compactionDomainConfigOverride = compactionDomainPatch;
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
  ];
  for (const key of envKeys) delete process.env[key];
  const result = applyCompactionRuntimeConfig(patch, false);
  // Prevent process-env precedence from leaking this test override into later
  // module reloads; in-memory tests use the domain overrides directly.
  for (const key of envKeys) delete process.env[key];
  return result;
}
