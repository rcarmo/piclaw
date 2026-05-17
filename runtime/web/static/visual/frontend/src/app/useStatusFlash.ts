import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";

export interface StatusFlash {
  message: string;
  type: "error" | "warning" | "success" | "info";
}

/**
 * Listens for `piclaw:status-flash` custom events and manages a timed flash
 * state that auto-clears after 1400 ms.
 */
export function useStatusFlash(): Signal<StatusFlash | null> {
  const statusFlash = useSignal<StatusFlash | null>(null);
  const statusFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onStatusFlash = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string; type?: "error" | "warning" | "success" | "info" }>).detail;
      if (!detail?.message) return;
      statusFlash.value = { message: detail.message, type: detail.type ?? "info" };
      if (statusFlashTimer.current) clearTimeout(statusFlashTimer.current);
      statusFlashTimer.current = setTimeout(() => {
        statusFlash.value = null;
        statusFlashTimer.current = null;
      }, 1400);
    };
    window.addEventListener("piclaw:status-flash", onStatusFlash);
    return () => {
      window.removeEventListener("piclaw:status-flash", onStatusFlash);
      if (statusFlashTimer.current) clearTimeout(statusFlashTimer.current);
    };
  }, []);

  return statusFlash;
}
