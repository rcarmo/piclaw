/**
 * web/workspace/constants.ts – Shared constants for the workspace explorer.
 *
 * Defines excluded directories, file extension sets, and size limits
 * used by the tree builder, file service, and watcher.
 *
 * Consumers: All web/workspace/*.ts modules.
 */

/** Directory names excluded from workspace tree/file views. */
export const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "generated",
  "dist",
  "build",
  "output",
  ".cache",
  ".venv",

  "coverage",
]);

/** Maximum number of entries returned in a workspace tree response. */
export const MAX_TREE_ENTRIES = 5000;
/** Maximum bytes to read for file preview in the explorer. */
export const MAX_PREVIEW_BYTES = 64 * 1024;
/** Maximum bytes allowed when editing a file via the web UI. */
export const MAX_EDIT_BYTES = 256 * 1024;
/** Maximum bytes for file attachment to agent context. */
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;
/** Set of file extensions recognised as images. */
export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
/** Set of file extensions recognised as text (previewable). */
export const TEXT_EXTS = new Set([
  ".md",
  ".txt",
  ".log",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
  ".sh",
  ".py",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".java",
  ".kt",
  ".swift",
  ".sql",
]);
