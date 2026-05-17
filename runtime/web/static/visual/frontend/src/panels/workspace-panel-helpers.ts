const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "json", "css", "html", "py", "sh",
  "yaml", "yml", "toml", "txt", "xml", "env", "ini", "conf", "scss",
]);
const MARKDOWN_EXTS = new Set(["md", "mdx"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export const DOT_COLORS = [
  "#4fc1ff", "#a8cc8c", "#f4b942", "#e06c75",
  "#c678dd", "#56b6c2", "#e5c07b", "#61afef",
  "#98c379", "#e06c75",
];

export interface ChildInfo {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
}

export interface WorkspaceFilePayload {
  path: string;
  name: string;
  kind: "text" | "image" | "binary";
  content_type?: string | null;
  size: number;
  mtime: string | null;
  text?: string;
  url?: string;
  truncated?: boolean;
}

export interface FolderChartSegment {
  color: string;
  label: string;
  pct: number;
  size: number;
  type: "dir" | "file" | "other";
}

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function getFallbackPreviewKind(name: string): "code" | "markdown" | "image" | "binary" {
  const ext = getExt(name);
  if (CODE_EXTS.has(ext)) return "code";
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "binary";
}

export function getWorkspaceFileText(payload: WorkspaceFilePayload | null | undefined): string | null {
  return typeof payload?.text === "string" ? payload.text : null;
}

export function getWorkspacePreviewKind(
  name: string,
  payload: WorkspaceFilePayload | null | undefined
): "code" | "markdown" | "image" | "binary" {
  if (payload?.kind === "image") return "image";
  if (payload?.kind === "binary") return "binary";

  const contentType = payload?.content_type?.toLowerCase() ?? "";
  if (contentType.includes("markdown")) return "markdown";
  if (contentType.startsWith("image/")) return "image";

  return getFallbackPreviewKind(name);
}

export function buildFolderChartSegments(
  children: ChildInfo[] | null,
  totalSize: number | null,
  maxSlices = 6
): FolderChartSegment[] {
  if (!children?.length) return [];

  const total = totalSize ?? children.reduce((sum, child) => sum + Math.max(0, child.size ?? 0), 0);
  if (total <= 0) return [];

  const sorted = [...children]
    .filter((child) => (child.size ?? 0) > 0)
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

  if (!sorted.length) return [];

  const top = sorted.slice(0, Math.max(1, maxSlices));
  const remainder = sorted.slice(top.length).reduce((sum, child) => sum + (child.size ?? 0), 0);

  const segments: FolderChartSegment[] = top.map((child, index) => ({
    color: DOT_COLORS[index % DOT_COLORS.length],
    label: child.type === "dir" ? `📁 ${child.name}` : child.name,
    pct: ((child.size ?? 0) / total) * 100,
    size: child.size ?? 0,
    type: child.type,
  }));

  if (remainder > 0) {
    segments.push({
      color: "rgba(255,255,255,0.28)",
      label: "Other",
      pct: (remainder / total) * 100,
      size: remainder,
      type: "other" as const,
    });
  }

  return segments;
}
