import {
  clearChatCompactionBackoff,
  getAllChatCompactionBackoffs,
} from "../../../db.js";
import {
  getCompactionRuntimeConfig,
  normalizeSmartCompactionMethod,
  getToolResultCompactionEnabled,
  getToolResultCompactionTools,
  getToolResultSemanticSummaryConfig,
  setCompactionRuntimeConfig,
  setToolResultCompactionEnabled,
  setToolResultCompactionTools,
  setToolResultSemanticSummaryConfig,
  type SmartCompactionMethod,
} from "../../../core/config.js";
import { getTrackedPhasesSnapshot } from "../../../runtime/progress-watchdog.js";
import { buildLatestCompactionLatencyEstimate, type CompactionLatencyEstimate } from "../../../agent-pool/compaction-prefill-estimate.js";
import {
  startExternalProgressWatchdogMonitor,
  stopExternalProgressWatchdogMonitor,
} from "../../../runtime/progress-watchdog-supervisor.js";

export interface CompactionSettingsData {
  autoCompactionEnabled: boolean;
  smartCompactionMethod: SmartCompactionMethod;
  compactionModel: string;
  compactionLatencyEstimate: CompactionLatencyEstimate | null;
  remoteCompactionEnabled: boolean;
  remoteCompactionTimeoutSec: number;
  remoteCompactionSupportedProviders: string[];
  compactionTimeoutSec: number;
  compactionBackoffBaseMin: number;
  compactionBackoffMaxMin: number;
  compactionThresholdPercent: number;
  compactionBackoffDecayFactor: number;
  progressWatchdogEnabled: boolean;
  progressWatchdogTimeoutSec: number;
  toolResultCompactionEnabled: boolean;
  toolResultCompactionTools: string[];
  toolResultSemanticSummaryEnabled: boolean;
  toolResultSemanticSummaryMaxInputChars: number;
  toolResultSemanticSummaryMaxTokens: number;
  toolResultSemanticSummaryTimeoutSec: number;
  compactionBackoffs: Array<{
    chatJid: string;
    failureCount: number;
    lastFailedAt: string;
    backoffUntil: string;
    lastErrorMessage: string | null;
  }>;
  progressWatchdogPhases: Array<{
    chatJid: string;
    phase: string;
    startedAt: string;
    lastProgressAt: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface CompactionSettingsInput {
  autoCompactionEnabled?: unknown;
  smartCompactionMethod?: unknown;
  compactionModel?: unknown;
  remoteCompactionEnabled?: unknown;
  remoteCompactionTimeoutSec?: unknown;
  compactionTimeoutSec?: unknown;
  compactionBackoffBaseMin?: unknown;
  compactionBackoffMaxMin?: unknown;
  compactionThresholdPercent?: unknown;
  compactionBackoffDecayFactor?: unknown;
  progressWatchdogEnabled?: unknown;
  progressWatchdogTimeoutSec?: unknown;
  toolResultCompactionEnabled?: unknown;
  toolResultCompactionTools?: unknown;
  toolResultSemanticSummaryEnabled?: unknown;
  toolResultSemanticSummaryMaxInputChars?: unknown;
  toolResultSemanticSummaryMaxTokens?: unknown;
  toolResultSemanticSummaryTimeoutSec?: unknown;
}

function normalizeOptionalSmartCompactionMethod(value: unknown): SmartCompactionMethod | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!["selective", "traditional_pipelined", "pipelined"].includes(normalized)) return undefined;
  return normalizeSmartCompactionMethod(normalized);
}

function normalizeOptionalCompactionModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return "";
  const separator = normalized.indexOf("/");
  return separator > 0 && separator < normalized.length - 1 ? normalized : undefined;
}

function normalizeOptionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function getCompactionSettingsData(): CompactionSettingsData {
  const config = getCompactionRuntimeConfig();
  const summaryConfig = getToolResultSemanticSummaryConfig();
  const now = Date.now();
  const separator = config.compactionModel.indexOf("/");
  const compactionLatencyEstimate = separator > 0
    ? buildLatestCompactionLatencyEstimate({
      provider: config.compactionModel.slice(0, separator),
      model: config.compactionModel.slice(separator + 1),
      deadlineMs: config.timeoutMs,
      now,
    })
    : null;
  return {
    autoCompactionEnabled: config.autoCompactionEnabled,
    smartCompactionMethod: config.smartCompactionMethod,
    compactionModel: config.compactionModel,
    compactionLatencyEstimate,
    remoteCompactionEnabled: config.remoteCompactionEnabled,
    remoteCompactionTimeoutSec: Math.max(1, Math.round(config.remoteCompactionTimeoutMs / 1000)),
    remoteCompactionSupportedProviders: ["openai", "openai-codex"],
    compactionTimeoutSec: Math.max(1, Math.round(config.timeoutMs / 1000)),
    compactionBackoffBaseMin: Math.max(1, Math.round(config.backoffBaseMs / 60_000)),
    compactionBackoffMaxMin: Math.max(1, Math.round(config.backoffMaxMs / 60_000)),
    compactionThresholdPercent: config.thresholdPercent,
    compactionBackoffDecayFactor: config.backoffDecayFactor,
    progressWatchdogEnabled: config.progressWatchdogEnabled,
    progressWatchdogTimeoutSec: Math.max(0, Math.round(config.progressWatchdogTimeoutMs / 1000)),
    toolResultCompactionEnabled: getToolResultCompactionEnabled(),
    toolResultCompactionTools: [...getToolResultCompactionTools()],
    toolResultSemanticSummaryEnabled: summaryConfig.enabled,
    toolResultSemanticSummaryMaxInputChars: summaryConfig.maxInputChars,
    toolResultSemanticSummaryMaxTokens: summaryConfig.maxTokens,
    toolResultSemanticSummaryTimeoutSec: Math.max(1, Math.round(summaryConfig.timeoutMs / 1000)),
    compactionBackoffs: getAllChatCompactionBackoffs()
      .filter((entry) => {
        const untilMs = Date.parse(entry.backoffUntil);
        return Number.isFinite(untilMs) && untilMs > now;
      })
      .sort((left, right) => Date.parse(left.backoffUntil) - Date.parse(right.backoffUntil))
      .map((entry) => ({
        chatJid: entry.chatJid,
        failureCount: entry.failureCount,
        lastFailedAt: entry.lastFailedAt,
        backoffUntil: entry.backoffUntil,
        lastErrorMessage: entry.lastErrorMessage,
      })),
    progressWatchdogPhases: getTrackedPhasesSnapshot()
      .sort((left, right) => left.chatJid.localeCompare(right.chatJid) || left.startedAt - right.startedAt)
      .map((entry) => ({
        chatJid: entry.chatJid,
        phase: entry.phase,
        startedAt: new Date(entry.startedAt).toISOString(),
        lastProgressAt: new Date(entry.lastProgressAt).toISOString(),
        metadata: entry.metadata,
      })),
  };
}

export async function saveCompactionSettings(input: CompactionSettingsInput): Promise<CompactionSettingsData> {
  const patch: {
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
    backoffDecayFactor?: number;
  } = {};

  const nextAutoCompactionEnabled = normalizeOptionalBoolean(input.autoCompactionEnabled);
  if (nextAutoCompactionEnabled !== undefined) {
    patch.autoCompactionEnabled = nextAutoCompactionEnabled;
  }

  const nextSmartCompactionMethod = normalizeOptionalSmartCompactionMethod(input.smartCompactionMethod);
  if (nextSmartCompactionMethod !== undefined) {
    patch.smartCompactionMethod = nextSmartCompactionMethod;
  }

  const nextCompactionModel = normalizeOptionalCompactionModel(input.compactionModel);
  if (nextCompactionModel !== undefined) {
    patch.compactionModel = nextCompactionModel;
  }

  const nextRemoteCompactionEnabled = normalizeOptionalBoolean(input.remoteCompactionEnabled);
  if (nextRemoteCompactionEnabled !== undefined) {
    patch.remoteCompactionEnabled = nextRemoteCompactionEnabled;
  }

  const nextRemoteCompactionTimeoutSec = normalizeOptionalInt(input.remoteCompactionTimeoutSec, 1, 300);
  if (nextRemoteCompactionTimeoutSec !== undefined) {
    patch.remoteCompactionTimeoutMs = nextRemoteCompactionTimeoutSec * 1000;
  }

  const nextTimeoutSec = normalizeOptionalInt(input.compactionTimeoutSec, 1, 3600);
  if (nextTimeoutSec !== undefined) {
    patch.timeoutMs = nextTimeoutSec * 1000;
  }

  const nextBackoffBaseMin = normalizeOptionalInt(input.compactionBackoffBaseMin, 1, 24 * 60);
  if (nextBackoffBaseMin !== undefined) {
    patch.backoffBaseMs = nextBackoffBaseMin * 60_000;
  }

  const nextBackoffMaxMin = normalizeOptionalInt(input.compactionBackoffMaxMin, 1, 7 * 24 * 60);
  if (nextBackoffMaxMin !== undefined) {
    patch.backoffMaxMs = nextBackoffMaxMin * 60_000;
  }

  const nextProgressWatchdogEnabled = normalizeOptionalBoolean(input.progressWatchdogEnabled);
  if (nextProgressWatchdogEnabled !== undefined) {
    patch.progressWatchdogEnabled = nextProgressWatchdogEnabled;
  }

  const nextProgressWatchdogTimeoutSec = normalizeOptionalInt(input.progressWatchdogTimeoutSec, 0, 3600);
  if (nextProgressWatchdogTimeoutSec !== undefined) {
    patch.progressWatchdogTimeoutMs = nextProgressWatchdogTimeoutSec * 1000;
  }

  const nextThreshold = normalizeOptionalInt(input.compactionThresholdPercent, 10, 95);
  if (nextThreshold !== undefined) {
    patch.thresholdPercent = nextThreshold;
  }

  const nextDecay = typeof input.compactionBackoffDecayFactor === "number"
    ? Math.min(1, Math.max(0.1, input.compactionBackoffDecayFactor))
    : undefined;
  if (nextDecay !== undefined) {
    patch.backoffDecayFactor = nextDecay;
  }

  const nextToolResultCompactionEnabled = normalizeOptionalBoolean(input.toolResultCompactionEnabled);
  const nextToolResultCompactionTools = normalizeOptionalStringArray(input.toolResultCompactionTools);
  const nextToolResultSemanticSummaryEnabled = normalizeOptionalBoolean(input.toolResultSemanticSummaryEnabled);
  const nextToolResultSemanticSummaryMaxInputChars = normalizeOptionalInt(input.toolResultSemanticSummaryMaxInputChars, 500, 200_000);
  const nextToolResultSemanticSummaryMaxTokens = normalizeOptionalInt(input.toolResultSemanticSummaryMaxTokens, 64, 4_096);
  const nextToolResultSemanticSummaryTimeoutSec = normalizeOptionalInt(input.toolResultSemanticSummaryTimeoutSec, 1, 300);

  if (Object.keys(patch).length > 0) {
    const saved = setCompactionRuntimeConfig(patch);
    if (saved.progressWatchdogEnabled && saved.progressWatchdogTimeoutMs > 0) {
      startExternalProgressWatchdogMonitor();
    } else {
      await stopExternalProgressWatchdogMonitor();
    }
  }

  if (nextToolResultCompactionEnabled !== undefined) {
    setToolResultCompactionEnabled(nextToolResultCompactionEnabled);
  }

  if (nextToolResultCompactionTools !== undefined) {
    setToolResultCompactionTools(nextToolResultCompactionTools);
  }

  if (
    nextToolResultSemanticSummaryEnabled !== undefined
    || nextToolResultSemanticSummaryMaxInputChars !== undefined
    || nextToolResultSemanticSummaryMaxTokens !== undefined
    || nextToolResultSemanticSummaryTimeoutSec !== undefined
  ) {
    setToolResultSemanticSummaryConfig({
      ...(nextToolResultSemanticSummaryEnabled !== undefined ? { enabled: nextToolResultSemanticSummaryEnabled } : {}),
      ...(nextToolResultSemanticSummaryMaxInputChars !== undefined ? { maxInputChars: nextToolResultSemanticSummaryMaxInputChars } : {}),
      ...(nextToolResultSemanticSummaryMaxTokens !== undefined ? { maxTokens: nextToolResultSemanticSummaryMaxTokens } : {}),
      ...(nextToolResultSemanticSummaryTimeoutSec !== undefined ? { timeoutMs: nextToolResultSemanticSummaryTimeoutSec * 1000 } : {}),
    });
  }

  return getCompactionSettingsData();
}

export function resetCompactionBackoff(chatJid: string): CompactionSettingsData {
  clearChatCompactionBackoff(chatJid);
  return getCompactionSettingsData();
}
