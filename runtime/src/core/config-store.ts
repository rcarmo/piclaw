/**
 * core/config-store.ts – Low-level JSON file read/write helpers.
 *
 * Provides the persistence primitives that core/config.ts uses to load and
 * save the application configuration file (typically `.piclaw/config.json`
 * inside the workspace). Also used by the keychain (secure/keychain.ts) and
 * any module that needs simple JSON-file persistence.
 */

import { mkdirSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { invalidateJsonFileCache, readCachedJsonFile } from "./config-file-cache.js";

const log = createLogger("core.config-store");

/**
 * Read and parse a JSON file, returning its contents as a plain object.
 * Returns an empty object if the file does not exist, is unreadable, or
 * contains invalid JSON — callers always get a safe default.
 *
 * @param filePath - Absolute path to the JSON file.
 */
export function readJsonConfig(filePath: string): Record<string, unknown> {
  try {
    const parsed = readCachedJsonFile(filePath);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch (err) {
    debugSuppressedError(log, "Failed to read JSON config; returning an empty object.", err, {
      operation: "config_store.read_json_config",
      filePath,
    });
  }
  return {};
}

/**
 * Atomically write a JSON object to disk with pretty-printing.
 * Creates parent directories if they do not already exist.
 *
 * @param filePath - Absolute path to the target JSON file.
 * @param config   - The object to serialize and persist.
 */
export function writeJsonConfig(filePath: string, config: Record<string, unknown>): void {
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true });
  const next = JSON.stringify(config, null, 2);
  const tempPath = join(parentDir, `.${process.pid}.${Date.now()}.tmp`);
  // Configuration can contain widget/auth material and is also read by the
  // strict MCP owner. Atomic replacement must never widen it to the umask mode.
  writeFileSync(tempPath, `${next}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
  renameSync(tempPath, filePath);
  invalidateJsonFileCache(filePath);
}
