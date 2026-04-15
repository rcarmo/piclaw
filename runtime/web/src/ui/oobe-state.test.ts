import { expect, test } from 'bun:test';

import { countAvailableModels, resolveOobePanelState } from './oobe-state.js';

test('countAvailableModels counts model_options first and falls back to models', () => {
  expect(countAvailableModels({ model_options: [{ label: 'a' }, { label: 'b' }], models: ['x'] })).toBe(2);
  expect(countAvailableModels({ models: ['a', '', 'b', null] })).toBe(2);
  expect(countAvailableModels(null)).toBe(0);
});

test('blank installs stay in provider-missing even if a current model string exists', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { current: 'openai/gpt-5' },
    providerMissingDismissed: false,
    providerReadyCompleted: false,
  })).toEqual({
    kind: 'provider-missing',
    hasAvailableModels: false,
    availableModelCount: 0,
  });
});

test('configured instances show provider-ready guidance once actual available models exist', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: {
      current: 'openai/gpt-5',
      model_options: [{ label: 'openai/gpt-5', provider: 'openai', id: 'gpt-5' }],
    },
    providerMissingDismissed: false,
    providerReadyCompleted: false,
  })).toEqual({
    kind: 'provider-ready',
    hasAvailableModels: true,
    availableModelCount: 1,
  });
});

test('provider-ready guidance stays hidden once completed', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: {
      current: 'openai/gpt-5',
      model_options: [{ label: 'openai/gpt-5', provider: 'openai', id: 'gpt-5' }],
    },
    providerMissingDismissed: false,
    providerReadyCompleted: true,
  })).toEqual({
    kind: 'hidden',
    hasAvailableModels: true,
    availableModelCount: 1,
  });
});
