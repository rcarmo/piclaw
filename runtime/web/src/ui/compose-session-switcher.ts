export interface ComposeSessionSwitcherKeyEventLike {
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  key?: string;
}

export type SessionPickerSectionKey = "current" | "pinned" | "active" | "tree" | "other" | "archived";

export interface SessionPickerSection<T = any> {
  key: SessionPickerSectionKey;
  label: string;
  items: T[];
}

const SECTION_LABELS: Record<SessionPickerSectionKey, string> = {
  current: "Current",
  pinned: "Pinned",
  active: "Active",
  tree: "This session tree",
  other: "Other sessions",
  archived: "Archived",
};

function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

export function buildSessionPickerSearchDocument(chat: any): string {
  const archived = Boolean(chat?.archived_at);
  const active = Boolean(chat?.is_active) && !archived;
  return [
    clean(chat?.agent_name) ? `@${clean(chat.agent_name)}` : "",
    clean(chat?.agent_name), clean(chat?.chat_jid), clean(chat?.root_chat_jid),
    clean(chat?.model), clean(chat?.model_label), clean(chat?.provider),
    archived ? "archived" : active ? "active" : "idle",
    clean(chat?.parent_branch_id), clean(chat?.branch_id),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

export function matchesSessionPickerSearch(chat: any, query: string): boolean {
  const terms = clean(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const document = buildSessionPickerSearchDocument(chat);
  return terms.every(term => document.includes(term));
}

export function resolveSessionPickerSearchInitialIndex(chats: Array<Record<string, any>>, query: string): number {
  const index = chats.findIndex(chat => matchesSessionPickerSearch(chat, query));
  return index >= 0 ? index : 0;
}

export function filterSessionPickerChats<T extends Record<string, any>>(chats: T[], query: string): T[] {
  const normalized = clean(query).toLocaleLowerCase();
  if (!normalized) return chats;
  const matches = new Set(chats.filter(chat => matchesSessionPickerSearch(chat, normalized)).map(chat => clean(chat.chat_jid)));
  const byBranchId = new Map(chats.map(chat => [clean(chat.branch_id), chat]).filter(([id]) => Boolean(id)) as Array<[string, T]>);
  for (const chat of chats) {
    if (!matches.has(clean(chat.chat_jid))) continue;
    let parentId = clean(chat.parent_branch_id);
    while (parentId) {
      const parent = byBranchId.get(parentId);
      if (!parent) break;
      matches.add(clean(parent.chat_jid));
      parentId = clean(parent.parent_branch_id);
    }
  }
  return chats.filter(chat => matches.has(clean(chat.chat_jid)));
}

export function groupSessionPickerChats<T extends Record<string, any>>(
  chats: T[],
  currentChatJid: string,
  pinnedChatJids: Iterable<string> = [],
): SessionPickerSection<T>[] {
  const current = clean(currentChatJid);
  const currentChat = chats.find(chat => clean(chat.chat_jid) === current);
  const currentRoot = clean(currentChat?.root_chat_jid) || current;
  const pinned = new Set(Array.from(pinnedChatJids, clean).filter(Boolean));
  const buckets = new Map<SessionPickerSectionKey, T[]>([
    ["current", []], ["pinned", []], ["active", []], ["tree", []], ["other", []], ["archived", []],
  ]);
  for (const chat of chats) {
    const jid = clean(chat.chat_jid);
    const archived = Boolean(chat.archived_at);
    const section: SessionPickerSectionKey = archived ? "archived"
      : jid === current ? "current"
        : pinned.has(jid) ? "pinned"
          : Boolean(chat.is_active) ? "active"
            : (clean(chat.root_chat_jid) || jid) === currentRoot ? "tree"
              : "other";
    buckets.get(section)!.push(chat);
  }
  return (["current", "pinned", "active", "tree", "other", "archived"] as SessionPickerSectionKey[])
    .map(key => ({ key, label: SECTION_LABELS[key], items: buckets.get(key)! }))
    .filter(section => section.items.length > 0);
}

export function moveSessionPickerIndex(current: number, length: number, key: string, pageSize = 8): number {
  if (length <= 0) return 0;
  const index = Math.max(0, Math.min(current, length - 1));
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return (index + 1) % length;
  if (key === "ArrowUp") return (index - 1 + length) % length;
  if (key === "PageDown") return Math.min(length - 1, index + pageSize);
  if (key === "PageUp") return Math.max(0, index - pageSize);
  return index;
}

export interface ComposeSessionSwitcherOptions {
  searchMode?: boolean;
  showSessionSwitcherButton?: boolean;
}

export function canUseComposeSessionSwitcher(
  options: ComposeSessionSwitcherOptions = {},
): boolean {
  if (options.searchMode) return false;
  return Boolean(options.showSessionSwitcherButton);
}

export function shouldOpenSessionSwitcherFromBlankCompose(
  event: ComposeSessionSwitcherKeyEventLike | null | undefined,
  value: string | null | undefined,
  options: ComposeSessionSwitcherOptions = {},
): boolean {
  if (!event || event.isComposing) return false;
  if (!canUseComposeSessionSwitcher(options)) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== '@') return false;
  return String(value || '') === '';
}

export function shouldRouteComposeValueToSessionSwitcher(
  value: string | null | undefined,
  options: ComposeSessionSwitcherOptions = {},
): boolean {
  if (!canUseComposeSessionSwitcher(options)) return false;
  return String(value || '') === '@';
}
