// Self-isolating: forces PICLAW_DB_IN_MEMORY=1 via shared test helpers
import "../helpers.js";

import { beforeAll, describe, expect, test } from "bun:test";
import { getDb, initDatabase } from "../../src/db/connection.js";
import { getMessageByRowId } from "../../src/db/messages.js";
import { projectTurnActivity, projectTurnStepDetail } from "../../src/channels/web/agent/turn-activity.js";
import { answerEntryIdFromMessageId, handleTurnActivity } from "../../src/channels/web/handlers/turn-activity.js";
import type { DurableTurnEntries } from "../../src/agent-pool/durable-runtime-adapter.js";

const assistant = (id: number, task: number, content: unknown[], stopReason = "toolUse", output = 10) =>
  ({ id, kind: "pi.assistant", byTaskId: task, model: [{ role: "assistant", content, stopReason, usage: { output }, timestamp: id }] });
const result = (id: number, task: number, callId: string, toolName: string, content: unknown[], extra: Record<string, unknown> = {}) =>
  ({ id, kind: "pi.tool-result", byTaskId: task, model: [{ role: "toolResult", toolCallId: callId, toolName, content, isError: false, ...extra }] });

function sampleTurn(): DurableTurnEntries {
  return {
    truncated: false,
    entries: [
      { id: 1, kind: "host.accepted", model: [{ role: "user", content: "do the thing" }] },
      assistant(2, 20, [
        { type: "thinking", thinking: "Plan: run the tests." },
        { type: "text", text: "Running the tests first." },
        { type: "toolCall", id: "call-a", name: "bash", arguments: { command: "bun test" } },
        { type: "toolCall", id: "call-b", name: "read", arguments: { path: "/tmp/a.txt" } },
      ]),
      result(3, 30, "call-a", "bash", [{ type: "text", text: "line1\nline2\n" + "x".repeat(2000) }], { durationMs: 4000 }),
      result(4, 31, "call-b", "read", [{ type: "text", text: "nope" }], { isError: true, durationMs: 50 }),
      { id: 5, kind: "host.accepted", model: [{ role: "user", content: "also check lint" }] },
      assistant(6, 21, [{ type: "toolCall", id: "call-c", name: "codemode", arguments: { code: "await tools.read({})" } }]),
      result(7, 32, "call-c", "codemode", [{ type: "image", data: "AAAA", mimeType: "image/png" }],
        { durationMs: 900, details: { calls: [{ id: 1, name: "read", args: "{\"path\":\"/w/x.ts\"}", status: "ok", durationMs: 5 }, { id: 2, name: "bash", args: "{}", status: "error", durationMs: 7 }] } }),
      assistant(8, 22, [{ type: "thinking", thinking: "Done." }, { type: "text", text: "All finished." }], "stop", 40),
    ],
    tasks: {
      20: { kind: "pi.generation", startedAt: 1_000, endedAt: 2_000, outcome: "completed" },
      30: { kind: "pi.tool", startedAt: 2_000, endedAt: 6_000, outcome: "completed" },
      31: { kind: "pi.tool", startedAt: 2_000, endedAt: 2_050, outcome: "failed" },
      21: { kind: "pi.generation", startedAt: 6_000, endedAt: 7_000, outcome: "completed" },
      32: { kind: "pi.tool", startedAt: 7_000, endedAt: 7_900, outcome: "completed" },
      22: { kind: "pi.generation", startedAt: 7_900, endedAt: 9_000, outcome: "completed" },
    },
  };
}

describe("turn activity projection", () => {
  test("orders thinking, commentary, steering and tool steps and keeps the final answer in the post", () => {
    const activity = projectTurnActivity(sampleTurn(), 8);
    expect(activity.steps.map((step) => step.id)).toEqual([
      "thinking:2:0", "text:2:1", "tool:call-a", "tool:call-b", "input:5", "tool:call-c", "thinking:8:0",
    ]);
    expect(activity.steps.some((step) => step.text === "All finished.")).toBe(false);
    expect(activity.duration_ms).toBe(8_000);
    expect(activity.output_tokens).toBe(60);
    expect(activity.tools).toBe(3);
    expect(activity.errors).toBe(1);
    // Parallel calls count once: [2000,6000) ∪ [2000,2050) ∪ [7000,7900).
    expect(activity.tool_ms).toBe(4_900);
  });

  test("summarises tools with bounded previews, image counts and nested code-mode calls", () => {
    const activity = projectTurnActivity(sampleTurn(), 8);
    const [bash, read, codemode] = activity.steps.filter((step) => step.kind === "tool").map((step) => step.tool!);
    expect(bash.title).toBe("bash: bun test");
    expect(bash.status).toBe("ok");
    expect(bash.duration_ms).toBe(4_000);
    expect(bash.output_chars).toBe(2012);
    expect(bash.output_lines).toBe(3);
    expect(bash.output_preview.length).toBeLessThanOrEqual(801);
    expect(read.status).toBe("error");
    expect(codemode.images).toBe(1);
    expect(JSON.stringify(codemode)).not.toContain("AAAA");
    expect(codemode.nested?.map((call) => [call.title, call.status])).toEqual([["read: /w/x.ts", "ok"], ["bash", "error"]]);
  });

  test("marks unanswered tool calls as running and aborted tasks as aborted", () => {
    const turn = sampleTurn();
    const entries = turn.entries.filter((entry) => entry.id !== 4);
    const activity = projectTurnActivity({ ...turn, entries, tasks: { ...turn.tasks, 30: { ...turn.tasks[30]!, outcome: "aborted" } } }, 8);
    const tools = activity.steps.filter((step) => step.kind === "tool").map((step) => step.tool!);
    expect(tools[0]!.status).toBe("aborted");
    expect(tools[1]!.status).toBe("running");
  });

  test("reads full step detail with output paging", () => {
    const turn = sampleTurn();
    const tool = projectTurnStepDetail(turn, "tool:call-a", 6);
    expect(tool?.args).toContain("\"command\": \"bun test\"");
    expect(tool?.output?.startsWith("line2")).toBe(true);
    expect(tool?.output_offset).toBe(6);
    expect(tool?.output_chars).toBe(2012);
    expect(projectTurnStepDetail(turn, "thinking:2:0")?.text).toBe("Plan: run the tests.");
    expect(projectTurnStepDetail(turn, "input:5")?.text).toBe("also check lint");
    expect(projectTurnStepDetail(turn, "thinking:2:1")).toBeNull();
    expect(projectTurnStepDetail(turn, "tool:missing")).toBeNull();
  });
});

describe("GET /agent/turn-activity", () => {
  const chat = "web:turn-activity";
  let replyId = "", legacyId = "", userId = "";
  beforeAll(() => {
    initDatabase();
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO chats(jid, name) VALUES (?, ?)").run(chat, chat);
    const insert = (id: string, bot: number) => String(db.prepare(`INSERT INTO messages(id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, is_terminal_agent_reply)
      VALUES (?, ?, 'web-agent', 'agent', 'text', '2026-11-11T00:00:00.000Z', 0, ?, ?)`).run(id, chat, bot, bot).lastInsertRowid);
    replyId = insert("native-answer:inc:7:8", 1);
    legacyId = insert("legacy-reply", 1);
    userId = insert("native-answer:inc:7:9", 0);
  });

  test("flags durable replies for on-demand activity", () => {
    expect(getMessageByRowId(chat, Number(replyId))?.data.turn_activity).toBe(true);
    expect(getMessageByRowId(chat, Number(legacyId))?.data.turn_activity).toBeUndefined();
    expect(getMessageByRowId(chat, Number(userId))?.data.turn_activity).toBeUndefined();
  });
  const request = (params: Record<string, string>) => new URL(`http://local/agent/turn-activity?${new URLSearchParams(params)}`);

  test("parses only native answer ids", () => {
    expect(answerEntryIdFromMessageId("native-answer:inc:7:8")).toBe(8);
    expect(answerEntryIdFromMessageId("web-123")).toBeNull();
    expect(answerEntryIdFromMessageId("native-answer:inc:7:0")).toBeNull();
  });

  test("returns the projection for a stored reply and one step on request", async () => {
    const seen: Array<[string, number]> = [];
    const pool = { getTurnEntriesForChat: async (jid: string, answer: number) => { seen.push([jid, answer]); return sampleTurn(); } };
    const list = await handleTurnActivity(pool, request({ chat_jid: chat, message_id: replyId }));
    expect(list.status).toBe(200);
    expect((await list.json()).tools).toBe(3);
    const step = await handleTurnActivity(pool, request({ chat_jid: chat, message_id: replyId, step: "tool:call-b" }));
    expect((await step.json()).output).toBe("nope");
    expect(seen).toEqual([[chat, 8], [chat, 8]]);
  });

  test("answers 400 for missing parameters and a uniform 404 otherwise", async () => {
    const pool = { getTurnEntriesForChat: async () => sampleTurn() };
    expect((await handleTurnActivity(pool, request({ chat_jid: chat }))).status).toBe(400);
    for (const [params, reader] of [
      [{ chat_jid: "web:other", message_id: replyId }, pool],
      [{ chat_jid: chat, message_id: "native-answer:inc:7:8" }, pool],
      [{ chat_jid: chat, message_id: legacyId }, pool],
      [{ chat_jid: chat, message_id: userId }, pool],
      [{ chat_jid: chat, message_id: replyId }, { getTurnEntriesForChat: async () => null }],
      [{ chat_jid: chat, message_id: replyId }, { getTurnEntriesForChat: async () => { throw new Error("Host binding conflict"); } }],
      [{ chat_jid: chat, message_id: replyId }, undefined],
      [{ chat_jid: chat, message_id: replyId, step: "tool:missing" }, pool],
    ] as const) {
      const response = await handleTurnActivity(reader as never, request(params as Record<string, string>));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });
});
