/**
 * FileTree.tsx - Lazy-loading workspace file tree component.
 *
 * Fetches directory listings from GET /workspace/tree and renders
 * an expandable tree with codicon icons. Clicking a folder toggles
 * expand/collapse and lazy-loads children. Clicking a file selects it.
 *
 * Expanded folder paths and selected file path are persisted to localStorage
 * keyed by chat JID so state survives page reloads.
 */

import { useState, useEffect, useCallback } from "preact/hooks";
import { formatBytes } from "../utils/formatBytes";
import { getChatJid } from "../api/chat-jid";
import { FileIcon } from "./FileIcon";
import { safeGetItem, safeSetItem, safeRemoveItem, safeParseJSON } from "../utils/storage";

/** Tree node shape returned by GET /workspace/tree */
interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
  mtime: string | null;
  child_count?: number;
  children?: TreeNode[];
}

/** API response envelope */
interface TreeResponse {
  root: TreeNode;
  truncated?: boolean;
}

// ─── persistence helpers ───────────────────────────────────────────────────────

const EXPANDED_KEY = () => `piclaw:tree-expanded:${getChatJid()}`;
const SELECTED_KEY = () => `piclaw:tree-selected:${getChatJid()}`;

function loadExpandedPaths(): Set<string> {
  const arr = safeParseJSON<string[]>(EXPANDED_KEY(), []);
  return new Set(arr);
}

function saveExpandedPaths(paths: Set<string>): void {
  safeSetItem(EXPANDED_KEY(), JSON.stringify([...paths]));
}

function loadSelectedPath(): string | null {
  return safeGetItem(SELECTED_KEY());
}

function saveSelectedPath(path: string | null): void {
  if (path) safeSetItem(SELECTED_KEY(), path);
  else safeRemoveItem(SELECTED_KEY());
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function fetchTree(dirPath: string): Promise<TreeNode[]> {
  const params = new URLSearchParams({ path: dirPath, depth: "1" });
  const res = await fetch(`/workspace/tree?${params}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("auth");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: TreeResponse = await res.json();
  return data.root?.children ?? [];
}

// ─── TreeItem ─────────────────────────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: TreeNode) => void;
  onToggleExpand: (path: string) => void;
  showHidden?: boolean;
}

function TreeItem({ node, selectedPath, expandedPaths, onSelect, onToggleExpand, showHidden = true }: TreeItemProps) {
  const isDir = node.type === "dir";
  const expanded = expandedPaths.has(node.path);
  const [children, setChildren] = useState<TreeNode[] | null>(
    node.children !== undefined ? node.children : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSelected = selectedPath === node.path;

  // Auto-fetch children when expanded is restored from localStorage
  useEffect(() => {
    if (expanded && isDir && children === null && !loading) {
      setLoading(true);
      setError(null);
      fetchTree(node.path)
        .then((loaded) => {
          setChildren(loaded);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to load");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [expanded, isDir, children, loading, node.path]);

  const toggle = useCallback(async () => {
    if (!isDir) {
      onSelect(node);
      return;
    }
    // For directories: always call onSelect so preview pane shows folder info
    onSelect(node);
    if (!expanded) {
      // Expand: load children if not yet loaded
      if (children === null) {
        setLoading(true);
        setError(null);
        try {
          const loaded = await fetchTree(node.path);
          setChildren(loaded);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Failed to load";
          setError(msg);
        } finally {
          setLoading(false);
        }
      }
    }
    onToggleExpand(node.path);
  }, [isDir, expanded, children, node, onSelect, onToggleExpand]);


  const meta = isDir
    ? node.child_count !== undefined
      ? `${node.child_count}`
      : ""
    : node.size !== null
    ? formatBytes(node.size)
    : "";

  return (
    <div>
      <div
        className={[
          "file-tree__item",
          isDir ? "file-tree__item--dir" : "file-tree__item--file",
          isSelected ? "file-tree__item--selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? expanded : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void toggle();
          }
        }}
        title={node.path}
      >
        <span
          className={`codicon codicon-${expanded && isDir ? "chevron-down" : isDir ? "chevron-right" : "blank"} file-tree__chevron`}
        />
        <FileIcon filename={node.name} isFolder={isDir} open={expanded} className="file-tree__icon" />
        <span className="file-tree__name">{node.name}</span>
        {meta && <span className="file-tree__meta">{meta}</span>}
      </div>

      {loading && (
        <div className="file-tree__loading file-tree__children-indent">
          Loading...
        </div>
      )}

      {error && (
        <div className="file-tree__error file-tree__children-indent">
          {error === "auth" ? "Authenticate to browse files" : "Failed to load"}
          <button
            className="file-tree__retry"
            onClick={(e) => {
              e.stopPropagation();
              setError(null);
              setChildren(null);
              onToggleExpand(node.path); // collapse on error
            }}
          >
            Retry
          </button>
        </div>
      )}

      {expanded && !loading && children && children.length > 0 && (
        <div className="file-tree__children">
          {(showHidden ? children : children.filter((c) => !c.name.startsWith("."))).map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              showHidden={showHidden}
            />
          ))}
        </div>
      )}

      {expanded && !loading && children && children.length === 0 && (
        <div className="file-tree__empty file-tree__children-indent">
          Empty folder
        </div>
      )}
    </div>
  );
}


// ─── FileTree ─────────────────────────────────────────────────────────────────

interface FileTreeProps {
  onFileSelect?: (node: TreeNode) => void;
  showHidden?: boolean;
}

export function FileTree({ onFileSelect, showHidden = true }: FileTreeProps) {
  const [rootChildren, setRootChildren] = useState<TreeNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(loadSelectedPath);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(loadExpandedPaths);

  // Persist selected path
  useEffect(() => {
    saveSelectedPath(selectedPath);
  }, [selectedPath]);

  // Persist expanded paths
  useEffect(() => {
    saveExpandedPaths(expandedPaths);
  }, [expandedPaths]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const children = await fetchTree("");
      setRootChildren(children);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-expand parents of the restored selected path on initial load
  useEffect(() => {
    if (!selectedPath || !rootChildren) return;
    const parts = selectedPath.split("/");
    const parents: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      parents.push(parts.slice(0, i).join("/"));
    }
    if (parents.length > 0) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        parents.forEach((p) => next.add(p));
        return next;
      });
    }
  }, [rootChildren]); // intentionally omit selectedPath - only run when root loads

  const handleSelect = useCallback(
    (node: TreeNode) => {
      setSelectedPath(node.path);
      onFileSelect?.(node);
    },
    [onFileSelect]
  );

  if (loading) {
    return <div className="file-tree file-tree__loading" role="tree">Loading workspace...</div>;
  }

  if (error) {
    return (
      <div className="file-tree" role="tree">
        <div className="file-tree__error">
          {error === "auth"
            ? "Authenticate to browse files"
            : "Failed to load workspace"}
          <button className="file-tree__retry" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!rootChildren || rootChildren.length === 0) {
    return (
      <div className="file-tree" role="tree">
        <div className="file-tree__empty">No files found</div>
      </div>
    );
  }

  const visibleRootChildren = showHidden
    ? rootChildren
    : rootChildren.filter((n) => !n.name.startsWith("."));

  return (
    <div className="file-tree" role="tree">
      {visibleRootChildren.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onSelect={handleSelect}
          onToggleExpand={toggleExpanded}
          showHidden={showHidden}
        />
      ))}
    </div>
  );
}

export type { TreeNode };
