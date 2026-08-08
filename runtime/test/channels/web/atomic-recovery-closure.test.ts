import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  claimNextChatOperation,
  completeChatOperation,
  getAcceptedChatSource,
  getChatCursor,
  getChatOperation,
  getChatOperationDisposition,
  getDb,
  initDatabase,
  promoteChatOperation,
  storeAcceptedChatMessageSource,
  storeMessage,
  type ChatOperationCompletionBoundary,
  type ChatOperationOwner,
  type ChatOperationState,
} from "../../../src/db.js";
import {
  recoverInflightRuns,
  type WebRecoveryContext,
  type WebRecoveryStore,
} from "../../../src/channels/web/runtime/recovery.js";

function owner(operation: ChatOperationState): ChatOperationOwner {
  return {
    operationId: operation.operationId,
    sourceSeq: operation.sourceSeq,
    phase: operation.phase,
    generation: operation.generation,
  };
}

function createRunningPrompt(chatJid: string, timestamp = new Date().toISOString()): {
  operation: ChatOperationState;
  sourceSeq: number;
  messageId: string;
  timestamp: string;
} {
  const messageId = `source-${crypto.randomUUID()}`;
  const accepted = storeAcceptedChatMessageSource({
    id: messageId,
    chat_jid: chatJid,
    sender: "user",
    sender_name: "User",
    content: "Continue the task",
    timestamp,
    is_from_me: false,
    is_bot_message: false,
  });
  const claimed = claimNextChatOperation(chatJid);
  if (claimed.status !== "claimed") throw new Error(`Expected claim, got ${claimed.status}`);
  const preflight = promoteChatOperation(chatJid, owner(claimed.operation), "preflight");
  if (preflight.status !== "applied") throw new Error(`Expected preflight, got ${preflight.status}`);
  const running = promoteChatOperation(chatJid, owner(preflight.operation), "running");
  if (running.status !== "applied") throw new Error(`Expected running, got ${running.status}`);
  return { operation: running.operation, sourceSeq: accepted.source.sourceSeq, messageId, timestamp };
}

function recoveryContext(overrides: Partial<WebRecoveryContext> = {}): WebRecoveryContext {
  return {
    assistantName: "Pi",
    defaultAgentId: "default",
    enqueue: () => {},
    processChat: async () => {},
    ...overrides,
  };
}

describe("atomic durable restart recovery", () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    const database = getDb();
    database.exec(`
      DELETE FROM chat_goal_continuation_intents
        WHERE continuation_source_seq IN (SELECT source_seq FROM chat_accepted_sources WHERE chat_jid LIKE 'web:recover-%')
           OR intent_source_seq IN (SELECT source_seq FROM chat_accepted_sources WHERE chat_jid LIKE 'web:recover-%');
      DELETE FROM chat_operation_dispositions WHERE chat_jid LIKE 'web:recover-%';
      DELETE FROM chat_cursors WHERE chat_jid LIKE 'web:recover-%';
      DELETE FROM chat_accepted_sources WHERE chat_jid LIKE 'web:recover-%';
      DELETE FROM thinking_content
        WHERE message_id IN (SELECT CAST(rowid AS TEXT) FROM messages WHERE chat_jid LIKE 'web:recover-%');
      DELETE FROM message_media
        WHERE message_rowid IN (SELECT rowid FROM messages WHERE chat_jid LIKE 'web:recover-%');
      DELETE FROM messages WHERE chat_jid LIKE 'web:recover-%';
      DELETE FROM chats WHERE jid LIKE 'web:recover-%';
    `);
  });

  test("promotes the latest partial reply and completes its exact running operation", () => {
    const chatJid = `web:recover-partial-${crypto.randomUUID()}`;
    const run = createRunningPrompt(chatJid);
    const partialId = `partial-${crypto.randomUUID()}`;
    storeMessage({
      id: partialId,
      chat_jid: chatJid,
      sender: "web-agent",
      sender_name: "Pi",
      content: "I completed the first durable step.",
      timestamp: run.timestamp,
      is_from_me: true,
      is_bot_message: true,
      is_terminal_agent_reply: false,
      operation_id: run.operation.operationId,
    });

    recoverInflightRuns(recoveryContext());

    expect(getChatOperation(chatJid)).toBeNull();
    expect(getChatOperationDisposition(run.sourceSeq)).toMatchObject({
      operationId: run.operation.operationId,
      outcome: "interrupted",
      cause: "recovered_partial_output",
      provenance: "web_startup_recovery",
      terminalMessageId: partialId,
    });
    expect(getDb().prepare(`SELECT is_terminal_agent_reply, operation_id FROM messages WHERE chat_jid = ? AND id = ?`)
      .get(chatJid, partialId)).toEqual({
      is_terminal_agent_reply: 1,
      operation_id: run.operation.operationId,
    });

    recoverInflightRuns(recoveryContext());
    expect(getDb().prepare(`SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 1`)
      .get(chatJid)).toEqual({ count: 1 });
  });

  test("ignores a newer unrelated bot row and completes from exact operation-bound evidence", () => {
    const chatJid = `web:recover-unrelated-${crypto.randomUUID()}`;
    const run = createRunningPrompt(chatJid);
    const boundId = `bound-${crypto.randomUUID()}`;
    const unrelatedId = `unrelated-${crypto.randomUUID()}`;
    storeMessage({
      id: boundId,
      chat_jid: chatJid,
      sender: "web-agent",
      sender_name: "Pi",
      content: "Owned intermediate output",
      timestamp: new Date(Date.now() + 1).toISOString(),
      is_from_me: true,
      is_bot_message: true,
      is_terminal_agent_reply: false,
      operation_id: run.operation.operationId,
    });
    storeMessage({
      id: unrelatedId,
      chat_jid: chatJid,
      sender: "web-agent",
      sender_name: "System",
      content: "Newer unrelated bot event",
      timestamp: new Date(Date.now() + 2).toISOString(),
      is_from_me: true,
      is_bot_message: true,
      is_terminal_agent_reply: false,
    });

    recoverInflightRuns(recoveryContext());

    expect(getChatOperationDisposition(run.sourceSeq)?.terminalMessageId).toBe(boundId);
    expect(getDb().prepare(`SELECT is_terminal_agent_reply, operation_id FROM messages WHERE chat_jid = ? AND id = ?`)
      .get(chatJid, unrelatedId)).toEqual({ is_terminal_agent_reply: 0, operation_id: null });
  });

  test("binds an existing terminal reply without duplicating it", () => {
    const chatJid = `web:recover-terminal-${crypto.randomUUID()}`;
    const run = createRunningPrompt(chatJid);
    const terminalId = `terminal-${crypto.randomUUID()}`;
    storeMessage({
      id: terminalId,
      chat_jid: chatJid,
      sender: "web-agent",
      sender_name: "Pi",
      content: "Finished before restart.",
      timestamp: new Date(Date.now() + 1).toISOString(),
      is_from_me: true,
      is_bot_message: true,
      is_terminal_agent_reply: true,
      operation_id: run.operation.operationId,
    });

    recoverInflightRuns(recoveryContext());

    expect(getChatOperation(chatJid)).toBeNull();
    expect(getChatOperationDisposition(run.sourceSeq)).toMatchObject({
      outcome: "succeeded",
      cause: "recovered_terminal_output",
      terminalMessageId: terminalId,
    });
    expect(getDb().prepare(`SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 1`)
      .get(chatJid)).toEqual({ count: 1 });
  });

  test("stores a recovered draft as the terminal artifact in the completion transaction", () => {
    const chatJid = `web:recover-draft-${crypto.randomUUID()}`;
    const run = createRunningPrompt(chatJid);
    const cleared: string[] = [];

    recoverInflightRuns(recoveryContext({
      getDraftRecovery: () => ({ text: "Visible buffered work", totalLines: 1, updatedAt: Date.now() }),
      clearDraftRecovery: (jid) => { cleared.push(jid); },
    }));

    expect(getChatOperation(chatJid)).toBeNull();
    const disposition = getChatOperationDisposition(run.sourceSeq);
    expect(disposition).toMatchObject({
      outcome: "interrupted",
      cause: "recovered_draft_after_restart",
      provenance: "web_startup_recovery",
    });
    expect(cleared).toEqual([chatJid]);
    expect(getDb().prepare(`SELECT content, is_terminal_agent_reply, operation_id FROM messages WHERE chat_jid = ? AND id = ?`)
      .get(chatJid, disposition!.terminalMessageId)).toEqual({
      content: "Visible buffered work",
      is_terminal_agent_reply: 1,
      operation_id: run.operation.operationId,
    });
  });

  test("stores one interrupted marker atomically when no output survived", () => {
    const chatJid = `web:recover-empty-${crypto.randomUUID()}`;
    const run = createRunningPrompt(chatJid);

    recoverInflightRuns(recoveryContext());

    expect(getChatOperation(chatJid)).toBeNull();
    const disposition = getChatOperationDisposition(run.sourceSeq);
    expect(disposition).toMatchObject({ outcome: "interrupted", cause: "service_restart" });
    const message = getDb().prepare(`SELECT content_blocks, is_terminal_agent_reply, operation_id
      FROM messages WHERE chat_jid = ? AND id = ?`).get(chatJid, disposition!.terminalMessageId) as {
        content_blocks: string;
        is_terminal_agent_reply: number;
        operation_id: string;
      };
    expect(JSON.parse(message.content_blocks)).toContainEqual(expect.objectContaining({
      type: "turn_outcome_marker",
      cause: "service_restart",
    }));
    expect(message.is_terminal_agent_reply).toBe(1);
    expect(message.operation_id).toBe(run.operation.operationId);
  });

  for (const boundary of ["artifact", "successor", "disposition", "frontier", "release"] satisfies ChatOperationCompletionBoundary[]) {
    test(`rolls back recovered artifact and operation completion after the ${boundary} boundary`, () => {
      const chatJid = `web:recover-fault-${boundary}-${crypto.randomUUID()}`;
      const run = createRunningPrompt(chatJid);
      const source = getAcceptedChatSource(run.sourceSeq);
      if (!source) throw new Error("Expected accepted source");
      const cursorBefore = getChatCursor(chatJid);
      const store: WebRecoveryStore = {
        getInflightRuns: () => [],
        transaction: (execute) => execute(),
        getAgentReplyStateAfter: () => "none",
        clearInflightMarker: () => {},
        rollbackInflightRun: () => {},
        getAllChatCursors: () => ({}),
        getKnownChatJids: () => [],
        getDeferredQueuedFollowups: () => [],
        getMessagesSince: () => [],
        getRecoverableDurableRuns: () => [{ operation: run.operation, source }],
        getLatestAgentReplyForOperation: () => null,
        completeChatOperation: (jid, request) => completeChatOperation(jid, request, {
          afterWrite: (observed) => {
            if (observed === boundary) throw new Error(`fault:${boundary}`);
          },
        }),
      };

      recoverInflightRuns(recoveryContext(), store);

      expect(getChatOperation(chatJid)).toEqual(run.operation);
      expect(getChatOperationDisposition(run.sourceSeq)).toBeNull();
      expect(getChatCursor(chatJid)).toBe(cursorBefore);
      expect(getDb().prepare(`SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 1`)
        .get(chatJid)).toEqual({ count: 0 });

      // The same owner remains recoverable after rollback.
      recoverInflightRuns(recoveryContext());
      expect(getChatOperation(chatJid)).toBeNull();
    });
  }

  test("does not clear recovery state after an exact-owner rejection", () => {
    const cleared: string[] = [];
    const oldOperation: ChatOperationState = {
      chatJid: "web:stale-owner",
      operationId: "old-operation",
      sourceSeq: 1,
      phase: "running",
      generation: 2,
      cancellation: null,
    };
    const store: WebRecoveryStore = {
      getInflightRuns: () => [],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
      getRecoverableDurableRuns: () => [{
        operation: oldOperation,
        source: {
          sourceSeq: 1,
          chatJid: oldOperation.chatJid,
          sourceClass: "prompt",
          sourceKind: "message",
          sourceId: "source-old",
          acceptedAt: "2026-01-01T00:00:00.000Z",
          selectable: true,
          payloadRef: "message:source-old",
          frontierMessageId: "source-old",
          frontierCursorTs: "2026-01-01T00:00:00.000Z",
          operationId: oldOperation.operationId,
        },
      }],
      getLatestAgentReplyForOperation: () => ({ messageId: "partial-old", terminal: false }),
      completeChatOperation: () => ({
        status: "rejected",
        reason: "generation_mismatch",
        operation: { ...oldOperation, operationId: "replacement-operation", generation: 0 },
      }),
    };

    recoverInflightRuns(recoveryContext({ clearDraftRecovery: (jid) => { cleared.push(jid); } }), store);

    expect(cleared).toEqual([]);
  });
});
