import type { TreeNode } from "../../components/FileTree";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceMutationPayload {
  nextNode: TreeNode | null;
}

// ─── Error helpers ────────────────────────────────────────────────────────────

export function getErrorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object") {
    if ("error" in value && typeof value.error === "string" && value.error.trim()) return value.error;
    if ("message" in value && typeof value.message === "string" && value.message.trim()) return value.message;
  }
  return fallback;
}

// Patterns for user-actionable server validation messages that are safe to surface directly.
const USER_SAFE_ERROR_RE =
  /^(invalid (path|filename|upload id|chunk index|chunk total|file size)|path is (a|not a) directory|file too large|missing (filename|file content)|cannot (rename|move) workspace root|cannot move a folder into itself|unauthorized)$/i;

export function toUserFacingMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && USER_SAFE_ERROR_RE.test(error.message)) {
    return error.message;
  }
  return fallback;
}

export async function readJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function makeTreeNodeFromMutation(
  type: TreeNode["type"],
  value: { path?: string; name?: string; size?: number | null; mtime?: string | null }
): TreeNode | null {
  if (!value.path || !value.name) return null;
  return {
    name: value.name,
    path: value.path,
    type,
    size: typeof value.size === "number" ? value.size : null,
    mtime: value.mtime ?? null,
  };
}
