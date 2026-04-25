import { expect, test } from 'bun:test';

import {
  watchDockToggleShortcut,
  watchPaneOpenEvents,
  watchZenModeShortcuts,
} from '../../web/src/ui/app-browser-events.js';

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
  doc.dispatch('kanban:open-tab', { detail: { path: '/boards/work.kanban.md', label: 'Board' } });
  doc.dispatch('pane:popout', { detail: { path: '/tabs/terminal', label: 'Terminal' } });
  expect(events).toEqual([
    'tab:/widgets/system.widget:Widget',
    'tab:/docs/report.docx:Report',
    'tab:/site/index.html:Home',
    'edit:/site/index.html:Home',
    'tab:/maps/plan.mindmap.yaml:Plan',
    'tab:/boards/work.kanban.md:Board',
    'pop:/tabs/terminal:Terminal',
  ]);

  dispose();
  expect(doc.count('pane:open-tab')).toBe(0);
  expect(doc.count('office-viewer:open-tab')).toBe(0);
  expect(doc.count('html-viewer:open-tab')).toBe(0);
  expect(doc.count('html-viewer:edit-source')).toBe(0);
  expect(doc.count('mindmap:open-tab')).toBe(0);
  expect(doc.count('kanban:open-tab')).toBe(0);
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

  const escapeEvent = doc.dispatch('keydown', { key: 'Escape' });
  expect(escapeEvent.prevented).toBe(true);
  expect(exits).toBe(1);

  dispose();
  expect(doc.count('keydown')).toBe(0);
});
