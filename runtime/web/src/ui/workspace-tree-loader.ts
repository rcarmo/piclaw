import { classicBundleUrl } from './app-shell-state.js';
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


export function loadWorkspaceTreeModule(): Promise<WorkspaceTreeModule> {
  if (!modulePromise) {
    modulePromise = import(classicBundleUrl('workspace-tree')).catch((error) => {
      modulePromise = null; // retry on the next attempt
      throw error;
    });
  }
  return modulePromise;
}
