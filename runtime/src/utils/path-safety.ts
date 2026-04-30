/**
 * utils/path-safety.ts — Shared path-containment and stripping helpers.
 *
 * Platform-safe: uses `path.relative()` and `path.isAbsolute()` so the checks
 * work on both POSIX and Windows (where `realpathSync` returns backslash paths).
 *
 * Consumers:
 *   - channels/web/http/static.ts         (static asset serving)
 *   - channels/web/request-router-service.ts (compose-box static route)
 *   - channels/web/http/editor-vendor-route.ts (editor vendor assets)
 *   - extensions/image-processing.ts      (display-only path stripping)
 */

import { isAbsolute, relative } from "node:path";

/**
 * Return true when `filePath` is equal to or contained within `baseDir`.
 *
 * Uses `path.relative()` so the comparison is platform-safe regardless of
 * whether paths use `/` or `\` separators.
 */
export function isPathWithin(baseDir: string, filePath: string): boolean {
  const rel = relative(baseDir, filePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Strip `baseDir` prefix from `absolutePath` for display purposes.
 *
 * Returns the relative portion with forward slashes for consistent display.
 * If the path is not within `baseDir`, returns the original path unchanged.
 */
export function stripBaseDirForDisplay(baseDir: string, absolutePath: string): string {
  if (!isPathWithin(baseDir, absolutePath)) return absolutePath;
  const rel = relative(baseDir, absolutePath);
  return rel.replace(/\\/g, "/");
}

/**
 * Check whether `realPath` is contained within `realBaseDir` using resolved
 * (realpath'd) paths. This is the correct check for symlink-aware traversal
 * guards where both sides have already been resolved via `realpathSync`.
 */
export function isRealPathWithin(realBaseDir: string, realPath: string): boolean {
  return isPathWithin(realBaseDir, realPath);
}
