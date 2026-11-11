import { expect, test } from 'bun:test';

import {
  getPanePopoutDocumentTitle,
  getPanePopoutTitle,
  hasPanePopoutMenuActions,
  isVncPanePopoutPath,
  resolveActivePaneOverrideId,
  resolveActivePaneTab,
  shouldHidePanePopoutControls,
  shouldShowEditorPaneContainer,
} from '../../web/src/ui/app-pane-state.js';

test('resolveActivePaneTab prefers the active tab and falls back to the first tab', () => {
  const tabs = [
    { id: 'one', label: 'One' },
    { id: 'two', label: 'Two' },
  ];

  expect(resolveActivePaneTab(tabs, 'two')).toEqual({ id: 'two', label: 'Two' });
  expect(resolveActivePaneTab(tabs, 'missing')).toEqual({ id: 'one', label: 'One' });
  expect(resolveActivePaneTab([], 'missing')).toBeNull();
});

test('resolveActivePaneOverrideId returns the active override only when available', () => {
  const overrides = new Map<string, string>([['pane-1', 'preview']]);
  expect(resolveActivePaneOverrideId(overrides, 'pane-1')).toBe('preview');
  expect(resolveActivePaneOverrideId(overrides, 'pane-2')).toBeNull();
  expect(resolveActivePaneOverrideId(null, 'pane-1')).toBeNull();
});

test('pane popout helpers compute title, menu actions, and VNC control visibility', () => {
  const activePaneTab = { id: 'pane-1', label: 'Editor' };
  const previewTabs = new Set(['pane-1']);
  const diffTabs = new Set(['pane-2']);

  expect(getPanePopoutTitle('', activePaneTab, '/tmp/file.md')).toBe('Editor');
  expect(getPanePopoutDocumentTitle('', activePaneTab, '/tmp/file.md')).toBe('Editor · PiClaw');
  expect(hasPanePopoutMenuActions([{ id: 'pane-1' }], previewTabs, diffTabs, 'pane-1')).toBe(true);
  expect(hasPanePopoutMenuActions([{ id: 'pane-2' }], new Set(), diffTabs, 'pane-2')).toBe(true);
  expect(isVncPanePopoutPath('/tabs/vnc/session', '/tabs/vnc')).toBe(true);
  expect(shouldHidePanePopoutControls('/tabs/terminal', '/tabs/terminal', false, false)).toBe(true);
  expect(shouldHidePanePopoutControls('/tabs/preview', '/tabs/terminal', true, true)).toBe(true);
  expect(shouldHidePanePopoutControls('/tabs/preview', '/tabs/terminal', true, false)).toBe(false);
});

test('shouldShowEditorPaneContainer respects pane popout and dock visibility modes', () => {
  expect(shouldShowEditorPaneContainer(true, false, false, false)).toBe(true);
  expect(shouldShowEditorPaneContainer(false, true, false, false)).toBe(true);
  expect(shouldShowEditorPaneContainer(false, false, true, true)).toBe(true);
  expect(shouldShowEditorPaneContainer(false, false, true, false)).toBe(false);
});
