import { afterEach, describe, expect, test } from "bun:test";

import { parseChatAddress } from "../../src/extensions/chat-address.js";
import {
  getChatTransport,
  getChatTransportDirectories,
  registerChatTransport,
  resetChatTransportRegistryForTests,
  sendViaChatTransport,
  setLocalChatTransport,
} from "../../src/extensions/chat-transport-registry.js";

afterEach(() => resetChatTransportRegistryForTests());

describe("chat transport registry", () => {
  test("registers one transport per kind and unregisters idempotently", async () => {
    const unregister = registerChatTransport({
      id: "remote-peer",
      kind: "bang",
      send: async (request) => ({
        status: "queued",
        source_chat_jid: request.source_chat_jid,
        target_address: request.address.raw,
      }),
    });
    expect(getChatTransport("bang")?.id).toBe("remote-peer");

    await expect(sendViaChatTransport({
      source_chat_jid: "web:source",
      address: parseChatAddress("lab!inbox"),
      content: "hello",
      mode: "queue",
    })).resolves.toMatchObject({
      transport: "remote-peer",
      target_address: "lab!inbox",
      status: "queued",
    });

    unregister();
    unregister();
    expect(getChatTransport("bang")).toBeNull();
  });

  test("exposes transport directories and validates before send", async () => {
    const events: string[] = [];
    registerChatTransport({
      id: "remote-peer",
      kind: "bang",
      directory: () => ({ transport: "remote-peer", generated_at: "now", entries: [] }),
      validate: () => { events.push("validate"); },
      send: async (request) => { events.push("send"); return { source_chat_jid: request.source_chat_jid }; },
    });
    await expect(getChatTransportDirectories()).resolves.toEqual([{ transport: "remote-peer", generated_at: "now", entries: [] }]);
    await sendViaChatTransport({ source_chat_jid: "web:source", address: parseChatAddress("lab!inbox"), content: "hello", mode: "queue" });
    expect(events).toEqual(["validate", "send"]);
  });

  test("rejects duplicate owners and unavailable bang transports", async () => {
    registerChatTransport({ id: "one", kind: "bang", send: async () => ({ source_chat_jid: "web:source" }) });
    expect(() => registerChatTransport({
      id: "two",
      kind: "bang",
      send: async () => ({ source_chat_jid: "web:source" }),
    })).toThrow('already registered by "one"');

    resetChatTransportRegistryForTests();
    await expect(sendViaChatTransport({
      source_chat_jid: "web:source",
      address: parseChatAddress("lab!inbox"),
      content: "hello",
      mode: "queue",
    })).rejects.toThrow('No chat transport is registered for remote address "lab!inbox"');
  });

  test("replaces only the core-owned local transport", () => {
    setLocalChatTransport({ id: "local", send: async () => ({ source_chat_jid: "web:source" }) });
    setLocalChatTransport({ id: "local", send: async () => ({ source_chat_jid: "web:replacement" }) });
    expect(getChatTransport("local")?.id).toBe("local");
    setLocalChatTransport(undefined);
    expect(getChatTransport("local")).toBeNull();
  });
});
