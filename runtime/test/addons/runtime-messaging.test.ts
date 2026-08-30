import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";

import { createAddonMessagingRuntimeHandlers } from "../../src/addons/runtime-messaging.js";
import { getMediaById } from "../../src/db.js";

afterEach(() => {
  // No process-global state is retained by this service; keep this hook so new
  // lifecycle resources cannot be added without an explicit cleanup decision.
});

function createFixture(overrides: Record<string, unknown> = {}) {
  const requests: unknown[] = [];
  const known = [
    { chat_jid: "web:default", agent_name: "default", is_active: true, archived_at: null },
    { chat_jid: "web:research", agent_name: "research", is_active: false, archived_at: null },
    { chat_jid: "web:archived", agent_name: "archived", is_active: false, archived_at: "2026-01-01T00:00:00Z" },
    { chat_jid: "whatsapp:test", agent_name: "whatsapp", is_active: true, archived_at: null },
  ];
  const handlers = createAddonMessagingRuntimeHandlers({
    listKnownChats: () => known,
    findChatByAgentName: (name) => {
      const normalized = name.replace(/^@+/, "");
      const match = known.find((chat) => chat.agent_name === normalized && !chat.archived_at && chat.chat_jid.startsWith("web:"));
      return match ? { chat_jid: match.chat_jid, agent_name: match.agent_name } : null;
    },
    enqueueAgentMessage: async (request) => {
      requests.push(request);
      return { status: "ok", chat_jid: request.chatJid, row_id: 42, thread_id: 42, created: true };
    },
    ...overrides,
  } as any);
  return { handlers, requests };
}

const peerSource = {
  peer_instance_id: "peerInstance_1234567890",
  peer_fingerprint: "abc123-def456-ghi789",
  peer_alias: "lab",
  agent_name: "auditor",
  agent_display_name: "Remote Auditor",
  reply_address: "lab!@auditor",
  message_id: "rmsg_123",
};

describe("add-on runtime messaging handlers", () => {
  test("lists only non-archived web agent aliases and resolves targets", async () => {
    const { handlers } = createFixture();
    expect(await handlers.listAdvertisableAgents()).toEqual([
      { agent_name: "default", active: true },
      { agent_name: "research", active: false },
    ]);
    expect(await handlers.resolveLocalTarget({ target_agent_name: "@research" })).toEqual({
      status: "resolved",
      target_agent_name: "research",
      active: false,
    });
    expect(await handlers.resolveLocalTarget({ target_chat_jid: "web:missing" })).toEqual({ status: "not_found" });
    expect(() => handlers.resolveLocalTarget({ target_agent_name: "research", target_chat_jid: "web:research" }))
      .toThrow("exactly one");
  });

  test("resolves and delivers the canonical default target on an empty workspace", async () => {
    const { handlers, requests } = createFixture({
      listKnownChats: () => [],
      findChatByAgentName: () => null,
    });
    expect(await handlers.resolveLocalTarget({ target_agent_name: "default" })).toEqual({
      status: "resolved",
      target_agent_name: "default",
      active: false,
    });
    await expect(handlers.deliverPeerMessage({
      target_agent_name: "default",
      content: "fresh inbox",
      source: peerSource,
    })).resolves.toMatchObject({ status: "ok", chat_jid: "web:default" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ chatJid: "web:default", mode: "queue" });
  });

  test("delivers a core-owned peer message block through the normal runtime queue", async () => {
    const { handlers, requests } = createFixture();
    await expect(handlers.deliverPeerMessage({
      target_agent_name: "research",
      content: "First line\nSecond line",
      mode: "queue",
      thread_id: 7,
      source: { ...peerSource, in_reply_to: "rmsg_parent" },
    })).resolves.toEqual({ status: "ok", chat_jid: "web:research", row_id: 42, thread_id: 42, created: true });

    expect(requests).toEqual([{
      chatJid: "web:research",
      content: "From: Remote Auditor <addr:lab!@auditor>\nReply-To: lab!@auditor\nTo: @research\n\nFirst line\nSecond line",
      contentBlocks: [{
        type: "peer_message",
        relay: "addon.peer-message",
        source_chat_jid: "remote:peerInstance_1234567890",
        source_agent_name: "auditor",
        source_agent_display_name: "Remote Auditor",
        source_peer_instance_id: "peerInstance_1234567890",
        source_peer_fingerprint: "abc123-def456-ghi789",
        source_peer_alias: "lab",
        source_address: "lab!@auditor",
        target_chat_jid: "web:research",
        target_agent_name: "research",
        message_id: "rmsg_123",
        in_reply_to: "rmsg_parent",
        reply_to: { address: "lab!@auditor", message_id: "rmsg_123" },
        body: "First line\nSecond line",
      }],
      mode: "queue",
      threadId: 7,
      source: "addon.peer-message",
      queuedBy: { source: "addon.peer-message", clientId: "peerInstance_1234567890" },
    }]);
  });

  test("persists verified peer attachments through the normal media path", async () => {
    const { handlers, requests } = createFixture();
    const data = new TextEncoder().encode("remote file");
    await handlers.deliverPeerMessage({
      target_agent_name: "research",
      content: "See attachment",
      attachments: [{ filename: "note.txt", content_type: "text/plain", size: data.length, sha256: createHash("sha256").update(data).digest("hex"), data }],
      source: peerSource,
    });
    const request = requests.at(-1) as any;
    expect(request.mediaIds).toHaveLength(1);
    const media = getMediaById(request.mediaIds[0]);
    expect(media?.filename).toBe("note.txt");
    expect(new TextDecoder().decode(media?.data)).toBe("remote file");

    await expect(handlers.deliverPeerMessage({
      target_agent_name: "research",
      content: "bad attachment",
      attachments: [{ filename: "note.txt", content_type: "text/plain", size: data.length, sha256: "0".repeat(64), data }],
      source: { ...peerSource, message_id: "rmsg_bad_attachment" },
    })).rejects.toThrow("SHA-256");
  });

  test("does not accept caller-supplied blocks, chat identity, invalid peer facts, or missing targets", async () => {
    const { handlers, requests } = createFixture();
    await expect(handlers.deliverPeerMessage({
      target_agent_name: "missing",
      content: "hello",
      source: peerSource,
    })).rejects.toThrow("target was not found");
    await expect(handlers.deliverPeerMessage({
      target_agent_name: "research",
      content: "hello",
      source: { ...peerSource, peer_instance_id: "bad id" },
    })).rejects.toThrow("invalid format");
    await expect(handlers.deliverPeerMessage({
      target_agent_name: "research",
      content: "hello",
      source: { ...peerSource, reply_address: "a!b!inbox" },
    })).rejects.toThrow("invalid format");
    expect(requests).toEqual([]);
  });

  test("bounds message bytes and defaults unrecognised delivery modes to queue", async () => {
    const { handlers, requests } = createFixture();
    await expect(handlers.deliverPeerMessage({
      target_agent_name: "research",
      content: "x".repeat(32 * 1024 + 1),
      source: peerSource,
    })).rejects.toThrow("exceeds 32768 bytes");

    await handlers.deliverPeerMessage({
      target_agent_name: "research",
      content: "hello",
      mode: "unexpected" as any,
      source: peerSource,
    });
    expect((requests[0] as any).mode).toBe("queue");
  });
});
