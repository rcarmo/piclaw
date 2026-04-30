import { existsSync, lstatSync, readFileSync, statSync } from "fs";
import path from "path";
import { execFileSync } from "child_process";

import { WORKSPACE_DIR } from "../../../core/config.js";
import { isRealWorkspacePath, resolveWorkspacePath, toRelativePath } from "./paths.js";

type ExecFileSyncLike = (
  file: string,
  args: string[],
  options: { cwd?: string; encoding: BufferEncoding; stdio: Array<"ignore" | "pipe"> }
) => string;

function hasSafeGitMetadata(repoRoot: string): boolean {
  const gitPath = path.join(repoRoot, ".git");
  if (!existsSync(gitPath) || !isRealWorkspacePath(gitPath)) return false;
  try {
    const stats = lstatSync(gitPath);
    if (stats.isDirectory() || stats.isSymbolicLink()) return true;
    if (!stats.isFile()) return false;
    const match = /^gitdir:\s*(.+)$/im.exec(readFileSync(gitPath, "utf8"));
    if (!match) return false;
    const gitDir = path.resolve(repoRoot, match[1].trim());
    return existsSync(gitDir) && isRealWorkspacePath(gitDir);
  } catch {
    return false;
  }
}

function findNearestRepoRoot(absPath: string): string | null {
  let current = absPath;
  try {
    if (statSync(current).isFile()) {
      current = path.dirname(current);
    }
  } catch {
    current = path.dirname(current);
  }

  const workspaceRoot = path.resolve(WORKSPACE_DIR);
  while (true) {
    if (hasSafeGitMetadata(current)) {
      return current;
    }
    if (current === workspaceRoot) {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current || !parent.startsWith(workspaceRoot)) {
      return null;
    }
    current = parent;
  }
}

export function getWorkspaceGitBranch(
  pathParam: string | null,
  execFileSyncImpl: ExecFileSyncLike = execFileSync
): { branch: string; repoPath: string } | null {
  const targetPath = resolveWorkspacePath(pathParam);
  if (!targetPath) return null;
  if (existsSync(targetPath) && !isRealWorkspacePath(targetPath)) return null;

  const repoRoot = findNearestRepoRoot(targetPath);
  if (!repoRoot) return null;

  try {
    const branch = execFileSyncImpl(
      "git",
      ["symbolic-ref", "--short", "HEAD"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();

    if (!branch) return null;
    return {
      branch,
      repoPath: toRelativePath(repoRoot),
    };
  } catch {
    return null;
  }
}
