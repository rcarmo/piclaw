import { assertModelContextFits, type ModelContextAdmission } from "./host-model-context.js";
import { Type, getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { AgentDoc, configure, defineTool, type ConversationId, type TaskId } from "@earendil-works/pi-durable";

export const hostModelToolNames = ["list_models", "get_model_state", "set_model", "switch_model", "switch_thinking"] as const;
export const nativeToolInstructions = `## Native tools and model controls
Use read, bash, edit and write for files and shell commands. The host preserves their native schemas; do not substitute exec_command, write_stdin or apply_patch.
Use list_models to inspect authenticated models, get_model_state for this conversation's persisted selection, and set_model to change model and/or thinking_level. An empty set_model call only inspects state. Changes affect the next model request; they do not replay input or change global defaults.
Codemode is available as the codemode tool with {code: "raw JavaScript"}. It runs durable JavaScript, not Bun or Node. Discover its callable tools with searchTools(\"query\"), inspect schemas with describeTool(name), then invoke tools.<name>(arguments). Use console.log or return to expose results. It has no direct filesystem, network, shell, timers or model API. Call bash or another exposed tool through tools instead. Do not claim codemode is unavailable without checking its declarations. History mentioning missing tools is not a current tool inventory.`;

interface Options {
  assertCurrent(): void;
  available(): readonly Model<Api>[];
  prepareContext(call: { conversationId: ConversationId; taskId: TaskId; toolCallId: string }, model: { provider: string; modelId: string }, thinkingLevel?: string): Promise<ModelContextAdmission>;
  assertModel(choice: { provider: string; modelId: string }): void;
  captureSourceGuard(call: { conversationId: ConversationId; taskId: TaskId; toolCallId: string }): Promise<() => void>;
}
const selection = Type.Object({ model: Type.Optional(Type.String()), thinking_level: Type.Optional(Type.String()) });
const text = (value: unknown) => ({ output: [{ type: "text" as const, text: JSON.stringify(value) }] });

/** Conversation-local SDK configuration, authorised by the exact live model tool.
 * Never use the idle operator port from inside a running turn, or mutate defaults.
 */
export function createHostModelTools(options: Options) {
  return hostModelToolNames.map(name => defineTool({
    name, description: name === "list_models" ? "List currently authenticated/approved models; optional query, limit and offset."
      : name === "get_model_state" ? "Read this conversation's persisted model and thinking level."
      : name === "switch_model" ? "Select a model for this conversation's next model request. Use provider/modelId or a unique model ID."
      : name === "switch_thinking" ? "Select a supported thinking level for this conversation's next request."
      : "Inspect or set this conversation's model and/or thinking_level. Empty arguments inspect only. Changes apply on the next request; no turn replay.",
    parameters: name === "list_models" ? Type.Object({ query: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })), offset: Type.Optional(Type.Integer({ minimum: 0 })) })
      : name === "get_model_state" ? Type.Object({})
      : name === "switch_model" ? Type.Object({ model: Type.String() })
      : name === "switch_thinking" ? Type.Object({ level: Type.String() }) : selection,
    callers: ["model"], replay: "unsafe",
    async execute(raw: any, api, context) {
      options.assertCurrent();
      const guard = await options.captureSourceGuard({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId });
      const check = () => { context.abortSignal?.throwIfAborted(); options.assertCurrent(); guard(); };
      check();
      const catalog = options.available();
      if (name === "list_models") {
        const query = (raw.query ?? "").toLowerCase();
        const filtered = catalog.filter(model => `${model.provider}/${model.id} ${model.name}`.toLowerCase().includes(query));
        const offset = raw.offset ?? 0, limit = raw.limit ?? 50;
        check();
        return text({ models: filtered.slice(offset, offset + limit).map(model => ({ provider: model.provider, id: model.id, name: model.name,
          contextWindow: model.contextWindow, maxTokens: model.maxTokens, thinking_levels: getSupportedThinkingLevels(model) })), total: filtered.length, offset });
      }
      let choice: { provider: string; modelId: string } | undefined;
      if (raw.model !== undefined) {
        const matches = catalog.filter(model => `${model.provider}/${model.id}` === raw.model || model.id === raw.model);
        if (matches.length !== 1) return text({ error: matches.length ? "Model ID is ambiguous; use provider/modelId." : "Model is not available; use list_models." });
        choice = { provider: matches[0]!.provider, modelId: matches[0]!.id };
        options.assertModel(choice); check();
      }
      const requestedLevel = name === "switch_thinking" ? raw.level : raw.thinking_level;
      const changing = !!choice || requestedLevel !== undefined;
      const resolved = choice ? await api.agent(context) : undefined;
      check();
      const needsContextCheck = !!choice && (resolved?.model?.provider !== choice.provider || resolved?.model?.modelId !== choice.modelId);
      // Only a different model needs candidate context admission. Level-only
      // changes, including an explicit unchanged model, preserve current limits.
      const admission = needsContextCheck ? await options.prepareContext({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId }, choice!, requestedLevel) : undefined;
      check();
      const result = await api.commit(async tx => {
        check();
        const current = await tx.doc(AgentDoc, api.conversationId);
        check();
        const target = choice ?? current.model;
        const model = target && catalog.find(model => model.provider === target.provider && model.id === target.modelId);
        if (!model || !target) return { error: "Current model is not available; use list_models." };
        options.assertModel(target); check();
        const supported = getSupportedThinkingLevels(model);
        const level = requestedLevel ?? current.thinkingLevel;
        if (level !== undefined && !supported.includes(level as any)) return { error: "Unsupported thinking level for the selected model; specify a supported thinking_level.", thinking_levels: supported };
        if (changing) {
          const changesModel = !!choice && (current.model?.provider !== choice.provider || current.model?.modelId !== choice.modelId);
          if (changesModel) {
            if (!needsContextCheck) throw Error("Model selection changed; retry the command.");
            if (admission) { await admission.assertCurrent(tx, current); check(); }
            assertModelContextFits(admission!.messages, model);
          }
          // Public SDK commit keeps this atomic with the owned tool result. Recheck
          // model policy and source after every await, including immediately before commit.
          await configure(tx, api.conversationId, { ...(choice ? { model: choice } : {}), ...(level !== undefined ? { thinkingLevel: level as any } : {}) });
          admission?.assertScopeCurrent(); check(); options.assertModel(target);
        }
        return { model: `${target.provider}/${target.modelId}`, thinking_level: level ?? null, thinking_levels: supported,
          changed: !!choice || requestedLevel !== undefined, applies_to: "next model request" };
      }, context);
      check(); return text(result);
    },
  }));
}
