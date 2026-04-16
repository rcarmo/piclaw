/**
 * web/http/dispatch-shell.ts – Shell/static/avatar route dispatch helpers.
 */

import type { WebChannelLike } from "../core/web-channel-contracts.js";
import type { RouteFlags } from "./route-flags.js";

/**
 * Static asset resolver used when shell-route handlers need a fallback file response.
 * @param req Incoming HTTP request.
 * @param relPath Relative asset path inside the static root.
 * @returns The resolved static-file response.
 */
export type ServeStaticAsset = (req: Request, relPath: string) => Promise<Response>;

/**
 * Dispatch shell/static/avatar routes and return null when no shell path matches.
 * @param channel Web channel contract exposing shell/static handlers.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname.
 * @param flags Precomputed route-classification flags for the current request.
 * @param serveStaticAsset Static resolver used by favicon/apple-icon fallback paths.
 * @returns The matched shell/static response, or null when another dispatcher should continue.
 */
export async function handleShellRoutes(
  channel: WebChannelLike,
  req: Request,
  pathname: string,
  flags: RouteFlags,
  serveStaticAsset: ServeStaticAsset
): Promise<Response | null> {
  if (flags.isIndex) {
    return channel.serveStatic("index.html");
  }

  if (flags.isManifest) {
    return channel.handleManifest(req);
  }

  if (flags.isFavicon) {
    const avatarResp = await channel.handleAvatar("agent", req);
    if (avatarResp.status === 200) return avatarResp;
    return await serveStaticAsset(req, "favicon.ico");
  }

  if (flags.isAppleIcon) {
    const avatarResp = await channel.handleAvatar("agent", req);
    if (avatarResp.status === 200) return avatarResp;
    return await serveStaticAsset(req, pathname.slice(1));
  }

  if (flags.isServiceWorker) {
    return channel.serveStatic("sw.js");
  }

  if (req.method === "GET" && pathname === "/ghostty-vt.wasm") {
    return channel.serveStatic("js/vendor/ghostty-vt.wasm");
  }

  if (flags.isStaticAsset) {
    const rel = pathname.replace("/static/", "");
    return channel.serveStatic(rel);
  }

  if (flags.isDocsAsset) {
    const rel = pathname.replace("/docs/", "");
    return channel.serveDocsStatic(rel);
  }

  if (pathname === "/sse/stream") {
    return channel.handleSse(req);
  }

  if (req.method === "GET" && pathname === "/terminal/session") {
    return channel.handleTerminalSession(req);
  }

  if (req.method === "POST" && pathname === "/terminal/handoff") {
    return await channel.handleTerminalHandoff(req);
  }

  if (req.method === "GET" && pathname === "/vnc/session") {
    return channel.handleVncSession(req);
  }

  if (req.method === "POST" && pathname === "/vnc/handoff") {
    return await channel.handleVncHandoff(req);
  }

  if (flags.isAvatar) {
    return await channel.handleAvatar("agent", req);
  }

  if (flags.isGetOrHead && pathname === "/avatar/user") {
    return await channel.handleAvatar("user", req);
  }

  return null;
}
