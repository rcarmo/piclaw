/**
 * extension-routes.ts — Registry for extension-registered HTTP routes.
 *
 * Allows piclaw extensions (both built-in and workspace) to serve custom
 * HTTP endpoints from within the same process. Routes are keyed by path
 * prefix and dispatched before the 404 fallback in the request router.
 *
 * Use cases:
 *   - Serve WASM builds with COOP/COEP headers
 *   - Custom webhooks / API endpoints
 *   - Static asset serving with custom caching / headers
 *
 * Security: Routes are served *after* authentication checks, so only
 * authenticated users can access them. Extensions must sanitise paths
 * against traversal attacks themselves.
 */

import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.extension-routes");

/**
 * Extension-provided HTTP handler invoked for matching route prefixes.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname.
 * @returns A response to short-circuit routing, or null to allow fallback handling.
 */
export type ExtensionRouteHandler = (req: Request, pathname: string) => Response | Promise<Response> | null;

interface RegisteredRoute {
  prefix: string;
  handler: ExtensionRouteHandler;
  extensionPath: string;
}

const routes: RegisteredRoute[] = [];

/**
 * Register an extension HTTP route handler for a path prefix.
 * @param prefix Path prefix to match (normalized to begin with `/`).
 * @param handler Extension route callback invoked for matching requests.
 * @param extensionPath Extension identifier/path used for diagnostics.
 * @returns Nothing.
 */
export function registerExtensionRoute(
  prefix: string,
  handler: ExtensionRouteHandler,
  extensionPath: string
): "created" | "updated" {
  // Normalise: ensure prefix starts with /
  const normalised = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const existing = routes.find((route) => route.prefix === normalised && route.extensionPath === extensionPath);
  if (existing) {
    existing.handler = handler;
    log.debug("Updated existing extension route registration", {
      prefix: normalised,
      extensionPath,
    });
    return "updated";
  }
  routes.push({ prefix: normalised, handler, extensionPath });
  return "created";
}

/**
 * Attempt to serve a request via registered extension routes.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname.
 * @returns A matched extension response, or null when no route handled the request.
 */
export async function handleExtensionRoutes(
  req: Request,
  pathname: string
): Promise<Response | null> {
  // Route introspection endpoint
  if (req.method === "GET" && pathname === "/api/extension-routes") {
    return new Response(JSON.stringify(getRegisteredRoutes()), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  for (const route of routes) {
    if (pathname === route.prefix || pathname.startsWith(route.prefix + "/") || pathname.startsWith(route.prefix + "?")) {
      try {
        const result = route.handler(req, pathname);
        const response = result instanceof Promise ? await result : result;
        if (response) return response;
      } catch (error) {
        log.error("Extension route handler failed", {
          operation: "web_extension_routes.handle_registered_route",
          prefix: route.prefix,
          extensionPath: route.extensionPath,
          err: error,
        });
        return new Response("Internal Server Error", { status: 500 });
      }
    }
  }
  return null;
}

/**
 * Remove all registered extension routes (used during extension reload).
 * @returns Nothing.
 */
export function clearExtensionRoutes(): void {
  routes.length = 0;
}

/**
 * Return the currently registered extension route prefixes for diagnostics.
 * @returns A lightweight route listing with prefix and owning extension path.
 */
export function getRegisteredRoutes(): Array<{ prefix: string; extensionPath: string }> {
  return routes.map(r => ({ prefix: r.prefix, extensionPath: r.extensionPath }));
}

/**
 * Expose registerExtensionRoute on globalThis so workspace extensions
 * (loaded via jiti) can call it without direct imports.
 *
 * This runs as a module side-effect when request-router-service.ts
 * imports this module — i.e., at web server startup, BEFORE any
 * session/extension creation.
 */
(globalThis as any).__piclaw_registerRoute = (
  prefix: string,
  handler: ExtensionRouteHandler,
  extensionPath?: string
): "created" | "updated" => {
  return registerExtensionRoute(prefix, handler, extensionPath || "unknown");
};

// Also expose registerToolStatusHintProvider for addon extensions
import { registerToolStatusHintProvider } from "../../../tool-status-hints.js";
(globalThis as any).__piclaw_registerToolStatusHintProvider = registerToolStatusHintProvider;
