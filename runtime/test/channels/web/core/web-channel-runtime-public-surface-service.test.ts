import { describe, expect, test } from "bun:test";
import { withTempWorkspaceEnv } from '../../../helpers.js';
import { initDatabase, closeDatabase } from '../../../../src/db/connection.js';

import { WebChannel } from "../../../../src/channels/web.js";
import type { InteractionRow } from "../../../../src/db.js";
import {
  WebChannelRuntimePublicSurfaceService,
} from "../../../../src/channels/web/core/web-channel-runtime-public-surface-service.js";

function interaction(id: number): InteractionRow {
  return {
    id,
    chat_jid: "web:test",
    timestamp: "2026-03-28T00:00:00.000Z",
    data: { type: "agent_response", content: `row-${id}` },
  };
}

describe("web channel runtime public surface service", () => {
  test("stores only plain text extension working-indicator frames", () => {
    const service = new WebChannelRuntimePublicSurfaceService({
      runtimeFollowupFacade: {} as any,
      messageProcessingStorageService: {} as any,
      sessionBroadcast: {
        sse: {},
        uiBridge: {},
        broadcastEvent: () => undefined,
      } as any,
    });

    service.broadcastEvent("extension_ui_working_indicator", {
      chat_jid: "web:test",
      frames: ["<svg><circle /></svg>", "⠋", "<span>busy</span>", "·"],
      interval_ms: 80,
    });

    expect(service.getExtensionWorkingState("web:test")).toEqual({
      message: null,
      indicator: { mode: "custom", frames: ["⠋", "·"], intervalMs: 80 },
      visible: true,
    });
  });

  test("delegates targeted runtime agent messages to the web handler path when available", async () => {
    await withTempWorkspaceEnv('runtime-handler-authority-',{},async()=>{
    initDatabase();
    try {
    const calls: string[] = [];
    let body: Record<string, unknown> | null = null;
    const service = new WebChannelRuntimePublicSurfaceService({
      handleAgentMessage: async (req, pathname) => {
        const url = new URL(req.url);
        calls.push(`handler:${pathname}:${url.searchParams.get("chat_jid")}`);
        body = await req.json() as Record<string, unknown>;
        return Response.json({
          user_message: { id: 77, chat_jid: "web:goal", timestamp: "2026-03-28T00:00:00.000Z", data: { thread_id: 77 } },
          thread_id: 77,
        }, { status: 201 });
      },
      runtimeFollowupFacade: {} as any,
      messageProcessingStorageService: {} as any,
      sessionBroadcast: { sse: {}, uiBridge: {}, broadcastEvent: () => undefined } as any,
    });

    const result = await service.enqueueAgentMessage({
      chatJid: "web:goal",
      content: "🎯 Continue goal: Ship it",
      mediaIds: [3],
      contentBlocks: [{ type: "text", text: "inline" }],
      linkPreviews: [{ url: "https://example.invalid" }],
      threadId: 5,
      mode: "queue",
    });

    expect(result.status).toBe("ok");
    expect(result.chat_jid).toBe("web:goal");
    expect(result.row_id).toBe(77);
    expect(result.thread_id).toBe(77);
    expect(result.created).toBe(true);
    expect(calls).toEqual(["handler:/agent/default/message:web:goal"]);
    expect(body).toEqual({
      content: "🎯 Continue goal: Ship it",
      mode: "queue",
      media_ids: [3],
      content_blocks: [{ type: "text", text: "inline" }],
      link_previews: [{ url: "https://example.invalid" }],
      thread_id: 5,
    });
    } finally { closeDatabase(); }
    });
  });

  test("runtime input pins its trusted handler before admission validation", async () => {
    await withTempWorkspaceEnv("runtime-handler-capture-", {}, async () => {
      initDatabase();
      try {
        let original = 0, redirected = 0;
        const channel: any = { async handleAgentMessage() {
          expect(this).toBe(channel); original++;
          return Response.json({ queued: "followup", thread_id: null }, { status: 201 });
        } };
        const service = new WebChannelRuntimePublicSurfaceService(channel);
        const result = await service.enqueueAgentMessage({ chatJid: "web:goal", content: "captured input", mode: "queue",
          admission: { validate() { channel.handleAgentMessage = async () => { redirected++; throw Error("replacement must not run"); }; } } });
        expect(result.queued).toBe("followup"); expect(original).toBe(1); expect(redirected).toBe(0);
      } finally { closeDatabase(); }
    });
  });

  for (const mode of ["auto","queue","steer"] as const) {
    test("missing host input handler rejects without legacy queue/storage effects: " + mode, async () => {
      const calls:string[]=[];
      const unexpected=()=>{calls.push("unexpected");throw Error("must not touch a fallback");};
      const service=new WebChannelRuntimePublicSurfaceService({
        get agentPool(){return unexpected();},
        get runtimeFollowupFacade(){return unexpected();},
        get messageProcessingStorageService(){return unexpected();},
        get sessionBroadcast(){return unexpected();},
      } as any);
      await expect(service.enqueueAgentMessage({chatJid:"web:goal",content:"preserved input",mode,
        mediaIds:[3],threadId:5,source:"goal.continuation"}))
        .rejects.toThrow("Runtime agent messages require the host input handler.");
      expect(calls).toEqual([]);
    });
  }

  test("delegates runtime/session/storage surfaces to the extracted collaborators", async () => {
    const calls: string[] = [];
    const sse = { kind: "sse-hub" };
    const uiBridge = { kind: "ui-bridge" };
    const placeholder = interaction(1);
    const stored = interaction(2);
    const queuedItem = { rowId: 3, queuedContent: "queued", threadId: 4, queuedAt: "2026-03-28T00:00:00.000Z" };
    const buffer = { text: "draft", totalLines: 5 };
    const status = { type: "intent", title: "Thinking" };

    const service = Object.assign(Object.create(WebChannel.prototype), {
      runtimeFollowupFacade: {
        sendMessage: async (chatJid, text, options) => {
          calls.push(`send:${chatJid}:${text}:${options?.threadId ?? "null"}`);
        },
        postDashboardWidget: async (chatJid, options) => {
          calls.push(`widget:${chatJid}:${options?.threadId ?? "null"}:${options?.widgetId ?? ""}`);
        },
        queueFollowupPlaceholder: (chatJid, text, threadId, queuedContent) => {
          calls.push(`queue:${chatJid}:${text}:${threadId ?? "null"}:${queuedContent ?? ""}`);
          return placeholder;
        },
        enqueueQueuedFollowupItem: (chatJid, rowId, queuedContent, threadId, queuedAt) => {
          calls.push(`enqueue:${chatJid}:${rowId}:${queuedContent}:${threadId ?? "null"}:${queuedAt ?? ""}`);
          return 41;
        },
        peekQueuedFollowupItem: (chatJid) => {
          calls.push(`peek-item:${chatJid}`);
          return queuedItem;
        },
        consumeQueuedFollowupItem: (chatJid) => {
          calls.push(`consume-item:${chatJid}`);
          return queuedItem;
        },
        prependQueuedFollowupItem: (chatJid, item) => {
          calls.push(`prepend:${chatJid}:${item.rowId}`);
        },
        replaceQueuedFollowupItem: (chatJid, item) => {
          calls.push(`replace-item:${chatJid}:${item.rowId}`);
          return true;
        },
        consumeQueuedFollowupPlaceholder: (chatJid) => {
          calls.push(`consume-placeholder:${chatJid}`);
          return 42;
        },
        getQueuedFollowupCount: (chatJid) => {
          calls.push(`count:${chatJid}`);
          return 2;
        },
        getQueuedFollowupItems: (chatJid) => {
          calls.push(`items:${chatJid}`);
          return [queuedItem];
        },
        removeQueuedFollowupItem: (chatJid, rowId) => {
          calls.push(`remove:${chatJid}:${rowId}`);
          return queuedItem;
        },
        updateAgentStatus: (chatJid, nextStatus) => {
          calls.push(`status-update:${chatJid}:${String(nextStatus.title ?? "")}`);
        },
        getAgentStatus: (chatJid) => {
          calls.push(`status-get:${chatJid}`);
          return status;
        },
        setContextUsage: (chatJid, usage) => {
          calls.push(`context-set:${chatJid}:${usage?.percent ?? "null"}`);
        },
        getContextUsage: (chatJid) => {
          calls.push(`context-get:${chatJid}`);
          return { percent: 42 };
        },
        replaceQueuedFollowupPlaceholder: (chatJid, rowId, text, mediaIds, _contentBlocks, threadId, isTerminalAgentReply) => {
          calls.push(`replace:${chatJid}:${rowId}:${text}:${mediaIds.join(",")}:${threadId ?? "null"}:${isTerminalAgentReply ? 1 : 0}`);
          return interaction(4);
        },
        getThreadRootId: (chatJid, messageId) => {
          calls.push(`thread-root:${chatJid}:${messageId}`);
          return 43;
        },
        resumeChat: (chatJid, threadRootId) => {
          calls.push(`resume:${chatJid}:${threadRootId ?? "null"}`);
        },
        resumePendingChats: (chatJid) => {
          calls.push(`resume-pending:${chatJid ?? ""}`);
        },
        loadState: () => {
          calls.push("load");
        },
        saveState: () => {
          calls.push("save");
        },
        setPanelExpanded: (turnId, panel, expanded) => {
          calls.push(`panel-set:${turnId}:${panel}:${expanded}`);
        },
        isPanelExpanded: (turnId, panel) => {
          calls.push(`panel-get:${turnId}:${panel}`);
          return true;
        },
        updateThoughtBuffer: (turnId, text, totalLines) => {
          calls.push(`thought:${turnId}:${text}:${totalLines}`);
        },
        updateDraftBuffer: (turnId, text, totalLines) => {
          calls.push(`draft:${turnId}:${text}:${totalLines}`);
        },
        getBuffer: (turnId, panel) => {
          calls.push(`buffer:${turnId}:${panel}`);
          return buffer;
        },
      },
      messageProcessingStorageService: {
        processChat: async (chatJid, agentId, threadRootId) => {
          calls.push(`process:${chatJid}:${agentId}:${threadRootId ?? "undefined"}`);
        },
        storeMessage: (chatJid, content, isBot, mediaIds, options) => {
          calls.push(`store:${chatJid}:${content}:${isBot ? 1 : 0}:${mediaIds.join(",")}:${options?.threadId ?? "undefined"}`);
          return stored;
        },
      },
      sessionBroadcast: {
        sse,
        uiBridge,
        broadcastEvent: (eventType, data) => {
          calls.push(`broadcast:${eventType}:${JSON.stringify(data)}`);
        },
      },
    });
    service.runtimePublicSurfaceService = new WebChannelRuntimePublicSurfaceService(service);

    expect(service.sse).toBe(sse);
    expect(service.uiBridge).toBe(uiBridge);
    await service.sendMessage("web:test", "hello", { threadId: 9 });
    await service.postDashboardWidget("web:test", { threadId: 8, widgetId: "widget-runtime" });
    expect(service.queueFollowupPlaceholder("web:test", "queued", 7, "later")).toBe(placeholder);
    expect(service.enqueueQueuedFollowupItem("web:test", 11, "queued", 6, "2026-03-28T00:00:00.000Z")).toBe(41);
    expect(service.peekQueuedFollowupItem("web:test")).toBe(queuedItem);
    expect(service.consumeQueuedFollowupItem("web:test")).toBe(queuedItem);
    service.prependQueuedFollowupItem("web:test", queuedItem);
    expect(service.replaceQueuedFollowupItem("web:test", queuedItem)).toBe(true);
    expect(service.consumeQueuedFollowupPlaceholder("web:test")).toBe(42);
    expect(service.getQueuedFollowupCount("web:test")).toBe(2);
    expect(service.getQueuedFollowupItems("web:test")).toEqual([queuedItem]);
    expect(service.removeQueuedFollowupItem("web:test", 3)).toBe(queuedItem);
    service.updateAgentStatus("web:test", status);
    expect(service.getAgentStatus("web:test")).toEqual(status);
    expect(service).not.toHaveProperty('setContextUsage');expect(service).not.toHaveProperty('getContextUsage');
    service.broadcastEvent("extension_ui_working", { chat_jid: "web:test", message: "Compacting context…" });
    service.broadcastEvent("extension_ui_working_indicator", { chat_jid: "web:test", frames: ["a", "b"], interval_ms: 80 });
    expect(service.getExtensionWorkingState("web:test")).toEqual({
      message: "Compacting context…",
      indicator: { mode: "custom", frames: ["a", "b"], intervalMs: 80 },
      visible: true,
    });
    service.broadcastEvent("agent_response", { chat_jid: "web:test" });
    expect(service.getExtensionWorkingState("web:test")).toBeNull();
    expect(service.replaceQueuedFollowupPlaceholder("web:test", 22, "updated", [1, 2], [{ type: "text" }], 6, true)?.id).toBe(4);
    expect(service.getThreadRootId("web:test", "m-1")).toBe(43);
    service.resumeChat("web:test", 12);
    service.resumePendingChats("web:test");
    expect(service).not.toHaveProperty('loadState');expect(service).not.toHaveProperty('saveState');
    service.setPanelExpanded("turn-1", "thought", true);
    expect(service.isPanelExpanded("turn-1", "thought")).toBe(true);
    service.updateThoughtBuffer("turn-1", "thought text", 3);
    service.updateDraftBuffer("turn-1", "draft text", 4);
    expect(service.getBuffer("turn-1", "thought")).toEqual(buffer);
    service.broadcastEvent("agent_status", { chat_jid: "web:test", type: "thinking" });
    expect(service.storeMessage("web:test", "stored", true, [7], { threadId: 55 })).toBe(stored);
    await service.processChat("web:test", "default", null);

    expect(calls).toEqual([
      "send:web:test:hello:9",
      "widget:web:test:8:widget-runtime",
      "queue:web:test:queued:7:later",
      "enqueue:web:test:11:queued:6:2026-03-28T00:00:00.000Z",
      "peek-item:web:test",
      "consume-item:web:test",
      "prepend:web:test:3",
      "replace-item:web:test:3",
      "consume-placeholder:web:test",
      "count:web:test",
      "items:web:test",
      "remove:web:test:3",
      "status-update:web:test:Thinking",
      "status-get:web:test",
      "broadcast:extension_ui_working:{\"chat_jid\":\"web:test\",\"message\":\"Compacting context…\"}",
      "broadcast:extension_ui_working_indicator:{\"chat_jid\":\"web:test\",\"frames\":[\"a\",\"b\"],\"interval_ms\":80}",
      "broadcast:agent_response:{\"chat_jid\":\"web:test\"}",
      "replace:web:test:22:updated:1,2:6:1",
      "thread-root:web:test:m-1",
      "resume:web:test:12",
      "resume-pending:web:test",
      "panel-set:turn-1:thought:true",
      "panel-get:turn-1:thought",
      "thought:turn-1:thought text:3",
      "draft:turn-1:draft text:4",
      "buffer:turn-1:thought",
      "broadcast:agent_status:{\"chat_jid\":\"web:test\",\"type\":\"thinking\"}",
      "store:web:test:stored:1:7:55",
      "process:web:test:default:undefined",
    ]);
  });

  test("keeps one working-state owner and returns detached snapshots", () => {
    const channel = Object.assign(Object.create(WebChannel.prototype), {
      runtimeFollowupFacade: { updateAgentStatus() {} },
      sessionBroadcast: { broadcastEvent() {} },
    });
    const owner = new WebChannelRuntimePublicSurfaceService(channel);
    channel.runtimePublicSurfaceService = owner;
    channel.broadcastEvent("extension_ui_working", { chat_jid: "web:test", message: "Still working" });
    channel.broadcastEvent("extension_ui_working_indicator", { chat_jid: "web:test", frames: ["a"], interval_ms: 90 });
    const snapshot = channel.getExtensionWorkingState("web:test");
    snapshot.message = "modified reader"; snapshot.indicator.mode = "modified reader";
    expect(channel.runtimePublicSurfaceService).toBe(owner);
    expect(channel.getExtensionWorkingState("web:test")).toEqual({ message: "Still working", indicator: { mode: "custom", frames: ["a"], intervalMs: 90 }, visible: true });
    channel.updateAgentStatus("web:test", { type: "done" });
    expect(channel.getExtensionWorkingState("web:test")).toBeNull();
  });
});
