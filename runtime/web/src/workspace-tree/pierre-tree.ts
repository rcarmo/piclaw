// @ts-nocheck
/**
 * workspace-tree/pierre-tree.ts — the Explorer's file tree, rendered with
 * @pierre/trees (#1972). Built as a separate lazily loaded bundle
 * (workspace-tree.bundle.js), like the editor.
 *
 * The explorer keeps its data loading, actions and selection bar; this module
 * maps the explorer's nested workspace nodes to Pierre's path list and back.
 * Directories that are not loaded yet get a placeholder child so they can be
 * expanded; expanding one reports it so the explorer can load its children.
 */
import { FileTree } from '@pierre/trees';

export const PLACEHOLDER_NAME = 'Loading…';

const svgUrl = (path: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='${path}'/></svg>`)}")`;
const FOLDER_ICON = svgUrl('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z');
const FOLDER_OPEN_ICON = svgUrl('m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2');

/**
 * Styles injected into the tree's shadow root: folder icons beside the
 * disclosure chevron (Pierre's built-in sets draw none), and the side bar's
 * full inner width with only a slim inset and scrollbar gutter.
 */
export const WORKSPACE_TREE_CSS = `
  :host { --trees-padding-inline-override: 4px; --trees-scrollbar-gutter-override: 4px; }
  [data-item-type="folder"] [data-item-section="content"]::before {
    content: '';
    display: inline-block;
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin-right: 5px;
    vertical-align: -2px;
    background-color: var(--trees-accent, currentColor);
    opacity: 0.85;
    -webkit-mask: ${FOLDER_ICON} center / contain no-repeat;
    mask: ${FOLDER_ICON} center / contain no-repeat;
  }
  [data-item-type="folder"][aria-expanded="true"] [data-item-section="content"]::before {
    -webkit-mask-image: ${FOLDER_OPEN_ICON};
    mask-image: ${FOLDER_OPEN_ICON};
  }
  [data-item-type="folder"] [data-item-section="content"] { display: flex; align-items: center; min-width: 0; }
`;

export interface WorkspaceNodeLike {
  path: string;
  name?: string;
  type: 'dir' | 'file';
  children?: WorkspaceNodeLike[];
  child_count?: number;
}

export interface WorkspaceTreeOptions {
  root: WorkspaceNodeLike | null;
  expanded: Iterable<string>;
  selectedPath: string | null;
  onSelect?(path: string, type: 'dir' | 'file'): void;
  onExpandedChange?(expanded: string[]): void;
  onRename?(sourcePath: string, newName: string, type: 'dir' | 'file'): void;
  onMove?(sourcePath: string, targetDir: string): void;
  renderContextMenu?(item: { path: string; type: 'dir' | 'file' }, close: () => void): HTMLElement | null;
}

/** Explorer path to Pierre path: directories end with a slash; the root is implicit. */
export function toTreePath(path: string, type: 'dir' | 'file'): string {
  return type === 'dir' ? `${path}/` : path;
}

/** Pierre path to explorer path and type. */
export function fromTreePath(treePath: string): { path: string; type: 'dir' | 'file' } {
  return treePath.endsWith('/') ? { path: treePath.slice(0, -1), type: 'dir' } : { path: treePath, type: 'file' };
}

export function isPlaceholderPath(treePath: string): boolean {
  return treePath.endsWith(`/${PLACEHOLDER_NAME}`);
}

/** Flatten loaded nodes into Pierre paths, with placeholders for unloaded non-empty directories. */
export function buildTreePaths(root: WorkspaceNodeLike | null): { paths: string[]; counts: Map<string, number> } {
  const paths: string[] = [];
  const counts = new Map<string, number>();
  const visit = (node: WorkspaceNodeLike) => {
    for (const child of node.children || []) {
      if (!child?.path || child.path === '.') continue;
      if (child.type === 'dir') {
        const dirPath = toTreePath(child.path, 'dir');
        paths.push(dirPath);
        const count = Number(child.child_count);
        if (Number.isFinite(count)) counts.set(dirPath, count);
        if (child.children === undefined) {
          if (!Number.isFinite(count) || count > 0) paths.push(`${dirPath}${PLACEHOLDER_NAME}`);
        } else {
          visit(child);
        }
      } else {
        paths.push(child.path);
      }
    }
  };
  if (root) visit(root);
  return { paths, counts };
}

export function mountWorkspaceTree(host: HTMLElement, initial: WorkspaceTreeOptions) {
  let options = initial;
  let counts = new Map<string, number>();
  let knownDirs: string[] = [];
  let lastExpanded = '';
  let suppressSelection = false;

  const tree = new FileTree({
    paths: [],
    initialExpansion: 'closed',
    search: true,
    density: 'compact',
    unsafeCSS: WORKSPACE_TREE_CSS,
    labels: { searchPlaceholder: 'Search files' },
    onSelectionChange: (selected) => {
      if (suppressSelection) return;
      const last = selected[selected.length - 1];
      if (!last || isPlaceholderPath(last)) return;
      const { path, type } = fromTreePath(last);
      options.onSelect?.(path, type);
    },
    renaming: {
      canRename: (item) => !isPlaceholderPath(item.path),
      onRename: (event) => {
        const source = fromTreePath(event.isFolder ? `${event.sourcePath.replace(/\/$/, '')}/` : event.sourcePath);
        const destination = event.destinationPath.replace(/\/$/, '');
        const newName = destination.split('/').pop() || destination;
        options.onRename?.(source.path, newName, event.isFolder ? 'dir' : 'file');
      },
    },
    dragAndDrop: {
      canDrag: (paths) => paths.every((path) => !isPlaceholderPath(path)),
      onDropComplete: (result) => {
        const targetDir = result.target.directoryPath ? fromTreePath(result.target.directoryPath).path : '.';
        for (const dragged of result.draggedPaths) options.onMove?.(fromTreePath(dragged).path, targetDir);
      },
    },
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: 'both',
        buttonVisibility: 'when-needed',
        render: (item, context) => {
          if (isPlaceholderPath(item.path)) return null;
          const { path } = fromTreePath(item.kind === 'directory' ? `${item.path.replace(/\/$/, '')}/` : item.path);
          return options.renderContextMenu?.({ path, type: item.kind === 'directory' ? 'dir' : 'file' }, () => context.close({ restoreFocus: false })) || null;
        },
      },
    },
    renderRowDecoration: ({ row }) => {
      if (row.kind !== 'directory') return null;
      const count = counts.get(row.path.endsWith('/') ? row.path : `${row.path}/`);
      return count ? { text: String(count), title: `${count} items` } : null;
    },
  });
  tree.render({ containerWrapper: host });

  const readExpanded = () => knownDirs.filter((dir) => {
    const item = tree.getItem(dir);
    return item?.isDirectory?.() && item.isExpanded();
  });

  const unsubscribe = tree.subscribe(() => {
    const expanded = readExpanded();
    const key = expanded.join('\n');
    if (key === lastExpanded) return;
    lastExpanded = key;
    options.onExpandedChange?.(expanded.map((dir) => fromTreePath(dir).path));
  });

  const update = (next: WorkspaceTreeOptions) => {
    options = next;
    const built = buildTreePaths(next.root);
    counts = built.counts;
    knownDirs = built.paths.filter((path) => path.endsWith('/'));
    const expanded = [...next.expanded].filter((path) => path && path !== '.').map((path) => toTreePath(path, 'dir'));
    lastExpanded = expanded.filter((dir) => knownDirs.includes(dir)).join('\n');
    tree.resetPaths(built.paths, { initialExpandedPaths: expanded });
    if (next.selectedPath) {
      const selectedTreePath = knownDirs.includes(toTreePath(next.selectedPath, 'dir')) ? toTreePath(next.selectedPath, 'dir') : next.selectedPath;
      const item = tree.getItem(selectedTreePath);
      if (item && !item.isSelected()) {
        suppressSelection = true;
        item.select();
        suppressSelection = false;
      }
    }
  };
  update(initial);

  return {
    update,
    startRename(path: string, type: 'dir' | 'file') { tree.startRenaming(toTreePath(path, type)); },
    focus() { tree.focusFirstItem(); },
    dispose() {
      unsubscribe();
      tree.cleanUp();
    },
  };
}
