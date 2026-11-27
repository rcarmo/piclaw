/** Shared Classic/Visual transport. One cached reply and in-flight request per
 * chat; a full catalogue remains an on-demand picker/settings request. */
import { setChatProjectRepository } from "./chat-project-state.js";

export interface AgentUiSnapshot {
  status: any;
  model: any;
  context: any;
  context_revision?: string;
  metrics: any;
  agent_name: string;
  errors: string[];
  project_repository?: { repository_url: string | null; source_branch_id: string | null; revision: string | null } | null;
}
interface Entry {
  value?: AgentUiSnapshot;
  completedAt: number;
  generation: number;
  inFlight?: Promise<AgentUiSnapshot>;
}
type ChatEntry = { full?: Entry; passive?: Entry; requested: number; fullRequestTicket?: number; publishedRepository: number };
const entries = new Map<string, ChatEntry>();
const fresh = (entry?: Entry) =>
  Boolean(entry?.value && entry.completedAt > 0 && Date.now() - entry.completedAt < AGENT_UI_POLL_MS - 250);
export const AGENT_UI_POLL_MS = 5000;
export function currentUiChatJid(): string {
  if (typeof window === "undefined") return "web:default";
  const href = (window as any).location?.href;
  return (
    (window as any).__piclawCurrentChatJid ||
    (href ? new URL(href).searchParams.get("chat_jid") : null) ||
    "web:default"
  );
}
export function invalidateAgentUiSnapshot(chatJid = currentUiChatJid()): void {
  const chat = entries.get(chatJid);
  for (const entry of [chat?.full, chat?.passive]) {
    if (!entry) continue;
    entry.completedAt = 0;
    entry.generation++;
  }
}
/** Return the exact successful full payload when this revision is still valid.
 * This deliberately does not require the full entry to be fresh: a periodic
 * lightweight observation may reuse it after its ordinary polling TTL. */
export function successfulAgentContextForRevision(chatJid: string, revision: unknown): any | undefined {
  if (typeof revision !== 'string' || !revision) return undefined;
  const full = entries.get(chatJid)?.full;
  // Invalidation clears completedAt. Keep the object for identities, but never
  // let a response from before that boundary satisfy a periodic observation.
  if (!full?.value || full.completedAt <= 0) return undefined;
  if (!full.value.context || full.value.context_revision !== revision) return undefined;
  return full.value.context;
}

/** Reconcile a missed update without fetching unchanged context just because its TTL expired. */
export function needsAgentContextRefresh(chatJid: string, revision: unknown): boolean {
  // Without a revision (older server or failed lightweight read), retain the
  // ordinary recovery path. Do not treat unknown as an unchanged context.
  if (typeof revision !== 'string' || !revision) return true;
  const full = entries.get(chatJid)?.full;
  if (successfulAgentContextForRevision(chatJid, revision) !== undefined) return false;
  if (full?.inFlight) return false;
  if (full) full.completedAt = 0;
  return true;
}

export function getAgentUiFullRequestTicket(chatJid: string): number | undefined {
  return entries.get(chatJid)?.fullRequestTicket;
}

export function getAgentUiSnapshot(
  chatJid = currentUiChatJid(),
  includeContext = true,
): Promise<AgentUiSnapshot> {
  let chat = entries.get(chatJid);
  if (!chat) {
    // The limit counts chats, not demand scopes. Keep only active requests.
    if (entries.size >= 32)
      for (const [key, item] of entries) {
        if (!item.full?.inFlight && !item.passive?.inFlight) {
          entries.delete(key);
          break;
        }
      }
    chat = { requested: 0, publishedRepository: 0 };
    entries.set(chatJid, chat);
  }
  // Passive consumers may use a full response already requested by a real
  // context consumer. A full request must never join a passive response.
  if (!includeContext && chat.full?.inFlight) return chat.full.inFlight;
  if (!includeContext && fresh(chat.full)) return Promise.resolve(chat.full!.value!);
  const scope = includeContext ? 'full' : 'passive';
  const state = chat[scope] ??= { completedAt: 0, generation: 0 };
  if (state.inFlight) return state.inFlight;
  if (fresh(state)) return Promise.resolve(state.value!);
  const generation = state.generation, startedAt = Date.now(), ticket = ++chat.requested;
  if (includeContext) chat.fullRequestTicket = ticket;
  state.inFlight = (async () => {
    const response = await fetch(
      `/agent/status?chat_jid=${encodeURIComponent(chatJid)}&ui=1${includeContext ? '' : '&context=0'}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error(`UI snapshot HTTP ${response.status}`);
    const next = (await response.json()) as AgentUiSnapshot;
    if (!next || !next.status || !Array.isArray(next.errors))
      throw new Error("Invalid UI snapshot");
    if (generation !== state.generation) {
      // An event invalidated this response while its body was pending. All
      // joiners await one replacement rather than applying pre-event state.
      state.inFlight = undefined;
      return getAgentUiSnapshot(chatJid, includeContext);
    }
    for (const key of ["status", "model", "context", "metrics"] as const) {
      if (
        state.value &&
        JSON.stringify(state.value[key]) === JSON.stringify(next[key])
      )
        next[key] = state.value[key];
    }
    if (ticket > chat.publishedRepository) {
      chat.publishedRepository = ticket;
      setChatProjectRepository(chatJid, next.project_repository ?? null);
    }
    state.value = next;
    state.completedAt = startedAt;
    return next;
  })().finally(() => {
    if (state.inFlight === pending) state.inFlight = undefined;
  });
  const pending = state.inFlight;
  return pending;
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  for (const name of [
    "piclaw:sse-connected",
    "piclaw:model-state-changed",
    "piclaw:agent-status",
    "piclaw:current-chat-changed",
  ]) {
    window.addEventListener(name, (event) => {
      const detail = (event as CustomEvent).detail;
      // Token/tool progress can arrive faster than a network round trip. It
      // already travels over SSE; terminal events and compaction ownership
      // handoffs invalidate polling so a pre-command idle reply cannot win.
      if (
        name === "piclaw:agent-status" &&
        !["done", "error"].includes(detail?.type) &&
        !(detail?.type === "intent" && detail?.intent_key === "compaction") &&
        detail?.status !== "idle"
      )
        return;
      invalidateAgentUiSnapshot(
        detail?.chatJid || detail?.chat_jid || currentUiChatJid(),
      );
    });
  }
}
