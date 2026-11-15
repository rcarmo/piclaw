import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const APP_ASSET_VERSION_REL_PATHS = [
  "classic/dist/app.bundle.js",
  "classic/dist/app.bundle.css",
  "classic/dist/editor.bundle.js",
  "classic/dist/delegate-settings.bundle.js",
  "common/dist/login.bundle.js",
  "common/dist/login.bundle.css",
] as const;

/**
 * Return a deterministic version for an ordered set of asset files.
 * Missing files are skipped so minimal development builds can still produce a
 * version from the assets they contain. Returns null when none can be read.
 */
export function computeAssetContentVersion(
  filePaths: readonly string[],
  onReadError?: (filePath: string, error: unknown) => void,
): string | null {
  const hash = createHash("sha256");
  let filesRead = 0;
  for (const filePath of filePaths) {
    try {
      hash.update(readFileSync(filePath));
      filesRead += 1;
    } catch (error) {
      onReadError?.(filePath, error);
    }
  }
  return filesRead > 0 ? hash.digest("hex").slice(0, 12) : null;
}
