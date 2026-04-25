import { expect, test } from 'bun:test';

import {
  SLASH_COMMANDS,
  formatModelPickerContextWindow,
  formatModelPickerDisplayLabel,
  getComposeHistoryStorageKey,
  getModelPickerOptionSearchLabel,
  normalizeModelPickerOptions,
  resolveComposeExtensionWorkingDisplay,
  resolveComposeModelPickerState,
  buildReturnedQueuedDraft,
  parseQueuedContent,
  resolveComposePrefillRequest,
  resolveComposeSubmitButtonState,
  resolveComposeAbortButtonState,
  isComposeSubmitAbortMode,
  resolveUiOnlyCommandNotice,
} from '../../web/src/components/compose-box.ts';
import { CONTROL_COMMAND_DEFINITIONS } from '../../src/agent-control/command-registry.ts';

test('getComposeHistoryStorageKey keeps the legacy default key for the default chat', () => {
  expect(getComposeHistoryStorageKey()).toBe('piclaw_compose_history');
  expect(getComposeHistoryStorageKey('web:default')).toBe('piclaw_compose_history');
  expect(getComposeHistoryStorageKey('')).toBe('piclaw_compose_history');
});

test('getComposeHistoryStorageKey namespaces compose history by chat/agent', () => {
  expect(getComposeHistoryStorageKey('web:agent-alpha')).toBe('piclaw_compose_history:web%3Aagent-alpha');
  expect(getComposeHistoryStorageKey('whatsapp:+12345')).toBe('piclaw_compose_history:whatsapp%3A%2B12345');
});

test('normalizeModelPickerOptions prefers structured model metadata and sorts by provider/id label', () => {
  expect(normalizeModelPickerOptions({
    model_options: [
      { provider: 'anthropic', id: 'claude-sonnet-4', label: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', context_window: 200000, reasoning: true },
      { provider: 'openai', id: 'gpt-4.1', label: 'openai/gpt-4.1', name: 'GPT-4.1', context_window: 128000, reasoning: false },
    ],
  })).toEqual([
    {
      label: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
      id: 'claude-sonnet-4',
      name: 'Claude Sonnet 4',
      contextWindow: 200000,
      reasoning: true,
    },
    {
      label: 'openai/gpt-4.1',
      provider: 'openai',
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      contextWindow: 128000,
      reasoning: false,
    },
  ]);
});

test('normalizeModelPickerOptions falls back to legacy string labels', () => {
  expect(normalizeModelPickerOptions({
    models: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4'],
  })).toEqual([
    {
      label: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
      id: 'claude-sonnet-4',
      name: null,
      contextWindow: null,
      reasoning: false,
    },
    {
      label: 'openai/gpt-4.1',
      provider: 'openai',
      id: 'gpt-4.1',
      name: null,
      contextWindow: null,
      reasoning: false,
    },
  ]);
});

test('slash autocomplete includes all canonical control commands', () => {
  const composeNames = new Set(SLASH_COMMANDS.map((item) => item.name));
  const missing = CONTROL_COMMAND_DEFINITIONS
    .map((item) => item.name)
    .filter((name) => !composeNames.has(name));

  expect(missing).toEqual([]);
});

test('slash autocomplete exposes the local /meters HUD command with a description', () => {
  const meters = SLASH_COMMANDS.find((item) => item.name === '/meters');
  expect(meters).toBeTruthy();
  expect(meters?.description).toContain('CPU/RAM HUD');
});

test('resolveComposePrefillRequest applies new non-search prefill tokens exactly once', () => {
  expect(resolveComposePrefillRequest({ token: 'tok-1', text: '/login' }, '', false)).toEqual({
    shouldApply: true,
    nextToken: 'tok-1',
    text: '/login',
  });

  expect(resolveComposePrefillRequest({ token: 'tok-1', text: '/login' }, 'tok-1', false)).toEqual({
    shouldApply: false,
    nextToken: 'tok-1',
    text: '',
  });

  expect(resolveComposePrefillRequest({ token: 'tok-2', text: '/login' }, '', true)).toEqual({
    shouldApply: false,
    nextToken: '',
    text: '',
  });
});

test('parseQueuedContent extracts file, message, and attachment refs from transcript-wrapped queue items', () => {
  const parsed = parseQueuedContent([
    'Channel: web',
    '',
    'Rui Carmo @ 2026-04-13T08:40:35.008Z:',
    '  Please check this later.',
    '  ',
    '  Files:',
    '  - notes/todo.md',
    '  ',
    '  Referenced messages:',
    '  - message:23123',
    '  ',
    '  Attachments:',
    '  - attachment:784 (image.png)',
  ].join('\n'));

  expect(parsed.text).toBe('Please check this later.');
  expect(parsed.fileRefs).toEqual(['notes/todo.md']);
  expect(parsed.messageRefs).toEqual(['23123']);
  expect(parsed.attachmentRefs).toEqual([
    { id: '784', label: 'image.png', raw: 'attachment:784 (image.png)' },
  ]);
});

test('buildReturnedQueuedDraft restores refs and preserves attachment markers in compose text', () => {
  const restored = buildReturnedQueuedDraft([
    'Channel: web',
    '',
    'Rui Carmo @ 2026-04-13T08:40:35.008Z:',
    '  Please check this later.',
    '  ',
    '  Files:',
    '  - notes/todo.md',
    '  ',
    '  Referenced messages:',
    '  - message:23123',
    '  ',
    '  Attachments:',
    '  - attachment:784 (image.png)',
  ].join('\n'));

  expect(restored).toEqual({
    content: 'Please check this later.\n\nAttachments:\n- attachment:784 (image.png)',
    fileRefs: ['notes/todo.md'],
    messageRefs: ['23123'],
    attachmentRefs: [
      { id: '784', label: 'image.png', raw: 'attachment:784 (image.png)' },
    ],
  });
});

test('model picker helpers expose searchable names and formatted context windows', () => {
  const option = {
    label: 'anthropic/claude-sonnet-4',
    provider: 'anthropic',
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    contextWindow: 200000,
  };

  expect(formatModelPickerContextWindow(200000)).toBe('200K ctx');
  expect(formatModelPickerDisplayLabel('anthropic/claude-sonnet-4', 200000)).toBe('anthropic/claude-sonnet-4 • 200K ctx');
  expect(formatModelPickerDisplayLabel('anthropic/claude-sonnet-4', null)).toBe('anthropic/claude-sonnet-4');
  expect(getModelPickerOptionSearchLabel(option)).toContain('anthropic/claude-sonnet-4');
  expect(getModelPickerOptionSearchLabel(option)).toContain('Claude Sonnet 4');
  expect(getModelPickerOptionSearchLabel(option)).toContain('200K ctx');
});

test('resolveComposeModelPickerState keeps the model picker visible for cold chats with available models', () => {
  expect(resolveComposeModelPickerState(null, {
    current: null,
    model_options: [{ label: 'openai/gpt-5', provider: 'openai', id: 'gpt-5' }],
  })).toEqual({
    showPicker: true,
    label: 'Select model',
    hasAvailableModels: true,
  });

  expect(resolveComposeModelPickerState('openai/gpt-5', {
    current: null,
    model_options: [{ label: 'openai/gpt-5', provider: 'openai', id: 'gpt-5' }],
  })).toEqual({
    showPicker: true,
    label: 'openai/gpt-5',
    hasAvailableModels: true,
  });

  expect(resolveComposeModelPickerState(null, { current: null, model_options: [] })).toEqual({
    showPicker: false,
    label: '',
    hasAvailableModels: false,
  });
});

test('resolveComposeExtensionWorkingDisplay renders default, custom, and hidden indicator states', () => {
  expect(resolveComposeExtensionWorkingDisplay(null)).toEqual({
    visible: false,
    title: '',
    indicatorText: null,
    animateDot: false,
  });

  expect(resolveComposeExtensionWorkingDisplay({
    message: 'Compacting context…',
    indicator: { mode: 'default', frames: [], intervalMs: null },
  })).toEqual({
    visible: true,
    title: 'Compacting context…',
    indicatorText: null,
    animateDot: true,
  });

  expect(resolveComposeExtensionWorkingDisplay({
    message: null,
    indicator: { mode: 'custom', frames: ['⠋', '⠙'], intervalMs: 90 },
  }, 1)).toEqual({
    visible: true,
    title: 'Working…',
    indicatorText: '⠙',
    animateDot: false,
  });

  expect(resolveComposeExtensionWorkingDisplay({
    message: 'Background sync',
    indicator: { mode: 'hidden', frames: [], intervalMs: null },
  })).toEqual({
    visible: true,
    title: 'Background sync',
    indicatorText: null,
    animateDot: false,
  });
});

test('resolveComposeSubmitButtonState stays coherent across send and queue states', () => {
  expect(resolveComposeSubmitButtonState(true, true, true)).toEqual({
    mode: 'queue',
    className: 'icon-btn send-btn queue-mode',
    title: 'Queue follow-up (Enter)',
    ariaLabel: 'Queue follow-up message',
    disabled: false,
  });

  expect(resolveComposeSubmitButtonState(true, false, false)).toEqual({
    mode: 'queue',
    className: 'icon-btn send-btn queue-mode',
    title: 'Queue follow-up (Enter)',
    ariaLabel: 'Queue follow-up message',
    disabled: true,
  });

  expect(resolveComposeSubmitButtonState(false, true, true)).toEqual({
    mode: 'send',
    className: 'icon-btn send-btn',
    title: 'Send (Enter)',
    ariaLabel: 'Send message',
    disabled: false,
  });

  expect(resolveComposeSubmitButtonState(false, false, false)).toEqual({
    mode: 'send',
    className: 'icon-btn send-btn',
    title: 'Send (Enter)',
    ariaLabel: 'Send message',
    disabled: true,
  });
});

test('resolveComposeAbortButtonState stays coherent across idle, stop, and compacting states', () => {
  expect(resolveComposeAbortButtonState(false, false)).toBeNull();

  expect(resolveComposeAbortButtonState(true, true)).toEqual({
    mode: 'compacting',
    className: 'icon-btn send-btn abort-mode compacting-mode',
    title: 'Compacting context — Stop response',
    ariaLabel: 'Compacting context — Stop response',
    disabled: false,
  });

  expect(resolveComposeAbortButtonState(true, false)).toEqual({
    mode: 'abort',
    className: 'icon-btn send-btn abort-mode',
    title: 'Stop response',
    ariaLabel: 'Stop response',
    disabled: false,
  });
});

test('isComposeSubmitAbortMode keeps compacting on the abort path', () => {
  expect(isComposeSubmitAbortMode('abort')).toBe(true);
  expect(isComposeSubmitAbortMode('compacting')).toBe(true);
  expect(isComposeSubmitAbortMode('send')).toBe(false);
  expect(isComposeSubmitAbortMode(null)).toBe(false);
});

test('resolveUiOnlyCommandNotice only surfaces read-only model and thinking queries', () => {
  expect(resolveUiOnlyCommandNotice('/thinking', {
    ui_only: true,
    command: { message: 'Current thinking (effort) level: max.' },
  })).toBe('Current thinking (effort) level: max.');

  expect(resolveUiOnlyCommandNotice('/effort', {
    ui_only: true,
    command: { message: 'Current thinking (effort) level: max.' },
  })).toBe('Current thinking (effort) level: max.');

  expect(resolveUiOnlyCommandNotice('/model', {
    ui_only: true,
    command: { message: 'Available models:\n• anthropic/claude-opus-4-6 (current)' },
  })).toContain('Available models:');

  expect(resolveUiOnlyCommandNotice('/thinking high', {
    ui_only: true,
    command: { message: 'Thinking level set to high.' },
  })).toBeNull();

  expect(resolveUiOnlyCommandNotice('/cycle-model', {
    ui_only: true,
    command: { message: 'Model set to openai/gpt-5.' },
  })).toBeNull();
});
