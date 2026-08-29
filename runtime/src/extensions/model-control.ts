/**
 * model-control – registers model and thinking level management tools
 * and appends tool-usage hints to the system prompt.
 *
 * Tools: get_model_state, list_models, switch_model, switch_thinking
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { findModel, parseModelInput } from "../utils/model-utils.js";
import { resolveModelScope, type EnabledModelsSettingsProvider } from "../utils/scoped-models.js";
import { getChatContext } from "../core/chat-context.js";
import {
  formatThinkingLevelForDisplay,
  getAvailableThinkingLevelsForModel,
  resolveThinkingAlias,
} from "../agent-control/agent-control-helpers.js";
import { updateSessionModel } from "./session-status.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THINKING_LEVELS: readonly string[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
];

const TOOL_HINT = [
  "You can manage your own model and thinking level.",
  "Use get_model_state to see the current model + thinking level.",
  "Use list_models to discover available models when needed.",
  "Use switch_model to change models and switch_thinking to change thinking level.",
  "Do not ask the user to run /model or /thinking when you can switch yourself.",
].join("\n");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function modelLabel(model: Model<Api> | null | undefined): string | null {
  if (!model?.provider || !model?.id) return null;
  return `${model.provider}/${model.id}`;
}

function getAvailableLevels(model: Model<Api> | undefined): ThinkingLevel[] {
  if (!model) return ["off"];
  return Array.from(new Set(
    getAvailableThinkingLevelsForModel(model)
      .map((level) => formatThinkingLevelForDisplay(level, model) as ThinkingLevel),
  ));
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}


// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/** Extension factory that registers model control tools (get/list/switch). */
export const modelControl: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("model_select", (event) => {
    const chat = getChatContext();
    if (!chat) return;
    updateSessionModel(chat.chatJid, modelLabel(event.model), pi.getThinkingLevel());
  });

  pi.on("thinking_level_select", (event, ctx) => {
    const chat = getChatContext();
    if (!chat) return;
    updateSessionModel(chat.chatJid, modelLabel(ctx.model), event.level);
  });

  // Inject tool-usage hint into system prompt
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${TOOL_HINT}` };
  });

  // -- get_model_state -------------------------------------------------------
  pi.registerTool({
    name: "get_model_state",
    label: "get_model_state",
    description: "Get the current model and thinking level.",
    promptSnippet: "get_model_state: inspect the current provider/model, thinking level, and context usage.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const model = ctx.model;
      const label = modelLabel(model);
      const thinking = formatThinkingLevelForDisplay(pi.getThinkingLevel(), model);
      const available = getAvailableLevels(model);
      const supportsThinking = Boolean(model?.reasoning);
      const usage = ctx.getContextUsage();

      const thinkingNote = supportsThinking
        ? `Thinking level: ${thinking}.`
        : "Thinking is off for this model.";
      const contextNote = usage
        ? `Context: ${usage.tokens ?? "?"}/${usage.contextWindow} tokens (${usage.percent ? usage.percent.toFixed(1) : "?"}%).`
        : "Context: unknown.";

      return {
        content: [{ type: "text", text: `Current model: ${label ?? "(none)"}. ${thinkingNote} ${contextNote}` }],
        details: {
          model: label,
          provider: model?.provider ?? null,
          model_id: model?.id ?? null,
          thinking_level: thinking,
          supports_thinking: supportsThinking,
          available_thinking_levels: available,
          context_tokens: usage?.tokens ?? null,
          context_window: usage?.contextWindow ?? null,
          context_percent: usage?.percent ?? null,
        },
      };
    },
  });

  // -- list_models -----------------------------------------------------------
  pi.registerTool({
    name: "list_models",
    label: "list_models",
    description: "List available models in the registry.",
    promptSnippet: "list_models: discover available provider/model options before switching.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Filter by provider/modelId substring (case-insensitive)." })),
      limit: Type.Optional(Type.Integer({ description: "Max results (1-200).", minimum: 1, maximum: 200 })),
      offset: Type.Optional(Type.Integer({ description: "Offset for pagination.", minimum: 0 })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      let refreshError: string | null = null;
      try {
        await ctx.modelRegistry.refresh();
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error);
      }
      const scopedModels = resolveModelScope(
        ctx.modelRegistry.getAvailable(),
        (ctx as { settingsManager?: EnabledModelsSettingsProvider }).settingsManager,
      );
      const seen = new Map<string, Model<Api>>();
      for (const m of scopedModels.models) {
        if (!m?.provider || !m?.id) continue;
        const key = `${m.provider}/${m.id}`;
        if (!seen.has(key)) seen.set(key, m);
      }

      const query = params.query?.trim().toLowerCase();
      let entries = Array.from(seen.values()).map((m) => {
        const rateLimits = (m as { rateLimits?: { rpm?: number; tpm?: number } }).rateLimits;
        return {
          id: m.id,
          provider: m.provider,
          label: `${m.provider}/${m.id}`,
          reasoning: m.reasoning || undefined,
          context_window: m.contextWindow || undefined,
          rate_limits: rateLimits,
        };
      });
      if (query) entries = entries.filter((e) => e.label.toLowerCase().includes(query));
      entries.sort((a, b) => a.label.localeCompare(b.label));

      const limit = clamp(params.limit, 100, 1, 200);
      const offset = clamp(params.offset, 0, 0, Math.max(entries.length, 0));
      const page = entries.slice(offset, offset + limit);
      const current = modelLabel(ctx.model);

      if (page.length === 0) {
        const msg = query ? `No models found matching "${params.query}".` : "No available models found.";
        const refreshNote = refreshError ? ` Catalog refresh failed: ${refreshError}` : "";
        return { content: [{ type: "text", text: `${msg}${refreshNote}` }], details: { total: entries.length, count: 0, offset, limit, current_model: current, refresh_error: refreshError, scoped_models_only: scopedModels.scopedModelsOnly, scoped_model_filter_active: scopedModels.scoped, enabled_model_patterns: scopedModels.patterns, models: [] } };
      }

      const header = query
        ? `Available models (filtered): ${page.length} of ${entries.length}.`
        : `Available models: ${page.length} of ${entries.length}.`;
      const refreshNote = refreshError ? ` Catalog refresh failed; showing cached models: ${refreshError}` : "";
      const lines = page.map((e) => {
        const currentSuffix = e.label === current ? " (current)" : "";
        const rpm = e.rate_limits?.rpm;
        const tpm = e.rate_limits?.tpm;
        const rateNote = rpm || tpm ? ` (RPM ${rpm ?? "?"}, TPM ${tpm ?? "?"})` : "";
        return `• ${e.label}${currentSuffix}${rateNote}`;
      });

      return {
        content: [{ type: "text", text: `${header}${refreshNote}\n${lines.join("\n")}` }],
        details: { total: entries.length, count: page.length, offset, limit, current_model: current, refresh_error: refreshError, scoped_models_only: scopedModels.scopedModelsOnly, scoped_model_filter_active: scopedModels.scoped, enabled_model_patterns: scopedModels.patterns, models: page },
      };
    },
  });

  // -- switch_model ----------------------------------------------------------
  pi.registerTool({
    name: "switch_model",
    label: "switch_model",
    description: "Switch the active model for the current session.",
    promptSnippet: "switch_model: change the active model using provider/model or model id.",
    parameters: Type.Object({
      model: Type.String({ description: "Model identifier (provider/modelId or modelId)." }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const { provider, modelId } = parseModelInput(params.model);
      if (!modelId) {
        return { content: [{ type: "text", text: "Provide a model identifier." }], details: {} };
      }

      let refreshError: string | null = null;
      try {
        await ctx.modelRegistry.refresh();
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error);
      }
      const { model: selected, error } = findModel(ctx.modelRegistry.getAll(), provider, modelId);
      if (error || !selected) {
        const suffix = refreshError ? ` Catalog refresh failed: ${refreshError}` : "";
        return { content: [{ type: "text", text: `${error!}${suffix}` }], details: { refresh_error: refreshError } };
      }

      const previous = modelLabel(ctx.model);
      const success = await pi.setModel(selected);
      if (!success) {
        return {
          content: [{ type: "text", text: `Model ${selected.provider}/${selected.id} is not configured in Pi Agent settings yet. Run \`pi /login\` and try again.` }],
          details: { previous_model: previous },
        };
      }

      const thinking = formatThinkingLevelForDisplay(pi.getThinkingLevel(), selected);
      const thinkingNote = selected.reasoning
        ? ` Thinking level: ${thinking}.`
        : " Thinking is off for this model.";

      return {
        content: [{ type: "text", text: `Model set to ${selected.provider}/${selected.id}.${thinkingNote}` }],
        details: { previous_model: previous, current_model: `${selected.provider}/${selected.id}` },
      };
    },
  });

  // -- switch_thinking -------------------------------------------------------
  pi.registerTool({
    name: "switch_thinking",
    label: "switch_thinking",
    description: "Switch the thinking level for the current session.",
    promptSnippet: "switch_thinking: change the current reasoning/thinking effort level.",
    parameters: Type.Object({
      level: Type.Optional(
        Type.String({ description: "Thinking level (off/minimal/low/medium/high/xhigh/max). Omit to see current." }),
      ),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const model = ctx.model;
      if (!model) {
        return { content: [{ type: "text", text: "No model selected yet. Switch models first." }], details: {} };
      }

      const available = getAvailableLevels(model);
      const supportsThinking = Boolean(model.reasoning);
      const requested = (params.level ?? "").trim().toLowerCase();
      const current = formatThinkingLevelForDisplay(pi.getThinkingLevel(), model);

      if (!requested) {
        const msg = [
          `Current model: ${model.provider}/${model.id}.`,
          `Current thinking level: ${current}.`,
          `Available thinking levels: ${available.join(", ")}.`,
        ].join("\n") + (supportsThinking ? "" : " Thinking is off for this model.");
        return {
          content: [{ type: "text", text: msg }],
          details: { current_level: current, available_levels: available, supports_thinking: supportsThinking },
        };
      }

      if (!THINKING_LEVELS.includes(requested)) {
        return {
          content: [{ type: "text", text: `Unknown thinking level: ${params.level}. Available: ${available.join(", ")}.` }],
          details: { available_levels: available },
        };
      }

      const resolved = resolveThinkingAlias(requested, model) as ThinkingLevel;
      pi.setThinkingLevel(resolved);
      const applied = formatThinkingLevelForDisplay(pi.getThinkingLevel(), model);

      if (!supportsThinking) {
        const msg = requested === "off"
          ? "Thinking is off for this model."
          : "Current model does not support thinking levels. Thinking is off.";
        return {
          content: [{ type: "text", text: msg }],
          details: { current_level: applied, available_levels: available, supports_thinking: false },
        };
      }

      const note = applied !== requested ? ` (requested ${requested})` : "";
      return {
        content: [{ type: "text", text: `Thinking level set to ${applied}${note}.` }],
        details: { current_level: applied, available_levels: available, supports_thinking: true },
      };
    },
  });
};
