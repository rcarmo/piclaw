export interface SessionEntry {
  jid: string;
  name?: string;
  display_name?: string;
  status?: string;
  archived?: boolean;
}

export function normalizeSessionEntry(raw: Record<string, unknown>): SessionEntry {
  return {
    jid: (raw.chat_jid ?? raw.jid ?? "") as string,
    name: (raw.agent_name ?? raw.name) as string | undefined,
    display_name: (raw.display_name ?? raw.session_name) as string | undefined,
    status: raw.archived_at ? "archived" : (raw.status as string | undefined),
    archived: Boolean(raw.archived_at ?? raw.archived),
  };
}

export function mergeSessionEntries(chats: SessionEntry[], branches: SessionEntry[]): SessionEntry[] {
  const merged = new Map<string, SessionEntry>();

  for (const entry of chats) {
    if (!entry.jid) continue;
    merged.set(entry.jid, entry);
  }

  for (const entry of branches) {
    if (!entry.jid) continue;
    const existing = merged.get(entry.jid);
    merged.set(entry.jid, {
      jid: entry.jid,
      name: entry.name ?? existing?.name,
      display_name: entry.display_name ?? existing?.display_name,
      status: entry.status ?? existing?.status,
      archived: entry.archived ?? existing?.archived,
    });
  }

  return Array.from(merged.values());
}

export function chatName(entry: Pick<SessionEntry, "jid" | "name" | "display_name">): string {
  if (entry.display_name) return entry.display_name;
  const jidTail = entry.jid.split(":").pop() ?? entry.jid;
  if (entry.name && entry.name !== jidTail) return entry.name;
  if (jidTail === "default") return "piclaw";
  return entry.name ?? jidTail;
}

export function sanitizeSessionName(input: string | null): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

  return cleaned ? cleaned : null;
}

export function extractChatJidFromAction(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const maybePayload = payload as {
    branch?: { chat_jid?: unknown };
    parent?: { chat_jid?: unknown };
    chat_jid?: unknown;
  };

  if (typeof maybePayload.branch?.chat_jid === "string" && maybePayload.branch.chat_jid) {
    return maybePayload.branch.chat_jid;
  }

  // Merge response returns parent.chat_jid
  if (typeof maybePayload.parent?.chat_jid === "string" && maybePayload.parent.chat_jid) {
    return maybePayload.parent.chat_jid;
  }

  if (typeof maybePayload.chat_jid === "string" && maybePayload.chat_jid) {
    return maybePayload.chat_jid;
  }

  return null;
}

export async function loadMergedSessions(activeChatJid: string, options?: { includeArchived?: boolean }): Promise<{ sessions: SessionEntry[]; unauthorized: boolean }> {
  const archiveParam = options?.includeArchived ? "&include_archived=1" : "";
  const [chatsRes, branchesRes] = await Promise.all([
    fetch("/agent/active-chats", { credentials: "same-origin" }),
    fetch(`/agent/branches?_=1${archiveParam}`, { credentials: "same-origin" }),
  ]);

  if (chatsRes.status === 401 || branchesRes.status === 401) {
    return { sessions: [], unauthorized: true };
  }

  if (!chatsRes.ok) throw new Error(`active-chats: HTTP ${chatsRes.status}`);
  if (!branchesRes.ok) throw new Error(`branches: HTTP ${branchesRes.status}`);

  const chatsData = await chatsRes.json();
  const branchesData = await branchesRes.json();

  const chatRows = (Array.isArray(chatsData) ? chatsData : (chatsData.chats ?? []))
    .map((row: Record<string, unknown>) => normalizeSessionEntry(row));
  const branchRows = (Array.isArray(branchesData) ? branchesData : (branchesData.chats ?? branchesData.branches ?? []))
    .map((row: Record<string, unknown>) => normalizeSessionEntry(row));

  return { sessions: mergeSessionEntries(chatRows, branchRows), unauthorized: false };
}
