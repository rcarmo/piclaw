/**
 * agent-control/command-registry.ts – Command metadata and alias resolution.
 *
 * Defines the list of all known control commands, their descriptions, and
 * aliases (e.g. /models → /model, /ctx → /context). Provides
 * normalizeControlCommandName() to resolve aliases before parser lookup.
 *
 * Consumers:
 *   - agent-control-parser.ts uses normalizeControlCommandName().
 *   - handlers/info.ts uses CONTROL_COMMAND_DEFINITIONS for /commands output.
 */

/** Registry entry describing parser/apply handlers for a control command. */
export interface ControlCommandDefinition {
  name: string;
  description: string;
  aliases?: string[];
}

/** Metadata for all control commands: name, description, aliases. */
export const CONTROL_COMMAND_DEFINITIONS: ControlCommandDefinition[] = [
  { name: "/model", description: "Select model or list available models (alias /models)", aliases: ["/models"] },
  { name: "/cycle-model", description: "Cycle to the next available model" },
  { name: "/thinking", description: "Show or set thinking/effort level (alias /effort)", aliases: ["/effort"] },
  { name: "/cycle-thinking", description: "Cycle thinking level" },
  { name: "/state", description: "Show current session state" },
  { name: "/stats", description: "Show session token and cost stats" },
  { name: "/context", description: "Show context window usage", aliases: ["/ctx"] },
  { name: "/last", description: "Show last assistant response" },
  { name: "/compact", description: "Manually compact the session" },
  { name: "/auto-compact", description: "Toggle auto-compaction" },
  { name: "/auto-retry", description: "Toggle auto-retry" },
  { name: "/abort", description: "Abort the current response" },
  { name: "/abort-retry", description: "Abort retry backoff" },
  { name: "/abort-bash", description: "Abort running bash command" },
  { name: "/shell", description: "Run a shell command and return output" },
  { name: "/bash", description: "Run a shell command and add output to context" },
  { name: "/queue", description: "Queue a follow-up message (one-at-a-time)" },
  { name: "/queue-all", description: "Queue a follow-up message (batch all)" },
  { name: "/steer", description: "Send immediate steering input" },
  { name: "/steering-mode", description: "Set steering mode (all|one)" },
  { name: "/followup-mode", description: "Set follow-up mode (all|one)" },
  { name: "/session-name", description: "Set or show the session name" },
  { name: "/new-session", description: "Start a new session" },
  { name: "/switch-session", description: "Switch to a session file" },
  { name: "/session-rotate", description: "Rotate the current persisted session into an archived file" },
  { name: "/fork", description: "Fork from a previous message" },
  { name: "/clone", description: "Clone from the current tree entry into a new session" },
  { name: "/forks", description: "List forkable messages" },
  { name: "/tree", description: "List the session tree (default tail 10) and navigate branches" },
  { name: "/label", description: "Set or clear a label on a tree entry" },
  { name: "/labels", description: "List labeled entries" },
  { name: "/agent-name", description: "Set or show the agent display name" },
  { name: "/agent-avatar", description: "Set or show the agent avatar URL" },
  { name: "/user-name", description: "Set or show your display name" },
  { name: "/user-avatar", description: "Set or show your avatar URL" },
  { name: "/user-github", description: "Set your name/avatar from a GitHub handle or profile URL" },
  { name: "/export-html", description: "Export session to HTML" },
  { name: "/passkey", description: "Manage passkeys (enrol/list/delete)", aliases: ["/passkeys"] },
  { name: "/totp", description: "Show/initialize or reset the TOTP enrolment QR code (use /totp reset <code> for reset confirmation)" },
  { name: "/qr", description: "Generate a QR code for text or a URL" },
  { name: "/search", description: "Search notes and skills in the workspace" },
  { name: "/restart", description: "Restart the agent and stop subprocesses" },
  { name: "/exit", description: "Exit the current piclaw process immediately (Supervisor will restart it)" },
  { name: "/login", description: "Login to an AI model provider (OAuth or API key)" },
  { name: "/logout", description: "Logout from an AI model provider" },
  { name: "/settings", description: "Open the settings dialog" },
  { name: "/commands", description: "List available commands" },
  { name: "/ask", description: "Send a prompt to a paired remote instance (/ask <instance_id|fingerprint> <prompt>)" },
];

const ALIAS_MAP = new Map<string, string>();
for (const def of CONTROL_COMMAND_DEFINITIONS) {
  ALIAS_MAP.set(def.name, def.name);
  const dashAlias = def.name.replace(/-/g, "_");
  if (dashAlias !== def.name) ALIAS_MAP.set(dashAlias, def.name);
  for (const alias of def.aliases ?? []) {
    ALIAS_MAP.set(alias, def.name);
  }
}

/** Resolve command aliases (e.g. /models → /model, /ctx → /context). */
export function normalizeControlCommandName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/_/g, "-");
  return ALIAS_MAP.get(normalized) ?? normalized;
}
