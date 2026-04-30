import { expect, test } from 'bun:test';

import {
  SLASH_COMMANDS,
  formatModelPickerContextWindow,
  formatModelPickerDisplayLabel,
  getComposeHistoryStorageKey,
  getModelPickerContextLimit,
  getModelPickerOptionSearchLabel,
  normalizeModelPickerOptions,
  resolveComposeExtensionWorkingDisplay,
  resolveComposeModelPickerState,
  buildReturnedQueuedDraft,
  parseQueuedContent,
  returnQueuedFollowupToEditor,
  resolveComposePrefillRequest,
  resolveComposeSubmitButtonState,
  resolveComposeAbortButtonState,
  isComposeSubmitAbortMode,
  resolveSessionPopupChats,
  isSessionPopupChatEmphasized,
  resolveSessionPopupInitialIndex,
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

test('slash autocomplete exposes the local /help keyboard shortcut pane command', () => {
  const help = SLASH_COMMANDS.find((item) => item.name === '/help');
  expect(help).toBeTruthy();
  expect(help?.description).toContain('keyboard shortcuts');
});

test('resolveSessionPopupChats keeps the current session in alphabetical order with archived rows last', () => {
  expect(resolveSessionPopupChats([
    { chat_jid: 'web:zeta', agent_name: 'Zeta', is_active: false },
    { chat_jid: 'web:alpha', agent_name: 'Alpha', is_active: true },
    { chat_jid: 'web:beta', agent_name: 'beta', is_active: false },
    { chat_jid: 'web:archived', agent_name: 'Archived', archived_at: '2026-04-29T00:00:00Z', is_active: false },
    { chat_jid: 'web:alpha', agent_name: 'Alpha', is_active: true },
  ], 'web:alpha').map((chat) => chat.chat_jid)).toEqual([
    'web:alpha',
    'web:beta',
    'web:zeta',
    'web:archived',
  ]);
});

test('isSessionPopupChatEmphasized only highlights active non-archived sessions', () => {
  expect(isSessionPopupChatEmphasized({ is_active: true, archived_at: null })).toBe(true);
  expect(isSessionPopupChatEmphasized({ is_active: true, archived_at: '2026-04-29T00:00:00Z' })).toBe(false);
  expect(isSessionPopupChatEmphasized({ is_active: false, archived_at: null })).toBe(false);
});

test('resolveSessionPopupInitialIndex prefers the current session over the first alphabetical row', () => {
  expect(resolveSessionPopupInitialIndex([
    { type: 'session', chat: { chat_jid: 'web:alpha' }, disabled: false },
    { type: 'session', chat: { chat_jid: 'web:current' }, disabled: false },
    { type: 'action', key: 'action:new', disabled: false },
  ], 'web:current')).toBe(1);
  expect(resolveSessionPopupInitialIndex([
    { type: 'session', chat: { chat_jid: 'web:alpha' }, disabled: false },
    { type: 'session', chat: { chat_jid: 'web:current' }, disabled: true },
    { type: 'action', key: 'action:new', disabled: false },
  ], 'web:current')).toBe(0);
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

test('parseQueuedContent normalizes backtick-wrapped file refs from Files blocks', () => {
  const parsed = parseQueuedContent([
    'Channel: web',
    '',
    'Rui Carmo @ 2026-04-26T18:11:58.022Z:',
    '  Fixed it.',
    '  ',
    '  Files:',
    '  - `piclaw/runtime/extensions/viewers/editor/markdown/code-block.ts`',
    '  - `piclaw/runtime/web/static/dist/editor.bundle.js`',
  ].join('\n'));

  expect(parsed.text).toBe('Fixed it.');
  expect(parsed.fileRefs).toEqual([
    'piclaw/runtime/extensions/viewers/editor/markdown/code-block.ts',
    'piclaw/runtime/web/static/dist/editor.bundle.js',
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

test('returnQueuedFollowupToEditor restores compose state before removing the queue item', () => {
  const calls: string[] = [];
  const textarea = {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    focus: () => { calls.push('focus'); },
  };
  const timeoutCallbacks: Array<() => void> = [];

  const result = returnQueuedFollowupToEditor({
    queuedItem: {
      row_id: 7,
      content: [
        'Channel: web',
        '',
        'Rui Carmo @ 2026-04-13T08:40:35.008Z:',
        '  Please check this later.',
        '  ',
        '  Files:',
        '  - notes/todo.md',
      ].join('\n'),
    },
    setSubmitError: (value: string | null) => { calls.push(`error:${String(value)}`); },
    setSubmitNotice: (value: string | null) => { calls.push(`notice:${String(value)}`); },
    setMediaFiles: (value: unknown[]) => { calls.push(`media:${Array.isArray(value) ? value.length : 'x'}`); },
    onSetFileRefs: (value: string[]) => { calls.push(`files:${value.join(',')}`); },
    onSetMessageRefs: (value: string[]) => { calls.push(`messages:${value.join(',')}`); },
    setContent: (value: string) => { calls.push(`content:${value}`); },
    textareaRef: { current: textarea },
    resizeTextarea: () => { calls.push('resize'); },
    scheduleRaf: (callback: () => void) => { calls.push('raf'); callback(); },
    scheduleTimeout: (callback: () => void) => { calls.push('timeout'); timeoutCallbacks.push(callback); return 0 as any; },
    onRemoveQueuedFollowup: () => { calls.push('remove'); },
    logger: { info: () => undefined, warn: () => undefined },
  });

  expect(result).toBe(true);
  expect(calls).toEqual([
    'error:null',
    'notice:null',
    'media:0',
    'files:notes/todo.md',
    'messages:',
    'content:Please check this later.',
    'raf',
    'resize',
    'focus',
    'timeout',
  ]);
  expect(textarea.value).toBe('Please check this later.');
  expect(textarea.selectionStart).toBe('Please check this later.'.length);
  expect(textarea.selectionEnd).toBe('Please check this later.'.length);

  timeoutCallbacks[0]?.();
  expect(calls).toContain('remove');
  expect(calls.indexOf('content:Please check this later.')).toBeLessThan(calls.indexOf('remove'));
});

test('model picker helpers expose searchable names, formatted context windows, and context-fit guards', () => {
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

  expect(getModelPickerContextLimit(option, { tokens: 150000 })).toEqual({
    blocked: false,
    note: '',
    title: '',
    tokens: 150000,
    contextWindow: 200000,
  });

  expect(getModelPickerContextLimit({ ...option, contextWindow: 128000 }, { tokens: 150000 })).toEqual({
    blocked: true,
    note: 'Current context won’t fit — compact first',
    title: 'Current context uses 150K tokens, but this model only fits 128K. Compact first.',
    tokens: 150000,
    contextWindow: 128000,
  });
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
