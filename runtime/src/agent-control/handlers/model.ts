/**
 * agent-control/handlers/model.ts – Handlers for model and thinking level commands.
 *
 * Handles /model (set/list), /cycle-model, /thinking (set/query),
 * /cycle-thinking, /steering-mode, and /followup-mode commands.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import type { AgentSession, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { THINKING_LEVELS, normalizeModelMatch, resolveThinkingAlias, isEffortProvider, formatThinkingLevelForDisplay } from "../agent-control-helpers.js";

function formatCompactTokens(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "unknown";
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `${Math.round(numeric / 1_000)}K`;
  return String(Math.round(numeric));
}

function getModelLabel(model: Model<Api> | null | undefined): string {
  if (!model?.provider || !model?.id) return "model";
  return `${model.provider}/${model.id}`;
}

function getModelContextWindow(model: Model<Api> | null | undefined): number | null {
  const contextWindow = Number(model?.contextWindow);
  return Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;
}

function buildContextFitError(model: Model<Api>, tokens: number, contextWindow: number): string {
  return `Current context won’t fit in ${getModelLabel(model)} (${formatCompactTokens(tokens)} used, ${formatCompactTokens(contextWindow)} max). Compact first.`;
}

function getContextFitError(session: AgentSession, model: Model<Api> | null | undefined): string | null {
  if (!model) return null;
  const usage = session.getContextUsage?.();
  const tokens = Number(usage?.tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  const contextWindow = getModelContextWindow(model);
  if (!contextWindow) return null;
  if (tokens <= contextWindow) return null;
  return buildContextFitError(model, tokens, contextWindow);
}

function listUniqueAvailableModels(registry: ModelRegistry): Model<Api>[] {
  const seen = new Set<string>();
  const models: Model<Api>[] = [];
  for (const model of registry.getAvailable()) {
    const key = getModelLabel(model);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    models.push(model);
  }
  return models;
}

type ModelCommand = Extract<AgentControlCommand, { type: "model" }>;
type ThinkingCommand = Extract<AgentControlCommand, { type: "thinking" }>;
type CycleModelCommand = Extract<AgentControlCommand, { type: "cycle_model" }>;
type CycleThinkingCommand = Extract<AgentControlCommand, { type: "cycle_thinking" }>;

function compactionGuard(session: AgentSession): AgentControlResult | null {
  if (!session.isCompacting) return null;
  return {
    status: "error",
    message: "Auto-compaction is still running. Try again in a moment.",
  };
}

/** Handle /model: switch model, list models, or show current model. */
export async function handleModel(session: AgentSession, modelRegistry: ModelRegistry, command: ModelCommand): Promise<AgentControlResult> {
  const blocked = compactionGuard(session);
  if (blocked) return blocked;

  const registry = ((session as AgentSession & { modelRegistry?: ModelRegistry }).modelRegistry ?? modelRegistry);
  registry.refresh();

  if (!command.modelId) {
    if (command.provider) {
      return {
        status: "error",
        message: "Invalid model format. Use /model <provider>/<modelId>.",
      };
    }

    const available = registry.getAvailable();
    if (available.length === 0) {
      return {
        status: "error",
        message: "No models available. Configure a provider in Pi Agent settings (run `pi /login`), then try /model again.",
      };
    }

    const uniqueModels = new Map<string, Model<Api>>();
    for (const model of available) {
      const key = `${model.provider}/${model.id}`;
      if (!uniqueModels.has(key)) {
        uniqueModels.set(key, model);
      }
    }

    const modelNames = Array.from(uniqueModels.keys()).sort((a, b) => a.localeCompare(b));
    const currentKey = session.model ? `${session.model.provider}/${session.model.id}` : null;
    const rows = modelNames.map((name) =>
      name === currentKey ? `| ${name} | ✓ current |` : `| ${name} | |`
    );

    return {
      status: "success",
      message: [
        "**Available models**",
        "",
        "| Model | Status |",
        "|---|---|",
        ...rows,
        "",
        "Use `/model <provider>/<modelId>` to switch.",
      ].join("\n"),
    };
  }

  const models = registry.getAll();
  let selected: Model<Api> | undefined;

  if (command.provider) {
    selected = normalizeModelMatch(models, command.provider, command.modelId);
    if (!selected) {
      return {
        status: "error",
        message: `Model not found: ${command.provider}/${command.modelId}.`,
      };
    }
  } else {
    const matches = models.filter((model) => model.id.toLowerCase() === command.modelId!.toLowerCase());
    if (matches.length === 0) {
      return {
        status: "error",
        message: `Model not found: ${command.modelId}.`,
      };
    }
    if (matches.length > 1) {
      const providers = matches.map((model) => `${model.provider}/${model.id}`).join(", ");
      return {
        status: "error",
        message: `Model "${command.modelId}" matches multiple providers: ${providers}. Use /model <provider>/<modelId>.`,
      };
    }
    selected = matches[0];
  }

  const contextFitError = getContextFitError(session, selected);
  if (contextFitError) {
    return { status: "error", message: contextFitError };
  }

  try {
    await session.setModel(selected);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }

  const provider = selected.provider;
  const thinkingLevel = session.thinkingLevel ?? null;
  const thinkingLevelDisplay = thinkingLevel ? formatThinkingLevelForDisplay(thinkingLevel, provider) : null;
  const thinkingNote = session.supportsThinking()
    ? ` Thinking level: ${thinkingLevelDisplay ?? thinkingLevel}.`
    : " Thinking is off for this model.";
  const modelLabel = `${provider}/${selected.id}`;

  return {
    status: "success",
    message: `Model set to ${modelLabel}.${thinkingNote}`,
    model_label: modelLabel,
    thinking_level: thinkingLevel,
    thinking_level_label: thinkingLevelDisplay,
  };
}

/** Format the available levels list, adding provider-native aliases in parentheses. */
function formatAvailableLevels(levels: readonly string[], provider: string | undefined | null): string {
  return levels.map((l) => {
    if (isEffortProvider(provider) && l === "xhigh") return `${l} (max)`;
    return l;
  }).join(", ");
}

/** Handle /thinking (alias /effort): set or query the thinking level. */
export async function handleThinking(session: AgentSession, _modelRegistry: ModelRegistry, command: ThinkingCommand): Promise<AgentControlResult> {
  if (!session.model) {
    return {
      status: "error",
      message: "No model selected yet. Use /model to pick one first.",
    };
  }

  const requestedRaw = command.level?.toLowerCase() || "";
  if (!requestedRaw) {
    const available = session.getAvailableThinkingLevels();
    const modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : "unknown";
    const provider = session.model?.provider;
    const effortNote = isEffortProvider(provider) ? " (effort)" : "";
    const lines = [
      `Current model: ${modelLabel}.`,
      `Current thinking${effortNote} level: ${formatThinkingLevelForDisplay(session.thinkingLevel, provider)}.`,
      `Available levels: ${formatAvailableLevels(available, provider)}.`,
    ];
    if (!session.supportsThinking()) {
      lines.push("Thinking is off for this model.");
    }
    return {
      status: "success",
      message: lines.join("\n"),
      thinking_level: session.thinkingLevel ?? null,
      thinking_level_label: formatThinkingLevelForDisplay(session.thinkingLevel, session.model?.provider),
    };
  }

  const resolved = resolveThinkingAlias(requestedRaw, session.model?.provider);

  if (!THINKING_LEVELS.includes(resolved as ThinkingLevel)) {
    const available = formatAvailableLevels(session.getAvailableThinkingLevels(), session.model?.provider);
    return {
      status: "error",
      message: `Unknown thinking level: ${command.level}. Available: ${available}.`,
    };
  }

  session.setThinkingLevel(resolved as ThinkingLevel);
  const applied = session.thinkingLevel;

  if (!session.supportsThinking()) {
    return {
      status: resolved === "off" ? "success" : "error",
      message: "Current model does not support thinking levels. Thinking is off.",
      thinking_level: session.thinkingLevel ?? null,
      thinking_level_label: formatThinkingLevelForDisplay(session.thinkingLevel, session.model?.provider),
    };
  }

  const displayApplied = formatThinkingLevelForDisplay(applied, session.model?.provider);
  const note = applied !== resolved ? ` (requested ${requestedRaw})` : "";
  return {
    status: "success",
    message: `Thinking level set to ${displayApplied}${note}.`,
    thinking_level: applied ?? session.thinkingLevel ?? null,
    thinking_level_label: displayApplied,
  };
}

/** Handle /cycle-model: switch to the next/previous model. */
export async function handleCycleModel(session: AgentSession, modelRegistry: ModelRegistry, command: CycleModelCommand): Promise<AgentControlResult> {
  const blocked = compactionGuard(session);
  if (blocked) return blocked;

  const registry = ((session as AgentSession & { modelRegistry?: ModelRegistry }).modelRegistry ?? modelRegistry);
  registry.refresh?.();
  const availableModels = listUniqueAvailableModels(registry);
  if (availableModels.length <= 1) {
    return { status: "success", message: "Only one model is available to cycle." };
  }

  const originalModel = session.model ?? null;
  const originalKey = getModelLabel(originalModel);
  let lastContextFitError: string | null = null;

  try {
    for (let attempts = 0; attempts < availableModels.length; attempts += 1) {
      const result = await session.cycleModel(command.direction);
      if (!result) {
        return { status: "success", message: "Only one model is available to cycle." };
      }

      const contextFitError = getContextFitError(session, result.model);
      if (contextFitError) {
        lastContextFitError = contextFitError;
        if (getModelLabel(result.model) === originalKey) break;
        continue;
      }

      if (getModelLabel(result.model) === originalKey && lastContextFitError) {
        break;
      }

      const label = `${result.model.provider}/${result.model.id}`;
      const scope = result.isScoped ? "scoped" : "available";
      const thinkingLevel = result.thinkingLevel ?? null;
      const thinkingLevelLabel = thinkingLevel ? formatThinkingLevelForDisplay(thinkingLevel, result.model.provider) : null;
      return {
        status: "success",
        message: `Model set to ${label} (cycle: ${scope}). Thinking level: ${thinkingLevelLabel ?? thinkingLevel}.`,
        model_label: label,
        thinking_level: thinkingLevel,
        thinking_level_label: thinkingLevelLabel,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }

  if (originalModel && getModelLabel(session.model) !== originalKey) {
    try {
      await session.setModel(originalModel);
    } catch {
      // Best effort: keep the current model if reverting fails.
    }
  }

  return {
    status: "error",
    message: lastContextFitError || "No compatible model is available to cycle to right now. Compact first.",
  };
}

/** Handle /cycle-thinking: cycle through thinking levels. */
export async function handleCycleThinking(session: AgentSession, _modelRegistry: ModelRegistry, _command: CycleThinkingCommand): Promise<AgentControlResult> {
  const level = session.cycleThinkingLevel();
  if (!level) {
    return { status: "error", message: "Current model does not support thinking levels.", thinking_level: session.thinkingLevel ?? null };
  }
  const displayLevel = formatThinkingLevelForDisplay(level, session.model?.provider);
  return {
    status: "success",
    message: `Thinking level set to ${displayLevel}.`,
    thinking_level: level,
    thinking_level_label: displayLevel,
  };
}
