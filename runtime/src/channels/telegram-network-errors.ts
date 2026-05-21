const RECOVERABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_ABORTED",
  "ECONNABORTED",
  "ERR_NETWORK",
]);

function normalizeCode(code?: string): string {
  return code?.trim().toUpperCase() ?? "";
}

export function isRecoverableTelegramNetworkError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { code?: string; name?: string; message?: string; cause?: unknown };
  const code = normalizeCode(anyErr.code);
  if (code && RECOVERABLE_ERROR_CODES.has(code)) return true;
  const message = String(anyErr.message || "").toLowerCase();
  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return true;
  }
  if (anyErr.cause && anyErr.cause !== err) return isRecoverableTelegramNetworkError(anyErr.cause);
  return false;
}
