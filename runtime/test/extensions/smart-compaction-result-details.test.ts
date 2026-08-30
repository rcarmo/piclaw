import { expect, test } from "bun:test";

import {
  createSmartCompactionResultDetails,
  parseSmartCompactionResultDetails,
} from "../../src/extensions/smart-compaction/result-details.js";

test("smart compaction result details preserve provider timing and model attribution", () => {
  const details = createSmartCompactionResultDetails({
    method: "selective",
    execution: "single_pass",
    remoteOutcome: "disabled",
    remoteReason: "not enabled",
    modelCallCount: 1,
    model: "local/fast-summary",
    providerRequestCount: 1,
    timeToFirstTokenMs: 12_345,
    durationMs: 45_678,
    timeoutStage: "first_token",
  });

  expect(details).toMatchObject({
    model: "local/fast-summary",
    providerRequestCount: 1,
    timeToFirstTokenMs: 12_345,
    durationMs: 45_678,
    timeoutStage: "first_token",
  });
  expect(parseSmartCompactionResultDetails(details)).toEqual(details);
});

test("legacy smart compaction result details remain parseable", () => {
  expect(parseSmartCompactionResultDetails({
    kind: "piclaw.smart_compaction",
    version: 1,
    method: "pipelined",
    execution: "progressive",
    remoteCompaction: { outcome: "disabled" },
    modelCallCount: 2,
  })).not.toBeNull();
});
