import { expect, spyOn, test } from "bun:test";

import { SseHub } from "../../../src/channels/web/sse/sse-hub.js";

const chatJid = "web:classic";

function classicSseFixture() {
  const hub = new SseHub();
  const abort = new AbortController();
  const request = new Request(`https://example.test/sse/stream?chat_jid=${chatJid}`, { signal: abort.signal });
  const add = spyOn(request.signal, "addEventListener");
  const remove = spyOn(request.signal, "removeEventListener");
  const timer = {} as Timer;
  const interval = spyOn(globalThis, "setInterval").mockReturnValue(timer);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  return {
    hub, abort, request, interval, add, remove, clear,
    tick: () => interval.mock.calls[0]![0](),
    expectReleased() {
      expect(hub.clients.size).toBe(0);
      expect(interval).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledWith(timer);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add.mock.calls[0]![0]).toBe("abort");
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
    },
    restore() {
      hub.closeAll();
      interval.mockRestore();
      clear.mockRestore();
      add.mockRestore();
      remove.mockRestore();
    },
  };
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { done, value } = await reader.read();
  expect(done).toBe(false);
  return new TextDecoder().decode(value);
}

test("Classic SSE does not register an already-aborted request", async () => {
  const f = classicSseFixture();
  try {
    f.abort.abort();
    const response = f.hub.handleRequest(f.request);
    expect(f.hub.clients.size).toBe(0);
    expect(f.interval).not.toHaveBeenCalled();
    expect(f.add).not.toHaveBeenCalled();
    expect(await response.text()).toBe("");
  } finally { f.restore(); }
});

test("Classic SSE releases a request aborted while its listener is being registered", async () => {
  const f = classicSseFixture();
  try {
    f.add.mockImplementation(() => { f.abort.abort(); });
    const response = f.hub.handleRequest(f.request);

    f.expectReleased();
    expect(await response.text()).toBe("");
  } finally { f.restore(); }
});

test("Classic SSE request abort releases the client before any body cancellation", async () => {
  const f = classicSseFixture();
  try {
    const reader = f.hub.handleRequest(f.request).body!.getReader();
    expect(f.hub.clients.size).toBe(1);
    expect(await readFrame(reader)).toStartWith("event: connected\n");
    const waiting = reader.read();
    f.abort.abort();
    f.expectReleased();
    expect((await waiting).done).toBe(true);
    await reader.cancel();
    f.tick();
    f.hub.closeAll();
    f.expectReleased();
  } finally { f.restore(); }
});

test("Classic SSE skips backed-up heartbeats but sends fresh heartbeats and ordered real frames", async () => {
  const f = classicSseFixture();
  const now = spyOn(Date, "now").mockReturnValue(1000);
  try {
    const reader = f.hub.handleRequest(f.request).body!.getReader();
    const { controller } = f.hub.clients.values().next().value!;
    expect(controller.desiredSize).toBe(0); // Connected is still queued.
    f.tick();
    expect(controller.desiredSize).toBe(0);
    f.hub.broadcast("workspace_update", { updates: ["first"] });
    f.hub.broadcast("agent_status", { chat_jid: chatJid, type: "thinking" });
    f.tick();
    expect(f.hub.clients.size).toBe(1);

    expect(await readFrame(reader)).toStartWith("event: connected\n");
    expect(await readFrame(reader)).toBe('event: workspace_update\ndata: {"updates":["first"]}\n\n');
    expect(await readFrame(reader)).toBe(`event: agent_status\ndata: {"chat_jid":"${chatJid}","type":"thinking"}\n\n`);
    expect(controller.desiredSize).toBe(1);
    now.mockReturnValue(2000);
    f.tick();
    f.hub.broadcast("picker_pins_changed", { operator: true });
    f.hub.closeAll();
    f.expectReleased();

    expect(await readFrame(reader)).toBe(": heartbeat\n\n");
    expect(await readFrame(reader)).toBe(`event: heartbeat\ndata: {"ts":2000,"chat_jid":"${chatJid}"}\n\n`);
    expect(await readFrame(reader)).toBe("event: picker_pins_changed\ndata: {}\n\n");
    expect((await reader.read()).done).toBe(true);
  } finally {
    now.mockRestore();
    f.restore();
  }
});

test("Classic SSE reentrant authorizer or projector abort cannot enqueue a reliable frame after returning success", async () => {
  for (const cause of ["authorizer", "projector"] as const) {
    const f = classicSseFixture();
    let armed = false;
    try {
      const abortAndSucceed = () => {
        if (armed) f.abort.abort();
        return true;
      };
      const authorisation = {
        chatJid,
        isAuthorised: cause === "authorizer" ? abortAndSucceed : () => true,
        ...(cause === "projector" ? { project: abortAndSucceed } : {}),
      };
      const reader = f.hub.handleRequest(f.request, authorisation).body!.getReader();
      expect(await readFrame(reader)).toStartWith("event: connected\n");

      armed = true;
      f.hub.broadcast("agent_status", { chat_jid: chatJid, status: "thinking" });
      f.expectReleased();
      expect((await reader.read()).done).toBe(true);
      f.tick();
      f.hub.closeAll();
      f.expectReleased();
    } finally { f.restore(); }
  }
});

test.each(["body cancel", "revocation", "enqueue failure", "abort during revalidation"] as const)(
  "Classic SSE releases registration exactly once on %s", async (cause) => {
    const f = classicSseFixture();
    let authorise = () => true;
    try {
      const reader = f.hub.handleRequest(f.request, { chatJid, isAuthorised: () => authorise() }).body!.getReader();
      const { controller } = f.hub.clients.values().next().value!;
      expect(controller.desiredSize).toBe(0);
      if (cause === "body cancel") {
        await reader.cancel();
      } else if (cause === "enqueue failure") {
        const enqueue = spyOn(controller, "enqueue").mockImplementation(() => { throw new Error("enqueue failed"); });
        try { f.hub.broadcast("agent_status", { chat_jid: chatJid }); }
        finally { enqueue.mockRestore(); }
      } else {
        authorise = () => {
          if (cause === "abort during revalidation") f.abort.abort();
          return false;
        };
        f.tick(); // Revalidate even though there is no room for a heartbeat.
      }
      f.expectReleased();
      f.abort.abort();
      f.tick();
      f.hub.closeAll();
      f.expectReleased();
      if (cause !== "body cancel") expect(await readFrame(reader)).toStartWith("event: connected\n");
      expect((await reader.read()).done).toBe(true);
    } finally { f.restore(); }
  },
);

test("SseHub.closeAll continues after a throwing client close and releases every registration", async () => {
  const f = classicSseFixture();
  const secondAbort = new AbortController();
  const secondRequest = new Request(`https://example.test/sse/stream?chat_jid=${chatJid}`, { signal: secondAbort.signal });
  const secondAdd = spyOn(secondRequest.signal, "addEventListener");
  const secondRemove = spyOn(secondRequest.signal, "removeEventListener");
  let throwingClose: { mockRestore(): void } | undefined;
  let firstReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    firstReader = f.hub.handleRequest(f.request).body!.getReader();
    const secondReader = f.hub.handleRequest(secondRequest).body!.getReader();
    const [first, second] = [...f.hub.clients];
    throwingClose = spyOn(first!.controller, "close").mockImplementation(() => {
      throw new Error("already closed");
    });
    const secondClose = spyOn(second!.controller, "close");

    expect(() => f.hub.closeAll()).not.toThrow();
    expect(f.hub.clients.size).toBe(0);
    expect(f.interval).toHaveBeenCalledTimes(2);
    expect(f.clear).toHaveBeenCalledTimes(2);
    expect(f.add).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenCalledWith("abort", f.add.mock.calls[0]![1]);
    expect(secondAdd).toHaveBeenCalledTimes(1);
    expect(secondRemove).toHaveBeenCalledTimes(1);
    expect(secondRemove).toHaveBeenCalledWith("abort", secondAdd.mock.calls[0]![1]);
    expect(throwingClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
    expect(await readFrame(firstReader)).toStartWith("event: connected\n");
    expect(await readFrame(secondReader)).toStartWith("event: connected\n");
    expect((await secondReader.read()).done).toBe(true);
  } finally {
    throwingClose?.mockRestore();
    await firstReader?.cancel();
    secondAdd.mockRestore();
    secondRemove.mockRestore();
    f.restore();
  }
});

test('pin invalidation reaches only the matching account or operator, independent of chat',()=>{
 const hub=new SseHub();const received:Record<string,string[]>={a:[],a2:[],b:[],operator:[],revoked:[]};
 for(const key of Object.keys(received))hub.clients.add({controller:{enqueue:(bytes:Uint8Array)=>received[key].push(new TextDecoder().decode(bytes)),close:()=>{}} as any,heartbeat:setInterval(()=>{},60000),chatJid:'web:'+key,...(key==='operator'?{}:{authorisation:{chatJid:'web:'+key,userId:key==='a2'?'a':key,isAuthorised:()=>key!=='revoked'}})});
 try{
  hub.broadcast('picker_pins_changed',{user_id:'a'});expect(received.a).toHaveLength(1);expect(received.a2).toHaveLength(1);expect(received.b).toEqual([]);expect(received.operator).toEqual([]);expect(received.revoked).toEqual([]);expect(received.a[0]).toBe('event: picker_pins_changed\ndata: {}\n\n');
  hub.broadcast('picker_pins_changed',{operator:true});expect(received.operator).toHaveLength(1);expect(received.a).toHaveLength(1);
  hub.broadcast('unknown_global',{operator:true});expect(received.a).toHaveLength(1);
 }finally{hub.closeAll();}
});

test('global branding is projected even without an optional family projector, and revoked clients receive nothing', () => {
  const hub = new SseHub(); const received: Record<string,string[]> = {family:[],operator:[],revoked:[]};
  for (const key of Object.keys(received)) hub.clients.add({controller:{enqueue:(bytes:Uint8Array)=>received[key].push(new TextDecoder().decode(bytes)),close:()=>{}},heartbeat:setInterval(()=>{},60000),chatJid:'web:'+key,...(key==='operator'?{}:{authorisation:{chatJid:'web:'+key,userId:key,isAuthorised:()=>key!=='revoked'}})} as any);
  try {
    hub.broadcast('profile_update',{agent_id:'default',agent_name:'Public name',agent_avatar:'/avatar/agent?v=abc',user_name:'Private user',user_avatar:'/private/user',config:{secret:'private'}});
    expect(received.family).toEqual(['event: profile_update\ndata: {"agent_id":"default","agent_name":"Public name","agent_avatar":"/avatar/agent?v=abc"}\n\n']);
    expect(received.operator[0]).toContain('Private user'); expect(received.revoked).toEqual([]);
    hub.broadcast('profile_update',{agent_id:'private-branch',agent_name:'Private branch',agent_avatar:'/avatar/agent?v=abc'}); expect(received.family).toHaveLength(1);
    hub.broadcast('profile_update',{agent_name:'Missing identity'}); expect(received.family).toHaveLength(1);
    hub.broadcast('unknown_global',{secret:'never'}); expect(received.family).toHaveLength(1);
  } finally { hub.closeAll(); }
});
