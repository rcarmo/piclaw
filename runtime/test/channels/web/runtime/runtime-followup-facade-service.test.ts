import { describe, expect, test } from "bun:test";

import { WebChannelRuntimeFollowupFacadeService } from "../../../../src/channels/web/runtime/runtime-followup-facade-service.js";

describe("WebChannel runtime/follow-up facade service", () => {
  test("delegates queued-followup, runtime-state, and panel/buffer access through injected services", async () => {
    const calls: string[] = [];
    const queuedItem = { rowId: 41, queuedContent: "queued", threadId: 7, queuedAt: "2026-03-28T00:00:00.000Z" };
    const buffer = { text: "draft line", totalLines: 2 };
    const status = { type: "intent", title: "Thinking" };

    let currentMessageWriteService = {
      sendMessage: async (chatJid: string, text: string, options?: { threadId?: number | null }) => {
        calls.push(`send:${chatJid}:${text}:${options?.threadId ?? "null"}`);
      },
      postDashboardWidget: async (chatJid: string, options?: { threadId?: number | null; text?: string; widgetId?: string }) => {
        calls.push(`widget:${chatJid}:${options?.threadId ?? "null"}:${options?.widgetId ?? ""}`);
      },
    };

    let currentQueuedFollowupLifecycle = {
      enqueueQueuedFollowupItem: (
        chatJid: string,
        rowId: number,
        queuedContent: string,
        threadId?: number | null,
        queuedAt?: string,
        extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] },
      ) => {
        calls.push(`enqueue:${chatJid}:${rowId}:${queuedContent}:${threadId ?? "null"}:${queuedAt ?? ""}:${extras?.mediaIds?.join(",") ?? ""}`);
        return 99;
      },
      peekQueuedFollowupItem: (chatJid: string) => {
        calls.push(`peek-item:${chatJid}`);
        return queuedItem;
      },
      consumeQueuedFollowupItem: (chatJid: string) => {
        calls.push(`consume-item:${chatJid}`);
        return queuedItem;
      },
      prependQueuedFollowupItem: (chatJid: string, item: typeof queuedItem) => {
        calls.push(`prepend:${chatJid}:${item.rowId}`);
      },
      replaceQueuedFollowupItem: (chatJid: string, item: typeof queuedItem) => {
        calls.push(`replace-item:${chatJid}:${item.rowId}`);
        return true;
      },
      getQueuedFollowupCount: (chatJid: string) => {
        calls.push(`count:${chatJid}`);
        return 3;
      },
      getQueuedFollowupItems: (chatJid: string) => {
        calls.push(`items:${chatJid}`);
        return [queuedItem];
      },
      removeQueuedFollowupItem: (chatJid: string, rowId: number) => {
        calls.push(`remove:${chatJid}:${rowId}`);
        return queuedItem;
      },
    };

    let currentRuntimeState = {
      updateAgentStatus: (chatJid: string, nextStatus: Record<string, unknown>) => {
        calls.push(`status-update:${chatJid}:${String(nextStatus.title ?? "")}`);
      },
      getAgentStatus: (chatJid: string) => {
        calls.push(`status-get:${chatJid}`);
        return status;
      },
      getThreadRootId: (chatJid: string, messageId: string) => {
        calls.push(`thread-root:${chatJid}:${messageId}`);
        return 55;
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
    };

    const service = new WebChannelRuntimeFollowupFacadeService({
      getMessageWriteService: () => currentMessageWriteService,
      getQueuedFollowupLifecycle: () => currentQueuedFollowupLifecycle,
      getRuntimeState: () => currentRuntimeState,
    });

    await service.sendMessage("web:test", "hello", { threadId: 9 });
    await service.postDashboardWidget("web:test", { threadId: 8, widgetId: "widget-runtime" });
    expect(service.enqueueQueuedFollowupItem("web:test", 0, "queued", 6, "2026-03-28T00:00:00.000Z", { mediaIds: [1, 2] })).toBe(99);
    expect(service.peekQueuedFollowupItem("web:test")).toBe(queuedItem);
    expect(service.consumeQueuedFollowupItem("web:test")).toBe(queuedItem);
    service.prependQueuedFollowupItem("web:test", queuedItem);
    expect(service.replaceQueuedFollowupItem("web:test", queuedItem)).toBe(true);
    expect(service.getQueuedFollowupCount("web:test")).toBe(3);
    expect(service.getQueuedFollowupItems("web:test")).toEqual([queuedItem]);
    expect(service.removeQueuedFollowupItem("web:test", 41)).toBe(queuedItem);
    service.updateAgentStatus("web:test", status);
    expect(service.getAgentStatus("web:test")).toEqual(status);
    expect(service.getThreadRootId("web:test", "m-1")).toBe(55);
    service.resumeChat("web:test", 12);
    service.resumePendingChats("web:test");
    expect(service).not.toHaveProperty('loadState');expect(service).not.toHaveProperty('saveState');
    service.setPanelExpanded("turn-1", "draft", true);
    expect(service.isPanelExpanded("turn-1", "draft")).toBe(true);
    service.updateThoughtBuffer("turn-1", "thought text", 3);
    service.updateDraftBuffer("turn-1", "draft text", 4);
    expect(service.getBuffer("turn-1", "draft")).toEqual(buffer);

    currentRuntimeState = {
      ...currentRuntimeState,
      getAgentStatus: (chatJid: string) => {
        calls.push(`status-get-next:${chatJid}`);
        return { type: "intent", title: "Updated" };
      },
    };

    expect(service.getAgentStatus("web:test")).toEqual({ type: "intent", title: "Updated" });

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "widget:web:test:8:widget-runtime",
      "enqueue:web:test:0:queued:6:2026-03-28T00:00:00.000Z:1,2",
      "peek-item:web:test",
      "consume-item:web:test",
      "prepend:web:test:41",
      "replace-item:web:test:41",
      "count:web:test",
      "items:web:test",
      "remove:web:test:41",
      "status-update:web:test:Thinking",
      "status-get:web:test",
      "thread-root:web:test:m-1",
      "resume:web:test:12",
      "resume-pending:web:test",
      "panel-set:turn-1:draft:true",
      "panel-get:turn-1:draft",
      "thought:turn-1:thought text:3",
      "draft:turn-1:draft text:4",
      "buffer:turn-1:draft",
      "status-get-next:web:test",
    ]);
  });
});
