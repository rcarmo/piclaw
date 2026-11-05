import type Database from "bun:sqlite";
import { readNativeDelegateProgress, formatNativeDelegateProgress } from "../../../agent-pool/delegate-progress.js";
import { buildPreview, createToolTitleTracker } from "./agent-utils.js";

/** Projection of the public pi-durable conversation watch onto existing web events. */
export interface NativeTurnViewChannel {
  publishInput?(sourceId:string):void;
  broadcastEvent(event: string, data: Record<string, unknown>): void;
  updateAgentStatus?(chat: string, data: Record<string, unknown>): void;
  updateThoughtBuffer?(turn: string, text: string, lines: number): void;
  updateDraftBuffer?(turn: string, text: string, lines: number): void;
}
export function createNativeTurnView(database: Database, channel: NativeTurnViewChannel, chat: string) {
  let runId: number | undefined, base: Record<string, unknown> | undefined;
  let thought = "", draft = "", completedThought = "", completedDraft = "", partialThought = "", partialDraft = "";
  let operationId = "", lastTool: Record<string, unknown> | undefined;
  const tools = new Map<string, { signature: string; payload: Record<string, unknown> }>();
  const delegates = new Map<string, ReturnType<typeof readNativeDelegateProgress>>();
  const titles = createToolTitleTracker();
  let queuedIds=new Set<number>();
  let lastStatus = "", queued = 0, entryFrontier: number | undefined, lastPrimary="";
  const status = (data: Record<string, unknown>) => {
    const payload = { chat_jid: chat, source: "durable_runtime", sdk_observation: true, queued_count: queued,
      state: "active", ...base, ...data };
    const signature = JSON.stringify(payload);
    if (signature === lastStatus) return;
    lastStatus = signature;
    channel.updateAgentStatus?.(chat, payload);
    channel.broadcastEvent("agent_status", payload);
  };
  function panel(kind: "thought" | "draft", text: string) {
    const previous = kind === "thought" ? thought : draft;
    if (text === previous || !base) return;
    const lines = text ? text.split("\n").length : 0;
    const turn = base.turn_id as string;
    if (kind === "thought") { thought = text; channel.updateThoughtBuffer?.(turn, text, lines); }
    else { draft = text; channel.updateDraftBuffer?.(turn, text, lines); }
    const preview = buildPreview(text, 8, 160);
    channel.broadcastEvent(`agent_${kind}`, { ...base, text: preview.preview, total_lines: lines, ...(kind === "draft" ? { kind: "draft", mode: "replace" } : {}) });
    const append = previous.length > 0 && text.startsWith(previous);
    channel.broadcastEvent(`agent_${kind}_delta`, { ...base, delta: append ? text.slice(previous.length) : text, reset: !append, ...(!append ? { text } : {}) });
  }
  return (view: any) => {
    const entries=view.entries??[];
    for(const entry of entries){
      if(entryFrontier!==undefined&&entry.id>entryFrontier&&entry.kind==="host.accepted"&&entry.conversationId===view.conversation?.id&&entry.data?.chatJid===chat&&typeof entry.data.sourceId==="string")channel.publishInput?.(entry.data.sourceId);
    }
    entryFrontier=entries.reduce((latest:number,entry:any)=>Math.max(latest,entry.id),entryFrontier??0);
    const live = view.docs["pi.live"] ?? {};
    const inbox=(view.docs["pi.inbox"]?.items??[]).filter((item:any)=>item.mode!=="write");
    const nextQueuedIds=new Set<number>(inbox.map((item:any)=>item.id));
    for(const item of inbox)if(!queuedIds.has(item.id)&&item.entry?.kind==="host.accepted"&&item.entry.data?.chatJid===chat&&typeof item.content==="string")
      channel.broadcastEvent("agent_followup_queued",{chat_jid:chat,row_id:item.id,content:item.content,source:"native_sdk"});
    for(const id of queuedIds)if(!nextQueuedIds.has(id))channel.broadcastEvent("agent_followup_consumed",{chat_jid:chat,row_id:id});
    queuedIds=nextQueuedIds;queued=inbox.length;
    if (!live.run) {
      runId = undefined;
      if (live.compactions?.length) {
        base = undefined;
        status({ type: "intent", state: "active", title: "Compacting context", phase: "compaction", intent_key: "compaction",
          task_id: live.compactions[0].taskId, active_tools: [], active_tool_count: 0 });
      } else status({ type: "done", state: "idle", title: "Idle", active_tools: [], active_tool_count: 0 });
      return;
    }
    if (runId !== live.run.taskId) {
      const input = database.query(`SELECT b.operation_id,b.source_id,m.rowid,m.thread_id FROM piclaw_durable_bindings_v1 b
        LEFT JOIN messages m ON m.id=b.source_id AND m.chat_jid=b.chat_jid
        WHERE b.chat_jid=? AND b.conversation_id=? AND
          (b.submission_id IN (SELECT value FROM json_each(?)) OR EXISTS (
            SELECT 1 FROM piclaw_durable_intent_bindings_v1 i WHERE i.operation_id=b.operation_id
              AND i.chat_jid=b.chat_jid AND i.conversation_id=b.conversation_id
              AND i.submission_id IN (SELECT value FROM json_each(?)))) LIMIT 1`)
        .get(chat, view.conversation.id, JSON.stringify(live.run.inputs), JSON.stringify(live.run.inputs)) as { operation_id: string; source_id:string; rowid: number | null; thread_id: number | null } | null;
      if (!input) return;
      if(lastPrimary!==input.source_id){channel.publishInput?.(input.source_id);lastPrimary=input.source_id;}
      runId = live.run.taskId;
      operationId = input.operation_id; lastTool = undefined;
      base = { chat_jid: chat, agent_id: "default", turn_id: input.rowid ? `durable:${input.rowid}` : `durable-operation:${input.operation_id}`,
        thread_id: input.thread_id ?? input.rowid,
        operation_id: input.operation_id.startsWith("native-message:") ? `sdk-run:${view.conversation.id}:${live.run.inputs[0]}` : input.operation_id,
        source: "durable_runtime", started_at: new Date().toISOString() };
      thought = draft = completedThought = completedDraft = partialThought = partialDraft = lastStatus = ""; tools.clear(); delegates.clear();
      status({ type: "thinking", title: "Thinking...", phase: "thinking" });
    }
    const message = live.generation?.message;
    const model = view.docs["pi.agent"]?.model;
    if (base && (model || message)) base = { ...base, provider: message?.provider ?? model?.provider, model: message?.model ?? model?.modelId };
    // A watch can coalesce a whole generation or tool round. Committed public
    // entries are authoritative for completed text/results; partials are not a ledger.
    const first = view.entries.findIndex((entry: any) => entry.kind === "host.accepted" && entry.data?.operationId === operationId);
    const runEntries = first >= 0 ? view.entries.slice(first) : view.entries.filter((entry: any) => entry.byTaskId >= live.run.taskId);
    const messages = runEntries.flatMap((entry: any) => entry.model ?? []);
    const assistants = messages.filter((item: any) => item.role === "assistant");
    const textFor = (item: any, kind: string) => (item?.content ?? []).filter((block: any) => block.type === kind).map((block: any) => block[kind === "thinking" ? "thinking" : "text"] ?? "").join(kind === "thinking" ? "\n" : "");
    completedThought = assistants.map((item: any) => textFor(item, "thinking")).filter(Boolean).join("\n\n");
    completedDraft = assistants.map((item: any) => textFor(item, "text")).filter(Boolean).join("\n\n");
    partialThought = textFor(message, "thinking"); partialDraft = textFor(message, "text");
    panel("thought", [completedThought, partialThought].filter(Boolean).join("\n\n"));
    panel("draft", [completedDraft, partialDraft].filter(Boolean).join("\n\n"));
    const calls = new Map(messages.flatMap((item: any) => item.content ?? []).filter((block: any) => block.type === "toolCall").map((block: any) => [block.id, block]));
    const results = messages.filter((item: any) => item.role === "toolResult");
    const resultText = (result: any) => (result?.content ?? []).filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n");
    // Historical completions precede current slots. Appending old results after
    // live tools can replace a new running notification with the first result.
    const byCallId = new Map<string, any>();
    for (const result of results) byCallId.set(result.toolCallId, { callId: result.toolCallId, name: result.toolName, status: "done", output: resultText(result) });
    for (const slot of [...(live.tools ?? []), ...(live.nestedTools ?? [])]) byCallId.set(slot.callId, slot);
    const slots = [...byCallId.values()].sort((a, b) => Number(a.status !== "done") - Number(b.status !== "done"));
    const delegateIds = [...calls.values()].filter((call: any) => call.name === "delegate").map((call: any) => call.id);
    for (const slot of slots) {
      if (slot.name !== "delegate") continue;
      const result = results.find((item: any) => item.toolCallId === slot.callId);
      // Result details survive coalesced watches/reconnect; the per-turn cache
      // retains completed siblings when their live slot disappears.
      const progress = readNativeDelegateProgress(slot.details ?? result?.details) ?? delegates.get(slot.callId);
      if (!progress || (!delegates.has(slot.callId) && delegates.size >= 32)) continue;
      delegates.set(slot.callId, { ...progress,
        ...(slot.status === "done" ? { phase: result?.isError ? "failed" as const : "done" as const } : {}) });
    }
    for (const id of delegates.keys()) if (!delegateIds.includes(id)) delegateIds.push(id);
    const delegateProgress = [...delegates].flatMap(([id, progress]) => progress ? [{ tool_call_id: id, ...progress }] : [])
      .sort((a, b) => delegateIds.indexOf(a.tool_call_id) - delegateIds.indexOf(b.tool_call_id));
    const delegatesActive = slots.some((slot: any) => slot.name === "delegate" && slot.status !== "done");
    const delegateOutput = delegateProgress.map(progress => formatNativeDelegateProgress(progress, delegateIds.indexOf(progress.tool_call_id) + 1, delegateIds.length)).join("\n\n");
    const activeTools = slots.filter((slot: any) => slot.status !== "done").map((slot: any) => ({
      tool_call_id: slot.callId, tool_name: slot.name, title: titles.remember(slot.callId, slot.name, slot.arguments ?? (calls.get(slot.callId) as any)?.arguments), status: slot.status,
      ...(slot.arguments ? { tool_args: slot.arguments } : {}),
      ...(slot.output ? { output_preview: slot.output.slice(-4000), output_preview_lines: slot.output.split("\n").length } : {}),
    }));
    let currentTool: Record<string, unknown> | undefined;
    for (const slot of slots) {
      const result = results.find((item: any) => item.toolCallId === slot.callId);
      // Progress is display-only. Preserve real tool output and expose each
      // independent child in the existing expandable Output pane, not Draft.
      const output = [slot.output || resultText(result), slot.name === "delegate" || delegatesActive ? delegateOutput : ""].filter(Boolean).join("\n\n");
      const call: any = calls.get(slot.callId);
      const args = slot.arguments ?? call?.arguments;
      // Diagnostics and live/committed slot shape changes are not UI activity.
      const signature = JSON.stringify([slot.name, slot.status, args, output]);
      const previous = tools.get(slot.callId);
      if (previous?.signature === signature) { currentTool = previous.payload; continue; }
      currentTool = { type: output || slot.status === "done" ? "tool_status" : "tool_call", title: titles.remember(slot.callId, slot.name, args), tool_call_id: slot.callId, tool_name: slot.name,
        tool_args: args, status: slot.status, active_tools: activeTools, active_tool_count: activeTools.length, last_event_at: new Date().toISOString(),
        ...(delegateProgress.length ? { delegate_progress: delegateProgress } : {}),
        ...(output ? { output_preview: output.slice(-16000), output_preview_lines: output.split("\n").length } : {}) };
      tools.set(slot.callId, { signature, payload: currentTool });
      status(currentTool);
    }
    if (currentTool) lastTool = { ...currentTool, active_tools: activeTools, active_tool_count: activeTools.length };
    const retry = live.generation?.retry;
    if (retry) {
      const at = typeof retry.at === "number" && Number.isFinite(retry.at) && Math.abs(retry.at) <= 8.64e15 ? new Date(retry.at).toISOString() : undefined;
      const attempt = Number.isSafeInteger(live.generation.attempt) && live.generation.attempt > 0 ? live.generation.attempt : undefined;
      // Use the existing intent/countdown panel, preserving the last tool's
      // Output data. Never forward the SDK's free-form provider error here.
      status({ ...lastTool, type: "intent", title: "Retrying model request" + (attempt ? " (retry " + attempt + ")" : ""), phase: "retry",
        ...(at ? { retry_at: at } : {}), active_tools: activeTools, active_tool_count: activeTools.length });
    } else if (activeTools.length && lastTool) status(lastTool);
    else if (!activeTools.length && live.generation) {
      // Retain the last tool and its output while the model resumes. A phase
      // update must not erase the Output pane or a fast tool's feedback.
      status(lastTool ? { ...lastTool, active_tools: [], active_tool_count: 0, last_activity: true, phase: partialDraft ? "drafting" : "thinking" }
        : { type: "thinking", title: partialDraft ? "Writing response..." : "Thinking...", phase: partialDraft ? "drafting" : "thinking", active_tools: [], active_tool_count: 0 });
    } else if (currentTool && lastTool) status(lastTool);
  };
}
