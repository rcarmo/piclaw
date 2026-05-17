// Extracted from upstream runtime/web/src/ui/tool-git-context.ts
// Determines the working directory/path context from tool invocation args

function readTrimmedString(...args: unknown[]): string {
  for (const v of args) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function stripOuterQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function extractShellCwdFromCommand(command: string): string {
  const m = command.match(/^\s*cd\s+([^\s;&|]+)\s*[;&|]/);
  if (m) return stripOuterQuotes(m[1]);
  const m2 = command.match(/^\s*cd\s+([^\s;&|]+)\s*$/);
  if (m2) return stripOuterQuotes(m2[1]);
  return "";
}

/** Extract a path context from tool name + args (for git branch lookup). */
export function extractToolContextPath(toolName: string | undefined, toolArgs: Record<string, unknown> | null | undefined): string {
  if (!toolArgs) return "";
  const cwd = readTrimmedString(toolArgs.cwd, toolArgs.working_directory, toolArgs.project_dir, toolArgs.repo_path);
  if (cwd) return cwd;
  const path = readTrimmedString(toolArgs.path, toolArgs.file);
  if (path) return path;
  // For bash/shell tools, try to parse "cd <dir>" from command
  if (toolName === "bash" || toolName === "shell" || toolName === "exec") {
    const command = readTrimmedString(toolArgs.command, toolArgs.cmd);
    if (command) return extractShellCwdFromCommand(command);
  }
  return "";
}

/** Fetch git branch info for a path from the backend. */
export async function getWorkspaceBranch(path: string): Promise<{ branch: string; repo_path?: string } | null> {
  try {
    const res = await fetch(`/workspace/branch?path=${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
