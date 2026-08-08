import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getTestWorkspace, setEnv } from "../helpers.js";
import type { ChatOperationOwner, ChatOperationState } from "../../src/db/chat-operations.js";

let db: typeof import("../../src/db.js");
let op: typeof import("../../src/db/chat-operations.js");
let serial = 0;
const jid = (name: string) => `operation:${name}:${++serial}`;
const owner = (state: ChatOperationState): ChatOperationOwner => ({
  operationId: state.operationId, sourceSeq: state.sourceSeq, phase: state.phase, generation: state.generation,
});
const register = (chatJid: string, id: string, acceptedAt = "2026-08-07T22:00:00.000Z") => {
  const existing = db.getDb().prepare("SELECT timestamp FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, id) as { timestamp: string } | undefined;
  if (existing) return op.getAcceptedChatSource((db.getDb().prepare(`SELECT source_seq FROM chat_accepted_sources
    WHERE chat_jid = ? AND source_kind = 'message' AND source_id = ?`).get(chatJid, id) as { source_seq: number }).source_seq)!;
  return op.storeAcceptedChatMessageSource({ id, chat_jid: chatJid, sender: "user", sender_name: "User", content: id,
    timestamp: acceptedAt, is_from_me: false, is_bot_message: false }, acceptedAt).source;
};
const terminal = (chatJid: string, id: string) => ({
  id, chat_jid: chatJid, sender: "bot", sender_name: "Pi", content: "done",
  timestamp: "2026-08-07T22:01:00.000Z", is_from_me: true, is_bot_message: true,
  is_terminal_agent_reply: true,
});
const complete = (chatJid: string, state: ChatOperationState, id = `bot-${serial}`) => op.completeChatOperation(chatJid, {
  owner: owner(state), outcome: "succeeded", cause: "normal", provenance: "provider",
  createdAt: "2026-08-07T22:01:01.000Z", artifact: { message: terminal(chatJid, id) },
});

beforeAll(async () => {
  const ws = getTestWorkspace();
  setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  db = await import("../../src/db.js");
  op = await import("../../src/db/chat-operations.js");
  db.initDatabase();
});

afterAll(() => {
  const database = db.getDb();
  database.exec(`
    DELETE FROM chat_goal_continuation_intents
      WHERE continuation_source_seq IN (SELECT source_seq FROM chat_accepted_sources WHERE chat_jid LIKE 'operation:%')
         OR intent_source_seq IN (SELECT source_seq FROM chat_accepted_sources WHERE chat_jid LIKE 'operation:%');
    DELETE FROM chat_operation_dispositions WHERE chat_jid LIKE 'operation:%';
    DELETE FROM chat_cursors WHERE chat_jid LIKE 'operation:%';
    DELETE FROM chat_accepted_sources WHERE chat_jid LIKE 'operation:%';
    DELETE FROM thinking_content
      WHERE message_id IN (SELECT CAST(rowid AS TEXT) FROM messages WHERE chat_jid LIKE 'operation:%');
    DELETE FROM message_media
      WHERE message_rowid IN (SELECT rowid FROM messages WHERE chat_jid LIKE 'operation:%');
    DELETE FROM messages WHERE chat_jid LIKE 'operation:%';
    DELETE FROM chat_branches WHERE chat_jid LIKE 'operation:%';
    DELETE FROM chats WHERE jid LIKE 'operation:%';
  `);
});

describe("durable accepted-input operations", () => {
  test("adds source registry, minimal active projection and disposition ledger", () => {
    const columns = (table: string) => new Set((db.getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(r => r.name));
    expect([...columns("chat_cursors")]).toEqual(expect.arrayContaining([
      "operation_id", "operation_source_seq", "operation_phase", "operation_generation",
      "operation_cancel_cause", "operation_cancel_requested_at",
    ]));
    expect(columns("chat_cursors").has("operation_terminal_disposition")).toBe(false);
    expect([...columns("chat_accepted_sources")]).toEqual(expect.arrayContaining([
      "source_seq", "chat_jid", "source_class", "source_kind", "source_id", "accepted_at", "selectable", "payload_ref",
      "frontier_message_id", "frontier_cursor_ts", "operation_id",
    ]));
    expect([...columns("chat_operation_dispositions")]).toEqual(expect.arrayContaining([
      "source_seq", "operation_id", "outcome", "cause", "provenance", "terminal_message_chat_jid", "terminal_message_id",
    ]));
  });

  test("registers idempotently, rejects identity drift and orders ties by source_seq", () => {
    const chatJid = jid("ordering");
    const second = register(chatJid, "second");
    const first = register(chatJid, "first");
    expect(second.sourceSeq).toBeLessThan(first.sourceSeq);
    expect(register(chatJid, "second")).toEqual(second);
    expect(() => op.registerAcceptedChatSource({ chatJid, sourceClass: "prompt", sourceKind: "message",
      sourceId: "second", acceptedAt: second.acceptedAt, payloadRef: "different" })).toThrow();
    expect(() => db.getDb().prepare("UPDATE chat_accepted_sources SET payload_ref = 'mutated' WHERE source_seq = ?")
      .run(second.sourceSeq)).toThrow("accepted source identity is immutable");
    const pendingRow = db.getDb().prepare("SELECT rowid FROM messages WHERE chat_jid = ? AND id = ?")
      .get(chatJid, "second") as { rowid: number };
    expect(() => db.deleteMessageByRowId(chatJid, pendingRow.rowid)).toThrow("accepted frontier message");
    expect(() => db.storeMessage({ id: "second", chat_jid: chatJid, sender: "user", sender_name: "User",
      content: "changed", timestamp: "2026-08-07T23:00:00Z", is_from_me: false, is_bot_message: false }))
      .toThrow("accepted frontier timestamp is immutable");
    expect(op.claimNextChatOperation(chatJid).source?.sourceSeq).toBe(second.sourceSeq);
  });

  test("message acceptance is idempotent without rewriting the pending frontier timestamp", () => {
    const chatJid = jid("accept-retry");
    const message = { id: "retry-message", chat_jid: chatJid, sender: "user", sender_name: "User", content: "retry",
      timestamp: "2026-08-07T22:00:00.000Z", is_from_me: false, is_bot_message: false };
    const first = op.storeAcceptedChatMessageSource(message);
    const second = op.storeAcceptedChatMessageSource(message);
    expect(second).toEqual({ status: "existing", source: first.source });
    expect(db.getDb().prepare("SELECT timestamp FROM messages WHERE chat_jid = ? AND id = ?")
      .get(chatJid, message.id)).toEqual({ timestamp: first.source.frontierCursorTs });
  });

  test("claim is idempotent and completion advances to the next canonical source", () => {
    const chatJid = jid("claim");
    const first = register(chatJid, "a");
    const second = register(chatJid, "b");
    const claimed = op.claimNextChatOperation(chatJid);
    expect(claimed.status).toBe("claimed");
    expect(register(chatJid, "a").operationId).toBe(claimed.operation?.operationId);
    expect(op.claimNextChatOperation(chatJid)).toEqual({ ...claimed, status: "existing" });
    const firstCompletion = complete(chatJid, claimed.operation! as ChatOperationState);
    expect(firstCompletion.status).toBe("completed");
    const next = op.claimNextChatOperation(chatJid);
    expect(next.source?.sourceSeq).toBe(second.sourceSeq);
    const repeated = complete(chatJid, claimed.operation! as ChatOperationState);
    expect(repeated).toEqual({ status: "repeated", disposition: firstCompletion.status === "completed" ? firstCompletion.disposition : null });
    expect(op.getChatOperation(chatJid)).toEqual(next.operation);
    expect(op.getChatOperationDisposition(first.sourceSeq)?.outcome).toBe("succeeded");
  });

  test("typed transitions increment one generation and reject stale or post-cancel effects", () => {
    const chatJid = jid("cas"); register(chatJid, "a");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const preflight = op.promoteChatOperation(chatJid, owner(claimed), "preflight");
    expect(preflight.status).toBe("applied");
    if (preflight.status !== "applied") return;
    expect(preflight.operation.generation).toBe(1);
    expect(op.promoteChatOperation(chatJid, owner(claimed), "preflight")).toMatchObject({ status: "rejected", reason: "phase_mismatch" });
    const cancelled = op.cancelChatOperation(chatJid, owner(preflight.operation), { cause: "user_abort", requestedAt: "2026-08-07T22:02:00Z" });
    expect(cancelled.status).toBe("applied");
    if (cancelled.status !== "applied") return;
    expect(cancelled.operation.generation).toBe(2);
    expect(op.promoteChatOperation(chatJid, owner(cancelled.operation), "running")).toMatchObject({ status: "rejected", reason: "operation_cancelled" });
    expect(op.cancelChatOperation(chatJid, owner(cancelled.operation), { cause: "later", requestedAt: "later" })).toMatchObject({ status: "unchanged", reason: "already_cancelled" });
  });

  test("cancellation invalidates stale success and a fresh owner completes cancelled rowlessly", () => {
    const chatJid = jid("cancel"); const source = register(chatJid, "a");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const cancelled = op.cancelChatOperation(chatJid, owner(claimed), { cause: "user_abort", requestedAt: "2026-08-07T22:02:00Z" });
    if (cancelled.status !== "applied") throw new Error("cancel failed");
    expect(complete(chatJid, claimed)).toMatchObject({ status: "rejected", reason: "generation_mismatch" });
    const result = op.completeChatOperation(chatJid, { owner: owner(cancelled.operation), outcome: "cancelled",
      cause: "user_abort", provenance: "abort", createdAt: "2026-08-07T22:02:01Z" });
    expect(result.status).toBe("completed");
    expect(op.getChatOperationDisposition(source.sourceSeq)).toMatchObject({ outcome: "cancelled", cause: "user_abort", terminalMessageId: null });
  });

  test("owner mismatch precedes artifact validation", () => {
    const chatJid = jid("precedence"); register(chatJid, "a");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const result = op.completeChatOperation(chatJid, { owner: { ...owner(claimed), generation: 99 }, outcome: "succeeded",
      cause: "normal", provenance: "provider", createdAt: "now", artifact: { messageId: "missing" } });
    expect(result).toMatchObject({ status: "rejected", reason: "generation_mismatch" });
  });

  test("completion rolls back at every write boundary and remains recoverable", () => {
    for (const boundary of ["artifact", "successor", "intents", "disposition", "frontier", "release"] as const) {
      const chatJid = jid(`rollback-${boundary}`); const source = register(chatJid, "a");
      const claimed = op.claimNextChatOperation(chatJid).operation!;
      expect(() => op.completeChatOperation(chatJid, { owner: owner(claimed), outcome: "succeeded", cause: "normal",
        provenance: "provider", createdAt: "now", artifact: { message: terminal(chatJid, `bot-${boundary}-${serial}`) } },
      { afterWrite(point) { if (point === boundary) throw new Error(`fault:${point}`); } })).toThrow(`fault:${boundary}`);
      expect(op.getChatOperation(chatJid)).toEqual(claimed);
      expect(op.getChatOperationDisposition(source.sourceSeq)).toBeNull();
      expect(complete(chatJid, claimed, `retry-${boundary}-${serial}`).status).toBe("completed");
    }
  });

  test("repetition returns the exact disposition and conflicts are invariant errors", () => {
    const chatJid = jid("repeat"); register(chatJid, "a");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const request = { owner: owner(claimed), outcome: "succeeded" as const, cause: "normal", provenance: "provider",
      createdAt: "now", artifact: { message: terminal(chatJid, `bot-repeat-${serial}`) } };
    const first = op.completeChatOperation(chatJid, request);
    expect(op.completeChatOperation(chatJid, request)).toEqual({ status: "repeated", disposition: first.status === "completed" ? first.disposition : null });
    expect(() => op.completeChatOperation(chatJid, { ...request, outcome: "failed" })).toThrow("Conflicting repeated completion");
  });

  test("atomically registers one deterministic protected continuation and validates repeated lineage", () => {
    const chatJid = jid("protected-successor");
    const root = register(chatJid, "root");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const request = {
      owner: owner(claimed), outcome: "interrupted" as const,
      cause: "protected_recovery_continuation_registered", provenance: "web_process_chat",
      createdAt: "2026-08-08T13:10:00.000Z",
      artifact: { message: terminal(chatJid, `bot-handoff-${serial}`) },
      successor: { sourceKind: "protected_continuation" as const, rootSourceSeq: root.sourceSeq },
    };
    const completed = op.completeChatOperation(chatJid, request);
    expect(completed.status).toBe("completed");
    const successor = op.peekNextAcceptedChatSource(chatJid)!;
    expect(successor).toMatchObject({
      sourceClass: "prompt", sourceKind: "protected_continuation", sourceId: `source:${root.sourceSeq}`,
      acceptedAt: request.createdAt, selectable: true, payloadRef: `accepted-source:${root.sourceSeq}`,
      frontierMessageId: null, frontierCursorTs: null, operationId: null,
    });
    expect(op.getProtectedContinuationRootSource(successor)).toEqual({
      ...root,
      operationId: claimed.operationId,
    });
    expect(op.getProtectedContinuationRootSource({
      ...successor,
      sourceId: `source:0${root.sourceSeq}`,
    })).toBeNull();
    expect(op.getProtectedContinuationRootSource({
      ...successor,
      chatJid: `${chatJid}:other`,
    })).toBeNull();
    expect(op.completeChatOperation(chatJid, request)).toEqual({
      status: "repeated", disposition: completed.status === "completed" ? completed.disposition : null,
    });
    expect(() => op.completeChatOperation(chatJid, { ...request, successor: undefined }))
      .toThrow("Conflicting repeated protected continuation successor");
    expect(() => op.completeChatOperation(chatJid, {
      ...request, successor: { sourceKind: "protected_continuation", rootSourceSeq: root.sourceSeq + 1 },
    })).toThrow("lineage conflicts");
  });

  test("Goal checkpoint atomically preserves lineage, carried steers, restart claims, and repeated generations", () => {
    const chatJid = jid("goal-checkpoint");
    const root = register(chatJid, "goal-root");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const applied = op.registerChatOperationIntent(chatJid, owner(claimed), {
      sourceKind: "steer", sourceId: "applied", acceptedAt: "now-1", payloadRef: "steer:applied",
    });
    const carried = op.registerChatOperationIntent(chatJid, owner(claimed), {
      sourceKind: "steer", sourceId: "carried", acceptedAt: "now-2", payloadRef: "steer:carried",
    });
    if (applied.status !== "registered" || carried.status !== "registered") throw new Error("expected Goal steers");
    const successorRequest = {
      sourceKind: "goal_continuation" as const,
      rootSourceSeq: root.sourceSeq,
      parentSourceSeq: root.sourceSeq,
      parentGeneration: 0,
      generation: 1,
      goalId: "goal-1",
      checkpointId: "checkpoint-1",
      oldTurnId: "turn-1",
      carriedIntentSourceSeqs: [carried.source.sourceSeq],
    };
    const request = {
      owner: owner(claimed), outcome: "interrupted" as const, cause: "goal_deadline_checkpoint", provenance: "goal:test",
      createdAt: "2026-08-07T22:01:01.000Z", artifact: { message: terminal(chatJid, `goal-checkpoint-${serial}`) },
      successor: successorRequest,
      intentDispositions: [
        { sourceSeq: applied.source.sourceSeq, outcome: "succeeded" as const, cause: "steer_applied", provenance: "goal:test" },
        { sourceSeq: carried.source.sourceSeq, outcome: "interrupted" as const, cause: "goal_deadline_steer_carried", provenance: "goal:test" },
      ],
    };
    const completed = op.completeChatOperation(chatJid, request);
    expect(completed.status).toBe("completed");
    const successorSeq = (db.getDb().prepare(`SELECT source_seq FROM chat_accepted_sources
      WHERE chat_jid = ? AND source_kind = 'goal_continuation' AND source_id = ?`)
      .get(chatJid, `goal:${root.sourceSeq}:1`) as { source_seq: number }).source_seq;
    const successor = op.getAcceptedChatSource(successorSeq)!;
    expect(op.getGoalContinuationLineage(successor)).toEqual({
      rootSourceSeq: root.sourceSeq, parentSourceSeq: root.sourceSeq, parentGeneration: 0, generation: 1,
      goalId: "goal-1", checkpointId: "checkpoint-1", oldTurnId: "turn-1",
    });
    expect(op.getGoalContinuationCarriedIntentSources(successor.sourceSeq).map((item) => item.sourceSeq))
      .toEqual([carried.source.sourceSeq]);
    expect(op.completeChatOperation(chatJid, request).status).toBe("repeated");

    const restartClaim = op.claimNextChatOperation(chatJid);
    expect(restartClaim.source?.sourceSeq).toBe(successor.sourceSeq);
    expect(op.claimNextChatOperation(chatJid)).toMatchObject({ status: "existing", source: { sourceSeq: successor.sourceSeq } });
    const childRequest = {
      owner: owner(restartClaim.operation!), outcome: "interrupted" as const, cause: "goal_deadline_checkpoint", provenance: "goal:test",
      createdAt: "2026-08-07T22:02:01.000Z", artifact: { message: terminal(chatJid, `goal-checkpoint-child-${serial}`) },
      successor: {
        sourceKind: "goal_continuation" as const,
        rootSourceSeq: root.sourceSeq,
        parentSourceSeq: successor.sourceSeq,
        parentGeneration: 1,
        generation: 2,
        goalId: "goal-1",
        checkpointId: "checkpoint-2",
        oldTurnId: "turn-2",
        carriedIntentSourceSeqs: [],
      },
    };
    expect(op.completeChatOperation(chatJid, childRequest).status).toBe("completed");
    const grandchildSeq = (db.getDb().prepare(`SELECT source_seq FROM chat_accepted_sources
      WHERE chat_jid = ? AND source_kind = 'goal_continuation' AND source_id = ?`)
      .get(chatJid, `goal:${root.sourceSeq}:2`) as { source_seq: number }).source_seq;
    const grandchild = op.getAcceptedChatSource(grandchildSeq)!;
    expect(op.getGoalContinuationLineage(grandchild)?.generation).toBe(2);
    expect(op.completeChatOperation(chatJid, childRequest).status).toBe("repeated");
    expect(() => op.completeChatOperation(chatJid, {
      ...childRequest,
      successor: { ...childRequest.successor, generation: 3 },
    })).toThrow("exact next generation");
  });

  test("protected handoff is all-or-nothing at every write boundary and stale ownership writes nothing", () => {
    for (const boundary of ["artifact", "successor", "intents", "disposition", "frontier", "release"] as const) {
      const chatJid = jid(`protected-fault-${boundary}`);
      const root = register(chatJid, `root-${boundary}`);
      const claimed = op.claimNextChatOperation(chatJid).operation!;
      const request = {
        owner: owner(claimed), outcome: "interrupted" as const,
        cause: "protected_recovery_continuation_registered", provenance: "test", createdAt: "now",
        artifact: { message: terminal(chatJid, `handoff-${boundary}-${serial}`) },
        successor: { sourceKind: "protected_continuation" as const, rootSourceSeq: root.sourceSeq },
      };
      expect(() => op.completeChatOperation(chatJid, request, {
        afterWrite(point) { if (point === boundary) throw new Error(`fault:${point}`); },
      })).toThrow(`fault:${boundary}`);
      expect(op.getChatOperation(chatJid)).toEqual(claimed);
      expect(op.getChatOperationDisposition(root.sourceSeq)).toBeNull();
      expect(db.getDb().prepare("SELECT 1 FROM chat_accepted_sources WHERE chat_jid = ? AND source_kind = 'protected_continuation'")
        .get(chatJid)).toBeNull();
      expect(db.getDb().prepare("SELECT 1 FROM messages WHERE chat_jid = ? AND id = ?")
        .get(chatJid, request.artifact.message.id)).toBeNull();
      expect(op.completeChatOperation(chatJid, request).status).toBe("completed");
    }

    const chatJid = jid("protected-stale-owner");
    const root = register(chatJid, "root");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const stale = op.completeChatOperation(chatJid, {
      owner: { ...owner(claimed), generation: claimed.generation + 1 }, outcome: "interrupted",
      cause: "protected_recovery_continuation_registered", provenance: "test", createdAt: "now",
      artifact: { message: terminal(chatJid, `stale-handoff-${serial}`) },
      successor: { sourceKind: "protected_continuation", rootSourceSeq: root.sourceSeq },
    });
    expect(stale).toMatchObject({ status: "rejected", reason: "generation_mismatch" });
    expect(db.getDb().prepare("SELECT 1 FROM chat_accepted_sources WHERE chat_jid = ? AND source_kind = 'protected_continuation'")
      .get(chatJid)).toBeNull();
    expect(db.getDb().prepare("SELECT 1 FROM messages WHERE chat_jid = ? AND id = ?")
      .get(chatJid, `stale-handoff-${serial}`)).toBeNull();

    const cancelledChatJid = jid("protected-cancelled-owner");
    const cancelledRoot = register(cancelledChatJid, "root");
    const cancelledClaim = op.claimNextChatOperation(cancelledChatJid).operation!;
    const cancelled = op.cancelChatOperation(cancelledChatJid, owner(cancelledClaim), {
      cause: "user_abort", requestedAt: "cancelled-now",
    });
    if (cancelled.status !== "applied") throw new Error("expected cancellation");
    expect(op.completeChatOperation(cancelledChatJid, {
      owner: owner(cancelled.operation), outcome: "interrupted",
      cause: "protected_recovery_continuation_registered", provenance: "test", createdAt: "now",
      artifact: { message: terminal(cancelledChatJid, `cancelled-handoff-${serial}`) },
      successor: { sourceKind: "protected_continuation", rootSourceSeq: cancelledRoot.sourceSeq },
    })).toMatchObject({ status: "rejected", reason: "cancelled_outcome_required" });
    expect(db.getDb().prepare("SELECT 1 FROM chat_accepted_sources WHERE chat_jid = ? AND source_kind = 'protected_continuation'")
      .get(cancelledChatJid)).toBeNull();
    expect(db.getDb().prepare("SELECT 1 FROM messages WHERE chat_jid = ? AND id = ?")
      .get(cancelledChatJid, `cancelled-handoff-${serial}`)).toBeNull();
  });

  test("canonical source_seq keeps already accepted work ahead of the protected child without starvation", () => {
    const chatJid = jid("protected-ordering");
    const root = register(chatJid, "root");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const acceptedAhead = register(chatJid, "accepted-ahead");
    op.completeChatOperation(chatJid, {
      owner: owner(claimed), outcome: "interrupted", cause: "protected_recovery_continuation_registered",
      provenance: "test", createdAt: "now", artifact: { message: terminal(chatJid, `ordered-handoff-${serial}`) },
      successor: { sourceKind: "protected_continuation", rootSourceSeq: root.sourceSeq },
    });
    const child = db.getDb().prepare(`SELECT source_seq FROM chat_accepted_sources
      WHERE chat_jid = ? AND source_kind = 'protected_continuation'`).get(chatJid) as { source_seq: number };
    expect(acceptedAhead.sourceSeq).toBeLessThan(child.source_seq);
    const aheadClaim = op.claimNextChatOperation(chatJid);
    expect(aheadClaim.source?.sourceSeq).toBe(acceptedAhead.sourceSeq);
    expect(complete(chatJid, aheadClaim.operation!, `ahead-terminal-${serial}`).status).toBe("completed");
    const childClaim = op.claimNextChatOperation(chatJid);
    expect(childClaim.source?.sourceSeq).toBe(child.source_seq);
    expect(childClaim.source?.sourceKind).toBe("protected_continuation");
    expect(op.getResumableDurableChatJids()).toContain(chatJid);
    const blocked = op.blockChatOperation(chatJid, owner(childClaim.operation!));
    expect(blocked.status).toBe("applied");
    expect(op.getBlockedDurableChatJids()).toContain(chatJid);
  });

  test("protected children require the exact handoff outcome and cannot externalize recursively or use the public source API", () => {
    const invalidChatJid = jid("protected-invalid-settlement");
    const invalidRoot = register(invalidChatJid, "root");
    const invalidClaim = op.claimNextChatOperation(invalidChatJid).operation!;
    expect(() => op.completeChatOperation(invalidChatJid, {
      owner: owner(invalidClaim), outcome: "interrupted", cause: "generic_interruption", provenance: "test", createdAt: "now",
      artifact: { message: terminal(invalidChatJid, `invalid-cause-handoff-${serial}`) },
      successor: { sourceKind: "protected_continuation", rootSourceSeq: invalidRoot.sourceSeq },
    })).toThrow("interrupted protected handoff outcome");
    expect(() => op.completeChatOperation(invalidChatJid, {
      owner: owner(invalidClaim), outcome: "interrupted", cause: "protected_recovery_continuation_registered", provenance: "test", createdAt: "now",
      artifact: { message: { ...terminal(invalidChatJid, `blank-handoff-${serial}`), content: "  " } },
      successor: { sourceKind: "protected_continuation", rootSourceSeq: invalidRoot.sourceSeq },
    })).toThrow("non-blank scheduling artifact");
    expect(db.getDb().prepare("SELECT 1 FROM chat_accepted_sources WHERE chat_jid = ? AND source_kind = 'protected_continuation'")
      .get(invalidChatJid)).toBeNull();
    expect(db.getDb().prepare("SELECT 1 FROM messages WHERE chat_jid = ? AND is_bot_message = 1")
      .get(invalidChatJid)).toBeNull();

    const chatJid = jid("protected-recursion");
    const root = register(chatJid, "root");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    op.completeChatOperation(chatJid, {
      owner: owner(claimed), outcome: "interrupted", cause: "protected_recovery_continuation_registered",
      provenance: "test", createdAt: "now", artifact: { message: terminal(chatJid, `root-handoff-${serial}`) },
      successor: { sourceKind: "protected_continuation", rootSourceSeq: root.sourceSeq },
    });
    const child = op.claimNextChatOperation(chatJid);
    expect(() => op.completeChatOperation(chatJid, {
      owner: owner(child.operation!), outcome: "interrupted", cause: "protected_recovery_continuation_registered", provenance: "test", createdAt: "later",
      artifact: { message: terminal(chatJid, `child-handoff-${serial}`) },
      successor: { sourceKind: "protected_continuation", rootSourceSeq: child.source!.sourceSeq },
    })).toThrow("non-continuation selectable prompt root");
    expect(op.getChatOperation(chatJid)).toEqual(child.operation);
    expect(() => op.registerAcceptedChatSource({ chatJid, sourceClass: "prompt", sourceKind: "protected_continuation",
      sourceId: "forged", acceptedAt: "now", payloadRef: "accepted-source:1" })).toThrow("only be registered");
  });

  test("terminal artifact policy requires prompt closure, allows control output, and prohibits intent output", () => {
    const prompt = { ...register(jid("policy-prompt"), "a") };
    const controlChat = jid("policy-control");
    op.registerAcceptedChatSource({ chatJid: controlChat, sourceClass: "control", sourceKind: "command", sourceId: "cmd",
      acceptedAt: "now", payloadRef: "command:cmd" });
    const control = op.claimNextChatOperation(controlChat).source!;
    expect(op.chatOperationTerminalArtifactPolicy(prompt, "succeeded")).toBe("required");
    expect(op.chatOperationTerminalArtifactPolicy(control, "succeeded")).toBe("optional");
    expect(op.chatOperationTerminalArtifactPolicy({ ...control, sourceClass: "intent", selectable: false }, "succeeded")).toBe("none");
    const active = op.getChatOperation(controlChat)!;
    expect(op.completeChatOperation(controlChat, { owner: owner(active), outcome: "succeeded", cause: "command",
      provenance: "command", createdAt: "now" }).status).toBe("completed");
    expect(db.getDb().prepare("SELECT cursor_ts FROM chat_cursors WHERE chat_jid = ?").get(controlChat))
      .toEqual({ cursor_ts: "" });

    const followupChat = jid("policy-followup");
    op.registerAcceptedChatSource({ chatJid: followupChat, sourceClass: "prompt", sourceKind: "queued_followup",
      sourceId: "followup-stable", acceptedAt: "accepted-later", payloadRef: "followup:stable" });
    const followup = op.claimNextChatOperation(followupChat).operation!;
    expect(op.completeChatOperation(followupChat, { owner: owner(followup), outcome: "succeeded", cause: "normal",
      provenance: "provider", createdAt: "now", artifact: { message: terminal(followupChat, `followup-bot-${serial}`) } }).status).toBe("completed");
    expect(db.getDb().prepare("SELECT cursor_ts FROM chat_cursors WHERE chat_jid = ?").get(followupChat))
      .toEqual({ cursor_ts: "" });
  });

  test("message operation binding is write-once, same-value-only", () => {
    const chatJid = jid("binding");
    const msg = { ...terminal(chatJid, `bound-${serial}`), operation_id: "op-a" };
    db.storeMessage(msg);
    db.storeMessage({ ...msg, content: "updated" });
    expect(() => db.storeMessage({ ...msg, operation_id: "op-b" })).toThrow("rebound");
    expect(() => db.storeMessage({ ...msg, operation_id: null })).toThrow("cleared");
  });

  test("legacy owner paths cannot create or clear ownership over an active operation", () => {
    const chatJid = jid("reverse-legacy"); register(chatJid, "a");
    op.claimNextChatOperation(chatJid);
    expect(() => db.beginChatRun(chatJid, "next", { prevTs: "prev", messageId: "legacy", startedAt: "now" })).toThrow("excludes legacy ownership");
    expect(() => db.clearInflightMarker(chatJid)).toThrow("excludes legacy ownership");
    expect(() => db.setChatCursor(chatJid, "skip")).toThrow("excludes legacy ownership");
    expect(() => db.getDb().prepare("DELETE FROM chat_cursors WHERE chat_jid = ?").run(chatJid)).toThrow("excludes cursor deletion");
    expect(op.getChatOperation(chatJid)).not.toBeNull();
  });

  test("owner-checked intent acceptance rejects stale/completed owners and persists multiple intents", () => {
    const chatJid = jid("intents"); register(chatJid, "a");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    expect(op.registerChatOperationIntent(chatJid, { ...owner(claimed), generation: 9 }, {
      sourceKind: "steer", sourceId: "stale", acceptedAt: "now", payloadRef: "steer:stale",
    })).toEqual({ status: "rejected", reason: "generation_mismatch" });
    const first = op.registerChatOperationIntent(chatJid, owner(claimed), {
      sourceKind: "steer", sourceId: "one", acceptedAt: "now", payloadRef: "steer:one",
    });
    const second = op.registerChatOperationIntent(chatJid, owner(claimed), {
      sourceKind: "steer", sourceId: "two", acceptedAt: "now", payloadRef: "steer:two",
    });
    expect(first.status).toBe("registered"); expect(second.status).toBe("registered");
    if (first.status === "rejected" || second.status === "rejected") return;
    expect(first.source.operationId).toBe(claimed.operationId);
    expect(second.source.operationId).toBe(claimed.operationId);
    expect(op.getAcceptedChatSource(first.source.sourceSeq)).toEqual(first.source);
    const completed = op.completeChatOperation(chatJid, { owner: owner(claimed), outcome: "succeeded", cause: "normal",
      provenance: "provider", createdAt: "now", artifact: { message: terminal(chatJid, `intent-bot-${serial}`) },
      intentDispositions: [
        { sourceSeq: first.source.sourceSeq, outcome: "succeeded", cause: "applied", provenance: "steer" },
        { sourceSeq: second.source.sourceSeq, outcome: "succeeded", cause: "applied", provenance: "steer" },
      ] });
    expect(completed.status).toBe("completed");
    expect(op.registerChatOperationIntent(chatJid, owner(claimed), {
      sourceKind: "steer", sourceId: "late", acceptedAt: "now", payloadRef: "steer:late",
    })).toEqual({ status: "rejected", reason: "no_operation" });
  });

  test("rename preserves operation lookup, cleanup retains terminal evidence, and explicit branch deletion removes it", () => {
    const chatJid = jid("lifecycle"); const renamed = `operation:renamed-lifecycle:${serial}`;
    db.storeChatMetadata(chatJid, "2026-08-07T22:00:00Z", "Lifecycle");
    db.ensureChatBranch({ chat_jid: chatJid });
    const source = register(chatJid, "a"); const claimed = op.claimNextChatOperation(chatJid).operation!;
    complete(chatJid, claimed, `lifecycle-bot-${serial}`);
    const row = db.getDb().prepare("SELECT rowid FROM messages WHERE chat_jid = ? AND operation_id = ?")
      .get(chatJid, claimed.operationId) as { rowid: number };
    expect(() => db.storeMessage({ ...terminal(chatJid, `lifecycle-bot-${serial}`), is_bot_message: false,
      operation_id: claimed.operationId })).toThrow("terminal operation evidence is immutable");
    expect(() => db.replaceMessageContent(chatJid, row.rowid, "demote", { isTerminalAgentReply: false }))
      .toThrow("terminal operation evidence is immutable");
    expect(() => db.deleteMessageByRowId(chatJid, row.rowid)).toThrow("Terminal operation evidence");
    expect(() => db.deleteThreadByRowId(chatJid, row.rowid)).toThrow("Terminal operation evidence");
    expect(() => db.getDb().prepare("DELETE FROM messages WHERE chat_jid = ? AND rowid = ?")
      .run(chatJid, row.rowid)).toThrow("terminal operation evidence cannot be deleted");
    expect(() => db.getDb().prepare("UPDATE chat_operation_dispositions SET outcome = 'failed' WHERE source_seq = ?")
      .run(source.sourceSeq)).toThrow("operation disposition is immutable");
    db.renameChatJid(chatJid, renamed);
    expect(op.getAcceptedChatSource(source.sourceSeq)?.chatJid).toBe(renamed);
    expect(op.getChatOperationDisposition(source.sourceSeq)?.terminalMessageChatJid).toBe(renamed);
    db.archiveChatBranch(renamed);
    const exported = db.exportArchivedBranchDownloadData(renamed);
    expect(exported.accepted_sources).toHaveLength(1);
    expect(exported.operation_dispositions).toHaveLength(1);
    db.permanentDeleteArchivedBranch(renamed);
    expect(op.getAcceptedChatSource(source.sourceSeq)).toBeNull();
    expect(op.getChatOperationDisposition(source.sourceSeq)).toBeNull();
    expect(db.getDb().prepare("SELECT 1 FROM messages WHERE chat_jid = ?").get(renamed)).toBeNull();
  });

  test("branch merge rejects pending work and preserves completed operation history", () => {
    const parentJid = jid("merge-parent");
    db.storeChatMetadata(parentJid, "now", "Parent");
    const parent = db.ensureChatBranch({ chat_jid: parentJid });
    const pendingJid = jid("merge-pending");
    db.storeChatMetadata(pendingJid, "now", "Pending");
    db.ensureChatBranch({ chat_jid: pendingJid, root_chat_jid: parent.root_chat_jid, parent_branch_id: parent.branch_id });
    register(pendingJid, "pending");
    expect(() => db.mergeChatBranchIntoParent(pendingJid)).toThrow("active or undisposed accepted work");

    const completedJid = jid("merge-completed");
    db.storeChatMetadata(completedJid, "now", "Completed");
    db.ensureChatBranch({ chat_jid: completedJid, root_chat_jid: parent.root_chat_jid, parent_branch_id: parent.branch_id });
    const source = register(completedJid, "completed");
    complete(completedJid, op.claimNextChatOperation(completedJid).operation!, `merge-bot-${serial}`);
    db.mergeChatBranchIntoParent(completedJid);
    expect(op.getAcceptedChatSource(source.sourceSeq)?.chatJid).toBe(parentJid);
    expect(op.getChatOperationDisposition(source.sourceSeq)?.chatJid).toBe(parentJid);
    expect(op.getChatOperationDisposition(source.sourceSeq)?.terminalMessageChatJid).toBe(parentJid);
  });

  test("shared blocked skip atomically disposes the frontier and intents and is idempotent", () => {
    const chatJid = jid("blocked-skip");
    const source = register(chatJid, "blocked-source");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const intent = op.registerChatOperationIntent(chatJid, owner(claimed), {
      sourceKind: "steer", sourceId: "blocked-intent", acceptedAt: "now", payloadRef: "steer:blocked-intent",
    });
    if (intent.status !== "registered") throw new Error("expected intent");
    const blocked = op.blockChatOperation(chatJid, owner(claimed));
    if (blocked.status !== "applied") throw new Error("expected block");
    const request = { cause: "operator_skip_failed", provenance: "test", createdAt: "2026-08-07T22:03:00Z" };

    const skipped = op.skipBlockedChatOperation(chatJid, owner(blocked.operation), request);
    expect(skipped.status).toBe("completed");
    expect(op.getChatOperation(chatJid)).toBeNull();
    expect(op.getChatOperationDisposition(source.sourceSeq)).toMatchObject({
      outcome: "skipped", cause: request.cause, provenance: request.provenance, terminalMessageId: null,
    });
    expect(op.getChatOperationDisposition(intent.source.sourceSeq)).toMatchObject({
      outcome: "skipped", cause: request.cause, provenance: request.provenance, terminalMessageId: null,
    });
    expect(db.getChatCursor(chatJid)).toBe(source.frontierCursorTs);
    expect(op.skipBlockedChatOperation(chatJid, owner(blocked.operation), request)).toEqual({
      status: "repeated",
      disposition: skipped.status === "completed" ? skipped.disposition : null,
    });
  });

  test("blocked skip rolls back at every completion boundary and remains retryable", () => {
    for (const boundary of ["artifact", "successor", "intents", "disposition", "frontier", "release"] as const) {
      const chatJid = jid(`blocked-skip-${boundary}`);
      const source = register(chatJid, `blocked-${boundary}`);
      const claimed = op.claimNextChatOperation(chatJid).operation!;
      const blocked = op.blockChatOperation(chatJid, owner(claimed));
      if (blocked.status !== "applied") throw new Error("expected block");
      const blockedOwner = owner(blocked.operation);
      const resolution = { cause: "operator_skip_failed", provenance: "test", createdAt: "now" };

      expect(() => op.skipBlockedChatOperation(chatJid, blockedOwner, resolution, {
        afterWrite(point) { if (point === boundary) throw new Error(`fault:${point}`); },
      })).toThrow(`fault:${boundary}`);
      expect(op.getChatOperation(chatJid)).toEqual(blocked.operation);
      expect(op.getChatOperationDisposition(source.sourceSeq)).toBeNull();
      expect(op.skipBlockedChatOperation(chatJid, blockedOwner, resolution).status).toBe("completed");
    }
  });

  test("blocked retry wins owner races without allowing a stale skip", () => {
    const chatJid = jid("blocked-race"); register(chatJid, "blocked-source");
    const claimed = op.claimNextChatOperation(chatJid).operation!;
    const blocked = op.blockChatOperation(chatJid, owner(claimed));
    if (blocked.status !== "applied") throw new Error("expected block");
    const blockedOwner = owner(blocked.operation);

    const retried = op.retryBlockedChatOperation(chatJid, blockedOwner);
    expect(retried.status).toBe("applied");
    expect(op.skipBlockedChatOperation(chatJid, blockedOwner, {
      cause: "stale_skip", provenance: "test", createdAt: "now",
    })).toMatchObject({ status: "rejected", reason: "phase_mismatch" });
    expect(op.getChatOperation(chatJid)).toEqual(retried.status === "applied" ? retried.operation : null);
  });

  test("restart discovery finds unclaimed and active durable work but holds blocked operations", () => {
    const chatJid = jid("restart-discovery");
    register(chatJid, "restart-source");
    expect(op.getResumableDurableChatJids()).toContain(chatJid);
    expect(op.getBlockedDurableChatJids()).not.toContain(chatJid);

    const claim = op.claimNextChatOperation(chatJid);
    if (claim.status !== "claimed") throw new Error("expected claim");
    expect(op.getResumableDurableChatJids()).toContain(chatJid);
    expect(op.blockChatOperation(chatJid, owner(claim.operation)).status).toBe("applied");
    expect(op.getResumableDurableChatJids()).not.toContain(chatJid);
    expect(op.getBlockedDurableChatJids()).toContain(chatJid);
  });

  test("claim rejects legacy ownership and ignores non-selectable operation-bound steer intents", () => {
    const chatJid = jid("legacy"); const source = register(chatJid, "a");
    db.getDb().prepare("INSERT INTO chat_cursors (chat_jid, cursor_ts, inflight_message_id) VALUES (?, '', 'legacy')").run(chatJid);
    expect(op.claimNextChatOperation(chatJid).status).toBe("legacy_conflict");
    db.getDb().prepare("UPDATE chat_cursors SET inflight_message_id = NULL WHERE chat_jid = ?").run(chatJid);
    expect(op.claimNextChatOperation(chatJid).source?.sourceSeq).toBe(source.sourceSeq);
  });
});
