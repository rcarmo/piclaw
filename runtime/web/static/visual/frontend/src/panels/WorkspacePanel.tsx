import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import { FileTree, type TreeNode } from "../components/FileTree";
import { formatBytes } from "../utils/formatBytes";
import { safeGetItem, safeSetItem } from "../utils/storage";
import { FolderPreview } from "./workspace/FolderPreview";
import { useWorkspacePreview } from "./workspace/useWorkspacePreview";
import { WorkspaceActions } from "./workspace/WorkspaceActions";
import { WorkspacePreview } from "./workspace/WorkspacePreview";
import {
  readJsonSafely,
  toUserFacingMessage,
  getErrorMessage,
  type WorkspaceMutationPayload,
} from "./workspace/workspaceUtils";
import { useDialog } from "../hooks/useDialog";

// ─── FilePreview ──────────────────────────────────────────────────────────────

interface FilePreviewProps {
  node: TreeNode;
  onMutate: (payload: WorkspaceMutationPayload) => void;
}

function FilePreview({ node, onMutate }: FilePreviewProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { showConfirm, showAlert } = useDialog();
  const { preview, status, errorMessage, kind, content, rawUrl, downloadUrl } =
    useWorkspacePreview(node);

  const handleDelete = useCallback(async () => {
    if (isDeleting) return;
    const confirmed = await showConfirm({
      title: `Delete ${node.name}?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/workspace/file?path=${encodeURIComponent(node.path)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await readJsonSafely<{ error?: string } & Record<string, unknown>>(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to delete file"));
      }
      onMutate({ nextNode: null });
    } catch (error) {
      console.error("[WorkspacePanel] Failed to delete file:", error);
      await showAlert({
        title: "Failed to delete file",
        description: toUserFacingMessage(error, "Failed to delete file"),
      });
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, node.name, node.path, onMutate, showAlert, showConfirm]);

  return (
    <div className="workspace__preview-info">
      <div className="workspace__preview-name">{node.name}</div>
      <div className="workspace__preview-path">{node.path}</div>
      {node.size !== null && (
        <div className="workspace__preview-meta">{formatBytes(node.size)}</div>
      )}
      {node.mtime && (
        <div className="workspace__preview-meta">
          Modified: {new Date(node.mtime).toLocaleString()}
        </div>
      )}
      <WorkspaceActions
        node={node}
        downloadUrl={downloadUrl}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />
      <WorkspacePreview
        nodeName={node.name}
        preview={preview}
        status={status}
        errorMessage={errorMessage}
        kind={kind}
        content={content}
        rawUrl={rawUrl}
      />
    </div>
  );
}

// ─── WorkspacePanel ──────────────────────────────────────────────────────────

const SHOW_HIDDEN_KEY = "workspaceShowHidden";

function loadShowHidden(): boolean {
  const raw = safeGetItem(SHOW_HIDDEN_KEY);
  if (raw !== null) return raw !== "false";
  return true;
}

export function WorkspacePanel() {
  const [topHeight, setTopHeight] = useState(() => Number(safeGetItem("piclaw-workspace-split")) || 260);
  const containerRef = useRef<HTMLDivElement>(null);
  const topPaneRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(topHeight);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [showHidden, setShowHidden] = useState<boolean>(loadShowHidden);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    if (topPaneRef.current) {
      topPaneRef.current.style.height = `${topHeight}px`;
    }
  }, [topHeight]);

  const handleMutation = useCallback((payload: WorkspaceMutationPayload) => {
    setTreeVersion((current) => current + 1);
    setSelectedNode(payload.nextNode);
  }, []);

  const handleToggleHidden = useCallback(() => {
    setShowHidden((prev) => {
      const next = !prev;
      safeSetItem(SHOW_HIDDEN_KEY, String(next));
      return next;
    });
  }, []);

  const handleReindex = useCallback(async () => {
    if (reindexing) return;
    setReindexing(true);
    try {
      const res = await fetch("/workspace/reindex", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      setRefreshKey((k) => k + 1);
      const msg = res.ok ? "Workspace reindexed" : "Reindex failed";
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: msg } }));
    } catch {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Reindex error" } }));
    } finally {
      setReindexing(false);
    }
  }, [reindexing]);

  const onDragStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = heightRef.current;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const containerH = containerRef.current?.getBoundingClientRect().height || 500;
      const next = Math.max(60, Math.min(containerH - 60, startH + delta));
      heightRef.current = next;
      setTopHeight(next);
    };
    const onUp = () => {
      safeSetItem("piclaw-workspace-split", String(heightRef.current));
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div ref={containerRef} className="workspace">
      <div className="workspace__pane-top" ref={topPaneRef}>
        <div className="workspace__section-header workspace__section-header--padded" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Files</span>
          <div className="workspace__files-toolbar">
            <button
              className={`workspace__files-toolbar-icon codicon codicon-list-filter${!showHidden ? " workspace__files-toolbar-icon--active" : ""}`}
              title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
              onClick={handleToggleHidden}
              aria-pressed={!showHidden}
            />
            <button
              className={`workspace__files-toolbar-icon codicon codicon-refresh${reindexing ? " workspace__files-toolbar-icon--spinning" : ""}`}
              title="Refresh &amp; reindex"
              onClick={handleReindex}
              disabled={reindexing}
            />
          </div>
        </div>
        <FileTree key={`${treeVersion}-${refreshKey}`} onFileSelect={setSelectedNode} showHidden={showHidden} />
      </div>
      <div
        className="workspace__drag-handle"
        onMouseDown={onDragStart}
      />
      <div className="workspace__pane-bottom">
        <div className="workspace__preview-header">Preview</div>
        {selectedNode ? (
          selectedNode.type === "dir"
            ? <FolderPreview node={selectedNode} onMutate={handleMutation} />
            : <FilePreview node={selectedNode} onMutate={handleMutation} />
        ) : (
          <div className="workspace__preview-empty">Select a file to preview</div>
        )}
      </div>
    </div>
  );
}
