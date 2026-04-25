import { expect, test } from 'bun:test';

import {
  clampEditorWidth,
  clampSidebarWidth,
  getMinimumChatPaneWidth,
} from '../../web/src/ui/use-splitters.js';

test('getMinimumChatPaneWidth reserves ten percent of the viewport for chat', () => {
  expect(getMinimumChatPaneWidth(1440)).toBe(144);
  expect(getMinimumChatPaneWidth(1024)).toBe(102);
});

test('clampSidebarWidth leaves room for the editor and ten percent chat pane', () => {
  expect(clampSidebarWidth(2000, 1440, 900)).toBe(388);
  expect(clampSidebarWidth(120, 1440, 0)).toBe(160);
});

test('clampEditorWidth leaves room for the sidebar and ten percent chat pane', () => {
  expect(clampEditorWidth(2000, 1440, 320)).toBe(968);
  expect(clampEditorWidth(120, 1440, 320)).toBe(200);
});
