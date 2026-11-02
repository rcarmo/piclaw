import { expect, test } from "bun:test";

import type { AgentPool } from "../../../../src/agent-pool.js";
import { WebSessionBroadcastService } from "../../../../src/channels/web/sse/session-broadcast-service.js";

test("native broadcast retains SSE/UI/provider events without legacy session binding", async () => {
  let legacyAccesses = 0;
  let providerUsageListener: ((event: unknown) => void) | undefined;
  const handledRequests: Request[] = [];
  const broadcastCalls: Array<{ eventType: string; data: unknown }> = [];
  const response = new Response("sse");

  const service = new WebSessionBroadcastService(
    {
      get setSessionBinder() { legacyAccesses++; throw Error("Legacy binder must not be accessed"); },
      get getOrCreateRuntime() { legacyAccesses++; throw Error("Legacy runtime must not be accessed"); },
      get getOrCreateSession() { legacyAccesses++; throw Error("Legacy session must not be accessed"); },
      setProviderUsageRefreshListener: (listener: (event: unknown) => void) => {
        providerUsageListener = listener;
      },
    } as unknown as AgentPool,
    {
      sse: {
        clients: new Set(),
        handleRequest: (req?: Request) => {
          handledRequests.push(req as Request);
          return response;
        },
        broadcast: (eventType: string, data: unknown) => {
          broadcastCalls.push({ eventType, data });
        },
        closeAll: () => {},
      } as any,
    }
  );

  expect(service.handleSse(new Request("https://example.test/sse/stream?chat_jid=web:branch-a"))).toBe(response);
  expect(handledRequests).toHaveLength(1);

  service.broadcastEvent("agent_status", { chat_jid: "web:branch-a", type: "thinking" });
  expect(broadcastCalls).toEqual([
    { eventType: "agent_status", data: { chat_jid: "web:branch-a", type: "thinking" } },
  ]);

  expect(legacyAccesses).toBe(0);
  expect("bindSession" in service.uiBridge).toBe(false);
  const opened = service.uiBridge.openWorkspaceFile("web:branch-a", "notes/index.md", "Notes");
  const request = broadcastCalls.at(-1)!;
  expect(request.eventType).toBe("extension_ui_request");
  const requestId = (request.data as { request_id: string }).request_id;
  expect(service.uiBridge.handleUiResponse(requestId, { ok: true, opened: true }, "web:branch-a")).toEqual({ status: "ok" });
  expect(await opened).toEqual({ ok: true, opened: true });
  providerUsageListener?.({
    chat_jid: "web:branch-a",
    current: "zai/glm-4",
    provider_usage: { provider: "zai", plan: "pro" },
  });
  expect(broadcastCalls.at(-1)).toEqual({
    eventType: "model_changed",
    data: {
      chat_jid: "web:branch-a",
      current: "zai/glm-4",
      provider_usage: { provider: "zai", plan: "pro" },
    },
  });
  expect(service.uiBridge).toBeDefined();
  expect(service.sse).toBeDefined();
});
