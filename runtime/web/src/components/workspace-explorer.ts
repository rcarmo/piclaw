import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { subscribeWorkspaceActions, workspaceActionContext, listWorkspaceActions, invokeWorkspaceAction } from '../ui/addon-workspace-actions.js';
import { workspaceChartColor } from '../ui/workspace-chart-colors.js';
import { useTranslation } from '../utils/i18n.js';
import { LanguageSwitcher } from './language-switcher.js';
import { getLocalStorageBoolean, getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';
import {
    createWorkspaceFile,
    deleteWorkspaceFile,
    getWorkspaceDownloadUrl,
    getWorkspaceFile,
    getWorkspaceFileDownloadUrl,
    getWorkspaceIndexStatus,
    getWorkspaceTree,
    moveWorkspaceEntry,
    reindexWorkspace,
    renameWorkspaceFile,
    setWorkspaceVisibility,
} from '../api.js';
import { uploadFileBatch, uploadWorkspaceFile } from '../ui/upload-transfers.js';
import { formatFileSize } from '../utils/format.js';
import { paneRegistry } from '../panes/index.js';
import { createVisibleInterval } from '../ui/visible-interval.js';
import {
    WORKSPACE_SCALE_STORAGE_KEY,
    readWorkspaceScaleEnvironment,
    resolveWorkspaceScale,
} from '../ui/workspace-scale.js';
import {
    WORKSPACE_CLIENT_SETTINGS_EVENT,
    WORKSPACE_FOLDER_PREVIEW_DEPTH_STORAGE_KEY,
    WORKSPACE_REFRESH_INTERVAL_STORAGE_KEY,
    readWorkspaceClientSettings,
} from '../ui/workspace-settings.js';
import { hasSpecializedWorkspaceTab, shouldAutoOpenWorkspaceFile } from '../ui/workspace-auto-open.js';
import {
    MAX_PWA_DISPLAY_SCALE_PERCENT,
    MIN_PWA_DISPLAY_SCALE_PERCENT,
    PWA_DISPLAY_SCALE_EVENT,
    PWA_DISPLAY_SCALE_STEP_PERCENT,
    PWA_DISPLAY_SCALE_STORAGE_KEY,
    persistPwaDisplayScalePercent,
    readStoredPwaDisplayScalePercent,
} from '../ui/pwa-display-scale.js';
import { getRecentFiles, openRecentFile } from '../ui/recent-files.js';
import { loadWorkspaceTreeModule } from '../ui/workspace-tree-loader.js';

const isHiddenNode = (node) => {
    if (!node || !node.name) return false;
    if (node.path === '.') return false;
    return node.name.startsWith('.');
};

function hasOpenableWorkspaceTab(path) {
    const normalized = String(path || '').trim();
    if (!normalized || normalized.endsWith('/')) return false;
    return hasSpecializedWorkspaceTab(normalized, (context) => paneRegistry.resolve(context));
}

// ── Tree data helpers ─────────────────────────────────────────────────────────

function flattenTree(node, expanded, showHidden, depth = 0, rows = []) {
    if (!showHidden && isHiddenNode(node)) return rows;
    if (!node) return rows;
    rows.push({ node, depth });
    if (node.type === 'dir' && node.children && expanded.has(node.path)) {
        for (const child of node.children) flattenTree(child, expanded, showHidden, depth + 1, rows);
    }
    return rows;
}

/**
 * Signature of *visible* structure only: path + type for expanded nodes.
 * Ignores mtime/size so file modifications alone don't trigger a redraw.
 */
function treeSignature(node, expanded, showHidden) {
    if (!node) return '';
    const parts = [];
    const walk = (item) => {
        if (!showHidden && isHiddenNode(item)) return;
        parts.push(item.type === 'dir' ? `d:${item.path}` : `f:${item.path}`);
        if (item.children && expanded?.has(item.path)) {
            for (const child of item.children) walk(child);
        }
    };
    walk(node);
    return parts.join('|');
}

/**
 * Deep-merge two tree snapshots, preserving object identity for unchanged
 * subtrees so Preact's keyed diffing can skip unchanged rows entirely.
 */
function mergeTree(prev, next, options = {}) {
    if (!next) return null;
    if (!prev) return next;
    if (prev.path !== next.path || prev.type !== next.type) return next;

    const prevKids = Array.isArray(prev.children) ? prev.children : null;
    const nextKids = Array.isArray(next.children) ? next.children : null;

    // Server hit depth limit and returned no children – keep what we had.
    if (!nextKids) return prev;

    const prevMap = prevKids ? new Map(prevKids.map(c => [c?.path, c])) : new Map();
    const nextPaths = new Set(nextKids.map(child => child?.path));
    let changed = !prevKids || prevKids.length !== nextKids.length;
    const merged = nextKids.map(child => {
        const m = mergeTree(prevMap.get(child.path), child, options);
        if (m !== prevMap.get(child.path)) changed = true;
        return m;
    });

    // A truncated snapshot is not authoritative about absent siblings. Keep
    // previously loaded nodes that the server omitted rather than collapsing
    // the visible tree to the partial response.
    if (options.preserveMissing && prevKids) {
        for (const child of prevKids) {
            if (!nextPaths.has(child?.path)) merged.push(child);
        }
    }

    return changed ? { ...next, children: merged } : prev;
}

// Replace a subtree at path with a new node (merged to preserve identity).
function replaceNodeAtPath(node, targetPath, nextNode, options = {}) {
    if (!node) return node;
    if (node.path === targetPath) return mergeTree(node, nextNode, options);
    if (!Array.isArray(node.children)) return node;
    let changed = false;
    const children = node.children.map(child => {
        const updated = replaceNodeAtPath(child, targetPath, nextNode, options);
        if (updated !== child) changed = true;
        return updated;
    });
    return changed ? { ...node, children } : node;
}

export function mergeWorkspaceTreeUpdates(prev, updates) {
    let next = prev;
    for (const update of Array.isArray(updates) ? updates : []) {
        if (!update?.root) continue;
        // A truncated watcher snapshot cannot distinguish omitted entries from
        // deletions. Keep the current tree until a shallow targeted reload
        // provides an authoritative sibling list.
        if (update.truncated && next) continue;
        if (!next) {
            next = update.root;
        } else if (update.path === '.' || !update.path) {
            next = mergeTree(next, update.root);
        } else {
            next = replaceNodeAtPath(next, update.path, update.root);
        }
    }
    return next;
}

const STARBURST_MAX_DEPTH = 4;
const STARBURST_MAX_CHILDREN = 14;
const STARBURST_CACHE_LIMIT = 16;

function computeSubtreeBytes(node) {
    if (!node) return 0;
    if (node.type === 'file') {
        const size = Math.max(0, Number(node.size) || 0);
        node.__bytes = size;
        return size;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    let total = 0;
    for (const child of children) total += computeSubtreeBytes(child);
    node.__bytes = total;
    return total;
}

function buildFolderSizeHierarchy(node, depth = 0) {
    const size = Math.max(0, Number(node?.__bytes ?? node?.size ?? 0));
    const out = {
        name: node?.name || node?.path || '.',
        path: node?.path || '.',
        size,
        children: [],
    };

    if (!node || node.type !== 'dir' || depth >= STARBURST_MAX_DEPTH) return out;
    const children = Array.isArray(node.children) ? node.children : [];
    const entries = [];

    for (const child of children) {
        const childSize = Math.max(0, Number(child?.__bytes ?? child?.size ?? 0));
        if (childSize <= 0) continue;
        if (child.type === 'dir') {
            entries.push({ kind: 'dir', node: child, size: childSize });
        } else {
            entries.push({ kind: 'file', name: child.name, path: child.path, size: childSize });
        }
    }

    entries.sort((a, b) => b.size - a.size);
    let trimmed = entries;
    if (entries.length > STARBURST_MAX_CHILDREN) {
        const head = entries.slice(0, STARBURST_MAX_CHILDREN - 1);
        const tail = entries.slice(STARBURST_MAX_CHILDREN - 1);
        const tailSize = tail.reduce((acc, entry) => acc + entry.size, 0);
        head.push({
            kind: 'other',
            name: `+${tail.length} more`,
            path: `${out.path}/[other]`,
            size: tailSize,
        });
        trimmed = head;
    }

    out.children = trimmed.map((entry) => {
        if (entry.kind === 'dir') return buildFolderSizeHierarchy(entry.node, depth + 1);
        return { name: entry.name, path: entry.path, size: entry.size, children: [] };
    });

    return out;
}

function polar(cx, cy, radius, angle) {
    return {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
    };
}

function describeDonutSegment(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
    // Cap near-full-circle arcs to just under 2π so SVG can draw them
    // (SVG arcs from a point back to the same point draw nothing).
    const maxSweep = Math.PI * 2 - 0.0001;
    const clampedEnd = (endAngle - startAngle) > maxSweep ? startAngle + maxSweep : endAngle;
    const outerStart = polar(cx, cy, outerRadius, startAngle);
    const outerEnd = polar(cx, cy, outerRadius, clampedEnd);
    const innerEnd = polar(cx, cy, innerRadius, clampedEnd);
    const innerStart = polar(cx, cy, innerRadius, startAngle);
    const largeArc = (clampedEnd - startAngle) > Math.PI ? 1 : 0;
    return [
        `M ${outerStart.x.toFixed(3)} ${outerStart.y.toFixed(3)}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(3)} ${outerEnd.y.toFixed(3)}`,
        `L ${innerEnd.x.toFixed(3)} ${innerEnd.y.toFixed(3)}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)}`,
        'Z',
    ].join(' ');
}

const STARBURST_RINGS = {
    1: [26, 46],
    2: [48, 68],
    3: [70, 90],
    4: [92, 112],
};

function buildStarburstSegments(rootNode, baseSize) {
    const segments = [];
    const legend = [];
    const baseTotal = Math.max(0, Number(baseSize) || 0);

    const walk = (node, start, end, depth) => {
        const children = Array.isArray(node?.children) ? node.children : [];
        if (!children.length) return;
        const nodeSize = Math.max(0, Number(node.size) || 0);
        if (nodeSize <= 0) return;

        const span = end - start;
        let cursor = start;
        children.forEach((child, index) => {
            const childSize = Math.max(0, Number(child.size) || 0);
            if (childSize <= 0) return;
            const ratio = childSize / nodeSize;
            const childStart = cursor;
            const childEnd = index === children.length - 1 ? end : cursor + (span * ratio);
            cursor = childEnd;
            if (childEnd - childStart < 0.003) return;

            const ring = STARBURST_RINGS[depth];
            if (ring) {
                const color = workspaceChartColor(child.path, depth - 1);
                segments.push({
                    key: child.path,
                    path: child.path,
                    label: child.name,
                    size: childSize,
                    color,
                    depth,
                    startAngle: childStart,
                    endAngle: childEnd,
                    innerRadius: ring[0],
                    outerRadius: ring[1],
                    d: describeDonutSegment(120, 120, ring[0], ring[1], childStart, childEnd),
                });
                if (depth === 1) {
                    legend.push({
                        key: child.path,
                        name: child.name,
                        size: childSize,
                        pct: baseTotal > 0 ? (childSize / baseTotal) * 100 : 0,
                        color,
                    });
                }
            }

            if (depth < STARBURST_MAX_DEPTH) {
                walk(child, childStart, childEnd, depth + 1);
            }
        });
    };

    walk(rootNode, -Math.PI / 2, (Math.PI * 3) / 2, 1);
    return { segments, legend };
}

function findHierarchyNode(root, targetPath) {
    if (!root || !targetPath) return null;
    if (root.path === targetPath) return root;
    const children = Array.isArray(root.children) ? root.children : [];
    for (const child of children) {
        const found = findHierarchyNode(child, targetPath);
        if (found) return found;
    }
    return null;
}

function buildFallbackStarburst(label, pathBase, size) {
    if (!size || size <= 0) return { segments: [], legend: [] };
    const ring = STARBURST_RINGS[1];
    if (!ring) return { segments: [], legend: [] };
    const start = -Math.PI / 2;
    const end = (Math.PI * 3) / 2;
    const color = workspaceChartColor(pathBase || label);
    const keyBase = pathBase || '.';
    const key = `${keyBase}/[files]`;
    return {
        segments: [
            {
                key,
                path: key,
                label,
                size,
                color,
                depth: 1,
                startAngle: start,
                endAngle: end,
                innerRadius: ring[0],
                outerRadius: ring[1],
                d: describeDonutSegment(120, 120, ring[0], ring[1], start, end),
            },
        ],
        legend: [
            {
                key,
                name: label,
                size,
                pct: 100,
                color,
            },
        ],
    };
}

function createFolderStarburstPayload(root, truncated = false) {
    if (!root) return null;
    const totalSize = computeSubtreeBytes(root);
    const hierarchy = buildFolderSizeHierarchy(root, 0);
    const baseSize = hierarchy.size || totalSize;
    let { segments, legend } = buildStarburstSegments(hierarchy, baseSize);

    if (!segments.length && baseSize > 0) {
        const fallback = buildFallbackStarburst('[files]', hierarchy.path, baseSize);
        segments = fallback.segments;
        legend = fallback.legend;
    }

    return {
        root: hierarchy,
        totalSize: baseSize,
        segments,
        legend,
        truncated,
    };
}

function FolderStarburstChart({ payload }) {
    if (!payload) return null;
    const [hovered, setHovered] = useState(null);
    const [zoomPath, setZoomPath] = useState(payload?.root?.path || '.');
    const [zoomStack, setZoomStack] = useState(() => [payload?.root?.path || '.']);
    const [isZooming, setIsZooming] = useState(false);

    useEffect(() => {
        const rootPath = payload?.root?.path || '.';
        setZoomPath(rootPath);
        setZoomStack([rootPath]);
        setHovered(null);
    }, [payload?.root?.path, payload?.totalSize]);

    useEffect(() => {
        if (!zoomPath) return;
        setIsZooming(true);
        const timer = setTimeout(() => setIsZooming(false), 180);
        return () => clearTimeout(timer);
    }, [zoomPath]);

    const zoomRoot = useMemo(() => {
        return findHierarchyNode(payload.root, zoomPath) || payload.root;
    }, [payload?.root, zoomPath]);

    const baseSize = zoomRoot?.size || payload.totalSize || 0;
    const { segments, legend } = useMemo(() => {
        const computed = buildStarburstSegments(zoomRoot, baseSize);
        if (computed.segments.length > 0) return computed;
        if (baseSize <= 0) return computed;
        const label = zoomRoot?.children?.length ? 'Total' : '[files]';
        return buildFallbackStarburst(label, zoomRoot?.path || payload?.root?.path || '.', baseSize);
    }, [zoomRoot, baseSize, payload?.root?.path]);

    const [animatedSegments, setAnimatedSegments] = useState(segments);
    const prevSegmentsRef = useRef(new Map());
    const animFrameRef = useRef(0);

    useEffect(() => {
        const prevMap = prevSegmentsRef.current;
        const nextMap = new Map(segments.map((segment) => [segment.key, segment]));
        const start = performance.now();
        const duration = 220;

        const animate = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = t * (2 - t);
            const interpolated = segments.map((segment) => {
                const prev = prevMap.get(segment.key);
                const from = prev || {
                    startAngle: segment.startAngle,
                    endAngle: segment.startAngle,
                    innerRadius: segment.innerRadius,
                    outerRadius: segment.innerRadius,
                };
                const lerp = (a, b) => a + (b - a) * eased;
                const startAngle = lerp(from.startAngle, segment.startAngle);
                const endAngle = lerp(from.endAngle, segment.endAngle);
                const innerRadius = lerp(from.innerRadius, segment.innerRadius);
                const outerRadius = lerp(from.outerRadius, segment.outerRadius);
                return {
                    ...segment,
                    d: describeDonutSegment(120, 120, innerRadius, outerRadius, startAngle, endAngle),
                };
            });
            setAnimatedSegments(interpolated);
            if (t < 1) {
                animFrameRef.current = requestAnimationFrame(animate);
            }
        };

        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(animate);
        prevSegmentsRef.current = nextMap;
        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [segments]);

    const displaySegments = animatedSegments.length ? animatedSegments : segments;

    const totalLabel = baseSize > 0 ? formatFileSize(baseSize) : '0 B';
    const rawLabel = zoomRoot?.name || '';
    const labelBase = rawLabel && rawLabel !== '.' ? rawLabel : 'Total';
    const activeLabel = labelBase || 'Total';
    const activeValue = totalLabel;
    const canZoomOut = zoomStack.length > 1;

    const handleSegmentClick = (segment) => {
        if (!segment?.path) return;
        const node = findHierarchyNode(payload.root, segment.path);
        if (!node || !Array.isArray(node.children) || node.children.length === 0) return;
        setZoomStack((prev) => [...prev, node.path]);
        setZoomPath(node.path);
        setHovered(null);
    };

    const handleZoomOut = () => {
        if (!canZoomOut) return;
        setZoomStack((prev) => {
            const next = prev.slice(0, -1);
            setZoomPath(next[next.length - 1] || payload?.root?.path || '.');
            return next;
        });
        setHovered(null);
    };

    return html`
        <div class="workspace-folder-starburst">
            <svg viewBox="0 0 240 240" class=${`workspace-folder-starburst-svg${isZooming ? ' is-zooming' : ''}`} role="img"
                aria-label=${`Folder sizes for ${zoomRoot?.path || payload?.root?.path || '.'}`}
                data-segments=${displaySegments.length}
                data-base-size=${baseSize}>
                ${displaySegments.map((segment) => html`
                    <path
                        key=${segment.key}
                        d=${segment.d}
                        fill=${segment.color}
                        stroke="var(--bg-primary)"
                        stroke-width="1"
                        class=${`workspace-folder-starburst-segment${hovered?.key === segment.key ? ' is-hovered' : ''}`}
                        onMouseEnter=${() => setHovered(segment)}
                        onMouseLeave=${() => setHovered(null)}
                        onTouchStart=${() => setHovered(segment)}
                        onTouchEnd=${() => setHovered(null)}
                        onClick=${() => handleSegmentClick(segment)}
                    >
                        <title>${segment.label} — ${formatFileSize(segment.size)}</title>
                    </path>
                `)}
                <g
                    class=${`workspace-folder-starburst-center-hit${canZoomOut ? ' is-drill' : ''}`}
                    onClick=${handleZoomOut}
                    role="button"
                    aria-label="Zoom out"
                >
                    <circle
                        cx="120"
                        cy="120"
                        r="24"
                        fill="var(--bg-secondary)"
                        stroke="var(--border-color)"
                        stroke-width="1"
                        class="workspace-folder-starburst-center"
                    />
                    <text x="120" y="114" text-anchor="middle" class="workspace-folder-starburst-total-label">${activeLabel}</text>
                    <text x="120" y="130" text-anchor="middle" class="workspace-folder-starburst-total-value">${activeValue}</text>
                </g>
            </svg>
            ${legend.length > 0 && html`
                <div class="workspace-folder-starburst-legend">
                    ${legend.slice(0, 8).map((entry) => html`
                        <div key=${entry.key} class="workspace-folder-starburst-legend-item">
                            <span class="workspace-folder-starburst-swatch" style=${`background:${entry.color}`}></span>
                            <span class="workspace-folder-starburst-name" title=${entry.name}>${entry.name}</span>
                            <span class="workspace-folder-starburst-size">${formatFileSize(entry.size)}</span>
                            <span class="workspace-folder-starburst-pct">${entry.pct.toFixed(1)}%</span>
                        </div>
                    `)}
                </div>
            `}
            ${payload.truncated && html`
                <div class="workspace-folder-starburst-note">Preview is truncated by tree depth/entry limits.</div>
            `}
        </div>
    `;
}

function triggerWorkspaceDownload(url) {
    if (typeof document === 'undefined' || !url) return;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function describeWorkspaceIndexState(snapshot) {
    switch (snapshot?.state) {
        case 'indexing':
            return 'Indexing workspace…';
        case 'ready':
            return 'Workspace index ready';
        case 'stale':
            return 'Workspace index may be stale';
        case 'failed':
            return 'Workspace index failed';
        case 'never_indexed':
            return 'Workspace index not built yet';
        default:
            return 'Checking workspace index…';
    }
}

function buildWorkspaceIndexTitle(snapshot) {
    if (!snapshot) return 'Workspace index status';
    const lines = [describeWorkspaceIndexState(snapshot)];
    if (snapshot.last_indexed_at) lines.push(`Last indexed: ${snapshot.last_indexed_at}`);
    if (typeof snapshot.indexed_file_count === 'number') lines.push(`Indexed files: ${snapshot.indexed_file_count}`);
    if (Array.isArray(snapshot.roots) && snapshot.roots.length) lines.push(`Roots: ${snapshot.roots.join(', ')}`);
    if (snapshot.last_error) lines.push(`Error: ${snapshot.last_error}`);
    return lines.join('\n');
}

export function buildWorkspaceMoveConfirmationMessage(sourcePath, targetPath, entryType, translate) {
    const sourceName = sourcePath.split('/').pop() || sourcePath;
    const sourceParent = sourcePath.includes('/')
        ? (sourcePath.split('/').slice(0, -1).join('/') || '.')
        : '.';
    if (typeof translate === 'function') {
        const describeLocation = (path) => path === '.' ? translate('workspace.root') : `"${path}"`;
        return translate('workspace.moveConfirm', {
            entry: translate(entryType === 'dir' ? 'workspace.folder' : 'workspace.file'),
            name: sourceName,
            source: describeLocation(sourceParent),
            target: describeLocation(targetPath),
        });
    }
    const entryLabel = entryType === 'dir' ? 'folder' : 'file';
    const describeLocation = (path) => path === '.' ? 'the workspace root' : `"${path}"`;
    return `Move ${entryLabel} "${sourceName}" from ${describeLocation(sourceParent)} to ${describeLocation(targetPath)}?`;
}

export function confirmWorkspaceEntryMove(sourcePath, targetPath, entryType, confirmMove = (message) => window.confirm(message), translate) {
    return confirmMove(buildWorkspaceMoveConfirmationMessage(sourcePath, targetPath, entryType, translate));
}

// ── WorkspaceExplorer ─────────────────────────────────────────────────────────

/** Preact component: file tree explorer with upload, rename, and preview. */
export function WorkspaceExplorer({
    onFileSelect,
    onFolderSelect,
    visible = true,
    active = undefined,
    onOpenEditor,
    onOpenTerminalTab,
    onOpenVncTab,
}) {
    const { t } = useTranslation();
    const [tree,          setTree]          = useState(null);
    const [expanded,      setExpanded]      = useState(new Set(['.']));
    const [selectedPath,  setSelectedPath]  = useState(null);
    const [preview,       setPreview]       = useState(null);
    const [,             setDownloadId]    = useState(null);
    const [initialLoad,   setInitialLoad]   = useState(true);
    const [,             setLoadingPreview]= useState(false);
    const [folderChartOpen, setFolderChartOpen] = useState(false);
    const [error,         setError]         = useState(null);
    const [showHidden,    setShowHidden]    = useState(() => getLocalStorageBoolean('workspaceShowHidden', false));
    const [dragActive,   setDragActive]    = useState(false);
    const [dragMode,     setDragMode]      = useState(null);
    const [dropTarget,   setDropTarget]    = useState(null);
    const [uploading,    setUploading]     = useState(false);
    const uploadingRef = useRef(false);
    const [uploadProgress, setUploadProgress] = useState(null);
    const [folderChart,  setFolderChart]   = useState(null);
    const [workspaceIndexStatus, setWorkspaceIndexStatus] = useState(null);
    const [workspaceReindexing, setWorkspaceReindexing] = useState(false);
    const [workspaceClientSettings, setWorkspaceClientSettings] = useState(() => readWorkspaceClientSettings());
    const [explorerScale, setExplorerScale] = useState(() => resolveWorkspaceScale({
        stored: getLocalStorageItem(WORKSPACE_SCALE_STORAGE_KEY),
        ...readWorkspaceScaleEnvironment(),
    }));
    const [pwaDisplayScalePercent, setPwaDisplayScalePercent] = useState(() => readStoredPwaDisplayScalePercent());
    const [pwaDisplayScaleDraft, setPwaDisplayScaleDraft] = useState(() => String(readStoredPwaDisplayScalePercent()));
    const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
    const refreshIntervalMs = Math.max(15000, (Number(workspaceClientSettings?.refreshIntervalSec) || 60) * 1000);
    const folderPreviewDepth = Math.max(0, Number(workspaceClientSettings?.folderPreviewDepth) || 0);

    // ── Stable refs (never trigger re-renders) ────────────────────────────────
    const expandedRef     = useRef(expanded);
    const lastSigRef      = useRef('');
    const pendingRootRef  = useRef(null);
    const rootRequestRef  = useRef(0);
    const treeRevisionRef = useRef(0);
    const rafRef          = useRef(0);
    const pendingSubtreeRef = useRef(new Map());
    // KEY FIX: keep a ref to the latest loadTree so the setInterval never
    // holds a stale closure over the initial tree=null state.
    const loadTreeFnRef   = useRef(null);
    const loadWorkspaceIndexStatusRef = useRef(null);
    const nodeMapRef      = useRef(new Map());
    const onFileSelectRef = useRef(onFileSelect);
    const onFolderSelectRef = useRef(onFolderSelect);
    const onOpenEditorRef = useRef(onOpenEditor);
    const loadPreviewRef  = useRef(null);
    const loadSubtreeRef  = useRef(null);
    const sidebarRef      = useRef(null);
    const uploadInputRef  = useRef(null);
    const uploadTargetRef = useRef('.');
    const uploadProgressTimerRef = useRef(0);
    const dragExpandRef    = useRef({ path: null, timer: 0 });
    const folderChartCacheRef = useRef(new Map());
    const folderChartPayloadRef = useRef(null);
    const folderChartPathRef = useRef(null);
    const headerMenuRef = useRef(null);
    const headerMenuButtonRef = useRef(null);
    const showHiddenRef   = useRef(showHidden);
    const visibleRef      = useRef(visible);
    const activeRef       = useRef(active ?? visible);
    const dragDepthRef    = useRef(0);
    const dropTargetRef   = useRef(dropTarget);
    const dragActiveRef   = useRef(dragActive);
    const dragModeRef     = useRef(dragMode);
    const moveEntryToTargetRef = useRef(null);
    const selectedPathRef = useRef(selectedPath);
    const pendingProgrammaticFileClickRef = useRef(null);
    const previewRef      = useRef(preview);

    // Sync mutable refs each render
    onFileSelectRef.current = onFileSelect;
    onFolderSelectRef.current = onFolderSelect;
    onOpenEditorRef.current = onOpenEditor;
    useEffect(() => { expandedRef.current = expanded; }, [expanded]);
    useEffect(() => { showHiddenRef.current = showHidden; }, [showHidden]);
    useEffect(() => { visibleRef.current = visible; }, [visible]);
    useEffect(() => { activeRef.current = active ?? visible; }, [active, visible]);
    useEffect(() => { dropTargetRef.current = dropTarget; }, [dropTarget]);

    const clearUploadProgressTimer = useCallback(() => {
        if (!uploadProgressTimerRef.current) return;
        clearTimeout(uploadProgressTimerRef.current);
        uploadProgressTimerRef.current = 0;
    }, []);

    useEffect(() => () => clearUploadProgressTimer(), [clearUploadProgressTimer]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const syncScale = () => {
            setExplorerScale(resolveWorkspaceScale({
                stored: getLocalStorageItem(WORKSPACE_SCALE_STORAGE_KEY),
                ...readWorkspaceScaleEnvironment(),
            }));
        };

        syncScale();

        const onResize = () => syncScale();
        const onFocus = () => syncScale();
        const onStorage = (event) => {
            if (!event || event.key === null || event.key === WORKSPACE_SCALE_STORAGE_KEY) syncScale();
        };

        window.addEventListener('resize', onResize);
        window.addEventListener('focus', onFocus);
        window.addEventListener('storage', onStorage);

        const pointerMedia = window.matchMedia?.('(pointer: coarse)');
        const hoverMedia = window.matchMedia?.('(hover: none)');
        const addMediaListener = (media, handler) => {
            if (!media) return;
            if (media.addEventListener) media.addEventListener('change', handler);
            else if (media.addListener) media.addListener(handler);
        };
        const removeMediaListener = (media, handler) => {
            if (!media) return;
            if (media.removeEventListener) media.removeEventListener('change', handler);
            else if (media.removeListener) media.removeListener(handler);
        };

        addMediaListener(pointerMedia, onResize);
        addMediaListener(hoverMedia, onResize);

        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('storage', onStorage);
            removeMediaListener(pointerMedia, onResize);
            removeMediaListener(hoverMedia, onResize);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const syncPwaDisplayScale = () => {
            const next = readStoredPwaDisplayScalePercent();
            setPwaDisplayScalePercent(next);
            setPwaDisplayScaleDraft(String(next));
        };
        const onStorage = (event) => {
            if (!event || event.key === null || event.key === PWA_DISPLAY_SCALE_STORAGE_KEY) syncPwaDisplayScale();
        };

        window.addEventListener('focus', syncPwaDisplayScale);
        window.addEventListener('storage', onStorage);
        window.addEventListener(PWA_DISPLAY_SCALE_EVENT, syncPwaDisplayScale);
        return () => {
            window.removeEventListener('focus', syncPwaDisplayScale);
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(PWA_DISPLAY_SCALE_EVENT, syncPwaDisplayScale);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const syncWorkspaceClientSettings = () => {
            setWorkspaceClientSettings(readWorkspaceClientSettings());
        };

        const onStorage = (event) => {
            if (!event || event.key === null
                || event.key === WORKSPACE_REFRESH_INTERVAL_STORAGE_KEY
                || event.key === WORKSPACE_FOLDER_PREVIEW_DEPTH_STORAGE_KEY) {
                syncWorkspaceClientSettings();
            }
        };
        const onFocus = () => syncWorkspaceClientSettings();
        const onWorkspaceClientSettingsUpdated = (event) => {
            const next = event?.detail?.settings;
            if (next && typeof next === 'object') {
                setWorkspaceClientSettings({
                    refreshIntervalSec: Number(next.refreshIntervalSec) || 60,
                    folderPreviewDepth: Math.max(0, Number(next.folderPreviewDepth) || 0),
                });
                return;
            }
            syncWorkspaceClientSettings();
        };

        window.addEventListener('focus', onFocus);
        window.addEventListener('storage', onStorage);
        window.addEventListener(WORKSPACE_CLIENT_SETTINGS_EVENT, onWorkspaceClientSettingsUpdated);
        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(WORKSPACE_CLIENT_SETTINGS_EVENT, onWorkspaceClientSettingsUpdated);
        };
    }, []);

    // Listen for reveal-path events (e.g., from tab strip "reveal in explorer")
    useEffect(() => {
        const handleReveal = (e) => {
            const path = e?.detail?.path;
            if (!path) return;
            // Expand all parent directories
            const parts = path.split('/');
            const parents = [];
            for (let i = 1; i < parts.length; i++) {
                parents.push(parts.slice(0, i).join('/'));
            }
            if (parents.length) {
                setExpanded((prev) => {
                    const next = new Set(prev);
                    next.add('.');
                    for (const p of parents) next.add(p);
                    return next;
                });
            }
            setSelectedPath(path);
            // Scroll the row into view after a tick
            requestAnimationFrame(() => {
                const row = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
                if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        };
        window.addEventListener('workspace-reveal-path', handleReveal);
        return () => window.removeEventListener('workspace-reveal-path', handleReveal);
    }, []);

    // Listen for hamburger menu "Show/Hide hidden files" toggle
    useEffect(() => {
        const onToggleHidden = (e: any) => {
            const next = Boolean(e?.detail?.showHidden);
            setShowHidden(next);
            showHiddenRef.current = next;
            treeRevisionRef.current += 1;
            rootRequestRef.current += 1;
            pendingSubtreeRef.current.clear();
            setWorkspaceVisibility(true, next).catch(() => { setShowHidden(next); });
            lastSigRef.current = '';
            loadTreeFnRef.current?.();
        };
        const onWorkspaceAction = (e: any) => {
            const action = e?.detail?.action;
            if (action === 'new-file') handleMenuCreateFile();
            else if (action === 'refresh') handleMenuRefresh();
            else if (action === 'reindex') handleWorkspaceReindex();
        };
        window.addEventListener('piclaw:toggle-hidden-files', onToggleHidden);
        window.addEventListener('piclaw:workspace-action', onWorkspaceAction);
        return () => {
            window.removeEventListener('piclaw:toggle-hidden-files', onToggleHidden);
            window.removeEventListener('piclaw:workspace-action', onWorkspaceAction);
        };
    }, []);
    useEffect(() => { dragActiveRef.current = dragActive; }, [dragActive]);
    useEffect(() => { dragModeRef.current = dragMode; }, [dragMode]);
    useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);
    useEffect(() => { previewRef.current = preview; }, [preview]);

    useEffect(() => {
        if (!headerMenuOpen) return undefined;

        const handleDocPointer = (event) => {
            const target = event?.target;
            if (!(target instanceof Element)) return;
            if (headerMenuRef.current?.contains(target)) return;
            if (headerMenuButtonRef.current?.contains(target)) return;
            setHeaderMenuOpen(false);
        };

        const handleEscape = (event) => {
            if (event?.key === 'Escape') {
                setHeaderMenuOpen(false);
                headerMenuButtonRef.current?.focus?.();
            }
        };

        document.addEventListener('mousedown', handleDocPointer);
        document.addEventListener('touchstart', handleDocPointer, { passive: true });
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleDocPointer);
            document.removeEventListener('touchstart', handleDocPointer);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [headerMenuOpen]);

    // ── loadPreview ───────────────────────────────────────────────────────────
    const loadPreview = async (path, options = {}) => {
        const autoOpen = Boolean(options?.autoOpen);
        const normalized = String(path || '').trim();
        setLoadingPreview(true);
        setPreview(null);
        setDownloadId(null);
        try {
            const data = await getWorkspaceFile(normalized, 20000);
            if (autoOpen && normalized && shouldAutoOpenWorkspaceFile(normalized, data, {
                resolvePane: (context) => paneRegistry.resolve(context),
            })) {
                onOpenEditorRef.current?.(normalized, data);
                return data;
            }
            setPreview(data);
            return data;
        } catch (err) {
            const failure = { error: err.message || 'Failed to load preview' };
            setPreview(failure);
            return failure;
        } finally {
            setLoadingPreview(false);
        }
    };
    loadPreviewRef.current = loadPreview;

    const loadWorkspaceIndexStatus = useCallback(async () => {
        try {
            const status = await getWorkspaceIndexStatus('all');
            setWorkspaceIndexStatus(status);
            return status;
        } catch (err) {
            console.warn('[workspace-explorer] Failed to load workspace index status:', err);
            return null;
        }
    }, []);
    loadWorkspaceIndexStatusRef.current = loadWorkspaceIndexStatus;

    const refreshWorkspaceIndexStatus = useCallback(() => {
        loadWorkspaceIndexStatusRef.current?.();
    }, []);

    // ── loadTree ──────────────────────────────────────────────────────────────
    const loadTree = async () => {
        if (!visibleRef.current) return;
        const requestId = ++rootRequestRef.current;
        const requestRevision = treeRevisionRef.current;
        const requestShowHidden = showHiddenRef.current;
        try {
            // Use depth 1 for root to avoid scanning huge workspaces upfront.
            // Individual folders are expanded on-demand via loadSubtree().
            const data = await getWorkspaceTree('', 1, requestShowHidden);
            if (requestId !== rootRequestRef.current || requestRevision !== treeRevisionRef.current) return;
            const sig = treeSignature(data.root, expandedRef.current, requestShowHidden);
            if (sig === lastSigRef.current) {
                // Structure unchanged – just clear the initial spinner if needed.
                setInitialLoad(false);
                return;
            }
            pendingRootRef.current = { root: data.root, sig, requestId, requestRevision, truncated: Boolean(data.truncated) };
            // Batch the DOM update into a single rAF; coalesce rapid calls.
            if (!rafRef.current) {
                rafRef.current = requestAnimationFrame(() => {
                    rafRef.current = 0;
                    const pending = pendingRootRef.current;
                    if (!pending || pending.requestId !== rootRequestRef.current || pending.requestRevision !== treeRevisionRef.current) return;
                    lastSigRef.current = pending.sig;
                    // mergeTree returns prev unchanged when content is identical,
                    // so Preact skips diffing rows that didn't change.
                    setTree(prev => mergeTree(prev, pending.root, { preserveMissing: pending.truncated }));
                    setInitialLoad(false);
                });
            }
        } catch (err) {
            if (requestId !== rootRequestRef.current || requestRevision !== treeRevisionRef.current) return;
            setError(err.message || 'Failed to load workspace');
            setInitialLoad(false);
        }
    };

    const loadSubtree = async (path) => {
        if (!path) return;
        const revision = treeRevisionRef.current;
        const requestToken = Symbol(path);
        pendingSubtreeRef.current.set(path, requestToken);
        try {
            const data = await getWorkspaceTree(path, 1, showHiddenRef.current);
            if (revision !== treeRevisionRef.current || pendingSubtreeRef.current.get(path) !== requestToken) return;
            setTree(prev => replaceNodeAtPath(prev, path, data.root, { preserveMissing: Boolean(data.truncated) }));
        } catch (err) {
            if (revision !== treeRevisionRef.current || pendingSubtreeRef.current.get(path) !== requestToken) return;
            setError(err.message || 'Failed to load workspace');
        } finally {
            if (pendingSubtreeRef.current.get(path) === requestToken) {
                pendingSubtreeRef.current.delete(path);
            }
        }
    };
    loadSubtreeRef.current = loadSubtree;

    const resolveDropTargetPath = useCallback(() => {
        const selected = selectedPath;
        if (!selected) return '.';
        const node = nodeMapRef.current?.get(selected);
        if (node && node.type === 'dir') return node.path;
        if (selected === '.' || !selected.includes('/')) return '.';
        const parts = selected.split('/');
        parts.pop();
        const parent = parts.join('/');
        return parent || '.';
    }, [selectedPath]);

    const resolveDropTargetFromElement = useCallback((element) => {
        const row = element?.closest?.('.workspace-row');
        if (!row) return null;
        const path = row.dataset.path;
        const type = row.dataset.type;
        if (!path) return null;
        if (type === 'dir') return path;
        if (path.includes('/')) {
            const parts = path.split('/');
            parts.pop();
            return parts.join('/') || '.';
        }
        return '.';
    }, []);

    const resolveDropTargetFromEvent = useCallback((event) => {
        return resolveDropTargetFromElement(event?.target || null);
    }, [resolveDropTargetFromElement]);

    const updateDropTarget = useCallback((value) => {
        dropTargetRef.current = value;
        setDropTarget(value);
    }, []);

    const clearDragExpandTimer = useCallback(() => {
        const current = dragExpandRef.current;
        if (current?.timer) clearTimeout(current.timer);
        dragExpandRef.current = { path: null, timer: 0 };
    }, []);

    const scheduleDragExpand = useCallback((targetPath) => {
        if (!targetPath || targetPath === '.') {
            clearDragExpandTimer();
            return;
        }
        const node = nodeMapRef.current?.get(targetPath);
        if (!node || node.type !== 'dir') {
            clearDragExpandTimer();
            return;
        }
        if (expandedRef.current?.has(targetPath)) {
            clearDragExpandTimer();
            return;
        }
        if (dragExpandRef.current?.path === targetPath) return;

        clearDragExpandTimer();
        const timer = setTimeout(() => {
            dragExpandRef.current = { path: null, timer: 0 };
            loadSubtreeRef.current?.(targetPath);
            setExpanded((prev) => {
                const next = new Set(prev);
                next.add(targetPath);
                return next;
            });
        }, 600);
        dragExpandRef.current = { path: targetPath, timer };
    }, [clearDragExpandTimer]);

    const resolveCreateTargetPath = useCallback((path) => {
        if (!path) return '.';
        const node = nodeMapRef.current?.get(path);
        if (node && node.type === 'dir') return node.path;
        if (path === '.' || !path.includes('/')) return '.';
        const parts = path.split('/');
        parts.pop();
        const parent = parts.join('/');
        return parent || '.';
    }, []);

    /** Rename a workspace entry in place (the tree edits the name inline). */
    const renameEntry = useCallback(async (targetPath, rawName) => {
        if (!targetPath || targetPath === '.') return;
        const nextName = String(rawName || '').trim();
        const node = nodeMapRef.current?.get(targetPath);
        const currentName = (node?.name || targetPath.split('/').pop() || targetPath).trim();
        if (!nextName || nextName === currentName) {
            loadSubtreeRef.current?.(targetPath.includes('/') ? (targetPath.split('/').slice(0, -1).join('/') || '.') : '.');
            return;
        }

        try {
            const result = await renameWorkspaceFile(targetPath, nextName);
            const nextPath = result?.path || targetPath;
            const parent = targetPath.includes('/')
                ? (targetPath.split('/').slice(0, -1).join('/') || '.')
                : '.';

            setError(null);

            // Notify listeners (tab store, etc.) about the rename
            window.dispatchEvent(new CustomEvent('workspace-file-renamed', {
                detail: { oldPath: targetPath, newPath: nextPath, type: node?.type || 'file' }
            }));

            if (node?.type === 'dir') {
                setExpanded((prev) => {
                    const next = new Set();
                    for (const entry of prev) {
                        if (entry === targetPath) {
                            next.add(nextPath);
                        } else if (entry.startsWith(`${targetPath}/`)) {
                            next.add(`${nextPath}${entry.slice(targetPath.length)}`);
                        } else {
                            next.add(entry);
                        }
                    }
                    return next;
                });
            }

            setSelectedPath(nextPath);
            if (node?.type === 'dir') {
                setPreview(null);
                setLoadingPreview(false);
                setDownloadId(null);
            } else {
                loadPreviewRef.current?.(nextPath);
            }
            loadSubtreeRef.current?.(parent);
            refreshWorkspaceIndexStatus();
        } catch (err) {
            setError(err?.message || 'Failed to rename file');
        }
    }, [refreshWorkspaceIndexStatus]);

    const createUntitledFile = useCallback(async (targetPath) => {
        const base = 'untitled';
        const ext = '.md';
        const folder = targetPath || '.';

        for (let i = 0; i < 50; i += 1) {
            const suffix = i === 0 ? '' : `-${i}`;
            const name = `${base}${suffix}${ext}`;
            try {
                const result = await createWorkspaceFile(folder, name, '');
                const nextPath = result?.path || (folder === '.' ? name : `${folder}/${name}`);
                if (folder && folder !== '.') {
                    setExpanded((prev) => new Set([...prev, folder]));
                }
                setSelectedPath(nextPath);
                setError(null);
                loadSubtreeRef.current?.(folder);
                loadPreviewRef.current?.(nextPath);
                refreshWorkspaceIndexStatus();
                return;
            } catch (err) {
                if (err?.status === 409 || err?.code === 'file_exists') {
                    continue;
                }
                setError(err?.message || 'Failed to create file');
                return;
            }
        }

        setError('Failed to create file (untitled name already in use).');
    }, []);

    const handleCreateFileClick = useCallback((event) => {
        event?.stopPropagation?.();
        if (uploading) return;
        const target = resolveCreateTargetPath(selectedPathRef.current);
        createUntitledFile(target);
    }, [uploading, resolveCreateTargetPath, createUntitledFile]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handler = (event) => {
            const updates = event?.detail?.updates || [];
            if (!Array.isArray(updates) || updates.length === 0) return;
            treeRevisionRef.current += 1;
            rootRequestRef.current += 1;
            pendingSubtreeRef.current.clear();
            setTree(prev => {
                const next = mergeWorkspaceTreeUpdates(prev, updates);
                if (next) {
                    lastSigRef.current = treeSignature(next, expandedRef.current, showHiddenRef.current);
                }
                setInitialLoad(false);
                return next;
            });

            for (const update of updates) {
                if (!update?.truncated) continue;
                const path = update.path || '.';
                if (path === '.') {
                    lastSigRef.current = '';
                    loadTreeFnRef.current?.();
                } else {
                    loadSubtreeRef.current?.(path);
                }
            }

            const selected = selectedPathRef.current;
            const shouldRefreshStarburst = Boolean(selected) && updates.some((update) => {
                const path = update?.path || '';
                if (!path || path === '.') return true;
                return selected === path
                    || selected.startsWith(`${path}/`)
                    || path.startsWith(`${selected}/`);
            });

            if (shouldRefreshStarburst) {
                folderChartCacheRef.current.clear();
            }

            refreshWorkspaceIndexStatus();

            // If the selected file changed on disk, refresh the preview.
            if (!selected || !previewRef.current) return;
            const node = nodeMapRef.current?.get(selected);
            if (node && node.type === 'dir') return;
            const shouldRefresh = updates.some((update) => {
                const path = update?.path || '';
                if (!path || path === '.') return true;
                return selected === path || selected.startsWith(`${path}/`);
            });
            if (shouldRefresh) {
                loadPreviewRef.current?.(selected);
            }
        };
        window.addEventListener('workspace-update', handler);
        return () => window.removeEventListener('workspace-update', handler);
    }, []);

    // Always point at the freshest loadTree — interval calls this ref,
    // so it always has the current closure (tree, expanded, etc.).
    loadTreeFnRef.current = loadTree;

    const updateVisibility = useRef(() => {
        if (typeof window === 'undefined') return;
        const media = window.matchMedia('(min-width: 1024px) and (orientation: landscape)');
        const active = activeRef.current ?? visibleRef.current;
        const visible = document.visibilityState !== 'hidden'
            && (active || (media.matches && visibleRef.current));
        setWorkspaceVisibility(visible, showHiddenRef.current).catch((error) => {
            console.debug('[workspace-explorer] Workspace visibility ping failed.', error, {
                visible,
                showHidden: showHiddenRef.current,
            });
        });
    }).current;

    const debouncedVisibilityRef = useRef(0);
    const scheduleVisibilityUpdate = useRef(() => {
        if (debouncedVisibilityRef.current) {
            clearTimeout(debouncedVisibilityRef.current);
        }
        debouncedVisibilityRef.current = setTimeout(() => {
            debouncedVisibilityRef.current = 0;
            updateVisibility();
        }, 2000);
    }).current;

    useEffect(() => {
        if (visibleRef.current) {
            loadTreeFnRef.current?.();
            loadWorkspaceIndexStatusRef.current?.();
        }
        scheduleVisibilityUpdate();
    }, [visible, active]);

    useEffect(() => {
        if (!visible) return undefined;
        const refreshVisibleWorkspace = () => {
            if (!visibleRef.current) return;
            loadTreeFnRef.current?.();
            loadWorkspaceIndexStatusRef.current?.();
        };
        return createVisibleInterval(refreshVisibleWorkspace, refreshIntervalMs);
    }, [refreshIntervalMs, visible]);

    useEffect(() => {
        updateVisibility();

        const media = window.matchMedia('(min-width: 1024px) and (orientation: landscape)');
        const onVisibilityChange = () => scheduleVisibilityUpdate();
        if (media.addEventListener) {
            media.addEventListener('change', onVisibilityChange);
        } else if (media.addListener) {
            media.addListener(onVisibilityChange);
        }
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
            if (media.removeEventListener) {
                media.removeEventListener('change', onVisibilityChange);
            } else if (media.removeListener) {
                media.removeListener(onVisibilityChange);
            }
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (debouncedVisibilityRef.current) {
                clearTimeout(debouncedVisibilityRef.current);
                debouncedVisibilityRef.current = 0;
            }
            setWorkspaceVisibility(false, showHiddenRef.current).catch((error) => {
                console.debug('[workspace-explorer] Workspace visibility teardown ping failed.', error, {
                    showHidden: showHiddenRef.current,
                });
            });
        };
    }, []);

    // ── Flattened visible rows ────────────────────────────────────────────────
    const rows = useMemo(() => flattenTree(tree, expanded, showHidden), [tree, expanded, showHidden]);
    const nodeMap = useMemo(() => new Map(rows.map(r => [r.node.path, r.node])), [rows]);
    nodeMapRef.current = nodeMap;
    const selectedNode = selectedPath ? nodeMapRef.current.get(selectedPath) : null;
    const selectedIsDir = selectedNode?.type === 'dir';
    const [, setAddonActionsRevision] = useState(0);
    const [addonActionError, setAddonActionError] = useState('');
    useEffect(() => subscribeWorkspaceActions(() => setAddonActionsRevision(n => n + 1)), []);
    const addonChatJid = typeof (window as any).__piclawCurrentChatJid === 'string' ? (window as any).__piclawCurrentChatJid : null;
    const addonContext = workspaceActionContext(selectedNode, addonChatJid);
    const addonActions = listWorkspaceActions(addonContext);
    const runAddonAction = async (id) => {
        setHeaderMenuOpen(false);
        setAddonActionError('');
        try {
            await invokeWorkspaceAction(id, workspaceActionContext(nodeMapRef.current.get(selectedPathRef.current), addonChatJid));
        } catch (error) { setAddonActionError(error instanceof Error ? error.message : 'Add-on action failed.'); }
    };

    useEffect(() => {
        if (!selectedPath || !selectedIsDir || !folderChartOpen) {
            setFolderChart(null);
            folderChartPayloadRef.current = null;
            folderChartPathRef.current = null;
            return;
        }

        if (folderPreviewDepth <= 0) {
            setFolderChart({ loading: false, error: null, payload: null, disabled: true });
            folderChartPayloadRef.current = null;
            folderChartPathRef.current = null;
            return;
        }

        const fetchPath = selectedPath;
        const cacheKey = `${showHidden ? 'hidden' : 'visible'}:${folderPreviewDepth}:${selectedPath}`;
        const cache = folderChartCacheRef.current;

        const cached = cache.get(cacheKey);
        if (cached?.root) {
            cache.delete(cacheKey);
            cache.set(cacheKey, cached);
            const payload = createFolderStarburstPayload(cached.root, Boolean(cached.truncated));
            if (payload) {
                folderChartPayloadRef.current = payload;
                folderChartPathRef.current = selectedPath;
                setFolderChart({ loading: false, error: null, payload, disabled: false });
            }
            return;
        }

        const lastPayload = folderChartPayloadRef.current;
        const lastPath = folderChartPathRef.current;
        setFolderChart({ loading: true, error: null, payload: lastPath === selectedPath ? lastPayload : null, disabled: false });

        getWorkspaceTree(selectedPath, folderPreviewDepth, showHidden)
            .then((data) => {
                if (selectedPathRef.current !== fetchPath) return;
                const entry = { root: data?.root, truncated: Boolean(data?.truncated) };
                cache.delete(cacheKey);
                cache.set(cacheKey, entry);
                while (cache.size > STARBURST_CACHE_LIMIT) {
                    const oldest = cache.keys().next().value;
                    if (!oldest) break;
                    cache.delete(oldest);
                }
                const payload = createFolderStarburstPayload(entry.root, entry.truncated);
                folderChartPayloadRef.current = payload;
                folderChartPathRef.current = selectedPath;
                setFolderChart({ loading: false, error: null, payload, disabled: false });
            })
            .catch((err) => {
                if (selectedPathRef.current !== fetchPath) return;
                setFolderChart({ loading: false, error: err?.message || 'Failed to load folder size chart', payload: lastPath === selectedPath ? lastPayload : null, disabled: false });
            });
    }, [selectedPath, selectedIsDir, showHidden, folderPreviewDepth, folderChartOpen]);

    const canEdit = Boolean(preview && preview.kind === 'text' && !selectedIsDir && (!preview.size || preview.size <= 256 * 1024));
    const editTitle = canEdit
        ? 'Open in editor'
        : preview?.size > 256 * 1024
            ? 'File too large to edit'
            : 'File is not editable';

    const selectedHasOpenableTab = Boolean(selectedPath && !selectedIsDir && hasOpenableWorkspaceTab(selectedPath));
    const selectedCanRename = Boolean(selectedPath && selectedPath !== '.');
    const selectedCanDelete = Boolean(selectedPath && !selectedIsDir);
    const selectedCanDownload = Boolean(selectedPath && !selectedIsDir);
    const selectedFolderDownloadUrl = selectedPath && selectedIsDir
        ? getWorkspaceDownloadUrl(selectedPath, showHidden)
        : null;
    const workspaceIndexLabel = describeWorkspaceIndexState(workspaceIndexStatus);
    const workspaceIndexTitle = buildWorkspaceIndexTitle(workspaceIndexStatus);
    const workspaceIndexState = workspaceIndexStatus?.state || 'never_indexed';
    const showWorkspaceIndexIndicator = workspaceIndexState !== 'ready';

    const closeHeaderMenu = useCallback(() => setHeaderMenuOpen(false), []);

    const handlePwaDisplayScaleInput = useCallback((event) => {
        setPwaDisplayScaleDraft(String(event?.currentTarget?.value ?? ''));
    }, []);

    const commitPwaDisplayScale = useCallback((value) => {
        const next = persistPwaDisplayScalePercent(value);
        setPwaDisplayScalePercent(next);
        setPwaDisplayScaleDraft(String(next));
    }, []);

    const handlePwaDisplayScaleCommit = useCallback((event) => {
        commitPwaDisplayScale(event?.currentTarget?.value);
    }, [commitPwaDisplayScale]);

    const handlePwaDisplayScaleKeyDown = useCallback((event) => {
        if (event?.key === 'Enter') {
            commitPwaDisplayScale(event?.currentTarget?.value);
            event?.currentTarget?.blur?.();
        }
    }, [commitPwaDisplayScale]);

    const runMenuAction = useCallback(async (fn) => {
        closeHeaderMenu();
        try {
            await fn?.();
        } catch (err) {
            console.warn('[workspace-explorer] Header menu action failed:', err);
        }
    }, [closeHeaderMenu]);

    const handleWorkspaceReindex = useCallback(async (event) => {
        event?.stopPropagation?.();
        setWorkspaceReindexing(true);
        setWorkspaceIndexStatus((prev) => ({
            scope: 'all',
            last_indexed_at: prev?.last_indexed_at || null,
            last_error: null,
            indexed_file_count: prev?.indexed_file_count || 0,
            roots: prev?.roots || [],
            updated_at: prev?.updated_at || null,
            state: 'indexing',
        }));
        try {
            const status = await reindexWorkspace('all');
            setWorkspaceIndexStatus(status);
            setError(null);
            lastSigRef.current = '';
            loadTreeFnRef.current?.();
        } catch (err) {
            const message = err?.message || 'Failed to reindex workspace';
            setWorkspaceIndexStatus((prev) => ({
                scope: 'all',
                last_indexed_at: prev?.last_indexed_at || null,
                last_error: message,
                indexed_file_count: prev?.indexed_file_count || 0,
                roots: prev?.roots || [],
                updated_at: prev?.updated_at || null,
                state: 'failed',
            }));
            setError(message);
        } finally {
            setWorkspaceReindexing(false);
        }
    }, []);

    const getEventTargetElement = (event) => {
        const target = event?.target;
        if (target instanceof Element) return target;
        return target?.parentElement || null;
    };

    // Refresh button: force-invalidate signature so a changed tree is picked up
    // even if the visible signature hasn't changed (e.g. mtime-only updates).
    const handleRefreshClick = useRef(() => {
        treeRevisionRef.current += 1;
        rootRequestRef.current += 1;
        pendingSubtreeRef.current.clear();
        lastSigRef.current = '';
        loadTreeFnRef.current();
        loadWorkspaceIndexStatusRef.current?.();
        const openPaths = Array.from(expandedRef.current || []).filter((p) => p && p !== '.');
        openPaths.forEach((p) => loadSubtreeRef.current?.(p));
    }).current;

    const clearSelection = useRef(() => {
        pendingProgrammaticFileClickRef.current = null;
        setSelectedPath(null);
        setPreview(null);
        setDownloadId(null);
        setLoadingPreview(false);
    }).current;

    const handleToggleHidden = useRef(() => {
        setShowHidden((prev) => {
            const next = !prev;
            if (typeof window !== 'undefined') {
                setLocalStorageItem('workspaceShowHidden', String(next));
            }
            showHiddenRef.current = next;
            treeRevisionRef.current += 1;
            rootRequestRef.current += 1;
            pendingSubtreeRef.current.clear();
            setWorkspaceVisibility(true, next).catch((error) => {
                console.debug('[workspace-explorer] Workspace visibility refresh after toggling hidden files failed.', error, {
                    showHidden: next,
                });
            });
            lastSigRef.current = '';
            loadTreeFnRef.current?.();
            const openPaths = Array.from(expandedRef.current || []).filter((p) => p && p !== '.');
            openPaths.forEach((p) => loadSubtreeRef.current?.(p));
            return next;
        });
    }).current;

    const handleBackgroundClick = useRef((e) => {
        const targetEl = getEventTargetElement(e);
        // Row clicks inside the tree's shadow root arrive retargeted to its host.
        if (targetEl?.closest?.('[data-path], .workspace-tree-pierre')) return;
        clearSelection();
    }).current;

    const deleteFileAtPath = useCallback(async (path) => {
        if (!path) return;
        const filename = path.split('/').pop() || path;
        const confirmed = window.confirm(`Delete "${filename}"? This cannot be undone.`);
        if (!confirmed) return;

        try {
            await deleteWorkspaceFile(path);
            const parent = path.includes('/') ? (path.split('/').slice(0, -1).join('/') || '.') : '.';
            if (selectedPathRef.current === path) {
                clearSelection();
            }
            loadSubtreeRef.current?.(parent);
            setError(null);
            refreshWorkspaceIndexStatus();
        } catch (err) {
            setPreview(prev => ({ ...(prev || {}), error: err.message || 'Failed to delete file' }));
        }
    }, [clearSelection]);

    const handleDownload = useCallback((path = selectedPath) => {
        if (!path) return;
        triggerWorkspaceDownload(getWorkspaceFileDownloadUrl(path));
    }, [selectedPath]);

    const handleDeleteFile = async () => {
        if (!selectedPath || selectedIsDir) return;
        await deleteFileAtPath(selectedPath);
    };

    const isFileDrag = (event) => {
        const types = Array.from(event?.dataTransfer?.types || []);
        return types.includes('Files');
    };

    const handleDragEnter = useCallback((event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        if (!dragActiveRef.current) setDragActive(true);
        setDragMode('upload');
        const target = resolveDropTargetFromEvent(event) || resolveDropTargetPath();
        updateDropTarget(target);
        scheduleDragExpand(target);
    }, [resolveDropTargetPath, resolveDropTargetFromEvent, updateDropTarget, scheduleDragExpand]);

    const handleDragOver = useCallback((event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        if (!dragActiveRef.current) setDragActive(true);
        if (dragModeRef.current !== 'upload') {
            setDragMode('upload');
        }
        const target = resolveDropTargetFromEvent(event) || resolveDropTargetPath();
        if (dropTargetRef.current !== target) updateDropTarget(target);
        scheduleDragExpand(target);
    }, [resolveDropTargetPath, resolveDropTargetFromEvent, updateDropTarget, scheduleDragExpand]);

    const handleDragLeave = useCallback((event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
            setDragActive(false);
            setDragMode(null);
            updateDropTarget(null);
            clearDragExpandTimer();
        }
    }, [updateDropTarget, clearDragExpandTimer]);

    const uploadFilesToTarget = useCallback(async (files, targetPath = '.') => {
        if (uploadingRef.current) return;
        const list = Array.from(files || []);
        if (list.length === 0) return;
        uploadingRef.current = true;
        const target = targetPath && targetPath !== '' ? targetPath : '.';
        const targetLabel = target !== '.' ? target : 'workspace root';
        clearUploadProgressTimer();
        setUploading(true);
        setUploadProgress({ current: 0, total: list.length, name: '', percent: 0, done: false, error: null });
        try {
            const uploaded = await uploadFileBatch(
                list,
                async (file, onProgress, index) => {
                    const name = file?.name || `file ${index + 1}`;
                    try {
                        return await uploadWorkspaceFile(file, target, { onProgress });
                    } catch (err) {
                        const status = err?.status;
                        const code = err?.code;
                        if (status === 409 || code === 'file_exists') {
                            const confirmOverwrite = window.confirm(`"${name}" already exists in ${targetLabel}. Overwrite?`);
                            if (!confirmOverwrite) return null;
                            return await uploadWorkspaceFile(file, target, { overwrite: true, onProgress });
                        }
                        throw err;
                    }
                },
                {
                    onProgress: (progress) => setUploadProgress((prev) => ({
                        ...prev,
                        current: progress.current,
                        total: progress.total,
                        name: progress.name,
                        percent: progress.percent,
                    })),
                },
            );
            const lastResult = uploaded.map(({ result }) => result).filter(Boolean).at(-1) || null;
            if (lastResult?.path) {
                pendingProgrammaticFileClickRef.current = lastResult.path;
                setSelectedPath(lastResult.path);
                loadPreviewRef.current?.(lastResult.path);
            }
            loadSubtreeRef.current?.(target);
            refreshWorkspaceIndexStatus();
            setUploadProgress((prev) => ({ ...prev, done: true }));
            clearUploadProgressTimer();
            uploadProgressTimerRef.current = window.setTimeout(() => {
                uploadProgressTimerRef.current = 0;
                setUploadProgress(null);
            }, 1500);
        } catch (err) {
            setError(err.message || 'Failed to upload file');
            setUploadProgress((prev) => prev ? { ...prev, error: err.message || 'Upload failed' } : null);
            clearUploadProgressTimer();
            uploadProgressTimerRef.current = window.setTimeout(() => {
                uploadProgressTimerRef.current = 0;
                setUploadProgress(null);
            }, 4000);
        } finally {
            uploadingRef.current = false;
            setUploading(false);
        }
    }, [clearUploadProgressTimer]);

    const moveEntryToTarget = useCallback(async (sourcePath, targetPath) => {
        if (!sourcePath) return;
        const node = nodeMapRef.current?.get(sourcePath);
        if (!node) return;
        const targetDir = targetPath && targetPath !== '' ? targetPath : '.';
        const sourceParent = sourcePath.includes('/')
            ? (sourcePath.split('/').slice(0, -1).join('/') || '.')
            : '.';
        if (targetDir === sourceParent) return;
        if (!confirmWorkspaceEntryMove(sourcePath, targetDir, node.type, undefined, t)) return;
        try {
            const result = await moveWorkspaceEntry(sourcePath, targetDir);
            const nextPath = result?.path || sourcePath;
            if (node.type === 'dir') {
                setExpanded((prev) => {
                    const next = new Set();
                    for (const entry of prev) {
                        if (entry === sourcePath) {
                            next.add(nextPath);
                        } else if (entry.startsWith(`${sourcePath}/`)) {
                            next.add(`${nextPath}${entry.slice(sourcePath.length)}`);
                        } else {
                            next.add(entry);
                        }
                    }
                    return next;
                });
            }
            setSelectedPath(nextPath);
            if (node.type === 'dir') {
                setPreview(null);
                setLoadingPreview(false);
                setDownloadId(null);
            } else {
                loadPreviewRef.current?.(nextPath);
            }
            loadSubtreeRef.current?.(sourceParent);
            loadSubtreeRef.current?.(targetDir);
            refreshWorkspaceIndexStatus();
        } catch (err) {
            setError(err?.message || 'Failed to move entry');
        }
    }, [t]);
    moveEntryToTargetRef.current = moveEntryToTarget;

    const handleDrop = useCallback(async (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        setDragMode(null);
        setDropTarget(null);
        clearDragExpandTimer();

        const files = Array.from(event?.dataTransfer?.files || []);
        if (files.length === 0) return;
        const target = dropTargetRef.current || resolveDropTargetFromEvent(event) || resolveDropTargetPath();
        await uploadFilesToTarget(files, target);
    }, [resolveDropTargetPath, resolveDropTargetFromEvent, uploadFilesToTarget]);

    const handleFolderHintClick = useCallback((event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const target = event?.currentTarget?.dataset?.folderHintTarget || selectedPathRef.current || '.';
        if (!target) return;
        onFolderSelectRef.current?.(target, nodeMapRef.current.get(target));
    }, []);

    const handleUploadButtonClick = useCallback(() => {
        if (uploading) return;
        const selected = selectedPathRef.current;
        const selectedNode = selected ? nodeMapRef.current?.get(selected) : null;
        uploadTargetRef.current = selectedNode?.type === 'dir' ? selectedNode.path : '.';
        uploadInputRef.current?.click();
    }, [uploading]);

    const handleMenuCreateFile = useCallback(() => {
        runMenuAction(() => handleCreateFileClick(null));
    }, [runMenuAction, handleCreateFileClick]);

    const handleMenuUploadFiles = useCallback(() => {
        runMenuAction(() => handleUploadButtonClick());
    }, [runMenuAction, handleUploadButtonClick]);

    const handleMenuRefresh = useCallback(() => {
        runMenuAction(() => handleRefreshClick());
    }, [runMenuAction, handleRefreshClick]);

    const handleMenuToggleHidden = useCallback(() => {
        runMenuAction(() => handleToggleHidden());
    }, [runMenuAction, handleToggleHidden]);

    const handleMenuOpenTab = useCallback(() => {
        if (!selectedPath || !selectedHasOpenableTab) return;
        runMenuAction(() => onOpenEditorRef.current?.(selectedPath, preview));
    }, [runMenuAction, selectedPath, selectedHasOpenableTab, preview]);

    const handleMenuOpenEditor = useCallback(() => {
        if (!selectedPath || !canEdit) return;
        runMenuAction(() => onOpenEditorRef.current?.(selectedPath, preview));
    }, [runMenuAction, selectedPath, canEdit, preview]);

    const handleMenuRename = useCallback(() => {
        if (!selectedPath || selectedPath === '.') return;
        runMenuAction(() => treeControllerRef.current?.startRename(selectedPath, selectedIsDir ? 'dir' : 'file'));
    }, [runMenuAction, selectedPath, selectedIsDir]);

    const handleMenuDelete = useCallback(() => {
        if (!selectedPath || selectedIsDir) return;
        runMenuAction(() => handleDeleteFile());
    }, [runMenuAction, selectedPath, selectedIsDir, handleDeleteFile]);

    const handleMenuDownload = useCallback(() => {
        if (!selectedPath || selectedIsDir) return;
        runMenuAction(() => handleDownload());
    }, [runMenuAction, selectedPath, selectedIsDir, handleDownload]);

    const handleMenuDownloadFolder = useCallback(() => {
        if (!selectedFolderDownloadUrl) return;
        closeHeaderMenu();
        triggerWorkspaceDownload(selectedFolderDownloadUrl);
    }, [closeHeaderMenu, selectedFolderDownloadUrl]);

    const handleMenuOpenTerminalTab = useCallback(() => {
        closeHeaderMenu();
        onOpenTerminalTab?.();
    }, [closeHeaderMenu, onOpenTerminalTab]);

    const handleMenuOpenVncTab = useCallback(() => {
        closeHeaderMenu();
        onOpenVncTab?.();
    }, [closeHeaderMenu, onOpenVncTab]);

    const handleMenuOpenSettings = useCallback(() => {
        runMenuAction(() => window.dispatchEvent(new CustomEvent('piclaw:open-settings')));
    }, [runMenuAction]);

    // ── File tree (Pierre, #1972) ─────────────────────────────────────────────
    // The tree renders and edits rows; this component keeps loading, actions and selection.
    const selectEntry = useCallback((path, type) => {
        pendingProgrammaticFileClickRef.current = null;
        setSelectedPath(path);
        if (type === 'dir') {
            setPreview(null);
            setDownloadId(null);
            setLoadingPreview(false);
            return;
        }
        const node = nodeMapRef.current.get(path);
        if (node) onFileSelectRef.current?.(node.path, node);
        // Files open straight into a viewer or editor tab; metadata still loads for the actions bar.
        onOpenEditorRef.current?.(path);
        loadPreviewRef.current?.(path);
    }, []);

    const handleTreeExpandedChange = useCallback((paths) => {
        setExpanded((previous) => {
            const next = new Set(['.', ...paths]);
            for (const path of paths) {
                const node = nodeMapRef.current.get(path);
                if (!previous.has(path) && node?.type === 'dir' && node.children === undefined) loadSubtreeRef.current?.(path);
            }
            return next;
        });
    }, []);

    const buildTreeContextMenu = useCallback((item, close) => {
        const menu = document.createElement('div');
        menu.className = 'workspace-menu-dropdown workspace-tree-context-menu';
        menu.setAttribute('role', 'menu');
        const add = (label, run, options: { danger?: boolean } = {}) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `workspace-menu-item${options.danger ? ' danger' : ''}`;
            button.setAttribute('role', 'menuitem');
            button.textContent = label;
            button.addEventListener('click', () => { close(); run(); });
            menu.appendChild(button);
        };
        const node = nodeMapRef.current.get(item.path);
        if (item.type === 'file') {
            add(t('workspace.openInTab'), () => selectEntry(item.path, 'file'));
            add(t('workspace.download'), () => triggerWorkspaceDownload(getWorkspaceFileDownloadUrl(item.path)));
        } else {
            add(t('workspace.newFile'), () => createUntitledFile(item.path));
            add(t('workspace.uploadToFolder'), () => { uploadTargetRef.current = item.path; uploadInputRef.current?.click(); });
            add(t('workspace.addFolderHint'), () => onFolderSelectRef.current?.(item.path, node));
            add(t('workspace.downloadZip'), () => triggerWorkspaceDownload(getWorkspaceDownloadUrl(item.path, showHiddenRef.current)));
        }
        add(t('workspace.renameEntry'), () => treeControllerRef.current?.startRename(item.path, item.type));
        if (item.type === 'file') add(t('workspace.deleteFile'), () => void deleteFileAtPath(item.path), { danger: true });
        return menu;
    }, [createUntitledFile, deleteFileAtPath, selectEntry, t]);

    const treeHostRef = useRef(null);
    const treeControllerRef = useRef(null);
    const treeCallbacksRef = useRef(null);
    treeCallbacksRef.current = {
        onSelect: selectEntry,
        onExpandedChange: handleTreeExpandedChange,
        onRename: (path, name) => void renameEntry(path, name),
        onMove: (path, targetDir) => void moveEntryToTarget(path, targetDir),
        renderContextMenu: buildTreeContextMenu,
    };
    const treeOptions = () => ({
        root: tree,
        expanded,
        selectedPath,
        onSelect: (...args) => treeCallbacksRef.current.onSelect(...args),
        onExpandedChange: (...args) => treeCallbacksRef.current.onExpandedChange(...args),
        onRename: (...args) => treeCallbacksRef.current.onRename(...args),
        onMove: (...args) => treeCallbacksRef.current.onMove(...args),
        renderContextMenu: (...args) => treeCallbacksRef.current.renderContextMenu(...args),
    });
    const treeOptionsRef = useRef(treeOptions);
    treeOptionsRef.current = treeOptions;
    const hasTree = Boolean(tree);

    useEffect(() => {
        const host = treeHostRef.current;
        if (!hasTree || !host) return undefined;
        let disposed = false;
        loadWorkspaceTreeModule()
            .then((module) => {
                if (disposed) return;
                treeControllerRef.current = module.mountWorkspaceTree(host, treeOptionsRef.current());
            })
            .catch((loadError) => {
                if (!disposed) setError(`Failed to load the file tree: ${loadError?.message || loadError}`);
            });
        return () => {
            disposed = true;
            treeControllerRef.current?.dispose();
            treeControllerRef.current = null;
        };
    }, [hasTree]);

    useEffect(() => {
        treeControllerRef.current?.update(treeOptionsRef.current());
    }, [tree, expanded, selectedPath]);

    const handleUploadInputChange = useCallback(async (event) => {
        const files = Array.from(event?.target?.files || []);
        if (files.length === 0) return;
        const target = uploadTargetRef.current || '.';
        await uploadFilesToTarget(files, target);
        uploadTargetRef.current = '.';
        if (event?.target) event.target.value = '';
    }, [uploadFilesToTarget]);

    // ── Render ────────────────────────────────────────────────────────────────
    return html`
        <aside
            class=${`workspace-sidebar${dragActive ? ' workspace-drop-active' : ''}`}
            data-workspace-scale=${explorerScale}
            ref=${sidebarRef}
            onDragEnter=${handleDragEnter}
            onDragOver=${handleDragOver}
            onDragLeave=${handleDragLeave}
            onDrop=${handleDrop}
        >
            <input type="file" multiple style="display:none" ref=${uploadInputRef} onChange=${handleUploadInputChange} />
            <div class="workspace-header">
                <div class="workspace-header-left">
                    <div class="workspace-menu-wrap">
                        <button
                            ref=${headerMenuButtonRef}
                            class=${`workspace-menu-button${headerMenuOpen ? ' active' : ''}`}
                            onClick=${(e) => {
                                e.stopPropagation();
                                setHeaderMenuOpen((prev) => !prev);
                            }}
                            title=${t('workspace.actions')}
                            aria-label=${t('workspace.actions')}
                            aria-haspopup="menu"
                            aria-expanded=${headerMenuOpen ? 'true' : 'false'}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <line x1="4" y1="7" x2="20" y2="7" />
                                <line x1="4" y1="12" x2="20" y2="12" />
                                <line x1="4" y1="17" x2="20" y2="17" />
                            </svg>
                        </button>
                        ${headerMenuOpen && html`
                            <div class="workspace-menu-dropdown" ref=${headerMenuRef} role="menu" aria-label="Workspace options">
                                <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuCreateFile} disabled=${uploading}>${t('workspace.newFile')}</button>
                                <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuUploadFiles} disabled=${uploading}>${t('workspace.uploadFiles')}</button>
                                ${(() => {
                                    const recent = getRecentFiles();
                                    if (recent.length === 0) return null;
                                    return html`
                                        <div class="workspace-menu-separator"></div>
                                        <div class="workspace-menu-submenu-label">${t('menu.openRecent')}</div>
                                        ${recent.map((path) => {
                                            const label = path.split('/').pop() || path;
                                            return html`
                                                <button class="workspace-menu-item workspace-menu-recent-item" role="menuitem" title=${path} onClick=${() => runMenuAction(() => openRecentFile(path, onOpenEditorRef.current))}>${label}</button>
                                            `;
                                        })}
                                    `;
                                })()}
                                <div class="workspace-menu-separator"></div>
                                <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuRefresh}>${t('menu.refreshTree')}</button>
                                <button class="workspace-menu-item" role="menuitem" onClick=${() => runMenuAction(() => handleWorkspaceReindex())} disabled=${workspaceReindexing}>
                                    ${workspaceReindexing ? t('workspace.reindexing') : t('menu.reindex')}
                                </button>
                                <button class=${`workspace-menu-item${showHidden ? ' active' : ''}`} role="menuitem" onClick=${handleMenuToggleHidden}>
                                    ${showHidden ? t('menu.hideHidden') : t('menu.showHidden')}
                                </button>
                                <div class="workspace-menu-scale-control" role="none">
                                    <label for="workspace-pwa-display-scale">${t('menu.scale')}</label>
                                    <div class="workspace-menu-scale-input-wrap">
                                        <input
                                            id="workspace-pwa-display-scale"
                                            class="workspace-menu-scale-input"
                                            type="number"
                                            inputmode="numeric"
                                            min=${MIN_PWA_DISPLAY_SCALE_PERCENT}
                                            max=${MAX_PWA_DISPLAY_SCALE_PERCENT}
                                            step=${PWA_DISPLAY_SCALE_STEP_PERCENT}
                                            value=${pwaDisplayScaleDraft}
                                            aria-label=${`PWA display scale percentage, currently ${pwaDisplayScalePercent}%`}
                                            onClick=${(event) => event.stopPropagation()}
                                            onInput=${handlePwaDisplayScaleInput}
                                            onChange=${handlePwaDisplayScaleCommit}
                                            onBlur=${handlePwaDisplayScaleCommit}
                                            onKeyDown=${handlePwaDisplayScaleKeyDown}
                                        />
                                        <span aria-hidden="true">%</span>
                                    </div>
                                </div>

                                ${(onOpenTerminalTab || onOpenVncTab) && html`<div class="workspace-menu-separator"></div>`}
                                ${onOpenTerminalTab && html`
                                    <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuOpenTerminalTab}>
                                        ${t('menu.openTerminal')}
                                    </button>
                                `}
                                ${onOpenVncTab && html`
                                    <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuOpenVncTab}>
                                        ${t('menu.openVnc')}
                                    </button>
                                `}
                                <div class="workspace-menu-separator"></div>
                                <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuOpenSettings}>${t('menu.settings')}</button>

                                ${selectedPath && html`<div class="workspace-menu-separator"></div>`}
                                ${selectedHasOpenableTab && html`
                                    <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuOpenTab}>${t('workspace.openInTab')}</button>
                                `}
                                ${selectedPath && !selectedIsDir && html`
                                    <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuOpenEditor} disabled=${!canEdit}>${t('workspace.openInEditor')}</button>
                                `}
                                ${addonActions.map(action => html`<button class="workspace-menu-item" role="menuitem" title=${action.title} onClick=${() => runAddonAction(action.id)}>${action.label}</button>`)}
                                ${selectedCanRename && html`
                                    <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuRename}>${t('workspace.renameSelected')}</button>
                                `}
                                ${selectedCanDownload && html`
                                    <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuDownload}>${t('workspace.downloadSelectedFile')}</button>
                                `}
                                ${selectedFolderDownloadUrl && html`
                                    <button class="workspace-menu-item" role="menuitem" onClick=${handleMenuDownloadFolder}>${t('workspace.downloadSelectedFolder')}</button>
                                `}
                                ${selectedCanDelete && html`
                                    <button class="workspace-menu-item danger" role="menuitem" onClick=${handleMenuDelete}>${t('workspace.deleteSelectedFile')}</button>
                                `}
                                <div class="workspace-menu-separator"></div>
                                <button class="workspace-menu-item" role="menuitem" onClick=${() => { setHeaderMenuOpen(false); window.dispatchEvent(new CustomEvent('piclaw:open-settings', { detail: { section: 'workspace' } })); }}>${t('menu.settings')}</button>
                                <div class="workspace-menu-separator"></div>
                                <div class="workspace-menu-language" role="none">
                                    <${LanguageSwitcher} variant="menu" />
                                </div>
                            </div>
                        `}
                    </div>
                    <span>${t('workspace.title')}</span>
                </div>
                <div class="workspace-header-actions">
                    <button class="workspace-refresh" onClick=${handleRefreshClick} title=${t('menu.refreshTree')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="8.5" stroke-dasharray="42 12" stroke-dashoffset="6"
                                transform="rotate(75 12 12)" />
                            <polyline points="21 3 21 9 15 9" />
                        </svg>
                    </button>
                </div>
            </div>
            ${showWorkspaceIndexIndicator && html`
                <div class="workspace-index-status-row">
                    <div class=${`workspace-index-status-chip state-${workspaceIndexState}`} title=${workspaceIndexTitle}>
                        <span class="workspace-index-status-dot" aria-hidden="true"></span>
                        <span>${workspaceIndexLabel}</span>
                    </div>
                </div>
            `}
            <div class="workspace-tree" onClick=${handleBackgroundClick}>
                ${uploadProgress && html`
                    <div
                        class="workspace-upload-strip"
                        role=${uploadProgress.error ? 'alert' : 'status'}
                        aria-live=${uploadProgress.error ? 'assertive' : 'polite'}
                        data-testid="workspace-upload-status"
                    >
                        <div class="workspace-upload-strip-text">
                            ${uploadProgress.error
                                ? html`<span class="workspace-upload-strip-error">${uploadProgress.error}</span>`
                                : uploadProgress.done
                                    ? html`<span>Done</span>`
                                    : html`<span>${uploadProgress.total > 1
                                        ? `Uploading ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.name}`
                                        : `Uploading ${uploadProgress.name}`
                                    }${uploadProgress.percent > 0 ? ` (${uploadProgress.percent}%)` : '…'}</span>`
                            }
                        </div>
                        ${!uploadProgress.done && !uploadProgress.error && html`
                            <div
                                class="workspace-upload-strip-bar"
                                role="progressbar"
                                aria-label="Workspace upload progress"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow=${uploadProgress.percent || 0}
                            >
                                <div class="workspace-upload-strip-fill" style=${`width:${uploadProgress.percent || 0}%`}></div>
                            </div>
                        `}
                    </div>
                `}
                ${initialLoad && html`<div class="workspace-loading">Loading…</div>`}
                ${error && html`<div class="workspace-error">${error}</div>`}
                ${tree && html`
                    <div class="workspace-tree-list workspace-tree-pierre" ref=${treeHostRef}></div>
                `}
            </div>
            ${tree && html`
                <div class="workspace-selection-bar">
                    ${addonActionError && html`<div role="alert">${addonActionError}</div>`}
                    <div class="workspace-preview-header">
                        <div class="workspace-preview-actions">
                            ${selectedPath && addonActions.map(action => html`<button class="workspace-download" title=${action.title} aria-label=${action.label} onClick=${() => runAddonAction(action.id)}>${action.icon === 'review' ? html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M8 9h5M8 13h4M8 17h3"/><path d="m14 7 5-5 3 3-5 5-4 1 1-4Z"/></svg>` : action.label}</button>`)}
                            <button class="workspace-create" onClick=${handleCreateFileClick} title=${t('workspace.newFile')} disabled=${uploading}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            </button>
                            ${selectedPath && !selectedIsDir && html`
                                <button
                                    class="workspace-download workspace-edit"
                                    onClick=${() => canEdit && onOpenEditorRef.current?.(selectedPath, preview)}
                                    title=${editTitle}
                                    disabled=${!canEdit}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                    </svg>
                                </button>
                                <button
                                    class="workspace-download workspace-delete"
                                    onClick=${handleDeleteFile}
                                    title=${t('workspace.deleteFile')}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                        <line x1="10" y1="11" x2="10" y2="17" />
                                        <line x1="14" y1="11" x2="14" y2="17" />
                                    </svg>
                                </button>
                            `}
                            ${!selectedPath ? null : selectedIsDir
                                ? html`
                                    <button
                                        class="workspace-download"
                                        data-folder-hint-target=${selectedPath}
                                        onClick=${handleFolderHintClick}
                                        title=${t('workspace.addFolderHint')}
                                        aria-label=${`Add folder hint for ${selectedPath}`}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                            <path d="M12 11v6"/>
                                            <path d="M9 14h6"/>
                                        </svg>
                                    </button>
                                    <button class="workspace-download" onClick=${handleUploadButtonClick}
                                        title=${t('workspace.uploadToFolder')} disabled=${uploading}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                            <polyline points="7 8 12 3 17 8"/>
                                            <line x1="12" y1="3" x2="12" y2="15"/>
                                        </svg>
                                    </button>
                                    <a class="workspace-download" href=${getWorkspaceDownloadUrl(selectedPath, showHidden)} download
                                        title=${t('workspace.downloadZip')} onClick=${(e) => e.stopPropagation()}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                            <polyline points="7 10 12 15 17 10"/>
                                            <line x1="12" y1="15" x2="12" y2="3"/>
                                        </svg>
                                    </a>`
                                : html`<a class="workspace-download" href=${getWorkspaceFileDownloadUrl(selectedPath)} download
                                        title=${t('workspace.download')} onClick=${(e) => e.stopPropagation()}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </a>`}
                        </div>
                    </div>
                    ${preview?.error && html`<div class="workspace-error">${preview.error}</div>`}
                    ${selectedPath && selectedIsDir && html`
                        <details class="workspace-folder-sizes" open=${folderChartOpen} onToggle=${(event) => setFolderChartOpen(event.currentTarget.open)}>
                            <summary>Folder sizes</summary>
                            ${folderChart?.disabled && html`<div class="workspace-preview-text">Folder size scanning is disabled in Workspace settings.</div>`}
                            ${folderChart?.loading && html`<div class="workspace-loading">Loading folder sizes…</div>`}
                            ${folderChart?.error && html`<div class="workspace-error">${folderChart.error}</div>`}
                            ${folderChart?.payload && folderChart.payload.segments?.length > 0 && html`
                                <${FolderStarburstChart} payload=${folderChart.payload} />
                            `}
                            ${folderChart?.payload && (!folderChart.payload.segments || folderChart.payload.segments.length === 0) && html`
                                <div class="workspace-preview-text">No file size data available for this folder yet.</div>
                            `}
                        </details>
                    `}
                </div>
            `}
        </aside>
    `;
}
