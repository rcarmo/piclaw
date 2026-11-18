import {
  getCompactionRuntimeConfig,
  assertAutoCompactionSettingWritable,
  getLocalLitePromptProfileEnabled,
  setLocalLitePromptProfileEnabled,
  setCompactionRuntimeConfig,
} from "../../../core/config.js";
import { getTrackedPhasesSnapshot } from "../../../runtime/progress-watchdog.js";
import {
  startExternalProgressWatchdogMonitor,
  stopExternalProgressWatchdogMonitor,
} from "../../../runtime/progress-watchdog-supervisor.js";

export interface CompactionSettingsData {
  compactionPolicy: "pi-durable";
  autoCompactionEnabled: boolean;
  progressWatchdogEnabled: boolean;
  progressWatchdogTimeoutSec: number;
  localLitePromptProfileEnabled: boolean;
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
  progressWatchdogEnabled?: unknown;
  progressWatchdogTimeoutSec?: unknown;
  localLitePromptProfileEnabled?: unknown;
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

export function getCompactionSettingsData(): CompactionSettingsData {
  const config = getCompactionRuntimeConfig();
  return {
    compactionPolicy: "pi-durable",
    autoCompactionEnabled: config.autoCompactionEnabled,
    progressWatchdogEnabled: config.progressWatchdogEnabled,
    progressWatchdogTimeoutSec: Math.max(0, Math.round(config.progressWatchdogTimeoutMs / 1000)),
    localLitePromptProfileEnabled: getLocalLitePromptProfileEnabled(),
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

// Retired values remain in historical configuration, but cannot be saved as
// effective native policy. Validate the whole request before any setter runs.
export const UNSUPPORTED_NATIVE_COMPACTION_FIELDS = [
  "toolResultCompactionEnabled", "toolResultCompactionTools", "toolResultSemanticSummaryEnabled",
  "toolResultSemanticSummaryMaxInputChars", "toolResultSemanticSummaryMaxTokens", "toolResultSemanticSummaryTimeoutSec",
  "smartCompactionMethod", "compactionModel", "remoteCompactionEnabled",
  "remoteCompactionTimeoutSec", "compactionTimeoutSec", "compactionBackoffBaseMin",
  "compactionBackoffMaxMin", "compactionThresholdPercent", "compactionBackoffDecayFactor",
] as const;

export async function saveCompactionSettings(input: CompactionSettingsInput): Promise<CompactionSettingsData> {
  const unsupported = UNSUPPORTED_NATIVE_COMPACTION_FIELDS.filter(field => Object.hasOwn(input, field));
  if (unsupported.length) throw Error(`Unsupported native compaction settings: ${unsupported.join(", ")}. No settings were changed.`);
  if (Object.hasOwn(input, "autoCompactionEnabled") && typeof input.autoCompactionEnabled !== "boolean")
    throw Error("autoCompactionEnabled must be a boolean. No settings were changed.");
  if (typeof input.autoCompactionEnabled === "boolean") assertAutoCompactionSettingWritable(input.autoCompactionEnabled);
  const patch: {
    autoCompactionEnabled?: boolean;
    progressWatchdogEnabled?: boolean;
    progressWatchdogTimeoutMs?: number;
  } = {};

  const nextAutoCompactionEnabled = normalizeOptionalBoolean(input.autoCompactionEnabled);
  if (nextAutoCompactionEnabled !== undefined) {
    patch.autoCompactionEnabled = nextAutoCompactionEnabled;
  }

  const nextProgressWatchdogEnabled = normalizeOptionalBoolean(input.progressWatchdogEnabled);
  if (nextProgressWatchdogEnabled !== undefined) {
    patch.progressWatchdogEnabled = nextProgressWatchdogEnabled;
  }

  const nextProgressWatchdogTimeoutSec = normalizeOptionalInt(input.progressWatchdogTimeoutSec, 0, 3600);
  if (nextProgressWatchdogTimeoutSec !== undefined) {
    patch.progressWatchdogTimeoutMs = nextProgressWatchdogTimeoutSec * 1000;
  }

  const nextLocalLite = normalizeOptionalBoolean(input.localLitePromptProfileEnabled);
  if (nextLocalLite !== undefined) setLocalLitePromptProfileEnabled(nextLocalLite);
  if (Object.keys(patch).length > 0) {
    const saved = setCompactionRuntimeConfig(patch);
    if (saved.progressWatchdogEnabled && saved.progressWatchdogTimeoutMs > 0) {
      startExternalProgressWatchdogMonitor();
    } else {
      await stopExternalProgressWatchdogMonitor();
    }
  }

  return getCompactionSettingsData();
}
