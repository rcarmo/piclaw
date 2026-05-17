import { useState, useEffect } from "preact/hooks";
import type { TreeNode } from "../../components/FileTree";
import {
  getWorkspacePreviewKind,
  getWorkspaceFileText,
  type WorkspaceFilePayload,
} from "../workspace-panel-helpers";
import { getErrorMessage, readJsonSafely } from "./workspaceUtils";

export type PreviewStatus = "loading" | "too-large" | "error" | "done";

export interface WorkspacePreviewState {
  preview: WorkspaceFilePayload | null;
  status: PreviewStatus;
  errorMessage: string;
  kind: "code" | "markdown" | "image" | "binary";
  content: string | null;
  rawUrl: string;
  downloadUrl: string;
}

export function useWorkspacePreview(node: TreeNode): WorkspacePreviewState {
  const [preview, setPreview] = useState<WorkspaceFilePayload | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("Failed to load preview");

  useEffect(() => {
    setPreview(null);
    setStatus("loading");
    setErrorMessage("Failed to load preview");

    if (node.size !== null && node.size > 1_000_000) {
      setStatus("too-large");
      return;
    }

    const controller = new AbortController();
    fetch(`/workspace/file?path=${encodeURIComponent(node.path)}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await readJsonSafely<WorkspaceFilePayload | { error?: string; message?: string }>(res);
        if (!res.ok) {
          throw new Error(getErrorMessage(data, `HTTP ${res.status}`));
        }
        setPreview((data as WorkspaceFilePayload | null) ?? null);
        setStatus("done");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setErrorMessage(err instanceof Error ? err.message : "Failed to load preview");
        setStatus("error");
      });

    return () => controller.abort();
  }, [node.path, node.size]);

  const encodedPath = encodeURIComponent(node.path);
  const rawUrl = preview?.url ?? `/workspace/raw?path=${encodedPath}`;
  const downloadUrl = `/workspace/raw?path=${encodedPath}&download=1`;
  const kind = getWorkspacePreviewKind(node.name, preview);
  const content = getWorkspaceFileText(preview);

  return { preview, status, errorMessage, kind, content, rawUrl, downloadUrl };
}
