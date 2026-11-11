import { expect, test } from 'bun:test';

import { shouldWatchDockShortcut } from '../../web/src/ui/app-shell-shortcuts.js';

test('shouldWatchDockShortcut enables the dock shortcut only when dock panes exist', () => {
  expect(shouldWatchDockShortcut({ hasDockPanes: true })).toBe(true);
  expect(shouldWatchDockShortcut({ hasDockPanes: false })).toBe(false);
});
