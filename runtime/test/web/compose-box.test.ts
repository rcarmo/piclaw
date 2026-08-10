import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SLASH_COMMANDS,
  formatModelPickerContextWindow,
  formatModelPickerDisplayLabel,
  getComposeHistoryStorageKey,
  getModelPickerContextLimit,
  getModelPickerOptionSearchLabel,
  normalizeModelPickerOptions,
  resolveComposeCacheHitMeta,
  resolveComposeExtensionWorkingDisplay,
  resolveComposeModelPickerState,
  resolveComposeRoutedModelStatus,
  buildReturnedQueuedDraft,
  parseQueuedContent,
  returnQueuedFollowupToEditor,
  resolveComposePrefillRequest,
  resolveComposeSubmitButtonState,
  resolveComposeAbortButtonState,
  resolveComposeAbortAuthority,
  shouldStartSpeechPushToTalk,
  shouldStopSpeechPushToTalk,
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

test('resolveComposeCacheHitMeta formats latest prompt cache-hit telemetry', () => {
  expect(resolveComposeCacheHitMeta({
    cacheUsage: {
      latest: {
        inputTokens: 1000,
        outputTokens: 300,
        cacheReadTokens: 3000,
        cacheWriteTokens: 1000,
        totalTokens: 5300,
        cacheHitRate: 60,
        runs: 1,
      },
      totals: {
        inputTokens: 2000,
        outputTokens: 600,
        cacheReadTokens: 6000,
        cacheWriteTokens: 2000,
        totalTokens: 10600,
        cacheHitRate: 60,
        runs: 2,
      },
    },
  })).toEqual({
    label: 'CH60.0%',
    title: 'Prompt cache hit: 60.0% latest run • in 1K, out 300, cache-r 3K, cache-w 1K • Session total: 60.0% across 2 runs',
    cacheHitRate: 60,
  });
});

test('resolveComposeCacheHitMeta computes cache-hit telemetry when the API omits a rate', () => {
  expect(resolveComposeCacheHitMeta({
    cacheUsage: {
      latest: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 7000,
        cacheWriteTokens: 2000,
      },
    },
  })?.label).toBe('CH70.0%');
});

test('resolveComposeCacheHitMeta ignores missing or zero cache-read telemetry', () => {
  expect(resolveComposeCacheHitMeta(null)).toBeNull();
  expect(resolveComposeCacheHitMeta({ cacheUsage: { latest: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 1000 } } })).toBeNull();
});

test('compose cache-hit label renders inline with model usage metadata', () => {
  const source = readFileSync(join(import.meta.dir, '../../web/src/components/compose-box.ts'), 'utf8');
  expect(source).toContain('cacheHitMeta?.label || null');
  expect(source).not.toContain('compose-cache-hit-chip');
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

test('resolveSessionPopupChats excludes locally hidden sessions after delete confirmation', () => {
  expect(resolveSessionPopupChats([
    { chat_jid: 'web:alpha', agent_name: 'Alpha', is_active: true },
    { chat_jid: 'web:archived', agent_name: 'Archived', archived_at: '2026-04-29T00:00:00Z', is_active: false },
    { chat_jid: 'web:zeta', agent_name: 'Zeta', is_active: false },
  ], 'web:alpha', new Set(['web:archived'])).map((chat) => chat.chat_jid)).toEqual([
    'web:alpha',
    'web:zeta',
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

test('parseQueuedContent extracts file, folder, message, and attachment refs from transcript-wrapped queue items', () => {
  const parsed = parseQueuedContent([
    'Channel: web',
    'Chat: web:default',
    '',
    'Rui Carmo @ 2026-04-13T08:40:35.008Z:',
    '  Please check this later.',
    '  ',
    '  Files:',
    '  - notes/todo.md',
    '  ',
    '  Folders:',
    '  - runtime/web/src/components',
    '  ',
    '  Referenced messages:',
    '  - message:23123',
    '  ',
    '  Attachments:',
    '  - attachment:784 (image.png)',
  ].join('\n'));

  expect(parsed.text).toBe('Please check this later.');
  expect(parsed.fileRefs).toEqual(['notes/todo.md']);
  expect(parsed.folderRefs).toEqual(['runtime/web/src/components']);
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
    '  - `piclaw/runtime/web/static/classic/dist/editor.bundle.js`',
  ].join('\n'));

  expect(parsed.text).toBe('Fixed it.');
  expect(parsed.fileRefs).toEqual([
    'piclaw/runtime/extensions/viewers/editor/markdown/code-block.ts',
    'piclaw/runtime/web/static/classic/dist/editor.bundle.js',
  ]);
});

test('QueuedFollowupStack renders move-up before move-down controls', () => {
  const source = readFileSync(join(import.meta.dir, '../../web/src/components/compose-box.ts'), 'utf8');
  const controlsStart = source.indexOf("aria-label=${t('compose.queueControls')}");
  expect(controlsStart).toBeGreaterThan(-1);
  const moveUpIndex = source.indexOf('data-action="move-up"', controlsStart);
  const moveDownIndex = source.indexOf('data-action="move-down"', controlsStart);
  expect(moveUpIndex).toBeGreaterThan(-1);
  expect(moveDownIndex).toBeGreaterThan(-1);
  expect(moveUpIndex).toBeLessThan(moveDownIndex);
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
    '  Folders:',
    '  - runtime/web/src/components',
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
    folderRefs: ['runtime/web/src/components'],
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
        '  ',
        '  Folders:',
        '  - runtime/web/src/components',
      ].join('\n'),
    },
    setSubmitError: (value: string | null) => { calls.push(`error:${String(value)}`); },
    setSubmitNotice: (value: string | null) => { calls.push(`notice:${String(value)}`); },
    setMediaFiles: (value: unknown[]) => { calls.push(`media:${Array.isArray(value) ? value.length : 'x'}`); },
    onSetFileRefs: (value: string[]) => { calls.push(`files:${value.join(',')}`); },
    onSetFolderRefs: (value: string[]) => { calls.push(`folders:${value.join(',')}`); },
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
    'folders:runtime/web/src/components',
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
    safetyAdjustedTokens: 165000,
    contextWindow: 200000,
    effectiveContextWindow: 196000,
  });

  expect(getModelPickerContextLimit({ ...option, contextWindow: 128000 }, { tokens: 150000 })).toEqual({
    blocked: true,
    note: 'Compact context first',
    title: 'Current context uses 150K tokens (~165K with estimator safety) plus app/tool overhead, but this model effectively fits about 124K (128K raw). Compact context first, then switch.',
    tokens: 150000,
    safetyAdjustedTokens: 165000,
    contextWindow: 128000,
    effectiveContextWindow: 124000,
  });

  expect(getModelPickerContextLimit({ ...option, contextWindow: 4096 }, { tokens: 100 })).toEqual({
    blocked: true,
    note: 'Compact context first',
    title: 'Current context uses 100 tokens (~110 with estimator safety) plus app/tool overhead, but this model effectively fits about 96 (4K raw). Compact context first, then switch.',
    tokens: 100,
    safetyAdjustedTokens: 110,
    contextWindow: 4096,
    effectiveContextWindow: 96,
  });
});

test('resolveComposeRoutedModelStatus shows latest routed model when it differs from the requested model', () => {
  expect(resolveComposeRoutedModelStatus('openrouter/auto', {
    current: 'openrouter/auto',
    latest_requested_model: 'openrouter/auto',
    latest_response_model: 'anthropic/claude-sonnet-4-5',
  })).toEqual({
    label: 'Routed: anthropic/claude-sonnet-4-5',
    title: 'Requested model: openrouter/auto • Routed model: anthropic/claude-sonnet-4-5',
    requestedModel: 'openrouter/auto',
    responseModel: 'anthropic/claude-sonnet-4-5',
  });
});

test('resolveComposeRoutedModelStatus hides matching or stale routed model state', () => {
  expect(resolveComposeRoutedModelStatus('openrouter/auto', {
    current: 'openrouter/auto',
    latest_requested_model: 'openrouter/auto',
    latest_response_model: 'openrouter/auto',
  })).toBeNull();

  expect(resolveComposeRoutedModelStatus('anthropic/claude-opus-4-5', {
    current: 'anthropic/claude-opus-4-5',
    latest_requested_model: 'openrouter/auto',
    latest_response_model: 'anthropic/claude-sonnet-4-5',
  })).toBeNull();
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

test('resolveComposeExtensionWorkingDisplay renders default working state with a spinner and preserves custom/hidden indicators', () => {
  const css = readFileSync(join(import.meta.dir, '../../web/static/classic/css/chat.css'), 'utf8');
  expect(css).toContain('.compose-inline-status-spinner');
  expect(css).toContain('animation: spin 1s linear infinite;');

  expect(resolveComposeExtensionWorkingDisplay(null)).toEqual({
    visible: false,
    title: '',
    indicatorText: null,
    animateDot: false,
    animateSpinner: false,
  });

  expect(resolveComposeExtensionWorkingDisplay({
    message: 'Compacting context…',
    indicator: { mode: 'default', frames: [], intervalMs: null },
  })).toEqual({
    visible: true,
    title: 'Compacting context…',
    indicatorText: null,
    animateDot: false,
    animateSpinner: true,
  });

  expect(resolveComposeExtensionWorkingDisplay({
    message: null,
    indicator: { mode: 'custom', frames: ['⠋', '⠙'], intervalMs: 90 },
  }, 1)).toEqual({
    visible: true,
    title: 'Thinking…',
    indicatorText: '⠙',
    animateDot: false,
    animateSpinner: false,
  });

  expect(resolveComposeExtensionWorkingDisplay({
    message: 'Background sync',
    indicator: { mode: 'hidden', frames: [], intervalMs: null },
  })).toEqual({
    visible: true,
    title: 'Background sync',
    indicatorText: null,
    animateDot: false,
    animateSpinner: false,
  });
});

test('compose status notice rows use a spinner for active working state', () => {
  const source = readFileSync(join(import.meta.dir, '../../web/src/components/compose-box.ts'), 'utf8');
  expect(source).toContain('class="compose-inline-status-spinner"');
  expect(source).not.toContain('buildComposeStatusDotClass({ pulsing: false })');
});

test('speech push-to-talk starts only on blank compose with native speech available', () => {
  const baseEvent = { key: ' ', code: 'Space', ctrlKey: false, metaKey: false, altKey: false, repeat: false };
  const baseOptions = { searchMode: false, speechButtonVisible: true, speechButtonActive: false, canStartSpeech: true };

  expect(shouldStartSpeechPushToTalk(baseEvent, '', baseOptions)).toBe(true);
  expect(shouldStartSpeechPushToTalk(baseEvent, '   ', baseOptions)).toBe(true);
  expect(shouldStartSpeechPushToTalk(baseEvent, 'hello', baseOptions)).toBe(false);
  expect(shouldStartSpeechPushToTalk({ ...baseEvent, repeat: true }, '', baseOptions)).toBe(false);
  expect(shouldStartSpeechPushToTalk(baseEvent, '', { ...baseOptions, speechButtonActive: true })).toBe(false);
  expect(shouldStartSpeechPushToTalk(baseEvent, '', { ...baseOptions, canStartSpeech: false })).toBe(false);

  expect(shouldStopSpeechPushToTalk({ key: ' ', code: 'Space' }, true)).toBe(true);
  expect(shouldStopSpeechPushToTalk({ key: 'Enter', code: 'Enter' }, true)).toBe(false);
  expect(shouldStopSpeechPushToTalk({ key: ' ', code: 'Space' }, false)).toBe(false);
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

test('compose exact-operation Abort uses the stable default route without an undefined agent identifier', () => {
  const source = readFileSync(join(import.meta.dir, '../../web/src/components/compose-box.ts'), 'utf8');
  expect(source).toContain('abortAgentOperation(currentChatJid, authority.operationId)');
  expect(source).not.toContain('currentAgentId');
});

test('resolveComposeAbortAuthority never treats a transient missing operation id as legacy ownership', () => {
  expect(resolveComposeAbortAuthority('operation-123', 'durable')).toEqual({
    mode: 'exact',
    operationId: 'operation-123',
  });
  expect(resolveComposeAbortAuthority(null, 'legacy')).toEqual({
    mode: 'legacy',
    operationId: null,
  });
  expect(resolveComposeAbortAuthority(null, 'durable')).toEqual({
    mode: 'unavailable',
    operationId: null,
  });
  expect(resolveComposeAbortAuthority(null, null)).toEqual({
    mode: 'unavailable',
    operationId: null,
  });
});

test('isComposeSubmitAbortMode keeps compacting on the abort path', () => {
  expect(isComposeSubmitAbortMode('abort')).toBe(true);
  expect(isComposeSubmitAbortMode('compacting')).toBe(true);
  expect(isComposeSubmitAbortMode('send')).toBe(false);
  expect(isComposeSubmitAbortMode(null)).toBe(false);
});

test('resolveUiOnlyCommandNotice surfaces only read-only thinking queries and leaves /model output to the timeline', () => {
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
  })).toBeNull();

  expect(resolveUiOnlyCommandNotice('/thinking high', {
    ui_only: true,
    command: { message: 'Thinking level set to high.' },
  })).toBeNull();

  expect(resolveUiOnlyCommandNotice('/cycle-model', {
    ui_only: true,
    command: { message: 'Model set to openai/gpt-5.' },
  })).toBeNull();
});
