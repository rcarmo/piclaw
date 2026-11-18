/**
 * web/http/request-guards.ts – Auth/CSRF/rate-limit pre-dispatch guards.
 */

import { admitAddonLocalRequest } from "../../../addons/local-context.js";
import type { AuthenticatedPrincipal as WebPrincipal } from "../../../core/access-types.js";
import {
  handleAuthVerifyEndpoint,
  redirectToLoginResponse,
  serveLoginPageResponse,
  type AuthEndpointsContext,
} from "../auth/auth-endpoints.js";
import { getClientKey } from "./client.js";
import { isRateLimited } from "./rate-limit.js";
import {
  AUTH_RATE_LIMIT,
  AUTH_RATE_WINDOW_MS,
  DATA_RATE_WINDOW_MS,
  ENROLL_RATE_LIMIT,
  ENROLL_RATE_WINDOW_MS,
  getDataRateLimitRule,
} from "./rate-limit-rules.js";
import { type RouteFlags, shouldSkipAuthCheck } from "./route-flags.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.request-guards");

/** Channel contract required by HTTP request guard helpers. */
export interface RequestGuardsChannel {
  /** Auth state gateway used to evaluate session and internal-secret access rules. */
  authGateway: {
    /** Whether web auth is currently enabled. */
    isAuthEnabled(): boolean;
    /** Whether internal-secret bypass checks are enabled. */
    isInternalSecretEnabled(): boolean;
    /** Validate internal-secret access for this request. */
    verifyInternalSecret(req: Request): boolean;
    /** Validate whether the request has an authenticated user session. */
    isAuthenticated(req: Request): boolean;
    getPrincipal?(req: Request, refresh?: boolean): WebPrincipal | null;
    preparePrincipal?(req: Request): Promise<void>;
  };
  /** Endpoint contexts used by auth verify/login route helpers. */
  endpointContexts: {
    /** Build auth endpoint dependencies for login/verify helpers. */
    auth(): AuthEndpointsContext;
  };
  /** Build a JSON response envelope for guard failures. */
  json(payload: unknown, status?: number): Response;
}

/**
 * Apply auth, CSRF, and rate-limit guard checks before route dispatch.
 * @param channel Request-guard channel contract for auth state and JSON responses.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname used for guard routing decisions.
 * @param flags Precomputed route flags for auth/public/mutating endpoint detection.
 * @returns A blocking response when a guard fails, or null when dispatch may continue.
 */
export async function enforceRequestGuards(
  channel: RequestGuardsChannel,
  req: Request,
  pathname: string,
  flags: RouteFlags
): Promise<Response | null> {
  const authEnabled = channel.authGateway.isAuthEnabled();
  const internalSecretEnabled = channel.authGateway.isInternalSecretEnabled();
  const hasInternalAccess = internalSecretEnabled && channel.authGateway.verifyInternalSecret(req);

  if (flags.isInternalPost) {
    if (internalSecretEnabled && !hasInternalAccess) {
      log.warn("Internal secret required", {
        operation: "web_request_guards.internal_secret_required",
        clientKey: getClientKey(req),
        method: req.method,
        path: pathname,
      });
      return channel.json({ error: "Unauthorized" }, 401);
    }
  }

  if (!authEnabled && flags.isAuthVerify) {
    return channel.json({ error: "Auth disabled" }, 404);
  }

  if (flags.isAuthVerify) {
    if (isRateLimited(req, "auth/verify", AUTH_RATE_WINDOW_MS, AUTH_RATE_LIMIT)) {
      log.warn("Auth verify rate limit exceeded", {
        operation: "web_request_guards.auth_verify_rate_limit",
        clientKey: getClientKey(req),
        endpoint: "/auth/verify",
      });
      return channel.json({ error: "Too many login attempts. Try again later." }, 429);
    }
  }

  if (flags.isWebauthnLoginStart || flags.isWebauthnLoginFinish) {
    if (isRateLimited(req, "webauthn/login", AUTH_RATE_WINDOW_MS, AUTH_RATE_LIMIT)) {
      log.warn("WebAuthn login rate limit exceeded", {
        operation: "web_request_guards.webauthn_login_rate_limit",
        clientKey: getClientKey(req),
        endpoint: "webauthn/login",
      });
      return channel.json({ error: "Too many login attempts. Try again later." }, 429);
    }
  }

  if (flags.isWebauthnEnrollPage || flags.isWebauthnRegisterStart || flags.isWebauthnRegisterFinish) {
    if (isRateLimited(req, "webauthn/enrol", ENROLL_RATE_WINDOW_MS, ENROLL_RATE_LIMIT)) {
      log.warn("WebAuthn enrol rate limit exceeded", {
        operation: "web_request_guards.webauthn_enrol_rate_limit",
        clientKey: getClientKey(req),
        endpoint: "webauthn/enrol",
      });
      return channel.json({ error: "Too many enrol attempts. Try again later." }, 429);
    }
  }

  await channel.authGateway.preparePrincipal?.(req);
  const skipAuthCheck = shouldSkipAuthCheck(flags, hasInternalAccess);

  if (authEnabled) {
    if (flags.isAuthVerify) {
      return await handleAuthVerifyEndpoint(req, channel.endpointContexts.auth());
    }

    if (flags.isLoginPage) {
      return await serveLoginPageResponse(channel.endpointContexts.auth(), req);
    }

    if (!skipAuthCheck && !channel.authGateway.isAuthenticated(req)) {
      log.warn("Unauthorized request", {
        operation: "web_request_guards.unauthorized_request",
        clientKey: getClientKey(req),
        method: req.method,
        path: pathname,
      });
      if (flags.isIndex) {
        return await serveLoginPageResponse(channel.endpointContexts.auth(), req);
      }
      if (flags.isGetOrHead) {
        return redirectToLoginResponse();
      }
      return channel.json({ error: "Unauthorized" }, 401);
    }
  } else if (flags.isLoginPage) {
    return channel.json({ error: "Not found" }, 404);
  }

  if (flags.isMutating && !hasInternalAccess && !flags.isAuthEndpoint) {
    if (!checkCsrfOrigin(req)) {
      log.warn("CSRF origin check failed", {
        operation: "web_request_guards.csrf_origin_check_failed",
        clientKey: getClientKey(req),
        origin: req.headers.get("origin"),
      });
      return channel.json({ error: "Origin not allowed" }, 403);
    }
  }

  if ((flags.isMutating || req.method === "GET" && pathname === "/agent/settings/mcp") && !hasInternalAccess) {
    const dataRule = getDataRateLimitRule(req.method, pathname);
    if (dataRule && isRateLimited(req, dataRule.bucket, DATA_RATE_WINDOW_MS, dataRule.limit)) {
      return rateLimitResponse(dataRule.message);
    }
  }

  // Only the actual guarded Request receives local add-on authority. Internal
  // transport calls and client-supplied IDs cannot manufacture this admission.
  const localConfiguration = pathname.startsWith('/agent/addons/api/') || pathname === '/agent/settings/mcp' || pathname.startsWith('/agent/settings/mcp/');
  if (!hasInternalAccess && localConfiguration) {
    const principal = channel.authGateway.getPrincipal?.(req) ?? null;
    admitAddonLocalRequest(req, principal, () => {
      const current = channel.authGateway.getPrincipal?.(req, true);
      return Boolean(current && current.userId === principal?.userId && current.kind === principal?.kind
        && current.role === principal?.role && current.mode === principal?.mode
        && current.authentication.sessionId === principal?.authentication.sessionId
        && current.authentication.method === principal?.authentication.method
        && current.authentication.expiresAt === principal?.authentication.expiresAt);
    });
  }
  return null;
}
