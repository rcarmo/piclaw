import { expect, test } from 'bun:test';

import {
  countAvailableModels,
  resolveOobePanelState,
} from '../../web/src/ui/oobe-state.ts';

test('countAvailableModels prefers structured model options and falls back to legacy model labels', () => {
  expect(countAvailableModels({ model_options: [{ label: 'openai/gpt-4.1' }, { label: 'anthropic/claude-sonnet-4' }] })).toBe(2);
  expect(countAvailableModels({ models: ['openai/gpt-4.1', ''] })).toBe(1);
  expect(countAvailableModels(null)).toBe(0);
});

test('resolveOobePanelState shows the provider-missing panel when models are loaded but unavailable', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { models: [] },
    activeModel: null,
  })).toEqual({
    kind: 'provider-missing',
    hasAvailableModels: false,
    availableModelCount: 0,
  });
});

test('resolveOobePanelState shows provider-ready guidance when models are available', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { model_options: [{ label: 'openai/gpt-4.1' }] },
    activeModel: null,
  })).toEqual({
    kind: 'provider-ready',
    hasAvailableModels: true,
    availableModelCount: 1,
  });
});

test('resolveOobePanelState keeps dismissed or completed panels hidden', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { models: [] },
    providerMissingDismissed: true,
  }).kind).toBe('hidden');

  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { models: ['openai/gpt-4.1'] },
    providerReadyCompleted: true,
  }).kind).toBe('hidden');
});

test('resolveOobePanelState suppresses the panel in pane-popout mode and before model readiness is known', () => {
  expect(resolveOobePanelState({
    panePopoutMode: true,
    modelsLoaded: true,
    modelPayload: { models: ['openai/gpt-4.1'] },
  }).kind).toBe('hidden');

  expect(resolveOobePanelState({
    panePopoutMode: false,
    modelsLoaded: false,
    modelPayload: { models: [] },
  }).kind).toBe('hidden');
});
