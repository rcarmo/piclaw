/**
 * channels/web/manifest.ts – Web manifest response helper.
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("web.manifest");

/** Optional metadata returned by avatar cache preparation. */
export interface ManifestIconMeta {
  updatedAt?: string;
  contentType?: string;
  revision?: string;
}

/** Dependencies required for building the dynamic web app manifest response. */
export interface ManifestRequestContext {
  assistantName?: string | null;
  assistantAvatar?: string | null;
  ensureAvatarCache(kind: "agent", source: string): Promise<ManifestIconMeta | null>;
}

function buildDefaultManifestIcons(): Array<{ src: string; sizes: string; type: string; purpose?: string }> {
  return [
    { src: "/static/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/static/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/static/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/static/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
}

function buildAvatarManifestIcons(version: string): Array<{ src: string; sizes: string; type: string; purpose?: string }> {
  return [192, 512].flatMap(size => [
    { src: `/avatar/agent?format=png&size=${size}&v=${version}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" },
    { src: `/avatar/agent?format=png&size=${size}&purpose=maskable&v=${version}`, sizes: `${size}x${size}`, type: "image/png", purpose: "maskable" },
  ]);
}

/** Build and return the web app manifest JSON (or HEAD headers only). */
export async function handleManifestRequest(req: Request, ctx: ManifestRequestContext): Promise<Response> {
  const encoder = new TextEncoder();
  const baseName = ctx.assistantName || "PiClaw";
  let icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> = buildDefaultManifestIcons();

  if (ctx.assistantAvatar) {
    try {
      const meta = await ctx.ensureAvatarCache("agent", ctx.assistantAvatar);
      if (meta) {
        const versionSource = meta.revision || meta.updatedAt || new Date().toISOString();
        const version = encodeURIComponent(versionSource);
        icons = buildAvatarManifestIcons(version);
      }
    } catch (error) {
      log.warn("Failed to prepare agent avatar for manifest", {
        operation: "web_manifest.prepare_agent_avatar",
        err: error,
      });
    }
  }

  const manifest = {
    name: baseName,
    // Public instance branding.
    piclaw_avatar: icons[0]?.src.startsWith("/avatar/agent") ? icons[0].src : null,
    short_name: baseName,
    description: "Slack-like interface for coding agents",
    start_url: "/",
    display: "standalone",
    display_override: ["window-controls-overlay"],
    background_color: "#ffffff",
    theme_color: "#ffffff",
    color_scheme: "dark light",
    icons,
  };

  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const headers: Record<string, string> = {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": String(encoder.encode(body).length),
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(body, { status: 200, headers });
}
