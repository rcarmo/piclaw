import { expect, test } from 'bun:test';

import {
  watchChatSwitchShortcuts,
  watchDockToggleShortcut,
  watchKeyboardHelpShortcut,
  watchPaneOpenEvents,
  watchSettingsShortcut,
  watchWorkspaceTreeShortcut,
  watchZenModeShortcuts,
} from '../../web/src/ui/app-browser-events.js';
import { WORKSPACE_TREE_TOGGLE_EVENT } from '../../web/src/ui/use-splitters.js';

function createEventTarget() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  return {
    addEventListener(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: any = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ type, preventDefault() { event.prevented = true; }, ...event });
      }
      return event;
    },
    count(type: string) {
      return listeners.get(type)?.size || 0;
    },
  };
}

test('watchPaneOpenEvents routes supported tab, edit-source, and popout custom events and disposes cleanly', () => {
  const doc = createEventTarget();
  const events: string[] = [];

  const dispose = watchPaneOpenEvents({
    openTab: (path: string, label?: string) => events.push(`tab:${path}:${label || ''}`),
    editSource: (path: string, label?: string) => events.push(`edit:${path}:${label || ''}`),
    popOutPane: (path: string, label?: string) => events.push(`pop:${path}:${label || ''}`),
  }, { document: doc as any });

  doc.dispatch('pane:open-tab', { detail: { path: '/widgets/system.widget', label: 'Widget' } });
  doc.dispatch('office-viewer:open-tab', { detail: { path: '/docs/report.docx', label: 'Report' } });
  doc.dispatch('html-viewer:open-tab', { detail: { path: '/site/index.html', label: 'Home' } });
  doc.dispatch('html-viewer:edit-source', { detail: { path: '/site/index.html', label: 'Home' } });
  doc.dispatch('mindmap:open-tab', { detail: { path: '/maps/plan.mindmap.yaml', label: 'Plan' } });
  doc.dispatch('pane:popout', { detail: { path: '/tabs/terminal', label: 'Terminal' } });
  expect(events).toEqual([
    'tab:/widgets/system.widget:Widget',
    'tab:/docs/report.docx:Report',
    'tab:/site/index.html:Home',
    'edit:/site/index.html:Home',
    'tab:/maps/plan.mindmap.yaml:Plan',
    'pop:/tabs/terminal:Terminal',
  ]);

  dispose();
  expect(doc.count('pane:open-tab')).toBe(0);
  expect(doc.count('office-viewer:open-tab')).toBe(0);
  expect(doc.count('html-viewer:open-tab')).toBe(0);
  expect(doc.count('html-viewer:edit-source')).toBe(0);
  expect(doc.count('mindmap:open-tab')).toBe(0);
  expect(doc.count('pane:popout')).toBe(0);
});

test('watchDockToggleShortcut fires on Ctrl+` only', () => {
  const doc = createEventTarget();
  let toggles = 0;
  const dispose = watchDockToggleShortcut(() => {
    toggles += 1;
  }, { document: doc as any });

  const ignored = doc.dispatch('keydown', { ctrlKey: false, key: '`' });
  const accepted = doc.dispatch('keydown', { ctrlKey: true, key: '`' });
  expect(ignored.prevented).toBeUndefined();
  expect(accepted.prevented).toBe(true);
  expect(toggles).toBe(1);

  dispose();
  expect(doc.count('keydown')).toBe(0);
});

test('watchWorkspaceTreeShortcut toggles on Ctrl/Cmd+Shift+E, including in editors, and on divider requests', () => {
  const doc = createEventTarget();
  const win = createEventTarget();
  let toggles = 0;
  const dispose = watchWorkspaceTreeShortcut(() => { toggles += 1; }, { document: doc as any, window: win as any });

  expect(doc.dispatch('keydown', { ctrlKey: true, shiftKey: false, key: 'e' }).prevented).toBeUndefined();
  expect(doc.dispatch('keydown', { ctrlKey: true, shiftKey: true, key: 'E', isComposing: true }).prevented).toBeUndefined();
  expect(doc.dispatch('keydown', { ctrlKey: true, shiftKey: true, key: 'E', target: { tagName: 'TEXTAREA' } }).prevented).toBe(true);
  expect(doc.dispatch('keydown', { metaKey: true, shiftKey: true, key: 'e' }).prevented).toBe(true);
  win.dispatch(WORKSPACE_TREE_TOGGLE_EVENT);
  expect(toggles).toBe(3);

  dispose();
  expect(doc.count('keydown')).toBe(0);
  expect(win.count(WORKSPACE_TREE_TOGGLE_EVENT)).toBe(0);
});

test('watchZenModeShortcuts toggles on Ctrl+Shift+Z and exits on Escape when active', () => {
  const doc = createEventTarget();
  let toggles = 0;
  let exits = 0;
  let zenMode = false;

  const dispose = watchZenModeShortcuts({
    toggleZenMode: () => { toggles += 1; zenMode = !zenMode; },
    exitZenMode: () => { exits += 1; zenMode = false; },
    isZenModeActive: () => zenMode,
  }, { document: doc as any });

  const toggleEvent = doc.dispatch('keydown', { ctrlKey: true, shiftKey: true, key: 'z' });
  expect(toggleEvent.prevented).toBe(true);
  expect(toggles).toBe(1);

  const editableToggleEvent = doc.dispatch('keydown', {
    ctrlKey: true,
    shiftKey: true,
    key: 'z',
    target: { closest: (selector: string) => selector.includes('textarea') ? ({} as Element) : null },
  });
  expect(editableToggleEvent.prevented).toBe(true);
  expect(toggles).toBe(2);

  doc.dispatch('keydown', { ctrlKey: true, shiftKey: true, key: 'z' });
  expect(toggles).toBe(3);

  const escapeEvent = doc.dispatch('keydown', { key: 'Escape' });
  expect(escapeEvent.prevented).toBe(true);
  expect(exits).toBe(1);

  const editableEscapeEvent = doc.dispatch('keydown', {
    key: 'Escape',
    target: { closest: (selector: string) => selector.includes('textarea') ? ({} as Element) : null },
  });
  expect(editableEscapeEvent.prevented).toBeUndefined();
  expect(exits).toBe(1);

  dispose();
  expect(doc.count('keydown')).toBe(0);
});

test('watchChatSwitchShortcuts uses bare [ and ] outside editable targets', () => {
  const doc = createEventTarget();
  const events: string[] = [];
  const dispose = watchChatSwitchShortcuts({
    previousChat: () => events.push('prev'),
    nextChat: () => events.push('next'),
  }, { document: doc as any });

  const prevEvent = doc.dispatch('keydown', { key: '[' });
  const nextEvent = doc.dispatch('keydown', { key: ']' });
  const editableEvent = doc.dispatch('keydown', {
    key: '[',
    target: { closest: (selector: string) => selector.includes('textarea') ? ({} as Element) : null },
  });

  expect(prevEvent.prevented).toBe(true);
  expect(nextEvent.prevented).toBe(true);
  expect(editableEvent.prevented).toBeUndefined();
  expect(events).toEqual(['prev', 'next']);

  dispose();
  expect(doc.count('keydown')).toBe(0);
});

test('watchSettingsShortcut accepts default bindings and ignores editable targets', () => {
  const doc = createEventTarget();
  const events: Array<{ type: string; detail?: any }> = [];
  const originalWindow = (globalThis as any).window;
  const customWindow = {
    dispatchEvent(event: { type?: string; detail?: any }) {
      events.push({ type: String(event?.type || ''), detail: event?.detail });
      return true;
    },
  } as any;
  (globalThis as any).window = customWindow;

  const dispose = watchSettingsShortcut({ document: doc as any });

  const primaryEvent = doc.dispatch('keydown', { ctrlKey: true, key: ',' });
  const altEvent = doc.dispatch('keydown', { altKey: true, key: ',' });
  const editableEvent = doc.dispatch('keydown', {
    altKey: true,
    key: ',',
    target: { closest: (selector: string) => selector.includes('input') ? ({} as Element) : null },
  });

  expect(primaryEvent.prevented).toBe(true);
  expect(altEvent.prevented).toBe(true);
  expect(editableEvent.prevented).toBeUndefined();
  expect(events.map((entry) => entry.type)).toEqual(['piclaw:open-settings', 'piclaw:open-settings']);

  dispose();
  expect(doc.count('keydown')).toBe(0);
  (globalThis as any).window = originalWindow;
});

test('watchKeyboardHelpShortcut opens the keyboard section on quote and question mark outside editable targets', () => {
  const doc = createEventTarget();
  const events: Array<{ type: string; detail?: any }> = [];
  const originalWindow = (globalThis as any).window;
  const customWindow = {
    dispatchEvent(event: { type?: string; detail?: any }) {
      events.push({ type: String(event?.type || ''), detail: event?.detail });
      return true;
    },
  } as any;
  (globalThis as any).window = customWindow;

  const dispose = watchKeyboardHelpShortcut({ document: doc as any });

  const acceptedQuote = doc.dispatch('keydown', { shiftKey: true, key: '"' });
  const acceptedQuestion = doc.dispatch('keydown', { shiftKey: true, key: '?' });
  const editable = doc.dispatch('keydown', {
    shiftKey: true,
    key: '?',
    target: { closest: (selector: string) => selector.includes('textarea') ? ({} as Element) : null },
  });

  expect(acceptedQuote.prevented).toBe(true);
  expect(acceptedQuestion.prevented).toBe(true);
  expect(editable.prevented).toBeUndefined();
  expect(events).toEqual([
    { type: 'piclaw:open-settings', detail: { section: 'keyboard' } },
    { type: 'piclaw:open-settings', detail: { section: 'keyboard' } },
  ]);

  dispose();
  expect(doc.count('keydown')).toBe(0);
  (globalThis as any).window = originalWindow;
});
