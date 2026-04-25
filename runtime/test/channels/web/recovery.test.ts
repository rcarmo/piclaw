import { describe, expect, test } from "bun:test";
import {
  recoverInflightRuns,
  recoverStaleInflightRun,
  resumePendingChats,
  type WebRecoveryContext,
  type WebRecoveryStore,
} from "../../../src/channels/web/runtime/recovery.js";
import { AgentQueue } from "../../../src/queue.js";
import { waitFor } from "../../helpers.js";

describe("web recovery helpers", () => {
  test("recoverInflightRuns preserves terminal/partial output and marks no-output runs as interrupted without replay", async () => {
    const now = new Date("2026-01-01T00:05:00Z");
    const inflights = [
      { chatJid: "web:1", prevTs: "t1", messageId: "m1", startedAt: "2026-01-01T00:04:00Z" },
      { chatJid: "web:2", prevTs: "t2", messageId: "m2", startedAt: "2026-01-01T00:04:15Z" },
      { chatJid: "web:3", prevTs: "t3", messageId: "m3", startedAt: "2026-01-01T00:04:30Z" },
    ];

    const cleared: string[] = [];
    const rolledBack: Array<{ chatJid: string; prevTs: string }> = [];
    const enqueued: Array<{ key: string; laneKey?: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string }> = [];
    const replyChecks: Array<{ chatJid: string; afterTs: string }> = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key, laneKey) => {
        enqueued.push({ task, key, laneKey });
      },
      processChat: async (chatJid, agentId) => {
        processed.push({ chatJid, agentId });
      },
      now: () => now.getTime(),
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => inflights,
      transaction: (run) => run(),
      getAgentReplyStateAfter: (chatJid, afterTs) => {
        replyChecks.push({ chatJid, afterTs });
        if (chatJid === "web:1") return "terminal";
        if (chatJid === "web:2") return "partial";
        return "none";
      },
      clearInflightMarker: (chatJid) => {
        cleared.push(chatJid);
      },
      rollbackInflightRun: (chatJid, prevTs) => {
        rolledBack.push({ chatJid, prevTs });
      },
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    recoverInflightRuns(ctx, store);

    expect(replyChecks).toEqual([
      { chatJid: "web:1", afterTs: "2026-01-01T00:04:00Z" },
      { chatJid: "web:2", afterTs: "2026-01-01T00:04:15Z" },
      { chatJid: "web:3", afterTs: "2026-01-01T00:04:30Z" },
    ]);
    expect(cleared).toEqual(["web:1", "web:2", "web:3"]);
    expect(rolledBack).toEqual([]);
    expect(enqueued.map(({ key, laneKey }) => ({ key, laneKey }))).toEqual([]);
  });

  test("recoverInflightRuns persists a buffered draft instead of an interrupted marker when restart recovery has visible text", () => {
    const cleared: string[] = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: async () => {},
      processChat: async () => {},
      getDraftRecovery: (chatJid) => chatJid === "web:draft"
        ? { turnId: "turn-draft", text: "Recovered draft after restart", totalLines: 1, updatedAt: Date.now() }
        : null,
      clearDraftRecovery: (chatJid) => {
        cleared.push(chatJid);
      },
      now: () => new Date("2026-01-01T00:05:00Z").getTime(),
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [{ chatJid: "web:draft", prevTs: "t0", messageId: "m1", startedAt: "2026-01-01T00:04:00Z" }],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    recoverInflightRuns(ctx, store);

    expect(cleared).toEqual(["web:draft"]);
  });

  test("recoverInflightRuns clears stale inflight markers without replay", () => {
    const staleStartedAt = "2026-01-01T00:00:00Z";
    const now = new Date("2026-01-01T01:00:00Z").getTime();

    const inflights = [
      { chatJid: "web:stale", prevTs: "t0", messageId: "m1", startedAt: staleStartedAt },
    ];

    const cleared: string[] = [];
    const rolledBack: Array<{ chatJid: string; prevTs: string }> = [];
    const enqueued: string[] = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (_task, key) => { enqueued.push(key); },
      processChat: async () => {},
      now: () => now,
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => inflights,
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: (chatJid) => { cleared.push(chatJid); },
      rollbackInflightRun: (chatJid, prevTs) => { rolledBack.push({ chatJid, prevTs }); },
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    recoverInflightRuns(ctx, store);

    expect(cleared).toEqual(["web:stale"]);
    expect(rolledBack).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  test("recoverStaleInflightRun clears and marks an old no-output inflight chat without replay", () => {
    const enqueued: string[] = [];
    const cleared: string[] = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (_task, key) => { enqueued.push(key); },
      processChat: async () => {},
      now: () => new Date("2026-01-01T00:01:00Z").getTime(),
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [{ chatJid: "web:ux", prevTs: "t-prev", messageId: "m1", startedAt: "2026-01-01T00:00:00Z" }],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: (chatJid) => { cleared.push(chatJid); },
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    const recovered = recoverStaleInflightRun(ctx, "web:ux", { hasActiveStatus: false, minAgeMs: 15_000 }, store);
    expect(recovered).toBe(true);
    expect(cleared).toEqual(["web:ux"]);
    expect(enqueued).toEqual([]);
  });

  test("recoverStaleInflightRun does nothing while a live status exists or the grace period has not elapsed", () => {
    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: () => {},
      processChat: async () => {},
      now: () => new Date("2026-01-01T00:00:10Z").getTime(),
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [{ chatJid: "web:ux", prevTs: "t-prev", messageId: "m1", startedAt: "2026-01-01T00:00:00Z" }],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => { throw new Error("should not clear"); },
      rollbackInflightRun: () => { throw new Error("should not roll back"); },
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    expect(recoverStaleInflightRun(ctx, "web:ux", { hasActiveStatus: true, minAgeMs: 15_000 }, store)).toBe(false);
    expect(recoverStaleInflightRun(ctx, "web:ux", { hasActiveStatus: false, minAgeMs: 15_000 }, store)).toBe(false);
  });

  test("recoverStaleInflightRun also clears interrupted branch chats without replay", () => {
    const enqueued: string[] = [];
    const cleared: string[] = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (_task, key) => { enqueued.push(key); },
      processChat: async () => {},
      now: () => new Date("2026-01-01T00:01:00Z").getTime(),
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [{ chatJid: "web:default:branch:abc123", prevTs: "t-prev", messageId: "m1", startedAt: "2026-01-01T00:00:00Z" }],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: (chatJid) => { cleared.push(chatJid); },
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    const recovered = recoverStaleInflightRun(ctx, "web:default:branch:abc123", { hasActiveStatus: false, minAgeMs: 15_000 }, store);
    expect(recovered).toBe(true);
    expect(cleared).toEqual(["web:default:branch:abc123"]);
    expect(enqueued).toEqual([]);
  });

  test("recoverInflightRuns clears root and branch interrupted runs without replay", () => {
    const enqueued: string[] = [];
    const cleared: string[] = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (_task, key) => {
        enqueued.push(key);
      },
      processChat: async () => {},
      now: () => new Date("2026-01-01T00:05:00Z").getTime(),
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [
        { chatJid: "web:default", prevTs: "t1", messageId: "m1", startedAt: "2026-01-01T00:04:00Z" },
        { chatJid: "web:default:branch:abc123", prevTs: "t2", messageId: "m2", startedAt: "2026-01-01T00:04:10Z" },
      ],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: (chatJid) => { cleared.push(chatJid); },
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    recoverInflightRuns(ctx, store);

    expect(enqueued).toEqual([]);
    expect(cleared).toEqual(["web:default", "web:default:branch:abc123"]);
  });

  test("recoverInflightRuns stops when transaction fails", () => {
    const enqueued: string[] = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (_task, key) => {
        enqueued.push(key);
      },
      processChat: async () => {},
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [{ chatJid: "web:1", prevTs: "t1", messageId: "m1", startedAt: "s1" }],
      transaction: () => {
        throw new Error("boom");
      },
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({}),
      getKnownChatJids: () => [],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [],
    };

    recoverInflightRuns(ctx, store);
    expect(enqueued).toHaveLength(0);
  });

  test("resumePendingChats enqueues only chats with pending messages", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string }> = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async (chatJid, agentId) => {
        processed.push({ chatJid, agentId });
      },
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({ "web:1": "t1", "web:2": "t2" }),
      getKnownChatJids: () => ["web:1", "web:2"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: (chatJid) => (chatJid === "web:2" ? [{ id: "m" }] : []),
    };

    resumePendingChats(ctx, undefined, store);

    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:2"]);
    await enqueued[0].task();
    expect(processed).toEqual([{ chatJid: "web:2", agentId: "default" }]);
  });

  test("resumePendingChats scans known chats even when a cursor row is missing", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];
    const calls: Array<{ chatJid: string; since: string }> = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async () => {},
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({ "web:known": "t1" }),
      getKnownChatJids: () => ["web:known", "web:new"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: (chatJid, since) => {
        calls.push({ chatJid, since });
        return chatJid === "web:new" ? [{ id: "new-msg" }] : [];
      },
    };

    resumePendingChats(ctx, undefined, store);

    expect(calls).toContainEqual({ chatJid: "web:new", since: "" });
    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:new"]);
  });

  test("resumePendingChats isolates an explicit chat branch from sibling pending chats", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];
    const calls: Array<{ chatJid: string; since: string }> = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async () => {},
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({
        "web:default": "t-root",
        "web:default:branch:research": "t-branch",
      }),
      getKnownChatJids: () => ["web:default", "web:default:branch:research"],
      getDeferredQueuedFollowups: (chatJid) =>
        chatJid === "web:default:branch:research"
          ? [{ rowId: -1, queuedContent: "branch queued", threadId: null, queuedAt: "2026-01-01T00:00:00.000Z" }]
          : [{ rowId: -2, queuedContent: "root queued", threadId: null, queuedAt: "2026-01-01T00:00:01.000Z" }],
      getMessagesSince: (chatJid, since) => {
        calls.push({ chatJid, since });
        return chatJid === "web:default:branch:research" ? [{ id: "branch-msg" }] : [{ id: "root-msg" }];
      },
    };

    resumePendingChats(ctx, "web:default:branch:research", store);

    expect(calls).toEqual([{ chatJid: "web:default:branch:research", since: "t-branch" }]);
    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:default:branch:research"]);
  });

  test("resumePendingChats enqueues deferred-only queued followups", async () => {
    const enqueued: Array<{ key: string; task: () => Promise<void> }> = [];

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        enqueued.push({ key, task });
      },
      processChat: async () => {},
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({ "web:queue-only": "" }),
      getKnownChatJids: () => ["web:queue-only"],
      getDeferredQueuedFollowups: () => [{ rowId: -1, queuedContent: "queued after restart", threadId: null, queuedAt: "2026-01-01T00:00:00.000Z" }],
      getMessagesSince: () => [],
    };

    resumePendingChats(ctx, undefined, store);

    expect(enqueued.map((item) => item.key)).toEqual(["resume:web:queue-only"]);
  });

  test("inflight recovery and resume_pending collapse to one queued replay per chat", async () => {
    const queue = new AgentQueue();
    const processed: string[] = [];
    let resolveRun: (() => void) | null = null;
    const runGate = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    const ctx: WebRecoveryContext = {
      assistantName: "Pi",
      defaultAgentId: "default",
      enqueue: (task, key) => {
        queue.enqueue(task, key);
      },
      processChat: async (chatJid) => {
        processed.push(chatJid);
        await runGate;
      },
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [{ chatJid: "web:1", prevTs: "t0", messageId: "m1", startedAt: "s1" }],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({ "web:1": "t0" }),
      getKnownChatJids: () => ["web:1"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: () => [{ id: "m1" }],
    };

    recoverInflightRuns(ctx, store);
    resumePendingChats(ctx, undefined, store);
    await waitFor(() => processed.length === 1, 250, 1);

    expect(processed).toEqual(["web:1"]);

    resolveRun?.();
    await queue.shutdown(50);
  });
});
