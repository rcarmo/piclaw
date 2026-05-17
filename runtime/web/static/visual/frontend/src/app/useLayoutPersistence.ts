import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import { safeGetItem, safeSetItem } from "../utils/storage";

export interface LayoutState {
  activePanel: Signal<string>;
  previousPanel: Signal<string>;
  sidebarCollapsed: Signal<boolean>;
  sidebarWidth: Signal<number>;
  terminalVisible: Signal<boolean>;
  terminalHeight: Signal<number>;
  terminalMaximized: Signal<boolean>;
}

/**
 * Initialises layout state signals from localStorage and keeps them
 * synchronised with localStorage on every change.
 */
export function useLayoutPersistence(): LayoutState {
  const activePanel = useSignal(safeGetItem("piclaw-active-panel") || "explorer");
  const previousPanel = useSignal(safeGetItem("piclaw-previous-panel") || "explorer");
  const sidebarCollapsed = useSignal(safeGetItem("piclaw-sidebar-collapsed") === "true");
  const sidebarWidth = useSignal(Number(safeGetItem("piclaw-sidebar-width")) || 250);
  const terminalVisible = useSignal(safeGetItem("piclaw-terminal-visible") === "true");
  const terminalHeight = useSignal(Number(safeGetItem("piclaw-terminal-height")) || 200);
  const terminalMaximized = useSignal(false);

  useEffect(() => {
    safeSetItem("piclaw-sidebar-width", String(sidebarWidth.value));
  }, [sidebarWidth.value]);

  useEffect(() => {
    safeSetItem("piclaw-active-panel", activePanel.value);
  }, [activePanel.value]);

  useEffect(() => {
    safeSetItem("piclaw-previous-panel", previousPanel.value);
  }, [previousPanel.value]);

  useEffect(() => {
    safeSetItem("piclaw-sidebar-collapsed", String(sidebarCollapsed.value));
  }, [sidebarCollapsed.value]);

  useEffect(() => {
    safeSetItem("piclaw-terminal-visible", String(terminalVisible.value));
  }, [terminalVisible.value]);

  useEffect(() => {
    safeSetItem("piclaw-terminal-height", String(terminalHeight.value));
  }, [terminalHeight.value]);

  return {
    activePanel,
    previousPanel,
    sidebarCollapsed,
    sidebarWidth,
    terminalVisible,
    terminalHeight,
    terminalMaximized,
  };
}
