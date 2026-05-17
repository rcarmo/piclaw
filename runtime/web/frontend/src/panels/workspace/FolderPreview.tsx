import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { TreeNode } from "../../components/FileTree";
import {
  buildFolderChartSegments,
  DOT_COLORS,
  type ChildInfo,
  type FolderChartSegment,
} from "../workspace-panel-helpers";
import { formatBytes } from "../../utils/formatBytes";
import {
  getErrorMessage,
  toUserFacingMessage,
  readJsonSafely,
  makeTreeNodeFromMutation,
  type WorkspaceMutationPayload,
} from "./workspaceUtils";
import { useDialog } from "../../hooks/useDialog";

// ─── Sunburst helpers ─────────────────────────────────────────────────────────

interface SunburstNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
  children?: SunburstNode[];
}

function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  const span = endAngle - startAngle;
  if (span >= 359.9) {
    const mid = startAngle + 180;
    return `${describeArc(cx, cy, innerR, outerR, startAngle, mid)} ${describeArc(cx, cy, innerR, outerR, mid, startAngle + 359.8)}`;
  }
  const s1 = polarToCartesian(cx, cy, outerR, startAngle);
  const e1 = polarToCartesian(cx, cy, outerR, endAngle);
  const s2 = polarToCartesian(cx, cy, innerR, endAngle);
  const e2 = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = span > 180 ? 1 : 0;
  return [
    `M ${s1.x.toFixed(3)} ${s1.y.toFixed(3)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${e1.x.toFixed(3)} ${e1.y.toFixed(3)}`,
    `L ${s2.x.toFixed(3)} ${s2.y.toFixed(3)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${e2.x.toFixed(3)} ${e2.y.toFixed(3)}`,
    "Z",
  ].join(" ");
}

const RING_SPECS = [
  { innerR: 38, outerR: 68 },
  { innerR: 71, outerR: 90 },
  { innerR: 93, outerR: 108 },
] as const;

const GAP_DEG = 1.5;
const MAX_SLICES = 14;
const SB_CX = 120;
const SB_CY = 120;

interface ArcSegment {
  d: string;
  color: string;
  label: string;
  size: number;
  ring: number;
}

function buildArcSegments(
  nodes: SunburstNode[],
  ring: number,
  startAngle: number,
  endAngle: number,
  parentHue?: number
): ArcSegment[] {
  if (ring >= RING_SPECS.length) return [];
  const { innerR, outerR } = RING_SPECS[ring];
  const totalRange = endAngle - startAngle;
  if (totalRange <= GAP_DEG * 2) return [];

  const valid = nodes
    .filter((n) => (n.size ?? 0) > 0)
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, MAX_SLICES);
  if (!valid.length) return [];

  const totalSize = valid.reduce((s, n) => s + (n.size ?? 0), 0);
  if (totalSize <= 0) return [];

  const segments: ArcSegment[] = [];
  let angle = startAngle + GAP_DEG / 2;

  for (const node of valid) {
    const size = node.size ?? 0;
    const fraction = size / totalSize;
    const segRange = totalRange * fraction - GAP_DEG;
    if (segRange < 1.5) {
      angle += totalRange * fraction;
      continue;
    }
    const segEnd = angle + segRange;
    const hue = ring === 0 ? nameHash(node.name) % 360 : (parentHue ?? nameHash(node.name) % 360);
    const lightness = ring === 0 ? 58 : ring === 1 ? 46 : 36;
    const color = `hsl(${hue}, 68%, ${lightness}%)`;

    segments.push({
      d: describeArc(SB_CX, SB_CY, innerR, outerR, angle, segEnd),
      color,
      label: node.name,
      size,
      ring,
    });

    if (node.children?.length) {
      segments.push(...buildArcSegments(node.children, ring + 1, angle, segEnd, hue));
    }

    angle = segEnd + GAP_DEG;
  }

  return segments;
}

interface SunburstChartProps {
  root: SunburstNode;
  totalSize: number;
}

function SunburstChart({ root, totalSize }: SunburstChartProps) {
  const children = root.children ?? [];
  const arcs = buildArcSegments(children, 0, 0, 360);

  return (
    <div className="workspace__sunburst">
      <svg viewBox="0 0 240 240" aria-label="Folder size sunburst chart">
        {/* Background rings */}
        {RING_SPECS.map((spec, i) => (
          <circle
            key={i}
            cx={SB_CX}
            cy={SB_CY}
            r={(spec.innerR + spec.outerR) / 2}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={spec.outerR - spec.innerR}
          />
        ))}
        {/* Arc segments */}
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arc.d}
            fill={arc.color}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="0.6"
            opacity="0.92"
          >
            <title>{arc.label} — {formatBytes(arc.size)}</title>
          </path>
        ))}
        {/* Center circle */}
        <circle cx={SB_CX} cy={SB_CY} r="35" fill="rgba(20,20,30,0.88)" />
        {/* Center text — use foreignObject for reliable centering */}
        <foreignObject x={SB_CX - 35} y={SB_CY - 18} width="70" height="36">
          <div className="workspace__sunburst-center">
            <span className="workspace__sunburst-total">{formatBytes(totalSize)}</span>
            <span className="workspace__sunburst-label">TOTAL</span>
          </div>
        </foreignObject>
      </svg>
    </div>
  );
}

function renderChartSegment(segment: FolderChartSegment, index: number, segments: FolderChartSegment[]) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const prior = segments.slice(0, index).reduce((sum, item) => sum + item.pct, 0);
  const dash = (segment.pct / 100) * circumference;
  const dashOffset = -((prior / 100) * circumference);

  return (
    <circle
      key={`${segment.label}-${segment.color}`}
      cx="60"
      cy="60"
      r={radius}
      fill="none"
      stroke={segment.color}
      strokeDasharray={`${dash} ${Math.max(0, circumference - dash)}`}
      strokeDashoffset={dashOffset}
      strokeLinecap="butt"
      strokeWidth="18"
      transform="rotate(-90 60 60)"
    />
  );
}

// ─── FolderPreview ────────────────────────────────────────────────────────────

interface FolderPreviewProps {
  node: TreeNode;
  onMutate: (payload: WorkspaceMutationPayload) => void;
}

export function FolderPreview({ node, onMutate }: FolderPreviewProps) {
  const [children, setChildren] = useState<ChildInfo[] | null>(null);
  const [sunburstRoot, setSunburstRoot] = useState<SunburstNode | null>(null);
  const [totalSize, setTotalSize] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "done">("loading");
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "chart">("list");
  const [actionBusy, setActionBusy] = useState<"create" | "upload" | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { showPrompt, showAlert } = useDialog();

  useEffect(() => {
    setChildren(null);
    setSunburstRoot(null);
    setTotalSize(null);
    setStatus("loading");
    setShowAll(false);

    const controller = new AbortController();
    const treeFetch = fetch(
      `/workspace/tree?path=${encodeURIComponent(node.path)}&depth=3`,
      { credentials: "same-origin", signal: controller.signal }
    ).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ root: SunburstNode }>;
    });

    const statFetch = fetch(
      `/workspace/stat?path=${encodeURIComponent(node.path)}`,
      { credentials: "same-origin", signal: controller.signal }
    ).then((r) => {
      if (!r.ok) return null;
      return r.json() as Promise<{ size?: number } | null>;
    }).catch(() => null);

    Promise.all([treeFetch, statFetch])
      .then(([treeData, statData]) => {
        const root = treeData.root;
        const kids = (root?.children ?? []) as ChildInfo[];
        const sorted = [...kids].sort((a, b) => {
          const sa = a.size ?? 0;
          const sb = b.size ?? 0;
          return sb - sa;
        });
        setChildren(sorted);
        setSunburstRoot(root ?? null);
        const sizeFromStat = statData?.size ?? null;
        if (sizeFromStat !== null) {
          setTotalSize(sizeFromStat);
        } else {
          const sum = kids.reduce((acc, k) => acc + (k.size ?? 0), 0);
          setTotalSize(sum);
        }
        setStatus("done");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setStatus("error");
      });

    return () => controller.abort();
  }, [node.path]);

  const MAX_VISIBLE = 10;
  const visible = children
    ? showAll
      ? children
      : children.slice(0, MAX_VISIBLE)
    : [];
  const hiddenCount = children ? Math.max(0, children.length - MAX_VISIBLE) : 0;
  const total = totalSize ?? children?.reduce((a, c) => a + (c.size ?? 0), 0) ?? 0;
  const chartSegments = buildFolderChartSegments(children, totalSize);
  const zipUrl = `/workspace/download?path=${encodeURIComponent(node.path)}`;

  const handleCreateFile = useCallback(async () => {
    if (actionBusy) return;
    const name = (await showPrompt({
      title: "New file name",
      placeholder: "untitled.txt",
      defaultValue: "untitled.txt",
    }))?.trim();
    if (!name) return;

    setActionBusy("create");
    try {
      const response = await fetch("/workspace/file", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: node.path, name, content: "" }),
      });
      const data = await readJsonSafely<{ error?: string; path?: string; name?: string; size?: number; mtime?: string | null }>(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to create file"));
      }
      onMutate({ nextNode: makeTreeNodeFromMutation("file", data ?? {}) });
    } catch (error) {
      console.error("[WorkspacePanel] Failed to create file:", error);
      await showAlert({
        title: "Failed to create file",
        description: toUserFacingMessage(error, "Failed to create file"),
      });
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, node.path, onMutate, showAlert, showPrompt]);

  const handleUploadFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length || actionBusy) return;

    setActionBusy("upload");
    try {
      let lastUploadedNode: TreeNode | null = null;
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(`/workspace/upload?path=${encodeURIComponent(node.path)}`, {
          method: "POST",
          credentials: "same-origin",
          body: formData,
        });
        const data = await readJsonSafely<{ error?: string; path?: string; name?: string; size?: number }>(response);
        if (!response.ok) {
          throw new Error(getErrorMessage(data, `Failed to upload ${file.name}`));
        }
        lastUploadedNode = makeTreeNodeFromMutation("file", data ?? {});
      }

      if (lastUploadedNode) {
        onMutate({ nextNode: lastUploadedNode });
      }
    } catch (error) {
      console.error("[WorkspacePanel] Failed to upload file:", error);
      await showAlert({
        title: "Failed to upload file",
        description: toUserFacingMessage(error, "Failed to upload file"),
      });
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      setActionBusy(null);
    }
  }, [actionBusy, node.path, onMutate, showAlert]);

  return (
    <div className="workspace__preview-info">
      <div className="workspace__preview-name workspace__preview-name--wrap">
        <span className="codicon codicon-folder-opened workspace__folder-icon" />
        {node.name}
      </div>

      <div className="workspace__folder-actions">
        <button className="workspace__action-icon workspace__action-icon--copy" disabled={actionBusy !== null} onClick={handleCreateFile} title={actionBusy === "create" ? "Creating…" : "New file"}>
          <span className="codicon codicon-new-file" />
        </button>
        <button
          className="workspace__action-icon workspace__action-icon--attach"
          disabled={actionBusy !== null}
          onClick={() => uploadInputRef.current?.click()}
          title={actionBusy === "upload" ? "Uploading…" : "Upload files"}
        >
          <span className="codicon codicon-cloud-upload" />
        </button>
        <a className="workspace__action-icon workspace__action-icon--download" href={zipUrl} title="Download as zip">
          <span className="codicon codicon-cloud-download" />
        </a>
        <input
          ref={uploadInputRef}
          hidden
          multiple
          type="file"
          onChange={(event) => void handleUploadFiles(event.currentTarget.files)}
        />
      </div>

      <div className="workspace__preview-path">{node.path}</div>
      <div className="workspace__folder-desc">
        Folder selected — create a file, upload files, or download a zip archive.
      </div>

      {status === "loading" && (
        <div className="workspace__preview-meta workspace__preview-meta--loading">
          Loading…
        </div>
      )}
      {status === "error" && (
        <div className="workspace__preview-meta workspace__preview-meta--error">
          Failed to load folder info
        </div>
      )}
      {status === "done" && (
        <>
          <div className="workspace__folder-toolbar">
            {totalSize !== null && (
              <div className="workspace__folder-total">
                Total: {formatBytes(totalSize)}
              </div>
            )}
            <div className="workspace__folder-view-toggle" role="tablist" aria-label="Folder preview view">
              <button
                className={`workspace__folder-view-btn${viewMode === "list" ? " workspace__folder-view-btn--active" : ""}`}
                onClick={() => setViewMode("list")}
                type="button"
              >
                <span className="codicon codicon-list-tree" />
                List
              </button>
              <button
                className={`workspace__folder-view-btn${viewMode === "chart" ? " workspace__folder-view-btn--active" : ""}`}
                onClick={() => setViewMode("chart")}
                type="button"
              >
                <span className="codicon codicon-pie-chart" />
                Chart
              </button>
            </div>
          </div>

          {viewMode === "list" ? (
            <div className="workspace__folder-breakdown">
              {visible.map((child, i) => {
                const pct = total > 0 && child.size !== null
                  ? ((child.size / total) * 100).toFixed(0)
                  : null;
                const color = DOT_COLORS[i % DOT_COLORS.length];
                return (
                  <div key={child.path} className="workspace__folder-breakdown-item">
                    <svg className="workspace__folder-breakdown-dot" viewBox="0 0 8 8" aria-hidden="true">
                      <circle cx="4" cy="4" r="4" fill={color} />
                    </svg>
                    <span className="workspace__folder-breakdown-name" title={child.name}>
                      {child.type === "dir" ? "📁 " : ""}{child.name}
                    </span>
                    <span className={`workspace__folder-breakdown-size${child.type === "dir" ? " workspace__folder-breakdown-size--dir" : ""}`}>
                      {child.size !== null ? formatBytes(child.size) : "—"}
                    </span>
                    {pct !== null && (
                      <span className="workspace__folder-breakdown-pct">{pct}%</span>
                    )}
                  </div>
                );
              })}
              {!showAll && hiddenCount > 0 && (
                <button
                  className="workspace__folder-breakdown-more"
                  onClick={() => setShowAll(true)}
                >
                  and {hiddenCount} more…
                </button>
              )}
              {children && children.length === 0 && (
                <div className="workspace__preview-meta">Empty folder</div>
              )}
            </div>
          ) : (
            <div className="workspace__folder-chart-wrap">
              {sunburstRoot && (totalSize ?? 0) > 0 ? (
                <SunburstChart root={sunburstRoot} totalSize={totalSize ?? 0} />
              ) : chartSegments.length > 0 ? (
                <>
                  <div className="workspace__folder-chart">
                    <svg viewBox="0 0 120 120" aria-label="Folder size chart">
                      <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="18" />
                      {chartSegments.map((segment, index) => renderChartSegment(segment, index, chartSegments))}
                    </svg>
                    <div className="workspace__folder-chart-center">
                      <div className="workspace__folder-chart-total">{formatBytes(totalSize ?? total)}</div>
                      <div className="workspace__folder-chart-label">Total size</div>
                    </div>
                  </div>
                  <div className="workspace__folder-chart-legend">
                    {chartSegments.map((segment) => (
                      <div key={`${segment.label}-${segment.type}`} className="workspace__folder-chart-legend-item">
                        <svg className="workspace__folder-breakdown-dot" viewBox="0 0 8 8" aria-hidden="true">
                          <circle cx="4" cy="4" r="4" fill={segment.color} />
                        </svg>
                        <span className="workspace__folder-breakdown-name" title={segment.label}>{segment.label}</span>
                        <span className="workspace__folder-breakdown-size">{formatBytes(segment.size)}</span>
                        <span className="workspace__folder-breakdown-pct">{segment.pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="workspace__preview-meta">Nothing sizeable to chart</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
