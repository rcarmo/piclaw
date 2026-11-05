import { describe, expect, test } from "bun:test";
import {
  WebChannelRuntimeStateService,
  type WebChannelRuntimeStateCallbacks,
} from "../../../../src/channels/web/runtime/runtime-state-service.js";
import type { ChatRunControlStore } from "../../../../src/channels/web/runtime/chat-run-control.js";
import type { WebPendingResumeStore } from "../../../../src/channels/web/runtime/recovery.js";

describe("web runtime state service", () => {
  test("resumeChat wires queue/process callbacks through the resume context", async () => {
    const enqueued: Array<{ key: string; laneKey?: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string; threadRootId?: number | null }> = [];

    const callbacks: WebChannelRuntimeStateCallbacks = {
      getAssistantName: () => "Pi",
      enqueue: (task, key, laneKey) => {
        enqueued.push({ task, key, laneKey });
      },
      processChat: async (chatJid, agentId, threadRootId) => {
        processed.push({ chatJid, agentId, threadRootId });
      },
    };

    const service = new WebChannelRuntimeStateService(callbacks, {
      defaultAgentId: "default",
    });

    service.resumeChat("web:1", 77);
    service.resumeChat("web:2");

    expect(enqueued.map(({ key, laneKey }) => ({ key, laneKey }))).toEqual([
      { key: "resume:web:1:77", laneKey: "chat:web:1" },
      { key: "resume:web:2:wake", laneKey: "chat:web:2" },
    ]);

    await enqueued[0].task();
    await enqueued[1].task();

    expect(processed).toEqual([
      { chatJid: "web:1", agentId: "default", threadRootId: 77 },
      { chatJid: "web:2", agentId: "default", threadRootId: undefined },
    ]);
  });

  test("recovery helpers use live assistant identity plus queue/process wiring", async () => {
    const enqueued: Array<{ key: string; laneKey?: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string; threadRootId?: number | null }> = [];
    const messageChecks: Array<{ chatJid: string; since: string; assistantName: string }> = [];
    let assistantName = "Pi stable";

    const callbacks: WebChannelRuntimeStateCallbacks = {
      getAssistantName: () => assistantName,
      enqueue: (task, key, laneKey) => {
        enqueued.push({ task, key, laneKey });
      },
      processChat: async (chatJid, agentId, threadRootId) => {
        processed.push({ chatJid, agentId, threadRootId });
      },
    };

    const store: WebPendingResumeStore = {
      getAllChatCursors: () => ({ "web:pending": "t1" }),
      getKnownChatJids: () => ["web:pending"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: (chatJid, since, seenAssistantName) => {
        messageChecks.push({ chatJid, since, assistantName: seenAssistantName });
        return [{ id: `${chatJid}-message` }];
      },
    };


    const service = new WebChannelRuntimeStateService(callbacks, {
      defaultAgentId: "default",
    });
    assistantName = "Pi live";
    service.resumePendingChats(undefined, store);

    expect(messageChecks).toEqual([
      { chatJid: "web:pending", since: "t1", assistantName: "Pi live" },
    ]);
    expect(enqueued.map(({ key, laneKey }) => ({ key, laneKey }))).toEqual([
      { key: "resume:web:pending", laneKey: "chat:web:pending" },
    ]);

    await enqueued[0].task();

    expect(processed).toEqual([
      { chatJid: "web:pending", agentId: "default", threadRootId: undefined },
    ]);
  });

  test("state and runtime store delegations stay confined to injected stores", () => {
    const calls: string[] = [];
    const statusMap = new Map<string, Record<string, unknown>>();
    const expandedMap = new Map<string, { thought?: boolean; draft?: boolean }>();
    const bufferMap = new Map<string, { thought?: { text: string; totalLines: number }; draft?: { text: string; totalLines: number } }>();

    const agentStatusStore = {
      update: (chatJid: string, status: Record<string, unknown>) => {
        calls.push(`status.update:${chatJid}`);
        statusMap.set(chatJid, status);
      },
      get: (chatJid: string) => statusMap.get(chatJid) ?? null,
      dispose: () => {
        calls.push("status.dispose");
        statusMap.clear();
      },
    };
    const agentBuffers = {
      setPanelExpanded: (turnId: string, panel: "thought" | "draft", expanded: boolean) => {
        calls.push(`panel.set:${turnId}:${panel}:${expanded}`);
        expandedMap.set(turnId, { ...expandedMap.get(turnId), [panel]: expanded });
      },
      isPanelExpanded: (turnId: string, panel: "thought" | "draft") => expandedMap.get(turnId)?.[panel] ?? false,
      updateBuffer: (turnId: string, panel: "thought" | "draft", text: string, totalLines: number) => {
        calls.push(`buffer.update:${turnId}:${panel}:${totalLines}`);
        bufferMap.set(turnId, { ...bufferMap.get(turnId), [panel]: { text, totalLines } });
      },
      getBuffer: (turnId: string, panel: "thought" | "draft") => bufferMap.get(turnId)?.[panel],
    };

    const service = new WebChannelRuntimeStateService(
      {
        getAssistantName: () => "Pi",
        enqueue: async () => {},
        processChat: async () => {},
      },
      {
        defaultAgentId: "default",
      },
      {
        agentStatusStore,
        agentBuffers,
      }
    );

    for(const name of ['loadState','saveState','getContextUsage','setContextUsage'])expect(service).not.toHaveProperty(name);
    service.updateAgentStatus("web:1", { type: "intent", title: "Thinking", turn_id: "turn-1" });
    service.setPanelExpanded("turn-1", "thought", true);
    service.updateThoughtBuffer("turn-1", "line one", 1);
    service.updateDraftBuffer("turn-1", "draft one", 2);

    expect(service.getAgentStatus("web:1")).toEqual({ type: "intent", title: "Thinking", turn_id: "turn-1" });
    expect(service.isPanelExpanded("turn-1", "thought")).toBe(true);
    expect(service.getBuffer("turn-1", "thought")).toEqual({ text: "line one", totalLines: 1 });
    expect(service.getBuffer("turn-1", "draft")).toEqual({ text: "draft one", totalLines: 2 });
    expect(calls).toEqual([
      "status.update:web:1",
      "panel.set:turn-1:thought:true",
      "buffer.update:turn-1:thought:1",
      "buffer.update:turn-1:draft:2",
    ]);
  });
});


test("native status uses SDK observations only, never host activity or saved intents", () => {
  const statuses = new Map<string,any>();
  const service = new WebChannelRuntimeStateService({getAssistantName:()=>"Test",enqueue(){},async processChat(){},isNativeRuntime:()=>true},
    {defaultAgentId:"default"},{agentStatusStore:{get:(chat:string)=>statuses.get(chat)??null,update:(chat:string,value:any)=>statuses.set(chat,value),dispose(){}}});
  for (const intent_key of ["native_task","compaction","session_rotation"]) {
    service.updateAgentStatus("chat",{type:"intent",intent_key,title:"Working"});
    expect(service.getAgentStatus("chat")).toBeNull();
  }
  service.updateAgentStatus("chat",{sdk_observation:true,type:"thinking",state:"active",title:"Thinking..."});
  service.updateAgentStatus("chat",{type:"done",title:"Idle"});
  expect(service.getAgentStatus("chat")).toMatchObject({type:"thinking",state:"active"});
  service.updateAgentStatus("chat",{sdk_observation:true,type:"done",state:"idle",title:"Idle"});
  service.updateAgentStatus("chat",{type:"intent",intent_key:"native_task",title:"Working"});
  expect(service.getAgentStatus("chat")).toMatchObject({type:"done",state:"idle"});
  service.dispose();
});

test('direct resume context preserves callback receivers and null thread semantics', async () => {
  const tasks: Array<() => Promise<void>> = [], threads: Array<number | null | undefined> = [];
  const callbacks: WebChannelRuntimeStateCallbacks = {
    getAssistantName() { expect(this).toBe(callbacks); return 'Fixture'; },
    enqueue(task) { expect(this).toBe(callbacks); tasks.push(task); },
    async processChat(_chat, _agent, thread) { expect(this).toBe(callbacks); threads.push(thread); },
  };
  const service = new WebChannelRuntimeStateService(callbacks, { defaultAgentId: 'default' });
  try {
    service.resumeChat('fixture', null); await tasks[0]!();
    expect(threads).toEqual([undefined]);
  } finally { service.dispose(); }
});
