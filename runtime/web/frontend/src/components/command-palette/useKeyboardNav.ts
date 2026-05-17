import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";

interface UseKeyboardNavOptions {
  resultsLength: number;
  onExecute: () => void;
  onClose: () => void;
  onBack: () => void;
  query: string;
  step: "command" | "parameter";
  listRef: { current: HTMLUListElement | null };
}

/**
 * Manages keyboard navigation state (selected index) and keyboard event
 * handling for the command palette. Returns the selected index and a
 * keydown event handler.
 */
export function useKeyboardNav({
  resultsLength,
  onExecute,
  onClose,
  onBack,
  query,
  step,
  listRef,
}: UseKeyboardNavOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Clamp selected index when results shrink
  useEffect(() => {
    setSelectedIndex((current) => {
      if (resultsLength === 0) return 0;
      return Math.min(current, resultsLength - 1);
    });
  }, [resultsLength]);

  const scrollActiveIntoView = (index: number) => {
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const active = list.children[index] as HTMLElement | undefined;
      active?.scrollIntoView({ block: "nearest" });
    });
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "Backspace" && query === "") {
      event.preventDefault();
      if (step === "parameter") {
        onBack();
      } else {
        onClose();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => {
        if (resultsLength === 0) return 0;
        const next = (current + 1) % resultsLength;
        scrollActiveIntoView(next);
        return next;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => {
        if (resultsLength === 0) return 0;
        const prev = (current - 1 + resultsLength) % resultsLength;
        scrollActiveIntoView(prev);
        return prev;
      });
      return;
    }

    if (event.key === "PageDown") {
      event.preventDefault();
      setSelectedIndex((current) => {
        if (resultsLength === 0) return 0;
        const next = Math.min(current + 10, resultsLength - 1);
        scrollActiveIntoView(next);
        return next;
      });
      return;
    }

    if (event.key === "PageUp") {
      event.preventDefault();
      setSelectedIndex((current) => {
        if (resultsLength === 0) return 0;
        const prev = Math.max(current - 10, 0);
        scrollActiveIntoView(prev);
        return prev;
      });
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setSelectedIndex(0);
      scrollActiveIntoView(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const last = Math.max(resultsLength - 1, 0);
      setSelectedIndex(last);
      scrollActiveIntoView(last);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onExecute();
    }
  };

  return { selectedIndex, setSelectedIndex, handleKeyDown };
}
