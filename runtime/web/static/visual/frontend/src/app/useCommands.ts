import { useEffect } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { commandRegistry } from "../services";
import { safeRemoveItem } from "../utils/storage";
import type { ThemeControl } from "../theme/ThemeProvider";

interface UseCommandsOptions {
  activePanel: Signal<string>;
  previousPanel: Signal<string>;
  sidebarCollapsed: Signal<boolean>;
  terminalVisible: Signal<boolean>;
  terminalMaximized: Signal<boolean>;
  paletteVisible: Signal<boolean>;
  themeControl: ThemeControl;
}

/**
 * Registers all ~18 application commands with the command registry and wires
 * up global keyboard shortcuts. Commands and listeners are removed on unmount.
 */
export function useCommands({
  activePanel,
  sidebarCollapsed,
  terminalVisible,
  terminalMaximized,
  paletteVisible,
  themeControl,
}: UseCommandsOptions): void {
  // Global keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === "Backquote" || e.key === "`" || e.key === "\u00BA" || e.key === "Dead")) {
        e.preventDefault();
        e.stopPropagation();
        terminalVisible.value = !terminalVisible.value;
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        paletteVisible.value = !paletteVisible.value;
        return;
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        sidebarCollapsed.value = !sidebarCollapsed.value;
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        activePanel.value = "explorer";
        sidebarCollapsed.value = false;
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        activePanel.value = "search";
        sidebarCollapsed.value = false;
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        activePanel.value = "extensions";
        sidebarCollapsed.value = false;
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        activePanel.value = "agent";
        sidebarCollapsed.value = false;
        return;
      }
      if (e.ctrlKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        activePanel.value = "settings";
        sidebarCollapsed.value = false;
        return;
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [paletteVisible, terminalVisible, sidebarCollapsed, activePanel]);

  // Command palette registrations
  useEffect(() => {
    const cmds = [
      // Navigation
      { id: "nav.explorer", label: "Show Explorer", category: "navigation" as const, keybinding: "Ctrl+Shift+E", handler: () => { activePanel.value = "explorer"; sidebarCollapsed.value = false; } },
      { id: "nav.search", label: "Show Search", category: "navigation" as const, keybinding: "Ctrl+Shift+F", handler: () => { activePanel.value = "search"; sidebarCollapsed.value = false; } },
      { id: "nav.extensions", label: "Show Addons", category: "navigation" as const, keybinding: "Ctrl+Shift+X", handler: () => { activePanel.value = "extensions"; sidebarCollapsed.value = false; } },
      { id: "nav.agent", label: "Show Dashboard", category: "navigation" as const, keybinding: "Ctrl+Shift+A", handler: () => { activePanel.value = "agent"; sidebarCollapsed.value = false; } },
      { id: "nav.settings", label: "Show Settings", category: "navigation" as const, keybinding: "Ctrl+,", handler: () => { activePanel.value = "settings"; sidebarCollapsed.value = false; } },
      { id: "sidebar.toggle", label: "Toggle Sidebar", category: "navigation" as const, keybinding: "Ctrl+B", handler: () => { sidebarCollapsed.value = !sidebarCollapsed.value; } },
      // Terminal
      { id: "terminal.toggle", label: "Toggle Terminal", category: "terminal" as const, keybinding: "Ctrl+`", handler: () => { terminalVisible.value = !terminalVisible.value; } },
      { id: "terminal.maximize", label: "Maximize Terminal", category: "terminal" as const, handler: () => { terminalVisible.value = true; terminalMaximized.value = true; } },
      { id: "terminal.restore", label: "Restore Terminal", category: "terminal" as const, handler: () => { terminalMaximized.value = false; } },
      { id: "terminal.newTab", label: "Open Terminal in New Tab", category: "terminal" as const, handler: () => { window.open("/static/terminal.html", "_blank"); } },
      { id: "terminal.popOut", label: "Pop Out Terminal", category: "terminal" as const, handler: () => { window.open("/static/terminal.html", "piclaw-terminal", "width=800,height=600,menubar=no,toolbar=no"); } },
      { id: "terminal.close", label: "Close Terminal", category: "terminal" as const, handler: () => { terminalVisible.value = false; terminalMaximized.value = false; } },
      // Theme
      { id: "theme.toggleDarkLight", label: "Toggle Dark/Light Theme", category: "theme" as const, handler: () => { themeControl.toggleMode(); } },
      { id: "theme.dark", label: "Switch to Dark Theme", category: "theme" as const, handler: () => { themeControl.setMode("dark"); } },
      { id: "theme.light", label: "Switch to Light Theme", category: "theme" as const, handler: () => { themeControl.setMode("light"); } },
      // Session
      { id: "session.reconnect", label: "Reconnect", category: "session" as const, handler: () => { window.dispatchEvent(new Event("piclaw:sse-reconnect")); } },
      // General
      { id: "general.commandPalette", label: "Open Command Palette", category: "general" as const, keybinding: "Ctrl+Shift+P", handler: () => { paletteVisible.value = !paletteVisible.value; } },
      { id: "general.clearLocalStorage", label: "Clear Layout State", category: "general" as const, handler: () => { ["piclaw-terminal-visible", "piclaw-terminal-height", "piclaw-sidebar-collapsed", "piclaw-sidebar-width"].forEach((k) => safeRemoveItem(k)); } },
    ];
    cmds.forEach((c) => commandRegistry.register(c));
    return () => cmds.forEach((c) => commandRegistry.unregister(c.id));
  }, [activePanel, terminalVisible, terminalMaximized, sidebarCollapsed, paletteVisible, themeControl]);
}
