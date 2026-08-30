/**
 * test/extensions/chat-tool.test.ts – Tests for cross-session chat relay.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";
import { withChatContext } from "../../src/core/chat-context.js";
import {
  registerChatTransport,
  resetChatTransportRegistryForTests,
} from "../../src/extensions/chat-transport-registry.js";

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

describe("chat tool extension", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let chatJid = "web:test";

  beforeEach(async () => {
    ws = createTempWorkspace("piclaw-chat-tool-");
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

  afterEach(async () => {
    resetChatTransportRegistryForTests();
    try {
      const module = await importFresh<typeof import("../src/extensions/chat-tool.js")>("../src/extensions/chat-tool.js");
      module.setChatToolRelayFn(undefined);
    } catch (e) {
      // ignore cleanup import failures in teardown
      void e;
    }
    restoreEnv?.();
    restoreEnv = null;
    ws.cleanup();
  });

  async function getTool() {
    const chatToolModule = await importFresh<typeof import("../src/extensions/chat-tool.js")>("../src/extensions/chat-tool.js");
    const fake = makeFakeApi();
    chatToolModule.chatTool(fake.api);
    return {
      tool: fake.tools.get("chat")!,
      chatToolModule,
    };
  }

  test("injects usable remote addresses and file limits into the agent prompt", async () => {
    const module = await importFresh<typeof import("../src/extensions/chat-tool.js")>("../src/extensions/chat-tool.js");
    const hint = module.buildChatTransportDirectoryHint([{
      transport: "remote-peer",
      generated_at: "now",
      entries: [{ address: "lab!inbox", label: "Lab inbox", target_kind: "inbox", modes: ["queue"], status: "ready", attachments: { enabled: true, max_files: 4, max_file_bytes: 16 * 1024 * 1024, max_total_bytes: 32 * 1024 * 1024 } }],
    }]);
    expect(hint).toContain("chat({ action: 'directory' })");
    expect(hint).toContain("lab!inbox — Lab inbox; modes: queue; ready; files: up to 4 × 16 MiB");
    expect(hint).toContain("stable idempotency_key");
  });

  test("registers the chat tool", async () => {
    const { tool } = await getTool();
    expect(tool).toBeDefined();
    expect(tool.name).toBe("chat");
  });

  test("relays to target_agent_name and strips a leading @ before resolution", async () => {
    const { tool, chatToolModule } = await getTool();
    const calls: Array<Record<string, unknown>> = [];
    chatToolModule.setChatToolRelayFn(async (request) => {
      calls.push(request as Record<string, unknown>);
      return {
        status: "ok",
        relayed: true,
        source_chat_jid: String(request.source_chat_jid),
        source_agent_name: "source",
        target_chat_jid: "web:target",
        target_agent_name: "research",
        queued: "followup",
        thread_id: null,
      };
    });

    const result = await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_agent_name: "@research",
      content: "Please inspect this branch.",
      mode: "queue",
    }));

    expect(calls).toEqual([{
      source_chat_jid: chatJid,
      target_agent_name: "research",
      content: "Please inspect this branch.",
      mode: "queue",
    }]);
    expect(result.details.relayed).toBe(true);
    expect(result.details.target_chat_jid).toBe("web:target");
    expect(result.details.target_agent_name).toBe("research");
    expect(result.content[0].text).toContain("queued as a follow-up");
  });

  test("steers immediately when mode is omitted", async () => {
    const { tool, chatToolModule } = await getTool();
    const calls: Array<Record<string, unknown>> = [];
    chatToolModule.setChatToolRelayFn(async (request) => {
      calls.push(request as Record<string, unknown>);
      return {
        status: "ok",
        relayed: true,
        source_chat_jid: request.source_chat_jid,
        target_chat_jid: "web:target",
        target_agent_name: "research",
      };
    });

    await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_agent_name: "@research",
      content: "Please act on this now.",
    }));

    expect(calls).toEqual([{
      source_chat_jid: chatJid,
      target_agent_name: "research",
      content: "Please act on this now.",
      mode: "steer",
    }]);
  });

  test("relays a local target_address through the built-in local transport", async () => {
    const { tool, chatToolModule } = await getTool();
    const calls: Array<Record<string, unknown>> = [];
    chatToolModule.setChatToolRelayFn(async (request) => {
      calls.push(request as Record<string, unknown>);
      return {
        status: "ok",
        source_chat_jid: request.source_chat_jid,
        target_chat_jid: "web:target",
        target_agent_name: "research",
      };
    });

    const result = await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_address: "@research",
      content: "hello",
      mode: "auto",
    }));

    expect(calls).toEqual([{
      source_chat_jid: chatJid,
      target_agent_name: "research",
      content: "hello",
      mode: "auto",
    }]);
    expect(result.details).toMatchObject({
      relayed: true,
      transport: "local",
      target_address: "@research",
      target_agent_name: "research",
    });
  });

  test("dispatches one-hop bang addresses with transport metadata", async () => {
    const { tool } = await getTool();
    const calls: Array<Record<string, unknown>> = [];
    registerChatTransport({
      id: "remote-peer",
      kind: "bang",
      async send(request) {
        calls.push(request as unknown as Record<string, unknown>);
        return {
          status: "queued",
          relayed: true,
          source_chat_jid: request.source_chat_jid,
          target_address: request.address.raw,
          peer_instance_id: "peer-1",
        };
      },
    });

    const result = await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_address: "lab!inbox",
      content: "  hello remote  ",
      mode: "queue",
      idempotency_key: " idem-1 ",
      in_reply_to: " msg-1 ",
    }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      source_chat_jid: chatJid,
      address: { kind: "bang", raw: "lab!inbox", peer: "lab", target: "inbox" },
      content: "hello remote",
      mode: "queue",
      idempotency_key: "idem-1",
      in_reply_to: "msg-1",
    });
    expect(result.details).toMatchObject({
      relayed: true,
      transport: "remote-peer",
      target_address: "lab!inbox",
      peer_instance_id: "peer-1",
    });
    expect(result.content[0].text).toContain("lab!inbox");
  });

  test("lists transport destinations and sends bounded workspace files", async () => {
    const { tool } = await getTool();
    const filePath = join(ws.workspace, "note.txt");
    writeFileSync(filePath, "hello attachment");
    const calls: Array<Record<string, unknown>> = [];
    registerChatTransport({
      id: "remote-peer",
      kind: "bang",
      directory: () => ({
        transport: "remote-peer",
        generated_at: "2026-08-29T00:00:00.000Z",
        entries: [{
          address: "lab!inbox",
          label: "Lab inbox",
          peer_alias: "lab",
          peer_fingerprint: "abc-def",
          target_kind: "inbox",
          modes: ["queue", "auto"],
          status: "ready",
          attachments: { enabled: true, max_files: 4, max_file_bytes: 16 * 1024 * 1024, max_total_bytes: 32 * 1024 * 1024 },
        }],
      }),
      async send(request) {
        calls.push(request as unknown as Record<string, unknown>);
        return { status: "queued", relayed: true, source_chat_jid: request.source_chat_jid, target_address: request.address.raw };
      },
    });

    const directory = await tool.execute("directory", { action: "directory" });
    expect(directory.content[0].text).toContain("lab!inbox");
    expect(directory.content[0].text).toContain("files≤4");

    const sent = await withChatContext(chatJid, "web", () => tool.execute("send", {
      target_address: "lab!inbox",
      files: ["note.txt"],
      idempotency_key: "file-1",
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ content: "", mode: "queue", idempotency_key: "file-1" });
    expect((calls[0].attachments as any[])[0]).toMatchObject({ filename: "note.txt", content_type: "text/plain", size: 16 });
    expect((calls[0].attachments as any[])[0].sha256).toHaveLength(64);
    expect(sent.content[0].text).toContain("with 1 attachment");
  });

  test("reports malformed and unavailable bang transports", async () => {
    const { tool } = await getTool();
    const multiHop = await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_address: "a!b!inbox",
      content: "hello",
    }));
    expect(multiHop.details.error).toContain("one hop only");

    const unavailable = await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_address: "lab!inbox",
      content: "hello",
    }));
    expect(unavailable.details.error).toContain("No chat transport is registered");
  });

  test("rejects ambiguous target selectors", async () => {
    const { tool, chatToolModule } = await getTool();
    chatToolModule.setChatToolRelayFn(async () => {
      throw new Error("should not be called");
    });

    const result = await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_chat_jid: "web:target",
      target_agent_name: "research",
      content: "Hello",
    }));

    expect(result.details.relayed).toBe(false);
    expect(result.details.error).toContain("Provide only one target selector");

    const addressResult = await withChatContext(chatJid, "web", () => tool.execute("x", {
      target_address: "@research",
      target_agent_name: "research",
      content: "Hello",
    }));
    expect(addressResult.details.error).toContain("Provide only one target selector");
  });
});
