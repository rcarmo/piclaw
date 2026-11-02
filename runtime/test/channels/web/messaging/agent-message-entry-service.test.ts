import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as handlers from "../../../../src/channels/web/handlers/agent.js";
import { createWebChannelTestFixture } from "../helpers/web-channel-fixture.js";

let cleanup: (() => void) | undefined;
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; cleanup?.(); cleanup = undefined; });
async function fixture() {
  const f = await createWebChannelTestFixture({ workspace: "temp" });
  cleanup = f.cleanup;
  Object.defineProperty(f.channel, "agentMessageEntryService", {
    get() { throw Error("Retired message entry adapter was accessed"); },
  });
  return f;
}

describe("public WebChannel agent message entry", () => {
  test("parses chat_jid and falls back to the default chat before forwarding", async () => {
    const f = await fixture(), calls: unknown[][] = [];
    const spy = spyOn(handlers, "handleAgentMessage").mockImplementation(async (channel, req, pathname, chatJid, agentId) => {
      calls.push([channel, req, pathname, chatJid, agentId]);
      return Response.json({ pathname, chat_jid: chatJid, agent_id: agentId }, { status: 201 });
    });
    restore = () => spy.mockRestore();
    for (const [query, expected] of [["web%3Abranch", "web:branch"], ["%20%20", "web:default"], ["", "web:default"], ["%20web%3Abranch%20", "web:branch"]]) {
      const req = new Request("https://fixture.invalid/agent/custom/message?chat_jid=" + query, { method: "POST" });
      const response = await f.channel.handleAgentMessage(req, "/agent/custom/message");
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ pathname: "/agent/custom/message", chat_jid: expected, agent_id: "default" });
      expect(calls.at(-1)).toEqual([f.channel, req, "/agent/custom/message", expected, "default"]);
    }
    expect(calls).toHaveLength(4);
  });

  test("returns the forwarded response unchanged and never resolves target/input outside admission", async () => {
    const f = await fixture(), forwardedResponse = new Response("accepted", { status: 202 });
    const spy = spyOn(handlers, "handleAgentMessage").mockResolvedValue(forwardedResponse);
    restore = () => spy.mockRestore();
    const response = await f.channel.handleAgentMessage(new Request("https://fixture.invalid/agent/default/message", { method: "POST" }), "/agent/default/message");
    expect(response).toBe(forwardedResponse); expect(response.status).toBe(202); expect(await response.text()).toBe("accepted");
    await f.channel.sealAdmissions();
    const refused = new Request("https://fixture.invalid/agent/default/message", { method: "POST" });
    Object.defineProperty(refused, "url", { get() { throw Error("Target resolution escaped the admission callback"); } });
    expect((await f.channel.handleAgentMessage(refused, "/agent/default/message")).status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
