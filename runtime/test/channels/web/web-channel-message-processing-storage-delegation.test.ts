import { afterEach, describe, expect, test } from "bun:test";

import type { InteractionRow } from "../../../src/db.js";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.ts";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("WebChannel message processing/storage delegation", () => {
  test("delegates processChat and admitMessage through the extracted seam", async () => {
    const fixture = await createWebChannelTestFixture({ workspace: "temp" });
    cleanup = fixture.cleanup;

    const calls: string[] = [];
    const stored: InteractionRow = {
      id: 99,
      chat_jid: "web:default",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: { type: "agent_response", content: "delegated" },
    };

    (
      fixture.channel as unknown as {
        messageProcessingStorageService: {
          processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void>;
          admitMessage(
            chatJid: string,
            content: string,
            isBot: boolean,
            mediaIds: number[],
            options?: {
              contentBlocks?: unknown[];
              linkPreviews?: unknown[];
              threadId?: number;
              isTerminalAgentReply?: boolean;
              isSteeringMessage?: boolean;
            },
          ): Promise<InteractionRow | null>;
        };
      }
    ).messageProcessingStorageService = {
      processChat: async (chatJid, agentId, threadRootId) => {
        calls.push(`process:${chatJid}:${agentId}:${threadRootId ?? "undefined"}`);
      },
      admitMessage: async (chatJid, content, isBot, mediaIds, options) => {
        calls.push(
          `store:${chatJid}:${content}:${isBot ? 1 : 0}:${mediaIds.join(",")}:${options?.threadId ?? "undefined"}:${options?.isTerminalAgentReply ? 1 : 0}:${options?.isSteeringMessage ? 1 : 0}`,
        );
        return stored;
      },
    };

    const interaction = await fixture.channel.admitMessage("web:default", "hello", true, [7], {
      threadId: 55,
      isTerminalAgentReply: true,
      isSteeringMessage: true,
    });
    await fixture.channel.processChat("web:default", "default", null);

    expect(interaction).toBe(stored);
    expect(calls).toEqual([
      "store:web:default:hello:1:7:55:1:1",
      "process:web:default:default:undefined",
    ]);
  });
});
