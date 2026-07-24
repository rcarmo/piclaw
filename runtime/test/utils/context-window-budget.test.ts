import { describe, expect, test } from "bun:test";

import { setEnv } from "../helpers.js";
import {
  getCompactionRequestOverheadTokens,
  getSystemPromptOverheadTokens,
  getUnknownModelContextWindow,
} from "../../src/utils/context-window-budget.js";

describe("context-window budget env parsing", () => {
  test("rejects malformed positive integer suffixes and preserves defaults", () => {
    const restore = setEnv({
      PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS: "1234oops",
      PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS: "5678oops",
      PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW: "9999oops",
    });
    try {
      expect(getSystemPromptOverheadTokens()).toBe(4_000);
      expect(getCompactionRequestOverheadTokens()).toBe(1_000);
      expect(getUnknownModelContextWindow()).toBe(64_000);
    } finally {
      restore();
    }
  });

  test("preserves zero-as-fallback semantics", () => {
    const restore = setEnv({
      PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS: "0",
      PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS: "0",
      PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW: "0",
    });
    try {
      expect(getSystemPromptOverheadTokens()).toBe(4_000);
      expect(getCompactionRequestOverheadTokens()).toBe(1_000);
      expect(getUnknownModelContextWindow()).toBe(64_000);
    } finally {
      restore();
    }
  });
});
