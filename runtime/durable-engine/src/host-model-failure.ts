import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
const phases = ["validation", "source", "admission", "provider", "conversion", "accounting"] as const;
const categories = ["aborted", "timeout", "authentication", "rate_limit", "quota", "budget", "context_limit", "transport", "unavailable", "unknown"] as const;
export type ModelFailurePhase = typeof phases[number];
export interface ModelFailure {
  phase: ModelFailurePhase;
  category: typeof categories[number];
  httpStatus?: number;
  evidenceId?: string;
}

/** Inspect private errors, but export only fixed categories and an HTTP status.
 * Never retain exception text, headers, URLs, partial output or abort reasons. */
export function classifyModelFailure(phase: ModelFailurePhase, error: unknown): ModelFailure {
  const parts: string[] = [], seen = new Set<object>();
  let status: unknown, aborted = false, node = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof node === "string") { parts.push(node); break; }
    if (!node || typeof node !== "object" || seen.has(node)) break;
    seen.add(node);
    const value = node as Record<string, unknown>;
    const read = (key: string): unknown => { try { return value[key]; } catch { return undefined; } };
    for (const key of ["errorMessage", "message", "code", "name"]) {
      const field = read(key); if (typeof field === "string" && !parts.includes(field)) parts.push(field);
    }
    aborted ||= read("name") === "AbortError" || read("stopReason") === "aborted";
    status ??= read("status") ?? read("statusCode");
    node = read("cause");
  }
  if (aborted) return { phase, category: "aborted" };
  // An omitted suffix may contain a hard quota/billing stop. Fail closed rather
  // than retrying a transient-looking prefix of an oversized diagnostic.
  if (parts.some(value => value.length > 8192) || parts.reduce((n, value) => n + value.length, 0) > 8192) return { phase, category: "unknown" };
  const text = parts.join(" ");
  if (typeof status === "string" && /^[45]\d\d$/.test(status)) status = Number(status);
  if (status === undefined) status = Number(text.match(/\bHTTP\s*:?\s*([45]\d\d)\b/i)?.[1]);
  const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
  const category = /\baborted\b/i.test(text) ? "aborted"
    : /GoUsageLimitError|FreeUsageLimitError|monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing|subscription_sharing_(?:workplace_individual_)?usage_limit_exceeded/i.test(text) ? "quota"
    : httpStatus === 401 || httpStatus === 403 || /unauthori[sz]ed|authentication|invalid.api.key|not logged in/i.test(text) ? "authentication"
    : httpStatus === 408 || httpStatus === 504 || /timed?\s*out|timeout|ETIMEDOUT/i.test(text) ? "timeout"
    : httpStatus === 429 || /rate.?limit|too many requests/i.test(text) ? "rate_limit"
    : httpStatus === 413 || /context.length|context.window|maximum context|too many tokens|prompt (?:is )?too long/i.test(text) ? "context_limit"
    : /ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|socket|connection.*(?:closed|reset)/i.test(text) ? "transport"
    : httpStatus !== undefined && isRetryableAssistantError({ stopReason: "error", errorMessage: "HTTP " + httpStatus } as AssistantMessage) ? "unavailable"
    // Reuse the pinned SDK's transient wording, but never let incidental numeric
    // identifiers match its broad bare-HTTP-code alternatives.
    : isRetryableAssistantError({ stopReason: "error", errorMessage: text.replace(/\d{3,}/g, "") } as AssistantMessage) ? "unavailable" : "unknown";
  return { phase, category, ...(httpStatus === undefined ? {} : { httpStatus }) };
}

export function modelFailureDetail(failure: ModelFailure): string {
  const evidence = failure.evidenceId;
  if (evidence !== undefined && (typeof evidence !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(evidence))) throw Error("Invalid model failure evidence ID");
  // The SDK scans the entire diagnostic for bare codes such as 503. Byte/code
  // separators keep metadata from authorising retries. The parser restores the
  // ordinary HTTP status and UUID for public notices; old receipts still parse.
  const wireEvidence = evidence?.replace(/-/g, "").match(/.{2}/g)?.join(":");
  const http = failure.httpStatus === undefined ? "" : "; http=" + String(failure.httpStatus).split("").join(":");
  const retry = failure.category === "quota" || failure.category === 'budget' ? "; retry=insufficient_quota" : failure.category === "transport" ? "; retry=connection error"
    : failure.category === "unavailable" ? "; retry=service unavailable" : "";
  const context = failure.category === "context_limit" ? "; context=maximum context length exceeded" : "";
  return `Host model request failed [phase=${failure.phase}; category=${failure.category}${http}${wireEvidence ? `; evidence=hex:${wireEvidence}` : ""}${retry}${context}]`;
}

/** Only our exact, bounded format is eligible for a public explanation. */
export function parseModelFailure(detail: unknown): ModelFailure | undefined {
  if (typeof detail !== "string") return;
  // Pinned SDK blocking compaction wraps its bounded host model error twice.
  // Accept that exact envelope once; never search arbitrary provider text.
  const compactionPrefix='Compaction failed: Summarization failed: ';
  const body=detail.startsWith(compactionPrefix)?detail.slice(compactionPrefix.length):detail;
  const match = body.match(/^Host model request failed \[phase=(\w+); category=(\w+)(?:; http=([45](?:\d\d|:\d:\d)))?(?:; evidence=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|hex:(?:[0-9a-f]{2}:){15}[0-9a-f]{2}))?(?:; retry=(connection error|service unavailable|insufficient_quota))?(?:; context=(maximum context length exceeded))?\]$/);
  if (!match || !phases.includes(match[1] as ModelFailurePhase) || !categories.includes(match[2] as ModelFailure["category"])) return;
  if (match[5] && (match[5] === "insufficient_quota" ? match[2] !== "quota" && match[2] !== 'budget' : match[5] === "connection error" ? match[2] !== "transport" : match[2] !== "unavailable")) return;
  if (match[6] && match[2] !== "context_limit") return;
  const hex = match[4]?.startsWith("hex:") ? match[4].slice(4).replace(/:/g, "") : undefined;
  const evidenceId = hex ? [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-") : match[4];
  return { phase: match[1] as ModelFailurePhase, category: match[2] as ModelFailure["category"], ...(match[3] ? { httpStatus: Number(match[3].replace(/:/g, "")) } : {}), ...(evidenceId ? { evidenceId } : {}) };
}

export function modelFailureNotice(detail: unknown, submissionId: number): string {
  const failure = parseModelFailure(detail);
  const reasons: Record<ModelFailure["category"], string> = {
    aborted: "The model request was interrupted.", timeout: "The model request timed out.",
    authentication: "Model authentication or access was rejected.", rate_limit: "The model provider rate-limited the request.",
    quota: "The provider rejected a quota, billing or subscription limit; automatic retry cannot resolve this limit.",
    budget: 'The model request was blocked by budget policy or could not be accounted safely.',
    context_limit: "The request exceeded the model's context or input limit.", transport: "The model connection failed.",
    unavailable: "The model provider was unavailable.", unknown: "The model request failed or was denied.",
  };
  const reason = failure?.category === 'budget' ? reasons.budget : failure?.phase === "accounting" ? "The model request could not be reconciled safely; its outcome may be uncertain."
    : failure?.phase === "conversion" ? "The model response could not be processed safely."
    : failure ? reasons[failure.category] : "The model request failed or was denied; the underlying reason was not recorded.";
  const retained = failure?.evidenceId ? `\n\nFailure details retained: ${failure.evidenceId}.` : "";
  const classified = failure?.phase === "accounting" ? ` Provider failure category: ${failure.category}.` : "";
  return `**Turn failed**\n\n${reason}${classified}\n\nTool actions may already have completed. Check their results before continuing; resending the whole request could repeat them. This turn will not be retried automatically.\n\nReference: native submission ${submissionId}.${retained}`;
}
