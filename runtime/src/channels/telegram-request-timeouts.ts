const TELEGRAM_GET_UPDATES_REQUEST_TIMEOUT_MS = 45_000;
const TELEGRAM_DEFAULT_LONG_POLL_TIMEOUT_SECONDS = 30;
const TELEGRAM_LONG_POLL_ABORT_MARGIN_SECONDS = 5;

export function resolveTelegramLongPollTimeoutSeconds(timeoutSeconds: unknown): number {
  const maxLongPollTimeoutSeconds = Math.max(
    1,
    Math.floor(TELEGRAM_GET_UPDATES_REQUEST_TIMEOUT_MS / 1000) - TELEGRAM_LONG_POLL_ABORT_MARGIN_SECONDS,
  );
  const configuredTimeoutSeconds =
    typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds)
      ? Math.max(1, Math.floor(timeoutSeconds))
      : TELEGRAM_DEFAULT_LONG_POLL_TIMEOUT_SECONDS;
  return Math.min(configuredTimeoutSeconds, maxLongPollTimeoutSeconds);
}
