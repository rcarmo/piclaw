/**
 * test/extensions/send-adaptive-card.test.ts – Tests for send_adaptive_card.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertResponsesTools } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";
import { withChatContext } from "../../src/core/chat-context.js";

let restoreEnv: (() => void) | null = null;

function makeFakeApi() {
  const tools = new Map<string, any>();
  return {
    api: {
      on() {},
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
      registerCommand() {},
      registerShortcut() {},
      registerFlag() {},
      getFlag() { return undefined; },
      registerMessageRenderer() {},
      sendMessage() {},
      sendUserMessage() {},
      appendEntry() {},
      setSessionName() {},
      getSessionName() { return undefined; },
      setLabel() {},
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools() {},
      getCommands: () => [],
      setModel: async () => true,
      getThinkingLevel: () => "off" as const,
      setThinkingLevel() {},
      registerProvider() {},
      unregisterProvider() {},
    } as unknown as ExtensionAPI,
    tools,
  };
}

describe("send_adaptive_card extension", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let chatJid = "web:test";

  beforeEach(async () => {
    ws = createTempWorkspace("piclaw-send-adaptive-card-");
    chatJid = `web:test-${Math.random().toString(36).slice(2, 10)}`;
    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
      PICLAW_DB_IN_MEMORY: "1",
    });
    const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    db.initDatabase();
    db.storeChatMetadata(chatJid, new Date().toISOString(), "Web");
  });

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = null;
    ws.cleanup();
  });

  async function getTool() {
    const sendAdaptiveCardModule = await importFresh<typeof import("../src/extensions/send-adaptive-card.js")>("../src/extensions/send-adaptive-card.js");
    const messagesCrud = await import("../../src/extensions/messages-crud.js");
    const fake = makeFakeApi();
    sendAdaptiveCardModule.sendAdaptiveCard(fake.api);
    return {
      tool: fake.tools.get("send_adaptive_card")!,
      messagesCrud,
    };
  }

  test("registers send_adaptive_card", async () => {
    const { tool } = await getTool();
    expect(tool).toBeDefined();
    expect(tool.name).toBe("send_adaptive_card");
    expect(tool.constrainedSampling).toBeUndefined();
    expect((convertResponsesTools([tool], { strict: null, supportsStrictMode: true })[0] as any).strict).toBeNull();
  });

  test("posts agent-owned adaptive card via registered messages post function", async () => {
    const { tool, messagesCrud } = await getTool();

    const calls: Array<{ chatJid: string; content: string; isBot: boolean; mediaIds: number[]; contentBlocks?: unknown[] }> = [];
    messagesCrud.setMessagesPostFn(async (cj: string, c: string, bot: boolean, mids: number[], cb?: unknown[]) => {
      calls.push({ chatJid: cj, content: c, isBot: bot, mediaIds: mids, contentBlocks: cb });
      return 424242;
    });

    const result = await withChatContext(chatJid, "web", () => tool.execute("x", {
      content: "Approval requested.",
      card_id: "approval-request-v1",
      payload: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [{ type: "TextBlock", text: "Approval requested" }],
        actions: [{ type: "Action.Submit", title: "Approve", data: { decision: "approve" } }],
      },
    }));

    expect(result.details.posted).toBe(1);
    expect(result.details.card_id).toBe("approval-request-v1");
    expect(calls).toHaveLength(1);
    expect(calls[0].chatJid).toBe(chatJid);
    expect(calls[0].isBot).toBe(true);
    expect(calls[0].content).toBe("Approval requested.");
    expect(calls[0].contentBlocks).toEqual([
      {
        type: "adaptive_card",
        card_id: "approval-request-v1",
        schema_version: "1.5",
        state: "active",
        fallback_text: "Approval requested.",
        payload: {
          type: "AdaptiveCard",
          version: "1.5",
          body: [{ type: "TextBlock", text: "Approval requested" }],
          actions: [{ type: "Action.Submit", title: "Approve", data: { decision: "approve" } }],
        },
      },
    ]);
  });

  test("rejects non-AdaptiveCard payloads", async () => {
    const { tool } = await getTool();
    const result = await withChatContext(chatJid, "web", () => tool.execute("x", {
      content: "Bad payload",
      card_id: "bad-payload",
      payload: { type: "NotAdaptiveCard" },
    }));

    expect(result.details.posted).toBe(0);
    expect(result.details.error).toContain("payload.type must be 'AdaptiveCard'");
  });
});
