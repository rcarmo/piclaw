import { useSignal } from "@preact/signals";
import { useEffect, useCallback } from "preact/hooks";
import type { Signal } from "@preact/signals";
import type { Tab } from "./tabTypes";
import { getChatJid } from "../api/chat-jid";
import { buildWidgetTabFromOpenDetail, type WidgetOpenDetail } from "./widgetOpen";

const CHAT_TAB: Tab = { id: "chat", label: "Chat", icon: "💬", closable: false, type: "chat" };

/**
 * Manages the central pane tab state.
 * - Chat tab is always present and not closable.
 * - Terminal tab is created/removed in sync with terminalVisible signal (MOBILE ONLY).
 * - On desktop, terminal stays docked — not managed as a tab.
 * - Widget tabs are created when piclaw:widget-open fires.
 */
export function useTabs(terminalVisible: Signal<boolean>, terminalMaximized?: Signal<boolean>) {
  const tabs = useSignal<Tab[]>([CHAT_TAB]);
  const activeTabId = useSignal<string>("chat");
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  const ensureTab = useCallback(
    (tab: Tab) => {
      if (!tabs.value.find((t) => t.id === tab.id)) {
        tabs.value = [...tabs.value, tab];
      }
      activeTabId.value = tab.id;
    },
    [tabs, activeTabId],
  );

  const closeTab = useCallback(
    (id: string) => {
      if (id === "chat") return;
      tabs.value = tabs.value.filter((t) => t.id !== id);
      if (activeTabId.value === id) activeTabId.value = "chat";
      if (id === "terminal") {
        if (isMobile) {
          terminalVisible.value = false;
        } else if (terminalMaximized) {
          // Desktop: closing terminal tab = close terminal
          terminalMaximized.value = false;
          terminalVisible.value = false;
        }
      } else if (id.startsWith("widget-")) {
        window.dispatchEvent(new CustomEvent("piclaw:widget-close", { detail: { fromTab: true } }));
      }
    },
    [tabs, activeTabId, terminalVisible, terminalMaximized, isMobile],
  );

  // Sync terminal visibility signal → terminal tab (MOBILE ONLY)
  // On desktop, terminal stays docked at the bottom
  useEffect(() => {
    if (!isMobile) return;
    return terminalVisible.subscribe((visible) => {
      if (visible) {
        ensureTab({ id: "terminal", label: "Terminal", icon: "⬛", closable: true, type: "terminal" });
      } else {
        tabs.value = tabs.value.filter((t) => t.id !== "terminal");
        if (activeTabId.value === "terminal") activeTabId.value = "chat";
      }
    });
  }, [terminalVisible, ensureTab, tabs, activeTabId, isMobile]);

  // Desktop: maximized terminal → terminal tab, restore → remove tab
  useEffect(() => {
    if (isMobile || !terminalMaximized) return;
    return terminalMaximized.subscribe((maximized) => {
      if (maximized && terminalVisible.value) {
        ensureTab({ id: "terminal", label: "Terminal", icon: "⬛", closable: true, type: "terminal" });
      } else {
        tabs.value = tabs.value.filter((t) => t.id !== "terminal");
        if (activeTabId.value === "terminal") activeTabId.value = "chat";
      }
    });
  }, [terminalMaximized, terminalVisible, ensureTab, tabs, activeTabId, isMobile]);

  // Widget events → widget tabs
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent<WidgetOpenDetail>).detail;
      if (!detail || typeof detail !== "object" || detail._redispatch) return;
      const tab = buildWidgetTabFromOpenDetail(detail, getChatJid());
      if (!tab) return;
      ensureTab(tab);
    };

    const handleClose = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.fromTab) return; // Avoid loop when tab close triggers this
      const widgetTab = tabs.value.find((t) => t.type === "widget");
      if (widgetTab) {
        tabs.value = tabs.value.filter((t) => t.id !== widgetTab.id);
        if (activeTabId.value === widgetTab.id) activeTabId.value = "chat";
      }
    };

    window.addEventListener("piclaw:widget-open", handleOpen);
    window.addEventListener("piclaw:widget-close", handleClose);
    return () => {
      window.removeEventListener("piclaw:widget-open", handleOpen);
      window.removeEventListener("piclaw:widget-close", handleClose);
    };
  }, [ensureTab, tabs, activeTabId]);

  return { tabs, activeTabId, closeTab };
}
