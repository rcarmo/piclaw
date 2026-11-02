import { expect, test } from "bun:test";
import "../../helpers.ts";
import { getDb, getDeferredQueuedFollowups, initDatabase, setDeferredQueuedFollowups } from "../../../src/db.js";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.js";

function fixture() {
  const calls: string[] = [], queued: any[][] = [];
  const fence = { current: true };
  const accept = () => {};
  const unexpected = () => { calls.push("legacy"); throw Error("legacy execution forbidden"); };
  const channel: any = {
    agentPool: { isDurableRuntime: () => true, isStreaming: () => true, isActive: () => true,
      getOrCreateRuntime: unexpected, getOrCreateSession: unexpected,
      queueStreamingMessage: unexpected, removeQueuedFollowupMessage: unexpected,
      applyControlCommand: unexpected },
    prepareInputText: (_chat: string, text: string) => ({ text, assertCurrent() { if (!fence.current) throw Error("revoked"); } }),
    getInputSourceAdmission: () => accept,
    getQueuedInputSourceAdmission: () => accept,
    getAcceptedQueuedSteering: () => undefined,
    admitMessage: unexpected,
    async admitQueuedFollowupItem(args: any[], check: () => void, _signal: unknown, admission: unknown) {
      check(); expect(admission).toBe(accept); calls.push("queue-write"); queued.push(args); return -75;
    },
    enqueueQueuedFollowupItem: unexpected, storeMessage: unexpected,
    getQueuedFollowupCount: () => 0,
    broadcastEvent: (event: string) => calls.push(event), resumeChat: () => calls.push("wake"),
    queue: { enqueue: unexpected },
    json: (body: unknown, status = 200) => Response.json(body, { status }),
  };
  const send = (body: unknown, signal?: AbortSignal, chat = "web:queue-boundary") => handleAgentMessage(channel,
    new Request("https://fixture/agent/default/message", { method: "POST", body: JSON.stringify(body), signal }),
    "/agent/default/message", chat, "default");
  return { channel, calls, queued, fence, send };
}

const payloads = [
  { content: "queued input", mode: "queue" }, { content: "steered input", mode: "steer", persist_steer: true },
  { content: "ordinary input", mode: "auto" }, { content: "/queue explicit input" }, { content: "/steer explicit input" },
];
for (const missing of ["getInputSourceAdmission", "getQueuedInputSourceAdmission", "admitMessage", "admitQueuedFollowupItem", "getAcceptedQueuedSteering"]) {
  for (const payload of payloads) test(`native queue ingress rejects missing ${missing} before effects: ${payload.mode ?? payload.content}`, async () => {
    const f = fixture(); delete f.channel[missing];
    expect((await f.send(payload)).status).toBe(503);
    expect(f.calls).toEqual([]); expect(f.queued).toEqual([]);
  });
}
for (const selector of ["getInputSourceAdmission", "getQueuedInputSourceAdmission"]) {
  test(`native queue ingress rejects an unavailable source callback: ${selector}`, async () => {
    const f = fixture(); f.channel[selector] = () => undefined;
    expect((await f.send({ content: "held input", mode: "queue" })).status).toBe(503);
    expect(f.calls).toEqual([]); expect(f.queued).toEqual([]);
  });
}
for (const failed of ["getInputSourceAdmission", "getQueuedInputSourceAdmission", "getAcceptedQueuedSteering", "prepared-authority"]) {
  test(`native queue ingress rejects fenced/unavailable authority without effects: ${failed}`, async () => {
    const f = fixture();
    if (failed === "prepared-authority") f.fence.current = false;
    else f.channel[failed] = () => { throw Error("fenced private authority"); };
    expect((await f.send({ content: "held input", mode: "steer", persist_steer: true })).status).toBe(503);
    expect(f.calls).toEqual([]); expect(f.queued).toEqual([]);
  });
}
for (const failure of ["revoke", "abort"]) test(`native queued commit rechecks ${failure} after asynchronous admission wait`, async () => {
  const f = fixture(), controller = new AbortController();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.channel.admitQueuedFollowupItem = async (_args: unknown, check: () => void) => {
    entered(); await held; check(); f.calls.push("queue-write"); return -75;
  };
  const pending = f.send({ content: "held input", mode: "queue" }, controller.signal);
  await started; expect(f.calls).toEqual([]);
  if (failure === "abort") controller.abort(); else f.fence.current = false;
  release(); expect((await pending).status).toBe(failure === "abort" ? 400 : 403);
  expect(f.calls).toEqual([]);
});

test("raw native input needs admission authority but not an optional text transform", async () => {
  const f = fixture(); delete f.channel.prepareInputText;
  const response = await f.send({ content: "untransformed native input", mode: "queue" });
  expect(response.status).toBe(201); expect(f.queued[0]![2]).toBe("untransformed native input");
  expect(f.calls).not.toContain("legacy");
});

test("native manual /queue stays deferred when streaming ends during its atomic admission", async () => {
  const f = fixture(); let streaming = true;
  f.channel.agentPool.isStreaming = () => streaming;
  f.channel.agentPool.isActive = () => false;
  const admit = f.channel.admitQueuedFollowupItem;
  f.channel.admitQueuedFollowupItem = async (...args: any[]) => { const row = await admit(...args); streaming = false; return row; };
  const response = await f.send({ content: "/queue explicit input" });
  expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ queued: "followup" });
  expect(f.queued[0]![2]).toBe("explicit input"); expect(f.calls).not.toContain("wake"); expect(f.calls).not.toContain("legacy");
});

test("native steer startup race accepts the same queued source in the original SQL transaction", async () => {
  initDatabase(); const f = fixture(); let busy = false, admissions = 0;
  const chat = "web:queue-busy-admission-1675";
  f.channel.agentPool.isStreaming = () => busy; f.channel.agentPool.isActive = () => busy;
  f.channel.getQueuedInputSourceAdmission = () => (stored: any) => {
    expect(stored.database).toBe(getDb()); expect(stored.database.inTransaction).toBe(true);
    expect(stored.item.queuedContent).toBe("explicit input"); expect(stored.item.threadId).toBe(17); admissions++;
  };
  f.channel.enqueueQueuedFollowupItem = (...args: any[]) => {
    setDeferredQueuedFollowups(chat, [{ rowId: -75, queuedContent: args[2], queuedAt: args[4], threadId: args[3], retryCount: 0, source: args[5].source }]);
    return -75;
  };
  f.channel.admitMessage = async (_chat: string, _text: string, _isBot: boolean, _media: unknown, _options: unknown, check: () => void, _signal: unknown, defer: () => boolean) => {
    return getDb().transaction(() => { busy = true; check(); expect(defer()).toBe(true); return null; }).immediate();
  };
  const response = await f.send({ content: "explicit input", mode: "steer", thread_id: 17, persist_steer: true }, undefined, chat);
  expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ queued: "followup", thread_id: 17 });
  const rows = getDeferredQueuedFollowups(chat);
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ source_accepted: true, source: "web.steer_startup_fallback", queuedContent: "explicit input", threadId: 17 });
  expect(rows[0]!.source_id).toBeTruthy(); expect(admissions).toBe(1); expect(f.calls).not.toContain("legacy");
});
