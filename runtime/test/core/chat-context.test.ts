/**
 * test/core/chat-context.test.ts – Tests for async-local chat context.
 *
 * Verifies withChatContext() scoping, getChatJid(), getChatChannel(),
 * and getChatContext() retrieval from AsyncLocalStorage.
 */

import { expect, test } from "bun:test";
import "../helpers.js";

import { getChatChannel, getChatContext, getChatJid, getChatTurnId, withChatContext } from "../../src/core/chat-context.js";

test("chat context scopes values", async () => {
  expect(getChatContext()).toBeNull();
  expect(getChatJid()).toBe("web:default");
  expect(getChatChannel()).toBe("web");
  expect(getChatTurnId()).toBe("");

  await withChatContext("web:test", "web", async () => {
    expect(getChatJid()).toBe("web:test");
    expect(getChatChannel()).toBe("web");
    expect(getChatTurnId()).toBe("turn-exact");
  }, { turnId: "turn-exact" });

  expect(getChatContext()).toBeNull();
  expect(getChatJid("fallback")).toBe("fallback");
  expect(getChatTurnId("fallback-turn")).toBe("fallback-turn");
});
