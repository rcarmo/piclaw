/**
 * workspace-tree-loader.ts — lazily loads the Pierre-based file tree bundle
 * (workspace-tree.bundle.js) the first time the Explorer shows a tree.
 */
export interface WorkspaceTreeController {
  update(options: Record<string, unknown>): void;
  startRename(path: string, type: 'dir' | 'file'): void;
  focus(): void;
  dispose(): void;
}

export interface WorkspaceTreeModule {
  mountWorkspaceTree(host: HTMLElement, options: Record<string, unknown>): WorkspaceTreeController;
}

let modulePromise: Promise<WorkspaceTreeModule> | null = null;

function getWorkspaceTreeBundleUrl(): string {
  try {
    // Reuse the app bundle's cache-busting query.
    return `/static/classic/dist/workspace-tree.bundle.js${new URL(import.meta.url).search || ''}`;
  } catch {
    return '/static/classic/dist/workspace-tree.bundle.js';
  }
}

export function loadWorkspaceTreeModule(): Promise<WorkspaceTreeModule> {
  if (!modulePromise) {
    modulePromise = import(getWorkspaceTreeBundleUrl()).catch((error) => {
      modulePromise = null; // retry on the next attempt
      throw error;
    });
  }
  return modulePromise;
}
