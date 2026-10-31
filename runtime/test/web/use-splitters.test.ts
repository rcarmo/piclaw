import { expect, test } from 'bun:test';

import {
  clampEditorWidth,
  clampSidebarWidth,
  getMinimumChatPaneWidth,
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
