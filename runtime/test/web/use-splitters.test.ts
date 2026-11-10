import { expect, test } from 'bun:test';

import {
  EDITOR_PANE_COLLAPSED_ATTRIBUTE,
  clampEditorWidth,
  clampSidebarWidth,
  getMinimumChatPaneWidth,
  isEditorPaneCollapsed,
  resizeRightPaneWidth,
  resolveRightPaneKeyboardWidth,
  setEditorPaneCollapsed,
} from '../../web/src/ui/use-splitters.js';

test('getMinimumChatPaneWidth reserves a usable conversation column, not ten percent alone', () => {
  expect(getMinimumChatPaneWidth(1440)).toBe(320);
  expect(getMinimumChatPaneWidth(1024)).toBe(320);
  expect(getMinimumChatPaneWidth(3840)).toBe(384);
  expect(getMinimumChatPaneWidth(280)).toBe(280);
});

test('clampSidebarWidth leaves room for the editor and usable chat pane', () => {
  expect(clampSidebarWidth(2000, 1440, 900)).toBe(212);
  expect(clampSidebarWidth(120, 1440, 0)).toBe(160);
});

test('clampEditorWidth leaves room for the sidebar and usable chat pane', () => {
  expect(clampEditorWidth(2000, 1440, 320)).toBe(792);
  expect(clampEditorWidth(120, 1440, 320)).toBe(200);
});

test('a hidden workspace does not prevent a two-thirds laptop terminal', () => {
  for (const viewport of [1024, 1280, 1366, 1440]) {
    expect(clampEditorWidth(viewport * 2 / 3, viewport, 0)).toBe(viewport * 2 / 3);
    expect(viewport - clampEditorWidth(Infinity, viewport, 0) - 4).toBeGreaterThanOrEqual(320);
  }
});

test('the sessions pane width is reserved when clamping the right-hand panes', () => {
  expect(clampEditorWidth(2000, 1440, 280, 0)).toBe(clampEditorWidth(2000, 1440, 280));
  expect(clampEditorWidth(2000, 1440, 280, 264)).toBe(clampEditorWidth(2000, 1440, 280) - 264);
  expect(clampSidebarWidth(2000, 1440, 500, 264)).toBe(clampSidebarWidth(2000, 1440, 500) - 264);
  expect(clampEditorWidth(2000, 1024, 280, 264)).toBe(200);
});

test('editor and tree dividers sit on the left of their panes: dragging or ArrowLeft widens them', () => {
  expect(resizeRightPaneWidth(400, -60)).toBe(460);
  expect(resizeRightPaneWidth(400, 60)).toBe(340);
  expect(resolveRightPaneKeyboardWidth('ArrowLeft', 300)).toBe(316);
  expect(resolveRightPaneKeyboardWidth('ArrowRight', 300, { shiftKey: true })).toBe(236);
  expect(resolveRightPaneKeyboardWidth('Home', 300, { min: 160, max: 900 })).toBe(160);
  expect(resolveRightPaneKeyboardWidth('End', 300, { min: 160, max: 900 })).toBe(900);
  expect(resolveRightPaneKeyboardWidth('Tab', 300)).toBeNull();
});

test('collapsing the editor pane is an attribute, so Preact class renders do not undo it', () => {
  const attributes = new Map<string, string>();
  const shell = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  };
  const events: string[] = [];
  const previous = (globalThis as any).window;
  (globalThis as any).window = { dispatchEvent: (event: any) => { events.push(event.type); return true; } };
  try {
    setEditorPaneCollapsed(shell, true);
    expect(attributes.get(EDITOR_PANE_COLLAPSED_ATTRIBUTE)).toBe('true');
    expect(isEditorPaneCollapsed(shell)).toBe(true);
    setEditorPaneCollapsed(shell, false);
    expect(isEditorPaneCollapsed(shell)).toBe(false);
    expect(events).toEqual(['piclaw:editor-pane-collapse', 'piclaw:editor-pane-collapse', 'dock-resize']);
  } finally {
    (globalThis as any).window = previous;
  }
});
