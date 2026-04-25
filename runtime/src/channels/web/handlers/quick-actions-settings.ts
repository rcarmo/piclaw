import { getConfigPath } from "../../../core/config.js";
import { readJsonConfig, writeJsonConfig } from "../../../core/config-store.js";

export interface QuickActionsSettingsData {
  workspaceCommands: string[] | null;
  slashCommands: string[] | null;
}

export interface QuickActionsSettingsInput {
  workspaceCommands?: unknown;
  slashCommands?: unknown;
}

function normalizeOptionalStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = String(entry || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function readQuickActionsConfig(): Record<string, unknown> {
  const config = readJsonConfig(getConfigPath());
  const web = config.web && typeof config.web === "object"
    ? config.web as Record<string, unknown>
    : null;
  const quickActions = web?.quickActions && typeof web.quickActions === "object"
    ? web.quickActions as Record<string, unknown>
    : null;
  return quickActions || {};
}

export function getQuickActionsSettingsData(): QuickActionsSettingsData {
  const quickActions = readQuickActionsConfig();
  return {
    workspaceCommands: normalizeOptionalStringArray(quickActions.workspaceCommands) ?? null,
    slashCommands: normalizeOptionalStringArray(quickActions.slashCommands) ?? null,
  };
}

export function saveQuickActionsSettings(input: QuickActionsSettingsInput): QuickActionsSettingsData {
  const nextWorkspaceCommands = normalizeOptionalStringArray(input.workspaceCommands);
  const nextSlashCommands = normalizeOptionalStringArray(input.slashCommands);

  const config = readJsonConfig(getConfigPath());
  const web = config.web && typeof config.web === "object"
    ? { ...(config.web as Record<string, unknown>) }
    : {};
  const quickActions = web.quickActions && typeof web.quickActions === "object"
    ? { ...(web.quickActions as Record<string, unknown>) }
    : {};

  if (nextWorkspaceCommands !== undefined) {
    if (nextWorkspaceCommands === null) delete quickActions.workspaceCommands;
    else quickActions.workspaceCommands = nextWorkspaceCommands;
  }

  if (nextSlashCommands !== undefined) {
    if (nextSlashCommands === null) delete quickActions.slashCommands;
    else quickActions.slashCommands = nextSlashCommands;
  }

  if (Object.keys(quickActions).length > 0) {
    web.quickActions = quickActions;
  } else {
    delete web.quickActions;
  }

  if (Object.keys(web).length > 0) {
    config.web = web;
  } else {
    delete config.web;
  }

  writeJsonConfig(getConfigPath(), config);
  return getQuickActionsSettingsData();
}
