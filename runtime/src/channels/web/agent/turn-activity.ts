/**
 * web/agent/turn-activity.ts – presentation projection of one durable turn.
 *
 * Maps committed SDK entries (assistant thinking/text/tool calls and tool
 * results) to the ordered step list behind the timeline's "Worked for …" log.
 * Pure and bounded: list payloads carry previews only; full text and output are
 * read per step through `projectTurnStepDetail`.
 *
 * Consumers: handlers/turn-activity.ts.
 */

import type { DurableTurnEntries } from "../../../agent-pool/durable-runtime-adapter.js";
import { formatToolTitle } from "./agent-utils.js";

export type TurnStepStatus = "ok" | "error" | "running" | "aborted";

export interface TurnNestedCall {
  name: string;
  title: string;
  status: TurnStepStatus;
  duration_ms: number | null;
}

export interface TurnActivityStep {
  id: string;
  kind: "thinking" | "text" | "tool" | "input";
  /** Bounded preview for thinking, text and steering input. */
  text?: string;
  chars?: number;
  tool?: {
    call_id: string;
    name: string;
    title: string;
    status: TurnStepStatus;
    duration_ms: number | null;
    args_preview: string;
    output_preview: string;
    output_chars: number;
    output_lines: number;
    images: number;
    nested?: TurnNestedCall[];
  };
}

export interface TurnActivity {
  answer_entry_id: number;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
  tool_ms: number;
  output_tokens: number;
  tools: number;
  errors: number;
  steps: TurnActivityStep[];
  truncated: boolean;
}

const TEXT_PREVIEW = 1200;
const ARGS_PREVIEW = 600;
const OUTPUT_PREVIEW = 800;
const DETAIL_LIMIT = 256 * 1024;

interface Block { type?: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown; data?: unknown }
interface ModelMessage {
  role?: string; content?: unknown; stopReason?: string; timestamp?: number;
  usage?: { output?: number }; toolCallId?: string; toolName?: string; isError?: boolean;
  details?: unknown; durationMs?: number;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const blocks = (message: ModelMessage | undefined): Block[] => (Array.isArray(message?.content) ? message!.content as Block[] : []);
const first = (entry: DurableTurnEntries["entries"][number]): ModelMessage | undefined => entry.model?.[0] as ModelMessage | undefined;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function argsText(args: unknown): string {
  if (typeof args === "string") return args;
  try { return JSON.stringify(args ?? {}, null, 2); } catch { return String(args); }
}

function resultText(message: ModelMessage | undefined): string {
  if (typeof message?.content === "string") return message.content;
  return blocks(message).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
}

function nestedCalls(details: unknown): TurnNestedCall[] | undefined {
  const calls = (details as { calls?: unknown } | undefined)?.calls;
  if (!Array.isArray(calls) || !calls.length) return undefined;
  return calls.slice(0, 200).map((call) => {
    const record = call as { name?: unknown; args?: unknown; status?: unknown; durationMs?: unknown };
    const name = typeof record.name === "string" ? record.name : "tool";
    return {
      name,
      title: formatToolTitle(name, record.args),
      status: record.status === "ok" ? "ok" : record.status === "error" ? "error" : "running",
      duration_ms: finite(record.durationMs) ? record.durationMs : null,
    };
  });
}

/** Union of [start, end) spans, so parallel calls count once. */
function unionMs(spans: Array<[number, number]>): number {
  const sorted = spans.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, start = -1, end = -1;
  for (const [a, b] of sorted) {
    if (a > end) { if (end > start) total += end - start; start = a; end = b; }
    else end = Math.max(end, b);
  }
  return end > start ? total + end - start : total;
}

/** Project a settled turn's committed entries; the final answer text stays in the reply post. */
export function projectTurnActivity(turn: DurableTurnEntries, answerEntryId: number): TurnActivity {
  const steps: TurnActivityStep[] = [];
  const toolSteps = new Map<string, NonNullable<TurnActivityStep["tool"]>>();
  const spans: Array<[number, number]> = [];
  let outputTokens = 0, startedAt: number | null = null, endedAt: number | null = null, inputs = 0;

  for (const entry of turn.entries) {
    const task = entry.byTaskId === undefined ? undefined : turn.tasks[entry.byTaskId];
    if (task && finite(task.startedAt)) startedAt = startedAt === null ? task.startedAt : Math.min(startedAt, task.startedAt);
    if (task && finite(task.endedAt)) endedAt = endedAt === null ? task.endedAt : Math.max(endedAt, task.endedAt);
    const message = first(entry);
    if (entry.kind === "host.accepted") {
      // The first input is the user's prompt post; later ones are steering posts.
      if (inputs++ > 0 && typeof message?.content === "string") {
        steps.push({ id: `input:${entry.id}`, kind: "input", text: clip(message.content, TEXT_PREVIEW), chars: message.content.length });
      }
      continue;
    }
    if (entry.kind === "pi.assistant" && message?.role === "assistant") {
      if (finite(message.usage?.output)) outputTokens += message.usage!.output!;
      const final = entry.id === answerEntryId;
      blocks(message).forEach((block, index) => {
        if (block.type === "thinking" && block.thinking?.trim()) {
          steps.push({ id: `thinking:${entry.id}:${index}`, kind: "thinking", text: clip(block.thinking, TEXT_PREVIEW), chars: block.thinking.length });
        } else if (block.type === "text" && block.text?.trim() && !final) {
          steps.push({ id: `text:${entry.id}:${index}`, kind: "text", text: clip(block.text, TEXT_PREVIEW), chars: block.text.length });
        } else if (block.type === "toolCall" && block.id && block.name) {
          const args = argsText(block.arguments);
          const tool = { call_id: block.id, name: block.name, title: formatToolTitle(block.name, block.arguments),
            status: "running" as TurnStepStatus, duration_ms: null, args_preview: clip(args, ARGS_PREVIEW),
            output_preview: "", output_chars: 0, output_lines: 0, images: 0 };
          toolSteps.set(block.id, tool);
          steps.push({ id: `tool:${block.id}`, kind: "tool", tool });
        }
      });
      continue;
    }
    if (entry.kind === "pi.tool-result" && message?.role === "toolResult" && message.toolCallId) {
      const tool = toolSteps.get(message.toolCallId);
      if (!tool) continue;
      const output = resultText(message);
      const aborted = task?.outcome === "aborted" || task?.outcome === "cancelled";
      tool.status = aborted ? "aborted" : message.isError || task?.outcome === "failed" ? "error" : "ok";
      const duration = finite(message.durationMs) ? message.durationMs
        : task && finite(task.startedAt) && finite(task.endedAt) ? task.endedAt - task.startedAt : null;
      tool.duration_ms = duration;
      if (task && finite(task.startedAt) && finite(task.endedAt)) spans.push([task.startedAt, task.endedAt]);
      else if (duration !== null && finite(message.timestamp)) spans.push([message.timestamp - duration, message.timestamp]);
      tool.output_preview = clip(output, OUTPUT_PREVIEW);
      tool.output_chars = output.length;
      tool.output_lines = output ? output.split("\n").length : 0;
      tool.images = blocks(message).filter((block) => block.type === "image").length;
      const nested = nestedCalls(message.details);
      if (nested) tool.nested = nested;
    }
  }

  const tools = [...toolSteps.values()];
  return {
    answer_entry_id: answerEntryId,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: startedAt !== null && endedAt !== null ? endedAt - startedAt : null,
    tool_ms: unionMs(spans),
    output_tokens: outputTokens,
    tools: tools.length,
    errors: tools.filter((tool) => tool.status === "error").length,
    steps,
    truncated: turn.truncated,
  };
}

export interface TurnStepDetail {
  id: string;
  kind: TurnActivityStep["kind"];
  text?: string;
  args?: string;
  output?: string;
  output_offset?: number;
  output_chars?: number;
  truncated: boolean;
}

/** Full (bounded, paged) content for one step of a settled turn. */
export function projectTurnStepDetail(turn: DurableTurnEntries, stepId: string, offset = 0): TurnStepDetail | null {
  const [kind, ...rest] = stepId.split(":");
  if (kind === "tool") {
    const callId = rest.join(":");
    let args: string | undefined, output: string | undefined;
    for (const entry of turn.entries) {
      const message = first(entry);
      if (entry.kind === "pi.assistant") {
        const call = blocks(message).find((block) => block.type === "toolCall" && block.id === callId);
        if (call) args = argsText(call.arguments);
      } else if (entry.kind === "pi.tool-result" && message?.toolCallId === callId) output = resultText(message);
    }
    if (args === undefined) return null;
    const start = Math.max(0, Math.min(offset, output?.length ?? 0));
    const page = output?.slice(start, start + DETAIL_LIMIT) ?? "";
    return { id: stepId, kind: "tool", args: clip(args, DETAIL_LIMIT), output: page, output_offset: start,
      output_chars: output?.length ?? 0, truncated: start + page.length < (output?.length ?? 0) };
  }
  const entryId = Number(rest[0]);
  const entry = turn.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return null;
  let text: string | undefined;
  if (kind === "input") {
    const content = first(entry)?.content;
    if (entry.kind === "host.accepted" && typeof content === "string") text = content;
  } else if (kind === "thinking" || kind === "text") {
    const block = blocks(first(entry))[Number(rest[1])];
    text = kind === "thinking" ? block?.thinking : block?.text;
    if (block?.type !== kind) text = undefined;
  }
  if (text === undefined) return null;
  return { id: stepId, kind: kind as TurnActivityStep["kind"], text: clip(text, DETAIL_LIMIT), truncated: text.length > DETAIL_LIMIT };
}
