import { expect, test } from 'bun:test';

import { resolveModelStateUpdate } from '../../web/src/ui/app-model-state.js';

test('resolveModelStateUpdate normalizes model/thinking/supports/provider fields from payloads', () => {
  expect(resolveModelStateUpdate({
    model: 'gpt-5',
    thinking_level: 'high',
    supports_thinking: 1,
    provider_usage: { input_tokens: 10 },
  })).toEqual({
    hasModel: true,
    model: 'gpt-5',
    hasThinkingLevel: true,
    thinkingLevel: 'high',
    thinkingLevelLabel: 'high',
    hasSupportsThinking: true,
    supportsThinking: true,
    hasProviderUsage: true,
    providerUsage: { input_tokens: 10 },
  });
});

test('resolveModelStateUpdate preserves nullish fallback semantics from app.ts', () => {
  expect(resolveModelStateUpdate({ model: null })).toEqual({
    hasModel: false,
    model: undefined,
    hasThinkingLevel: false,
    thinkingLevel: null,
    thinkingLevelLabel: null,
    hasSupportsThinking: false,
    supportsThinking: false,
    hasProviderUsage: false,
    providerUsage: null,
  });

  expect(resolveModelStateUpdate({ current: null, thinking_level: null, supports_thinking: 0, provider_usage: null })).toEqual({
    hasModel: true,
    model: null,
    hasThinkingLevel: true,
    thinkingLevel: null,
    thinkingLevelLabel: null,
    hasSupportsThinking: true,
    supportsThinking: false,
    hasProviderUsage: true,
    providerUsage: null,
  });

  expect(resolveModelStateUpdate(undefined)).toEqual({
    hasModel: false,
    model: undefined,
    hasThinkingLevel: false,
    thinkingLevel: null,
    thinkingLevelLabel: null,
    hasSupportsThinking: false,
    supportsThinking: false,
    hasProviderUsage: false,
    providerUsage: null,
  });
});
