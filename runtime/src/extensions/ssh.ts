import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { getChatJid } from "../core/chat-context.js";
import { registerToolStatusHintProvider } from "../tool-status-hints.js";
import type {
  SshConfig,
  SshConfigApplyTiming,
  SshConfigClearResult,
  SshConfigSetResult,
} from "../types.js";

type SessionSshConfigInput = Omit<SshConfig, "chat_jid" | "created_at" | "updated_at" | "last_used_at">;
type SshToolResult = { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };

export interface SshToolHandlers {
  get(chatJid: string): SshConfig | null;
  isActive?(chatJid: string): boolean;
  set(chatJid: string, config: SessionSshConfigInput, signal?: AbortSignal): Promise<SshConfigSetResult>;
  clear(chatJid: string, signal?: AbortSignal): Promise<SshConfigClearResult>;
}

let registeredHandlers: SshToolHandlers | null = null;
let handlerGeneration = 0;

const SSH_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 1 1 8 0v3"></path></svg>`;

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stripRemotePathFromSshTarget(value: unknown): string | null {
  const target = readTrimmedString(value);
  if (!target) return null;
  const match = target.match(/^(.*?):((?:\/|~).*)$/);
  return (match?.[1] || target).trim() || null;
}

export function getSshStatusHintTarget(chatJid: string, payload?: Record<string, unknown> | null): string | null {
  return stripRemotePathFromSshTarget(
    readTrimmedString(
      payload?.ssh_target,
      registeredHandlers?.get(chatJid)?.ssh_target,
    ),
  );
}

export function setSshToolHandlers(handlers: SshToolHandlers | null | undefined): () => void {
  const generation = ++handlerGeneration;
  registeredHandlers = handlers ?? null;
  return () => { if (handlerGeneration === generation) registeredHandlers = null; };
}

registerToolStatusHintProvider({
  id: "ssh",
  buildHints: ({ chatJid, payload }) => {
    const target = getSshStatusHintTarget(chatJid, payload);
    if (!target) return null;
    return {
      key: "ssh",
      icon_svg: SSH_STATUS_ICON_SVG,
      label: target,
      title: "SSH target",
      kind: "remote",
    };
  },
});

const SshToolSchema = Type.Object({
  action: Type.Union([Type.Literal("get"), Type.Literal("set"), Type.Literal("clear")], {
    description: "Operation to perform for the current chat SSH config.",
  }),
  chat_jid: Type.Optional(Type.String({ description: "Target chat JID. Defaults to the current chat context." })),
  ssh_target: Type.Optional(Type.String({ description: "SSH target as user@host or host, optionally with :/remote/path suffix." })),
  ssh_port: Type.Optional(Type.Integer({ description: "SSH port (default 22).", minimum: 1, maximum: 65535 })),
  private_key_keychain: Type.Optional(Type.String({ description: "Keychain entry containing the SSH private key." })),
  known_hosts_keychain: Type.Optional(Type.String({ description: "Optional keychain entry containing known_hosts data. Use empty string to clear." })),
  strict_host_key_checking: Type.Optional(Type.Union([
    Type.Literal("yes"),
    Type.Literal("accept-new"),
    Type.Literal("no"),
  ], {
    description: "StrictHostKeyChecking mode.",
  })),
});

const SSH_TOOL_HINT = [
  "## SSH",
  "Use ssh to inspect or change the SSH profile for the current session.",
  "When a live session exists, SSH-backed core tools switch immediately for the current turn.",
  "An active SSH profile redirects read, grep, find, ls, bash, edit, and write through the configured keychain-backed SSH connection.",
  "Live SSH tool redirection and stored SSH profiles are cleared at the end of each agent turn.",
].join("\n");

function normalizeChatJid(value: string | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || getChatJid("web:default");
}

function normalizeKnownHostsKeychain(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function formatApplyTiming(value: SshConfigApplyTiming): string {
  if (value === "immediate") return "Applied immediately to the live session for this turn.";
  if (value === "next_turn") return "Applies on the next turn for the active session, then clears at turn end.";
  return "Applies when the next session is created, then clears at turn end.";
}

/** Registers the agent-only session-scoped SSH configuration tool. */
export const sshTool: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${SSH_TOOL_HINT}`,
  }));

  pi.registerTool({
    name: "ssh",
    label: "ssh",
    description: "Get, set, or clear the session-scoped SSH profile that redirects core tools to a remote host. When active, read/grep/find/ls/bash/edit/write execute on the remote host via the configured keychain-backed SSH connection.",
    promptSnippet: "ssh: set up or inspect an SSH profile to redirect read/grep/find/ls/bash/edit/write to a remote host via keychain-backed SSH.",
    parameters: SshToolSchema,
    async execute(_toolCallId, params, signal): Promise<SshToolResult> {
      const handlers = registeredHandlers;
      if (!handlers) {
        return {
          content: [{ type: "text", text: "ssh is not available in this runtime." }],
          details: { available: false },
        };
      }

      const chatJid = normalizeChatJid(params.chat_jid);
      if (params.action === "get") {
        const config = handlers.get(chatJid);
        const liveRedirectionActive = Boolean(handlers.isActive?.(chatJid));
        if (!config) {
          return {
            content: [{ type: "text", text: `No SSH config stored for ${chatJid}. Live SSH tool redirection is ${liveRedirectionActive ? "active" : "inactive"}. Redirected tools when active: read, grep, find, ls, bash, edit, write.` }],
            details: { action: "get", chat_jid: chatJid, configured: false, live_redirection_active: liveRedirectionActive, redirected_tools: ["read", "grep", "find", "ls", "bash", "edit", "write"], config: null },
          };
        }
        return {
          content: [{ type: "text", text: `SSH config for ${chatJid}: ${config.ssh_target} (port ${config.ssh_port}, key ${config.private_key_keychain}). Live SSH tool redirection is ${liveRedirectionActive ? "active" : "inactive"}. Redirected tools when active: read, grep, find, ls, bash, edit, write.` }],
          details: { action: "get", chat_jid: chatJid, configured: true, live_redirection_active: liveRedirectionActive, redirected_tools: ["read", "grep", "find", "ls", "bash", "edit", "write"], config },
        };
      }

      if (params.action === "set") {
        const sshTarget = typeof params.ssh_target === "string" ? params.ssh_target.trim() : "";
        const privateKeyKeychain = typeof params.private_key_keychain === "string" ? params.private_key_keychain.trim() : "";
        if (!sshTarget) {
          return {
            content: [{ type: "text", text: "Provide ssh_target for action=set." }],
            details: { action: "set", chat_jid: chatJid, updated: false },
          };
        }
        if (!privateKeyKeychain) {
          return {
            content: [{ type: "text", text: "Provide private_key_keychain for action=set." }],
            details: { action: "set", chat_jid: chatJid, updated: false },
          };
        }

        const result = await handlers.set(chatJid, {
          ssh_target: sshTarget,
          ssh_port: params.ssh_port ?? 22,
          private_key_keychain: privateKeyKeychain,
          known_hosts_keychain: normalizeKnownHostsKeychain(params.known_hosts_keychain),
          strict_host_key_checking: params.strict_host_key_checking ?? "yes",
        }, signal);

        return {
          content: [{
            type: "text",
            text: `Stored SSH config for ${chatJid}: ${result.config.ssh_target} (port ${result.config.ssh_port}). ${formatApplyTiming(result.apply_timing)}`,
          }],
          details: {
            action: "set",
            chat_jid: chatJid,
            updated: true,
            apply_timing: result.apply_timing,
            turn_scoped_redirection: true,
            config: result.config,
          },
        };
      }

      const result = await handlers.clear(chatJid, signal);
      return {
        content: [{
          type: "text",
          text: result.deleted
            ? `Cleared SSH config for ${chatJid}. ${formatApplyTiming(result.apply_timing)}`
            : `No SSH config existed for ${chatJid}. ${formatApplyTiming(result.apply_timing)}`,
        }],
        details: {
          action: "clear",
          chat_jid: chatJid,
          deleted: result.deleted,
          apply_timing: result.apply_timing,
          turn_scoped_redirection: true,
        },
      };
    },
  });
};
