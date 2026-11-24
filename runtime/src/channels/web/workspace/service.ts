/**
 * web/workspace/service.ts – High-level workspace explorer service.
 *
 * Composes the file service, tree cache, and filesystem watcher into a
 * single service that the workspace HTTP handlers interact with.
 *
 * Consumers: web/handlers/workspace.ts creates and uses a WorkspaceService.
 */

import { markWorkspaceIndexStale, getWorkspaceIndexStatus, refreshWorkspaceIndex } from "../../../workspace-search.js";
import { WorkspaceFileService, type WorkspaceChunkUploadParams } from "./file-service.js";
import { getWorkspaceGitBranch } from "./git-branch.js";
import { WorkspaceTreeCache } from "./tree-cache.js";
import { startWorkspaceWatcher } from "./watcher.js";

/** High-level workspace explorer service combining files, tree, and watcher. */
export class WorkspaceService {
  private treeCache = new WorkspaceTreeCache();
  private fileService = new WorkspaceFileService();

  private async markIndexStale(paths: Array<string | null | undefined>) {
    const affected = paths.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    if (affected.length === 0) return;
    await markWorkspaceIndexStale({ paths: affected });
  }

  getTree(pathParam: string | null, depthParam?: string | null, includeHidden = false) {
    return this.treeCache.getTree(pathParam, depthParam, includeHidden);
  }

  getFile(pathParam: string | null, maxParam?: string | null, mode?: string | null, signal?: AbortSignal) {
    return this.fileService.getFile(pathParam, maxParam, mode, signal);
  }

  getRaw(pathParam: string | null, download = false) {
    return this.fileService.getRaw(pathParam, download);
  }

  getGitBranch(pathParam: string | null) {
    const branch = getWorkspaceGitBranch(pathParam);
    return {
      status: 200,
      body: {
        branch: branch?.branch || null,
        repo_path: branch?.repoPath || null,
      },
    };
  }

  getIndexStatus(scopeParam: string | null) {
    return {
      status: 200,
      body: getWorkspaceIndexStatus({ scope: scopeParam ?? undefined }),
    };
  }

  async reindex(scopeParam: string | null) {
    const snapshot = await refreshWorkspaceIndex({ scope: scopeParam ?? undefined });
    return {
      status: 200,
      body: snapshot,
    };
  }

  attachFile(pathParam: string | null, signal?: AbortSignal) {
    return this.fileService.attachFile(pathParam, signal);
  }

  async uploadFile(pathParam: string | null, file: File, overwrite = false) {
    const result = await this.fileService.uploadFile(pathParam, file, overwrite);
    if (result.status === 200) {
      const body = result.body as { path?: string } | undefined;
      await this.markIndexStale([body?.path]);
    }
    return result;
  }

  async uploadChunk(params: WorkspaceChunkUploadParams) {
    const result = await this.fileService.uploadChunk(params);
    if (result.status === 200) {
      const body = result.body as { path?: string; complete?: boolean } | undefined;
      if (body?.complete) {
        await this.markIndexStale([body?.path]);
      }
    }
    return result;
  }

  async createFile(pathParam: string | null, nameParam: string | null, content: string) {
    const result = this.fileService.createFile(pathParam, nameParam, content);
    if (result.status === 200) {
      const body = result.body as { path?: string } | undefined;
      await this.markIndexStale([body?.path]);
    }
    return result;
  }

  async renameFile(pathParam: string | null, nameParam: string | null) {
    const result = this.fileService.renameFile(pathParam, nameParam);
    if (result.status === 200) {
      const body = result.body as { path?: string; old_path?: string } | undefined;
      await this.markIndexStale([body?.old_path, body?.path]);
    }
    return result;
  }

  async moveEntry(pathParam: string | null, targetParam: string | null) {
    const result = this.fileService.moveEntry(pathParam, targetParam);
    if (result.status === 200) {
      const body = result.body as { path?: string; old_path?: string; target?: string } | undefined;
      await this.markIndexStale([body?.old_path, body?.path, body?.target]);
    }
    return result;
  }

  async updateFile(pathParam: string | null, content: string) {
    const result = this.fileService.updateFile(pathParam, content);
    if (result.status === 200) {
      const body = result.body as { path?: string } | undefined;
      await this.markIndexStale([body?.path]);
    }
    return result;
  }

  async deleteFile(pathParam: string | null) {
    const result = this.fileService.deleteFile(pathParam);
    if (result.status === 200) {
      const body = result.body as { path?: string } | undefined;
      await this.markIndexStale([body?.path]);
    }
    return result;
  }

  downloadZip(pathParam: string | null, includeHidden = false) {
    return this.fileService.downloadZip(pathParam, includeHidden);
  }

  startWatcher(
    onUpdate: (updates: Array<{ path: string; root: unknown; truncated: boolean }>) => void,
    includeHidden: () => boolean
  ) {
    return startWorkspaceWatcher(onUpdate, includeHidden);
  }
}
