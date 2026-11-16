/**
 * utils/secret-redaction.ts – Recursive credential redaction for diagnostic evidence.
 */

const SECRET_KEY_PATTERN = /(?:secret|token|password|authorization|api[_-]?key|access[_-]?key|refresh[_-]?token|private[_-]?key|credential|cookie|session|set-cookie|x-api-key|passphrase)/i;
const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[redacted-github-token]"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted-api-key]"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "[redacted-authorization]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-jwt]"],
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[redacted-secret-like]"],
  [/data:[^;\s]+;base64,[A-Za-z0-9+/=]{64,}/gi, "[redacted-data-url]"],
];
const DEFAULT_MAX_STRING_LENGTH = 12_000;

function redactString(value: string, maxLength: number): string {
  let next = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) next = next.replace(pattern, replacement);
  return next.length > maxLength ? `${next.slice(0, maxLength)}\n[truncated ${next.length - maxLength} chars]` : next;
}

function visit(value: unknown, key: string, maxLength: number): unknown {
  if (typeof value === "string") return SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactString(value, maxLength);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => visit(item, key, maxLength));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, visit(entryValue, entryKey, maxLength)]));
  }
  return String(value);
}

/** Replace credential-like values and secret-named string fields; truncate long strings. */
export function redactSecrets(value: unknown, options: { maxStringLength?: number } = {}): unknown {
  return visit(value, "", options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH);
}
