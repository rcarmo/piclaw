/**
 * web/request-router-service.ts – HTTP request dispatcher and security layer.
 *
 * Handles all incoming HTTP requests for the web channel:
 *   - Applies security headers (CSP, HSTS, X-Frame-Options, etc.) to every response
 *   - Enforces TOTP / WebAuthn authentication when configured
 *   - Validates CSRF Origin on all state-changing (POST/PUT/DELETE/PATCH) requests
 *   - Rate-limits auth endpoints (brute-force protection) and data endpoints
 *     (posts, uploads, deletes, workspace writes)
 *   - Auth-gates app bundles; only fonts, static images, and login bundles
 *     are served to unauthenticated visitors
 *   - Routes requests to the appropriate handler (posts, media, workspace,
 *     agent control, SSE streaming, static files)
 *
 * Security architecture:
 *   1. rememberWebOrigin (tracking)
 *   2. Auth rate limiting (auth/verify, WebAuthn login/enrol)
 *   3. Session auth check (TOTP/WebAuthn cookie)
 *   4. CSRF Origin validation (state-changing methods, exempt: auth endpoints)
 *   5. Data rate limiting (posts, uploads, deletes, writes)
 *   6. Route to handler
 *   7. withSecurityHeaders() wraps the final response
 *
 * Consumers: channels/web.ts delegates each request to handle().
 */

import { extname, resolve } from "path";
import { createUuid } from "../../utils/ids.js";
import type { WebChannelLike } from "./core/web-channel-contracts.js";
import { rememberWebOrigin } from "./auth/request-origin.js";
import { handleAgentRoutes } from "./http/dispatch-agent.js";
import { handleAuthRoutes } from "./http/dispatch-auth.js";
import { handleContentPrimaryRoutes, handleContentSecondaryRoutes } from "./http/dispatch-content.js";
import { handleMediaRoutes } from "./http/dispatch-media.js";
import { handleShellRoutes } from "./http/dispatch-shell.js";
import { handleWorkspaceRoutes } from "./http/dispatch-workspace.js";
import "./http/editor-vendor-route.js";
import "./http/csv-viewer-route.js";
import "./http/image-viewer-route.js";
import "./http/video-viewer-route.js";
import "./http/pdf-viewer-route.js";
import "./http/html-viewer-route.js";
import { handleExtensionRoutes } from "./http/extension-routes.js";
import { enforceRequestGuards } from "./http/request-guards.js";
import { getRouteFlags } from "./http/route-flags.js";
import { withSecurityHeaders } from "./http/security.js";
import { appendServerTiming, measureAsync } from "./http/server-timing.js";

const STATIC_DIR = resolve(import.meta.dir, "..", "..", "..", "..", "web", "static");
const STATIC_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/manifest+json; charset=utf-8",
};

/** Business logic for handling compose-box submissions and agent runs. */
export class RequestRouterService {
  constructor(private channel: WebChannelLike) {}

  private async serveStaticAsset(req: Request, relPath: string): Promise<Response> {
    const filePath = resolve(STATIC_DIR, relPath);

    if (!filePath.startsWith(STATIC_DIR)) {
      return this.channel.json({ error: "Not found" }, 404);
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return this.channel.json({ error: "Not found" }, 404);
    }

    const size = file.size ?? 0;
    const contentType = STATIC_MIME_TYPES[extname(filePath)] || "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    };

    if (req.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    return new Response(file, { status: 200, headers });
  }

  /**
   * Main entry point for all HTTP requests.
   * Delegates to route() for path dispatch, then wraps the response
   * with security headers (CSP, HSTS, X-Frame-Options, etc.).
   */
  async handle(req: Request): Promise<Response> {
    const requestId = createUuid("req");
    const { result: response, durationMs } = await measureAsync(() => this.route(req));
    // Determine TLS from the request URL scheme to conditionally add HSTS
    const isTls = req.url.startsWith("https://");
    const secured = withSecurityHeaders(response, isTls);
    secured.headers.set("x-request-id", requestId);
    appendServerTiming(secured, {
      name: "app",
      durationMs,
    });
    return secured;
  }

  /**
   * Internal request router. Processes the request through the security
   * pipeline (auth → CSRF → rate limiting) and dispatches to the
   * appropriate handler. See the module-level JSDoc for the full pipeline.
   */
  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/remote/")) {
      return await this.channel.handleRemote(req);
    }

    // Track the last seen origin so slash commands can build absolute links.
    rememberWebOrigin("web:default", req);

    const flags = getRouteFlags(req, pathname);
    const guardResponse = await enforceRequestGuards(this.channel, req, pathname, flags);
    if (guardResponse) {
      return guardResponse;
    }

    const authRouteResponse = await handleAuthRoutes(this.channel, req, flags);
    if (authRouteResponse) {
      return authRouteResponse;
    }

    const shellResponse = await handleShellRoutes(
      this.channel,
      req,
      pathname,
      flags,
      this.serveStaticAsset.bind(this)
    );
    if (shellResponse) {
      return shellResponse;
    }

    const primaryContentResponse = await handleContentPrimaryRoutes(this.channel, req, pathname, url);
    if (primaryContentResponse) {
      return primaryContentResponse;
    }

    const workspaceResponse = await handleWorkspaceRoutes(this.channel, req, pathname);
    if (workspaceResponse) {
      return workspaceResponse;
    }

    const agentResponse = await handleAgentRoutes(this.channel, req, pathname, url);
    if (agentResponse) {
      return agentResponse;
    }

    const secondaryContentResponse = await handleContentSecondaryRoutes(this.channel, req, pathname, url);
    if (secondaryContentResponse) {
      return secondaryContentResponse;
    }

    const mediaResponse = await handleMediaRoutes(this.channel, req, pathname);
    if (mediaResponse) {
      return mediaResponse;
    }

    const extensionRouteResponse = await handleExtensionRoutes(req, pathname);
    if (extensionRouteResponse) {
      return extensionRouteResponse;
    }

    return this.channel.json({ error: "Not found" }, 404);
  }
}
