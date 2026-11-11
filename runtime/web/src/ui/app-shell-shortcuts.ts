import { useEffect } from '../vendor/preact-htm.js';
import { watchChatSwitchShortcuts, watchDockToggleShortcut, watchKeyboardHelpShortcut, watchWorkspaceTreeShortcut, watchZenModeShortcuts, watchSettingsShortcut } from './app-browser-events.js';
import { isLikelySafariBrowser } from './app-pane-runtime-orchestration.js';

export function shouldWatchDockShortcut(options: {
  hasDockPanes: boolean;
}): boolean {
  return Boolean(options.hasDockPanes);
}

export function useAppShellShortcuts(options: {
  hasDockPanes: boolean;
  toggleDock: () => void;
  toggleZenMode: () => void;
  exitZenMode: () => void;
  zenMode: boolean;
  previousChat?: () => void;
  nextChat?: () => void;
  toggleWorkspace?: () => void;
}): void {
  const {
    hasDockPanes,
    toggleDock,
    toggleZenMode,
    exitZenMode,
    zenMode,
    previousChat,
    nextChat,
    toggleWorkspace,
  } = options;

  useEffect(() => {
    if (typeof toggleWorkspace !== 'function') return;
    return watchWorkspaceTreeShortcut(toggleWorkspace);
  }, [toggleWorkspace]);

  useEffect(() => {
    if (!shouldWatchDockShortcut({ hasDockPanes })) return;
    return watchDockToggleShortcut(toggleDock);
  }, [hasDockPanes, toggleDock]);

  useEffect(() => {
    return watchZenModeShortcuts({
      toggleZenMode,
      exitZenMode,
      zenMode,
      isZenModeActive: () => zenMode,
    });
  }, [exitZenMode, toggleZenMode, zenMode]);

  useEffect(() => {
    if (typeof previousChat !== 'function' && typeof nextChat !== 'function') return;
    return watchChatSwitchShortcuts({
      previousChat,
      nextChat,
    });
  }, [nextChat, previousChat]);

  useEffect(() => watchKeyboardHelpShortcut(), []);
  useEffect(() => watchSettingsShortcut(), []);
}
