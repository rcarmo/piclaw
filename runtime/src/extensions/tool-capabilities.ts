/**
 * tool-capabilities – compact capability metadata for internal tool discovery.
 *
 * Each entry describes a tool's behavioral profile so that list_tools
 * can return actionable summaries without dumping full schemas.
 */

export type ToolKind = "read-only" | "mutating" | "mixed";
export type ToolWeight = "lightweight" | "standard" | "heavy";
export type ToolActivation = "default" | "on-demand";

export interface ToolRecommendationProfile {
  /** Higher-level domain phrases matched against the requested intent. */
  domains?: string[];
  /** Action phrases matched against the requested intent. */
  verbs?: string[];
  /** Object phrases matched against the requested intent. */
  nouns?: string[];
  /** Free-form keywords for tools whose descriptions are too sparse. */
  keywords?: string[];
  /** Phrases that should reduce confidence for this tool. */
  negativeTerms?: string[];
}

export interface ToolCapability {
  /** Behavioral kind: read-only (no side-effects), mutating (writes/deletes), mixed (both). */
  kind: ToolKind;
  /** Execution weight hint: lightweight (fast, small output), standard, heavy (slow or large). */
  weight: ToolWeight;
  /** Optional one-line capability summary. When omitted, callers should use the tool's own description. */
  summary?: string;
  /** Optional recommendation hints used by intent-based shortlisting. */
  recommend?: ToolRecommendationProfile;
}

function rec(profile: ToolRecommendationProfile): ToolRecommendationProfile {
  return profile;
}

/**
 * Capability registry for known internal tools.
 *
 * Tools not in this map get a sensible default via `getToolCapability()`.
 */
const TOOL_CAPABILITIES: Record<string, ToolCapability> = {
  // core (upstream pi-coding-agent)
  read: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["files", "workspace", "documents"],
      verbs: ["read", "open", "inspect", "view"],
      nouns: ["file", "text", "image", "document", "contents"],
    }),
  },
  bash: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["shell", "commands", "system"],
      verbs: ["run", "execute", "check", "inspect"],
      nouns: ["bash", "command", "process", "stdout", "stderr"],
    }),
  },
  powershell: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["shell", "commands", "windows"],
      verbs: ["run", "execute", "check", "inspect"],
      nouns: ["powershell", "command", "windows", "process"],
    }),
  },
  edit: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["files", "workspace", "editing"],
      verbs: ["edit", "replace", "change", "patch", "update"],
      nouns: ["file", "text", "line", "block", "replacement"],
    }),
  },
  write: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["files", "workspace", "editing"],
      verbs: ["write", "create", "save", "overwrite", "generate"],
      nouns: ["file", "text", "document", "content"],
    }),
  },
  find: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["files", "workspace", "search"],
      verbs: ["find", "locate", "search"],
      nouns: ["file", "path", "glob", "folder", "directory"],
    }),
  },
  grep: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["files", "workspace", "search"],
      verbs: ["search", "find", "grep", "match"],
      nouns: ["pattern", "string", "regex", "lines", "content"],
    }),
  },
  ls: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["files", "workspace"],
      verbs: ["list", "inspect", "browse"],
      nouns: ["directory", "folder", "files", "contents"],
    }),
  },

  // discovery
  list_tools: {
    kind: "read-only",
    weight: "lightweight",
    summary: "List tools. Hint: start with query or intent, then request parameters only for shortlisted tools.",
    recommend: rec({
      domains: ["tools", "discovery"],
      verbs: ["list", "discover", "find", "inspect"],
      nouns: ["tools", "tool", "capabilities", "catalog"],
    }),
  },
  list_scripts: {
    kind: "read-only",
    weight: "standard",
    summary: "List scripts and skills. Hint: use scope and role filters, then run workspace entrypoints with bun_run.",
    recommend: rec({
      domains: ["scripts", "discovery", "automation"],
      verbs: ["list", "discover", "find", "inspect"],
      nouns: ["scripts", "script", "entrypoints", "helpers", "catalog"],
    }),
  },
  activate_tools: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["tools", "discovery"],
      verbs: ["activate", "enable"],
      nouns: ["tools", "tool", "capabilities"],
    }),
  },
  reset_active_tools: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["tools", "discovery"],
      verbs: ["reset", "restore"],
      nouns: ["tools", "defaults", "tool set"],
    }),
  },

  // attachments
  attach_file: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["attachments", "files"],
      verbs: ["attach", "upload", "share"],
      nouns: ["file", "attachment", "document", "image"],
    }),
  },
  read_attachment: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["attachments", "files"],
      verbs: ["read", "inspect", "preview", "load"],
      nouns: ["attachment", "file", "image", "document"],
    }),
  },
  export_attachment: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["attachments", "files"],
      verbs: ["export", "download", "save"],
      nouns: ["attachment", "file", "image", "document"],
    }),
  },

  // model control
  get_model_state: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["models", "provider", "thinking"],
      verbs: ["inspect", "show", "check"],
      nouns: ["model", "provider", "thinking", "effort", "context"],
    }),
  },
  list_models: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["models", "provider"],
      verbs: ["list", "browse", "show"],
      nouns: ["models", "providers", "model", "provider"],
    }),
  },
  provider_quota: {
    kind: "read-only", weight: "lightweight",
    summary: "Inspect provider quota, credits, usage windows and resets; optional bounded shared refresh.",
    recommend: rec({ domains: ["provider", "quota", "budget", "credits"], verbs: ["inspect", "check", "refresh"], nouns: ["quota", "balance", "usage", "remaining", "reset"] }),
  },
  set_model: {
    kind: "mutating", weight: "lightweight",
    summary: "Set model and/or thinking_level together; omit both for current state and valid thinking options.",
    recommend: rec({ domains: ["models", "thinking", "reasoning"], verbs: ["set", "switch", "change"], nouns: ["model", "thinking", "effort", "level"] }),
  },
  switch_model: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["models", "provider"],
      verbs: ["switch", "change", "select", "set"],
      nouns: ["model", "provider"],
    }),
  },
  switch_thinking: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["models", "thinking"],
      verbs: ["switch", "change", "set"],
      nouns: ["thinking", "effort", "reasoning"],
    }),
  },

  // Exact note reads may enqueue refresh/invalidate derived metadata; explicitly activated.
  memory_query: {
    kind: "mixed",
    weight: "standard",
    summary: "Search source-verified local note chunks with bounded snippets and honest partial freshness; may enqueue reconciliation.",
    recommend: rec({ domains: ["notes", "memory"], verbs: ["search", "query", "find"], nouns: ["chunk", "citation", "answer", "reference"] }),
  },
  memory_get: {
    kind: "mixed",
    weight: "standard",
    summary: "Verify and read one exact revision-bound note chunk in single-user mode; no search or arbitrary path reads.",
    recommend: rec({ domains: ["notes", "memory"], verbs: ["read", "verify"], nouns: ["chunk", "reference", "citation", "revision"] }),
  },

  // data
  messages: {
    kind: "mixed",
    weight: "standard",
    recommend: rec({
      domains: ["messages", "chat", "timeline"],
      verbs: ["inspect", "search", "review", "find", "list", "delete"],
      nouns: ["messages", "history", "thread", "chat", "recent", "timeline"],
      negativeTerms: ["notes", "workspace"],
    }),
  },
  chat: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["messages", "chat", "sessions", "agents"],
      verbs: ["send", "relay", "route", "message", "contact"],
      nouns: ["session", "agent", "branch", "chat", "message"],
      negativeTerms: ["timeline search", "history", "notes"],
    }),
  },
  keychain: {
    kind: "mixed",
    weight: "lightweight",
    recommend: rec({
      domains: ["auth", "credentials", "secrets"],
      verbs: ["inspect", "store", "update", "delete"],
      nouns: ["keychain", "secret", "credential", "token", "password"],
    }),
  },

  // workspace
  search_workspace: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["workspace", "notes", "files"],
      verbs: ["search", "find", "look up"],
      nouns: ["notes", "workspace", "file", "files", "docs", "skills"],
    }),
  },
  refresh_workspace_index: {
    kind: "mutating",
    weight: "standard",
    summary: "Rebuild the workspace FTS index.",
    recommend: rec({
      domains: ["workspace", "indexing"],
      verbs: ["refresh", "rebuild", "reindex"],
      nouns: ["index", "workspace index", "fts"],
    }),
  },
  open_office_viewer: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["office", "documents"],
      verbs: ["open", "view", "preview"],
      nouns: ["docx", "xlsx", "pptx", "office", "document", "spreadsheet"],
    }),
  },
  office_read: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["office", "documents"],
      verbs: ["read", "extract", "inspect"],
      nouns: ["docx", "xlsx", "pptx", "office", "document", "spreadsheet"],
    }),
  },
  office_write: {
    kind: "mutating",
    weight: "heavy",
    recommend: rec({
      domains: ["office", "documents"],
      verbs: ["write", "generate", "export"],
      nouns: ["docx", "xlsx", "pptx", "office"],
    }),
  },
  open_workspace_file: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["workspace", "files"],
      verbs: ["open", "inspect", "review"],
      nouns: ["file", "editor", "workspace"],
    }),
  },

  // automation
  schedule_task: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["scheduling", "tasks", "automation"],
      verbs: ["schedule", "delay", "reschedule", "run", "remind"],
      nouns: ["task", "job", "cron", "later", "reminder"],
    }),
  },
  scheduled_tasks: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["scheduling", "tasks"],
      verbs: ["inspect", "list", "check", "review"],
      nouns: ["scheduled task", "scheduled tasks", "jobs", "next run"],
    }),
  },
  bun_run: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["automation", "scripts"],
      verbs: ["run", "execute"],
      nouns: ["bun", "script"],
    }),
  },
  exec_batch: {
    kind: "mutating",
    weight: "heavy",
    recommend: rec({
      domains: ["automation", "shell"],
      verbs: ["run", "execute"],
      nouns: ["batch", "commands", "shell"],
    }),
  },
  search_tool_output: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["logs", "tool output"],
      verbs: ["search", "inspect", "find"],
      nouns: ["tool output", "logs", "handle"],
    }),
  },

  // remote / infrastructure
  ssh: {
    kind: "mixed",
    weight: "standard",
    recommend: rec({
      domains: ["remote", "ssh"],
      verbs: ["connect", "inspect", "run"],
      nouns: ["ssh", "host", "remote", "server"],
    }),
  },
  mcp: {
    kind: "mixed",
    weight: "standard",
    recommend: rec({
      domains: ["external", "integration", "mcp"],
      verbs: ["search", "describe", "connect", "call"],
      nouns: ["mcp", "server", "integration", "github", "jira", "linear", "slack"],
    }),
  },

  // browser
  cdp_browser: {
    kind: "mixed",
    weight: "heavy",
    recommend: rec({
      domains: ["browser", "web"],
      verbs: ["open", "inspect", "click", "navigate"],
      nouns: ["browser", "page", "web", "site"],
    }),
  },

  // windows desktop automation
  win_list_windows: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "ui"],
      verbs: ["list", "inspect", "discover"],
      nouns: ["window", "windows", "desktop app"],
    }),
  },
  win_screenshot: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "ui"],
      verbs: ["capture", "screenshot", "inspect"],
      nouns: ["window", "screenshot", "desktop app"],
    }),
  },
  win_desktop_screenshot: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "ui"],
      verbs: ["capture", "screenshot", "inspect"],
      nouns: ["desktop", "screen", "monitors", "virtual screen"],
    }),
  },
  win_list_monitors: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "display"],
      verbs: ["list", "inspect", "discover"],
      nouns: ["monitor", "monitors", "display layout"],
    }),
  },
  win_monitor_screenshot: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "display"],
      verbs: ["capture", "screenshot", "inspect"],
      nouns: ["monitor", "display", "screen"],
    }),
  },
  win_region_screenshot: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "display"],
      verbs: ["capture", "screenshot", "inspect"],
      nouns: ["region", "area", "screen", "desktop"],
    }),
  },
  win_find_elements: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "ui"],
      verbs: ["find", "inspect", "search"],
      nouns: ["elements", "buttons", "tabs", "window", "controls"],
    }),
  },
  win_click: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "ui"],
      verbs: ["click", "press", "select"],
      nouns: ["button", "tab", "element", "coordinates", "window"],
    }),
  },
  win_type: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "ui"],
      verbs: ["type", "send", "enter"],
      nouns: ["text", "keys", "keystrokes", "window"],
    }),
  },
  win_tree: {
    kind: "read-only",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "ui"],
      verbs: ["inspect", "dump", "discover"],
      nouns: ["accessibility tree", "ui tree", "elements", "window"],
    }),
  },
  win_kill: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["windows", "desktop", "processes"],
      verbs: ["close", "kill", "terminate"],
      nouns: ["window", "process", "dialog", "edge"],
    }),
  },

  // ui
  send_adaptive_card: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["ui", "cards"],
      verbs: ["send", "post", "show"],
      nouns: ["adaptive card", "card", "form"],
    }),
  },
  send_dashboard_widget: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["ui", "widgets"],
      verbs: ["send", "post", "show"],
      nouns: ["widget", "dashboard", "html"],
    }),
  },

  // experiments
  start_autoresearch: {
    kind: "mutating",
    weight: "heavy",
    recommend: rec({
      domains: ["experiments", "research"],
      verbs: ["start", "launch"],
      nouns: ["autoresearch", "experiment", "loop"],
    }),
  },
  stop_autoresearch: {
    kind: "mutating",
    weight: "standard",
    recommend: rec({
      domains: ["experiments", "research"],
      verbs: ["stop", "end"],
      nouns: ["autoresearch", "experiment", "loop"],
    }),
  },
  autoresearch_status: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["experiments", "research"],
      verbs: ["inspect", "check", "show"],
      nouns: ["autoresearch", "status", "experiment"],
    }),
  },

  // lifecycle
  exit_process: {
    kind: "mutating",
    weight: "lightweight",
    recommend: rec({
      domains: ["lifecycle"],
      verbs: ["restart", "reload", "exit"],
      nouns: ["process", "service", "piclaw"],
    }),
  },
  session_status: {
    kind: "read-only",
    weight: "lightweight",
    recommend: rec({
      domains: ["lifecycle", "sessions"],
      verbs: ["check", "list", "inspect"],
      nouns: ["session", "active", "running", "tool"],
    }),
  },
  chat_project: {
    kind: "mixed",
    weight: "lightweight",
    recommend: rec({
      domains: ["chat", "repository", "github", "gitea"],
      verbs: ["get", "set", "clear", "inherit", "link"],
      nouns: ["project", "repository", "issue", "pull request"],
    }),
  },
  session_control: {
    kind: "mixed",
    weight: "standard",
    summary: "Inspect or control another session: assess stuck state, compact, abort, switch model, handle failed runs, wake it, or unblock it.",
    recommend: rec({
      domains: ["lifecycle", "sessions", "agents", "control"],
      verbs: ["inspect", "assess", "compact", "abort", "unblock", "wake", "switch", "retry"],
      nouns: ["session", "agent", "stuck", "compaction", "failed run", "model"],
      negativeTerms: ["send message", "relay chat"],
    }),
  },

  // image processing
  image_process: {
    kind: "mutating",
    weight: "standard",
    summary: "Edit workspace images and icons: resize/crop/convert/optimize, preserve transparency, inspect metadata, and build GIF/favicon-style assets.",
    recommend: rec({
      domains: ["image", "graphics", "media", "workspace", "icons", "favicons"],
      verbs: [
        "resize", "crop", "convert", "optimize", "optimise", "trim", "rotate", "flip",
        "blur", "sharpen", "composite", "overlay", "denoise",
        "greyscale", "grayscale", "adjust", "tint", "negate", "invert",
        "threshold", "normalize", "level", "brighten", "darken", "saturate",
        "render", "rasterize", "animate", "tile", "extend", "pad",
        "extract", "strip", "watermark", "label", "transform", "compress",
      ],
      nouns: [
        "image", "photo", "picture", "icon", "favicon", "logo", "thumbnail", "avatar", "screenshot",
        "png", "jpeg", "jpg", "webp", "avif", "gif", "tiff", "svg", "ico",
        "spritesheet", "sprite", "animation", "frame", "channel", "alpha", "transparency", "background",
        "color", "contrast", "brightness", "saturation", "gamma",
        "metadata", "exif", "icc", "tiles", "deepzoom",
      ],
      keywords: [
        "app icon", "web app icon", "apple touch icon", "transparent png", "preserve transparency",
        "remove background", "favicon", "maskable icon", "social preview image",
      ],
    }),
  },
};

const DEFAULT_CAPABILITY: ToolCapability = {
  kind: "mixed",
  weight: "standard",
};

/** Look up capability metadata for a tool. Returns a sensible default for unknown tools. */
export function getToolCapability(toolName: string): ToolCapability {
  return TOOL_CAPABILITIES[toolName] ?? DEFAULT_CAPABILITY;
}
