export interface ModelStateUpdate {
  hasModel: boolean;
  model: unknown;
  hasThinkingLevel: boolean;
  thinkingLevel: unknown;
  thinkingLevelLabel: unknown;
  hasSupportsThinking: boolean;
  supportsThinking: boolean;
  hasProviderUsage: boolean;
  providerUsage: unknown;
}

const EMPTY_MODEL_STATE_UPDATE: ModelStateUpdate = {
  hasModel: false,
  model: undefined,
  hasThinkingLevel: false,
  thinkingLevel: null,
  thinkingLevelLabel: null,
  hasSupportsThinking: false,
  supportsThinking: false,
  hasProviderUsage: false,
  providerUsage: null,
};

export function resolveModelStateUpdate(payload: Record<string, unknown> | null | undefined): ModelStateUpdate {
  if (!payload || typeof payload !== 'object') {
    return EMPTY_MODEL_STATE_UPDATE;
  }

  const nextModel = payload.model ?? payload.current;

  return {
    hasModel: nextModel !== undefined,
    model: nextModel,
    hasThinkingLevel: payload.thinking_level !== undefined,
    thinkingLevel: payload.thinking_level ?? null,
    thinkingLevelLabel: payload.thinking_level_label ?? payload.thinking_level ?? null,
    hasSupportsThinking: payload.supports_thinking !== undefined,
    supportsThinking: Boolean(payload.supports_thinking),
    hasProviderUsage: payload.provider_usage !== undefined,
    providerUsage: payload.provider_usage ?? null,
  };
}
