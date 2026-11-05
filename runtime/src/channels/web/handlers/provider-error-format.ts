/**
 * web/handlers/provider-error-format.ts — Parse provider error envelopes for user-visible display.
 */

import { isOrphanFunctionCallOutputError } from "../../../utils/provider-payload-errors.js";

export type ProviderErrorCategory =
  | "session_corruption"
  | "rate_limit"
  | "auth"
  | "quota"
  | "server"
  | "network"
  | "model_availability"
  | "model_config"
  | "output_limit"
  | "provider";

export type ProviderErrorSeverity = "warning" | "error" | "critical" | "info";

export interface ParsedProviderError {
  provider: string | null;
  message: string;
  type: string | null;
  code: string | null;
  status: number | null;
  requestId: string | null;
  sequenceNumber: number | null;
}

export interface ProviderErrorPresentation {
  category: ProviderErrorCategory;
  label: string;
  title: string;
  detail: string;
  severity: ProviderErrorSeverity;
  requestId: string | null;
  code: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function titleCaseProvider(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return asRecord(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function extractRequestId(text: string, parsed: Record<string, unknown>, nested: Record<string, unknown> | null): string | null {
  const explicit = readString(
    parsed.request_id,
    parsed.requestId,
    parsed["x-request-id"],
    nested?.request_id,
    nested?.requestId,
    nested?.["x-request-id"],
  );
  if (explicit) return explicit;

  const match = text.match(/\b(?:request[_ -]?id|req[_ -]?id)\s*(?:[:=]|is|ID)?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9._:-]{8,})/i);
  return match?.[1] || null;
}

const MODEL_AVAILABILITY_PATTERN = /unsupported model|model(?:\s+is)?\s+not supported|model unavailable/i;
// A transient hint means the model itself is valid but currently unreachable
// (outage/overload/capacity), so retrying the same model may succeed.
const MODEL_TRANSIENT_PATTERN = /outage|overloaded|temporarily|unavailable|capacity|try again|retry[- ]?after/i;
// A definitive rejection means the provider does not accept this model id for
// the account; retrying the same model will never succeed and the user must
// switch models.
const MODEL_DEFINITIVE_PATTERN = /model_not_supported|model_not_found|model_not_available|unknown[_ ]model|invalid model|no access to (?:this )?model|does not exist/i;

function isDefinitiveModelRejection(parsed: ParsedProviderError): boolean {
  const text = [parsed.message, parsed.type, parsed.code].filter(Boolean).join(" ");
  if (MODEL_DEFINITIVE_PATTERN.test(text)) return true;
  // A 400 invalid_request_error about the model is definitive, not transient;
  // 5xx/outage phrasing stays transient and keeps retry guidance.
  if (MODEL_TRANSIENT_PATTERN.test(text)) return false;
  return parsed.status === 400 && /invalid_request/i.test(parsed.type ?? "");
}
const OUTPUT_LIMIT_PATTERN = /finish[_ -]?reason\s*:?\s*length|stop\s*reason\s*:?\s*length|\bstopReason\s*:?\s*length|max(?:imum)? output (?:tokens?|length)|output token limit|hit (?:the )?(?:maximum )?output/i;
const NETWORK_ERROR_PATTERN = /\bENOTFOUND\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bECONNRESET\b|getaddrinfo|dns.*failed|network.*error|connection.*(?:error|refused|reset|lost|ended|closed)|websocket.*(?:closed|ended|1006)|fetch failed|socket hang up|socket connection was closed unexpectedly/i;
const HTML_RESPONSE_START_PATTERN = /<\s*(?:!doctype\s+html\b|!--|\?xml\b|html\b|head\b|body\b|title\b|meta\b|link\b|style\b|script\b|div\b|span\b|p\b|pre\b|h[1-6]\b|a\b|img\b|svg\b|main\b|section\b|header\b|footer\b|nav\b|form\b|table\b|center\b|br\b|hr\b)/i;
const PROVIDER_ERROR_INPUT_MAX_CHARS = 65_536;
const PROVIDER_ERROR_DETAIL_MAX_CHARS = 900;

function omitHtmlResponseBody(value: string): string {
  const htmlStart = value.search(HTML_RESPONSE_START_PATTERN);
  if (htmlStart < 0) return value;

  const prefix = value.slice(0, htmlStart).replace(/[\s:;–—-]+$/g, "").trim();
  return prefix || "Provider returned an HTML error page.";
}

function omitEmbeddedDataUris(value: string): string {
  const marker = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[^,\s]{1,100})*;base64\s*,/ig;
  let output = "";
  let cursor = 0;
  for (let match = marker.exec(value); match; match = marker.exec(value)) {
    output += value.slice(cursor, match.index);
    let payloadEnd = marker.lastIndex;
    while (payloadEnd < value.length && /[a-z0-9+/=\s]/i.test(value[payloadEnd])) payloadEnd += 1;
    output += "[embedded data omitted]";
    cursor = payloadEnd;
    marker.lastIndex = payloadEnd;
  }
  return output + value.slice(cursor);
}

function truncateProviderErrorDetail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeProviderErrorDetail(errorText: string | null | undefined, maxChars: number): string {
  const bounded = String(errorText || "").slice(0, PROVIDER_ERROR_INPUT_MAX_CHARS);
  const withoutHtml = omitHtmlResponseBody(bounded);
  const withoutEmbeddedData = omitEmbeddedDataUris(withoutHtml);
  const normalized = withoutEmbeddedData
    // Intentionally strip ANSI escapes and remaining ASCII control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s*For more information,?\s+pass\s+verbose:\s*true\s+in\s+the\s+second\s+argument\s+to\s+fetch\(\)\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncateProviderErrorDetail(normalized, maxChars);
}

export function sanitizeProviderErrorDetail(errorText: string | null | undefined): string {
  return normalizeProviderErrorDetail(errorText, PROVIDER_ERROR_DETAIL_MAX_CHARS);
}

function inferCategory(text: string): ProviderErrorCategory {
  if (isOrphanFunctionCallOutputError(text)) return "session_corruption";
  // Explicit exhaustion evidence outranks transient HTTP/retry wording.
  if (/\binsufficient_quota\b/i.test(text)) return "quota";
  if (/\b429\b|rate[ -]?limit|too many requests|retry-after/i.test(text)) return "rate_limit";
  // A refresh request that reaches a 5xx response is a transient provider
  // failure, not evidence that the user's OAuth credentials expired.
  if (/\b5\d\d\b|server[_ -]?error|internal[_ -]?error|bad gateway|service unavailable|gateway timeout|overloaded/i.test(text)) return "server";
  if (/authentication failed|credentials may have expired|no api key(?: found| for provider)?|token refresh failed\s*:\s*401|re-authenticate|unauthorized|\b401\b|\b403\b|invalid.*api.*key|api.*key.*invalid|token.*expired|oauth.*expired|refresh.*token/i.test(text)) return "auth";
  if (OUTPUT_LIMIT_PATTERN.test(text) && !/context(?: window| length)|maximum context length|context_length/i.test(text)) return "output_limit";
  if (/quota|usage.*limit|out of.*usage|billing|insufficient.*funds|exceeded.*limit|credit|affordable\s+\d+\s+tokens/i.test(text)) return "quota";
  if (NETWORK_ERROR_PATTERN.test(text)) return "network";
  if (/no model selected|select a model|use \/model|use \/login|model not found|deployment.*not found/i.test(text)) return "model_config";
  if (MODEL_AVAILABILITY_PATTERN.test(text)) return "model_availability";
  return "provider";
}

function titleForCategory(category: ProviderErrorCategory, provider: string | null, detail = ""): string {
  const prefix = provider ? `${provider} ` : "Provider ";
  switch (category) {
    case "session_corruption":
      return "Session context needs repair";
    case "rate_limit":
      return `${prefix}rate limit`;
    case "auth":
      return `${prefix}authentication failed`;
    case "quota":
      return `${prefix}quota exceeded`;
    case "server":
      return `${prefix}server error`;
    case "network":
      if (/ECONNRESET|connection.*(?:reset|ended|closed)|websocket.*(?:closed|ended|1006)|socket hang up|socket connection was closed unexpectedly/i.test(detail)) {
        return `${prefix}connection closed`;
      }
      if (/ETIMEDOUT|timed? out|timeout/i.test(detail)) return `${prefix}connection timed out`;
      if (/ECONNREFUSED|connection.*refused/i.test(detail)) return `${prefix}connection refused`;
      if (/ENOTFOUND|getaddrinfo|dns/i.test(detail)) return `${prefix}DNS lookup failed`;
      return `${prefix}network error`;
    case "model_availability":
      return provider ? `${provider} model unavailable` : "Model unavailable";
    case "model_config":
      return "Model configuration error";
    case "output_limit":
      return provider ? `${provider} output limit reached` : "Provider output limit reached";
    default:
      return `${prefix}error`;
  }
}

function labelForCategory(category: ProviderErrorCategory): string {
  switch (category) {
    case "session_corruption":
      return "context";
    case "rate_limit":
      return "rate limit";
    case "auth":
      return "provider auth";
    case "quota":
      return "quota";
    case "server":
      return "provider";
    case "network":
      return "network";
    case "model_availability":
    case "model_config":
      return "model";
    case "output_limit":
      return "output limit";
    default:
      return "provider";
  }
}

function severityForCategory(category: ProviderErrorCategory): ProviderErrorSeverity {
  return category === "rate_limit" || category === "server" || category === "model_availability" || category === "output_limit"
    ? "warning"
    : "error";
}

function networkGuidance(message: string): string | null {
  if (/ECONNRESET|connection.*(?:reset|ended|closed)|websocket.*(?:closed|ended|1006)|socket hang up|socket connection was closed unexpectedly/i.test(message)) {
    return "The provider dropped the streaming connection before the turn completed. Retry the message; if it repeats, switch provider/model or check provider status.";
  }
  if (/ETIMEDOUT|timed? out|timeout/i.test(message)) {
    return "The provider did not respond in time. Retry shortly; if it repeats, check provider status or network connectivity.";
  }
  if (/ECONNREFUSED|connection.*refused/i.test(message)) {
    return "The provider endpoint refused the connection. Check the provider URL, proxy, firewall, or provider status.";
  }
  if (/ENOTFOUND|getaddrinfo|dns/i.test(message)) {
    return "The provider hostname could not be resolved. Check DNS, provider URL, proxy settings, or network connectivity.";
  }
  if (/fetch failed/i.test(message)) {
    return "The request did not reach the provider successfully. Check provider URL, proxy settings, or network connectivity.";
  }
  return null;
}

function buildDetail(parsed: ParsedProviderError): string {
  const details: string[] = [];
  const message = sanitizeProviderErrorDetail(parsed.message);
  if (message) details.push(message);

  const metadata: string[] = [];
  if (parsed.code) metadata.push(`code: ${parsed.code}`);
  if (parsed.type && parsed.type !== parsed.code) metadata.push(`type: ${parsed.type}`);
  if (parsed.status) metadata.push(`status: ${parsed.status}`);
  if (parsed.requestId) metadata.push(`request id: ${parsed.requestId}`);
  if (parsed.sequenceNumber !== null) metadata.push(`sequence: ${parsed.sequenceNumber}`);
  if (metadata.length > 0) details.push(metadata.join("; "));

  return details.join(" — ").slice(0, 900);
}

function inferProviderFromRawText(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("github-copilot") || lower.includes("github copilot") || lower.includes("github provider")) return "GitHub Copilot";
  if (lower.includes("openai-codex") || lower.includes(" codex ") || lower.startsWith("codex ")) return "Codex";
  if (lower.includes("anthropic")) return "Anthropic";
  if (lower.includes("openai")) return "OpenAI";
  return null;
}

export function parseProviderError(errorText: string | null | undefined): ParsedProviderError | null {
  const raw = normalizeProviderErrorDetail(errorText, PROVIDER_ERROR_INPUT_MAX_CHARS);
  if (!raw) return null;

  const prefixMatch = raw.match(/^([A-Za-z][A-Za-z0-9 ._-]{1,40})\s+(?:api\s+)?error(?:\s*\(([45]\d\d)\))?\s*:/i);
  const parsed = extractJsonObject(raw);
  const isModelAvailabilityOnly = MODEL_AVAILABILITY_PATTERN.test(raw);
  const isNetworkOnly = NETWORK_ERROR_PATTERN.test(raw);
  const isHttpFailureOnly = /\b[45]\d\d\b|bad gateway|service unavailable|gateway timeout/i.test(raw);
  const isOutputLimitOnly = OUTPUT_LIMIT_PATTERN.test(raw) && !/context(?: window| length)|maximum context length|context_length/i.test(raw);
  const isSessionCorruptionOnly = isOrphanFunctionCallOutputError(raw);
  if (!parsed && !prefixMatch && !isModelAvailabilityOnly && !isNetworkOnly && !isHttpFailureOnly && !isOutputLimitOnly && !isSessionCorruptionOnly) return null;

  const nested = asRecord(parsed?.error) || asRecord(parsed?.errors) || null;
  const message = readString(nested?.message, parsed?.message, nested?.error, parsed?.error_description, parsed?.detail)
    || (prefixMatch && !parsed ? raw.slice(prefixMatch[0].length).trim() : null)
    || raw;
  const provider = titleCaseProvider(
    prefixMatch?.[1]
      || readString(parsed?.provider, parsed?.provider_id, nested?.provider)
      || inferProviderFromRawText(raw)
  );
  const code = readString(nested?.code, parsed?.code, nested?.error_code, parsed?.error_code);
  const type = readString(nested?.type, parsed?.type, nested?.error, parsed?.error);
  const statusFromRaw = raw.match(/\b([45]\d\d)\b/)?.[1];
  const status = readNumber(nested?.status, nested?.status_code, parsed?.status, parsed?.status_code, prefixMatch?.[2], statusFromRaw);
  const requestId = parsed ? extractRequestId(raw, parsed, nested) : extractRequestId(raw, {}, null);
  const sequenceNumber = readNumber(parsed?.sequence_number, parsed?.sequenceNumber, nested?.sequence_number, nested?.sequenceNumber);

  return {
    provider,
    message,
    type,
    code,
    status,
    requestId,
    sequenceNumber,
  };
}

export function formatProviderError(errorText: string | null | undefined): ProviderErrorPresentation | null {
  const parsed = parseProviderError(errorText);
  if (!parsed) return null;

  const classificationText = [
    parsed.message,
    parsed.type,
    parsed.code,
    parsed.status ? String(parsed.status) : "",
  ].filter(Boolean).join(" ");
  const category = inferCategory(classificationText || parsed.message);

  let detail = buildDetail(parsed);
  if (category === "session_corruption") {
    const guidance = "Run /compact to rewrite the session context. If the repaired session still fails, use /new-session to start fresh.";
    detail = [detail, guidance].filter(Boolean).join(" — ").slice(0, 900);
  }
  if (category === "network") {
    const guidance = networkGuidance(parsed.message);
    detail = [detail, guidance].filter(Boolean).join(" — ").slice(0, 900);
  }
  if (category === "model_availability") {
    const guidance = isDefinitiveModelRejection(parsed)
      ? "The provider does not accept this model id for your account. Switch to a supported model (use /model or switch_model); retrying the same model will not help."
      : "This may be a temporary provider outage even when your model is valid. Retry shortly or switch provider/model.";
    detail = [detail, guidance].filter(Boolean).join(" — ").slice(0, 900);
  }
  if (category === "output_limit") {
    const guidance = "The model stopped after reaching its maximum output length. Ask to continue, increase max output tokens, or switch to a model with a larger output budget.";
    detail = [detail, guidance].filter(Boolean).join(" — ").slice(0, 900);
  }

  return {
    category,
    label: labelForCategory(category),
    title: titleForCategory(category, parsed.provider, detail || parsed.message),
    detail,
    severity: severityForCategory(category),
    requestId: parsed.requestId,
    code: parsed.code,
  };
}
