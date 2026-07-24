import { describe, expect, test } from "bun:test";

import { buildPiSessionEnv, mergePiSessionEnv } from "../../src/utils/pi-session-env.js";

describe("PI session environment helpers", () => {
  test("builds upstream-compatible subprocess metadata", () => {
    expect(buildPiSessionEnv({
      sessionId: "session-1",
      sessionFile: "/tmp/session.jsonl",
      model: { provider: "github-copilot", id: "gpt-5.5" } as any,
      thinkingLevel: "high",
    })).toEqual({
      PI_SESSION_ID: "session-1",
      PI_SESSION_FILE: "/tmp/session.jsonl",
      PI_PROVIDER: "github-copilot",
      PI_MODEL: "gpt-5.5",
      PI_REASONING_LEVEL: "high",
    });
  });

  test("parses provider/model labels and clears stale PI values", () => {
    expect(mergePiSessionEnv({
      PI_SESSION_ID: "old",
      PI_SESSION_FILE: "old.jsonl",
      PI_PROVIDER: "old-provider",
      PI_MODEL: "old-model",
      PI_REASONING_LEVEL: "old-level",
      KEEP: "yes",
    }, {
      sessionId: "task-1",
      modelLabel: "openrouter/moonshotai/kimi-k2.6",
    })).toEqual({
      KEEP: "yes",
      PI_SESSION_ID: "task-1",
      PI_PROVIDER: "openrouter",
      PI_MODEL: "moonshotai/kimi-k2.6",
    });
  });
});
