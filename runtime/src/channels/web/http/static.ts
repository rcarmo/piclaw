/**
 * web/http/static.ts – Static file serving for the web UI.
 *
 * Serves the bundled HTML, CSS, JS, and font files from the web/static
 * directory. Handles content-type detection and caching headers.
 *
 * Consumers: web/http/response-service.ts and web/request-router.ts.
 */

import { extname, resolve } from "path";
import { statSync } from "fs";

import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const STATIC_DIR = resolve(import.meta.dir, "..", "..", "..", "..", "web", "static");
const DOCS_DIR = resolve(import.meta.dir, "..", "..", "..", "..", "docs");
const log = createLogger("web.static");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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
const APP_VERSION_FILES = ["dist/app.bundle.js", "dist/app.bundle.css"];
const LOGIN_VERSION_FILES = ["dist/login.bundle.js", "dist/login.bundle.css"];

function readAssetVersion(relPaths: string[]): string {
  let newestMtimeMs = 0;
  for (const relPath of relPaths) {
    const filePath = resolve(STATIC_DIR, relPath);
    try {
      const stats = statSync(filePath);
      newestMtimeMs = Math.max(newestMtimeMs, stats.mtimeMs || 0);
    } catch (error) {
      debugSuppressedError(log, "Static asset version probe skipped a missing or unreadable asset.", error, {
        relPath,
        filePath,
      });
    }
  }

  if (newestMtimeMs > 0) {
    return Math.floor(newestMtimeMs).toString(36);
  }

  return "dev";
}

export function getAppAssetVersion(): string {
  return readAssetVersion(APP_VERSION_FILES);
}

export function getLoginAssetVersion(): string {
  return readAssetVersion(LOGIN_VERSION_FILES);
}

function renderHtmlTemplate(relPath: string, html: string): string {
  if (relPath === "index.html") {
    return html.replaceAll(APP_ASSET_VERSION_PLACEHOLDER, getAppAssetVersion());
  }
  if (relPath === "login.html") {
    return html.replaceAll(LOGIN_ASSET_VERSION_PLACEHOLDER, getLoginAssetVersion());
  }
  return html;
}

/**
 * Serve a file from the web static asset directory.
 * @param relPath Relative path inside `web/static`.
 * @param notFound Callback used when the asset path is invalid or missing.
 * @returns Static-file response with content-type/cache headers, or the provided not-found response.
 */
export async function serveStatic(relPath: string, notFound: () => Response): Promise<Response> {
  const filePath = resolve(STATIC_DIR, relPath);
  if (!filePath.startsWith(STATIC_DIR)) return notFound();

  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();

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

  if (ext === ".html") {
    const rendered = renderHtmlTemplate(relPath, await file.text());
    return new Response(rendered, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  }

  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
  };

  if (relPath === "sw.js") {
    responseHeaders["Service-Worker-Allowed"] = "/";
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
  if (!filePath.startsWith(DOCS_DIR)) return notFound();

  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();

  const contentType = MIME_TYPES[extname(filePath)] || "application/octet-stream";
  return new Response(file, {
    headers: {
      "Content-Type": contentType,
    },
  });
}
