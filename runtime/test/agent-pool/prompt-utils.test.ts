import { expect, test } from "bun:test";

import { setEnv } from "../helpers.js";

import {
  DEFAULT_SESSION_IDLE_COMPACTION_MAX_WAIT_MS,
  DEFAULT_SESSION_IDLE_MAX_WAIT_MS,
  DEFAULT_SESSION_IDLE_SETTLE_TICKS,
  extractAssistantText,
  extractAssistantThinking,
  formatTimeoutDuration,
  resolveSessionIdleMaxWaitMs,
  toSideReasoning,
  waitForSessionIdle,
} from "../../src/agent-pool/prompt-utils.js";

test("prompt utils format timeout durations compactly", () => {
  expect(formatTimeoutDuration(500)).toBe("0.5s");
  expect(formatTimeoutDuration(5000)).toBe("5s");
  expect(formatTimeoutDuration(0)).toBe("0ms");
});

test("prompt utils extract assistant text and thinking blocks", () => {
  const message = {
    content: [
      { type: "text", text: "hello" },
      { type: "thinking", thinking: "plan" },
      { type: "text", text: " world" },
    ],
  };

  expect(extractAssistantText(message)).toBe("hello world");
  expect(extractAssistantThinking(message)).toBe("plan");
  expect(toSideReasoning("high")).toBe("high");
  expect(toSideReasoning("off")).toBeUndefined();
});

test("waitForSessionIdle uses a 1s default settle window", () => {
  expect(DEFAULT_SESSION_IDLE_SETTLE_TICKS).toBe(20);
  expect(DEFAULT_SESSION_IDLE_MAX_WAIT_MS).toBe(10_000);
  expect(DEFAULT_SESSION_IDLE_COMPACTION_MAX_WAIT_MS).toBe(300_000);
});

test("resolveSessionIdleMaxWaitMs extends the wait budget for compaction", () => {
  expect(resolveSessionIdleMaxWaitMs({ isCompacting: false }, 120, 500)).toBe(120);
  expect(resolveSessionIdleMaxWaitMs({ isCompacting: true }, 120, 500)).toBe(500);
  expect(resolveSessionIdleMaxWaitMs({ isCompacting: true }, 800, 500)).toBe(800);
});

test("resolveSessionIdleMaxWaitMs rejects malformed numeric env suffixes", () => {
  const restore = setEnv({
    PICLAW_SESSION_IDLE_MAX_WAIT_MS: "1234oops",
    PICLAW_SESSION_IDLE_COMPACTION_MAX_WAIT_MS: "4567oops",
  });
  try {
    expect(resolveSessionIdleMaxWaitMs({ isCompacting: false })).toBe(DEFAULT_SESSION_IDLE_MAX_WAIT_MS);
    expect(resolveSessionIdleMaxWaitMs({ isCompacting: true })).toBe(DEFAULT_SESSION_IDLE_COMPACTION_MAX_WAIT_MS);
  } finally {
    restore();
  }
});

test("waitForSessionIdle does not settle during a 600ms mid-run idle gap", async () => {
  const session = {
    isStreaming: true,
    isCompacting: false,
    isRetrying: false,
  };

  const waitPromise = waitForSessionIdle(session);

  setTimeout(() => {
    session.isStreaming = false;
  }, 0);

  // 600ms of apparent idle between phases.
  setTimeout(() => {
    session.isStreaming = true;
  }, 600);

  // Final completion after the second active phase.
  setTimeout(() => {
    session.isStreaming = false;
  }, 700);

  const result = await Promise.race([
    waitPromise.then(() => "settled"),
    Bun.sleep(650).then(() => "pending"),
  ]);

  expect(result).toBe("pending");
  await expect(waitPromise).resolves.toBeUndefined();
});

test("waitForSessionIdle times out when the session never settles", async () => {
  const session = {
    isStreaming: false,
    isCompacting: false,
    isRetrying: true,
  };

  await expect(waitForSessionIdle(session, 2, undefined, 120)).rejects.toThrow(
    "Timed out waiting for session idle after 0.1s (streaming=false, compacting=false, retrying=true)",
  );
});
