import { afterEach, describe, expect, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.ts";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("WebChannel message-write delegation", () => {
  test("delegates outgoing messages and dashboard widgets to the write service", async () => {
    const fixture = await createWebChannelTestFixture({ workspace: "temp" });
    cleanup = fixture.cleanup;

    const calls: string[] = [];

    (fixture.channel as any).messageWriteService = {
      sendMessage: async (chatJid: string, text: string, options?: { threadId?: number | null }) => {
        calls.push(`send:${chatJid}:${text}:${options?.threadId ?? "null"}`);
      },
      postDashboardWidget: async (chatJid: string, options?: { threadId?: number | null; text?: string; widgetId?: string }) => {
        calls.push(`widget:${chatJid}:${options?.threadId ?? "null"}:${options?.widgetId ?? ""}`);
      },
    };

    await fixture.channel.sendMessage("web:test", "hello", { threadId: 9 });
    await fixture.channel.postDashboardWidget("web:test", { threadId: 8, widgetId: "widget-delegate" });

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "widget:web:test:8:widget-delegate",
    ]);
  });
});
