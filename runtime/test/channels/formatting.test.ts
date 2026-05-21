import { expect, test } from "bun:test";
import { buildChannelSystemPromptAppendix, getChannelFormattingInstructions } from "../../src/channels/formatting.js";

test("getChannelFormattingInstructions returns known channel hints", () => {
  expect(getChannelFormattingInstructions("web")).toContain("Use Markdown formatting");
  expect(getChannelFormattingInstructions("whatsapp")).toContain("Use WhatsApp formatting only");
  expect(getChannelFormattingInstructions("telegram")).toContain("Use Telegram-safe formatting");
  expect(getChannelFormattingInstructions("unknown")).toBeNull();
});

test("buildChannelSystemPromptAppendix builds persistent session guidance", () => {
  const appendix = buildChannelSystemPromptAppendix("web", "web:default");
  expect(appendix).toContain("## Active delivery channel");
  expect(appendix).toContain("Current channel: web");
  expect(appendix).toContain("Current chat: web:default");
  expect(appendix).toContain("scope replies, tool calls, message lookups");
  expect(appendix).toContain("Use Markdown formatting");
  expect(buildChannelSystemPromptAppendix("unknown")).toBeNull();
});
