import { describe, expect, test } from "bun:test";

import { withTempWorkspaceEnv } from "../../../helpers.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setChatCursor, closeDatabase, getDb, getDeferredQueuedFollowups, setDeferredQueuedFollowups, getMessageByRowId, storeMessage, storeChatMetadata, getChatCursor, initDatabase } from "../../../../src/db.js";
import {
  buildStalledWorkDiagnostic,
  WebAgentControlPlaneService,
} from "../../../../src/channels/web/agent/agent-control-plane-service.js";
import { QueuedFollowupLifecycleService, type QueuedInputSourceAdmission } from "../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js";

import { installServiceWorkSchema } from "../../../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../../src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../../src/service-effects/contracts/common.js";
import { createDurableQueuedSteering } from "../../../../src/agent-pool/durable-queued-steering.js";
import { createDurableConversationAdapter, type DurableAcceptedInput } from "../../../../src/agent-pool/durable-runtime-adapter.js";
import { storeWebMessage } from "../../../../src/channels/web/messaging/message-store.js";

function seal<T extends { effect: { requestHash: string } }>(request: T): T {
  request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
  return request;
}

async function nativeQueueFixture() {
  initDatabase();
  const database = getDb();
  installServiceWorkSchema(database);
  const lifecycle = new QueuedFollowupLifecycleService();
  const made = createCurrentPiclawServiceWorkStore(database, {
    hitFault: () => false, recordTrace() {}, validateAcceptance: () => true,
  });
  if (!made.ok) throw Error("work fixture");
  const work = made.value;
  const effect = (key: string) => ({ idempotencyKey: key, requestHash: "", operationId: null, sourceSeq: null,
    provenanceRef: "host:queue", redactionClass: "private" as const });
  const digest = (item: Record<string, unknown>) => {
    const { source_accepted, materializeRetries, ...immutable } = item;
    return hashCanonicalRequest(JSON.parse(JSON.stringify(immutable)) as CanonicalJsonValue);
  };
  const accept: QueuedInputSourceAdmission = ({ chatJid, item, database }) => {
    work.acceptSourceInTransaction(seal({ effect: { ...effect(`accept:${item.source_id}`), provenanceRef: digest(item) },
      chatJid, sourceId: item.source_id, kind: "message", payloadRef: `queued-source:${item.source_id}`,
      targetOperationId: null, parentSourceSeq: null, acceptedAt: item.queuedAt, createWakeIntent: false }), database);
  };
  const enqueue = (chat: string, content: string) => lifecycle.admitQueuedFollowupItem([chat, 0, content],
    () => {}, new AbortController().signal, accept);
  const snapshot = () => ["sources", "chats", "operations", "operation_sources", "intents", "queued_inputs", "decisions", "wake_intents"]
    .map(table => database.query(`SELECT * FROM service_effect_s01_${table}`).all())
    .concat([database.query("SELECT * FROM messages").all(), database.query("SELECT * FROM router_state").all()]);
  return { database, lifecycle, work, effect, digest, enqueue, snapshot };
}

async function withQueueFixture(run: (fixture: Awaited<ReturnType<typeof nativeQueueFixture>>) => Promise<void>) {
  await withTempWorkspaceEnv("control-plane-queue-", {}, async ws => {
    mkdirSync(join(ws.workspace, ".piclaw"), { recursive: true });
    writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
    try { await run(await nativeQueueFixture()); } finally { closeDatabase(); }
  });
}

function abortRequest(payload: unknown): Request {
  return new Request("https://example.com/agent/runs/abort", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type QueueLifecycleStub = Pick<
  QueuedFollowupLifecycleService,
  "getQueuedFollowupCount" | "listQueuedStateItems" | "removeQueuedFollowupForAction" | "reorderQueuedFollowupItems"
>;

function createService(overrides: Partial<ConstructorParameters<typeof WebAgentControlPlaneService>[0]> = {}) {
  const queueLifecycle: QueueLifecycleStub = {
    getQueuedFollowupCount: () => 0,
    listQueuedStateItems: () => [],
    reorderQueuedFollowupItems: async () => false,
    removeQueuedFollowupForAction: async () => ({ removed: null, source: null }),
  };

  return new WebAgentControlPlaneService({
    defaultChatJid: "web:default",
    defaultAgentId: "default",
    json: jsonResponse,
    broadcastEvent: () => {},
    queue: { enqueue: () => {} },
    agentPool: { setSessionBinder: () => {} },
    queuedFollowupLifecycle: queueLifecycle,
    storeMessage: () => null,
    processChat: () => {},
    ...overrides,
  });
}

for (const [handler, method, payload, contextIndex] of [
  ['handleAgentRootSessionCreate', 'createRootChatSession', { agent_name: 'new-root' }, 1],
  ['handleAgentBranchRename', 'renameChatBranch', { chat_jid: 'web:control', agent_name: 'renamed' }, 1],
  ['handleAgentRenameJid', 'renameChatJid', { old_jid: 'web:control', new_jid: 'web:renamed' }, 2],
  ['handleAgentBranchMergeParent', 'mergeChatBranchIntoParent', { chat_jid: 'web:control' }, 1],
  ['handleAgentBranchPrune', 'pruneChatBranch', { chat_jid: 'web:control' }, 1],
  ['handleAgentBranchPurge', 'permanentPurgeChatBranch', { chat_jid: 'web:control' }, 1],
  ['handleAgentBranchRestore', 'restoreChatBranch', { chat_jid: 'web:control', agent_name: 'restored' }, 1],
] as const) for (const revoked of [false, true]) {
  test(`branch HTTP captures original authority before JSON and forwards request cancellation: ${method}/${revoked}`, async () => {
    const events: string[] = [];
    let current = 1, captures = 0, applied = 0;
    let release!: () => void;
    const parsed = new Promise<void>(resolve => { release = resolve; });
    const req = abortRequest(payload), read = req.json.bind(req);
    req.json = async () => { events.push('parse'); await parsed; return read(); };
    let captured!: () => void;
    const branch = { chat_jid: 'web:control', agent_name: 'fixture' };
    const service = createService({
      captureWriteAuthority(request) {
        expect(request).toBe(req); events.push('capture'); captures++;
        const version = current;
        captured = () => { if (current !== version) throw Error('original request revoked'); };
        return captured;
      },
      agentPool: { [method]: async (...args: unknown[]) => {
        events.push('pool');
        const context = args[contextIndex] as { signal: AbortSignal; authorise: () => void };
        expect(context.signal).toBe(req.signal); expect(context.authorise).toBe(captured);
        context.authorise(); applied++;
        return method === 'renameChatJid' ? { oldJid: 'web:control', newJid: 'web:renamed', branch }
          : method === 'mergeChatBranchIntoParent' ? { source: branch, parent: branch, counts: {} }
            : method === 'permanentPurgeChatBranch' ? { branch, removedSessionArtifacts: [] } : branch;
      } } as any,
    });
    const pending = service[handler](req);
    try {
      expect(events).toEqual(['capture', 'parse']);
      if (revoked) current++;
      release();
      const response = await pending;
      expect(response.status).toBe(revoked ? 400 : method === 'createRootChatSession' ? 201 : 200);
      if (revoked) expect((await response.json() as { error: string }).error).toContain('original request revoked');
      expect(captures).toBe(1); expect(applied).toBe(revoked ? 0 : 1);
      expect(events).toEqual(['capture', 'parse', 'pool']);
    } finally { release(); await pending; }
  });
}

describe("native abort terminal status ownership", () => {
  for (const scenario of ["idle", "successor", "failure", "compaction"] as const) {
    test(`${scenario}: only a settled abort may clear its captured status`, async () => {
      let status: Record<string, unknown> = { type: "intent", turn_id: "captured", source: "startup_recovery" };
      if (scenario === "compaction") status.intent_key = "compaction";
      const updates: unknown[] = [], events: unknown[] = [];
      const service = createService({
        getAgentStatus: () => ({ ...status }), // recovery getters need not preserve object identity
        updateAgentStatus: (_jid, next) => { updates.push(next); status = next; },
        broadcastEvent: (_type, payload) => { events.push(payload); },
        agentPool: { applyControlCommand: async () => {
          if (scenario === "successor") status = { type: "intent", turn_id: "newer" };
          return { status: scenario === "failure" ? "error" : "success", message: scenario === "failure" ? "settlement uncertain" : "No active durable operation." };
        } } as any,
      });
      const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:default", turn_id: "captured" }));
      expect(response.status).toBe(scenario === "failure" ? 500 : 200);
      if (scenario === "idle") {
        expect(status).toMatchObject({ type: "done", title: "Idle", turn_id: "captured" });
        expect(updates).toHaveLength(1); expect(events).toHaveLength(1);
      } else {
        expect(status.type).toBe("intent");
        expect(updates).toEqual([]); expect(events).toEqual([]);
      }
    });
  }
});

describe("buildStalledWorkDiagnostic", () => {
  const progress = {
    chatJid: "web:tool-run",
    phase: "tool_execution" as const,
    startedAt: Date.parse("2026-08-07T12:00:00.000Z"),
    lastProgressAt: Date.parse("2026-08-07T12:00:20.000Z"),
  };

  test("uses progress age rather than treating every tool-execution phase as stale", () => {
    expect(buildStalledWorkDiagnostic(progress, {
      nowMs: Date.parse("2026-08-07T12:00:50.000Z"),
      thresholdMs: 60_000,
    })).toEqual({
      detected: false,
      phase: "tool_execution",
      age_ms: 30_000,
      threshold_ms: 60_000,
      started_at: "2026-08-07T12:00:00.000Z",
      last_progress_at: "2026-08-07T12:00:20.000Z",
    });
  });

  test("reports stalled work only after the configured threshold", () => {
    expect(buildStalledWorkDiagnostic(progress, {
      nowMs: Date.parse("2026-08-07T12:01:20.000Z"),
      thresholdMs: 60_000,
    })).toMatchObject({ detected: true, age_ms: 60_000, threshold_ms: 60_000 });
  });

  test("keeps age diagnostics without claiming a stall when detection is disabled", () => {
    expect(buildStalledWorkDiagnostic(progress, {
      nowMs: Date.parse("2026-08-07T12:10:20.000Z"),
      thresholdMs: 0,
    })).toMatchObject({ detected: false, age_ms: 600_000, threshold_ms: null });
  });
});

describe("WebAgentControlPlaneService", () => {
  test("persists provider-ready OOBE completion at the instance level", async () => {
    initDatabase();
    const service = createService();
    const response = await service.handleAgentOobeComplete(new Request("https://example.com/agent/oobe/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "provider-ready" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      kind: "provider-ready",
      provider_ready_completed_instance: true,
    });
  });

  test("shapes autoresearch control responses with default chat fallbacks", async () => {
    const statusChats: string[] = [];
    const stopInputs: Array<{ chat_jid: string; generate_report: boolean }> = [];
    const dismissChats: string[] = [];
    const service = createService({
      getAutoresearchWidgetPayload: (chatJid) => {
        statusChats.push(chatJid);
        return { chat_jid: chatJid, live: true };
      },
      stopAutoresearchFromWeb: async (input) => {
        stopInputs.push(input);
        return { stopped: true };
      },
      dismissAutoresearchWidget: (chatJid) => {
        dismissChats.push(chatJid);
        return false;
      },
    });

    const statusResponse = await service.handleAutoresearchStatus(new Request("https://example.com/agent/autoresearch/status"));
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({ chat_jid: "web:default", live: true });

    const stopResponse = await service.handleAutoresearchStop(new Request("https://example.com/agent/autoresearch/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generate_report: false }),
    }));
    expect(stopResponse.status).toBe(200);
    expect(await stopResponse.json()).toEqual({
      status: "ok",
      chat_jid: "web:default",
      result: { stopped: true },
    });

    const dismissResponse = await service.handleAutoresearchDismiss(new Request("https://example.com/agent/autoresearch/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:branch" }),
    }));
    expect(dismissResponse.status).toBe(200);
    expect(await dismissResponse.json()).toEqual({
      status: "noop",
      chat_jid: "web:branch",
    });

    expect(statusChats).toEqual(["web:default"]);
    expect(stopInputs).toEqual([{ chat_jid: "web:default", generate_report: false }]);
    expect(dismissChats).toEqual(["web:branch"]);
  });

  test("shapes queue state and queue removal responses via queued follow-up lifecycle dependency", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const queueLifecycle: QueueLifecycleStub = {
      getQueuedFollowupCount: (chatJid: string) => (chatJid === "web:branch" ? 1 : 0),
      listQueuedStateItems: () => [{ row_id: 7, content: "queued followup", timestamp: "2024-01-01T00:00:00.000Z", thread_id: 11 }],
      reorderQueuedFollowupItems: async () => false,
      removeQueuedFollowupForAction: async () => ({
        removed: {
          rowId: 7,
          queuedContent: "queued followup",
          threadId: 11,
          queuedAt: "2024-01-01T00:00:00.000Z",
          materializeRetries: 0,
        },
        source: "deferred",
      }),
    };
    const service = createService({
      broadcastEvent: (type, data) => {
        events.push({ type, data });
      },
      queuedFollowupLifecycle: queueLifecycle,
    });

    const stateResponse = await service.handleAgentQueueState(new Request("https://example.com/agent/queue-state?chat_jid=web%3Abranch"));
    expect(stateResponse.status).toBe(200);
    expect(await stateResponse.json()).toEqual({
      count: 1,
      items: [{ row_id: 7, content: "queued followup", timestamp: "2024-01-01T00:00:00.000Z", thread_id: 11 }],
    });

    const removeResponse = await service.handleAgentQueueRemove(new Request("https://example.com/agent/queue-remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:branch", row_id: 7 }),
    }));
    expect(removeResponse.status).toBe(200);
    expect(await removeResponse.json()).toEqual({
      status: "ok",
      removed: true,
      row_id: 7,
      count: 1,
    });
    expect(events).toEqual([
      {
        type: "agent_followup_removed",
        data: { chat_jid: "web:branch", row_id: 7, thread_id: 11 },
      },
    ]);
  });

  test("manual, historical and placeholder steering conflicts preserve visibility, identity and FIFO", async () => {
    await withQueueFixture(async f => {
      const chat = "web:unaccepted";
      storeChatMetadata(chat, "2026-08-14T09:00:00.000Z", "Fixture");
      const manual = f.lifecycle.enqueueQueuedFollowupItem(chat, 0, "  unchanged input  ");
      const historical = -100;
      setDeferredQueuedFollowups(chat, [...getDeferredQueuedFollowups(chat), {
        rowId: historical, queuedContent: "historical input", queuedAt: "2024-01-01T00:00:00.000Z",
      }]);
      const placeholder = storeMessage({ id: "local-placeholder", chat_jid: chat, sender: "agent", sender_name: "Pi",
        content: "\u2063", timestamp: "2026-08-14T09:00:00.000Z", is_from_me: false, is_bot_message: true });
      f.lifecycle.enqueuePlaceholder(chat, placeholder, "  unchanged input  ");
      const before = f.snapshot(), queued = f.lifecycle.getQueuedFollowupItems(chat);
      let effects = 0;
      const forbidden = () => { effects++; throw Error("must not enter submission/removal/publication"); };
      const service = createService({ queuedFollowupLifecycle: f.lifecycle,
        getAcceptedQueuedSteering: forbidden, getQueuedInputSourceWithdrawal: forbidden,
        broadcastEvent: forbidden, storeMessage: forbidden,
        processChat: forbidden, queue: { enqueue: forbidden },
      });
      for (const rowId of [manual, historical, placeholder]) {
        const response = await service.handleAgentQueueSteer(abortRequest({ chat_jid: chat, row_id: rowId, source_accepted: true, source_id: "forged" }));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: "Queued input is not accepted for steering." });
        expect(f.snapshot()).toEqual(before);
        expect(f.lifecycle.getQueuedFollowupItems(chat)).toEqual(queued);
      }
      expect(effects).toBe(0);
      const missing = await service.handleAgentQueueSteer(abortRequest({ chat_jid: chat, row_id: -999 }));
      expect(missing.status).toBe(200);
      expect(await missing.json()).toEqual({ status: "ok", removed: false, count: 3 });
      expect(f.lifecycle.listQueuedStateItems(chat).map(item => item.row_id)).toEqual([manual, historical, placeholder]);
      expect(f.lifecycle.consumeQueuedFollowupItem(chat)).toEqual(queued[0]);
      expect(f.lifecycle.consumeQueuedFollowupItem(chat)).toEqual(queued[1]);
      expect(f.lifecycle.consumeQueuedFollowupPlaceholder(chat)).toBe(placeholder);
      expect(f.database.query("SELECT * FROM service_effect_s01_sources").all()).toEqual([]);
    });
  });

  for (const failure of ["none", "lost-ack", "publication", "fenced", "missing-port"] as const) {
    test(`accepted steering uses captured native intent port and the same source identity; ${failure}`, async () => {
      await withQueueFixture(async f => {
        const chat = "web:native-steer";
        storeChatMetadata(chat, "2026-08-14T09:00:00.000Z", "Fixture");
        await f.enqueue(chat, "primary");
        const primary = f.lifecycle.consumeQueuedFollowupItem(chat)!;
        const claim = await f.work.claimNext(seal({ effect: f.effect("claim"), chatJid: chat, expectedFrontier: 0,
          newOperationId: "running-operation", claimedAt: "2026-08-14T09:00:00.000Z" }));
        expect(claim.ok && claim.value?.source.sourceId).toBe(primary.source_id);
        expect((await f.work.bindHarness(seal({ effect: { ...f.effect("bind"), operationId: "running-operation", sourceSeq: 1 },
          expectedVersion: 1, sessionId: "owned-session", harnessOperationId: "native-operation" }))).ok).toBe(true);
        const rowId = await f.enqueue(chat, "  accepted input stays exact  ");
        const siblingRowId = await f.enqueue(chat, "sibling");
        const [queued, sibling] = getDeferredQueuedFollowups(chat);
        const originalSource = f.work.getAcceptedSource(chat, queued!.source_id!)!;
        const originalSibling = f.work.getAcceptedSource(chat, sibling!.source_id!)!;
        const events: string[] = [], submitted: DurableAcceptedInput[] = [], pending: unknown[] = [];
        let forbiddenCalls = 0, selected = 0, accepted = 0, dispatches = 0;
        const forbidden = () => { forbiddenCalls++; throw Error("legacy/withdrawal/resubmission forbidden"); };
        const adapter = createDurableConversationAdapter({ incarnation: "test-owner", manifest: [{ chatJid: chat, branchId: "main", conversationId: 1 }],
          runtime: { submit: forbidden, reconcile: forbidden, cancel: forbidden, resume: forbidden, settle: forbidden, close: async () => {},
            async submitIntent(input) {
              dispatches++;
              submitted.push(input);
              if (failure === "lost-ack") throw Error("private lost ACK");
              return 1;
            } },
        });
        const coordinator = createDurableQueuedSteering({ work: f.work, adapter, chatJid: chat, branchId: "main",
          runningBinding: { sessionId: "owned-session" },
          assertCurrentWriter() { if (failure === "fenced") throw Error("PRIVATE_FENCED_ENGINE"); },
          readQueued: id => getDeferredQueuedFollowups(chat).find(item => item.rowId === id),
          validatePayload: ({ item }) => expect(f.work.getAcceptedSource(chat, item.source_id)?.provenanceRef).toBe(f.digest(item)),
          materialize: (item, accept) => storeWebMessage({} as any, { chatJid: chat, content: item.queuedContent, isBot: false,
            mediaIds: item.mediaIds ?? [], agentId: "default", agentName: "Pi" }, {
            threadId: item.threadId, contentBlocks: item.contentBlocks, linkPreviews: item.linkPreviews, screenHint: item.screenHint,
            isSteeringMessage: true, consumeDeferredFollowupRowId: item.rowId, materializeQueuedSource: accept,
          }),
          onPendingIntent: input => { pending.push(input); },
        });
        const options: ConstructorParameters<typeof WebAgentControlPlaneService>[0] = {
          defaultChatJid: chat, defaultAgentId: "default", json: jsonResponse, agentPool: {} as any,
          queuedFollowupLifecycle: f.lifecycle, queue: { enqueue: forbidden }, storeMessage: forbidden, processChat: forbidden,
          getQueuedInputSourceWithdrawal: forbidden,
          getAcceptedQueuedSteering(jid) {
            selected++; expect(jid).toBe(chat);
            if (failure === "missing-port") return undefined;
            return { async accept(id) { accepted++; expect(id).toBe(rowId); return coordinator.accept(id); } };
          },
          broadcastEvent(type) {
            events.push(type);
            if (failure === "publication") throw Error("PRIVATE_PUBLICATION_DETAIL");
          },
        };
        Object.defineProperty(options, 'queuePendingSteering', { get: forbidden });
        // Replacement while the body is awaited must not redirect trusted selection.
        const request = abortRequest({ chat_jid: chat, row_id: rowId, source_id: "forged", engine: "forged" });
        request.json = async () => {
          options.getAcceptedQueuedSteering = forbidden;
          return { chat_jid: chat, row_id: rowId, source_id: "forged", engine: "forged" };
        };
        const service = new WebAgentControlPlaneService(options);
        const before = f.snapshot();
        const response = await service.handleAgentQueueSteer(request);
        const body = await response.json();
        await Bun.sleep(0);
        expect(selected).toBe(1);
        expect(forbiddenCalls).toBe(0);
        expect(JSON.stringify(body)).not.toContain("PRIVATE_");
        if (failure === "missing-port" || failure === "fenced") {
          expect(response.status).toBe(500);
          expect(f.snapshot()).toEqual(before);
          expect(getDeferredQueuedFollowups(chat)).toEqual([queued, sibling]);
          expect(events).toEqual([]); expect(dispatches).toBe(0);
          expect(accepted).toBe(failure === "missing-port" ? 0 : 1);
          return;
        }
        expect(response.status).toBe(failure === "publication" ? 500 : 201);
        if (failure !== "publication") expect(body).toMatchObject({ removed: true, row_id: rowId, queued: "steer", steering_delivery: "pending" });
        expect(accepted).toBe(1); expect(dispatches).toBe(1);
        expect(submitted).toEqual([expect.objectContaining({ sourceId: originalSource.sourceId, sourceSeq: originalSource.sourceSeq,
          operationId: "running-operation", payloadRef: originalSource.payloadRef, requestId: `queued-steer:${originalSource.sourceId}` })]);
        expect(pending).toHaveLength(failure === "lost-ack" ? 1 : 0);
        expect(getDeferredQueuedFollowups(chat)).toEqual([sibling]);
        expect(sibling!.rowId).toBe(siblingRowId);
        expect(f.work.getAcceptedSource(chat, sibling!.source_id!)).toEqual(originalSibling);
        expect(f.work.getAcceptedSource(chat, queued!.source_id!)).toEqual({ ...originalSource, state: "claimed", targetOperationId: "running-operation" });
        expect(f.database.query("SELECT id, content FROM messages WHERE id=?").get(originalSource.sourceId))
          .toEqual({ id: originalSource.sourceId, content: queued!.queuedContent });
        expect(f.database.query("SELECT kind, payload_ref FROM service_effect_s01_intents").all())
          .toEqual([{ kind: "queue_input", payload_ref: originalSource.payloadRef }]);
        expect(f.database.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(3);
        const committed = f.snapshot(), published = [...events];
        const duplicate = await service.handleAgentQueueSteer(abortRequest({ chat_jid: chat, row_id: rowId }));
        expect(duplicate.status).toBe(200); expect((await duplicate.json()).removed).toBe(false);
        expect(f.snapshot()).toEqual(committed); expect(events).toEqual(published);
        expect(dispatches).toBe(1); expect(forbiddenCalls).toBe(0);
      });
    });
  }

  test("mixed queue drain rejects accepted input before any partial local deletion or withdrawal", async () => {
    await withQueueFixture(async f => {
      const chat = "web:mixed-drain";
      storeChatMetadata(chat, "2026-08-14T09:00:00.000Z", "Fixture");
      const manual = f.lifecycle.enqueueQueuedFollowupItem(chat, 0, "manual first");
      const placeholder = storeMessage({ id: "drain-placeholder", chat_jid: chat, sender: "agent", sender_name: "Pi",
        content: "\u2063", timestamp: "2026-08-14T09:00:00.000Z", is_from_me: false, is_bot_message: true });
      f.lifecycle.enqueuePlaceholder(chat, placeholder, "placeholder first");
      const accepted = await f.enqueue(chat, "accepted last");
      const before = f.snapshot(), queued = f.lifecycle.getQueuedFollowupItems(chat);
      let effects = 0;
      const forbidden = () => { effects++; throw Error("no drain effects"); };
      const service = createService({
        queuedFollowupLifecycle: {
          getQueuedFollowupCount: jid => f.lifecycle.getQueuedFollowupCount(jid),
          // Public state has no source_accepted; order both local rows ahead of it.
          listQueuedStateItems: () => [manual, placeholder, accepted].map(row_id => ({ row_id, content: "public", timestamp: "now", thread_id: null })),
          removeQueuedFollowupForAction: forbidden, reorderQueuedFollowupItems: async () => false,
        }, getQueuedInputSourceWithdrawal: forbidden, broadcastEvent: forbidden,
      });
      const response = await service.handleAgentRunDrainQueue(abortRequest({ chat_jid: chat }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Accepted input cannot be drained." });
      expect(effects).toBe(0);
      expect(f.snapshot()).toEqual(before); expect(f.lifecycle.getQueuedFollowupItems(chat)).toEqual(queued);
      expect(getMessageByRowId(chat, placeholder)).toBeDefined();
    });
  });

  test("lists native runs and supports abort, terminal-display clearing and queue drain without mutating polling cursors", async () => {
    initDatabase();
    const events: Array<{ type: string; data: unknown }> = [];
    const controlCalls: Array<{ chatJid: string; command: unknown }> = [];
    const removedRows: number[] = [];
    setChatCursor("web:hung", "2024-01-01T00:00:02.000Z");
    const queueLifecycle: QueueLifecycleStub = {
      getQueuedFollowupCount: () => 2,
      listQueuedStateItems: () => [
        { rowId: 41, content: "first" },
        { row_id: 42, content: "second" },
      ],
      reorderQueuedFollowupItems: async () => false,
      removeQueuedFollowupForAction: async (_chatJid, rowId) => {
        removedRows.push(rowId);
        return {
          removed: {
            rowId,
            queuedContent: `queued-${rowId}`,
            queuedAt: "2024-01-01T00:00:00.000Z",
            materializeRetries: 0,
          },
          source: "deferred",
        };
      },
    };
    let currentStatus: Record<string, unknown> = { type: "thinking", turn_id: "turn-hung" };
    const service = createService({
      broadcastEvent: (type, data) => events.push({ type, data }),
      queuedFollowupLifecycle: queueLifecycle,
      getAgentStatus: (chatJid) => chatJid === "web:hung" ? currentStatus : null,
      updateAgentStatus: (_chatJid, status) => { currentStatus = status; },
      agentPool: {
        setSessionBinder: () => {},
        listActiveChats: () => [{ chat_jid: "web:hung", agent_name: "hung", is_active: true }],
        applyControlCommand: async (chatJid: string, command: unknown) => {
          controlCalls.push({ chatJid, command });
          return { status: "success", message: "aborted" };
        },
      },
    });

    const listResponse = await service.handleAgentRuns(new Request("https://example.com/agent/runs?chat_jid=web%3Ahung"));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual(expect.objectContaining({
      runs: [expect.objectContaining({
        chat_jid: "web:hung",
        is_active: true,
        queue_count: 2,
        inflight: null,
        preflight: null,
        status: expect.objectContaining({ turn_id: "turn-hung" }),
      })],
    }));

    const abortResponse = await service.handleAgentRunAbort(new Request("https://example.com/agent/runs/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:hung", turn_id: "turn-hung" }),
    }));
    expect(abortResponse.status).toBe(200);
    expect(await abortResponse.json()).toEqual(expect.objectContaining({ status: "ok", chat_jid: "web:hung", turn_id: "turn-hung" }));
    expect(controlCalls).toEqual([{ chatJid: "web:hung", command: { type: "abort", raw: "/abort" } }]);

    const drainResponse = await service.handleAgentRunDrainQueue(new Request("https://example.com/agent/runs/drain-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:hung" }),
    }));
    expect(drainResponse.status).toBe(200);
    expect(await drainResponse.json()).toEqual({ status: "ok", chat_jid: "web:hung", removed_count: 2 });
    expect(removedRows).toEqual([41, 42]);

    const clearResponse = await service.handleAgentRunClearStale(new Request("https://example.com/agent/runs/clear-stale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:hung" }),
    }));
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.json()).toEqual({
      status: "ok",
      chat_jid: "web:hung",
      cleared: true,
      had_inflight: false,
      had_preflight: false,
      had_status: true,
    });
    expect(getChatCursor("web:hung")).toBe("2024-01-01T00:00:02.000Z");
    expect(getDb().query("SELECT * FROM chat_cursors WHERE chat_jid='web:hung'").get()).toEqual({chat_jid:"web:hung",cursor_ts:"2024-01-01T00:00:02.000Z",queued_followups_json:null});
    expect(events).toEqual(expect.arrayContaining([
      { type: "agent_followup_drained", data: { chat_jid: "web:hung", removed_count: 2 } },
    ]));
  });

  test("run abort dispatches the parsed control command to the captured chat", async () => {
    const aborted: string[] = [];
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => aborted.push("web:target"), { once: true });
    const service = createService({
      getAgentStatus: () => ({ turnId: "current-turn" }),
      agentPool: {
        setSessionBinder: () => {},
        applySlashCommand: async () => { throw new Error("legacy slash path must not run"); },
        applyControlCommand: async (chatJid, command) => {
          expect(chatJid).toBe("web:target");
          expect(command).toEqual({ type: "abort", raw: "/abort" });
          controller.abort();
          return { status: "success", message: "Aborted current response.", sessionGeneration: "owned-session" };
        },
      },
    });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: " web:target ", turn_id: " current-turn " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", chat_jid: "web:target", turn_id: "current-turn", result: {
      status: "success", message: "Aborted current response.", sessionGeneration: "owned-session",
    } });
    expect(aborted).toEqual(["web:target"]);
  });

  test("stale run abort and invalid payloads never invoke a control command", async () => {
    let calls = 0;
    const service = createService({
      getAgentStatus: () => ({ turn_id: "new-turn" }),
      agentPool: { setSessionBinder: () => {}, applyControlCommand: async () => {
        calls++; return { status: "success", message: "aborted" };
      } },
    });
    const stale = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target", turn_id: "old-turn" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "turn_id does not match the active run", active_turn_id: "new-turn" });
    expect((await service.handleAgentRunAbort(abortRequest({}))).status).toBe(400);
    expect((await service.handleAgentRunAbort(new Request("https://example.com/agent/runs/abort", { method: "POST", body: "{" }))).status).toBe(400);
    expect(calls).toBe(0);
  });

  test("run abort returns unavailable without falling back to slash dispatch", async () => {
    let calls = 0;
    const service = createService({ agentPool: { setSessionBinder: () => {}, applySlashCommand: async () => {
      calls++; return { status: "success", message: "not a control path" };
    } } });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target" }));
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Run abort is not available." });
    expect(calls).toBe(0);
  });

  test("run abort reports command failure without an outer success", async () => {
    const failure = { status: "error" as const, message: "Cancellation failed", sessionGeneration: "owned-session" };
    const service = createService({ getAgentStatus: () => ({ turn_id: "target-turn" }), agentPool: {
      setSessionBinder: () => {}, applyControlCommand: async () => failure,
    } });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target", turn_id: "target-turn" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error", error: "Cancellation failed", chat_jid: "web:target", turn_id: "target-turn", result: failure });
  });

  test("run abort reports a rejected control dispatch as a bounded failure", async () => {
    const service = createService({ agentPool: { setSessionBinder: () => {}, applyControlCommand: async () => {
      throw new Error("internal failure detail");
    } } });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error", error: "Run abort failed.", chat_jid: "web:target", turn_id: null });
  });

  test("preserves branch lifecycle wrapper status codes and payload shapes", async () => {
    const service = createService({
      agentPool: {
        setSessionBinder: () => {},
        createForkedChatBranch: async (chatJid: string, options?: { agentName?: string | null }) => ({
          chat_jid: `${chatJid}:branch:1`,
          agent_name: options?.agentName ?? "child",
        }),
        renameChatBranch: async (chatJid: string, options?: { agentName?: string | null }) => ({
          chat_jid: chatJid,
          agent_name: options?.agentName ?? null,
        }),
        pruneChatBranch: async (chatJid: string) => ({ chat_jid: chatJid, archived_at: "2024-01-01T00:00:00.000Z" }),
        permanentPurgeChatBranch: async (chatJid: string) => ({
          branch: { chat_jid: chatJid, agent_name: "archived", archived_at: "2024-01-01T00:00:00.000Z" },
          removedSessionArtifacts: ["/tmp/session"],
        }),
        restoreChatBranch: async (chatJid: string, options?: { agentName?: string | null }) => ({
          chat_jid: chatJid,
          agent_name: options?.agentName ?? "restored",
          archived_at: null,
        }),
      },
    });

    const forkResponse = await service.handleAgentBranchFork(new Request("https://example.com/agent/branch-fork", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_chat_jid: "web:root", agent_name: "research" }),
    }));
    expect(forkResponse.status).toBe(201);
    expect(await forkResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "research" },
    });

    const renameResponse = await service.handleAgentBranchRename(new Request("https://example.com/agent/branch-rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1", agent_name: "lead" }),
    }));
    expect(renameResponse.status).toBe(200);
    expect(await renameResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "lead" },
    });

    const pruneResponse = await service.handleAgentBranchPrune(new Request("https://example.com/agent/branch-prune", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1" }),
    }));
    expect(pruneResponse.status).toBe(200);
    expect(await pruneResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", archived_at: "2024-01-01T00:00:00.000Z" },
    });

    const purgeResponse = await service.handleAgentBranchPurge(new Request("https://example.com/agent/branch-purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1" }),
    }));
    expect(purgeResponse.status).toBe(200);
    expect(await purgeResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "archived", archived_at: "2024-01-01T00:00:00.000Z" },
      removedSessionArtifacts: ["/tmp/session"],
    });

    const restoreResponse = await service.handleAgentBranchRestore(new Request("https://example.com/agent/branch-restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1", agent_name: "restored" }),
    }));
    expect(restoreResponse.status).toBe(200);
    expect(await restoreResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "restored", archived_at: null },
    });
  });

  test("downloads archived branch data as attachment JSON", async () => {
    initDatabase();
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`).run(
      "web:archived-download-service",
      "Archived Download Service",
      "2026-06-12T00:00:00.000Z",
    );
    db.prepare(`INSERT OR REPLACE INTO chat_branches (branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`).run(
      "branch-archived-download-service",
      "web:archived-download-service",
      "web:archived-download-service",
      "download-service",
      "2026-06-11T00:00:00.000Z",
      "2026-06-12T00:00:00.000Z",
      "2026-06-12T01:00:00.000Z",
    );
    db.prepare(`INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "msg-archived-download-service",
      "web:archived-download-service",
      "web-user",
      "You",
      "download me",
      "2026-06-12T00:00:01.000Z",
      0,
      0,
    );

    const service = createService();
    const response = service.handleAgentBranchDownload(new Request("https://example.com/agent/branch-download?chat_jid=web%3Aarchived-download-service"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    const payload = await response.json();
    expect(payload.schema).toBe("piclaw.archived-session.v1");
    expect(payload.branch.chat_jid).toBe("web:archived-download-service");
    expect(payload.messages[0].content).toBe("download me");
  });
});
