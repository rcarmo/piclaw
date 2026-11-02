import { afterEach, expect, spyOn, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.js";

let cleanup: (() => void) | undefined;
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  cleanup?.(); cleanup = undefined;
});
async function fixture() {
  const f = await createWebChannelTestFixture({ workspace: "temp" });
  cleanup = f.cleanup;
  Object.defineProperty(f.channel, "lifecycleSpecialSurfaceService", {
    get() { throw Error("Retired lifecycle namespace was accessed"); },
  });
  return f;
}
function replace(target: any, method: string, implementation: (...args: any[]) => any) {
  const spy = spyOn(target, method).mockImplementation(implementation);
  restores.push(() => spy.mockRestore());
}

test("runtime public calls bypass displaced forwarding methods and retain every argument", async () => {
  const f = await fixture(), calls: unknown[][] = [];
  const surface = Reflect.get(f.channel, "runtimePublicSurfaceService");
  for (const key of ["sendMessage", "postDashboardWidget", "enqueueQueuedFollowupItem", "admitQueuedFollowupItem", "getBuffer", "storeMessage", "admitUserMessage", "admitMessage"]) {
    Object.defineProperty(surface, key, { get() { throw Error("Retired runtime forwarding method was accessed: " + key); } });
  }
  const writer = Reflect.get(f.channel, "messageWriteService"), queue = f.channel.queuedFollowupLifecycle, storage = Reflect.get(f.channel, "messageProcessingStorageService");
  for (const key of ["sendMessage", "postDashboardWidget", "enqueueQueuedFollowupItem", "admitQueuedFollowupItem", "getBuffer"]) {
    replace(["sendMessage", "postDashboardWidget"].includes(key) ? writer : key === "getBuffer" ? Reflect.get(surface, "runtimeState") : queue, key, (...args) => { calls.push([key, ...args]); return key === "enqueueQueuedFollowupItem" ? 41 : key === "admitQueuedFollowupItem" ? Promise.resolve(42) : undefined; });
  }
  const row = { id: 77 };
  replace(storage, "admitMessage", (...args) => { calls.push(["admitMessage", ...args]); return Promise.resolve(row); });
  const options = { threadId: 9 }, extras = { queuedBy: { agent: "fixture" }, contentBlocks: [{ type: "text", text: "kept" }] } as any;
  const args = ["web:branch", 7, "queued", null, undefined, extras] as const;
  const authorise = () => {}, source = { validate() {} } as any, signal = new AbortController().signal, defer = () => false;
  await f.channel.sendMessage("web:branch", "reply", options);
  await f.channel.postDashboardWidget("web:branch", { widgetId: "existing-widget" });
  expect(f.channel.enqueueQueuedFollowupItem(...args)).toBe(41);
  expect(await f.channel.admitQueuedFollowupItem([...args], authorise, signal, source)).toBe(42);
  expect(f.channel.getBuffer("native-turn", "draft")).toBeUndefined();
  expect(await f.channel.admitMessage("web:branch", "stored", true, [3], options)).toBe(row);
  expect(await f.channel.admitMessage("web:branch", "accepted", false, [3], options, authorise, signal, defer)).toBe(row);
  for (const name of ['storeMessage', 'admitUserMessage', 'replaceQueuedFollowupItem']) expect(f.channel).not.toHaveProperty(name);
  expect(calls).toEqual([
    ["sendMessage", "web:branch", "reply", options],
    ["postDashboardWidget", "web:branch", { widgetId: "existing-widget" }],
    ["enqueueQueuedFollowupItem", ...args],
    ["admitQueuedFollowupItem", [...args], authorise, signal, source],
    ["getBuffer", "native-turn", "draft"],
    ["admitMessage", "web:branch", "stored", true, [3], options],
    ["admitMessage", "web:branch", "accepted", false, [3], options, authorise, signal, defer],
  ]);
});

test("lifecycle and card/side/peer calls go directly to their original owners", async () => {
  const f = await fixture(), calls: string[] = [];
  const gateway = Reflect.get(f.channel, "serverLifecycleGateway");
  replace(gateway, "start", async () => { calls.push("start"); });
  replace(gateway, "stop", () => { calls.push("stop"); return Promise.resolve(); });
  const card = Reflect.get(f.channel, "adaptiveCardSidePromptService"), peer = Reflect.get(f.channel, "peerMessageRelayService");
  const response = new Response("original", { status: 202 });
  for (const key of ["handleAdaptiveCardAction", "handleAgentSidePrompt", "handleAgentSidePromptStream"]) replace(card, key, async () => { calls.push(key); return response; });
  replace(peer, "handleAgentPeerMessage", async () => { calls.push("peer"); return response; });
  await f.channel.start(); await f.channel.stop();
  const req = new Request("https://fixture.invalid/agent/card-action", { method: "POST" });
  expect(await f.channel.handleAdaptiveCardAction(req)).toBe(response);
  expect(await f.channel.handleAgentSidePrompt(req)).toBe(response);
  expect(await f.channel.handleAgentSidePromptStream(req)).toBe(response);
  expect(await f.channel.handleAgentPeerMessage(req)).toBe(response);
  expect(calls).toEqual(["start", "stop", "handleAdaptiveCardAction", "handleAgentSidePrompt", "handleAgentSidePromptStream", "peer"]);
});

test("runtime input still enters the real gateway and draining joins the entered callback", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), result = Promise.withResolvers<any>();
  const surface = Reflect.get(f.channel, "runtimePublicSurfaceService");
  let calls = 0;
  replace(surface, "enqueueAgentMessage", () => { calls++; entered.resolve(); return result.promise; });
  const request = { chatJid: "web:branch", content: "preserved", mode: "queue" as const };
  let pending: Promise<unknown> | undefined;
  try {
    pending = f.channel.enqueueAgentMessage(request);
    await entered.promise;
    let drained = false;
    const drain = f.channel.sealAdmissions().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    await expect(f.channel.enqueueAgentMessage(request)).rejects.toThrow("Web admission is sealed; internal dispatch is unavailable.");
    expect(calls).toBe(1);
    const value = { status: "ok", chat_jid: "web:branch", thread_id: null, created: false };
    result.resolve(value);
    expect(await pending).toBe(value);
    await drain; expect(drained).toBe(true);
  } finally { result.resolve(null); await pending?.catch(() => {}); }
});
