type ParamType = "bare" | "autocomplete" | "text";

export interface CommandParam {
  type: ParamType;
  fetch?: string;
  extractField?: string;
  mapLabel?: string;
  placeholder?: string;
  options?: string[];
  allowEmpty?: boolean;
}

const COMMAND_PARAMS: Record<string, CommandParam> = {
  "/model": { type: "autocomplete", fetch: "/agent/models", extractField: "models" },
  "/thinking": { type: "autocomplete", fetch: "/agent/models", extractField: "available_thinking_levels" },
  "/effort": { type: "autocomplete", fetch: "/agent/models", extractField: "available_thinking_levels" },
  "/compact": { type: "text", placeholder: "Instructions (optional)", allowEmpty: true },
  "/stats": { type: "bare" },
  "/state": { type: "bare" },
  "/context": { type: "bare" },
  "/abort": { type: "bare" },
  "/last": { type: "bare" },
  "/restart": { type: "bare" },
  "/tree": { type: "text", placeholder: "Target and options (optional)", allowEmpty: true },
  "/forks": { type: "bare" },
  "/auto-compact": { type: "autocomplete", options: ["on", "off"] },
  "/auto-retry": { type: "autocomplete", options: ["on", "off"] },
  "/cycle-model": { type: "autocomplete", options: ["forward", "backward"] },
  "/cycle-thinking": { type: "bare" },
  "/shell": { type: "text", placeholder: "Shell command" },
  "!": { type: "text", placeholder: "Shell command" },
  "/bash": { type: "text", placeholder: "Bash command" },
  "/queue": { type: "text", placeholder: "Follow-up message" },
  "/queue-all": { type: "text", placeholder: "Follow-up message" },
  "/steer": { type: "text", placeholder: "Steering message" },
  "/steering-mode": { type: "autocomplete", options: ["all", "one-at-a-time"] },
  "/followup-mode": { type: "autocomplete", options: ["all", "one-at-a-time"] },
  "/session-name": { type: "text", placeholder: "Session name", allowEmpty: true },
  "/new-session": { type: "autocomplete", fetch: "/agent/branches?include_archived=0", extractField: "chats", mapLabel: "chat_jid", allowEmpty: true },
  "/switch-session": { type: "text", placeholder: "Session file path" },
  "/session-rotate": { type: "text", placeholder: "Instructions (optional)", allowEmpty: true },
  "/fork": { type: "text", placeholder: "Entry ID" },
  "/clone": { type: "bare" },
  "/export-html": { type: "text", placeholder: "Output path", allowEmpty: true },
  "/passkey": { type: "text", placeholder: "Action and target", allowEmpty: true },
  "/passkeys": { type: "text", placeholder: "Action and target", allowEmpty: true },
  "/totp": { type: "text", placeholder: "Action and confirmation code", allowEmpty: true },
  "/qr": { type: "text", placeholder: "Text or URL" },
  "/search": { type: "text", placeholder: "Query and options" },
  "/label": { type: "text", placeholder: "Entry ID and label" },
  "/labels": { type: "bare" },
  "/agent-name": { type: "text", placeholder: "Agent display name", allowEmpty: true },
  "/agent-avatar": { type: "text", placeholder: "Avatar URL", allowEmpty: true },
  "/user-name": { type: "text", placeholder: "Your display name", allowEmpty: true },
  "/user-avatar": { type: "text", placeholder: "Avatar URL", allowEmpty: true },
  "/user-github": { type: "text", placeholder: "GitHub username or URL" },
  "/login": { type: "text", placeholder: "Provider name", allowEmpty: true },
  "/logout": { type: "text", placeholder: "Provider name", allowEmpty: true },
  "/ask": { type: "text", placeholder: "Instance ID and prompt" },
};

const COMMAND_PARAM_ALIASES: Record<string, string> = {
  "/passkeys": "/passkey",
};

export function getCommandParam(name: string): CommandParam | undefined {
  const normalized = COMMAND_PARAM_ALIASES[name] ?? name;
  return COMMAND_PARAMS[normalized];
}

export function getAutocompleteOptions(param: CommandParam): string[] | undefined {
  if (param.type !== "autocomplete") return undefined;
  return param.options;
}

export { COMMAND_PARAMS };
export type { ParamType };
