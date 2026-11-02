import { describe, expect, test } from "bun:test";
import "../../helpers.ts";
import { setChatCursor, getChatCursor, getDb, initDatabase } from "../../../src/db.js";
import { getIdentityConfig, setAssistantAvatar } from '../../../src/core/config.js';
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.ts";
import { AgentStatusStore } from "../../../src/channels/web/agent/agent-status-store.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function modelLookupFixture(getCurrentModelLabel: () => Promise<string | null>) {
  const statuses = new AgentStatusStore();
  type Result = { status: string; message: string };
  const compact = deferred<Result>();
  const stats = deferred<Result>();
  const compactStarted = deferred<void>();
  const statsStarted = deferred<void>();
  const events: Array<{ event: string; payload: any }> = [];
  const responses: string[] = [];
  let row = 0;
  const channel = {
    agentPool: {
      isStreaming: () => false, isActive: () => false, getCurrentModelLabel,
      applyControlCommand: (_jid: string, command: any) => {
        if (command.type === "stats") { statsStarted.resolve(); return stats.promise; }
        compactStarted.resolve(); return compact.promise;
      },
    },
    getQueuedFollowupCount: () => 0,
    getAgentStatus: (jid: string) => statuses.get(jid),
    updateAgentStatus: (jid: string, payload: Record<string, unknown>) => statuses.update(jid, payload),
    broadcastEvent: (event: string, payload: any) => { events.push({ event, payload }); },
    admitMessage: async () => ({ id: ++row, timestamp: `2026-10-15T00:00:0${row}Z`, data: { thread_id: null } }),
    sendMessage: async (_jid: string, content: string) => { responses.push(content); },
    json: (body: unknown, status = 200) => Response.json(body, { status }),
  } as any;
  const send = (content: string) => handleAgentMessage(channel, new Request("https://fixture/agent/default/message", {
    method: "POST", body: JSON.stringify({ content }),
  }), "/agent/default/message", "web:test", "default");
  return { statuses, compact, stats, compactStarted, statsStarted, events, responses, send };
}

describe("UI-only abort acknowledgement", () => {
  test("settled no-op abort clears only the captured busy status without a timeline post", async () => {
    const f = modelLookupFixture(async () => null);
    f.statuses.update("web:test", { type: "intent", turn_id: "old", title: "Working" });
    const pending = f.send("/abort");
    await f.compactStarted.promise;
    f.compact.resolve({ status: "success", message: "No active durable operation." });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ui_only: true, command: { status: "success", message: "No active durable operation." } });
    expect(f.statuses.get("web:test")).toMatchObject({ type: "done", title: "Idle", turn_id: "old" });
    expect(f.events.filter(e => e.event === "agent_status")).toHaveLength(1);
    expect(f.events.some(e => e.event === "new_post")).toBe(false);
    expect(f.responses).toEqual([]);
  });

  test("abort never clears a successor status or another chat", async () => {
    const f = modelLookupFixture(async () => null);
    f.statuses.update("web:test", { type: "intent", turn_id: "old" });
    f.statuses.update("web:other", { type: "intent", turn_id: "other" });
    const pending = f.send("/abort");
    await f.compactStarted.promise;
    f.statuses.update("web:test", { type: "intent", turn_id: "successor" });
    f.compact.resolve({ status: "success", message: "Aborted the current durable operation." });
    expect((await pending).status).toBe(200);
    expect(f.statuses.get("web:test")).toMatchObject({ turn_id: "successor", type: "intent" });
    expect(f.statuses.get("web:other")).toMatchObject({ turn_id: "other", type: "intent" });
    expect(f.events).toEqual([]);
  });

  test("failed cancellation is not acknowledged or painted idle", async () => {
    const f = modelLookupFixture(async () => null);
    f.statuses.update("web:test", { type: "intent", turn_id: "uncertain" });
    const pending = f.send("/abort");
    await f.compactStarted.promise;
    f.compact.resolve({ status: "error", message: "Abort terminal settlement pending" });
    const response = await pending;
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Abort terminal settlement pending", command: { status: "error" } });
    expect(f.statuses.get("web:test")).toMatchObject({ type: "intent", turn_id: "uncertain" });
    expect(f.events).toEqual([]);
  });
});

describe("manual command deferred model lookup ownership", () => {
  for (const command of ["/compact", "/session-rotate"]) {
    test(`${command} claims before lookup and cannot reclaim a newer command`, async () => {
      const model = deferred<string | null>();
      const modelStarted = deferred<void>();
      const f = modelLookupFixture(() => { modelStarted.resolve(); return model.promise; });
      const older = f.send(command);
      await modelStarted.promise;
      const initial = f.statuses.get("web:test")!;
      expect(initial).toMatchObject({ type: "intent", model: null,
        intent_key: command === "/compact" ? "compaction" : "session_rotation" });
      expect(f.events.filter(e => e.event === "agent_status")).toHaveLength(1);
      const newer = f.send("/stats");
      await f.statsStarted.promise;
      const owner = f.statuses.get("web:test")!;
      expect(owner.turn_id).not.toBe(initial.turn_id);
      const eventCount = f.events.length;
      model.resolve("fixture/resolved-model");
      await f.compactStarted.promise;
      expect(f.statuses.get("web:test")).toEqual(owner);
      expect(f.events.slice(eventCount).filter(e => e.event === "agent_status")).toEqual([]);
      f.compact.resolve({ status: "success", message: "Finished older command" });
      expect((await older).status).toBe(201);
      expect(f.responses).toContain("Finished older command");
      expect(f.statuses.get("web:test")).toEqual(owner);
      expect(f.events.slice(eventCount).filter(e => e.event === "agent_status")).toEqual([]);
      f.stats.resolve({ status: "success", message: "Finished stats" });
      expect((await newer).status).toBe(201);
      expect(f.statuses.get("web:test")).toMatchObject({ type: "done", turn_id: owner.turn_id });
    });

    test(`${command} model metadata preserves the original timer and turn`, async () => {
      const model = deferred<string | null>();
      const modelStarted = deferred<void>();
      const f = modelLookupFixture(() => { modelStarted.resolve(); return model.promise; });
      const pending = f.send(command);
      await modelStarted.promise;
      const initial = f.statuses.get("web:test")!;
      await Bun.sleep(5);
      model.resolve("fixture/resolved-model");
      await f.compactStarted.promise;
      expect(f.statuses.get("web:test")).toMatchObject({
        type: "intent", model: "fixture/resolved-model", turn_id: initial.turn_id,
        started_at: initial.started_at, run_started_at: initial.run_started_at, phase_key: initial.phase_key,
      });
      f.compact.resolve({ status: "success", message: "Finished" });
      expect((await pending).status).toBe(201);
      expect(f.statuses.get("web:test")).toMatchObject({ type: "done", turn_id: initial.turn_id });
    });

    for (const failure of ["reject", "throw"] as const) {
      test(`${command} model lookup ${failure} stays nonfatal and reaches its own terminal`, async () => {
        const f = modelLookupFixture(() => {
          if (failure === "throw") throw new Error("model lookup failed");
          return Promise.reject(new Error("model lookup failed"));
        });
        const pending = f.send(command);
        await f.compactStarted.promise;
        const owner = f.statuses.get("web:test")!;
        expect(owner).toMatchObject({ type: "intent", model: null });
        f.compact.resolve({ status: "error", message: "Compaction failed" });
        expect((await pending).status).toBe(201);
        expect(f.statuses.get("web:test")).toMatchObject({ type: "error", turn_id: owner.turn_id });
      });
    }
  }
});

describe("web agent message handler", () => {
  for (const duringAdmission of [false, true]) {
    test(`explicit queued thread survives busy input; admission race=${duringAdmission}`, async () => {
      let busy = !duringAdmission;
      const queued: any[][] = [], events: any[] = [];
      const channel = {
        agentPool: { isStreaming: () => busy, isActive: () => busy }, getQueuedFollowupCount: () => 0,
        async admitMessage(_chat: string, _content: string, _isBot: boolean, _media: unknown, _options: unknown, check: () => void, _signal: unknown, defer: () => boolean) {
          busy = true; check(); expect(defer()).toBe(true); return null;
        },
        enqueueQueuedFollowupItem(...args: any[]) { queued.push(args); return -42; },
        async admitQueuedFollowupItem(args: any[], check: () => void) { check(); queued.push(args); return -42; },
        broadcastEvent(event: string, data: unknown) { events.push({ event, data }); },
        json: (body: unknown, status = 200) => Response.json(body, { status }),
      } as any;
      const response = await handleAgentMessage(channel, new Request('https://fixture/agent/default/message', {
        method: 'POST', body: JSON.stringify({ content: 'explicit reply', thread_id: 17, mode: 'queue' }),
      }), '/agent/default/message', 'web:test', 'default');
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ queued: 'followup', thread_id: 17 });
      expect(queued).toHaveLength(1); expect(queued[0][3]).toBe(17);
      expect(events).toContainEqual({ event: 'agent_followup_queued', data: expect.objectContaining({ thread_id: 17 }) });
    });
  }
  test('idle input becoming busy during storage is queued atomically before acknowledgement',async()=>{
    let busy=false,committed=false,scheduled=0;const queued:any[]=[];const events:string[]=[];
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const channel={agentPool:{isStreaming:()=>busy,isActive:()=>busy},getQueuedFollowupCount:()=>queued.length,
      async admitMessage(_jid:string,_text:string, _isBot: boolean,_media:unknown,_options:unknown,check:()=>void,_signal:unknown,defer:()=>boolean){await gate;check();const queued=defer();committed=true;expect(queued).toBe(true);return null;},
      enqueueQueuedFollowupItem:(...args:any[])=>{expect(committed).toBe(false);queued.push(args);return -42;},broadcastEvent:(type:string)=>{expect(committed).toBe(true);events.push(type);},queue:{enqueue:()=>{scheduled++;}},resumeChat:()=>{scheduled++;},json:(value:unknown,status=200)=>Response.json(value,{status})} as any;
    const pending=handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content:'idle input'})}),'/agent/default/message','web:test','default');await Bun.sleep(0);expect(events).toEqual([]);busy=true;release();
    const response=await pending;expect(response.status).toBe(201);const body=await response.json();expect(body.queued).toBe('followup');expect(body.user_message).toBeUndefined();expect(queued[0].slice(0,4)).toEqual(['web:test',0,'idle input',null]);expect(events).toEqual(['agent_followup_queued']);expect(scheduled).toBe(0);
  });
  test('idle input acknowledgement and scheduling wait for successful atomic storage',async()=>{
    let committed=false,scheduled=0;const events:string[]=[];
    const channel={agentPool:{isStreaming:()=>false,isActive:()=>false},getQueuedFollowupCount:()=>0,
      async admitMessage(_jid:string,_text:string, _isBot: boolean,_media:unknown,_options:unknown,check:()=>void,_signal:unknown,defer:()=>boolean){check();expect(defer()).toBe(false);committed=true;return{id:43,chat_jid:'web:test',timestamp:'2026-10-04T13:00:01Z',data:{content:'idle input',thread_id:43}};},
      broadcastEvent:(type:string)=>{expect(committed).toBe(true);events.push(type);},queue:{enqueue:()=>{expect(committed).toBe(true);scheduled++;}},json:(value:unknown,status=200)=>Response.json(value,{status})} as any;
    const request=()=>new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content:'idle input'})});
    expect((await handleAgentMessage(channel,request(),'/agent/default/message','web:test','default')).status).toBe(201);expect(events).toEqual(['new_post']);expect(scheduled).toBe(1);
    channel.admitMessage=async()=>{throw Error('write rejected');};events.length=0;expect((await handleAgentMessage(channel,request(),'/agent/default/message','web:test','default')).status).toBe(503);expect(events).toEqual([]);expect(scheduled).toBe(1);
  });
  test('fresh streaming state prevents a compose wake even if the active flag is false',async()=>{
    let wakes=0,admissions=0;
    const channel={agentPool:{isStreaming:()=>true,isActive:()=>false},getQueuedFollowupCount:()=>0,resumeChat:()=>{wakes++;},admitQueuedFollowupItem:async()=>{admissions++;return -1;},broadcastEvent:()=>{},json:(body:unknown,status=200)=>Response.json(body,{status})} as any;
    const response=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content:'stay queued while streaming',mode:'queue'})}),'/agent/default/message','web:test','default');
    expect(response.status).toBe(201);expect(admissions).toBe(1);expect(wakes).toBe(0);
  });
  test('manual queue remains deferred when streaming stops during storage admission',async()=>{
    let streaming=true,wakes=0;
    const channel={agentPool:{isStreaming:()=>streaming,isActive:()=>false},getQueuedFollowupCount:()=>0,resumeChat:()=>{wakes++;},admitQueuedFollowupItem:async()=>{streaming=false;return -1;},broadcastEvent:()=>{},json:(body:unknown,status=200)=>Response.json(body,{status})} as any;
    const response=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content:'/queue explicitly deferred'})}),'/agent/default/message','web:test','default');
    expect(response.status).toBe(201);expect((await response.json()).queued).toBe('followup');expect(wakes).toBe(0);
  });
  test('queued HTTP acknowledgement follows durable admission and rejects changed authority without broadcast', async () => {
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    let admitted=false,active=true,wakes=0;const events:string[]=[];
    let principal:any={kind:'local',userId:'default',mode:'single-user',role:'admin',authentication:{method:'local',sessionId:null,expiresAt:null}};
    const channel={authGateway:{getPrincipal:()=>principal,isAuthEnabled:()=>false},agentPool:{isStreaming:()=>false,isActive:()=>active},getQueuedFollowupCount:()=>0,resumeChat:()=>{expect(admitted).toBe(true);wakes++;},
      async admitQueuedFollowupItem(_args:unknown,check:()=>void){await gate;check();admitted=true;return -1;},broadcastEvent:(type:string)=>{expect(admitted).toBe(true);events.push(type);},json:(body:unknown,status=200)=>Response.json(body,{status})} as any;
    const request=()=>new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content:'synthetic queued input',mode:'queue'})});
    let done=false;const pending=handleAgentMessage(channel,request(),'/agent/default/message','web:test','default').then(res=>{done=true;return res;});await Bun.sleep(0);expect(done).toBe(false);expect(events).toEqual([]);
    active=false;release();expect((await pending).status).toBe(201);expect(events).toEqual(['agent_followup_queued']);expect(wakes).toBe(1);
    channel.admitQueuedFollowupItem=async(_args:unknown,check:()=>void)=>{principal={...principal,userId:'replacement'};check();return -2;};
    active=true;events.length=0;expect((await handleAgentMessage(channel,request(),'/agent/default/message','web:test','default')).status).toBe(403);expect(events).toEqual([]);
  });
  test('avatar command broadcasts updated branding and completion cannot restore the captured old avatar', async () => {
    const previous = getIdentityConfig().assistantAvatar;
    const broadcasts: Array<{event: string; payload: any}> = [];
    let status: Record<string, unknown> | null = null;
    try {
      setAssistantAvatar('/missing/old-avatar.png');
      const channel = {
        agentPool: { isStreaming: () => false, isActive: () => false, applyControlCommand: async () => { setAssistantAvatar(''); return {status:'success',message:'Cleared'}; } },
        json: (body: unknown, status = 200) => Response.json(body,{status}),
        getQueuedFollowupCount: () => 0, getAgentStatus: () => status,
        broadcastEvent: (event: string,payload: any) => broadcasts.push({event,payload}), updateAgentStatus: (_jid: string, next: Record<string, unknown>) => { status = next; },
        admitMessage: async () => ({id:456,timestamp:'2026-09-22T00:00:00Z',data:{thread_id:null},content:'/agent-avatar clear'}), sendMessage: async () => {},
      } as any;
      const response = await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'/agent-avatar clear'})}),'/agent/default/message','web:default','default');
      expect(response.status).toBe(201);
      expect(broadcasts.find(b => b.event === 'profile_update')?.payload.agent_avatar).toBeNull();
      const done = broadcasts.find(b => b.event === 'agent_status' && b.payload.type === 'done');
      expect(done).toBeDefined(); expect(done!.payload.agent_avatar).toBeNull();
    } finally { setAssistantAvatar(previous); }
  });
  test("handles /meters as a UI-only command while still returning command output as an assistant message", async () => {
    initDatabase();
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];

    const channel = {
      agentPool: {
        isStreaming: () => false,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: () => 999,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => null,
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/meters on" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(body.command?.payload).toEqual({ mode: "set", enabled: true });
    expect(broadcasts.some((entry) => entry.event === "ui_meters")).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].content).toBe(body.command.message);
  });

  test("handles /theme as a UI-only command while still returning command output as an assistant message", async () => {
    initDatabase();
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => true,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 999;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/theme gruvbox" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.thread_id).toBeNull();
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(storeMessageCalls).toBe(0);
    expect(broadcasts.some((entry) => entry.event === "ui_theme")).toBe(true);
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(false);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].content).toBe(body.command.message);
    expect((sentMessages[0].options as { forceRoot?: boolean })?.forceRoot).toBe(true);
  });

  test("shows the themed /theme table when command is used without a theme name", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];

    const channel = {
      agentPool: {
        isStreaming: () => true,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 999;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => null,
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/theme" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(body.command?.message).toContain("| Theme | Mode | Swatches |");
    expect(body.command?.message).toContain("data:image/svg+xml;base64,");
    expect(queuedFollowups).toHaveLength(0);
  });

  test("handles /abort as a UI-only hard stop without writing a timeline command message", async () => {
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const applyCalls: Array<{ chatJid: string; command: { type: string; raw: string } }> = [];
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => true,
        isActive: () => true,
        applyControlCommand: async (chatJid: string, command: { type: string; raw: string }) => {
          applyCalls.push({ chatJid, command });
          return { status: "success", message: "Aborted current response." };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/abort" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.immediate).toBe(true);
    expect(body.command?.message).toBe("Aborted current response.");
    expect(applyCalls).toEqual([{ chatJid: "web:default", command: { type: "abort", raw: "/abort" } }]);
    expect(storeMessageCalls).toBe(0);
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(false);
  });

  test("runs /compact immediately while the current session is still active", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];
    const broadcasts: Array<{ event: string; payload: any }> = [];
    const statusUpdates: Array<{ chatJid: string; status: any }> = [];
    const contextUsages: Array<{ chatJid: string; usage: any }> = [];
    let applyCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("compact");
          return {
            status: "success",
            message: "Compaction requested immediately.",
            contextUsage: {
              tokens: 321,
              contextWindow: 1000,
              percent: 32.1,
              estimated: true,
              source: "compact_command",
              phase: "after_manual_compaction",
            },
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 456;
      },
      getQueuedFollowupCount: () => 0,
      getAgentStatus: () => statusUpdates.at(-1)?.status ?? null,
      broadcastEvent: (event: string, payload: any) => broadcasts.push({ event, payload }),
      updateAgentStatus: (chatJid: string, status: any) => statusUpdates.push({ chatJid, status }),
      setContextUsage: (chatJid: string, usage: any) => contextUsages.push({ chatJid, usage }),
      admitMessage: async () => {
        storeMessageCalls += 1;
        return {
          id: 456,
          timestamp: "2026-03-14T21:10:00.000Z",
          data: { thread_id: null },
          content: "/compact keep current work",
        };
      },
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/compact keep current work" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applyCalls).toBe(1);
    expect(storeMessageCalls).toBe(1);
    expect(sentMessages[0]?.content).toBe("Compaction requested immediately.");
    expect(contextUsages).toEqual([]); // Existing SSE below owns the projection; no host context copy.
    expect(statusUpdates.map(entry => entry.status.type)).toEqual(["intent", "done"]);
    expect(broadcasts).toContainEqual(expect.objectContaining({
      event: "agent_status",
      payload: expect.objectContaining({
        chat_jid: "web:default",
        type: "context_usage",
        context_usage: expect.objectContaining({
          tokens: 321,
          contextWindow: 1000,
          percent: 32.1,
          contextUpdate: "replace",
          estimated: true,
          source: "compact_command",
          phase: "after_manual_compaction",
        }),
      }),
    }));
  });

  test("runs /model immediately while the current session is still active", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    let applyCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("model");
          return { status: "success", message: "Model set.", model_label: "openai/gpt-4.1" };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 458;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      retryFailedOnModelSwitch: () => false,
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/model openai/gpt-4.1" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applyCalls).toBe(1);
    expect(storeMessageCalls).toBe(0);
  });

  test("runs /model --compact immediately while the current session is still active", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    let applyCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string; compact?: boolean }) => {
          applyCalls += 1;
          expect(command.type).toBe("model");
          expect(command.compact).toBe(true);
          return { status: "success", message: "Compacted and switched.", model_label: "openai/gpt-4.1" };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 457;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      retryFailedOnModelSwitch: () => false,
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/model openai/gpt-4.1 --compact" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applyCalls).toBe(1);
    expect(storeMessageCalls).toBe(0);
  });

  test("does not defer /session-rotate while streaming and returns the command error immediately", async () => {
    initDatabase();

    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; threadId: number | null }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    let applyCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("session_rotate");
          return {
            status: "error",
            message: "Cannot rotate the session while a response, compaction, or retry is active.",
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 111;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      updateAgentStatus: () => {},
      skipFailedOnModelSwitch: () => {},
      admitMessage: async (_chatJid: string, content: string) => ({
        id: 321,
        timestamp: "2026-03-14T21:10:00.000Z",
        data: { thread_id: null },
        content,
      }),
      sendMessage: async (chatJid: string, content: string, threadId: number | null) => {
        sentMessages.push({ chatJid, content, threadId });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/session-rotate keep active context" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("error");
    expect(body.command?.message).toContain("Cannot rotate the session while a response");
    expect(applyCalls).toBe(1);
    expect(queuedFollowups).toHaveLength(0);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toContain("Cannot rotate the session while a response");
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
  });

  test("does not advance the chat cursor for commands while another turn is inflight", async () => {
    initDatabase();

    const chatJid = "web:default";
    const inflightTimestamp = "2026-03-14T21:00:00.000Z";
    setChatCursor(chatJid, inflightTimestamp);

    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];

    const channel = {
      agentPool: {
        isStreaming: () => true,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          expect(command.type).toBe("tree");
          expect(command.raw).toBe("/tree");
          return {
            status: "success",
            message: "tree output",
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      updateAgentStatus: () => {},
      admitMessage: async () => ({
        id: 987,
        timestamp: "2026-03-14T21:05:00.000Z",
        data: { thread_id: null },
        content: "/tree",
      }),
      sendMessage: async (targetChatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid: targetChatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/tree" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", chatJid, "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.command?.status).toBe("success");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toBe("tree output");
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
    expect(getChatCursor(chatJid)).toBe(inflightTimestamp);
    expect(getDb().query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chatJid)).toEqual({chat_jid:chatJid,cursor_ts:inflightTimestamp,queued_followups_json:null});
  });

  test("runs extension-style slash commands immediately while the current session is active", async () => {
    initDatabase();

    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    let applySlashCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      lastCommandInteractionId: null,
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applySlashCommand: async (_chatJid: string, rawText: string) => {
          applySlashCalls += 1;
          expect(rawText).toBe("/custom-extension do it");
          return { status: "success", message: "extension command ran" };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 222;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      updateAgentStatus: () => {},
      admitMessage: async () => {
        storeMessageCalls += 1;
        return {
          id: 222,
          timestamp: "2026-03-14T21:15:00.000Z",
          data: { thread_id: null },
          content: "/custom-extension do it",
        };
      },
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/custom-extension do it" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applySlashCalls).toBe(1);
    expect(storeMessageCalls).toBe(1);
    expect(sentMessages[0]?.content).toBe("extension command ran");
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
  });

  test("surfaces a successful /session-rotate result immediately when the chat is idle", async () => {
    initDatabase();

    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; threadId: number | null }> = [];
    const broadcasts: Array<{ event: string; payload: any }> = [];
    const statusUpdates: Array<Record<string, any>> = [];
    const contextUsages: Array<Record<string, any>> = [];
    let applyCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => false,
        getCurrentModelLabel: async () => "github-copilot/gpt-5.4",
        getAvailableModels: async () => ({
          current: "github-copilot/gpt-5.4",
          thinking_level: "high",
          thinking_level_label: "High",
          supports_thinking: true,
        }),
        getContextUsageForChat: async () => ({ tokens: 4_096, contextWindow: 128_000, percent: 3.2 }),
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("session_rotate");
          return {
            status: "success",
            sessionGeneration: "session-after-rotate",
            sessionGenerationChanged: true,
            message: [
              "Session rotated.",
              "Archived previous session: /tmp/archive/session.jsonl",
              "New session: /tmp/session.jsonl",
            ].join("\n"),
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 222;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      getAgentStatus: () => statusUpdates.at(-1) ?? null,
      updateAgentStatus: (_chatJid: string, status: Record<string, any>) => { statusUpdates.push(status); },
      setContextUsage: (_chatJid: string, usage: Record<string, any>) => { contextUsages.push(usage); },
      skipFailedOnModelSwitch: () => {},
      admitMessage: async (_chatJid: string, content: string) => ({
        id: 654,
        timestamp: "2026-03-14T21:20:00.000Z",
        data: { thread_id: null },
        content,
      }),
      sendMessage: async (chatJid: string, content: string, threadId: number | null) => {
        sentMessages.push({ chatJid, content, threadId });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/session-rotate keep active context" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("success");
    expect(body.command?.message).toContain("Session rotated.");
    expect(applyCalls).toBe(1);
    expect(queuedFollowups).toHaveLength(0);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toContain("Archived previous session:");
    expect(statusUpdates[0]).toMatchObject({
      type: "intent",
      intent_key: "session_rotation",
      title: "Rotating session",
      model: null,
    });
    expect(statusUpdates[1]).toMatchObject({
      type: "intent",
      intent_key: "session_rotation",
      title: "Rotating session",
      started_at: statusUpdates[0].started_at,
      turn_id: statusUpdates[0].turn_id,
      run_started_at: statusUpdates[0].run_started_at,
      model: "github-copilot/gpt-5.4",
    });
    expect(statusUpdates.map(status => status.type)).toEqual(["intent", "intent", "done"]);
    expect(broadcasts.map(entry => entry.payload)).toContainEqual(expect.objectContaining({
      type: "context_usage",
      context_reset: true,
      sessionGeneration: "session-after-rotate",
      context_usage: {
        tokens: null,
        contextWindow: null,
        percent: null,
        sessionGeneration: "session-after-rotate",
        contextUpdate: "replace",
      },
    }));
    expect(contextUsages).toEqual([]); // Exact reset envelope is asserted on SSE above.
    expect(broadcasts).toContainEqual(expect.objectContaining({
      event: "model_changed",
      payload: expect.objectContaining({ chat_jid: "web:default", model: "github-copilot/gpt-5.4" }),
    }));
    expect(statusUpdates.at(-1)).toMatchObject({ type: "done", title: "Completed /session-rotate" });
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
  });

  test("defers a normal user turn while the chat is still active even if streaming already settled", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    let timelineAdmissions = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      admitQueuedFollowupItem: async ([chatJid, _rowId, content]: [string, number, string], check: (phase: string) => void, signal: AbortSignal) => {
        signal.throwIfAborted(); check('before'); queuedFollowups.push({ chatJid, content }); check('after');
        return 777;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      admitMessage: async () => {
        timelineAdmissions += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "follow up while compacting" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.queued).toBe("followup");
    expect(queuedFollowups).toEqual([{ chatJid: "web:default", content: "follow up while compacting" }]);
    expect(timelineAdmissions).toBe(0);
  });

  test("returns typed 400s for malformed agent message payload classes", async () => {
    const channel = {
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    } as any;

    const cases = [
      {
        name: "invalid json",
        body: "{",
        expectedError: "Invalid JSON",
      },
      {
        name: "non-object body",
        body: JSON.stringify(["bad"]),
        expectedError: "JSON body must be an object",
      },
      {
        name: "content wrong type",
        body: JSON.stringify({ content: 42 }),
        expectedError: "'content' must be a string",
      },
      {
        name: "mode wrong type",
        body: JSON.stringify({ content: "hello", mode: "sideways" }),
        expectedError: "'mode' must be one of: auto, queue, steer",
      },
      {
        name: "thread id wrong type",
        body: JSON.stringify({ content: "hello", thread_id: "nan" }),
        expectedError: "'thread_id' must be a positive integer or null",
      },
      {
        name: "content blocks wrong shape",
        body: JSON.stringify({ content: "hello", content_blocks: { type: "text" } }),
        expectedError: "'content_blocks' must be an array",
      },
      {
        name: "media ids wrong shape",
        body: JSON.stringify({ content: "hello", media_ids: { id: 1 } }),
        expectedError: "'media_ids' must be an array",
      },
      {
        name: "link previews wrong shape",
        body: JSON.stringify({ content: "hello", link_previews: "https://example.com" }),
        expectedError: "'link_previews' must be an array",
      },
      {
        name: "content too large",
        body: JSON.stringify({ content: "x".repeat(100 * 1024 + 1) }),
        expectedError: "Content too large (max 100 KB)",
      },
    ];

    for (const testCase of cases) {
      const req = new Request("https://example.com/agent/default/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: testCase.body,
      });

      const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
      expect(response.status, testCase.name).toBe(400);
      expect((await response.json()).error, testCase.name).toBe(testCase.expectedError);
    }
  });
});

test('/theme acknowledges applied UI change but reports failed timeline delivery without session lookup',async()=>{
 const broadcasts:any[]=[];const channel:any={getQueuedFollowupCount:()=>0,agentPool:{isStreaming:()=>false,isActive:()=>false,applySlashCommand:()=>{throw Error('must not hydrate');}},queue:{enqueue:()=>{throw Error('must not queue');}},getLastMessageTimestamp:()=>'',json:(body:any,status=200)=>Response.json(body,{status}),broadcastEvent:(event:any)=>broadcasts.push(event),sendMessage:async()=>{throw Error('synthetic delivery failure');},storeMessage:()=>{throw Error('must not store input');}};
 const response=await handleAgentMessage(channel,new Request('http://test/agent/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'/theme default'})}), '/agent/message');expect(response.status).toBe(200);const body=await response.json();expect(body.ui_only).toBe(true);expect(body.response_delivery).toBe('failed');expect(broadcasts).toContain('ui_theme');
});

test('/theme with the real write service reports a null insert without replaying UI state',async()=>{
 const {WebMessageWriteService}=await import('../../../src/channels/web/message-write-service');let updates=0,replies=0;
 const writer=new WebMessageWriteService({storeMessage:()=>null,replaceMessageContent:()=>null,broadcastAgentResponse:()=>{replies++;},broadcastInteractionUpdated:()=>{},queueFollowup:()=>{}} as any);
 const channel:any={getQueuedFollowupCount:()=>0,agentPool:{isStreaming:()=>false,isActive:()=>false},queue:{enqueue:()=>{throw Error('must not enqueue');}},getLastMessageTimestamp:()=>'',json:(body:any,status=200)=>Response.json(body,{status}),broadcastEvent:(event:string)=>{if(event==='ui_theme')updates++;},sendMessage:(...args:any[])=>writer.sendMessage(args[0],args[1],args[2]),storeMessage:()=>{throw Error('must not persist input');}};
 const response=await handleAgentMessage(channel,new Request('http://test/agent/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'/theme default'})}),'/agent/message');expect(response.status).toBe(200);const body=await response.json();expect(body.ui_only).toBe(true);expect(body.response_delivery).toBe('failed');expect(updates).toBe(1);expect(replies).toBe(0);
});
