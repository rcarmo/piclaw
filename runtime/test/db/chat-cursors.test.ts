/**
 * test/db/chat-cursors.test.ts – Tests for per-chat cursor and inflight tracking.
 *
 * Validates the core guarantees of the chat_cursors table:
 *
 *   1. getChatCursor / setChatCursor – basic cursor reads and writes.
 *   2. beginChatRun – atomically advances cursor AND records inflight marker.
 *   3. endChatRun (success) – single UPDATE clears inflight AND failed_run.
 *   4. endChatRunWithError – single UPDATE clears inflight AND sets failed_run.
 *   5. getInflightRuns – only returns chats with an active inflight marker.
 *   6. rollbackInflightRun – restores cursor to prevTs, clears inflight.
 *   7. getFailedRun / clearFailedRun – failed-run record reads and writes.
 *   8. Normal-run lifecycle: begin → end → cursor advanced, no inflight,
 *      no failed_run, message not re-fetched.
 *   9. Error-run lifecycle: begin → endWithError → inflight cleared,
 *      failed_run set atomically, cursor stays advanced.
 *  10. Crash-recovery scenario: begin → (kill) → inflight found → rollback →
 *      cursor restored → message re-fetchable via getMessagesSince.
 *  11. Success clears stale failed_run atomically (no window of inconsistency).
 *  12. Multi-chat rollback inside a transaction: all-or-nothing atomicity.
 *  13. Partial-transaction failure leaves all rows unchanged.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { getTestWorkspace, setEnv } from "../helpers.js";

let db: typeof import("../../src/db.js");

/** Unique JID per test to avoid cross-test pollution in the shared DB. */
const jid = (suffix: string) => `cursors:${suffix}`;

/** Store a bare user message and return its ID. */
function storeMsg(chatJid: string, ts: string): string {
  const id = `msg-${Math.random().toString(36).slice(2, 10)}`;
  db.storeChatMetadata(chatJid, ts);
  db.storeMessage({
    id,
    chat_jid: chatJid,
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: ts,
    is_from_me: false,
    is_bot_message: false,
  });
  return id;
}

beforeAll(async () => {
  const ws = getTestWorkspace();
  setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  db = await import("../../src/db.js");
  db.initDatabase();
});

// ---------------------------------------------------------------------------
// getChatCursor / setChatCursor
// ---------------------------------------------------------------------------

describe("getChatCursor", () => {
  test("returns empty string for a chat that has never been seen", () => {
    expect(db.getChatCursor(jid("get-unknown"))).toBe("");
  });

  test("returns the value written by setChatCursor", () => {
    const chatJid = jid("get-set");
    db.setChatCursor(chatJid, "2024-01-01T00:00:00.000Z");
    expect(db.getChatCursor(chatJid)).toBe("2024-01-01T00:00:00.000Z");
  });

  test("returns the most recent value after multiple setChatCursor calls", () => {
    const chatJid = jid("get-overwrite");
    db.setChatCursor(chatJid, "2024-01-01T00:00:00.000Z");
    db.setChatCursor(chatJid, "2024-06-15T12:00:00.000Z");
    expect(db.getChatCursor(chatJid)).toBe("2024-06-15T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// getAllChatCursors
// ---------------------------------------------------------------------------

describe("getAllChatCursors", () => {
  test("includes cursors written with setChatCursor", () => {
    const chatJid = jid("all-basic");
    db.setChatCursor(chatJid, "2024-02-01T00:00:00.000Z");
    expect(db.getAllChatCursors()[chatJid]).toBe("2024-02-01T00:00:00.000Z");
  });

  test("includes cursors created by beginChatRun", () => {
    const chatJid = jid("all-begin");
    db.beginChatRun(chatJid, "2024-03-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "m-1",
      startedAt: "2024-03-01T00:00:00.001Z",
    });
    expect(db.getAllChatCursors()[chatJid]).toBe("2024-03-01T00:00:00.000Z");
    db.endChatRun(chatJid);
  });
});

// ---------------------------------------------------------------------------
// deferred queued follow-ups
// ---------------------------------------------------------------------------

describe("deferred queued follow-ups", () => {
  test("round-trips deferred queued items through chat_cursors", () => {
    const chatJid = jid("deferred-basic");
    db.setDeferredQueuedFollowups(chatJid, [{
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
      mediaIds: [1, 2],
      contentBlocks: [{ type: "markdown", text: "queued" }],
      linkPreviews: [{ url: "https://example.com" }],
    }]);

    expect(db.getDeferredQueuedFollowups(chatJid)).toEqual([{ 
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
      mediaIds: [1, 2],
      contentBlocks: [{ type: "markdown", text: "queued" }],
      linkPreviews: [{ url: "https://example.com" }],
      materializeRetries: 0,
    }]);
  });

  test("survives begin/end run state transitions", () => {
    const chatJid = jid("deferred-survives-run");
    db.setDeferredQueuedFollowups(chatJid, [{
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
    }]);

    db.beginChatRun(chatJid, "2024-03-11T00:00:00.000Z", {
      prevTs: "",
      messageId: "m-queued",
      startedAt: "2024-03-11T00:00:00.001Z",
    });
    db.endChatRun(chatJid);

    expect(db.getDeferredQueuedFollowups(chatJid)).toEqual([{
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
      materializeRetries: 0,
    }]);
  });
});

// ---------------------------------------------------------------------------
// compaction backoff state
// ---------------------------------------------------------------------------

describe("chat compaction backoff", () => {
  test("round-trips persisted compaction backoff state", () => {
    const chatJid = jid("compaction-backoff-basic");
    db.setChatCompactionBackoff(chatJid, {
      failureCount: 2,
      lastFailedAt: "2024-03-15T00:00:00.000Z",
      backoffUntil: "2024-03-15T00:30:00.000Z",
      lastErrorMessage: "Compaction timed out",
    });

    expect(db.getChatCompactionBackoff(chatJid)).toEqual({
      chatJid,
      failureCount: 2,
      lastFailedAt: "2024-03-15T00:00:00.000Z",
      backoffUntil: "2024-03-15T00:30:00.000Z",
      lastErrorMessage: "Compaction timed out",
    });
  });

  test("clearChatCompactionBackoff removes persisted suppression state", () => {
    const chatJid = jid("compaction-backoff-clear");
    db.setChatCompactionBackoff(chatJid, {
      failureCount: 1,
      lastFailedAt: "2024-03-16T00:00:00.000Z",
      backoffUntil: "2024-03-16T00:15:00.000Z",
      lastErrorMessage: "Compaction failed",
    });

    db.clearChatCompactionBackoff(chatJid);
    expect(db.getChatCompactionBackoff(chatJid)).toBeNull();
  });

  test("active compaction markers persist and clear independently of backoff", () => {
    const chatJid = jid("active-compaction");
    db.markChatCompactionActive(chatJid, "2024-03-17T00:00:00.000Z", "recovery");

    expect(db.getActiveChatCompactions().filter((entry) => entry.chatJid === chatJid)).toEqual([
      {
        chatJid,
        startedAt: "2024-03-17T00:00:00.000Z",
        reason: "recovery",
      },
    ]);

    db.setChatCompactionBackoff(chatJid, {
      failureCount: 1,
      lastFailedAt: "2024-03-17T00:04:00.000Z",
      backoffUntil: "2024-03-17T04:04:00.000Z",
      lastErrorMessage: "stale recovery compaction",
    });
    expect(db.getActiveChatCompactions().some((entry) => entry.chatJid === chatJid)).toBe(true);

    db.clearChatCompactionActive(chatJid);
    expect(db.getActiveChatCompactions().some((entry) => entry.chatJid === chatJid)).toBe(false);
    expect(db.getChatCompactionBackoff(chatJid)?.lastErrorMessage).toBe("stale recovery compaction");
  });
});

// ---------------------------------------------------------------------------
// beginChatPreflight / promoteChatPreflightToInflight
// ---------------------------------------------------------------------------

describe("chat preflight lifecycle", () => {
  test("records preflight without advancing the cursor", () => {
    const chatJid = jid("preflight-basic");
    db.setChatCursor(chatJid, "2024-03-20T00:00:00.000Z");

    db.beginChatPreflight(chatJid, {
      prevTs: "2024-03-20T00:00:00.000Z",
      messageId: "msg-preflight-1",
      startedAt: "2024-03-20T00:00:00.001Z",
    });

    expect(db.getChatCursor(chatJid)).toBe("2024-03-20T00:00:00.000Z");
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
    expect(db.getPreflightRuns().filter((r) => r.chatJid === chatJid)).toEqual([
      {
        chatJid,
        prevTs: "2024-03-20T00:00:00.000Z",
        messageId: "msg-preflight-1",
        startedAt: "2024-03-20T00:00:00.001Z",
      },
    ]);

    db.clearChatPreflight(chatJid);
  });

  test("promotes preflight into inflight state in one step", () => {
    const chatJid = jid("preflight-promote");
    db.setChatCursor(chatJid, "2024-03-21T00:00:00.000Z");

    db.beginChatPreflight(chatJid, {
      prevTs: "2024-03-21T00:00:00.000Z",
      messageId: "msg-preflight-2",
      startedAt: "2024-03-21T00:00:00.001Z",
    });
    db.promoteChatPreflightToInflight(chatJid, "2024-03-21T00:01:00.000Z", {
      prevTs: "2024-03-21T00:00:00.000Z",
      messageId: "msg-preflight-2",
      startedAt: "2024-03-21T00:00:00.001Z",
    });

    expect(db.getPreflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
    expect(db.getChatCursor(chatJid)).toBe("2024-03-21T00:01:00.000Z");
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toEqual([
      {
        chatJid,
        prevTs: "2024-03-21T00:00:00.000Z",
        messageId: "msg-preflight-2",
        startedAt: "2024-03-21T00:00:00.001Z",
      },
    ]);

    db.endChatRun(chatJid);
  });
});

// ---------------------------------------------------------------------------
// beginChatRun
// ---------------------------------------------------------------------------

describe("beginChatRun", () => {
  test("advances cursor and records all inflight fields in one write", () => {
    const chatJid = jid("begin-atomic");
    db.setChatCursor(chatJid, "2024-01-01T00:00:00.000Z");

    db.beginChatRun(chatJid, "2024-01-02T00:00:00.000Z", {
      prevTs: "2024-01-01T00:00:00.000Z",
      messageId: "msg-begin-1",
      startedAt: "2024-01-02T00:00:00.001Z",
    });

    expect(db.getChatCursor(chatJid)).toBe("2024-01-02T00:00:00.000Z");

    const [inflight] = db.getInflightRuns().filter((r) => r.chatJid === chatJid);
    expect(inflight).toBeDefined();
    expect(inflight.prevTs).toBe("2024-01-01T00:00:00.000Z");
    expect(inflight.messageId).toBe("msg-begin-1");
    expect(inflight.startedAt).toBe("2024-01-02T00:00:00.001Z");

    db.endChatRun(chatJid);
  });

  test("creates a new row when no prior cursor exists", () => {
    const chatJid = jid("begin-fresh");
    db.beginChatRun(chatJid, "2024-04-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "msg-fresh",
      startedAt: "2024-04-01T00:00:00.001Z",
    });
    expect(db.getChatCursor(chatJid)).toBe("2024-04-01T00:00:00.000Z");
    db.endChatRun(chatJid);
  });

  test("overwrites an existing inflight marker (re-entrant safety)", () => {
    const chatJid = jid("begin-reentrant");
    db.beginChatRun(chatJid, "2024-05-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "first-msg",
      startedAt: "2024-05-01T00:00:00.001Z",
    });
    db.beginChatRun(chatJid, "2024-05-02T00:00:00.000Z", {
      prevTs: "2024-05-01T00:00:00.000Z",
      messageId: "second-msg",
      startedAt: "2024-05-02T00:00:00.001Z",
    });

    expect(db.getChatCursor(chatJid)).toBe("2024-05-02T00:00:00.000Z");
    const inflights = db.getInflightRuns().filter((r) => r.chatJid === chatJid);
    expect(inflights).toHaveLength(1);
    expect(inflights[0].messageId).toBe("second-msg");
    db.endChatRun(chatJid);
  });
});

// ---------------------------------------------------------------------------
// endChatRun (success path)
// ---------------------------------------------------------------------------

describe("endChatRun", () => {
  test("clears inflight and leaves cursor unchanged", () => {
    const chatJid = jid("end-basic");
    db.beginChatRun(chatJid, "2024-06-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "msg-end",
      startedAt: "2024-06-01T00:00:00.001Z",
    });
    db.endChatRun(chatJid);

    expect(db.getChatCursor(chatJid)).toBe("2024-06-01T00:00:00.000Z");
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
  });

  test("clears a stale failed_run record in the same UPDATE", () => {
    const chatJid = jid("end-clears-failed");
    // Simulate a previous failed run
    db.beginChatRun(chatJid, "2024-07-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "msg-prev",
      startedAt: "2024-07-01T00:00:00.001Z",
    });
    db.endChatRunWithError(chatJid, {
      prevTs: "",
      failedTs: "2024-07-01T00:00:00.000Z",
      messageId: "msg-prev",
      threadRootId: null,
      createdAt: "2024-07-01T00:00:00.002Z",
    });
    expect(db.getFailedRun(chatJid)).toBeDefined();

    // Successful retry
    db.beginChatRun(chatJid, "2024-07-02T00:00:00.000Z", {
      prevTs: "2024-07-01T00:00:00.000Z",
      messageId: "msg-retry",
      startedAt: "2024-07-02T00:00:00.001Z",
    });
    db.endChatRun(chatJid);

    // Both inflight and failed_run cleared in the same single UPDATE
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
    expect(db.getFailedRun(chatJid)).toBeUndefined();
  });

  test("is a no-op on a chat with no inflight (safe to call twice)", () => {
    const chatJid = jid("end-noop");
    db.setChatCursor(chatJid, "2024-07-01T00:00:00.000Z");
    db.endChatRun(chatJid);
    expect(db.getChatCursor(chatJid)).toBe("2024-07-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// endChatRunWithError
// ---------------------------------------------------------------------------

describe("endChatRunWithError", () => {
  test("clears inflight and sets failed_run in a single write", () => {
    const chatJid = jid("end-error-atomic");
    db.beginChatRun(chatJid, "2024-08-01T00:00:00.000Z", {
      prevTs: "2024-07-31T00:00:00.000Z",
      messageId: "msg-fail",
      startedAt: "2024-08-01T00:00:00.001Z",
    });

    db.endChatRunWithError(chatJid, {
      prevTs: "2024-07-31T00:00:00.000Z",
      failedTs: "2024-08-01T00:00:00.000Z",
      messageId: "msg-fail",
      threadRootId: 42,
      createdAt: "2024-08-01T00:00:00.002Z",
    });

    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);

    const failed = db.getFailedRun(chatJid);
    expect(failed).toBeDefined();
    expect(failed!.prevTs).toBe("2024-07-31T00:00:00.000Z");
    expect(failed!.failedTs).toBe("2024-08-01T00:00:00.000Z");
    expect(failed!.messageId).toBe("msg-fail");
    expect(failed!.threadRootId).toBe(42);
    expect(db.getChatCursor(chatJid)).toBe("2024-08-01T00:00:00.000Z");
  });

  test("null threadRootId is preserved correctly", () => {
    const chatJid = jid("end-error-null-thread");
    db.beginChatRun(chatJid, "2024-09-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "msg-null-thread",
      startedAt: "2024-09-01T00:00:00.001Z",
    });
    db.endChatRunWithError(chatJid, {
      prevTs: "",
      failedTs: "2024-09-01T00:00:00.000Z",
      messageId: "msg-null-thread",
      threadRootId: null,
      createdAt: "2024-09-01T00:00:00.002Z",
    });
    expect(db.getFailedRun(chatJid)!.threadRootId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFailedRun / clearFailedRun
// ---------------------------------------------------------------------------

describe("getFailedRun / clearFailedRun", () => {
  test("returns undefined when no failure is recorded", () => {
    const chatJid = jid("failed-none");
    db.setChatCursor(chatJid, "2024-01-01T00:00:00.000Z");
    expect(db.getFailedRun(chatJid)).toBeUndefined();
  });

  test("clearFailedRun removes the record without touching cursor or inflight", () => {
    const chatJid = jid("failed-clear");
    db.beginChatRun(chatJid, "2024-10-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "msg-clr",
      startedAt: "2024-10-01T00:00:00.001Z",
    });
    db.endChatRunWithError(chatJid, {
      prevTs: "",
      failedTs: "2024-10-01T00:00:00.000Z",
      messageId: "msg-clr",
      threadRootId: null,
      createdAt: "2024-10-01T00:00:00.002Z",
    });

    db.clearFailedRun(chatJid);

    expect(db.getFailedRun(chatJid)).toBeUndefined();
    expect(db.getChatCursor(chatJid)).toBe("2024-10-01T00:00:00.000Z");
  });
});

describe("rollbackChatRunWithError", () => {
  test("restores the previous cursor, clears inflight, and records the failed run", () => {
    const chatJid = jid("rollback-with-error");
    const prevTs = "2024-10-01T00:00:00.000Z";
    const failedTs = "2024-10-01T00:00:05.000Z";

    db.storeChatMetadata(chatJid, prevTs);
    db.storeMessage({
      id: "msg-user-rollback-with-error",
      chat_jid: chatJid,
      sender: "user",
      sender_name: "User",
      content: "hello",
      timestamp: failedTs,
      is_from_me: false,
      is_bot_message: false,
    });
    db.beginChatRun(chatJid, failedTs, {
      prevTs,
      messageId: "msg-user-rollback-with-error",
      startedAt: "2024-10-01T00:00:05.100Z",
    });
    db.storeMessage({
      id: "msg-bot-partial-rollback-with-error",
      chat_jid: chatJid,
      sender: "web-agent",
      sender_name: "Pi",
      content: "partial reply",
      timestamp: "2024-10-01T00:00:06.000Z",
      is_from_me: false,
      is_bot_message: true,
      is_terminal_agent_reply: false,
    });

    db.rollbackChatRunWithError(chatJid, {
      prevTs,
      failedTs,
      messageId: "msg-user-rollback-with-error",
      threadRootId: 7,
      createdAt: "2024-10-01T00:00:07.000Z",
    });

    expect(db.getChatCursor(chatJid)).toBe(prevTs);
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
    expect(db.getFailedRun(chatJid)).toEqual({
      prevTs,
      failedTs,
      messageId: "msg-user-rollback-with-error",
      threadRootId: 7,
      createdAt: "2024-10-01T00:00:07.000Z",
    });
    const timeline = db.getTimeline(chatJid, 20).map((item) => item.data.content);
    expect(timeline).toContain("hello");
    expect(timeline).not.toContain("partial reply");
  });
});

// ---------------------------------------------------------------------------
// rollbackInflightRun
// ---------------------------------------------------------------------------

describe("rollbackInflightRun", () => {
  test("resets cursor to prevTs and clears inflight", () => {
    const chatJid = jid("rollback-basic");
    const prevTs = "2024-10-01T00:00:00.000Z";
    const newTs  = "2024-10-02T00:00:00.000Z";

    db.beginChatRun(chatJid, newTs, {
      prevTs,
      messageId: "msg-rollback",
      startedAt: "2024-10-02T00:00:00.001Z",
    });
    db.rollbackInflightRun(chatJid, prevTs);

    expect(db.getChatCursor(chatJid)).toBe(prevTs);
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
  });

  test("can roll back to an empty-string cursor (first-ever run)", () => {
    const chatJid = jid("rollback-empty");
    db.beginChatRun(chatJid, "2024-11-01T00:00:00.000Z", {
      prevTs: "",
      messageId: "msg-first",
      startedAt: "2024-11-01T00:00:00.001Z",
    });
    db.rollbackInflightRun(chatJid, "");
    expect(db.getChatCursor(chatJid)).toBe("");
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario: normal run lifecycle
// ---------------------------------------------------------------------------

describe("normal run lifecycle", () => {
  test("message is not re-fetched after a successful run", () => {
    const chatJid = jid("lifecycle-normal");
    const msgTs = "2024-12-01T00:00:00.000Z";
    const msgId = storeMsg(chatJid, msgTs);

    const prevCursor = db.getChatCursor(chatJid);
    db.beginChatRun(chatJid, msgTs, { prevTs: prevCursor, messageId: msgId, startedAt: msgTs });
    db.endChatRun(chatJid);

    expect(db.getMessagesSince(chatJid, db.getChatCursor(chatJid), "Pi")
      .some((m) => m.id === msgId)).toBe(false);
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
    expect(db.getFailedRun(chatJid)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario: error run lifecycle
// ---------------------------------------------------------------------------

describe("error run lifecycle", () => {
  test("inflight cleared and failed_run set atomically on error", () => {
    const chatJid = jid("lifecycle-error");
    const msgTs = "2025-01-15T00:00:00.000Z";
    const msgId = storeMsg(chatJid, msgTs);

    const prevCursor = db.getChatCursor(chatJid);
    db.beginChatRun(chatJid, msgTs, { prevTs: prevCursor, messageId: msgId, startedAt: msgTs });

    db.endChatRunWithError(chatJid, {
      prevTs: prevCursor,
      failedTs: msgTs,
      messageId: msgId,
      threadRootId: null,
      createdAt: msgTs,
    });

    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
    expect(db.getFailedRun(chatJid)).toBeDefined();
    expect(db.getChatCursor(chatJid)).toBe(msgTs);
  });
});

// ---------------------------------------------------------------------------
// Scenario: crash recovery
// ---------------------------------------------------------------------------

describe("crash recovery", () => {
  test("inflight marker survives without endChatRun (simulated crash)", () => {
    const chatJid = jid("crash-survive");
    const msgId = storeMsg(chatJid, "2025-01-01T00:00:00.000Z");
    db.beginChatRun(chatJid, "2025-01-01T00:00:00.000Z", {
      prevTs: "",
      messageId: msgId,
      startedAt: "2025-01-01T00:00:00.001Z",
    });
    // No endChatRun – process killed
    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(1);
  });

  test("rollback restores cursor so message is re-fetchable", () => {
    const chatJid = jid("crash-refetch");
    const msgTs = "2025-02-01T00:00:00.000Z";
    const msgId = storeMsg(chatJid, msgTs);

    db.beginChatRun(chatJid, msgTs, { prevTs: "", messageId: msgId, startedAt: msgTs });

    const [inflight] = db.getInflightRuns().filter((r) => r.chatJid === chatJid);
    db.rollbackInflightRun(inflight.chatJid, inflight.prevTs);

    expect(db.getChatCursor(chatJid)).toBe("");
    expect(db.getMessagesSince(chatJid, db.getChatCursor(chatJid), "Pi")
      .some((m) => m.id === msgId)).toBe(true);
  });

  test("after successful retry the message is not fetched again", () => {
    const chatJid = jid("crash-no-double");
    const msgTs = "2025-03-01T00:00:00.000Z";
    const msgId = storeMsg(chatJid, msgTs);

    db.beginChatRun(chatJid, msgTs, { prevTs: "", messageId: msgId, startedAt: msgTs });
    db.rollbackInflightRun(chatJid, "");
    db.beginChatRun(chatJid, msgTs, { prevTs: "", messageId: msgId, startedAt: msgTs });
    db.endChatRun(chatJid);

    expect(db.getInflightRuns().filter((r) => r.chatJid === chatJid)).toHaveLength(0);
    expect(db.getMessagesSince(chatJid, db.getChatCursor(chatJid), "Pi")
      .some((m) => m.id === msgId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multi-chat rollback transaction
// ---------------------------------------------------------------------------

describe("multi-chat rollback transaction", () => {
  test("all inflights rolled back atomically", () => {
    const jids = [jid("multi-a"), jid("multi-b"), jid("multi-c")];
    const prevTs = "2025-04-01T00:00:00.000Z";
    const newTs  = "2025-04-02T00:00:00.000Z";

    for (const j of jids) {
      db.beginChatRun(j, newTs, { prevTs, messageId: `m-${j}`, startedAt: newTs });
    }

    db.getDb().transaction(() => {
      for (const j of jids) db.rollbackInflightRun(j, prevTs);
    })();

    for (const j of jids) {
      expect(db.getChatCursor(j)).toBe(prevTs);
      expect(db.getInflightRuns().filter((r) => r.chatJid === j)).toHaveLength(0);
    }
  });

  test("mid-transaction error leaves ALL rows at their pre-transaction state", () => {
    const j1 = jid("partial-a");
    const j2 = jid("partial-b");
    const prevTs = "2025-05-01T00:00:00.000Z";
    const newTs  = "2025-05-02T00:00:00.000Z";

    db.beginChatRun(j1, newTs, { prevTs, messageId: "m-p1", startedAt: newTs });
    db.beginChatRun(j2, newTs, { prevTs, messageId: "m-p2", startedAt: newTs });

    expect(() => {
      db.getDb().transaction(() => {
        db.rollbackInflightRun(j1, prevTs);
        throw new Error("simulated crash mid-transaction");
      })();
    }).toThrow("simulated crash mid-transaction");

    expect(db.getChatCursor(j1)).toBe(newTs);
    expect(db.getInflightRuns().filter((r) => r.chatJid === j1)).toHaveLength(1);
    expect(db.getChatCursor(j2)).toBe(newTs);
    expect(db.getInflightRuns().filter((r) => r.chatJid === j2)).toHaveLength(1);

    db.endChatRun(j1);
    db.endChatRun(j2);
  });
});

// ---------------------------------------------------------------------------
// Idempotency / stability
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  test("calling initDatabase() again does not wipe existing cursors", () => {
    const chatJid = jid("idem-init");
    db.setChatCursor(chatJid, "2025-06-01T00:00:00.000Z");
    db.initDatabase();
    expect(db.getChatCursor(chatJid)).toBe("2025-06-01T00:00:00.000Z");
  });

  test("endChatRun is safe to call when there is no row (UPDATE on missing row)", () => {
    expect(() => db.endChatRun(jid("end-missing"))).not.toThrow();
  });

  test("rollbackInflightRun is safe to call when there is no row", () => {
    expect(() => db.rollbackInflightRun(jid("rollback-missing"), "")).not.toThrow();
  });

  test("clearInflightMarker clears inflight without rolling back cursor", () => {
    const chatJid = jid("clear-inflight-no-rollback");
    const prevTs = "2025-01-01T00:00:00.000Z";
    const cursorTs = "2025-01-01T01:00:00.000Z";
    db.beginChatRun(chatJid, cursorTs, {
      prevTs,
      messageId: "msg-1",
      startedAt: "2025-01-01T01:00:00.001Z",
    });
    // Inflight marker exists and cursor advanced
    expect(db.getInflightRuns().some((r) => r.chatJid === chatJid)).toBe(true);
    expect(db.getChatCursor(chatJid)).toBe(cursorTs);

    // Clear inflight WITHOUT rollback
    db.clearInflightMarker(chatJid);

    // Inflight gone, but cursor stays at the advanced position
    expect(db.getInflightRuns().some((r) => r.chatJid === chatJid)).toBe(false);
    expect(db.getChatCursor(chatJid)).toBe(cursorTs);
  });

  test("getAgentReplyStateAfter returns none when no agent messages exist", () => {
    const chatJid = jid("no-agent-replies-" + Date.now());
    expect(db.getAgentReplyStateAfter(chatJid, "2025-01-01T00:00:00.000Z")).toBe("none");
    expect(db.hasAgentRepliesAfter(chatJid, "2025-01-01T00:00:00.000Z")).toBe(false);
  });

  test("getAgentReplyStateAfter distinguishes partial vs terminal replies after timestamp", () => {
    const chatJid = jid("has-agent-replies-" + Date.now());
    const dbConn = db.getDb();
    dbConn.prepare(`
      INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_bot_message, is_terminal_agent_reply)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("user-msg-har-1", chatJid, "user", "User", "hello", "2025-01-01T00:00:00.000Z", 0, 0);
    dbConn.prepare(`
      INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_bot_message, is_terminal_agent_reply)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("agent-msg-har-1", chatJid, "agent", "Agent", "partial", "2025-01-01T00:01:00.000Z", 1, 0);

    expect(db.getAgentReplyStateAfter(chatJid, "2025-01-01T00:00:00.000Z")).toBe("partial");
    expect(db.hasAgentRepliesAfter(chatJid, "2025-01-01T00:00:00.000Z")).toBe(false);

    dbConn.prepare(`
      INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_bot_message, is_terminal_agent_reply)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("agent-msg-har-2", chatJid, "agent", "Agent", "final", "2025-01-01T00:02:00.000Z", 1, 1);

    expect(db.getAgentReplyStateAfter(chatJid, "2025-01-01T00:00:00.000Z")).toBe("terminal");
    expect(db.hasAgentRepliesAfter(chatJid, "2025-01-01T00:00:00.000Z")).toBe(true);
    expect(db.getAgentReplyStateAfter(chatJid, "2025-01-01T00:03:00.000Z")).toBe("none");
    expect(db.hasAgentRepliesAfter(chatJid, "2025-01-01T00:03:00.000Z")).toBe(false);
  });

  test("rollbackInflightRun deletes non-terminal bot messages after prevTs", () => {
    const chatJid = jid("rollback-deletes-partials-" + Date.now());
    const prevTs = "2025-01-01T00:00:00.000Z";
    const dbConn = db.getDb();

    dbConn.prepare(`
      INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_bot_message, is_terminal_agent_reply)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("user-msg-rir-1", chatJid, "user", "User", "hello", prevTs, 0, 0);
    dbConn.prepare(`
      INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_bot_message, is_terminal_agent_reply)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("agent-msg-rir-1", chatJid, "agent", "Agent", "partial", "2025-01-01T00:01:00.000Z", 1, 0);

    db.beginChatRun(chatJid, "2025-01-01T00:01:00.000Z", {
      prevTs,
      messageId: "user-msg-rir-1",
      startedAt: "2025-01-01T00:01:01.000Z",
    });
    db.rollbackInflightRun(chatJid, prevTs);

    const remaining = dbConn.prepare(
      "SELECT content FROM messages WHERE chat_jid = ? ORDER BY timestamp"
    ).all(chatJid) as Array<{ content: string }>;
    expect(remaining.map((row) => row.content)).toEqual(["hello"]);
  });
});
