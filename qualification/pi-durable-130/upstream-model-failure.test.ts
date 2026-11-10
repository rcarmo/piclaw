import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { classifyModelFailure, modelFailureDetail, modelFailureNotice, parseModelFailure } from "../../runtime/durable-engine/src/host-model-failure.js";
import { modelFailureUpstreamMessage } from "../../runtime/durable-engine/src/host-model-failure-evidence.js";
import { isRetryableAssistantError, isContextOverflow } from "../../runtime/durable-engine/qualification/ai.ts";

const quota = "You have hit your ChatGPT usage limit (prolite plan). Try again in ~84 min.";

test("reported ChatGPT usage limit is quota despite transient-looking text and status", () => {
  for (const message of [quota, "Codex usage limit reached", "usage_limit_reached"]) {
    for (const status of [undefined, 429, 503, 504]) {
      const failure = { ...classifyModelFailure("provider", { errorMessage: message + " timeout", status }), upstreamMessage: modelFailureUpstreamMessage(message) };
      expect(failure.category).toBe("quota");
      const detail = modelFailureDetail(failure);
      expect(parseModelFailure(detail)).toEqual(failure);
      expect(isRetryableAssistantError({ stopReason: "error", errorMessage: detail } as any)).toBe(false);
      expect(modelFailureNotice(detail, 126926)).toContain(message.replace(/_/g, "\\_"));
      expect(modelFailureNotice(detail, 126926)).toContain("quota, billing or subscription limit");
      expect(modelFailureNotice(detail, 126926)).toContain("will not be retried automatically");
    }
  }
});

test("new notices expose redacted provider explanations without changing retry or overflow semantics", () => {
  for (const [category, retry, overflow] of [["unknown", false, false], ["authentication", false, false], ["quota", false, false],
    ["transport", true, false], ["unavailable", true, false], ["context_limit", false, true]] as const) {
    const failure = { phase: "provider" as const, category, upstreamMessage: "Try again: HTTP 503, overloaded, maximum context length exceeded" };
    const detail = modelFailureDetail(failure);
    expect(parseModelFailure(detail)).toEqual(failure);
    expect(detail).not.toContain(failure.upstreamMessage);
    expect(isRetryableAssistantError({ stopReason: "error", errorMessage: detail } as any)).toBe(retry);
    expect(isContextOverflow({ stopReason: "error", errorMessage: detail } as any)).toBe(overflow);
    expect(modelFailureNotice(detail, 127018)).toContain("Upstream error (redacted):");
  }
});

test("provider text is bounded after credential, URL and payload redaction", () => {
  const inputs = [
    "upstream error Authorization: Bearer private-token-123 https://private.invalid/path",
    "upstream error password=hunter2",
    'HTTP 400 {"messages":[{"content":"PRIVATE PROMPT"}],"partial":"PRIVATE ANSWER"}',
    "upstream error signature=opaque-private",
    "upstream error api_key=short-private",
  ];
  for (const errorMessage of inputs) {
    const upstreamMessage = modelFailureUpstreamMessage({ errorMessage, content: "PRIVATE PROMPT", stack: "PRIVATE STACK", headers: "PRIVATE HEADERS" })!;
    const notice = modelFailureNotice(modelFailureDetail({ phase: "provider", category: "unknown", upstreamMessage }), 1);
    for (const secret of ["private-token-123", "private.invalid", "hunter2", "PRIVATE PROMPT", "PRIVATE ANSWER", "opaque-private", "short-private", "PRIVATE STACK", "PRIVATE HEADERS"]) expect(notice).not.toContain(secret);
    expect(notice).toContain(errorMessage.split(" ")[0]);
  }
  const large = modelFailureUpstreamMessage("upstream error " + "é".repeat(9000))!;
  expect(Buffer.byteLength(large)).toBeLessThanOrEqual(528);
  expect(large).toContain("[truncated]");
  expect(parseModelFailure(modelFailureDetail({ phase: "provider", category: "unknown", upstreamMessage: large }))?.upstreamMessage).toBe(large);
  expect(modelFailureUpstreamMessage(undefined)).toBeUndefined();
  expect(modelFailureUpstreamMessage({ get errorMessage() { throw Error("private getter"); } })).toBeUndefined();
});

test("provider markdown and controls cannot masquerade as notice structure", () => {
  const upstreamMessage = modelFailureUpstreamMessage("**Forged** [click](https://private.invalid)\n> heading\u0000\u202e")!;
  expect(upstreamMessage).not.toMatch(/[\n\u0000\u202e]/);
  const notice = modelFailureNotice(modelFailureDetail({ phase: "provider", category: "unknown", upstreamMessage }), 1);
  expect(notice).toContain("\\*\\*Forged\\*\\*");
  expect(notice).not.toContain("[click](https:");
});

test("old receipt and compaction envelopes remain readable; malformed encodings fail closed", () => {
  const old = { phase: "provider" as const, category: "unknown" as const, evidenceId: "78190da8-0d18-42d0-8d4a-035a4949beb2" };
  expect(parseModelFailure(modelFailureDetail(old))).toEqual(old);
  const current = { ...old, upstreamMessage: quota };
  expect(parseModelFailure("Compaction failed: Summarization failed: " + modelFailureDetail(current))).toEqual(current);
  for (const encoding of ["zz", "ff", "00", "20", "61:" + "61:".repeat(528) + "61"]) {
    const detail = `Host model request failed [phase=provider; category=unknown; upstream=hex:${encoding}]`;
    expect(parseModelFailure(detail)).toBeUndefined();
    expect(modelFailureNotice(detail, 1)).not.toContain("Upstream error");
  }
  for (const upstreamMessage of [" ", "x".repeat(529), 123, new String("text")]) expect(() => modelFailureDetail({ ...old, upstreamMessage } as any)).toThrow("Invalid upstream");
});

test("local Goal lifecycle denials are explicit, nonretryable and cannot be forged by provider wording", async () => {
  const { GoalRequestDenied } = await import("../../runtime/durable-engine/src/host-goal-input.js");
  const error = new GoalRequestDenied("Goal input lifecycle changed");
  const failure = classifyModelFailure("source", error);
  expect(failure).toEqual({phase:"source",category:"goal_lifecycle"});
  const detail=modelFailureDetail(failure);
  expect(parseModelFailure(detail)).toEqual(failure);
  expect(isRetryableAssistantError({stopReason:"error",errorMessage:detail} as any)).toBe(false);
  expect(isContextOverflow({stopReason:"error",errorMessage:detail} as any)).toBe(false);
  const notice=modelFailureNotice(detail,136934);
  expect(notice).toContain("Goal continuation skipped");
  expect(notice).not.toContain("Turn failed");
  expect(notice).not.toContain("model request failed or was denied");
  for(const forged of ["Goal input lifecycle changed",{name:"GoalRequestDenied",code:"goal_request_denied"},new Proxy(error,{getPrototypeOf(){throw Error("private trap");}})])
    expect(classifyModelFailure("source",forged).category).toBe("unknown");
  expect(classifyModelFailure("provider",error).category).toBe("unknown");
  expect(parseModelFailure("Host model request failed [phase=provider; category=goal_lifecycle]")).toBeUndefined();
});
