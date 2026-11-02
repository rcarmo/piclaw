import { admitSqliteWrite } from "../../db/sqlite-async-admission.js";
import { getDb } from "../../db/connection.js";
/**
 * web/ui-state.ts – Server-persisted web UI preferences.
 *
 * Stores instance-wide UI state in extension_kv so it survives browser storage
 * clears, device changes, and restarts. Legacy config-backed theme values remain
 * a migration/fallback path for older installs.
 */

import { getUiThemeConfig as getLegacyUiThemeConfig, setUiThemeConfig as setLegacyUiThemeConfig } from "../../core/config.js";
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
  } catch {
    return null;
  }
}

function kvSet(key: string, value: unknown): void {
  extensionKvSet(UI_EXTENSION_ID, key, value, "global");
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

function writeServerUiThemeConfig(patch: { theme?: string; tint?: string | null }): ServerUiThemeConfig {
  const current = getServerUiThemeConfig();
  const next: ServerUiThemeConfig = {
    theme: patch.theme !== undefined ? normalizeThemeValue(patch.theme, "default") : current.theme,
    tint: patch.tint !== undefined ? normalizeTintValue(patch.tint) : current.tint,
  };
  kvSet(THEME_KEY, next);
  return next;
}

export async function admitServerUiThemeConfig(patch: { theme?: string; tint?: string | null }, authorise: () => void = () => {}, signal?: AbortSignal): Promise<ServerUiThemeConfig> {
  patch = structuredClone(patch);
  const next = await admitSqliteWrite(getDb(), () => writeServerUiThemeConfig(patch), authorise, signal);
  authorise(); signal?.throwIfAborted();
  setLegacyUiThemeConfig(next); return next;
}

export function getServerUiMetersConfig(): ServerUiMetersConfig {
  return normalizeMetersConfig(kvGet<unknown>(METERS_KEY), { enabled: false, collapsed: false });
}

export function getServerUiOutputConfig(): ServerUiOutputConfig {
  return normalizeOutputConfig(kvGet<unknown>(OUTPUT_PAD_KEY), { outputPad: 0 });
}

export function setServerUiOutputConfig(patch: { outputPad?: number }): ServerUiOutputConfig {
  const current = getServerUiOutputConfig();
  const next = { outputPad: patch.outputPad !== undefined ? normalizeOutputPad(patch.outputPad, current.outputPad) : current.outputPad };
  kvSet(OUTPUT_PAD_KEY, next);
  return next;
}

export function setServerUiMetersConfig(patch: Partial<ServerUiMetersConfig>): ServerUiMetersConfig {
  const current = getServerUiMetersConfig();
  const next: ServerUiMetersConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    collapsed: typeof patch.collapsed === "boolean" ? patch.collapsed : current.collapsed,
  };
  kvSet(METERS_KEY, next);
  return next;
}

export function getServerUiState(): { ui_theme: ServerUiThemeConfig; ui_meters: ServerUiMetersConfig; ui_output: ServerUiOutputConfig } {
  return {
    ui_theme: getServerUiThemeConfig(),
    ui_meters: getServerUiMetersConfig(),
    ui_output: getServerUiOutputConfig(),
  };
}

export async function admitServerUiOutputConfig(patch: { outputPad?: number }, authorise: () => void = () => {}, signal?: AbortSignal): Promise<ServerUiOutputConfig> {
  const captured = structuredClone(patch);
  return admitSqliteWrite(getDb(), () => setServerUiOutputConfig(captured), authorise, signal);
}

export async function admitServerUiMetersConfig(patch: Partial<ServerUiMetersConfig>, authorise: () => void = () => {}, signal?: AbortSignal): Promise<ServerUiMetersConfig> {
  const captured = structuredClone(patch);
  return admitSqliteWrite(getDb(), () => setServerUiMetersConfig(captured), authorise, signal);
}
