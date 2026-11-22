import { afterEach, describe, expect, test } from "bun:test";

import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.ts";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

type SidePromptServiceStub = {

  handleAgentSidePrompt(req: Request): Promise<Response>;
  handleAgentSidePromptStream(req: Request): Promise<Response>;
};

describe("WebChannel side-prompt delegation", () => {
  test("delegates side-prompt wrappers to the extracted service", async () => {
    const fixture = await createWebChannelTestFixture({ workspace: "temp" });
    cleanup = fixture.cleanup;

    const calls: string[] = [];
    const response = (label: string, status = 200) => new Response(label, { status });
    const service: SidePromptServiceStub = {

      handleAgentSidePrompt: async (req) => {
        const url = new URL(req.url);
        calls.push(`side-prompt:${req.method}:${url.pathname}`);
        return response("side-prompt", 206);
      },
      handleAgentSidePromptStream: async (req) => {
        const url = new URL(req.url);
        calls.push(`side-prompt-stream:${req.method}:${url.pathname}`);
        return response("side-prompt-stream", 207);
      },
    };

    (fixture.channel as unknown as { sidePromptService: SidePromptServiceStub }).sidePromptService = service;

    expect((await fixture.channel.handleAgentSidePrompt(new Request("https://example.com/agent/side-prompt", { method: "POST" }))).status)
      .toBe(206);
    expect((await fixture.channel.handleAgentSidePromptStream(new Request("https://example.com/agent/side-prompt/stream", { method: "POST" }))).status)
      .toBe(207);

    expect(calls).toEqual([
      "side-prompt:POST:/agent/side-prompt",
      "side-prompt-stream:POST:/agent/side-prompt/stream",
    ]);
  });
});
