/** Durable-enough per-turn abort provenance for terminal outcome/log rendering. */

export type AgentAbortCause =
  | "user_command"
  | "service_shutdown"
  | "context_pressure"
  | "goal_deadline_checkpoint"
  | "prompt_timeout"
  | "stale_progress_watchdog"
  | "tool_budget"
  | "provider_cancelled"
  | "internal";

export interface AgentAbortProvenance {
  cause: AgentAbortCause;
  operation: string;
  recordedAt: string;
}

const causesByChat = new Map<string, AgentAbortProvenance>();

export function recordAgentAbortCause(chatJid: string, cause: AgentAbortCause, operation: string): void {
  const normalizedChatJid = chatJid.trim();
  if (!normalizedChatJid) return;
  // Keep the first initiator: later abort fallout must not overwrite the
  // actionable root cause that requested cancellation.
  if (causesByChat.has(normalizedChatJid)) return;
  causesByChat.set(normalizedChatJid, { cause, operation, recordedAt: new Date().toISOString() });
}

export function getAgentAbortCause(chatJid: string): AgentAbortProvenance | null {
  const value = causesByChat.get(chatJid.trim()) ?? null;
  return value ? { ...value } : null;
}

export function consumeAgentAbortCause(chatJid: string): AgentAbortProvenance | null {
  const normalizedChatJid = chatJid.trim();
  const value = causesByChat.get(normalizedChatJid) ?? null;
  if (value) causesByChat.delete(normalizedChatJid);
  return value ? { ...value } : null;
}

export function clearAgentAbortCause(chatJid: string): void {
  causesByChat.delete(chatJid.trim());
}

export function resetAgentAbortProvenanceForTests(): void {
  causesByChat.clear();
}
