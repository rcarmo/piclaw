import { describe, expect, test } from "bun:test";

import { withTempWorkspaceEnv } from "../../../helpers.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setChatCursor, closeDatabase, getDb, getDeferredQueuedFollowups, setDeferredQueuedFollowups, getMessageByRowId, storeMessage, storeChatMetadata, getChatCursor, initDatabase } from "../../../../src/db.js";
import {
  buildStalledWorkDiagnostic,
  WebAgentControlPlaneService,
} from "../../../../src/channels/web/agent/agent-control-plane-service.js";

import { installServiceWorkSchema } from "../../../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../../src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../../src/service-effects/contracts/common.js";

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

function createService(overrides: Partial<ConstructorParameters<typeof WebAgentControlPlaneService>[0]> = {}) {
  initDatabase();
  return new WebAgentControlPlaneService({
    defaultChatJid: "web:default",
    defaultAgentId: "default",
    json: jsonResponse,
    broadcastEvent: () => {},
    queue: { enqueue: () => {} },
    readNativeQueue: async () => [],
    controlNativeQueue: async () => false,
    agentPool: { setSessionBinder: () => {} },
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

for(const action of ['steer','remove'] as const)for(const revoked of [false,true])test(`native queue ${action} retains original pre-JSON caller authority: revoked=${revoked}`,async()=>{
  const trace:string[]=[];let generation=1,changes=0,release!:()=>void,original:(()=>void)|undefined;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const request=new Request('https://fixture/agent/queue',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  request.json=async()=>{trace.push('parse');await held;return {chat_jid:'web:target',row_id:17};};
  const service=createService({
    captureWriteAuthority(received){expect(received).toBe(request);trace.push('capture');const expected=generation;original=()=>{if(generation!==expected)throw Error('original caller revoked');};return original;},
    readNativeQueue:async chat=>{expect(chat).toBe('web:target');return [{row_id:17,content:'SDK input',timestamp:'2026-01-01',thread_id:null}];},
    controlNativeQueue:async(chat,id,kind,authorise)=>{trace.push('control');expect([chat,id,kind]).toEqual(['web:target',17,action]);expect(authorise).toBe(original);authorise?.();changes++;return true;},
  });
  const pending=action==='steer'?service.handleAgentQueueSteer(request):service.handleAgentQueueRemove(request);
  expect(trace).toEqual(['capture','parse']);if(revoked)generation++;release();const response=await pending;
  expect(response.status).toBe(revoked?500:action==='steer'?201:200);expect(changes).toBe(revoked?0:1);expect(trace).toEqual(['capture','parse','control']);
});

describe("native abort terminal status ownership", () => {
  for (const scenario of ["idle", "successor", "failure", "compaction"] as const) {
    test(`${scenario}: only the SDK watch may change its captured status`, async () => {
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
      expect(status.type).toBe('intent');
      expect(updates).toEqual([]); expect(events).toEqual([]);
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
