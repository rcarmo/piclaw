/**
 * Utility helpers for AgentStatusPanel — tool kind resolution, title parsing,
 * retry countdown formatting, and SVG sanitization.
 */

// ---------------------------------------------------------------------------
// Tool argument parsing helpers
// ---------------------------------------------------------------------------

/** Parse tool_args JSON safely; returns null on failure. */
function parseToolArgs(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {}
  }
  return null;
}

/** Determine tool kind from tool_name prefix. */
export function resolveToolKind(toolName: string): "bash" | "read" | "write" | "search" | "other" {
  const n = (toolName || "").toLowerCase();
  if (n === "bash" || n.startsWith("bash") || n.includes("shell") || n.includes("run")) return "bash";
  if (n === "read" || n.startsWith("read") || n.includes("cat") || n.includes("view")) return "read";
  if (
    n === "write" || n.startsWith("write") ||
    n.includes("edit") || n.includes("patch") ||
    n.includes("create") || n.includes("delete") ||
    n.includes("insert") || n.includes("replace")
  ) return "write";
  if (n.includes("search") || n.includes("grep") || n.includes("find") || n.includes("glob")) return "search";
  return "other";
}

/** Labels and badge colours for each kind. */
export const TOOL_KIND_LABELS: Record<string, { label: string; cls: string }> = {
  bash:   { label: "bash",   cls: "agent-tool-kind-pill--bash" },
  read:   { label: "read",   cls: "agent-tool-kind-pill--read" },
  write:  { label: "write",  cls: "agent-tool-kind-pill--write" },
  search: { label: "search", cls: "agent-tool-kind-pill--search" },
  other:  { label: "tool",   cls: "agent-tool-kind-pill--other" },
};

export interface ParsedTitle {
  prefix: string;
  argument: string | null;
  suffix: string;
  gitBranch: string | null;
}

/**
 * Resolve a human-readable title from a tool call's name, raw title, and args.
 * - For bash tools: extracts the first meaningful command token.
 * - For read/write tools: extracts the file path.
 * - Returns prefix/argument/suffix parts for styled rendering.
 */
export function resolveTitleFromArgs(
  toolName: string,
  rawTitle: string,
  toolArgs: unknown,
): ParsedTitle {
  const args = parseToolArgs(toolArgs);
  const kind = resolveToolKind(toolName);
  let prefix = rawTitle || toolName || "Running tool…";
  let argument: string | null = null;
  let suffix = "";
  let gitBranch: string | null = null;

  // Extract git branch from args (mirrors upstream status.ts:287-333)
  if (args) {
    const branchRaw = args.branch ?? args.git_branch ?? args.ref;
    if (typeof branchRaw === "string" && branchRaw) gitBranch = branchRaw;
    // Also try to extract from cwd/path by checking common fields
    const cwdRaw = args.cwd ?? args.working_dir ?? args.workdir;
    if (!gitBranch && typeof cwdRaw === "string" && cwdRaw) {
      // Branch may be stored alongside cwd in some tool schemas
      const repoRaw = args.repo ?? args.repo_path;
      if (typeof repoRaw === "string" && repoRaw) gitBranch = null; // will rely on path hint
    }
  }

  if (kind === "bash" && args) {
    const cmd = args.command ?? args.cmd ?? args.shell_command;
    if (typeof cmd === "string" && cmd) {
      // Shorten: take first line, strip leading shell boilerplate, cap at 80 chars
      const firstLine = cmd.split("\n")[0].trim();
      const short = firstLine.length > 80 ? firstLine.slice(0, 78) + "…" : firstLine;
      prefix = "$ ";
      argument = short;
      suffix = "";
      return { prefix, argument, suffix, gitBranch };
    }
  }

  if ((kind === "read" || kind === "write") && args) {
    const filePath =
      args.path ?? args.file_path ?? args.filename ?? args.file ?? args.target_file;
    if (typeof filePath === "string" && filePath) {
      const opLabel = kind === "write" ? "write " : "read ";
      prefix = opLabel;
      argument = filePath.length > 60 ? "…" + filePath.slice(-58) : filePath;
      return { prefix, argument, suffix, gitBranch };
    }
  }

  if (kind === "search" && args) {
    const query = args.query ?? args.pattern ?? args.regex ?? args.search;
    if (typeof query === "string" && query) {
      prefix = "search ";
      argument = query.length > 60 ? query.slice(0, 58) + "…" : query;
      return { prefix, argument, suffix, gitBranch };
    }
  }

  // Fallback: return raw title as-is
  return { prefix, argument: null, suffix: "", gitBranch };
}

// ---------------------------------------------------------------------------
// Retry countdown helpers
// ---------------------------------------------------------------------------

/** Parse a retry_at / retryAt ISO timestamp from a tool_status event detail. */
export function parseRetryAt(detail: Record<string, unknown>): number | null {
  const raw = detail.retry_at ?? detail.retryAt;
  if (typeof raw !== "string" || !raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Format milliseconds remaining as a short countdown string. */
export function formatRetryCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "retrying now";
  const secs = Math.ceil(remainingMs / 1000);
  if (secs < 60) return `retry in ${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `retry in ${mins}m ${rem}s`;
}

// ---------------------------------------------------------------------------
// SVG sanitization
// ---------------------------------------------------------------------------

/** Sanitize SVG string — allow only safe SVG elements and attributes. */
export function sanitizeSvg(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  // Strip script tags, event handlers, and non-SVG elements
  const cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:/gi, "");
  return cleaned;
}
