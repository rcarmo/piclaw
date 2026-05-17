import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

interface UseDismissableLayerOptions {
  ref: RefObject<HTMLElement>;
  open: boolean;
  onDismiss: () => void;
  outsideEvent?: "pointerdown" | "mousedown" | "click";
  escape?: boolean;
}

export function useDismissableLayer({
  ref,
  open,
  onDismiss,
  outsideEvent = "pointerdown",
  escape = true,
}: UseDismissableLayerOptions) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismissRef.current();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismissRef.current();
    };
    document.addEventListener(outsideEvent, handleOutside);
    if (escape) document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener(outsideEvent, handleOutside);
      if (escape) document.removeEventListener("keydown", handleKey);
    };
  }, [open, ref, outsideEvent, escape]);
}
