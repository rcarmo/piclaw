/**
 * workspace-search.ts – Public full-text search surface over workspace files.
 *
 * Indexing contracts and refresh/status implementation live in
 * workspace-index-core.ts. This module owns the user-facing search API and the
 * optional background-refresh request hook.
 */

import { getDb } from "./db.js";
import { getSearchMatchMode } from "./core/config.js";
import { prepareFtsQuery } from "./utils/fts-query.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import {
  getWorkspaceIndexStatus,
  markWorkspaceIndexCoreStale,
  normalizeWorkspaceSearchScope,
  refreshWorkspaceIndex,
  type WorkspaceIndexBackgroundRefreshParams,
  type WorkspaceIndexState,
  type WorkspaceIndexStatus,
  type WorkspaceSearchScope,
} from "./workspace-index-core.js";

const log = createLogger("workspace-search");

export type {
  WorkspaceIndexBackgroundRefreshParams,
  WorkspaceIndexState,
  WorkspaceIndexStatus,
  WorkspaceSearchScope,
};
export { getWorkspaceIndexStatus, refreshWorkspaceIndex };

/** Parameters accepted by searchWorkspace(). */
export type WorkspaceSearchParams = {
  /** FTS5 query string. */
  query: string;
  /** Restrict results to a specific scope. */
  scope?: WorkspaceSearchScope | string;
  /** Maximum number of results to return (default 10, max 50). */
  limit?: number;
  /** Pagination offset (default 0). */
  offset?: number;
  /** Whether to re-index before searching (default false; true forces blocking refresh). */
  refresh?: boolean;
  /** Maximum file size in KB to index (default 512). */
  max_kb?: number;
};

/** A single search result row with snippet and file metadata. */
export type WorkspaceSearchRow = {
  /** Relative path from workspace root. */
  path: string;
  /** FTS5-highlighted snippet around matching terms. */
  snippet: string;
  /** File size in bytes. */
  size_bytes: number;
  /** File modification time in epoch milliseconds. */
  mtime_ms: number;
};

/** Return value from searchWorkspace(). */
export type WorkspaceSearchResult = {
  rows: WorkspaceSearchRow[];
  limit: number;
  offset: number;
  error?: string;
};

let requestBackgroundWorkspaceIndexRefreshImpl = (params: WorkspaceIndexBackgroundRefreshParams = {}): void => {
  void import("./workspace-index-process.js")
    .then((mod) => {
      mod.launchWorkspaceIndexProcess({ scope: params.scope, max_kb: params.max_kb });
    })
    .catch((error) => {
      debugSuppressedError(log, "Failed to request background workspace index refresh.", error, {
        operation: "workspace_search.background_refresh.import",
        scope: params.scope,
        maxKb: params.max_kb,
      });
    });
};

const clampNumber = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
};

export function requestBackgroundWorkspaceIndexRefresh(params?: WorkspaceIndexBackgroundRefreshParams): void {
  requestBackgroundWorkspaceIndexRefreshImpl(params || {});
}

export function setBackgroundWorkspaceIndexRefreshRequesterForTests(
  requester: ((params?: WorkspaceIndexBackgroundRefreshParams) => void) | null,
): void {
  requestBackgroundWorkspaceIndexRefreshImpl = requester ?? ((params: WorkspaceIndexBackgroundRefreshParams = {}) => {
    void import("./workspace-index-process.js")
      .then((mod) => {
        mod.launchWorkspaceIndexProcess({ scope: params.scope, max_kb: params.max_kb });
      })
      .catch((error) => {
        debugSuppressedError(log, "Failed to request background workspace index refresh.", error, {
          operation: "workspace_search.background_refresh.import",
          scope: params.scope,
          maxKb: params.max_kb,
        });
      });
  });
}

export function markWorkspaceIndexStale(params?: { scope?: WorkspaceSearchScope | string; paths?: string[] }): void {
  for (const scope of markWorkspaceIndexCoreStale(params)) {
    requestBackgroundWorkspaceIndexRefresh({ scope });
  }
}

/** Full-text search across indexed workspace files. */
export async function searchWorkspace(params: WorkspaceSearchParams): Promise<WorkspaceSearchResult> {
  const query = params.query.trim();
  const limit = clampNumber(params.limit, 10, 1, 50);
  const offset = clampNumber(params.offset, 0, 0, 1_000_000);
  const refresh = params.refresh === true;
  const scope = normalizeWorkspaceSearchScope(params.scope);

  if (!query) {
    return { rows: [], limit, offset, error: "Provide a query." };
  }

  if (refresh) {
    await refreshWorkspaceIndex({ scope, max_kb: params.max_kb });
  } else {
    const status = getWorkspaceIndexStatus({ scope });
    if (status.state !== "ready") {
      requestBackgroundWorkspaceIndexRefresh({ scope, max_kb: params.max_kb });
    }
  }

  const ftsQuery = prepareFtsQuery(query, getSearchMatchMode());
  if (!ftsQuery) {
    return { rows: [], limit, offset, error: "Query is empty after sanitization." };
  }

  const db = getDb();
  try {
    const prefix = scope === "notes" ? "notes/%" : scope === "skills" ? ".pi/skills/%" : null;

    const stmt = prefix
      ? "SELECT path, size_bytes, mtime_ms, snippet(workspace_fts, 0, '[', ']', '…', 12) as snippet FROM workspace_fts WHERE workspace_fts MATCH ? AND path LIKE ? ORDER BY bm25(workspace_fts) LIMIT ? OFFSET ?"
      : "SELECT path, size_bytes, mtime_ms, snippet(workspace_fts, 0, '[', ']', '…', 12) as snippet FROM workspace_fts WHERE workspace_fts MATCH ? ORDER BY bm25(workspace_fts) LIMIT ? OFFSET ?";

    const rows = prefix
      ? (db.prepare(stmt).all(ftsQuery, prefix, limit, offset) as WorkspaceSearchRow[])
      : (db.prepare(stmt).all(ftsQuery, limit, offset) as WorkspaceSearchRow[]);

    return { rows, limit, offset };
  } catch {
    // FTS query failed even after sanitization — fall back to LIKE.
    try {
      const prefix = scope === "notes" ? "notes/%" : scope === "skills" ? ".pi/skills/%" : null;
      const terms = query.split(/\s+/).filter(Boolean).map((t) => `%${t}%`);
      if (terms.length === 0) return { rows: [], limit, offset, error: "No searchable terms." };

      const likeClauses = terms.map(() => "content LIKE ? COLLATE NOCASE").join(" AND ");
      const conditions = prefix ? `${likeClauses} AND path LIKE ?` : likeClauses;
      const params_arr = prefix ? [...terms, prefix] : terms;

      const sql = `SELECT path, size_bytes, mtime_ms, substr(content, 1, 200) as snippet FROM workspace_files JOIN workspace_fts ON workspace_fts.path = workspace_files.path WHERE ${conditions} LIMIT ? OFFSET ?`;
      const rows = db.prepare(sql).all(...params_arr, limit, offset) as WorkspaceSearchRow[];
      return { rows, limit, offset };
    } catch {
      return { rows: [], limit, offset, error: "Workspace search failed (invalid query?)." };
    }
  }
}
