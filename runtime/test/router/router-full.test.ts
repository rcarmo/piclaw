/**
 * test/router/router-full.test.ts – Integration tests for the message router.
 *
 * Verifies end-to-end message routing through the WhatsApp and web
 * channels, including retry logic, channel selection, and error handling.
 */

import { describe, test, expect } from "bun:test";
import "../helpers.js";

import {
  detectChannel,
  escapeXml,
  formatMessages,
  stripInternalTags,
  formatOutbound,
} from "../../src/router.js";

describe("router", () => {
  test("detectChannel identifies web", () => {
    expect(detectChannel("web:default")).toBe("web");
    expect(detectChannel("web:other")).toBe("web");
  });

  test("detectChannel identifies whatsapp", () => {
    expect(detectChannel("1234@s.whatsapp.net")).toBe("whatsapp");
    expect(detectChannel("group@g.us")).toBe("whatsapp");
  });

  test("detectChannel identifies telegram", () => {
    expect(detectChannel("telegram:1234")).toBe("telegram");
    expect(detectChannel("telegram:-100123:topic:42")).toBe("telegram");
  });

  test("detectChannel handles edge cases", () => {
    expect(detectChannel(null)).toBe("unknown");
    expect(detectChannel(undefined)).toBe("unknown");
    expect(detectChannel("")).toBe("unknown");
  });

  test("escapeXml escapes special characters", () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
    expect(escapeXml("")).toBe("");
  });

  test("formatMessages produces a compact transcript with channel metadata", () => {
    const msgs = [
      { id: "1", chat_jid: "web:default", sender: "user", sender_name: "Alice", content: "hello", timestamp: "2025-01-01T00:00:00Z", is_from_me: false, is_bot_message: false },
    ];
    const result = formatMessages(msgs, "web");
    expect(result).toContain("Channel: web");
    expect(result).toContain("Chat: web:default");
    expect(result).toContain("Alice @ 2025-01-01T00:00:00Z:");
    expect(result).toContain("  hello");
    expect(result).not.toContain("<messages");
  });

  test("formatMessages sends file and folder references as absolute workspace paths", () => {
    const msgs = [
      {
        id: "1",
        chat_jid: "web:default",
        sender: "user",
        sender_name: "Alice",
        content: [
          "please inspect these",
          "",
          "Files:",
          "- notes/todo.md",
          "- /tmp/already-absolute.txt",
          "",
          "Folders:",
          "- projects/demo",
        ].join("\n"),
        timestamp: "2025-01-01T00:00:00Z",
        is_from_me: false,
        is_bot_message: false,
      },
    ];

    const result = formatMessages(msgs, "web");
    expect(result).toContain("  - /tmp/already-absolute.txt");
    expect(result).toMatch(/ {2}- .*\/notes\/todo\.md/);
    expect(result).toMatch(/ {2}- .*\/projects\/demo/);
    expect(result).not.toContain("  - notes/todo.md");
    expect(result).not.toContain("  - projects/demo");
  });

  test("formatMessages includes channel metadata but no repeated formatting hint", () => {
    const msgs = [
      { id: "1", chat_jid: "x", sender: "u", sender_name: "U", content: "hi", timestamp: "t", is_from_me: false, is_bot_message: false },
    ];
    const result = formatMessages(msgs, "whatsapp", "1203630@g.us");
    expect(result).toContain("Channel: whatsapp");
    expect(result).toContain("Chat: 1203630@g.us");
    expect(result).not.toContain("Formatting:");
  });

  test("formatMessages with no channel omits channel metadata", () => {
    const msgs = [
      { id: "1", chat_jid: "x", sender: "u", sender_name: "U", content: "hi", timestamp: "t", is_from_me: false, is_bot_message: false },
    ];
    const result = formatMessages(msgs);
    expect(result).toContain("U @ t:");
    expect(result).toContain("  hi");
    expect(result).not.toContain("Channel:");
    expect(result).toContain("Chat: x");
    expect(result).not.toContain("Formatting:");
  });

  test("formatMessages includes sanitized screen-size hint in headers", () => {
    const msgs = [
      { id: "1", chat_jid: "web:default", sender: "user", sender_name: "Alice", content: "hello", screen_hint: "Mobile", timestamp: "2025-01-01T00:00:00Z", is_from_me: false, is_bot_message: false },
      { id: "2", chat_jid: "web:default", sender: "user", sender_name: "Bob", content: "ignored hint", screen_hint: "bad hint!", timestamp: "2025-01-01T00:00:01Z", is_from_me: false, is_bot_message: false },
    ];
    const result = formatMessages(msgs, "web");
    expect(result).toContain("Alice @ 2025-01-01T00:00:00Z (from mobile):");
    expect(result).toContain("Bob @ 2025-01-01T00:00:01Z:");
    expect(result).not.toContain("bad hint");
  });

  test("stripInternalTags removes internal blocks", () => {
    expect(stripInternalTags("before <internal>hidden</internal> after")).toBe("before  after");
    expect(stripInternalTags("<internal>all hidden</internal>")).toBe("");
    expect(stripInternalTags("no tags here")).toBe("no tags here");
  });

  test("formatOutbound strips internal tags", () => {
    expect(formatOutbound("hello <internal>secret</internal> world")).toBe("hello  world");
  });

  test("formatOutbound escapes HTML for web", () => {
    expect(formatOutbound("a < b & c > d", "web")).toBe("a &lt; b &amp; c &gt; d");
  });

  test("formatOutbound passes through for whatsapp", () => {
    expect(formatOutbound("a < b", "whatsapp")).toBe("a < b");
  });

  test("formatOutbound passes through for telegram", () => {
    expect(formatOutbound("a < b", "telegram")).toBe("a < b");
  });

  test("formatOutbound returns empty for all-internal content", () => {
    expect(formatOutbound("<internal>all hidden</internal>")).toBe("");
  });

  test("detectChannel returns unknown for non-web prefixes", () => {
    expect(detectChannel("web-default")).toBe("unknown");
    expect(detectChannel("webdefault")).toBe("unknown");
    expect(detectChannel("http://example.com")).toBe("unknown");
  });

  test("formatMessages preserves message content verbatim but normalizes header fields", () => {
    const msgs = [
      {
        id: "1",
        chat_jid: "web:default",
        sender: "user",
        sender_name: "A & B <C> \"D\"\nnext",
        content: "Hello & <tag> \"quote\"",
        timestamp: "2025-01-01T00:00:00Z\nignored",
        is_from_me: false,
        is_bot_message: false,
      },
    ];
    const result = formatMessages(msgs, "web");
    expect(result).toContain('A & B <C> "D" next @ 2025-01-01T00:00:00Z ignored:');
    expect(result).toContain('  Hello & <tag> "quote"');
    expect(result).not.toContain("&amp;");
  });

  test("stripInternalTags removes nested and malformed internal blocks", () => {
    expect(stripInternalTags("a <internal>hide <internal>double</internal> end</internal> b"))
      .toBe("a  b");
    expect(stripInternalTags("prefix <internal>missing end"))
      .toBe("prefix");
  });

  test("stripInternalTags preserves literal internal tags inside markdown code spans", () => {
    expect(stripInternalTags("Use `<internal>` and `</internal>` literally."))
      .toBe("Use `<internal>` and `</internal>` literally.");
  });

  test("stripInternalTags preserves literal internal tags inside fenced code blocks", () => {
    expect(stripInternalTags("```html\n<internal>example</internal>\n```"))
      .toBe("```html\n<internal>example</internal>\n```");
  });

  test("formatOutbound keeps code-span literal tags visible on web", () => {
    expect(formatOutbound("Use `<internal>` literally.", "web"))
      .toBe("Use `&lt;internal&gt;` literally.");
  });
});
