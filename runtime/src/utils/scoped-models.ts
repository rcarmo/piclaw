/**
 * utils/scoped-models.ts – Apply Pi enabledModels scoping to Piclaw model lists.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

import { getScopedModelsOnly } from "../core/config.js";

export interface EnabledModelsSettingsProvider {
  getEnabledModels?: () => string[] | undefined;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function isAlias(id: string): boolean {
  return id.endsWith("-latest") || !/-\d{8}$/.test(id);
}

function stripThinkingLevel(pattern: string): string {
  const idx = pattern.lastIndexOf(":");
  if (idx === -1) return pattern;
  const suffix = pattern.slice(idx + 1).trim().toLowerCase();
  return THINKING_LEVELS.has(suffix) ? pattern.slice(0, idx) : pattern;
}

function hasGlob(pattern: string): boolean {
  return /[*?[]/.test(pattern);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      source += ".*";
    } else if (ch === "?") {
      source += ".";
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end > i + 1) {
        source += pattern.slice(i, end + 1);
        i = end;
      } else {
        source += "\\[";
      }
    } else {
      source += escapeRegex(ch);
    }
  }
  return new RegExp(`^${source}$`, "i");
}

function findExactModelReferenceMatch(pattern: string, models: Model<Api>[]): Model<Api> | undefined {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) return undefined;

  const canonical = models.filter((model) => modelKey(model).toLowerCase() === normalized);
  if (canonical.length === 1) return canonical[0];
  if (canonical.length > 1) return undefined;

  const slash = pattern.indexOf("/");
  if (slash !== -1) {
    const provider = pattern.slice(0, slash).trim().toLowerCase();
    const id = pattern.slice(slash + 1).trim().toLowerCase();
    if (provider && id) {
      const providerMatches = models.filter((model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id);
      if (providerMatches.length === 1) return providerMatches[0];
      if (providerMatches.length > 1) return undefined;
    }
  }

  const idMatches = models.filter((model) => model.id.toLowerCase() === normalized);
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

function getPartialModelMatchRank(pattern: string, model: Model<Api>): number | undefined {
  const lower = pattern.toLowerCase();
  const provider = model.provider.toLowerCase();
  const id = model.id.toLowerCase();
  const key = modelKey(model).toLowerCase();
  const name = typeof model.name === "string" ? model.name.toLowerCase() : "";

  if (provider === lower) return 0;
  if (key.startsWith(lower)) return 1;
  if (provider.includes(lower)) return 2;
  if (name.includes(lower)) return 3;
  if (key.includes(lower)) return 4;
  if (id.includes(lower)) return 5;
  return undefined;
}

function findBestPartialModel(pattern: string, models: Model<Api>[]): Model<Api> | undefined {
  const exact = findExactModelReferenceMatch(pattern, models);
  if (exact) return exact;

  const rankedMatches = models
    .map((model) => ({ model, rank: getPartialModelMatchRank(pattern, model) }))
    .filter((match): match is { model: Model<Api>; rank: number } => match.rank !== undefined);
  if (rankedMatches.length === 0) return undefined;

  const bestRank = Math.min(...rankedMatches.map((match) => match.rank));
  const matches = rankedMatches.filter((match) => match.rank === bestRank).map((match) => match.model);
  const aliases = matches.filter((model) => isAlias(model.id));
  const candidates = aliases.length > 0 ? aliases : matches;
  return [...candidates].sort((left, right) => right.id.localeCompare(left.id))[0];
}

export function getEnabledModelPatterns(settingsProvider?: EnabledModelsSettingsProvider | null): string[] {
  const values = typeof settingsProvider?.getEnabledModels === "function"
    ? settingsProvider.getEnabledModels()
    : undefined;
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

export function filterModelsByEnabledPatterns(models: Model<Api>[], patterns: readonly string[]): Model<Api>[] {
  if (!patterns.length) return models;

  const byKey = new Map(models.map((model) => [modelKey(model), model]));
  const selected = new Map<string, Model<Api>>();
  for (const rawPattern of patterns) {
    const pattern = stripThinkingLevel(String(rawPattern || "").trim());
    if (!pattern) continue;

    const exact = findExactModelReferenceMatch(pattern, models);
    if (exact) {
      selected.set(modelKey(exact), exact);
      continue;
    }

    if (hasGlob(pattern)) {
      const regex = globToRegex(pattern);
      for (const model of models) {
        if (regex.test(modelKey(model)) || regex.test(model.id)) {
          selected.set(modelKey(model), model);
        }
      }
      continue;
    }

    const model = findBestPartialModel(pattern, models);
    if (model) selected.set(modelKey(model), model);
  }

  if (selected.size === 0) return [];
  return models.filter((model) => selected.has(modelKey(model)) && byKey.has(modelKey(model)));
}

export interface ResolvedModelScope {
  models: Model<Api>[];
  scopedModels: Model<Api>[];
  scoped: boolean;
  patterns: string[];
  enabledModels: string[];
}

export function resolveModelScope(
  models: Model<Api>[],
  settingsProvider?: EnabledModelsSettingsProvider | null,
): ResolvedModelScope {
  const enabledModels = getEnabledModelPatterns(settingsProvider);
  const scoped = getScopedModelsOnly() && enabledModels.length > 0;
  const scopedModels = scoped ? filterModelsByEnabledPatterns(models, enabledModels) : models;
  return {
    models: scopedModels,
    scopedModels,
    scoped,
    patterns: enabledModels,
    enabledModels,
  };
}
