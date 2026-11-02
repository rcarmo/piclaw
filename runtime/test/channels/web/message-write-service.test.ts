import { describe, expect, test } from "bun:test";
import {
  WebMessageWriteService,
  type WebMessageWriteServiceDeps,
} from "../../../src/channels/web/message-write-service.js";

function createDeps(overrides: Partial<WebMessageWriteServiceDeps> = {}): WebMessageWriteServiceDeps {
  return {
    admitMessage: async () => null,
    broadcastAgentResponse: () => {},
    ...overrides,
  };
}

describe("web message write service", () => {
  test("sendMessage stores before broadcasting and preserves force-root metadata", async () => {
    const events: string[] = [];
    const interaction = { id: 42, timestamp: "t", data: { type: "agent_response", thread_id: null as number | null } };
    const service = new WebMessageWriteService(createDeps({
      admitMessage: async (chat, text, bot, media, options) => {
        expect([chat, text, bot, media, options]).toEqual(["web:test", "hello", true, [], { threadToSelf: true }]);
        events.push("store"); return interaction;
      },
      broadcastAgentResponse: row => { expect(row).toBe(interaction); events.push(`broadcast:${row.data.thread_id}`); },
    }));
    await service.sendMessage("web:test", "hello", { forceRoot: true });
    expect(events).toEqual(["store", "broadcast:42"]);
  });

  for (const [options, expected] of [[9, { threadId: 9 }], [null, {}], [undefined, {}],
    [{ threadId: 0, forceRoot: true }, { threadId: 0, threadToSelf: true }]] as const) {
    test(`live send options remain compatible: ${JSON.stringify(options)}`, async () => {
      let writes = 0, broadcasts = 0;
      const service = new WebMessageWriteService(createDeps({
        admitMessage: async (_chat, _text, _bot, media, actual) => {
          writes++; expect(media).toEqual([]); expect(actual).toEqual(expected);
          return { id: 42, timestamp: "t", data: {} };
        },
        broadcastAgentResponse: () => { broadcasts++; },
      }));
      await service.sendMessage("web:test", "reply", options);
      expect(writes).toBe(1); expect(broadcasts).toBe(1);
    });
  }

  test("media/block filtering and explicit threading do not mutate caller options", async () => {
    const options = { threadId: 7, forceRoot: true, mediaIds: [2, NaN, 0, -1, Infinity, 3],
      contentBlocks: [null, "bad", { type: "text", text: "reply" }, { type: "file" }] as any };
    const before = structuredClone(options);
    const service = new WebMessageWriteService(createDeps({
      admitMessage: async (_chat, _text, _bot, media, actual) => {
        expect(media).toEqual([2, 3]);
        expect(actual).toEqual({ threadId: 7, contentBlocks: options.contentBlocks.slice(2) });
        return { id: 42, timestamp: "t", data: {} };
      },
    }));
    await service.sendMessage("web:test", "reply", options);
    expect(options).toEqual(before);
  });

  for (const failure of ["store", "broadcast"] as const) {
    test(`${failure} failure propagates without replaying storage/publication`, async () => {
      let writes = 0, broadcasts = 0;
      const fault = Error(failure);
      const service = new WebMessageWriteService(createDeps({
        admitMessage: async () => { writes++; if (failure === "store") throw fault; return { id: 42, timestamp: "t", data: {} }; },
        broadcastAgentResponse: () => { broadcasts++; throw fault; },
      }));
      await expect(service.sendMessage("web:test", "reply", { requirePersistence: true })).rejects.toBe(fault);
      expect(writes).toBe(1); expect(broadcasts).toBe(failure === "store" ? 0 : 1);
    });
  }

  test("postDashboardWidget delegates through the sendMessage write path", async () => {
    const writes: Array<{ chatJid: string; text: string; blocks: unknown[] | undefined }> = [];
    const service = new WebMessageWriteService(createDeps({
      admitMessage: async (chatJid, text, _isBot, _mediaIds, options) => {
        writes.push({
          chatJid,
          text,
          blocks: options?.contentBlocks,
        });
        return {
          id: 101,
          timestamp: "2026-01-01T00:00:00.000Z",
          data: { type: "agent_response", content: text },
        };
      },
    }));

    await service.postDashboardWidget("web:test", {
      threadId: 42,
      text: "Dashboard is ready.",
      widgetId: "widget-test-service",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].chatJid).toBe("web:test");
    expect(writes[0].text).toBe("Dashboard is ready.");
    expect(Array.isArray(writes[0].blocks)).toBe(true);
    expect((writes[0].blocks?.[0] as Record<string, unknown>).widget_id).toBe("widget-test-service");
  });
});

test('WebMessageWriteService rejects an uncommitted reply instead of reporting success',async()=>{
 let broadcasts=0;const service=new WebMessageWriteService(createDeps({broadcastAgentResponse:()=>{broadcasts++;}}));await expect(service.sendMessage('web:default','test',{forceRoot:true,requirePersistence:true})).rejects.toThrow('could not be persisted');expect(broadcasts).toBe(0);
});

test('non-strict reply failure preserves legacy control-command completion semantics',async()=>{
 const service=new WebMessageWriteService(createDeps());await expect(service.sendMessage('web:default','already executed control reply')).resolves.toBeUndefined();
});
