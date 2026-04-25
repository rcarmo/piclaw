/**
 * keychain-tools – registers a keychain tool for listing and retrieving entries.
 */
import { Type } from "@sinclair/typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";

import { registerToolStatusHintProvider } from "../tool-status-hints.js";
import {
  deleteKeychainEntry,
  getKeychainEntry,
  listInjectableKeychainEntries,
  listInjectableKeychainEnvNames,
  listKeychainEntries,
  setKeychainEntry,
} from "../secure/keychain.js";

const KEYCHAIN_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="14" r="3"></circle><path d="M11 14h9"></path><path d="M16 14v-2"></path><path d="M19 14v2"></path></svg>`;

const KeychainToolSchema = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("set"), Type.Literal("delete")], {
    description: "Operation to perform: list entries, get a value, store/update an entry, or delete an entry.",
  }),
  name: Type.Optional(Type.String({ description: "Keychain entry name (required for action=get/set/delete)." })),
  field: Type.Optional(
    Type.Union([Type.Literal("secret"), Type.Literal("username")], {
      description: "Field to return for action=get (default: secret).",
    }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal("token"), Type.Literal("password"), Type.Literal("basic"), Type.Literal("secret")], {
      description: "Entry type for action=set (default: secret).",
    }),
  ),
  secret: Type.Optional(Type.String({ description: "Plaintext secret for action=set." })),
  username: Type.Optional(Type.String({ description: "Optional username for action=set." })),
  limit: Type.Optional(Type.Integer({ description: "Max entries for action=list (1-200).", minimum: 1, maximum: 200 })),
});

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

registerToolStatusHintProvider({
  id: "keychain",
  buildHints: ({ toolName, args }) => {
    if (toolName !== "keychain") return null;
    const record = args && typeof args === "object" ? args as Record<string, unknown> : null;
    const name = readTrimmedString(record?.name);
    if (!name) return null;
    return {
      key: "keychain",
      icon_svg: KEYCHAIN_STATUS_ICON_SVG,
      label: name,
      title: `Keychain entry • ${name}`,
      kind: "profile",
    };
  },
});

function clampLimit(value: number | undefined, fallback = 100): number {
  if (!Number.isFinite(value)) return fallback;
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, 1), 200);
}

const KEYCHAIN_HINT = [
  "## Keychain",
  "Use keychain primarily to list available key names and manage entries by name.",
  "Default access path: rely on automatically injected environment variables in bash/SSH and keychain-backed profile fields in other tools.",
  "Use keychain get only as an absolute last resort when no tool or env-based path can consume the secret directly.",
  "Never inline fetched secrets into shell commands when an env var or profile reference is available.",
  "Only reveal secrets to the user when explicitly requested.",
].join("\n");

function listPrefixedEntries(prefix: string, options: { excludeSuffixes?: string[] } = {}): string[] {
  return listKeychainEntries()
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(prefix))
    .filter((name) => !(options.excludeSuffixes || []).some((suffix) => name.endsWith(suffix)))
    .sort();
}

function buildProfileHint(title: string, entries: string[], guidance: string): string {
  if (entries.length === 0) {
    return [title, `No matching profiles discovered. ${guidance}`].join("\n");
  }
  const preview = entries.slice(0, 10).map((name) => `- ${name}`).join("\n");
  const more = entries.length > 10 ? `\n- … ${entries.length - 10} more` : "";
  return [title, preview + more, guidance].join("\n");
}

function buildIntegrationProfileHints(): string {
  const sshProfiles = listPrefixedEntries("ssh/", { excludeSuffixes: [".known_hosts", ".pub"] });
  const proxmoxProfiles = listPrefixedEntries("proxmox/");
  const portainerProfiles = listPrefixedEntries("portainer/");
  return [
    "## Integration profiles",
    buildProfileHint("### SSH keychain profiles", sshProfiles, "Use the ssh tool with private_key_keychain/known_hosts_keychain references instead of fetching key material."),
    proxmoxProfiles.length ? buildProfileHint("### Proxmox token profiles", proxmoxProfiles, "Use the proxmox tool (addon) with api_token_keychain references instead of fetching token material.") : "",
    portainerProfiles.length ? buildProfileHint("### Portainer token profiles", portainerProfiles, "Use the portainer tool (addon) with api_token_keychain references instead of fetching token material.") : "",
  ].filter(Boolean).join("\n\n");
}

function buildInjectedBashEnvHint(): string {
  const entries = listInjectableKeychainEntries();
  if (entries.length === 0) {
    return [
      "## Bash secret env",
      "Keychain entries are automatically injected as environment variables into bash and SSH commands. Names with `/`, `-`, or `.` are sanitized (replaced with `_` and uppercased), e.g. `github/piclaw-bot-pat` becomes `$GITHUB_PICLAW_BOT_PAT`. This is the default and preferred access path. Do NOT fetch secrets and inline them into shell commands; just reference $ENTRY_NAME directly.",
    ].join("\n");
  }

  const preview = entries.slice(0, 20).map(({ envName, keychainName }) =>
    envName === keychainName ? `- $${envName}` : `- $${envName}  (from keychain: ${keychainName})`
  ).join("\n");
  const more = entries.length > 20 ? `\n- … ${entries.length - 20} more` : "";
  return [
    "## Bash secret env",
    "Keychain entries are automatically injected as environment variables into bash and SSH commands. Names with `/`, `-`, or `.` are sanitized (replaced with `_` and uppercased), e.g. `github/piclaw-bot-pat` becomes `$GITHUB_PICLAW_BOT_PAT`. This is the default and preferred access path. Do NOT fetch secrets and inline them into shell commands; just reference $ENTRY_NAME directly.",
    "",
    `${preview}${more}`,
    "",
    "Reference these as $VAR_NAME in bash commands. Do NOT call keychain get and inline the secret into the command.",
  ].join("\n");
}

type KeychainToolDetails = {
  count: number;
  entries: ReturnType<typeof listKeychainEntries>;
  name: string;
  field: string;
  type: string;
  access_method?: "direct_get_last_resort";
};

/** Extension factory that registers keychain. */
export const keychainTools: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${KEYCHAIN_HINT}\n\n${buildInjectedBashEnvHint()}\n\n${buildIntegrationProfileHints()}`,
  }));

  pi.registerTool({
    name: "keychain",
    label: "keychain",
    description: "List keychain entries, retrieve values, store/update entries, or delete entries. Prefer env injection and keychain-backed profile references over reading secrets directly. Entries are automatically injected as environment variables (names with `/`, `-`, `.` are sanitized to `_` and uppercased) into bash and SSH commands — treat keychain get as a last resort and do NOT inline fetched secrets into shell commands.",
    promptSnippet: "keychain: list/get/set/delete secure keychain entries by name. Prefer auto-injected env vars and profile references; use keychain get only as a last resort, and never inline fetched secrets into commands.",
    parameters: KeychainToolSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<KeychainToolDetails>> {
      if (params.action === "list") {
        const limit = clampLimit(params.limit, 100);
        const entries = listKeychainEntries().slice(0, limit);
        if (entries.length === 0) {
          return {
            content: [{ type: "text", text: "No keychain entries found." }],
            details: { count: 0, entries: [], name: "", field: "", type: "" },
          };
        }

        const lines = entries.map((entry) => `• ${entry.name} (${entry.type})`);
        const injectable = listInjectableKeychainEnvNames();
        const envNote = injectable.length > 0
          ? `\n\nEntries with shell-safe names are auto-injected as env vars into bash by default. Prefer $NAME in commands instead of keychain get or inlining secrets.`
          : '';
        return {
          content: [{ type: "text", text: `Keychain entries (${entries.length}):\n${lines.join("\n")}${envNote}` }],
          details: { count: entries.length, entries, name: "", field: "", type: "" },
        };
      }

      const name = params.name?.trim();
      if (!name) {
        return {
          content: [{ type: "text", text: `Provide name for action=${params.action}.` }],
          details: { count: 0, entries: [], name: "", field: "", type: "" },
        };
      }

      if (params.action === "set") {
        const secret = String(params.secret ?? "");
        if (!secret) {
          return {
            content: [{ type: "text", text: "Provide secret for action=set." }],
            details: { count: 0, entries: [], name, field: "", type: "" },
          };
        }

        const type =
          params.type === "token" ||
          params.type === "password" ||
          params.type === "basic" ||
          params.type === "secret"
            ? params.type
            : "secret";

        try {
          await setKeychainEntry({
            name,
            type,
            secret,
            username: params.username ? String(params.username) : undefined,
          });
          return {
            content: [{ type: "text", text: `Stored keychain entry ${name} (${type}).` }],
            details: { count: 1, entries: [], name, field: "", type },
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: (error as Error).message || "Failed to store keychain entry." }],
            details: { count: 0, entries: [], name, field: "", type: "" },
          };
        }
      }

      if (params.action === "delete") {
        try {
          const removed = deleteKeychainEntry(name);
          return {
            content: [{ type: "text", text: removed ? `Deleted keychain entry ${name}.` : `Keychain entry not found: ${name}` }],
            details: { count: removed ? 1 : 0, entries: [], name, field: "", type: "" },
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: (error as Error).message || "Failed to delete keychain entry." }],
            details: { count: 0, entries: [], name, field: "", type: "" },
          };
        }
      }

      const field = params.field === "username" ? "username" : "secret";
      try {
        const entry = await getKeychainEntry(name);
        if (field === "username") {
          if (!entry.username) {
            return {
              content: [{ type: "text", text: `Entry ${name} has no username.` }],
              details: { count: 0, entries: [], name, field, type: entry.type },
            };
          }
          return {
            content: [{ type: "text", text: entry.username }],
            details: { count: 1, entries: [], name, field, type: entry.type, access_method: "direct_get_last_resort" },
          };
        }

        return {
          content: [{ type: "text", text: entry.secret }],
          details: { count: 1, entries: [], name, field, type: entry.type, access_method: "direct_get_last_resort" },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message || "Failed to read keychain entry." }],
          details: { count: 0, entries: [], name, field, type: "" },
        };
      }
    },
  });
};
