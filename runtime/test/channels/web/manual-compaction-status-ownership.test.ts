import { describe, expect, test } from "bun:test";
import "../../helpers.ts";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.ts";
import { AgentStatusStore } from "../../../src/channels/web/agent/agent-status-store.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Result = { status: string; message: string; contextUsage?: { tokens: number | null; contextWindow: number | null; percent: number | null; sessionGeneration?: string; tokensAreAuthoritative?: true }; sessionGenerationChanged?: boolean; sessionGeneration?: string };

function fixture(terminalTtlMs = 15_000) {
  const statuses = new AgentStatusStore(terminalTtlMs);
  const stats = deferred<Result>();
  const compact = deferred<Result>();
  const statsStarted = deferred<void>();
  const compactStarted = deferred<void>();
  const events: Array<{ event: string; payload: any }> = [];
  const responses: string[] = [];
  const usages: unknown[] = [];
  const usageStatusSnapshots: unknown[] = [];
  let row = 0;
  const dispatch = (_jid: string, command: any) => {
    if (command.type === "compact" || command.type === "session_rotate" || command.type === "new_session") { compactStarted.resolve(); return compact.promise; }
    statsStarted.resolve();
    return stats.promise;
  };
  const channel = {
    agentPool: {
      isStreaming: () => false, isActive: () => false,
      getCurrentModelLabel: async () => "fixture/model",
      getSessionGenerationForChat: () => "generation-2",
      applyControlCommand: dispatch, applySlashCommand: dispatch,
    },
    getQueuedFollowupCount: () => 0,
    getAgentStatus: (jid: string) => statuses.get(jid),
    updateAgentStatus: (jid: string, payload: Record<string, unknown>) => statuses.update(jid, payload),
    broadcastEvent: (event: string, payload: any) => {
      if (event === "agent_status" && payload.type === "context_usage") usageStatusSnapshots.push(statuses.get("web:test"));
      events.push({ event, payload });
    },
    setContextUsage: (_jid: string, usage: unknown) => usages.push(usage),
    admitMessage: async () => ({ id: ++row, timestamp: `2026-10-15T00:00:0${row}Z`, data: { thread_id: null } }),
    sendMessage: async (_jid: string, content: string) => { responses.push(content); },
    saveState() {},
    json: (body: unknown, status = 200) => Response.json(body, { status }),
  } as any;
  const send = (content: string) => handleAgentMessage(channel, new Request("https://fixture/agent/default/message", {
    method: "POST", body: JSON.stringify({ content }),
  }), "/agent/default/message", "web:test", "default");
  return { statuses, stats, compact, statsStarted, compactStarted, events, responses, usages, usageStatusSnapshots, send };
}

const success: Result = { status: "success", message: "Finished" };

describe("manual command status ownership in the production handler", () => {
  for (const outcome of ["success", "error", "reject"] as const) {
    test(`late /stats ${outcome} cannot replace a newer compact intent`, async () => {
      const f = fixture();
      const older = f.send("/stats");
      // Attach rejection handling immediately: provider rejection is not a lifecycle emission.
      const olderResult = older.catch(error => error);
      await f.statsStarted.promise;
      const first = f.statuses.get("web:test")!;
      const newer = f.send("/compact");
      await f.compactStarted.promise;
      const owner = f.statuses.get("web:test")!;
      expect(owner.intent_key).toBe("compaction");
      expect(owner.turn_id).not.toBe(first.turn_id);
      const eventCount = f.events.length;
      if (outcome === "reject") f.stats.reject(new Error("held stats rejected"));
      else f.stats.resolve({ status: outcome, message: "Older stats response" });
      const response = await olderResult;
      if (outcome === "reject") expect(response).toBeInstanceOf(Error);
      else {
        expect(response.status).toBe(201);
        expect(f.responses).toContain("Older stats response");
      }
      expect(f.statuses.get("web:test")).toEqual(owner);
      expect(f.events.slice(eventCount).filter(e => e.event === "agent_status")).toEqual([]);
      f.compact.resolve({ ...success, contextUsage: { tokens: 20, contextWindow: 100, percent: 20 } });
      expect((await newer).status).toBe(201);
      expect(f.statuses.get("web:test")?.type).toBe("done");
      expect(f.statuses.get("web:test")?.turn_id).toBe(owner.turn_id);
      expect(f.usages).toEqual([]);
      expect(f.events.filter(e=>e.payload.type==='context_usage')).toHaveLength(1);
      expect(f.events.some(e => e.payload.type === "context_usage")).toBe(true);
    });
  }

  test("old command cannot replace active LLM tool metadata", async () => {
    const f = fixture();
    const pending = f.send("/stats");
    await f.statsStarted.promise;
    const llm = { type: "tool_status", turn_id: "llm-new", tool_call_id: "tool-1", tool_name: "bash", status_hints: [{ text: "Running" }], started_at: "2026-10-15T00:00:05Z" };
    f.statuses.update("web:test", llm);
    const owner = f.statuses.get("web:test");
    f.stats.resolve(success);
    await pending;
    expect(f.statuses.get("web:test")).toEqual(owner);
  });

  test("a missing status cannot be resurrected by a late terminal", async () => {
    const f = fixture();
    const pending = f.send("/stats");
    await f.statsStarted.promise;
    f.statuses.dispose();
    f.stats.resolve(success);
    await pending;
    expect(f.statuses.get("web:test")).toBeNull();
    expect(f.events.filter(e => e.event === "agent_status")).toHaveLength(1);
  });

  test("an expired owner cannot be resurrected by a late terminal", async () => {
    const f = fixture(1);
    const pending = f.send("/stats");
    await f.statsStarted.promise;
    const owner = f.statuses.get("web:test")!;
    f.statuses.update("web:test", { type: "done", turn_id: owner.turn_id });
    await Bun.sleep(10);
    expect(f.statuses.get("web:test")).toBeNull();
    f.stats.resolve(success);
    await pending;
    expect(f.statuses.get("web:test")).toBeNull();
  });

  test("the current compaction can publish its own error terminal", async () => {
    const f = fixture();
    const pending = f.send("/compact");
    await f.compactStarted.promise;
    const owner = f.statuses.get("web:test")!;
    f.compact.resolve({ status: "error", message: "Compaction failed" });
    await pending;
    expect(f.statuses.get("web:test")).toMatchObject({ type: "error", turn_id: owner.turn_id });
  });

  test("late progress from /reload cannot reclaim a newer command", async () => {
    const f = fixture();
    const older = f.send("/reload");
    await f.statsStarted.promise;
    const newer = f.send("/compact");
    await f.compactStarted.promise;
    const owner = f.statuses.get("web:test");
    f.stats.resolve(success);
    await older;
    expect(f.statuses.get("web:test")).toEqual(owner);
    f.compact.resolve(success);
    await newer;
  });

  test("own same-phase progress preserves timer metadata", async () => {
    const f = fixture();
    const pending = f.send("/reload");
    await f.statsStarted.promise;
    const owner = f.statuses.get("web:test")!;
    f.stats.resolve(success);
    await pending;
    expect(f.statuses.get("web:test")).toMatchObject({
      type: "intent", turn_id: owner.turn_id,
      started_at: owner.started_at, run_started_at: owner.run_started_at,
      phase_key: owner.phase_key,
      title: "Reload scheduled — waiting for restart",
    });
  });

  test("late compact usage cannot replace a successor's lifecycle status", async () => {
    const f = fixture();
    const pending = f.send("/compact");
    await f.compactStarted.promise;
    f.statuses.update("web:test", { type: "intent", turn_id: "new-llm", intent_key: "thinking" });
    const owner = f.statuses.get("web:test");
    const eventCount = f.events.length;
    f.compact.resolve({ ...success, contextUsage: { tokens: 20, contextWindow: 100, percent: 20 } });
    await pending;
    expect(f.statuses.get("web:test")).toEqual(owner);
    expect(f.usages).toEqual([]);
    expect(f.events.slice(eventCount).filter(e => e.event === "agent_status")).toEqual([]);
  });

  for (const command of ['/compact', '/new-session']) {
    test(`native ${command} publishes authoritative unknown counts without replacing its owning status`, async () => {
      const f = fixture();
      const pending = f.send(command);
      await f.compactStarted.promise;
      const owner = f.statuses.get('web:test');
      f.compact.resolve({ ...success, sessionGeneration: 'generation-2', sessionGenerationChanged: false,
        contextUsage: { tokens: null, contextWindow: null, percent: null, sessionGeneration: 'generation-2', tokensAreAuthoritative: true } });
      const response = await pending;
      expect(response.status).toBe(201);
      expect(f.usages).toEqual([]);
      expect(f.events.filter(e=>e.payload.type==='context_usage').map(e=>e.payload.context_usage)).toEqual([expect.objectContaining({tokens:null,contextWindow:null,percent:null,sessionGeneration:'generation-2',contextUpdate:'replace'})]);
      expect(f.usageStatusSnapshots).toEqual([owner]);
      expect(f.statuses.get('web:test')?.type).toBe('done');
      const body = await response.json();
      expect(body.command.contextUsage).toMatchObject({ tokens: null, percent: null, contextUpdate: 'replace' });
      expect(JSON.stringify(body)).not.toContain('tokensAreAuthoritative');
      expect(JSON.stringify(f.events)).not.toContain('tokensAreAuthoritative');
    });
  }

  test("context usage publication leaves the owning intent pollable", async () => {
    const f = fixture();
    const pending = f.send("/compact");
    await f.compactStarted.promise;
    const owner = f.statuses.get("web:test");
    f.compact.resolve({ ...success, contextUsage: { tokens: 20, contextWindow: 100, percent: 20 } });
    await pending;
    expect(f.usageStatusSnapshots).toEqual([owner]);
    expect(f.statuses.get("web:test")?.type).toBe("done");
  });

  test("session rotation context reset does not steal lifecycle ownership", async () => {
    const f = fixture();
    const pending = f.send("/session-rotate");
    await f.compactStarted.promise;
    const owner = f.statuses.get("web:test");
    f.compact.resolve({ ...success, sessionGenerationChanged: true, sessionGeneration: "generation-2" });
    await pending;
    expect(f.usages).toEqual([]);
    expect(f.events.filter(e=>e.payload.type==='context_usage').map(e=>e.payload.context_usage)).toEqual([{tokens:null,contextWindow:null,percent:null,sessionGeneration:'generation-2',contextUpdate:'replace'}]);
    expect(f.events.some(e => e.payload.type === "context_usage" && e.payload.context_reset)).toBe(true);
    expect(f.statuses.get("web:test")?.turn_id).toBe(owner?.turn_id);
    expect(f.statuses.get("web:test")?.type).toBe("done");
  });
});
