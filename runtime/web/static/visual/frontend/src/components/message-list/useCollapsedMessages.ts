import { useSignal } from "@preact/signals";
import { getChatJid } from "../../api/chat-jid";
import { safeParseJSON, safeSetItem } from "../../utils/storage";

const STORAGE_KEY = () => `piclaw:collapsed-messages:${getChatJid()}`;

function loadCollapsed(): Set<number> {
  const arr = safeParseJSON<number[]>(STORAGE_KEY(), []);
  return new Set(arr);
}

function saveCollapsed(ids: Set<number>): void {
  // Keep max 500 entries to avoid quota issues
  const arr = [...ids].slice(-500);
  safeSetItem(STORAGE_KEY(), JSON.stringify(arr));
}

export function useCollapsedMessages() {
  const collapsed = useSignal<Set<number>>(loadCollapsed());

  const toggle = (id: number) => {
    const next = new Set(collapsed.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed.value = next;
    saveCollapsed(next);
  };

  const isCollapsed = (id: number) => collapsed.value.has(id);

  return { isCollapsed, toggle };
}
