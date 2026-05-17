import { useCallback, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { getMessageUrl } from "../../api/chat-jid";

export interface UseCompactionResult {
  isCompacting: ReturnType<typeof useSignal<boolean>>;
  compactStartTime: ReturnType<typeof useSignal<number>>;
  compactElapsed: ReturnType<typeof useSignal<number>>;
  handleCompact: (e: Event, fetchContext: () => Promise<void>) => Promise<void>;
}

export function useCompaction(fetchContext: () => Promise<void>): UseCompactionResult {
  const isCompacting = useSignal(false);
  const compactStartTime = useSignal<number>(0);
  const compactElapsed = useSignal<number>(0);

  // #68: elapsed timer during compaction
  useEffect(() => {
    if (!isCompacting.value) return;
    const interval = setInterval(() => {
      compactElapsed.value = Math.round((Date.now() - compactStartTime.value) / 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [isCompacting.value]);

  // #68: listen for agent completion to clear compaction state
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Detect compaction started (from /compact command or auto-compaction)
      if (detail?.intent_key === "compaction" && !isCompacting.value) {
        isCompacting.value = true;
        compactStartTime.value = Date.now();
        compactElapsed.value = 0;
      }
      // Detect compaction/turn done
      if (detail?.type === "done" || detail?.type === "error" || detail?.status === "idle") {
        if (isCompacting.value) {
          isCompacting.value = false;
        }
      }
    };
    window.addEventListener("piclaw:agent-status", onStatus);
    return () => window.removeEventListener("piclaw:agent-status", onStatus);
  }, []);

  // #68: handleCompact with progress tracking
  const handleCompact = useCallback(async (e: Event, onFetchContext: () => Promise<void>) => {
    e.stopPropagation();
    isCompacting.value = true;
    compactStartTime.value = Date.now();
    compactElapsed.value = 0;
    try {
      const res = await fetch(getMessageUrl(), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "/compact" }),
      });
      const data = await res.json().catch(() => null);
      // Command responded immediately ("Already compacted" or similar) — no agent turn
      if (data?.command) {
        isCompacting.value = false;
        setTimeout(() => {
          void onFetchContext();
        }, 1000);
      }
    } catch {
      isCompacting.value = false;
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Compaction failed", type: "error" } }));
    }
  }, []);

  return { isCompacting, compactStartTime, compactElapsed, handleCompact };
}
