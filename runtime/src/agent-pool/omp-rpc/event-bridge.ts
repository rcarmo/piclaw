/**
  * agent-pool/omp-rpc/event-bridge.ts – Translate omp RPC session-event frames
  * into piclaw AgentSessionEvent objects for the existing onEvent pipeline.
  *
  * piclaw's AgentEvent union (pi-agent-core) is structurally aligned with omp's
  * wire events; the only shape deltas handled here: turn_end gains a synthetic
  * empty toolResults array, agent_end gains willRetry: false, and
  * tool_execution_update is dropped (piclaw's variant uses `args`, not
  * `partialResult`; partial tool-output preview is not load-bearing for the pilot).
  */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { RpcSessionEventFrame } from "./rpc-protocol-types.js";

/** Convert one omp session-event frame into a piclaw event, or null to drop it. */
export function bridgeOmpFrameToAgentSessionEvent(frame: RpcSessionEventFrame): AgentSessionEvent | null {
  switch (frame.type) {
    case "agent_start":
    case "turn_start":
    case "message_start":
    case "message_end":
    case "message_update":
    case "tool_execution_start":
    case "tool_execution_end":
      return frame as unknown as AgentSessionEvent;
    case "turn_end":
      // omp's wire frame omits toolResults; piclaw's AgentEvent requires it.
      return { type: "turn_end", message: frame.message, toolResults: [] } as unknown as AgentSessionEvent;
    case "agent_end":
      // piclaw's AgentSessionEvent narrows agent_end to add willRetry.
      return { type: "agent_end", messages: frame.messages, willRetry: false } as unknown as AgentSessionEvent;
    case "tool_execution_update":
      return null;
    default:
      return null;
  }
}

/** Extract the trailing assistant text from a captured omp agent_end messages array. */
export function extractFinalAssistantText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const role = (message as Record<string, unknown>).role;
    if (role !== "assistant") continue;
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    const joined = parts.join("").trim();
    if (joined) return joined;
  }
  return null;
}
