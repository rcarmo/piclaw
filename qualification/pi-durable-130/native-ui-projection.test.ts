import "./src/test-guard.js";
import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import { acceptedSteerFixture, sdkRecoverySnapshot } from "./src/accepted-steer-recovery-fixture.js";
import { TestOwner } from "./src/ownership.js";
import { barrier, context } from "./src/fixture.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getRouterState, setRouterState } from "../../runtime/src/db.js";
import { extensionKvGet, extensionKvSet } from "../../runtime/src/db/extension-kv.js";
import { createNativeTurnView } from "../../runtime/src/channels/web/agent/native-turn-view.js";
import { AgentStatusStore } from "../../runtime/src/channels/web/agent/agent-status-store.js";

const test = isolatedApplicationTest(import.meta.url);
for (const phase of ["generation", "tool", "tool-restart"] as const) test(`native ${phase}: fresh web projection rejoins actual late-intent SDK view without replay`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "ui-projection-"));
  const f = await acceptedSteerFixture(dir, "committed-ack-lost", undefined, false, { sharedDatabase: true });
  const stops: Array<() => Promise<void>> = [];
  const stores: AgentStatusStore[] = [];
  try {
    const history = '{"agentStatuses":{"old":{"type":"thinking"}},"contextUsages":{"old":{"tokens":777}},"draftRecoveries":{"old":{"text":"uncommitted model text"}},"unknown":"keep"}';
    setRouterState("last_agent_timestamp_web", history);
    setRouterState("web:oobe:provider-ready:completed", "true");
    const preferences = { theme: "dark", outputPad: false, meters: true };
    f.db.transaction(() => extensionKvSet("native-ui-projection-fixture", "preferences", preferences, "global")).immediate();
    const { primary, primaryId, b } = await f.prepare(phase === "generation" ? "accepted B" : "use-tool");
    const binding = { incarnation: f.incarnation, chatJid: f.chatJid, branchId: "main", conversationId: f.base.root.id };
    const attach = async () => {
      const store = new AgentStatusStore(15000, 2); stores.push(store);
      const events: Array<{ event: string; data: Record<string, any> }> = [];
      const generation = barrier(), tool = barrier();
      let inputs: number[] | undefined;
      const render = createNativeTurnView(f.db, {
        broadcastEvent(event, data) { events.push({ event, data }); },
        updateAgentStatus(chat, data) { store.update(chat, data); },
      }, f.chatJid);
      const stop = await f.runtime!.watchSession(binding, view => {
        render(view);
        const live = view.docs["pi.live"] as any;
        inputs = live?.run?.inputs;
        if (live?.generation) generation.release();
        if (live?.tools?.some((slot: any) => slot.name === "host_effect" && slot.status === "running")) tool.release();
      });
      stops.push(stop);
      return { store, events, stop, generation, tool, get inputs() { return inputs; } };
    };
    f.entryObserved = barrier();
    const first = await attach();
    await first.generation.promise;
    if (f.providerEntries < 2) await f.entryObserved.promise;
    expect(first.store.get(f.chatJid)).toMatchObject({ type: "thinking", operation_id: f.incarnation });
    expect(f.committedIntentId).toBeNumber();
    expect(f.committedIntentId).not.toBe(primaryId);
    expect(first.inputs).toEqual([f.committedIntentId!]);
    expect(f.providerEntries).toBe(2); // Primary completed; only the late intent is currently held.
    expect(f.base.host.modelCalls).toBe(1);
    const beforeContext = await f.runtime!.readSessionContextUsage(binding);
    expect(beforeContext.contextWindow).toBe(100000);
    expect(beforeContext.tokens).toBeGreaterThan(0);
    await expect(f.runtime!.watchSession({ ...binding, chatJid: "web:foreign" }, () => { throw Error("foreign publication"); })).rejects.toThrow("Manifest conflict");
    await expect(f.runtime!.readSessionContextUsage({ ...binding, incarnation: "stale" })).rejects.toThrow("Host binding conflict");
    await first.stop(); first.store.dispose();

    if (phase === "generation") {
      // Actual SDK/storage shutdown and new exclusive owner, not a forged public frame.
      await f.runtime!.close(); f.runtime = undefined;
      await closeDatabase(); f.owner.releaseAfterClose(); f.owner.closeConnection();
      f.owner = TestOwner.acquire(f.path);
      expect(f.owner.token.generation).toBe(f.generation + 1);
      initDatabase(); f.db = getDb(); f.ports = f.stores(); f.permit = false;
      const entriesBeforeOpen = f.providerEntries;
      await f.open();
      expect(await f.runtime!.readSessionContextUsage(binding)).toEqual(beforeContext);
      const before = await sdkRecoverySnapshot(f.candidateDatabase);
      const replacement = await attach();
      expect(replacement.store.get(f.chatJid)).toMatchObject({ operation_id: f.incarnation });
      expect(await sdkRecoverySnapshot(f.candidateDatabase)).toEqual(before);
      expect(f.providerEntries).toBe(entriesBeforeOpen); // Read-only reconstruction does not schedule paused work.
      f.permit = true;
    } else {
      f.base.host.toolHold = barrier();
      f.base.host.modelHold!.release();
      await f.base.host.toolEntered.promise;
      // Reattach while the *actual* SDK tool is held before its effect, without replaying it.
      const replacement = await attach();
      await replacement.tool.promise;
      expect(replacement.store.get(f.chatJid)).toMatchObject({ tool_name: "host_effect", status: "running", active_tool_count: 1 });
      expect(f.base.host.effects).toBe(0);
      const before = await sdkRecoverySnapshot(f.candidateDatabase);
      replacement.store.update("other-chat-1", { type: "thinking" });
      replacement.store.update("other-chat-2", { type: "thinking" });
      expect(replacement.store.get(f.chatJid)).toBeNull(); // Real capacity eviction cannot discard accepted SDK work.
      expect(f.ports.work.getAcceptedSource(f.chatJid, b.sourceId)?.state).toBe("claimed");
      await replacement.stop(); replacement.store.dispose();
      const fresh = await attach();
      expect(fresh.store.get(f.chatJid)).toMatchObject({ tool_name: "host_effect", status: "running", active_tool_count: 1 });
      expect(await sdkRecoverySnapshot(f.candidateDatabase)).toEqual(before);
      expect(f.providerEntries).toBe(2); expect(f.toolEntries).toBe(1);
      if (phase === "tool-restart") {
        await fresh.stop(); fresh.store.dispose();
        await f.runtime!.close(); f.runtime = undefined;
        await closeDatabase(); f.owner.releaseAfterClose(); f.owner.closeConnection();
        f.owner = TestOwner.acquire(f.path);
        expect(f.owner.token.generation).toBe(f.generation + 1);
        initDatabase(); f.db = getDb(); f.ports = f.stores(); f.permit = false;
        const entries = f.providerEntries;
        await f.open();
        const paused = await sdkRecoverySnapshot(f.candidateDatabase);
        const reopened = await attach();
        expect(reopened.store.get(f.chatJid)).toMatchObject({ operation_id: f.incarnation, tool_name: "host_effect" });
        expect(await sdkRecoverySnapshot(f.candidateDatabase)).toEqual(paused);
        expect(f.providerEntries).toBe(entries);
        expect(f.toolEntries).toBe(1); expect(f.base.host.effects).toBe(0);
        expect(f.base.host.credentialLookups).toBe(0);
        expect(getRouterState("last_agent_timestamp_web")).toBe(history);
        expect(getRouterState("web:oobe:provider-ready:completed")).toBe("true");
        expect(extensionKvGet("native-ui-projection-fixture", "preferences", "global")).toEqual(preferences);
        return; // Read-only reattachment must leave the interrupted unsafe tool paused.
      }
      f.base.host.toolHold.release();
    }
    expect(getRouterState("last_agent_timestamp_web")).toBe(history);
    expect(getRouterState("web:oobe:provider-ready:completed")).toBe("true");
    expect(extensionKvGet("native-ui-projection-fixture", "preferences", "global")).toEqual(preferences);
    f.base.host.modelHold!.release();
    await f.runtime!.wait(primary, primaryId);
    expect((await f.runtime!.settle(primary))?.disposition).toBe("completed");
    expect(f.base.host.effects).toBe(phase === "tool" ? 1 : 0);
    expect(f.toolEntries).toBe(phase === "tool" ? 1 : 0);
    expect(f.ports.work.getAcceptedSource(f.chatJid, b.sourceId)?.state).toBe("consumed");
    expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, f.primaryRequestId, context))?.id).toBe(primaryId);
    expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, `queued-steer:${f.intentSourceId}`, context))?.id as number | undefined).toBe(f.committedIntentId);
    expect(f.base.host.credentialLookups).toBe(0);
  } finally {
    f.base.host.modelHold?.release(); f.base.host.toolHold?.release();
    for (const stop of stops.reverse()) await stop();
    for (const store of stores) store.dispose();
    await f.close(); await rm(dir, { recursive: true, force: true });
  }
}, 30000);
