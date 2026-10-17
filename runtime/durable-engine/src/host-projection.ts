import { watchEvents, type AgentEvent, type Harness, type SubmissionId, type ConversationId } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import type { ProjectionOwner, PublicAgentEvent, PublicAgentProjection } from "../../../runtime/src/service-effects/contracts/agent-projection-sink.js";
import { CurrentPiclawAgentProjectionSink } from "../../../runtime/src/service-effects/current-piclaw/agent-projection-sink.js";

/** Host acceptance/binding evidence, NOT a task ID inferred from a watch. */
export interface ProjectionBinding extends ProjectionOwner {
  readonly harnessOperationId: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly submissionId: SubmissionId;
  readonly conversationId: ConversationId;
  readonly watchGeneration: number;
}
export interface ProjectionPorts {
  isCurrent(binding: ProjectionBinding): boolean;
  /** Required host redactor; must be safe for independently streamed fragments. */
  sanitize(text: string): string;
  send(name: "agent_status" | "agent_draft", payload: Record<string, unknown>): void;
}
const LIMIT = 8192; // UTF-16 code units per retained draft, no transcript/tool-output retention.
const MAX_PUBLICATION_BYTES = 65536; // Whole serialized payload, including escaping and host metadata.

/** Inactive bridge: existing UI namespace captured behind the actual EF-S08 sink.
 * Unsupported thinking, argument edits, nested tools and error details fail closed.
 * Receipt order is local committed observation, NEVER durable delivery or settlement.
 */
export async function observeProjection(harness: Harness, binding: ProjectionBinding, ports: ProjectionPorts, context: Context) {
  if (!binding.chatJid || !binding.operationId || !binding.harnessOperationId || !binding.submissionId || !binding.threadId || !binding.agentId ||
      !Number.isSafeInteger(binding.watchGeneration) || binding.watchGeneration < 0) throw new Error("Invalid projection binding");
  const accepted = Object.freeze({ ...binding });
  let stopped = false, generation = accepted.watchGeneration - 1, receiptSeq = 0, matching = false, draft = "";
  const current = () => !stopped && ports.isCurrent(accepted);
  const safe = (text: string) => ports.sanitize(text.slice(0, LIMIT)).slice(0, LIMIT);
  const base = { thread_id: accepted.threadId, agent_id: accepted.agentId, turn_id: accepted.operationId };
  const send: ProjectionPorts["send"] = (name, payload) => {
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_PUBLICATION_BYTES) ports.send(name, payload);
  };
  const transport = (projection: PublicAgentProjection) => {
    if (!current()) throw new Error("Projection owner lost");
    if (projection.type === "agent_snapshot") {
      draft = "";
      send("agent_draft", { ...base, text: "", total_lines: 0, kind: "draft", mode: "replace" });
      // A watch attachment/resync is not evidence of worker activity.
    } else if (projection.type === "assistant_delta") {
      draft = (draft + projection.textDelta).slice(-LIMIT);
      send("agent_draft", { ...base, text: draft, total_lines: draft.split("\n").length, kind: "draft", mode: "replace" });
    } else if (projection.type === "tool_started") {
      send("agent_status", { ...base, type: "tool_call", title: projection.toolName,
        tool_call_id: projection.toolCallId, tool_name: projection.toolName });
    } else if (projection.type === "tool_updated") {
      send("agent_status", { ...base, type: "tool_status", tool_call_id: projection.toolCallId, title: "Working..." });
    }
  };
  const sink = new CurrentPiclawAgentProjectionSink({
    isCurrentOwner: owner => current() && owner.chatJid === accepted.chatJid && owner.operationId === accepted.operationId && owner.harnessOperationId === accepted.harnessOperationId,
    isCommittedTerminalRef: () => false,
  }, { publish: transport }, { nextId: () => "unused", hitFault: () => false, recordTrace() {} });
  const identity = () => ({ chatJid: accepted.chatJid, operationId: accepted.operationId,
    harnessOperationId: accepted.harnessOperationId, watchGeneration: generation, receiptSeq: receiptSeq++ });
  async function publish(event: PublicAgentEvent) {
    if (!current()) return;
    const result = await sink.publishEvent(event);
    if (!result.ok) throw new Error(`Projection rejected: ${result.error._tag}`);
  }
  async function text(value: string) {
    if (value) await publish({ ...identity(), type: "assistant_delta", textDelta: safe(value) });
  }
  async function message(value: NonNullable<Extract<AgentEvent, { type: "snapshot" }>["generation"]>["message"]) {
    if (!value || value.role !== "assistant") return;
    for (const block of value.content.slice(0, 32)) if (block.type === "text") await text(block.text);
  }
  async function consume(events: readonly AgentEvent[]) {
    for (const event of events) {
      if (!current()) return;
      if (event.type === "snapshot") {
        matching = !!event.run?.inputs.includes(accepted.submissionId);
        generation++; receiptSeq = 0;
        const result = await sink.publishSnapshot({ ...identity(), type: "agent_snapshot", phase: matching ? "running" : "accepted",
          modelLabel: null, activeToolNames: [], cancellationRequested: false });
        if (!result.ok) throw new Error(`Projection rejected: ${result.error._tag}`);
        if (matching && event.generation?.message) await message(event.generation.message);
        if (matching) for (const tool of event.tools.slice(0, 32)) if (tool.status === "running")
          await publish({ ...identity(), type: "tool_started", toolCallId: safe(tool.callId), toolName: safe(tool.name) });
      } else if (event.type === "run_start") {
        matching = event.inputs.includes(accepted.submissionId);
      } else if (event.type === "run_end") {
        matching = false; // Observation cannot publish done, settle, consume a source, or enqueue outbox work.
      } else if (matching && event.type === "message_update") {
        // Public message_update changes originate only in pi.live.generation.message.
        // message_start/end also describe arbitrary public write entries, even in this
        // accepted run: never use them as assistant-text provenance. Initial partials
        // are supported only by snapshots; final-only text belongs to settlement.
        for (const change of event.changes) if (change.type === "text_delta") await text(change.delta);
        // Whole-message/block replacements are unsupported: don't fabricate append semantics.
      } else if (matching && event.type === "tool_execution_start" && !event.parentToolCallId) {
        await publish({ ...identity(), type: "tool_started", toolCallId: safe(event.toolCallId), toolName: safe(event.toolName) });
      } else if (matching && event.type === "tool_execution_update" && !event.parentToolCallId) {
        await publish({ ...identity(), type: "tool_updated", toolCallId: safe(event.toolCallId), publicSummary: null });
      }
    }
  }
  const stream = await watchEvents(harness, accepted.conversationId, context);
  try {
    await consume([stream.snapshot]);
    stream.start(consume);
  } catch (error) { stopped = true; await stream.stop(); throw error; }
  return { sink, closed: stream.closed, settlementAuthority: false as const,
    stop: () => { stopped = true; draft = ""; return stream.stop(); } };
}
