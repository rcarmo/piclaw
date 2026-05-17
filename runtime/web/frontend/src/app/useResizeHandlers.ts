import { useCallback, useEffect, useRef } from "preact/hooks";
import type { Signal } from "@preact/signals";

interface UseResizeHandlersOptions {
  sidebarWidth: Signal<number>;
  sidebarCollapsed: Signal<boolean>;
  terminalHeight: Signal<number>;
  terminalMaximized: Signal<boolean>;
  isSettingsActive: boolean;
  sidebarWrapperRef: { current: HTMLDivElement | null };
  terminalRef: { current: HTMLDivElement | null };
}

export interface ResizeHandlers {
  onTermDragStart: (e: MouseEvent) => void;
  onSidebarMouseDown: (e: MouseEvent) => void;
  onSidebarKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Provides drag-resize handlers for the sidebar and terminal panel,
 * and keyboard resize for the sidebar (arrow keys).
 * Also syncs DOM element dimensions imperatively based on signal values.
 */
export function useResizeHandlers({
  sidebarWidth,
  sidebarCollapsed,
  terminalHeight,
  terminalMaximized,
  isSettingsActive,
  sidebarWrapperRef,
  terminalRef,
}: UseResizeHandlersOptions): ResizeHandlers {
  const termDragRef = useRef<{ startY: number; startH: number } | null>(null);

  // Sync sidebar DOM dimensions
  useEffect(() => {
    const el = sidebarWrapperRef.current;
    if (!el) return;
    const isClosed = sidebarCollapsed.value || isSettingsActive;
    const isMobile = window.innerWidth < 640;
    el.style.width = isClosed ? "0px" : (isMobile ? "100vw" : `${sidebarWidth.value}px`);
    el.style.minWidth = isClosed ? "0px" : (isMobile ? "0px" : "150px");
    el.style.maxWidth = isClosed ? "0px" : (isMobile ? "100vw" : "50vw");
  }, [sidebarCollapsed.value, isSettingsActive, sidebarWidth.value]);

  // Sync terminal DOM dimensions
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    el.style.height = terminalMaximized.value ? "calc(100vh - 60px)" : `${terminalHeight.value}px`;
  }, [terminalMaximized.value, terminalHeight.value]);

  const resizeSidebarBy = (delta: number) => {
    const min = 150;
    const max = Math.round(window.innerWidth * 0.5);
    sidebarWidth.value = Math.max(min, Math.min(max, sidebarWidth.value + delta));
  };

  const onTermDragStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    termDragRef.current = { startY: e.clientY, startH: terminalMaximized.value ? window.innerHeight * 0.7 : terminalHeight.value };
    terminalMaximized.value = false;
    const onMove = (ev: MouseEvent) => {
      if (!termDragRef.current) return;
      terminalHeight.value = Math.max(100, Math.min(window.innerHeight * 0.8, termDragRef.current.startH + (termDragRef.current.startY - ev.clientY)));
    };
    const onUp = () => {
      termDragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [terminalHeight, terminalMaximized]);

  const onSidebarMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth.value;
    const onMove = (ev: MouseEvent) => {
      sidebarWidth.value = Math.max(150, Math.min(Math.round(window.innerWidth * 0.5), startW + (ev.clientX - startX)));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const onSidebarKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      resizeSidebarBy(-20);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      resizeSidebarBy(20);
    }
  }, [sidebarWidth]);

  return { onTermDragStart, onSidebarMouseDown, onSidebarKeyDown };
}
