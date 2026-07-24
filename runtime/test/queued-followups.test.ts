import { describe, expect, test } from "bun:test";

import {
  cloneQueuedFollowupItem,
  projectPersistedQueuedFollowupItem,
  projectQueuedFollowupItem,
} from "../src/queued-followups.js";

describe("queued follow-up projections", () => {
  test("normalizes shared metadata, trims optional strings, and preserves persistence-only retry default", () => {
    const input = {
      rowId: -1,
      queuedContent: "continue",
      threadId: undefined,
      queuedAt: "2026-07-24T12:00:00.000Z",
      mediaIds: [1, Number.NaN, 2],
      contentBlocks: [{ type: "text", nested: { value: 1 } }],
      linkPreviews: [{ href: "https://example.test" }],
      screenHint: "  mobile  ",
      source: "  queued  ",
      queuedBy: { source: " web ", userId: " user ", sessionId: " session ", clientId: " client " },
    };

    expect(projectQueuedFollowupItem(input)).toEqual({
      rowId: -1,
      queuedContent: "continue",
      threadId: null,
      queuedAt: "2026-07-24T12:00:00.000Z",
      mediaIds: [1, 2],
      contentBlocks: [{ type: "text", nested: { value: 1 } }],
      linkPreviews: [{ href: "https://example.test" }],
      screenHint: "mobile",
      source: "queued",
      queuedBy: { source: "web", userId: "user", sessionId: "session", clientId: "client" },
    });
    expect(projectPersistedQueuedFollowupItem(input)).toMatchObject({ materializeRetries: 0 });
  });

  test("deep-copies arrays and queuedBy metadata for mutation isolation", () => {
    const original = projectPersistedQueuedFollowupItem({
      rowId: -1,
      queuedContent: "continue",
      queuedAt: "2026-07-24T12:00:00.000Z",
      contentBlocks: [{ type: "text", nested: { value: 1 } }],
      linkPreviews: [{ href: "https://example.test" }],
      queuedBy: { userId: "user" },
    });
    const cloned = cloneQueuedFollowupItem(original);

    (cloned.contentBlocks?.[0] as any).nested.value = 2;
    (cloned.linkPreviews?.[0] as any).href = "https://mutated.test";
    if (cloned.queuedBy) cloned.queuedBy.userId = "mutated";

    expect((original.contentBlocks?.[0] as any).nested.value).toBe(1);
    expect((original.linkPreviews?.[0] as any).href).toBe("https://example.test");
    expect(original.queuedBy?.userId).toBe("user");
  });
});
