/**
 * core/config-store.ts – Low-level JSON file read/write helpers.
 *
 * Provides the persistence primitives that core/config.ts uses to load and
 * save the application configuration file (typically `.piclaw/config.json`
 * inside the workspace). Also used by the keychain (secure/keychain.ts) and
 * any module that needs simple JSON-file persistence.
 */

import { closeSync, constants, fchmodSync, fstatSync, openSync, mkdirSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { invalidateJsonFileCache, readCachedJsonFile } from "./config-file-cache.js";

const log = createLogger("core.config-store");

/** Tighten an existing owner-owned config without following links or changing
 * bytes. Unsafe/missing inputs are never replaced. No MCP engine is involved. */
export function preparePrivateJsonConfig(filePath:string):'absent'|'unchanged'|'migrated'|'unavailable'{
  let fd:number;
  try{fd=openSync(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error){return (error as NodeJS.ErrnoException)?.code==='ENOENT'?'absent':'unavailable';}
  try{
    const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.())return 'unavailable';
    if((stat.mode&0o077)===0)return 'unchanged';
    fchmodSync(fd,0o600);return(fstatSync(fd).mode&0o777)===0o600?'migrated':'unavailable';
  }catch{return 'unavailable';}finally{closeSync(fd);}
}

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
  // startup privacy check. Atomic replacement must never widen it to the umask mode.
  writeFileSync(tempPath, `${next}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
  renameSync(tempPath, filePath);
  invalidateJsonFileCache(filePath);
}
