/**
 * web/http/dispatch-shell.ts – Shell/static/avatar route dispatch helpers.
 */

import { getRuntimeRoot } from "../../../core/config.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import type { RouteFlags } from "./route-flags.js";

/**
 * Static asset resolver used when shell-route handlers need a fallback file response.
 * @param req Incoming HTTP request.
 * @param relPath Relative asset path inside the static root.
 * @returns The resolved static-file response.
 */
export type ServeStaticAsset = (req: Request, relPath: string) => Promise<Response>;

function appleTouchIconSize(pathname: string): string {
  const match = pathname.match(/apple-touch-icon-(\d+)(?:x\d+)?\.png$/i);
  return match?.[1] || "180";
}

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
    return channel.serveStatic('classic/index.html', req);
  }

  if (flags.isManifest) {
    return channel.handleManifest(req);
  }

  if (flags.isFavicon) {
    // Serve the agent avatar as a PNG favicon.  The avatar is stored as WebP
    // but Safari cannot render WebP favicons, so we force PNG conversion
    // by appending ?format=png to the internal request.
    const faviconUrl = new URL(req.url);
    faviconUrl.searchParams.set('format', 'png');
    faviconUrl.searchParams.set('size', '48');
    const pngReq = new Request(faviconUrl.toString(), req);
    const avatarResp = await channel.handleAvatar("agent", pngReq);
    if (avatarResp.status === 200 && (avatarResp.headers.get("Content-Type") || "").toLowerCase().includes("image/png")) return avatarResp;
    return await serveStaticAsset(req, "favicon.ico");
  }

  if (flags.isAppleIcon) {
    // Apple touch icons need raster PNGs; the cached avatar is normally WebP.
    const iconUrl = new URL(req.url);
    iconUrl.searchParams.set("format", "png");
    iconUrl.searchParams.set("size", appleTouchIconSize(pathname));
    const pngReq = new Request(iconUrl.toString(), req);
    const avatarResp = await channel.handleAvatar("agent", pngReq);
    if (avatarResp.status === 200 && (avatarResp.headers.get("Content-Type") || "").toLowerCase().includes("image/png")) return avatarResp;
    return await serveStaticAsset(req, pathname.slice(1));
  }

  if (flags.isServiceWorker) {
    return channel.serveStatic("sw.js", req);
  }

  if (flags.isStaticAsset) {
    const rel = pathname.replace("/static/", "");
    return channel.serveStatic(rel, req);
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

  if (req.method === "GET" && (pathname === "/export/timeline" || pathname === "/internal/export/timeline")) {
    const { handleExportTimeline } = await import("../export/export-timeline-endpoint.js");
    const runtimeDir = getRuntimeRoot(new URL("../../../../", import.meta.url).pathname.replace(/\/$/, ""));
    return handleExportTimeline(req, { runtimeDir });
  }

  return null;
}
