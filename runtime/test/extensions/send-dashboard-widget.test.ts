import { describe, expect, test } from "bun:test";
import { convertResponsesTools } from "@earendil-works/pi-ai/api/openai-responses-shared";
import "../helpers.ts";
import { setMessagesPostFn } from "../../src/extensions/messages-crud.js";
import { sendDashboardWidget } from "../../src/extensions/send-dashboard-widget.js";
import { withChatContext } from "../../src/core/chat-context.js";

describe("send_dashboard_widget tool", () => {
  test("posts custom HTML widget to the active web chat", async () => {
    const tools = new Map<string, any>();
    const calls: Array<{ chatJid: string; content: string; isBot: boolean; mediaIds: number[]; contentBlocks?: unknown[] }> = [];

    setMessagesPostFn(async (chatJid, content, isBot, mediaIds, contentBlocks) => {
      calls.push({ chatJid, content, isBot, mediaIds, contentBlocks });
      return 321;
    });

    try {
      sendDashboardWidget({
        on(_event: string, _handler: (event: any) => Promise<any>) {},
        registerTool(def: any) { tools.set(def.name, def); },
      } as any);

      const tool = tools.get("send_dashboard_widget");
      expect(tool.constrainedSampling).toBeUndefined();
      expect((convertResponsesTools([tool], { strict: null, supportsStrictMode: true })[0] as any).strict).toBeNull();
      const result = await withChatContext("web:test", "web", () =>
        tool.execute("tool-1", {
          html: "<h1>Hello</h1><button onclick=\"piclawWidget.submit({text:'clicked'})\">Go</button>",
          title: "Test Widget",
        }),
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].chatJid).toBe("web:test");
      expect(calls[0].isBot).toBe(true);
      const block = (calls[0].contentBlocks as any[])[0];
      expect(block.type).toBe("generated_widget");
      expect(block.title).toBe("Test Widget");
      expect(block.capabilities).toEqual(["interactive"]);
      expect(block.artifact.html).toContain("<h1>Hello</h1>");
      expect((result.details as Record<string, unknown>).tool).toBe("send_dashboard_widget");
    } finally {
      setMessagesPostFn(undefined);
    }
  });

  test("requires html parameter", async () => {
    const tools = new Map<string, any>();
    sendDashboardWidget({
      on() {},
      registerTool(def: any) { tools.set(def.name, def); },
    } as any);

    const tool = tools.get("send_dashboard_widget");
    const result = await withChatContext("web:test", "web", () =>
      tool.execute("tool-2", {}),
    );
    expect((result.details as Record<string, unknown>).error).toContain("html");
  });

  test("returns error outside web channel", async () => {
    const tools = new Map<string, any>();
    sendDashboardWidget({
      on() {},
      registerTool(def: any) { tools.set(def.name, def); },
    } as any);

    const tool = tools.get("send_dashboard_widget");
    const result = await withChatContext("whatsapp:test", "whatsapp", () =>
      tool.execute("tool-3", { html: "<p>hi</p>" }),
    );
    expect((result.details as Record<string, unknown>).error).toContain("only available in the web UI");
  });

  test("injects bridge docs into system prompt", async () => {
    const handlers: Array<(event: any) => Promise<any>> = [];
    sendDashboardWidget({
      on(event: string, handler: (event: any) => Promise<any>) {
        if (event === "before_agent_start") handlers.push(handler);
      },
      registerTool() {},
    } as any);

    expect(handlers).toHaveLength(1);
    const result = await handlers[0]({ systemPrompt: "base" });
    expect(result.systemPrompt).toContain("piclawWidget.submit");
    expect(result.systemPrompt).toContain("piclaw:widget-message");
  });
});
