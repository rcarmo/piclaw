/**
 * web/http/dispatch-auth.ts – WebAuthn/TOTP auth route dispatch helpers.
 */

import {
  handleWebauthnEnrollPageEndpoint,
  handleWebauthnLoginFinishEndpoint,
  handleWebauthnLoginStartEndpoint,
  handleWebauthnRegisterFinishEndpoint,
  handleWebauthnRegisterStartEndpoint,
  redirectToLoginResponse,
  type AuthEndpointsContext,
} from "../auth/auth-endpoints.js";
import { randomSessionToken } from "../auth/auth.js";
import { buildSessionCookieHeader } from "../auth/session-auth.js";
import { isInternalSecretRequestAuthorized } from "../auth/internal-secret.js";
import { getWebRuntimeConfig } from "../../../core/config.js";
import { createWebSession, DEFAULT_WEB_USER_ID } from "../../../db.js";
import type { RouteFlags } from "./route-flags.js";

const E2E_BOOTSTRAP_TTL_SECONDS = 10 * 60;

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function handleE2eBootstrapEndpoint(req: Request): Response {
  const config = getWebRuntimeConfig();
  const url = new URL(req.url);
  if (!isLoopbackHostname(url.hostname)) {
    return new Response(JSON.stringify({ error: "Loopback access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (!config.internalSecret.trim() || !isInternalSecretRequestAuthorized(req, config.internalSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const ttlSeconds = Math.max(60, Math.min(config.sessionTtl || E2E_BOOTSTRAP_TTL_SECONDS, E2E_BOOTSTRAP_TTL_SECONDS));
  const sessionToken = randomSessionToken();
  const session = createWebSession(sessionToken, DEFAULT_WEB_USER_ID, ttlSeconds, "e2e");
  const setCookie = buildSessionCookieHeader(sessionToken, req, ttlSeconds, req.url.startsWith("https://"));

  return new Response(JSON.stringify({
    ok: true,
    auth_method: session.auth_method,
    expires_at: session.expires_at,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": setCookie,
    },
  });
}

/** Channel contract required by auth-route HTTP dispatcher. */
export interface AuthDispatchChannel {
  /** Auth gateway methods required to validate pre-enrolment TOTP session state. */
  authGateway: {
    /** Check whether the request currently has a valid temporary TOTP-authenticated session. */
    isTotpSession(req: Request): boolean;
  };
  /** Endpoint-context factory for shared auth endpoint dependencies. */
  endpointContexts: {
    /** Build auth endpoint context used by WebAuthn route handlers. */
    auth(): AuthEndpointsContext;
  };
  /** Build JSON responses for auth-route validation failures. */
  json(payload: unknown, status?: number): Response;
}

/**
 * Dispatch WebAuthn auth routes and return null when no auth route matches.
 * @param channel Auth dispatcher contract exposing session checks and endpoint contexts.
 * @param req Incoming HTTP request.
 * @param flags Precomputed route flags for auth endpoint classification.
 * @returns Matched auth response, or null when the request is not handled here.
 */
export async function handleAuthRoutes(
  channel: AuthDispatchChannel,
  req: Request,
  flags: RouteFlags
): Promise<Response | null> {
  if (flags.isWebauthnEnrollPage) {
    if (!channel.authGateway.isTotpSession(req)) {
      if (flags.isGetOrHead) {
        return redirectToLoginResponse();
      }
      return channel.json({ error: "TOTP session required" }, 401);
    }
    return await handleWebauthnEnrollPageEndpoint(channel.endpointContexts.auth());
  }

  if (flags.isE2eBootstrap) {
    return handleE2eBootstrapEndpoint(req);
  }

  if (flags.isWebauthnLoginStart) {
    return await handleWebauthnLoginStartEndpoint(req, channel.endpointContexts.auth());
  }

  if (flags.isWebauthnLoginFinish) {
    return await handleWebauthnLoginFinishEndpoint(req, channel.endpointContexts.auth());
  }

  if (flags.isWebauthnRegisterStart) {
    return await handleWebauthnRegisterStartEndpoint(req, channel.endpointContexts.auth());
  }

  if (flags.isWebauthnRegisterFinish) {
    return await handleWebauthnRegisterFinishEndpoint(req, channel.endpointContexts.auth());
  }

  return null;
}
