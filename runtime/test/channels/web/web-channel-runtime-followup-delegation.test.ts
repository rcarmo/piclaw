import { afterEach, describe, expect, test } from "bun:test";

import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.ts";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("WebChannel concrete-owner delegation", () => {
  test("routes every public queue/runtime/write method to its existing owner", async () => {
    const fixture = await createWebChannelTestFixture({ workspace: "temp" });
    cleanup = fixture.cleanup;

    const calls: string[] = [];
    const queuedItem = { rowId: 31, queuedContent: "queued", threadId: 4, queuedAt: "2026-03-28T00:00:00.000Z" };
    const buffer = { text: "buffer text", totalLines: 5 };
    const status = { type: "intent", title: "Thinking" };

    Object.assign((fixture.channel as any).messageWriteService, {
      sendMessage: async (chatJid: string, text: string, options?: { threadId?: number | null }) => {
        calls.push(`send:${chatJid}:${text}:${options?.threadId ?? "null"}`);
      },
      postDashboardWidget: async (chatJid: string, options?: { threadId?: number | null; text?: string; widgetId?: string }) => {
        calls.push(`widget:${chatJid}:${options?.threadId ?? "null"}:${options?.widgetId ?? ""}`);
      },
    });
    Object.assign(fixture.channel.queuedFollowupLifecycle, {
      enqueueQueuedFollowupItem: (
        chatJid: string,
        rowId: number,
        queuedContent: string,
        threadId?: number | null,
        queuedAt?: string,
        extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] },
      ) => {
        calls.push(`enqueue:${chatJid}:${rowId}:${queuedContent}:${threadId ?? "null"}:${queuedAt ?? ""}:${extras?.mediaIds?.join(",") ?? ""}`);
        return 44;
      },
      peekQueuedFollowupItem: (chatJid: string) => {
        calls.push(`peek-item:${chatJid}`);
        return queuedItem;
      },
      getQueuedFollowupCount: (chatJid: string) => {
        calls.push(`count:${chatJid}`);
        return 2;
      },
      getQueuedFollowupItems: (chatJid: string) => {
        calls.push(`items:${chatJid}`);
        return [queuedItem];
      },
    });
    Object.assign((fixture.channel as any).runtimeState, {
      updateAgentStatus: (chatJid: string, nextStatus: Record<string, unknown>) => {
        calls.push(`status-update:${chatJid}:${String(nextStatus.title ?? "")}`);
      },
      getAgentStatus: (chatJid: string) => {
        calls.push(`status-get:${chatJid}`);
        return status;
      },
      getThreadRootId: (chatJid: string, messageId: string) => {
        calls.push(`thread-root:${chatJid}:${messageId}`);
        return 52;
      },
      resumeChat: (chatJid: string, threadRootId?: number | null) => {
        calls.push(`resume:${chatJid}:${threadRootId ?? "null"}`);
      },
      resumePendingChats: (chatJid?: string) => {
        calls.push(`resume-pending:${chatJid ?? ""}`);
      },
      loadState: () => {
        calls.push("load");
      },
      saveState: () => {
        calls.push("save");
      },
      setPanelExpanded: (turnId: string, panel: "thought" | "draft", expanded: boolean) => {
        calls.push(`panel-set:${turnId}:${panel}:${expanded}`);
      },
      isPanelExpanded: (turnId: string, panel: "thought" | "draft") => {
        calls.push(`panel-get:${turnId}:${panel}`);
        return true;
      },
      updateThoughtBuffer: (turnId: string, text: string, totalLines: number) => {
        calls.push(`thought:${turnId}:${text}:${totalLines}`);
      },
      updateDraftBuffer: (turnId: string, text: string, totalLines: number) => {
        calls.push(`draft:${turnId}:${text}:${totalLines}`);
      },
      getBuffer: (turnId: string, panel: "thought" | "draft") => {
        calls.push(`buffer:${turnId}:${panel}`);
        return buffer;
      },
    });

    await fixture.channel.sendMessage("web:test", "hello", { threadId: 9 });
    await fixture.channel.postDashboardWidget("web:test", { threadId: 8, widgetId: "widget-facade" });
    expect(fixture.channel.enqueueQueuedFollowupItem("web:test", 0, "queued", 6, "2026-03-28T00:00:00.000Z", { mediaIds: [1, 2] })).toBe(44);
    expect(fixture.channel.peekQueuedFollowupItem("web:test")).toBe(queuedItem);
    expect(fixture.channel).not.toHaveProperty('replaceQueuedFollowupItem');
    expect(fixture.channel.getQueuedFollowupCount("web:test")).toBe(2);
    expect(fixture.channel.getQueuedFollowupItems("web:test")).toEqual([queuedItem]);
    fixture.channel.updateAgentStatus("web:test", status);
    expect(fixture.channel.getAgentStatus("web:test")).toEqual(status);
    expect(fixture.channel.getThreadRootId("web:test", "m-1")).toBe(52);
    fixture.channel.resumeChat("web:test", 12);
    fixture.channel.resumePendingChats("web:test");
    expect(fixture.channel).not.toHaveProperty('loadState');expect(fixture.channel).not.toHaveProperty('saveState');
    fixture.channel.setPanelExpanded("turn-1", "thought", true);
    expect(fixture.channel.isPanelExpanded("turn-1", "thought")).toBe(true);
    fixture.channel.updateThoughtBuffer("turn-1", "thought text", 3);
    fixture.channel.updateDraftBuffer("turn-1", "draft text", 4);
    expect(fixture.channel.getBuffer("turn-1", "thought")).toEqual(buffer);

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "widget:web:test:8:widget-facade",
      "enqueue:web:test:0:queued:6:2026-03-28T00:00:00.000Z:1,2",
      "peek-item:web:test",
      "count:web:test",
      "items:web:test",
      "status-update:web:test:Thinking",
      "status-get:web:test",
      "thread-root:web:test:m-1",
      "resume:web:test:12",
      "resume-pending:web:test",
      "panel-set:turn-1:thought:true",
      "panel-get:turn-1:thought",
      "thought:turn-1:thought text:3",
      "draft:turn-1:draft text:4",
      "buffer:turn-1:thought",
    ]);
  });
});
