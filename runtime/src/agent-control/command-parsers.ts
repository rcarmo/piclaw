/**
 * agent-control/command-parsers.ts – Individual command parsing functions.
 *
 * Each exported function takes the argument string and raw text of a command
 * and returns the corresponding AgentControlCommand variant. These are
 * registered in the COMMAND_PARSERS map keyed by normalised command name.
 *
 * Consumers:
 *   - agent-control-parser.ts looks up parsers from COMMAND_PARSERS.
 */

import type { AgentControlCommand } from "./agent-control-types.js";
import { parseQueueMode, parseToggle, parseTreeArgs, splitArgs } from "./parser-utils.js";

/** Function signature for a command parser: takes args and raw text, returns a command. */
export type CommandParser = (args: string, raw: string) => AgentControlCommand;

const simple = (type: AgentControlCommand["type"]): CommandParser => {
  return (_args, raw) => ({ type, raw } as AgentControlCommand);
};

type PasskeyAction = Extract<AgentControlCommand, { type: "passkey" }>["action"];
type TotpAction = Extract<AgentControlCommand, { type: "totp" }>["action"];
type SearchScope = Extract<AgentControlCommand, { type: "search_workspace" }>["scope"];

function parsePasskeyAction(action: string | undefined): PasskeyAction {
  if (!action) return undefined;
  return ["enrol", "enroll", "list", "delete", "remove"].includes(action) ? (action as PasskeyAction) : undefined;
}

function parseTotpAction(action: string | undefined): TotpAction {
  if (!action) return undefined;
  return action === "enrol" || action === "enroll" || action === "reset" ? action : undefined;
}

function parseSearchScope(value: string | undefined): SearchScope {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return normalized === "notes" || normalized === "skills" || normalized === "all"
    ? normalized
    : undefined;
}

/** Parse /model arguments: provider/modelId or bare model name. */
export function parseModel(args: string, raw: string): AgentControlCommand {
  const tokens = args.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { type: "model", raw };
  }

  const [first, ...remaining] = tokens;
  if (first && first.includes("/")) {
    const [provider, ...modelParts] = first.split("/");
    const modelId = modelParts.join("/");
    return {
      type: "model",
      provider: provider || undefined,
      modelId: modelId || undefined,
      raw,
    };
  }

  if (remaining.length > 0) {
    return {
      type: "model",
      provider: first,
      modelId: remaining.join(" "),
      raw,
    };
  }

  return {
    type: "model",
    modelId: first,
    raw,
  };
}

/** Parse /thinking arguments: level name or empty for query. */
export function parseThinking(args: string, raw: string): AgentControlCommand {
  const level = args.split(/\s+/).filter(Boolean)[0];
  return {
    type: "thinking",
    level: level || undefined,
    raw,
  };
}

/** Parse /shell arguments: optional command string. */
export function parseShell(args: string, raw: string): AgentControlCommand {
  return {
    type: "shell",
    command: args || undefined,
    raw,
  };
}

/** Parse /queue arguments: message text to inject. */
export function parseQueue(args: string, raw: string): AgentControlCommand {
  return {
    type: "queue",
    message: args || undefined,
    raw,
  };
}

/** Parse /queue-all arguments: message text for all chats. */
export function parseQueueAll(args: string, raw: string): AgentControlCommand {
  return {
    type: "queue_all",
    message: args || undefined,
    raw,
  };
}

/** Parse /steer arguments: immediate steering message text. */
export function parseSteer(args: string, raw: string): AgentControlCommand {
  return {
    type: "steer",
    message: args || undefined,
    raw,
  };
}

/** Parse /compact arguments: optional custom instructions. */
export function parseCompact(args: string, raw: string): AgentControlCommand {
  return {
    type: "compact",
    instructions: args || undefined,
    raw,
  };
}

/** Parse /auto-compact arguments: on/off toggle. */
export function parseAutoCompact(args: string, raw: string): AgentControlCommand {
  return {
    type: "auto_compact",
    enabled: parseToggle(args),
    raw,
  };
}

/** Parse /auto-retry arguments: on/off toggle. */
export function parseAutoRetry(args: string, raw: string): AgentControlCommand {
  return {
    type: "auto_retry",
    enabled: parseToggle(args),
    raw,
  };
}

/** Parse /cycle-model arguments: optional forward/backward direction. */
export function parseCycleModel(args: string, raw: string): AgentControlCommand {
  const dirRaw = args.toLowerCase();
  const direction = ["back", "backward", "prev", "previous"].includes(dirRaw)
    ? "backward"
    : "forward";
  return {
    type: "cycle_model",
    direction,
    raw,
  };
}

/** Parse /steering-mode arguments: "all" or "one-at-a-time". */
export function parseSteeringMode(args: string, raw: string): AgentControlCommand {
  return {
    type: "steering_mode",
    mode: parseQueueMode(args),
    raw,
  };
}

/** Parse /followup-mode arguments: "all" or "one-at-a-time". */
export function parseFollowupMode(args: string, raw: string): AgentControlCommand {
  return {
    type: "followup_mode",
    mode: parseQueueMode(args),
    raw,
  };
}

/** Parse /session-name arguments: optional new name. */
export function parseSessionName(args: string, raw: string): AgentControlCommand {
  return {
    type: "session_name",
    name: args || undefined,
    raw,
  };
}

/** Parse /new-session arguments: optional parent session path. */
export function parseNewSession(args: string, raw: string): AgentControlCommand {
  return {
    type: "new_session",
    parent: args || undefined,
    raw,
  };
}

/** Parse /switch-session arguments: session path. */
export function parseSwitchSession(args: string, raw: string): AgentControlCommand {
  return {
    type: "switch_session",
    path: args || undefined,
    raw,
  };
}

/** Parse /session-rotate arguments: optional compaction instructions. */
export function parseSessionRotate(args: string, raw: string): AgentControlCommand {
  return {
    type: "session_rotate",
    instructions: args || undefined,
    raw,
  };
}

/** Parse /fork arguments: optional entry ID to fork from. */
export function parseFork(args: string, raw: string): AgentControlCommand {
  return {
    type: "fork",
    entryId: args || undefined,
    raw,
  };
}

/** Parse /export-html arguments: optional output file path. */
export function parseExportHtml(args: string, raw: string): AgentControlCommand {
  return {
    type: "export_html",
    path: args || undefined,
    raw,
  };
}

/** Parse /passkey arguments: action + optional target. */
export function parsePasskey(args: string, raw: string): AgentControlCommand {
  const tokens = splitArgs(args);
  const action = parsePasskeyAction(tokens[0]?.toLowerCase());
  const target = tokens.slice(1).join(" ").trim() || undefined;
  return {
    type: "passkey",
    action,
    target,
    raw,
  };
}

/** Parse /totp arguments: action [confirmation-code]. */
export function parseTotp(args: string, raw: string): AgentControlCommand {
  const tokens = splitArgs(args);
  const action = parseTotpAction(tokens[0]?.toLowerCase());
  const code = action === "reset" ? tokens.slice(1).join(" ").trim() || undefined : undefined;

  return {
    type: "totp",
    action,
    code,
    raw,
  };
}

/** Parse /qr arguments: raw text. */
export function parseQr(args: string, raw: string): AgentControlCommand {
  return {
    type: "qr",
    text: args || undefined,
    raw,
  };
}

/** Parse /bash arguments: optional command string. */
export function parseBash(args: string, raw: string): AgentControlCommand {
  return {
    type: "bash",
    command: args || undefined,
    raw,
  };
}

/** Parse /tree arguments: target, mode, limit, offset, summarize flags. */
export function parseTree(args: string, raw: string): AgentControlCommand {
  const parsed = parseTreeArgs(args);
  return {
    type: "tree",
    targetId: parsed.targetId,
    summarize: parsed.summarize,
    customInstructions: parsed.customInstructions,
    replaceInstructions: parsed.replaceInstructions,
    label: parsed.label,
    limit: parsed.limit,
    offset: parsed.offset,
    mode: parsed.mode,
    raw,
  };
}

/** Parse /label arguments: target entry ID and label text. */
export function parseLabel(args: string, raw: string): AgentControlCommand {
  const tokens = splitArgs(args);
  const targetId = tokens[0];
  const label = tokens.slice(1).join(" ").trim() || undefined;
  return {
    type: "label",
    targetId: targetId || undefined,
    label,
    raw,
  };
}

/** Parse /agent-name arguments: new display name. */
export function parseAgentName(args: string, raw: string): AgentControlCommand {
  return {
    type: "agent_name",
    name: args || undefined,
    raw,
  };
}

/** Parse /agent-avatar arguments: avatar URL or file path. */
export function parseAgentAvatar(args: string, raw: string): AgentControlCommand {
  return {
    type: "agent_avatar",
    avatar: args || undefined,
    raw,
  };
}

/** Parse /user-name arguments: new display name. */
export function parseUserName(args: string, raw: string): AgentControlCommand {
  return {
    type: "user_name",
    name: args || undefined,
    raw,
  };
}

/** Parse /user-avatar arguments: avatar URL or file path. */
export function parseUserAvatar(args: string, raw: string): AgentControlCommand {
  return {
    type: "user_avatar",
    avatar: args || undefined,
    raw,
  };
}

/** Parse /user-github arguments: GitHub profile URL, @handle, or username. */
export function parseUserGithub(args: string, raw: string): AgentControlCommand {
  return {
    type: "user_github",
    profile: args || undefined,
    raw,
  };
}

/** Parse /login arguments: optional provider name. */
export function parseLogin(args: string, raw: string): AgentControlCommand {
  return {
    type: "login",
    provider: args.trim() || undefined,
    raw,
  };
}

/** Parse /logout arguments: optional provider name. */
export function parseLogout(args: string, raw: string): AgentControlCommand {
  return {
    type: "logout",
    provider: args.trim() || undefined,
    raw,
  };
}

/** Parse /search-workspace arguments: query, scope, limit, offset, flags. */
export function parseSearch(args: string, raw: string): AgentControlCommand {
  const tokens = splitArgs(args);
  let scope: "notes" | "skills" | "all" | undefined;
  let limit: number | undefined;
  let offset: number | undefined;
  let refresh: boolean | undefined;
  let maxKb: number | undefined;
  const queryParts: string[] = [];

  const readNumber = (value?: string): number | undefined => {
    if (!value) return undefined;
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
    return undefined;
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "--scope") {
      const next = tokens[i + 1];
      if (next && !next.startsWith("--")) {
        scope = parseSearchScope(next);
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--scope=")) {
      scope = parseSearchScope(token.slice("--scope=".length));
      i += 1;
      continue;
    }
    if (token === "--notes") { scope = "notes"; i += 1; continue; }
    if (token === "--skills") { scope = "skills"; i += 1; continue; }
    if (token === "--all") { scope = "all"; i += 1; continue; }
    if (token === "--limit") {
      const next = tokens[i + 1];
      const parsed = readNumber(next && !next.startsWith("--") ? next : undefined);
      if (parsed !== undefined) limit = parsed;
      i += parsed !== undefined ? 2 : 1;
      continue;
    }
    if (token.startsWith("--limit=")) {
      const parsed = readNumber(token.slice("--limit=".length));
      if (parsed !== undefined) limit = parsed;
      i += 1;
      continue;
    }
    if (token === "--offset") {
      const next = tokens[i + 1];
      const parsed = readNumber(next && !next.startsWith("--") ? next : undefined);
      if (parsed !== undefined) offset = parsed;
      i += parsed !== undefined ? 2 : 1;
      continue;
    }
    if (token.startsWith("--offset=")) {
      const parsed = readNumber(token.slice("--offset=".length));
      if (parsed !== undefined) offset = parsed;
      i += 1;
      continue;
    }
    if (token === "--refresh") { refresh = true; i += 1; continue; }
    if (token === "--no-refresh") { refresh = false; i += 1; continue; }
    if (token === "--max-kb") {
      const next = tokens[i + 1];
      const parsed = readNumber(next && !next.startsWith("--") ? next : undefined);
      if (parsed !== undefined) maxKb = parsed;
      i += parsed !== undefined ? 2 : 1;
      continue;
    }
    if (token.startsWith("--max-kb=")) {
      const parsed = readNumber(token.slice("--max-kb=".length));
      if (parsed !== undefined) maxKb = parsed;
      i += 1;
      continue;
    }

    queryParts.push(token);
    i += 1;
  }

  const query = queryParts.join(" ").trim();

  return {
    type: "search_workspace",
    query: query || undefined,
    scope,
    limit,
    offset,
    refresh,
    max_kb: maxKb,
    raw,
  };
}

/** Map of normalised command names to their parser functions. */
export const COMMAND_PARSERS: Record<string, CommandParser> = {
  "/model": parseModel,
  "/thinking": parseThinking,
  "/effort": parseThinking,
  "/commands": simple("commands"),
  "/restart": simple("restart"),
  "/exit": simple("exit"),
  "/shell": parseShell,
  "/queue": parseQueue,
  "/queue-all": parseQueueAll,
  "/steer": parseSteer,
  "/state": simple("state"),
  "/stats": simple("stats"),
  "/context": simple("context"),
  "/last": simple("last"),
  "/compact": parseCompact,
  "/auto-compact": parseAutoCompact,
  "/auto-retry": parseAutoRetry,
  "/abort": simple("abort"),
  "/abort-retry": simple("abort_retry"),
  "/abort-bash": simple("abort_bash"),
  "/cycle-model": parseCycleModel,
  "/cycle-thinking": simple("cycle_thinking"),
  "/steering-mode": parseSteeringMode,
  "/followup-mode": parseFollowupMode,
  "/session-name": parseSessionName,
  "/new-session": parseNewSession,
  "/switch-session": parseSwitchSession,
  "/session-rotate": parseSessionRotate,
  "/fork": parseFork,
  "/forks": simple("forks"),
  "/export-html": parseExportHtml,
  "/passkey": parsePasskey,
  "/totp": parseTotp,
  "/qr": parseQr,
  "/search": parseSearch,
  "/bash": parseBash,
  "/tree": parseTree,
  "/label": parseLabel,
  "/labels": simple("labels"),
  "/agent-name": parseAgentName,
  "/agent-avatar": parseAgentAvatar,
  "/user-name": parseUserName,
  "/user-avatar": parseUserAvatar,
  "/user-github": parseUserGithub,
  "/login": parseLogin,
  "/logout": parseLogout,
};
