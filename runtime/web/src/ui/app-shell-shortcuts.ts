import { useEffect } from '../vendor/preact-htm.js';
import { watchChatSwitchShortcuts, watchDockToggleShortcut, watchKeyboardHelpShortcut, watchWorkspaceTreeShortcut, watchZenModeShortcuts, watchSettingsShortcut } from './app-browser-events.js';
import { isLikelySafariBrowser } from './app-pane-runtime-orchestration.js';

export function shouldWatchDockShortcut(options: {
  hasDockPanes: boolean;
  chatOnlyMode: boolean;
}): boolean {
  const { hasDockPanes, chatOnlyMode } = options;
  return Boolean(hasDockPanes && !chatOnlyMode);
}

export function shouldWatchZenShortcuts(chatOnlyMode: boolean): boolean {
  return !chatOnlyMode;
}

export function useAppShellShortcuts(options: {
  hasDockPanes: boolean;
  chatOnlyMode: boolean;
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
    chatOnlyMode,
    toggleDock,
    toggleZenMode,
    exitZenMode,
    zenMode,
    previousChat,
    nextChat,
    toggleWorkspace,
  } = options;

  useEffect(() => {
    if (chatOnlyMode || typeof toggleWorkspace !== 'function') return;
    return watchWorkspaceTreeShortcut(toggleWorkspace);
  }, [chatOnlyMode, toggleWorkspace]);

  useEffect(() => {
    if (!shouldWatchDockShortcut({ hasDockPanes, chatOnlyMode })) return;
    return watchDockToggleShortcut(toggleDock);
  }, [chatOnlyMode, hasDockPanes, toggleDock]);

  useEffect(() => {
    if (!shouldWatchZenShortcuts(chatOnlyMode)) return;
    return watchZenModeShortcuts({
      toggleZenMode,
      exitZenMode,
      zenMode,
      isZenModeActive: () => zenMode,
    });
  }, [chatOnlyMode, exitZenMode, toggleZenMode, zenMode]);

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
