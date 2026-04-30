/**
 * web/workspace/paths.ts – Workspace path resolution and validation.
 *
 * Resolves relative paths against the workspace root and validates that
 * resolved paths don't escape the workspace boundary (path traversal).
 *
 * Consumers: web/workspace/file-service.ts, web/handlers/workspace.ts.
 */

import { realpathSync } from "fs";
import path from "path";

import { WORKSPACE_DIR } from "../../../core/config.js";
import { isRealPathWithin } from "../../../utils/path-safety.js";
import { EXCLUDE_DIRS } from "./constants.js";

const WATCH_IGNORE_DIRS = new Set(["logs"]);
const WATCH_INTERNAL_EXCLUDE_DIRS = new Set([".piclaw", ".pi", "artifacts", "exports", "tmp", ".tmp", "rescue"]);

/** Resolve a relative path against the workspace root, rejecting lexical traversal. */
export function resolveWorkspacePath(input: string | null): string | null {
  const raw = (input || "").trim();
  const resolved = path.resolve(WORKSPACE_DIR, raw);
  const rel = path.relative(WORKSPACE_DIR, resolved);
  if (!rel || rel === ".") return WORKSPACE_DIR;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

function realpathNative(targetPath: string): string {
  return realpathSync.native ? realpathSync.native(targetPath) : realpathSync(targetPath);
}

/** Verify an existing resolved path stays under the real workspace root after symlink resolution. */
export function isRealWorkspacePath(absPath: string): boolean {
  try {
    const realWorkspace = realpathNative(WORKSPACE_DIR);
    const realTarget = realpathNative(absPath);
    return isRealPathWithin(realWorkspace, realTarget);
  } catch {
    return false;
  }
}

/** Resolve a relative path and reject targets whose realpath escapes the workspace. */
export function resolveExistingWorkspacePath(input: string | null): string | null {
  const resolved = resolveWorkspacePath(input);
  if (!resolved) return null;
  return isRealWorkspacePath(resolved) ? resolved : null;
}

/** Convert an absolute path to a workspace-relative path. */
export function toRelativePath(absPath: string): string {
  const rel = path.relative(WORKSPACE_DIR, absPath) || ".";
  return rel.split(path.sep).join("/");
}

/** Check whether a directory name should be excluded from tree listing. */
export function shouldExcludeDir(name: string): boolean {
  return EXCLUDE_DIRS.has(name);
}

/** Check whether a path should be ignored (hidden, excluded, etc.). */
export function shouldIgnorePath(absPath: string): boolean {
  const rel = path.relative(WORKSPACE_DIR, absPath);
  if (!rel || rel === ".") return false;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return true;
  const parts = rel.split(path.sep);
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (EXCLUDE_DIRS.has(part) || WATCH_IGNORE_DIRS.has(part)) return true;
  }
  return false;
}

/** Check whether a path should be ignored specifically by the live workspace watcher. */
export function shouldIgnoreWatchPath(absPath: string, includeHidden = false): boolean {
  const rel = path.relative(WORKSPACE_DIR, absPath);
  if (!rel || rel === ".") return false;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return true;
  const parts = rel.split(path.sep);
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (EXCLUDE_DIRS.has(part) || WATCH_IGNORE_DIRS.has(part) || WATCH_INTERNAL_EXCLUDE_DIRS.has(part)) return true;
    if (!includeHidden && part.startsWith(".") && part !== "." && part !== "..") return true;
  }
  return false;
}

/** Check whether a path segment starts with a dot. */
export function isHiddenPath(absPath: string): boolean {
  const rel = path.relative(WORKSPACE_DIR, absPath);
  if (!rel || rel === ".") return false;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  return parts.some((part) => part.startsWith(".") && part !== "." && part !== "..");
}
