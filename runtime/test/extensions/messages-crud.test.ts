/**
 * test/extensions/messages-crud.test.ts – Tests for the unified messages tool.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";
import { withChatContext } from "../../src/core/chat-context.js";

let restoreEnv: (() => void) | null = null;

function makeFakeApi() {
  const tools = new Map<string, any>();
  return {
    api: {
      on() {},
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
      registerCommand() {},
      registerShortcut() {},
      registerFlag() {},
      getFlag() { return undefined; },
      registerMessageRenderer() {},
      sendMessage() {},
      sendUserMessage() {},
      appendEntry() {},
      setSessionName() {},
      getSessionName() { return undefined; },
      setLabel() {},
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools() {},
      getCommands: () => [],
      setModel: async () => true,
      getThinkingLevel: () => "off" as const,
      setThinkingLevel() {},
      registerProvider() {},
      unregisterProvider() {},
    } as unknown as ExtensionAPI,
    tools,
  };
}

describe("messages tool extension", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let db: typeof import("../../src/db.js");
  let chatJid = "web:test";

  beforeEach(async () => {
    ws = createTempWorkspace("piclaw-messages-crud-");
    chatJid = `web:test-${Math.random().toString(36).slice(2, 10)}`;
    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
      PICLAW_DB_IN_MEMORY: "1",
    });
    db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    db.initDatabase();
    db.storeChatMetadata(chatJid, new Date().toISOString(), "Web");
  });

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = null;
    ws.cleanup();
  });

  function insertMessage(content: string, overrides: Record<string, any> = {}) {
    const id = `msg-${Math.random().toString(36).slice(2, 10)}`;
    return db.storeMessage({
      id,
      chat_jid: chatJid,
      sender: "user",
      sender_name: "Alice",
      content,
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: false,
      ...overrides,
    });
  }

  async function getTool() {
    const { messagesCrud } = await importFresh<typeof import("../src/extensions/messages-crud.js")>("../src/extensions/messages-crud.js");
    const fake = makeFakeApi();
    messagesCrud(fake.api);
    return {
      tool: fake.tools.get("messages")!,
    };
  }

  async function runWithContext(tool: any, params: Record<string, unknown>) {
    return withChatContext(chatJid, "web", () => tool.execute("x", params));
  }

  test("registers the messages tool", async () => {
    const { tool } = await getTool();
    expect(tool).toBeDefined();
    expect(tool.name).toBe("messages");
  });

  test("search returns empty when no query", async () => {
    const { tool } = await getTool();
    const result = await runWithContext(tool, {});
    expect(result.content[0].text).toContain("Provide query for action=search");
    expect(result.details.count).toBe(0);
  });

  test("search supports FTS and returns created_at", async () => {
    insertMessage("The weather is sunny today");
    insertMessage("Another message with rain");

    const { tool } = await getTool();
    const result = await runWithContext(tool, { action: "search", query: "sunny" });
    expect(result.details.action).toBe("search");
    expect(result.details.count).toBe(1);
    expect(result.details.results[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.details.results[0].content).toContain("sunny");
  });

  test("search/get include persisted content_blocks payloads", async () => {
    insertMessage("Message with blocks", { content_blocks: [{ type: "adaptive_card", card_id: "ticket" }] });

    const { tool } = await getTool();
    const search = await runWithContext(tool, { action: "search", query: "Message with blocks" });
    expect(search.details.count).toBe(1);
    expect(Array.isArray(search.details.results[0].content_blocks)).toBe(true);
    expect(search.details.results[0].content_blocks).toEqual([
      { type: "adaptive_card", card_id: "ticket" },
    ]);

    const rowId = search.details.results[0].rowid;
    const get = await runWithContext(tool, { action: "get", row_ids: [rowId] });
    expect(get.details.count).toBe(1);
    expect(Array.isArray(get.details.messages[0].message.content_blocks)).toBe(true);
    expect(get.details.messages[0].message.content_blocks).toEqual([
      { type: "adaptive_card", card_id: "ticket" },
    ]);
  });

  test("search supports wildcard all-rows query", async () => {
    insertMessage("alpha message");
    insertMessage("beta message");
    insertMessage("gamma message");

    const { tool } = await getTool();
    const result = await runWithContext(tool, { action: "search", query: "*", limit: 5 });
    expect(result.details.action).toBe("search");
    expect(result.details.count).toBe(3);
  });

  test("search supports hashtag lookup", async () => {
    insertMessage("Working on #project-alpha today");
    insertMessage("No hashtag here");

    const { tool } = await getTool();
    const result = await runWithContext(tool, { action: "search", query: "#project-alpha" });
    expect(result.details.count).toBe(1);
    expect(result.details.results[0].content).toContain("project-alpha");
  });

  test("search returns no match", async () => {
    const { tool } = await getTool();
    const result = await runWithContext(tool, { action: "search", query: "does-not-exist-xyz" });
    expect(result.content[0].text).toContain("No matching messages");
    expect(result.details.count).toBe(0);
  });

  test("search respects limit and role filter", async () => {
    insertMessage("Message number one", { sender_name: "User", is_bot_message: false });
    insertMessage("Message number two", { sender_name: "User", is_bot_message: false });
    insertMessage("Assistant says hi", { sender: "assistant", sender_name: "Pi", is_bot_message: true });

    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "search",
      query: "Message number",
      limit: 2,
      offset: 0,
      role: "user",
    });
    expect(result.details.count).toBe(2);
    expect(result.details.limit).toBe(2);
    expect(result.details.results.every((row: any) => row.is_bot_message === 0)).toBe(true);
  });

  test("search truncates content with details_max_chars", async () => {
    insertMessage("The quick brown fox ".repeat(25));
    const { tool } = await getTool();
    const result = await runWithContext(tool, { action: "search", query: "quick brown fox", details_max_chars: 50 });
    expect(result.details.results[0].content.length).toBeLessThanOrEqual(50);
    expect(result.details.results[0].content_truncated).toBe(true);
    expect(result.details.results[0].content_full_length).toBeGreaterThan(50);
  });

  test("search supports row bounds and sender filtering", async () => {
    const row1 = insertMessage("checkpoint alpha", { sender: "web-user", sender_name: "Alice" });
    const row2 = insertMessage("checkpoint beta", { sender: "assistant", sender_name: "Pi", is_bot_message: true });
    const row3 = insertMessage("checkpoint gamma", { sender: "web-user", sender_name: "Alice" });

    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "search",
      query: "checkpoint",
      after_row: row1,
      before_row: row3,
      sender: "Pi",
    });

    expect(result.details.count).toBe(1);
    expect(result.details.results[0].rowid).toBe(row2);
    expect(result.details.results[0].sender_name).toBe("Pi");
  });

  test("search returns highlighted excerpts when requested", async () => {
    insertMessage("prefix text before unique-token-123 and then a lot more trailing content for excerpt coverage");

    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "search",
      query: "unique-token-123",
      excerpt_chars: 30,
      details_max_chars: 200,
    });

    expect(result.details.count).toBe(1);
    expect(result.details.results[0].content_excerpt).toContain("[[unique-token-123]]");
    expect(result.content[0].text).toContain("[[unique-token-123]]");
  });

  test("get supports context_before/context_after", async () => {
    insertMessage("before message one");
    insertMessage("before message two");
    insertMessage("target message body");
    insertMessage("after message one");

    const { tool } = await getTool();
    const search = await runWithContext(tool, { action: "search", query: "target message body" });
    const rowId = search.details.results[0].rowid;

    const result = await runWithContext(tool, {
      action: "get",
      row_ids: [rowId],
      context_before: 2,
      context_after: 1,
      details_max_chars: 200,
    });

    expect(result.details.count).toBe(1);
    expect(result.details.messages[0].message.content).toContain("target message body");
    expect(result.details.messages[0].context_before).toHaveLength(2);
    expect(result.details.messages[0].context_after).toHaveLength(1);
    expect(result.details.messages[0].context_before[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.content[0].text).toContain("target message body");
    expect(result.content[0].text).toContain("before message two");
    expect(result.content[0].text).toContain("after message one");
  });

  test("get supports content_lines and content_grep", async () => {
    insertMessage("line one\nerror: first issue\nline three\nerror: second issue\nline five");

    const { tool } = await getTool();
    const search = await runWithContext(tool, { action: "search", query: "first issue" });
    const rowId = search.details.results[0].rowid;
    const result = await runWithContext(tool, {
      action: "get",
      row_ids: [rowId],
      content_lines: "2-4",
      content_grep: "error",
      details_max_chars: 200,
    });

    expect(result.details.count).toBe(1);
    expect(result.details.messages[0].line_view).toEqual({
      total_lines: 5,
      selected_start: 2,
      selected_end: 4,
      grep: "error",
      match_count: 2,
      lines: [
        { line_number: 2, content: "error: first issue" },
        { line_number: 4, content: "error: second issue" },
      ],
    });
    expect(result.content[0].text).toContain("2| error: first issue");
    expect(result.content[0].text).toContain("4| error: second issue");
    expect(result.content[0].text).not.toContain("3| line three");
  });

  test("grep returns matching lines with bounded context", async () => {
    insertMessage("alpha\nerror: first issue\nbeta\nerror: second issue\ngamma");
    insertMessage("totally unrelated");

    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "grep",
      pattern: "error",
      context_lines: 1,
      max_matches: 10,
      details_max_chars: 200,
    });

    expect(result.details.action).toBe("grep");
    expect(result.details.count).toBe(1);
    expect(result.details.matching_lines).toBe(2);
    expect(result.details.results[0].line_view).toEqual({
      total_lines: 5,
      context_lines: 1,
      match_count: 2,
      lines: [
        { line_number: 1, content: "alpha", matched: false },
        { line_number: 2, content: "error: first issue", matched: true },
        { line_number: 3, content: "beta", matched: false },
        { line_number: 4, content: "error: second issue", matched: true },
        { line_number: 5, content: "gamma", matched: false },
      ],
    });
    expect(result.content[0].text).toContain("> 2| error: first issue");
    expect(result.content[0].text).toContain("> 4| error: second issue");
  });

  test("extract supports regex capture groups, dedupe, and sorting", async () => {
    const firstRow = insertMessage("pc=0x1234 and pc=0x9999");
    insertMessage("pc=0x5678");
    insertMessage("pc=0x1234 again");

    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "extract",
      pattern: "pc=(0x[0-9a-f]+)",
      regex: true,
      capture_group: 1,
      dedupe: true,
      sort: "asc",
      max_matches: 10,
    });

    expect(result.details.action).toBe("extract");
    expect(result.details.count).toBe(3);
    expect(result.details.values.map((item: any) => item.value)).toEqual(["0x1234", "0x5678", "0x9999"]);
    expect(result.details.values[0]).toMatchObject({
      value: "0x1234",
      count: 2,
      first_seen_rowid: firstRow,
    });
    expect(result.content[0].text).toContain("0x1234 (2)");
  });

  test("diff summarizes changes since a checkpoint row", async () => {
    const checkpoint = insertMessage("checkpoint baseline", { sender: "web-user", sender_name: "Alice" });
    const userRow = insertMessage("follow-up from user", { sender: "web-user", sender_name: "Alice" });
    const assistantRow = insertMessage("assistant reply", { sender: "assistant", sender_name: "Pi", is_bot_message: true });
    insertMessage("later ignored by before_row", { sender: "web-user", sender_name: "Alice" });

    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "diff",
      after_row: checkpoint,
      before_row: assistantRow + 1,
      details_max_chars: 200,
    });

    expect(result.details.action).toBe("diff");
    expect(result.details.count).toBe(2);
    expect(result.details.summary).toEqual({
      checkpoint_after_row: checkpoint,
      checkpoint_before_row: assistantRow + 1,
      checkpoint_after: null,
      checkpoint_before: null,
      first_rowid: userRow,
      last_rowid: assistantRow,
      user_count: 1,
      assistant_count: 1,
      sender_counts: [
        { sender: "Alice", count: 1 },
        { sender: "Pi", count: 1 },
      ],
    });
    expect(result.details.messages.map((row: any) => row.rowid)).toEqual([userRow, assistantRow]);
    expect(result.content[0].text).toContain(`Rows ${userRow}–${assistantRow}`);
    expect(result.content[0].text).toContain("User 1, assistant 1");
  });

  test("get missing row_ids are reported", async () => {
    const { tool } = await getTool();
    const result = await runWithContext(tool, { action: "get", row_ids: [999999] });
    expect(result.details.count).toBe(0);
    expect(result.details.missing_row_ids).toContain(999999);
  });

  test("add stores a new row", async () => {
    const content = "Newly added message";
    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "add",
      content,
      type: "agent",
    });

    expect(result.details.action).toBe("add");
    expect(result.details.inserted).toBe(1);

    const search = await runWithContext(tool, { action: "search", query: content, chat_jid: chatJid });
    expect(search.details.count).toBe(1);
  });

  test("add strips internal tags from agent content before storing", async () => {
    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "add",
      content: "before <internal>secret</internal> after",
      type: "agent",
    });

    expect(result.details.inserted).toBe(1);
    expect(result.details.message.content).toBe("before  after");

    const search = await runWithContext(tool, { action: "search", query: "before after", chat_jid: chatJid, details_max_chars: 200 });
    expect(search.details.count).toBe(1);
    expect(search.details.results[0].content).toBe("before  after");
  });

  test("add rejects agent content that becomes empty after stripping internal tags", async () => {
    const { tool } = await getTool();
    const result = await runWithContext(tool, {
      action: "add",
      content: "<internal>secret only</internal>",
      type: "agent",
    });

    expect(result.details.inserted).toBe(0);
    expect(result.content[0].text).toContain("No visible content remains");
  });

  test("delete supports dry_run and does not delete", async () => {
    const parent = insertMessage("Parent message");
    const child = insertMessage("Child message", { thread_id: parent });

    const { tool } = await getTool();
    const dry = await runWithContext(tool, {
      action: "delete",
      row_ids: [parent],
      dry_run: true,
      force: true,
    });

    expect(dry.details.action).toBe("delete");
    expect(dry.details.deleted_row_ids).toContain(parent);
    expect(dry.details.deleted_row_ids).toContain(child);
    expect(dry.details.count).toBe(2);

    const afterDry = await runWithContext(tool, { action: "search", query: "Parent message", chat_jid: chatJid });
    expect(afterDry.details.count).toBe(1);
  });

  test("delete removes threads when executed", async () => {
    const parent = insertMessage("Thread parent");
    const child = insertMessage("Thread child", { thread_id: parent });

    const { tool } = await getTool();
    const live = await runWithContext(tool, {
      action: "delete",
      row_ids: [parent],
      force: true,
    });
    expect(live.details.deleted_row_ids).toContain(parent);
    expect(live.details.deleted_row_ids).toContain(child);

    const verify = await runWithContext(tool, { action: "search", query: "Thread", chat_jid: chatJid });
    expect(verify.details.count).toBe(0);
  });

  test("delete skips media attached rows unless force", async () => {
    const rowId = insertMessage("Media protected");
    const mid = db.createMedia("test.txt", "text/plain", new TextEncoder().encode("hello"), null, { size: 5 });
    db.attachMediaToMessage(rowId, [mid]);

    const { tool } = await getTool();
    const result = await runWithContext(tool, { action: "delete", row_ids: [rowId] });

    expect(result.details.skipped_row_ids).toContain(rowId);
    expect(result.details.deleted_row_ids).not.toContain(rowId);

    const verify = await runWithContext(tool, { action: "search", query: "Media protected", chat_jid: chatJid });
    expect(verify.details.count).toBe(1);

    const forced = await runWithContext(tool, {
      action: "delete",
      row_ids: [rowId],
      force: true,
    });
    expect(forced.details.deleted_row_ids).toContain(rowId);
  });

  test("post with type=agent passes isBot=true to postFn", async () => {
    const { runMessagesTool } = await importFresh<typeof import("../src/extensions/messages-crud.js")>("../src/extensions/messages-crud.js");

    const calls: Array<{ chatJid: string; content: string; isBot: boolean; mediaIds: number[]; contentBlocks?: unknown[] }> = [];
    const fakePostFn = (cj: string, c: string, bot: boolean, mids: number[], cb?: unknown[]) => {
      calls.push({ chatJid: cj, content: c, isBot: bot, mediaIds: mids, contentBlocks: cb });
      return 99999;
    };

    const result = runMessagesTool(
      { action: "post", type: "agent", content: "Agent card message", content_blocks: [{ type: "adaptive_card", card_id: "test-abc" }] },
      chatJid,
      fakePostFn,
    );

    expect(result.details.posted).toBe(1);
    expect(result.details.row_id).toBe(99999);
    expect(calls).toHaveLength(1);
    expect(calls[0].isBot).toBe(true);
    expect(calls[0].content).toBe("Agent card message");
    expect(calls[0].contentBlocks).toEqual([{ type: "adaptive_card", card_id: "test-abc" }]);
  });

  test("post strips internal tags from agent content before broadcast", async () => {
    const { runMessagesTool } = await importFresh<typeof import("../src/extensions/messages-crud.js")>("../src/extensions/messages-crud.js");

    const calls: Array<{ content: string; isBot: boolean }> = [];
    const fakePostFn = (_cj: string, c: string, bot: boolean, _mids: number[], _cb?: unknown[]) => {
      calls.push({ content: c, isBot: bot });
      return 77777;
    };

    const result = runMessagesTool(
      { action: "post", type: "agent", content: "hello <internal>secret</internal> world" },
      chatJid,
      fakePostFn,
    );

    expect(result.details.posted).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ content: "hello  world", isBot: true });
  });

  test("post rejects agent content that becomes empty after stripping internal tags", async () => {
    const { runMessagesTool } = await importFresh<typeof import("../src/extensions/messages-crud.js")>("../src/extensions/messages-crud.js");

    const result = runMessagesTool(
      { action: "post", type: "agent", content: "<internal>secret only</internal>" },
      chatJid,
      () => 12345,
    );

    expect(result.details.posted).toBe(0);
    expect(result.content[0].text).toContain("No visible content remains");
  });

  test("post without type defaults to user (isBot=false)", async () => {
    const { runMessagesTool } = await importFresh<typeof import("../src/extensions/messages-crud.js")>("../src/extensions/messages-crud.js");

    const calls: Array<{ isBot: boolean }> = [];
    const fakePostFn = (_cj: string, _c: string, bot: boolean, _mids: number[], _cb?: unknown[]) => {
      calls.push({ isBot: bot });
      return 88888;
    };

    const result = runMessagesTool(
      { action: "post", content: "User message" },
      chatJid,
      fakePostFn,
    );

    expect(result.details.posted).toBe(1);
    expect(calls[0].isBot).toBe(false);
  });
});
