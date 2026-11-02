import { expect, test } from "bun:test";
import { WebChannel } from "../../../src/channels/web.ts";

test("agent-message entry uses the lifecycle gateway and focused request handler", async () => {
  const request = new Request("https://example.test/agent/default/message?chat_jid=web:test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "null",
  });
  let entered = false;
  const channel = {
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    serverLifecycleGateway: { handleRequest: async (req: Request, handler: () => Promise<Response>) => {
      expect(req).toBe(request); entered = true;
      return handler();
    } },
    get agentMessageEntryService() { throw Error("Retired entry owner reached"); },
  };
  const response = await WebChannel.prototype.handleAgentMessage.call(channel, request, "/agent/default/message");
  expect(entered).toBe(true); expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "JSON body must be an object" });
});
