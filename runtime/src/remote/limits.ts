/**
 * remote/limits.ts – Defaults and rate-limit constants for remote interop.
 *
 * These values gate payload sizes, hop depth, timestamp skew tolerance, nonce
 * cache sizing, and endpoint-specific fixed-window throttling.
 */

/** Maximum accepted request body size (bytes) for prompt-like payloads. */
export const DEFAULT_MAX_PROMPT_BYTES = 32 * 1024;
/** Maximum returned response body size (bytes) for execute results. */
export const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
/** Default tool-call cap for restricted-mode remote execution. */
export const DEFAULT_MAX_TOOL_CALLS_RESTRICTED = 8;
/** Default tool-call cap for full-mode remote execution. */
export const DEFAULT_MAX_TOOL_CALLS_FULL = 32;
/** Max execution time (seconds) for restricted profile runs. */
export const DEFAULT_MAX_EXECUTION_SEC_RESTRICTED = 60;
/** Max execution time (seconds) for full profile runs. */
export const DEFAULT_MAX_EXECUTION_SEC_FULL = 180;
/** Execution timeout (ms) for restricted profile. */
export const DEFAULT_TIMEOUT_MS_RESTRICTED = DEFAULT_MAX_EXECUTION_SEC_RESTRICTED * 1000;
/** Execution timeout (ms) for full profile. */
export const DEFAULT_TIMEOUT_MS_FULL = DEFAULT_MAX_EXECUTION_SEC_FULL * 1000;
/** Maximum x-request-hop depth accepted by remote endpoints. */
export const DEFAULT_REQUEST_HOP_LIMIT = 3;
/** Allowed timestamp drift window for signed request validation. */
export const DEFAULT_TIMESTAMP_SKEW_MS = 90 * 1000;
/** Nonce TTL in milliseconds for replay protection. */
export const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;
/** Maximum nonces retained per peer in replay cache. */
export const DEFAULT_NONCE_CACHE_SIZE = 10_000;

/** Fixed window length for pair-request rate limiting. */
export const PAIR_REQUEST_WINDOW_MS = 10 * 60 * 1000;
/** Maximum pair-request attempts allowed per window. */
export const PAIR_REQUEST_LIMIT = 3;
/** Fixed window length for pair-confirm rate limiting. */
export const PAIR_CONFIRM_WINDOW_MS = 10 * 60 * 1000;
/** Maximum pair-confirm attempts allowed per window. */
export const PAIR_CONFIRM_LIMIT = 6;
/** Fixed window length for proposal endpoint rate limiting. */
export const PROPOSAL_WINDOW_MS = 60 * 1000;
/** Maximum proposal requests allowed per window. */
export const PROPOSAL_LIMIT = 12;
/** Fixed window length for ping endpoint rate limiting. */
export const PING_WINDOW_MS = 60 * 1000;
/** Maximum ping requests allowed per window. */
export const PING_LIMIT = 60;
/** Fixed window length for execute endpoint rate limiting. */
export const EXECUTE_WINDOW_MS = 60 * 1000;
/** Maximum execute requests allowed per window. */
export const EXECUTE_LIMIT = 6;
/** Fixed window length for revoke endpoint rate limiting. */
export const REVOKE_WINDOW_MS = 60 * 1000;
/** Maximum revoke requests allowed per window. */
export const REVOKE_LIMIT = 6;
/** Fixed window length for result callback rate limiting. */
export const RESULT_WINDOW_MS = 60 * 1000;
/** Maximum result callback requests allowed per window. */
export const RESULT_LIMIT = 12;
/** Fixed window length for pair-callback rate limiting. */
export const PAIR_CALLBACK_WINDOW_MS = 10 * 60 * 1000;
/** Maximum pair-callback requests allowed per window. */
export const PAIR_CALLBACK_LIMIT = 6;
