import { expect, test } from "bun:test";

import { buildTelegramChatJid, parseTelegramTarget } from "../../src/channels/telegram-targets.js";

test("parseTelegramTarget handles plain chat id and topic ids", () => {
  expect(parseTelegramTarget("telegram:123")).toEqual({
    chatId: "123",
    chatType: "direct",
  });
  expect(parseTelegramTarget("telegram:-100123:topic:42")).toEqual({
    chatId: "-100123",
    messageThreadId: 42,
    chatType: "group",
  });
});

test("buildTelegramChatJid formats topic-scoped chat jids", () => {
  expect(buildTelegramChatJid("123")).toBe("telegram:123");
  expect(buildTelegramChatJid("-100123", 7)).toBe("telegram:-100123:topic:7");
});
