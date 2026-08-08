/**
 * core/chat-context.ts – Ambient chat context propagated via AsyncLocalStorage.
 *
 * When the runtime processes a message it wraps the entire handler chain inside
 * `withChatContext()`, making the chat JID and channel name available to any
 * downstream code without explicit parameter threading.
 *
 * Consumers:
 *   - agent-pool.ts uses getChatJid() / getChatChannel() when building the
 *     pi-agent session to tag tool invocations.
 *   - channels/formatting.ts reads the channel to decide channel-specific formatting
 *     formatting rules.
 *   - extensions/* may read context to scope database queries.
 *   - runtime.ts / runtime/message-loop.ts call withChatContext() at the top
 *     of each message processing cycle.
 */

import { AsyncLocalStorage } from "async_hooks";

/** The ambient data stored per async execution context. */
export interface ChatContext {
  /** The JID (chat identifier) currently being processed. */
  chatJid: string;
  /** Channel name, e.g. "web" or addon-registered channel types. */
  channel: string;
  /** Exact agent turn identity when running inside a prompt lifecycle. */
  turnId?: string;
}

/** Node.js AsyncLocalStorage instance that carries the ChatContext. */
const storage = new AsyncLocalStorage<ChatContext>();

/**
 * Execute `fn` within an async context where the given chat JID and channel
 * are available via getChatContext() / getChatJid() / getChatChannel().
 *
 * Called by the runtime message loop when processing each inbound message.
 */
export async function withChatContext<T>(
  chatJid: string,
  channel: string,
  fn: () => Promise<T>,
  options?: { turnId?: string },
): Promise<T> {
  return storage.run({ chatJid, channel, ...(options?.turnId ? { turnId: options.turnId } : {}) }, fn);
}

/**
 * Retrieve the current ChatContext, or null if called outside a
 * withChatContext() scope (e.g. during startup or in a timer callback).
 */
export function getChatContext(): ChatContext | null {
  return storage.getStore() ?? null;
}

/**
 * Retrieve just the chat JID from the ambient context.
 * Returns `defaultValue` when no context is active.
 */
export function getChatJid(defaultValue = "web:default"): string {
  return storage.getStore()?.chatJid ?? defaultValue;
}

/**
 * Retrieve just the channel name from the ambient context.
 * Returns `defaultValue` when no context is active.
 */
export function getChatChannel(defaultValue = "web"): string {
  return storage.getStore()?.channel ?? defaultValue;
}

/** Retrieve the exact prompt turn identity when one is active. */
export function getChatTurnId(defaultValue = ""): string {
  return storage.getStore()?.turnId ?? defaultValue;
}
