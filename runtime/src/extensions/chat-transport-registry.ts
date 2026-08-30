/** Process-wide registry for chat destination transports. */

import type { ParsedChatAddress, ChatAddressKind } from "./chat-address.js";

export type ChatTransportMode = "auto" | "queue" | "steer";

export interface ChatTransportAttachment {
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  data: Uint8Array;
  source_media_id?: number;
}

export interface ChatTransportDirectoryEntry {
  address: string;
  label: string;
  peer_alias?: string;
  peer_fingerprint?: string;
  target_kind: "inbox" | "agent" | "reply";
  modes: ChatTransportMode[];
  status: "ready" | "stale" | "unreachable";
  last_seen_at?: string | null;
  attachments?: {
    enabled: boolean;
    max_files: number;
    max_file_bytes: number;
    max_total_bytes: number;
  };
}

export interface ChatTransportDirectory {
  transport: string;
  generated_at: string;
  entries: ChatTransportDirectoryEntry[];
  notes?: string[];
}

export interface ChatTransportRequest {
  source_chat_jid: string;
  source_agent_name?: string;
  source_agent_display_name?: string;
  address: ParsedChatAddress;
  content: string;
  mode: ChatTransportMode;
  attachments?: ChatTransportAttachment[];
  idempotency_key?: string;
  in_reply_to?: string;
}

export interface ChatTransportResult {
  status?: string;
  relayed?: boolean;
  transport?: string;
  target_address?: string;
  source_chat_jid: string;
  source_agent_name?: string;
  source_agent_display_name?: string;
  target_chat_jid?: string;
  target_agent_name?: string;
  target_agent_display_name?: string;
  reply_to?: Record<string, unknown>;
  source_session_tree?: Record<string, unknown>;
  target_session_tree?: Record<string, unknown>;
  row_id?: number | null;
  queued?: string;
  thread_id?: number | null;
  created?: boolean;
  [key: string]: unknown;
}

export interface ChatTransport {
  id: string;
  kind: ChatAddressKind;
  directory?(): Promise<ChatTransportDirectory> | ChatTransportDirectory;
  validate?(request: ChatTransportRequest): Promise<void> | void;
  send(request: ChatTransportRequest): Promise<ChatTransportResult>;
}

const transports = new Map<ChatAddressKind, ChatTransport>();

function validateTransport(transport: ChatTransport): void {
  if (!transport || typeof transport !== "object") throw new Error("Chat transport must be an object.");
  if (!transport.id?.trim()) throw new Error("Chat transport id is required.");
  if (transport.kind !== "local" && transport.kind !== "bang") {
    throw new Error(`Unsupported chat transport kind: ${String(transport.kind)}`);
  }
  if (typeof transport.send !== "function") throw new Error("Chat transport send function is required.");
}

/** Register the sole provider for one address kind. */
export function registerChatTransport(transport: ChatTransport): () => void {
  validateTransport(transport);
  const normalized: ChatTransport = { ...transport, id: transport.id.trim() };
  const existing = transports.get(normalized.kind);
  if (existing) {
    throw new Error(
      `Chat transport kind "${normalized.kind}" is already registered by "${existing.id}"; ` +
      `cannot register "${normalized.id}".`,
    );
  }
  transports.set(normalized.kind, normalized);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (transports.get(normalized.kind) === normalized) transports.delete(normalized.kind);
  };
}

/** Replace/remove the core-owned local transport across module reloads. */
export function setLocalChatTransport(transport: Omit<ChatTransport, "kind"> | undefined): void {
  const existing = transports.get("local");
  if (existing && existing.id !== "local") {
    throw new Error(`Cannot replace local chat transport owned by "${existing.id}".`);
  }
  transports.delete("local");
  if (!transport) return;
  validateTransport({ ...transport, kind: "local" });
  transports.set("local", { ...transport, id: transport.id.trim(), kind: "local" });
}

export function getChatTransport(kind: ChatAddressKind): ChatTransport | null {
  return transports.get(kind) ?? null;
}

export async function getChatTransportDirectories(): Promise<ChatTransportDirectory[]> {
  const directories: ChatTransportDirectory[] = [];
  for (const transport of transports.values()) {
    if (typeof transport.directory !== "function") continue;
    directories.push(await transport.directory());
  }
  return directories;
}

export async function sendViaChatTransport(
  request: ChatTransportRequest,
  options: { annotate?: boolean } = {},
): Promise<ChatTransportResult> {
  const transport = getChatTransport(request.address.kind);
  if (!transport) {
    throw new Error(
      request.address.kind === "bang"
        ? `No chat transport is registered for remote address "${request.address.raw}".`
        : "Cross-session chat relay is unavailable in this runtime.",
    );
  }
  await transport.validate?.(request);
  const result = await transport.send(request);
  if (options.annotate === false) return result;
  return {
    transport: transport.id,
    target_address: request.address.raw,
    ...result,
  };
}

/** Reset all transports for focused tests. Production owners should unregister explicitly. */
export function resetChatTransportRegistryForTests(): void {
  transports.clear();
}
