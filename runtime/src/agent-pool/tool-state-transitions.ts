import { createHash } from "node:crypto";

import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-pool.tool-state");

function normalize(names: readonly string[]): string[] {
  return [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))].sort();
}

function fingerprint(names: readonly string[]): string {
  return createHash("sha256").update(normalize(names).join("\n")).digest("hex").slice(0, 16);
}

export function logToolStateTransition(input: {
  chatJid: string;
  turnId?: string;
  phase: string;
  cause: string;
  previous: readonly string[];
  next: readonly string[];
  restored?: boolean;
}): void {
  const previous = normalize(input.previous);
  const next = normalize(input.next);
  log.info("Active tool set changed", {
    operation: "agent_tool_state.transition",
    chatJid: input.chatJid,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    phase: input.phase,
    cause: input.cause,
    previousCount: previous.length,
    nextCount: next.length,
    previousHash: fingerprint(previous),
    nextHash: fingerprint(next),
    restored: input.restored === true,
  });
}
