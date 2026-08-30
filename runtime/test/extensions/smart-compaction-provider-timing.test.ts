import { expect, test } from "bun:test";

import {
  createCompactionProviderTiming,
  formatCompactionProviderTimeout,
  formatFirstTokenWaitStatus,
} from "../../src/extensions/smart-compaction/provider-timing.js";

test("first-token wait status includes model, elapsed time, and remaining deadline", () => {
  const timing = createCompactionProviderTiming({ provider: "local", id: "slow-prefill" });
  timing.waitingForFirstTokenSince = 1_000;
  expect(formatFirstTokenWaitStatus(timing, 6_500, 21_000)).toBe(
    "waiting for first token from local/slow-prefill — 6s elapsed, 15s remaining",
  );
  timing.waitingForFirstTokenSince = null;
  expect(formatFirstTokenWaitStatus(timing, 6_500, 21_000)).toBeNull();
});

test("provider timeout attribution distinguishes first-token and streaming stages", () => {
  const firstToken = createCompactionProviderTiming({ provider: "local", id: "slow-prefill" });
  firstToken.requestStartedAt = 1_000;
  firstToken.waitingForFirstTokenSince = 1_000;
  expect(formatCompactionProviderTimeout("Request timed out", firstToken)).toBe(
    "Compaction provider timed out during first_token using local/slow-prefill: Request timed out",
  );

  const streaming = createCompactionProviderTiming({ provider: "local", id: "slow-stream" });
  streaming.requestStartedAt = 1_000;
  streaming.firstTokenAt = 2_000;
  streaming.timeToFirstTokenMs = 1_000;
  expect(formatCompactionProviderTimeout("Request timed out", streaming)).toBe(
    "Compaction provider timed out during streaming using local/slow-stream; first token after 1000ms: Request timed out",
  );
});
