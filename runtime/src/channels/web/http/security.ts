/**
 * web/http/security.ts – Shared web security helpers.
 */

import { getRequestOriginParts } from "./client.js";

function normalizePort(proto: string, port: string): string {
  if (port) return port;
  return proto === "https" ? "443" : proto === "http" ? "80" : "";
}

function parseHost(proto: string, host: string): { hostname: string; port: string } | null {
  try {
    const url = new URL(`${proto}://${host}`);
    return { hostname: url.hostname.toLowerCase(), port: normalizePort(proto, url.port) };
  } catch {
    return null;
  }
}

function matchesOriginCandidate(
  originUrl: URL,
  expectedProto: string,
  expectedHost: string
): boolean {
  const expected = parseHost(expectedProto, expectedHost);
  if (!expected) return false;

  const originProto = originUrl.protocol.replace(":", "").toLowerCase();
  const originHostname = originUrl.hostname.toLowerCase();
  const originPort = normalizePort(originProto, originUrl.port);

  if (originProto === expectedProto && originHostname === expected.hostname && originPort === expected.port) {
    return true;
  }

  // TLS termination fallback: browser sees https://host while the app sees
  // an internal http://host hop behind a reverse proxy. Keep this scoped to
  // same-host comparisons only.
  return (
    originProto === "https" &&
    expectedProto === "http" &&
    originHostname === expected.hostname &&
    originPort === normalizePort("https", expected.port === "80" ? "" : expected.port)
  );
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  // Cross-origin isolation headers (COOP/COEP) are NOT set globally.
  // COEP require-corp blocks cross-origin iframes that don't send CORP
  // headers (e.g., draw.io embed, external widgets). Extensions needing
  // SharedArrayBuffer (e.g., office-viewer for Emscripten pthreads)
  // set their own COOP/COEP on their route responses.
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' https: http: data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; " +
    "frame-src 'self'; " +
    "frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};

/** Only Classic reads agent-authored media; other documents retain the default policy. */
export const CLASSIC_CONTENT_SECURITY_POLICY = `${SECURITY_HEADERS["Content-Security-Policy"]}; media-src 'self' https: http: data:`;

/**
 * Clone a response and append baseline security headers when absent.
 * @param response Source response to wrap.
 * @param isTls Whether the request arrived over TLS (controls HSTS header injection).
 * @returns Response with baseline security headers applied.
 */
export function withSecurityHeaders(response: Response, isTls: boolean): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  if (isTls && !headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Validate CSRF origin headers for state-changing requests.
 * Allows requests without `Origin` (non-browser clients), blocks `Origin: null`,
 * and supports TLS-terminating reverse proxies via forwarded-origin candidates.
 * @param req Incoming HTTP request to validate.
 * @returns True when origin is acceptable for mutation requests; otherwise false.
 */
export function checkCsrfOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;

  try {
    const originUrl = new URL(origin);
    const candidates = [getRequestOriginParts(req, false), getRequestOriginParts(req, true)]
      .filter((candidate) => candidate.host)
      .map((candidate) => ({ proto: candidate.proto.toLowerCase(), host: candidate.host }));

    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.proto}://${candidate.host}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (matchesOriginCandidate(originUrl, candidate.proto, candidate.host)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Build a JSON 429 response for rate-limited requests.
 * @param message Error message returned to the client.
 * @returns HTTP 429 response with JSON body.
 */
export function rateLimitResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });
}
