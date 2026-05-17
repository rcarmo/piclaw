import type { WorkspaceFilePayload } from "../workspace-panel-helpers";
import type { PreviewStatus } from "./useWorkspacePreview";
import { renderMarkdown } from "../../utils/markdown-pipeline";

interface WorkspacePreviewProps {
  nodeName: string;
  preview: WorkspaceFilePayload | null;
  status: PreviewStatus;
  errorMessage: string;
  kind: "code" | "markdown" | "image" | "binary";
  content: string | null;
  rawUrl: string;
}

export function WorkspacePreview({
  nodeName,
  preview,
  status,
  errorMessage,
  kind,
  content,
  rawUrl,
}: WorkspacePreviewProps) {
  return (
    <div className="workspace__preview-content">
      {status === "loading" && (
        <div className="workspace__preview-meta workspace__preview-meta--loading">
          Loading…
        </div>
      )}
      {status === "too-large" && (
        <div className="workspace__preview-meta workspace__preview-meta--warn">
          File too large to preview
        </div>
      )}
      {status === "error" && (
        <div className="workspace__preview-meta workspace__preview-meta--error">
          {errorMessage}
        </div>
      )}
      {status === "done" && preview?.truncated && (
        <div className="workspace__preview-meta workspace__preview-meta--warn">
          Preview truncated to fit the pane
        </div>
      )}
      {status === "done" && kind === "image" && (
        <div className="workspace__preview-image">
          <img src={rawUrl} alt={nodeName} />
        </div>
      )}
      {status === "done" && kind === "binary" && (
        <div className="workspace__preview-meta workspace__preview-meta--warn">
          Binary file — cannot preview
        </div>
      )}
      {status === "done" && kind === "code" && content !== null && (
        <pre className="workspace__preview-code">{content}</pre>
      )}
      {status === "done" && kind === "markdown" && content !== null && (
        <div
          className="workspace__preview-markdown"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown sanitized by markdown-pipeline
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(content),
          }}
        />
      )}
    </div>
  );
}
