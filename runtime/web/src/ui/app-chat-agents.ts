export interface ChatAgentRowLike {
  chat_jid?: unknown;
  agent_name?: unknown;
  is_active?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  archived_at?: unknown;
  [key: string]: unknown;
}

function hasString(value: unknown): value is string {
  return typeof value === 'string';
}

function hasTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTimestampMs(value: unknown): number {
  if (!hasTrimmedString(value)) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeActiveChatRows<T extends ChatAgentRowLike>(rows: unknown): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (chat): chat is T => hasTrimmedString(chat?.chat_jid) && hasTrimmedString(chat?.agent_name),
  );
}

export function normalizeCurrentRootBranchRows<T extends ChatAgentRowLike>(rows: unknown): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (chat): chat is T => hasString(chat?.chat_jid) && hasString(chat?.agent_name),
  );
}

export function mergeActiveAndBranchChats<T extends ChatAgentRowLike>(
  activeChats: T[] | null | undefined,
  branchChats: T[] | null | undefined,
  targetChatJid: string | null | undefined,
): T[] {
  if (!Array.isArray(branchChats) || branchChats.length === 0) {
    return Array.isArray(activeChats) ? activeChats : [];
  }

  const activeByChat = new Map<string, T>();
  if (Array.isArray(activeChats)) {
    for (const chat of activeChats) {
      if (hasString(chat?.chat_jid)) {
        activeByChat.set(chat.chat_jid, chat);
      }
    }
  }

  const merged = branchChats.map((chat) => {
    if (!hasString(chat?.chat_jid)) return chat;
    const active = activeByChat.get(chat.chat_jid);
    return active
      ? {
          ...chat,
          ...active,
          is_active: active.is_active ?? chat.is_active,
        }
      : chat;
  });

  const currentChatJid = hasString(targetChatJid) ? targetChatJid : '';
  merged.sort((a, b) => {
    if (a.chat_jid === currentChatJid && b.chat_jid !== currentChatJid) return -1;
    if (b.chat_jid === currentChatJid && a.chat_jid !== currentChatJid) return 1;

    const aArchived = Boolean(a.archived_at);
    const bArchived = Boolean(b.archived_at);
    if (aArchived !== bArchived) return aArchived ? 1 : -1;

    if (Boolean(a.is_active) !== Boolean(b.is_active)) {
      return a.is_active ? -1 : 1;
    }

    const aUpdatedAt = parseTimestampMs(a.updated_at) || parseTimestampMs(a.created_at);
    const bUpdatedAt = parseTimestampMs(b.updated_at) || parseTimestampMs(b.created_at);
    if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt;

    const aName = hasTrimmedString(a.agent_name) ? a.agent_name.trim() : '';
    const bName = hasTrimmedString(b.agent_name) ? b.agent_name.trim() : '';
    const nameCompare = aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;

    return String(a.chat_jid).localeCompare(String(b.chat_jid));
  });

  return merged;
}
