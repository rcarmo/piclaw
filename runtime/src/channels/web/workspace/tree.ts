/**
 * web/workspace/tree.ts – Recursive directory tree builder.
 *
 * Walks the workspace filesystem and builds a JSON tree structure
 * for the web UI's sidebar explorer. Respects exclude directories
 * and depth limits.
 *
 * Consumers: web/workspace/tree-cache.ts calls buildTree().
 */

import { readdirSync, statSync } from "fs";
import path from "path";

import { MAX_TREE_ENTRIES } from "./constants.js";
import { formatMtime } from "./file-utils.js";
import { isRealWorkspacePath, shouldExcludeDir, toRelativePath } from "./paths.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.workspace-tree");

/** State accumulated during recursive tree building. */
export interface WorkspaceTreeState {
  count: number;
  truncated: boolean;
  maxEntries?: number;
}

function listDirEntries(absPath: string, includeHidden: boolean) {
  const entriesAll = readdirSync(absPath, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory() || !shouldExcludeDir(entry.name));

  const sorter = (a: (typeof entriesAll)[number], b: (typeof entriesAll)[number]) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  };

  const visibleEntries = entriesAll.filter((entry) => !entry.name.startsWith(".")).sort(sorter);
  const hiddenEntries = entriesAll.filter((entry) => entry.name.startsWith(".")).sort(sorter);
  return includeHidden ? visibleEntries.concat(hiddenEntries) : visibleEntries;
}

/** Workspace tree node payload returned by workspace tree endpoints. */
export interface WorkspaceTreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
  mtime: string | null;
  child_count: number | undefined;
  children: WorkspaceTreeNode[] | undefined;
}

/** Recursively build a directory tree starting from the given root. */
export function buildTree(
  absPath: string,
  depth: number,
  state: WorkspaceTreeState,
  options: { includeHidden: boolean }
): WorkspaceTreeNode {
  if (!isRealWorkspacePath(absPath)) {
    throw new Error("Workspace tree path escapes workspace root");
  }
  const stats = statSync(absPath);
  const node: WorkspaceTreeNode = {
    name: path.basename(absPath) || "workspace",
    path: toRelativePath(absPath),
    type: stats.isDirectory() ? "dir" : "file",
    size: stats.isDirectory() ? null : stats.size,
    mtime: formatMtime(stats),
    child_count: undefined,
    children: [],
  };

  const maxEntries = Number.isFinite(state.maxEntries) ? Math.max(1, Number(state.maxEntries)) : MAX_TREE_ENTRIES;

  state.count += 1;
  if (state.count > maxEntries) {
    state.truncated = true;
    node.children = undefined;
    return node;
  }

  if (!stats.isDirectory()) {
    node.children = undefined;
    return node;
  }

  let entries: ReturnType<typeof listDirEntries>;
  try {
    entries = listDirEntries(absPath, options.includeHidden);
  } catch {
    node.child_count = 0;
    node.children = undefined;
    return node;
  }

  node.child_count = entries.length;

  if (depth <= 0) {
    node.children = undefined;
    return node;
  }

  node.children = [];
  for (const entry of entries) {
    if (state.count >= maxEntries) {
      state.truncated = true;
      break;
    }
    const childPath = path.join(absPath, entry.name);
    try {
      node.children.push(buildTree(childPath, depth - 1, state, options));
    } catch (err) {
      debugSuppressedError(log, "Workspace tree skipped an unreadable child path.", err, {
        operation: "workspace_tree.build_tree.child",
        childPath,
      });
    }
  }

  return node;
}

/** Compress single-child directory chains into combined path nodes. */
export function compressPaths(paths: string[]): string[] {
  const normalized = Array.from(new Set(paths.map((p) => (p || ".").replace(/\\/g, "/"))));
  if (normalized.includes(".")) return ["."];
  normalized.sort((a, b) => a.length - b.length);
  return normalized.filter((candidate) => {
    let current = candidate;
    while (current.includes("/")) {
      current = current.slice(0, current.lastIndexOf("/"));
      if (normalized.includes(current)) return false;
    }
    return true;
  });
}
