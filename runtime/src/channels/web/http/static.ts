/**
 * web/http/static.ts – Static file serving for the web UI.
 *
 * Serves the bundled HTML, CSS, JS, and font files from the web/static
 * directory. Handles content-type detection, caching headers, and
 * transparent response compression for compressible assets.
 *
 * Consumers: web/http/response-service.ts and web/request-router.ts.
 */

import { extname, resolve } from "path";
import { existsSync, readFileSync, statSync } from "fs";

import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { APP_ASSET_VERSION_REL_PATHS, computeAssetContentVersion } from "../../../utils/asset-content-version.js";
import { WEB_RUNTIME_CONFIG } from "../../../core/config.js";
import { isPublicWidgetAssetPath } from "./route-flags.js";

const RUNTIME_DIR = resolve(import.meta.dir, "..", "..", "..", "..");
const STATIC_DIR = resolve(
  process.env.PICLAW_WEB_STATIC_DIR || resolve(RUNTIME_DIR, "web", "static")
);
const DOCS_DIR = resolve(
  process.env.PICLAW_RUNTIME_DOCS_DIR || resolve(RUNTIME_DIR, "docs")
);
const log = createLogger("web.static");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

const APP_ASSET_VERSION_PLACEHOLDER = "__APP_ASSET_VERSION__";
const LOGIN_ASSET_VERSION_PLACEHOLDER = "__LOGIN_ASSET_VERSION__";
const NOTIFICATION_SOURCE_LABELS_PLACEHOLDER = "__PICLAW_NOTIFICATION_SOURCE_LABELS_FLAG__";
const SANITIZE_SVG_FENCES_PLACEHOLDER = "__PICLAW_SANITIZE_SVG_FENCES_FLAG__";
const LOGIN_VERSION_FILES = ["common/dist/login.bundle.js", "common/dist/login.bundle.css"];
const TEXT_ASSET_CACHE = new Map<string, { mtimeMs: number; text: string }>();
const GZIP_ASSET_CACHE = new Map<string, { mtimeMs: number; data: Uint8Array }>();

const SKIP_COMPRESSION_EXTS = new Set([
  ".avif",
  ".br",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp4",
  ".png",
  ".webm",
  ".webp",
  ".woff2",
  ".zip",
]);

function readAssetVersion(relPaths: string[]): string {
  const filePaths = relPaths.map((relPath) => resolve(STATIC_DIR, relPath));
  const contentVersion = computeAssetContentVersion(filePaths, (filePath, error) => {
    debugSuppressedError(log, "Static asset content-version probe skipped a missing or unreadable asset.", error, { filePath });
  });
  if (contentVersion) return contentVersion;

  let newestMtimeMs = 0;
  for (const [index, filePath] of filePaths.entries()) {
    try {
      const stats = statSync(filePath);
      newestMtimeMs = Math.max(newestMtimeMs, stats.mtimeMs || 0);
    } catch (error) {
      debugSuppressedError(log, "Static asset version probe skipped a missing or unreadable asset.", error, {
        relPath: relPaths[index],
        filePath,
      });
    }
  }
  return newestMtimeMs > 0 ? Math.floor(newestMtimeMs).toString(36) : "dev";
}

export function getAppAssetVersion(): string {
  const indexPath = resolve(STATIC_DIR, "classic/index.html");
  try {
    const indexHtml = readFileSync(indexPath, "utf8");
    const stampedVersion = indexHtml.match(/\/static\/classic\/dist\/app\.bundle\.js\?v=([a-z0-9]+)/i)?.[1];
    if (stampedVersion && stampedVersion !== APP_ASSET_VERSION_PLACEHOLDER) return stampedVersion;
  } catch (error) {
    debugSuppressedError(log, "Static app version probe could not read the stamped index.", error, { indexPath });
  }
  return readAssetVersion([...APP_ASSET_VERSION_REL_PATHS]);
}

export function getLoginAssetVersion(): string {
  return readAssetVersion(LOGIN_VERSION_FILES);
}

function renderHtmlTemplate(relPath: string, html: string): string {
  const renderedWithSharedFlags = html
    .replaceAll(NOTIFICATION_SOURCE_LABELS_PLACEHOLDER, WEB_RUNTIME_CONFIG.notificationDebugLabels ? "1" : "0")
    .replaceAll(SANITIZE_SVG_FENCES_PLACEHOLDER, WEB_RUNTIME_CONFIG.sanitizeSvgFences ? "1" : "0");
  if (relPath === "classic/index.html") {
    return renderedWithSharedFlags.replaceAll(APP_ASSET_VERSION_PLACEHOLDER, getAppAssetVersion());
  }
  if (relPath === "login.html") {
    return renderedWithSharedFlags.replaceAll(LOGIN_ASSET_VERSION_PLACEHOLDER, getLoginAssetVersion());
  }
  return renderedWithSharedFlags;
}

function parseAcceptedEncodings(req?: Request): Set<string> {
  const header = req?.headers.get("Accept-Encoding") || "";
  const accepted = new Set<string>();
  for (const rawPart of header.split(",")) {
    const [rawEncoding, ...rawParams] = rawPart.trim().split(";");
    const encoding = rawEncoding.trim().toLowerCase();
    if (!encoding) continue;
    const disabled = rawParams.some((param) => {
      const [key, value] = param.trim().split("=");
      return key?.trim().toLowerCase() === "q" && Number(value) === 0;
    });
    if (!disabled) accepted.add(encoding);
  }
  return accepted;
}

function getAcceptedCompressionEncodings(req: Request | undefined, ext: string): Set<string> {
  if (SKIP_COMPRESSION_EXTS.has(ext.toLowerCase())) return new Set();
  return parseAcceptedEncodings(req);
}

function gzipAsset(filePath: string, mtimeMs: number, raw: Uint8Array): Uint8Array {
  const cached = GZIP_ASSET_CACHE.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.data;
  const data = new Uint8Array(Bun.gzipSync(Buffer.from(raw)));
  GZIP_ASSET_CACHE.set(filePath, { mtimeMs, data });
  return data;
}

function buildCompressedHeaders(contentType: string, cacheControl: string, encoding: "br" | "gzip"): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Content-Encoding": encoding,
    "Vary": "Accept-Encoding",
  };
}

function readRenderedTextAsset(filePath: string): string {
  const stats = statSync(filePath);
  const cached = TEXT_ASSET_CACHE.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached.text;
  }

  const text = readFileSync(filePath, "utf8");
  TEXT_ASSET_CACHE.set(filePath, {
    mtimeMs: stats.mtimeMs || 0,
    text,
  });
  return text;
}

import { isPathWithin } from "../../../utils/path-safety.js";

/**
 * Serve a file from the web static asset directory.
 * @param relPath Relative path inside `web/static`.
 * @param notFound Callback used when the asset path is invalid or missing.
 * @param req Optional incoming request, used for Accept-Encoding negotiation.
 * @returns Static-file response with content-type/cache headers, or the provided not-found response.
 */
export async function serveStatic(relPath: string, notFound: () => Response, req?: Request): Promise<Response> {
  const filePath = resolve(STATIC_DIR, relPath);
  if (!isPathWithin(STATIC_DIR, filePath)) return notFound();

  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();

  // Use the resolved path for the same narrow public-asset policy as auth routing.
  const publicWidgetAsset = isPublicWidgetAssetPath(`/static/${filePath.slice(STATIC_DIR.length + 1)}`);
  const corsHeaders: Record<string, string> = publicWidgetAsset ? { "Access-Control-Allow-Origin": "*" } : {};
  const ext = extname(filePath);
  const contentType = relPath.endsWith("manifest.json")
    ? "application/manifest+json; charset=utf-8"
    : MIME_TYPES[ext] || "application/octet-stream";

  // HTML and app dist bundles should not be cached across deploys, otherwise
  // the SPA can keep running stale UI code after a backend reload.
  // Everything else (fonts, icons, vendor libs): 1 hour cache.
  const cacheControl =
    ext === ".html"
      ? "no-cache, no-store, must-revalidate"
      : relPath === "sw.js"
        ? "no-cache, no-store, must-revalidate"
        : (relPath === "dist" || relPath.startsWith("dist/") || relPath.includes("/dist/"))
          ? "no-cache, no-store, must-revalidate"
          : "public, max-age=3600";

  const acceptedEncodings = getAcceptedCompressionEncodings(req, ext);
  const acceptsGzip = acceptedEncodings.has("gzip");
  const sidecarEncodingPreference: Array<"br" | "gzip"> = [
    ...(acceptedEncodings.has("br") ? ["br" as const] : []),
    ...(acceptedEncodings.has("gzip") ? ["gzip" as const] : []),
  ];

  if (ext === ".html" || relPath === "sw.js") {
    const rendered = renderHtmlTemplate(relPath, readRenderedTextAsset(filePath));
    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    };
    if (relPath === "sw.js") {
      responseHeaders["Service-Worker-Allowed"] = "/";
    }
    if (acceptsGzip) {
      const stats = statSync(filePath);
      const compressed = gzipAsset(filePath, stats.mtimeMs || 0, new TextEncoder().encode(rendered));
      return new Response(Buffer.from(compressed), {
        headers: {
          ...responseHeaders,
          "Content-Encoding": "gzip",
          "Vary": "Accept-Encoding",
        },
      });
    }
    if (acceptedEncodings.size > 0) responseHeaders["Vary"] = "Accept-Encoding";
    return new Response(rendered, {
      headers: responseHeaders,
    });
  }

  for (const encoding of sidecarEncodingPreference) {
    const sidecarExt = encoding === "br" ? ".br" : ".gz";
    const sidecarPath = `${filePath}${sidecarExt}`;
    if (existsSync(sidecarPath)) {
      return new Response(Bun.file(sidecarPath), {
        headers: { ...buildCompressedHeaders(contentType, cacheControl, encoding), ...corsHeaders },
      });
    }
  }

  if (acceptsGzip) {
    const stats = statSync(filePath);
    const compressed = gzipAsset(filePath, stats.mtimeMs || 0, new Uint8Array(readFileSync(filePath)));
    return new Response(Buffer.from(compressed), {
      headers: { ...buildCompressedHeaders(contentType, cacheControl, "gzip"), ...corsHeaders },
    });
  }

  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ...corsHeaders,
  };
  if (!SKIP_COMPRESSION_EXTS.has(ext.toLowerCase())) {
    responseHeaders["Vary"] = "Accept-Encoding";
  }

  return new Response(file, {
    headers: responseHeaders,
  });
}

/**
 * Serve a file from the bundled docs directory.
 * @param relPath Relative path inside the docs root.
 * @param notFound Callback used when the docs asset path is invalid or missing.
 * @returns Docs static-file response, or the provided not-found response.
 */
export async function serveDocsStatic(relPath: string, notFound: () => Response): Promise<Response> {
  const filePath = resolve(DOCS_DIR, relPath);
  if (!isPathWithin(DOCS_DIR, filePath)) return notFound();

  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();

  const contentType = MIME_TYPES[extname(filePath)] || "application/octet-stream";
  return new Response(file, {
    headers: {
      "Content-Type": contentType,
    },
  });
}
