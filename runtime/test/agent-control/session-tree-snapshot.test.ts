import { describe, expect, test } from "bun:test";
import { buildSessionTreeSnapshot } from "../../src/agent-control/session-tree-snapshot.js";

describe("session tree command snapshot", () => {
  test("flattens hierarchy with complete navigation metadata", () => {
    const sessionManager = {
      getLeafId: () => "leaf",
      getTree: () => [{
        label: "root label",
        entry: {
          id: "root",
          parentId: null,
          type: "message",
          timestamp: "2026-08-24T20:00:00.000Z",
          message: { role: "user", content: [{ type: "text", text: "root prompt" }] },
        },
        children: [{
          label: null,
          entry: {
            id: "leaf",
            parentId: "root",
            type: "message",
            timestamp: "2026-08-24T20:01:00.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "leaf reply" }] },
          },
          children: [],
        }],
      }],
    };

    expect(buildSessionTreeSnapshot(sessionManager as any)).toEqual({
      version: 1,
      leafId: "leaf",
      flat: true,
      total: 2,
      nodes: [
        expect.objectContaining({
          id: "root",
          parentId: null,
          label: "root label",
          active: false,
          childCount: 1,
          role: "user",
          detail: "root prompt",
        }),
        expect.objectContaining({
          id: "leaf",
          parentId: "root",
          active: true,
          childCount: 0,
          role: "assistant",
          detail: "leaf reply",
        }),
      ],
    });
  });

  test("normalizes transcript prompt envelopes while retaining raw detail", () => {
    const raw = [
      "Channel: web",
      "",
      "Formatting:",
      "Markdown is allowed.",
      "",
      "Rui Carmo @ 2026-08-24T20:02:00Z:",
      "  show a normalized preview.",
    ].join("\n");
    const snapshot = buildSessionTreeSnapshot({
      getLeafId: () => "m1",
      getTree: () => [{
        label: null,
        children: [],
        entry: {
          id: "m1",
          parentId: null,
          type: "message",
          timestamp: "2026-08-24T20:02:00Z",
          message: { role: "user", content: [{ type: "text", text: raw }] },
        },
      }],
    } as any);

    expect(snapshot.nodes[0]).toMatchObject({
      detail: "Rui Carmo (2026-08-24T20:02:00Z): show a normalized preview.",
      previewText: "show a normalized preview.",
      rawDetail: raw,
      rawContentLength: raw.length,
    });
  });
});
