import { expect, test } from "bun:test";

import {
  formatProviderError,
  parseProviderError,
  sanitizeProviderErrorDetail,
} from "../../src/channels/web/handlers/provider-error-format.js";

test("formatProviderError recognizes output-length stop diagnostics", () => {
  const message = "Provider stopped because it hit the maximum output length before finalization (finish reason: length). The partial answer was preserved.";

  const parsed = parseProviderError(message);
  expect(parsed?.message).toContain("maximum output length");

  const formatted = formatProviderError(message);
  expect(formatted).toMatchObject({
    category: "output_limit",
    label: "output limit",
    title: "Provider output limit reached",
    severity: "warning",
  });
  expect(formatted?.detail).toContain("Ask to continue");
});

test("formatProviderError exposes orphan Responses output errors with session-repair guidance", () => {
  const raw = 'OpenAI API error (400): {"message":"No tool call found for function call output with call_id call_orphan.","code":"invalid_request_body"}';

  const formatted = formatProviderError(raw);

  expect(formatted).toMatchObject({
    category: "session_corruption",
    label: "context",
    title: "Session context needs repair",
    severity: "error",
  });
  expect(formatted?.detail).toContain("call_orphan");
  expect(formatted?.detail).toContain("/compact");
  expect(formatted?.detail).toContain("/new-session");

  const unwrapped = formatProviderError("No tool call found for function call output with call_id call_raw.");
  expect(unwrapped).toMatchObject({ category: "session_corruption", title: "Session context needs repair" });
  expect(unwrapped?.detail).toContain("call_raw");
});

test("formatProviderError does not misclassify context-length pressure as output limit", () => {
  const formatted = formatProviderError("OpenAI API error (400): maximum context length exceeded");

  expect(formatted?.category).not.toBe("output_limit");
});

test("formatProviderError gives switch-model guidance for definitive model_not_supported", () => {
  const raw = 'OpenAI API error (400): {"message":"The requested model is not supported.","code":"model_not_supported","param":"model","type":"invalid_request_error"}';

  const formatted = formatProviderError(raw);
  expect(formatted?.category).toBe("model_availability");
  expect(formatted?.detail).toContain("code: model_not_supported");
  expect(formatted?.detail).toContain("Switch to a supported model");
  expect(formatted?.detail).not.toContain("temporary provider outage");
});

test("formatProviderError keeps retry guidance for transient model outages", () => {
  const formatted = formatProviderError("400 Model not supported during GitHub provider outage");

  expect(formatted?.category).toBe("model_availability");
  expect(formatted?.detail).toContain("temporary provider outage");
  expect(formatted?.detail).not.toContain("Switch to a supported model");
});

test("formatProviderError parses API error status prefixes for Azure rate limits", () => {
  const formatted = formatProviderError(
    "Azure OpenAI API error (429): RateLimitReached. Wait about 30s before retrying."
  );

  expect(formatted).toMatchObject({
    category: "rate_limit",
  });
  expect(formatted?.detail).toContain("status: 429");
});

test("OpenRouter adaptive-budget failures retain concise requested and affordable limits", () => {
  const raw = "OpenRouter output budget rejected (HTTP 402): requested 32768 tokens; affordable 10000 tokens. The single adaptive retry was exhausted.";
  const formatted = formatProviderError(raw);

  expect(formatted).toMatchObject({
    category: "quota",
    label: "quota",
    title: "Provider quota exceeded",
  });
  expect(formatted?.detail).toContain("requested 32768 tokens; affordable 10000 tokens");
  expect(formatted?.detail.length).toBeLessThanOrEqual(900);
});

test("provider HTML error pages retain HTTP context without exposing markup or embedded data", () => {
  const raw = [
    "OAuth refresh failed for github-copilot: 502 Bad Gateway: ",
    "<!-- edge proxy response --><!DOCTYPE html><html><head><title>Unicorn! &middot; GitHub</title>",
    "<style>body { color: red; }</style></head><body>",
    `<img src="data:image/png;base64,${"A".repeat(2048)}">`,
    "</body></html>",
  ].join("");

  const sanitized = sanitizeProviderErrorDetail(raw);
  expect(sanitized).toBe("OAuth refresh failed for github-copilot: 502 Bad Gateway");
  expect(sanitized).not.toContain("<!DOCTYPE");
  expect(sanitized).not.toContain("<style>");
  expect(sanitized).not.toContain("base64");

  const formatted = formatProviderError(raw);
  expect(formatted).toMatchObject({
    category: "server",
    title: "GitHub Copilot server error",
  });
  expect(formatted?.detail).toContain("502 Bad Gateway");
  expect(formatted?.detail).not.toContain("Unicorn!");
  expect(formatted?.detail).not.toContain("base64");
});

test("provider error details omit standalone data URIs and remain bounded", () => {
  const withData = `Provider response contained data:image/png;base64,${"A".repeat(2048)}.`;
  expect(sanitizeProviderErrorDetail(withData)).toBe("Provider response contained [embedded data omitted].");

  const oversized = `Provider response: ${"x".repeat(2_000)}`;
  const sanitized = sanitizeProviderErrorDetail(oversized);
  expect(sanitized.length).toBe(900);
  expect(sanitized.endsWith("…")).toBe(true);
});

for(const field of ['code','type'] as const)test(`explicit 429 insufficient_quota ${field} outranks transient retry wording and retains request identity`,()=>{
  const raw='OpenAI API error (429): '+JSON.stringify({error:{message:'Too many requests; retry later',code:'rate_limit_exceeded',[field]:'insufficient_quota'},request_id:'req-quota-fixture-123',private_payload:'must-not-be-published'});
  const formatted=formatProviderError(raw);
  expect(formatted).toMatchObject({category:'quota',label:'quota',severity:'error',requestId:'req-quota-fixture-123'});
  expect(formatted!.detail).toContain('status: 429');expect(formatted!.detail).toContain('insufficient_quota');expect(formatted!.detail).not.toContain('must-not-be-published');
});

for(const message of ['Rate limit exceeded; retry later','Too many requests','Wait for the rate-limit window'])test(`ordinary 429 remains transient: ${message}`,()=>{
  const formatted=formatProviderError('OpenAI API error (429): '+JSON.stringify({error:{message,code:'rate_limit_exceeded'},request_id:'req-insufficient_quota-123'}));
  expect(formatted).toMatchObject({category:'rate_limit',severity:'warning',requestId:'req-insufficient_quota-123',code:'rate_limit_exceeded'});
});

test('non-JSON exhaustion remains distinguishable while malformed/HTML errors keep bounded sanitised fallback',()=>{
  expect(formatProviderError('OpenAI API error (429): insufficient_quota')?.category).toBe('quota');
  const malformed=formatProviderError('OpenAI API error (429): {not valid JSON');expect(malformed?.category).toBe('rate_limit');
  const html=formatProviderError('OpenAI API error (429): <html><script>PRIVATE_BODY</script></html>');
  expect(html?.category).toBe('rate_limit');expect(html?.detail).not.toContain('PRIVATE_BODY');expect(html?.detail).not.toContain('<script>');
});
