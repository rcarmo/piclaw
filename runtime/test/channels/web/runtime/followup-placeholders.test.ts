import { describe, expect, test } from "bun:test";
import { FollowupPlaceholderStore } from "../../../../src/channels/web/runtime/followup-placeholders.js";

describe("web followup placeholder store", () => {
  test("returns null for empty chat queue", () => {
    const store = new FollowupPlaceholderStore();
    expect(store.consume("web:default")).toBeNull();
  });

  test("consumes queued placeholder row ids FIFO", () => {
    const store = new FollowupPlaceholderStore();
    store.enqueue("web:default", 10);
    store.enqueue("web:default", 11);

    expect(store.consume("web:default")).toBe(10);
    expect(store.consume("web:default")).toBe(11);
    expect(store.consume("web:default")).toBeNull();
  });

  test("returns mutation-isolated projected placeholder metadata", () => {
    const store = new FollowupPlaceholderStore();
    const contentBlock = { type: "text", nested: { value: 1 } };
    const linkPreview = { href: "https://example.test" };
    const queuedBy = { userId: " user ", sessionId: " session " };
    store.enqueue("web:default", 12, "continue", null, "2026-07-24T12:00:00.000Z", {
      contentBlocks: [contentBlock],
      linkPreviews: [linkPreview],
      screenHint: " mobile ",
      source: " test ",
      queuedBy,
    });

    contentBlock.nested.value = 99;
    linkPreview.href = "https://mutated.test";
    queuedBy.userId = "mutated";

    const peeked = store.peek("web:default")[0]!;
    expect(peeked).toMatchObject({
      rowId: 12,
      queuedContent: "continue",
      threadId: null,
      queuedAt: "2026-07-24T12:00:00.000Z",
      screenHint: "mobile",
      source: "test",
      queuedBy: { userId: "user", sessionId: "session" },
    });
    expect((peeked.contentBlocks?.[0] as any).nested.value).toBe(1);
    expect((peeked.linkPreviews?.[0] as any).href).toBe("https://example.test");

    (peeked.contentBlocks?.[0] as any).nested.value = 2;
    const consumed = store.consumeItem("web:default")!;
    expect((consumed.contentBlocks?.[0] as any).nested.value).toBe(1);
  });
});
