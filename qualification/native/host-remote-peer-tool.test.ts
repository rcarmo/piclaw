import { expect, test } from "bun:test";
import { createHostRemotePeerTool } from "../../runtime/durable-engine/src/host-remote-peer-tool.js";

function fixture() {
  let valid = true, captured = 0, effects = 0;
  let inner: (() => void) | undefined;
  const ports = Object.freeze({ fixture: true });
  const tool = createHostRemotePeerTool({ createRemotePeerTool(options) {
    if (!options.chatJid) expect(options.assertCurrent).toThrow("Invocation-local");
    return { name: "remote_peer", label: "Remote Peer", description: "owned fixture", parameters: { type: "object", properties: {} } as any,
      async execute(_id, params) {
        expect(options.chatJid).toBe("real-chat"); expect(options.cwd).toBe("/owned-workspace");
        expect(options.nativeHostPorts).toBe(ports);
        inner = options.assertCurrent;
        if (params.revoke) valid = false;
        await Promise.resolve();
        options.assertCurrent(); effects++;
        return { content: [{ type: "text", text: "ok" }], details: { ok: true } };
      } };
  } }, { root: { query: () => ({ get: () => valid ? { present: 1 } : null }) } as any,
    runtime: () => ({ async captureToolSource(conversation, task, call) {
      expect([conversation, task, call]).toEqual([11, 22, "owned-call"]); captured++;
      return { operation: { operationId: "owned-op", chatJid: "real-chat", version: 1,
        harness: { harnessOperationId: "hop", sessionId: "session" } }, inputs: [] } as any;
    } }), assertOwner() {}, cwd: "/owned-workspace", nativeHostPorts: ports });
  return { tool, invoke: (args: unknown) => tool.execute(args as any,
    { callId: "owned-call", conversationId: 11, taskId: 22 } as any, {} as any),
    effects: () => effects, captured: () => captured, inner: () => inner!() };
}

test("Remote Peer captures actual source, passes real invocation options and expires authority", async () => {
  const f = fixture();
  await f.invoke({ action: "identity", chatJid: "spoofed" });
  expect(f.captured()).toBe(1); expect(f.effects()).toBe(1);
  expect(f.inner).toThrow("invocation ended");
});
test("Remote Peer revocation after await blocks actual effect", async () => {
  const f = fixture();
  await expect(f.invoke({ action: "pair", revoke: true })).rejects.toThrow();
  expect(f.effects()).toBe(0);
});
test("Remote Peer rejects nonplain inputs before source capture", async () => {
  const f = fixture();
  await expect(f.invoke(new Date())).rejects.toThrow();
  expect(f.captured()).toBe(0);
});
