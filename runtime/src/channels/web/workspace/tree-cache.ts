/**
 * web/workspace/tree-cache.ts – Cached directory tree builder.
 *
 * Caches the workspace directory tree for a short TTL to avoid
 * expensive filesystem traversals on every request. Invalidated
 * by the filesystem watcher when files change.
 *
 * Consumers: web/workspace/service.ts uses TreeCache for GET /workspace/tree.
 */

import { buildTree } from "./tree.js";
import { isRealWorkspacePath, resolveWorkspacePath } from "./paths.js";
import { getWorkspaceScanSettings } from "./settings.js";
import { existsSync } from "fs";

/** Cached tree result type: array of tree nodes. */
export type WorkspaceTreeResult = { status: number; body: unknown };

/** Time-based cache for workspace directory tree builds. */
export class WorkspaceTreeCache {
  private treeCache = new Map<string, { timestamp: number; result: WorkspaceTreeResult }>();
  private treeRequestTimes: number[] = [];

  private isRateLimited(): boolean {
    const windowMs = 2000;
    const maxRequests = 60;
    const now = Date.now();
    this.treeRequestTimes = this.treeRequestTimes.filter((t) => now - t < windowMs);
    if (this.treeRequestTimes.length >= maxRequests) return true;
    this.treeRequestTimes.push(now);
    return false;
  }

  getTree(
    pathParam: string | null,
    depthParam?: string | null,
    includeHidden = false
  ): WorkspaceTreeResult {
    const targetPath = resolveWorkspacePath(pathParam);
    if (!targetPath) return { status: 400, body: { error: "Invalid path" } };
    if (existsSync(targetPath) && !isRealWorkspacePath(targetPath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    const settings = getWorkspaceScanSettings();
    const depthRaw = parseInt(depthParam || "2", 10);
    const depth = Number.isFinite(depthRaw)
      ? Math.min(Math.max(depthRaw, 1), settings.treeMaxDepth)
      : Math.min(2, settings.treeMaxDepth);

    const cacheKey = `${targetPath}|${depth}|${settings.treeMaxEntries}|${includeHidden ? "1" : "0"}`;
    const cached = this.treeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 1000) {
      return cached.result;
    }

    if (this.isRateLimited()) {
      return { status: 429, body: { error: "Workspace tree requests are throttled. Try again shortly." } };
    }

    try {
      const state = { count: 0, truncated: false, maxEntries: settings.treeMaxEntries };
      const tree = buildTree(targetPath, depth, state, { includeHidden });
      const result = { status: 200, body: { root: tree, truncated: state.truncated } };
      this.treeCache.set(cacheKey, { timestamp: Date.now(), result });
      return result;
    } catch {
      return { status: 500, body: { error: "Failed to read workspace" } };
    }
  }
}
