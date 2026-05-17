import { useCallback } from "preact/hooks";
import type { TreeNode } from "../../components/FileTree";
import { copyToClipboard } from "../../utils/clipboard";
import { renderMarkdown } from "../../utils/markdown-pipeline";

const OPENABLE_EXTS = new Set([
  'md', 'mdx', 'markdown',
  'csv', 'pdf', 'html', 'htm',
  'docx', 'xlsx', 'pptx',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'mp4', 'webm', 'mov',
]);

interface WorkspaceActionsProps {
  node: TreeNode;
  downloadUrl: string;
  isDeleting: boolean;
  onDelete: () => void;
}

export function WorkspaceActions({ node, downloadUrl, isDeleting, onDelete }: WorkspaceActionsProps) {
  const ext = node.path.split('.').pop()?.toLowerCase() ?? '';

  const copyPath = useCallback(() => {
    copyToClipboard(node.path).then((ok) => {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: ok ? "Path copied" : "Copy failed", type: ok ? "success" : "error" } }));
    });
  }, [node.path]);

  const attachToChat = useCallback(() => {
    window.dispatchEvent(new CustomEvent("piclaw:file-attach", {
      detail: { path: node.path, name: node.name, size: node.size ?? 0 },
    }));
    window.dispatchEvent(new CustomEvent("piclaw:status-flash", {
      detail: { message: `Attached ${node.name} to chat`, type: "success" },
    }));
  }, [node.path, node.name, node.size]);

  const handleOpenFile = useCallback(async () => {
    const encoded = encodeURIComponent(node.path);
    const name = node.path.split('/').pop() ?? node.name;

    if (['md', 'mdx', 'markdown'].includes(ext)) {
      try {
        const res = await fetch(`/workspace/file?path=${encoded}`, { credentials: 'same-origin' });
        const data = await res.json() as { content?: string; text?: string };
        const text = data.content ?? data.text ?? '';
        const html = renderMarkdown(text);
        window.dispatchEvent(new CustomEvent('piclaw:open-page', { detail: { html, name, mode: 'markdown' } }));
      } catch {
        window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Failed to open file preview", type: "error" } }));
      }
      return;
    }

    let viewerUrl: string;
    if (ext === 'csv') viewerUrl = `/csv-viewer?path=${encoded}`;
    else if (['html', 'htm'].includes(ext)) viewerUrl = `/html-viewer?path=${encoded}`;
    else if (ext === 'pdf') {
      window.dispatchEvent(new CustomEvent('piclaw:open-page', { detail: { name, mode: 'pdf', sourceUrl: `/workspace/raw?path=${encoded}` } }));
      return;
    }
    else if (['docx', 'xlsx', 'pptx'].includes(ext)) viewerUrl = `/office-viewer?path=${encoded}`;
    else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) viewerUrl = `/image-viewer?path=${encoded}`;
    else if (['mp4', 'webm', 'mov'].includes(ext)) viewerUrl = `/video-viewer?path=${encoded}`;
    else return;
    window.dispatchEvent(new CustomEvent('piclaw:open-page', { detail: { url: viewerUrl, name } }));
  }, [node.path, node.name, ext]);

  return (
    <div className="workspace__preview-actions">
      <button
        className="workspace__action-icon workspace__action-icon--attach"
        onClick={attachToChat}
        title="Attach to chat"
      >
        <span className="codicon codicon-attach" />
      </button>
      <button
        className="workspace__action-icon workspace__action-icon--copy"
        onClick={copyPath}
        title="Copy path"
      >
        <span className="codicon codicon-copy" />
      </button>
      <a
        className="workspace__action-icon workspace__action-icon--download"
        href={downloadUrl}
        title="Download"
      >
        <span className="codicon codicon-cloud-download" />
      </a>
      {OPENABLE_EXTS.has(ext) && (
        <button
          className="workspace__action-icon workspace__action-icon--open"
          onClick={() => void handleOpenFile()}
          title="Open preview"
        >
          <span className="codicon codicon-open-preview" />
        </button>
      )}
      <button
        className="workspace__action-icon workspace__action-icon--delete"
        disabled={isDeleting}
        onClick={onDelete}
        title={isDeleting ? "Deleting…" : "Delete file"}
      >
        <span className="codicon codicon-trash" />
      </button>
    </div>
  );
}
