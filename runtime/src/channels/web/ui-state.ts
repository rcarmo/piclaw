import { admitSqliteWrite } from "../../db/sqlite-async-admission.js";
import { getDb, captureHostDatabaseBinding } from "../../db/connection.js";
/**
 * web/ui-state.ts – Server-persisted web UI preferences.
 *
 * Stores instance-wide UI state in extension_kv so it survives browser storage
 * clears, device changes, and restarts. Legacy config-backed theme values remain
 * a migration/fallback path for older installs.
 */

import { getUiThemeConfig as getLegacyUiThemeConfig } from "../../core/config.js";
import { extensionKvGet, extensionKvSet } from "../../db.js";

const UI_EXTENSION_ID = "piclaw-ui";
const THEME_KEY = "theme";
const METERS_KEY = "meters";
const OUTPUT_PAD_KEY = "output-pad";

export interface ServerUiThemeConfig {
  theme: string;
  tint: string | null;
}

export interface ServerUiOutputConfig {
  outputPad: number;
}

export interface ServerUiMetersConfig {
  enabled: boolean;
  collapsed: boolean;
}

function normalizeThemeValue(value: unknown, fallback = "default"): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw || fallback;
}

function normalizeTintValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeThemeConfig(value: unknown, fallback: ServerUiThemeConfig): ServerUiThemeConfig {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  return {
    theme: normalizeThemeValue(record.theme, fallback.theme),
    tint: record.tint === undefined ? fallback.tint : normalizeTintValue(record.tint),
  };
}

function normalizeMetersConfig(value: unknown, fallback: ServerUiMetersConfig): ServerUiMetersConfig {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    collapsed: typeof record.collapsed === "boolean" ? record.collapsed : fallback.collapsed,
  };
}

function normalizeOutputPad(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(24, Math.max(0, Math.round(parsed)));
}

function normalizeOutputConfig(value: unknown, fallback: ServerUiOutputConfig): ServerUiOutputConfig {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  return { outputPad: normalizeOutputPad(record.outputPad ?? record.output_pad, fallback.outputPad) };
}

function kvGet<T>(key: string): T | null {
  try {
    return extensionKvGet<T>(UI_EXTENSION_ID, key, "global");
  } catch (error) {
    if (error instanceof Error && error.message === 'Database not initialized') return null;
    throw error;
  }
}

export function getServerUiThemeConfig(): ServerUiThemeConfig {
  const legacy = getLegacyUiThemeConfig();
  const fallback: ServerUiThemeConfig = {
    theme: normalizeThemeValue(legacy.theme, "default"),
    tint: normalizeTintValue(legacy.tint),
  };
  const stored = kvGet<unknown>(THEME_KEY);
  if (stored !== null) return normalizeThemeConfig(stored, fallback);
  return fallback;
}

export function getServerUiMetersConfig(): ServerUiMetersConfig {
  return normalizeMetersConfig(kvGet<unknown>(METERS_KEY), { enabled: false, collapsed: false });
}

export function getServerUiOutputConfig(): ServerUiOutputConfig {
  return normalizeOutputConfig(kvGet<unknown>(OUTPUT_PAD_KEY), { outputPad: 0 });
}

export function getServerUiState(): { ui_theme: ServerUiThemeConfig; ui_meters: ServerUiMetersConfig; ui_output: ServerUiOutputConfig } {
  return {
    ui_theme: getServerUiThemeConfig(),
    ui_meters: getServerUiMetersConfig(),
    ui_output: getServerUiOutputConfig(),
  };
}

/** One admitted preference update/readback; legacy config remains read-only. */
export type ServerUiStatePatch = {
  ui_theme?: Partial<ServerUiThemeConfig>;
  ui_meters?: Partial<ServerUiMetersConfig> | 'toggle';
  ui_output?: Partial<ServerUiOutputConfig>;
};
export async function admitServerUiState(patch: ServerUiStatePatch, authorise: (phase?: 'before' | 'after') => void,
  signal?: AbortSignal): Promise<ReturnType<typeof getServerUiState>> {
  const binding = captureHostDatabaseBinding(), captured = structuredClone(patch);
  if (!captured.ui_theme && !captured.ui_meters && !captured.ui_output) return getServerUiState();
  const database = getDb();
  const check = (phase?: 'before' | 'after') => {
    binding();
    if (phase === undefined && database.inTransaction) throw Error('UI preference update requires its own transaction.');
    authorise(phase);
  };
  return admitSqliteWrite(database, () => {
    if (captured.ui_theme) {
      const current = getServerUiThemeConfig(), value = captured.ui_theme;
      extensionKvSet(UI_EXTENSION_ID, THEME_KEY, {
        theme: value.theme !== undefined ? normalizeThemeValue(value.theme, 'default') : current.theme,
        tint: value.tint !== undefined ? normalizeTintValue(value.tint) : current.tint,
      }, 'global');
    }
    if (captured.ui_meters) {
      const current = getServerUiMetersConfig();
      extensionKvSet(UI_EXTENSION_ID, METERS_KEY, captured.ui_meters === 'toggle'
        ? { ...current, enabled: !current.enabled } : normalizeMetersConfig(captured.ui_meters, current), 'global');
    }
    if (captured.ui_output) {
      const current = getServerUiOutputConfig(), value = captured.ui_output;
      extensionKvSet(UI_EXTENSION_ID, OUTPUT_PAD_KEY, { outputPad: value.outputPad !== undefined ? normalizeOutputPad(value.outputPad, current.outputPad) : current.outputPad }, 'global');
    }
    return getServerUiState();
  }, check, signal, undefined, check);
}
