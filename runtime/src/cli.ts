/**
 * cli.ts – Command-line interface for piclaw sub-commands.
 *
 * Handles --help, --version, and the `keychain` sub-command family
 * (set, get, list, delete). If a CLI sub-command is detected,
 * handleCliOptions() processes it and returns true so index.ts can
 * exit without starting the runtime.
 *
 * Consumers:
 *   - index.ts calls handleCliOptions() before main().
 */

import { readFileSync } from "fs";
import { join } from "path";
import { getDb, initDatabase, storeMessage } from "./db.js";
import { stripInternalTags } from "./router.js";
import {
  deleteKeychainEntry,
  getKeychainEntry,
  listKeychainEntries,
  setKeychainEntry,
} from "./secure/keychain.js";
import { createUuid } from "./utils/ids.js";

const HELP_TEXT = `piclaw - Pi Coding Agent Assistant

Usage:
  piclaw [options]
  piclaw --post <chat_jid> <message>
  piclaw keychain <command> [args]
  piclaw account-recovery preview|issue|serve [args]
  piclaw access-migration preview|prepare-copy [args]

Options:
  -h, --help                 Show this help
  -v, --version              Show version
  -w, --workspace <path>     Workspace root (also relocates .piclaw state under it)
  -p, --port <number>        Web UI port (default: 8080)
      --host <addr>          Web UI host (default: 0.0.0.0)
      --idle-timeout <secs>  Web idle timeout in seconds (default: 0 = disabled)

Keychain commands:
  piclaw keychain set <name> --secret <value> [--type token|password|basic|secret] [--username <value>]
  piclaw keychain set <name> --secret-file <path> [--type token|password|basic|secret] [--username <value>]
  piclaw keychain get <name>
  piclaw keychain list
  piclaw keychain delete <name>

Offline family administrator recovery (no activation or restart):
  piclaw account-recovery preview --user-id <id> --username <name> --method totp|passkey --origin https://host
  piclaw account-recovery issue --user-id <id> --username <name> --method totp|passkey --origin https://host
    --backup <new.sqlite> --output <new.json> --writers-stopped --key-backup-confirmed --confirm "RECOVER <name>"
  piclaw account-recovery serve --recovery-id <id> --origin https://host --writers-stopped
    --confirm "SERVE RECOVERY <id>" [--host <addr>] [--port <number>] [--tls-cert <path>] [--tls-key <path>]
  Backup/output parents must exist with permissions 0700. Stop all writers first; retain the original bootstrap key.

Offline ownership migration preparation (source unchanged; copy cannot start):
  piclaw access-migration preview --output <new-inventory.json>
  piclaw access-migration prepare-copy --plan <reviewed-plan.json> --destination <new-copy.sqlite>
    --writers-stopped --backup-set-confirmed --confirm "PREPARE OWNERSHIP COPY"
  Review inventory.plan and fill every owner ID explicitly. Save only that plan object for prepare-copy.
  Version-four import-default TOTP plans also require --legacy-totp-file <private-secret-and-code.json>.
`;

/** Read the version string from package.json. */
export function getVersion(): string {
  try {
    const packagePath = join(import.meta.dir, "..", "..", "package.json");
    const data = JSON.parse(readFileSync(packagePath, "utf-8"));
    return data.version || "unknown";
  } catch {
    return "unknown";
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) return undefined;
  return value;
}

const CLI_SUBCOMMANDS = new Set(["keychain", "account-recovery", "access-migration"]);
const RUNTIME_FLAGS_WITH_VALUES = new Set([
  "-w",
  "--workspace",
  "-p",
  "--port",
  "--host",
  "--idle-timeout",
  "--tls-cert",
  "--tls-key",
]);

function isCliSubcommand(value: string | undefined): boolean {
  return typeof value === "string" && CLI_SUBCOMMANDS.has(value);
}

function runtimeArgError(args: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg || arg === "--") return null;

    if (RUNTIME_FLAGS_WITH_VALUES.has(arg)) {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) return `Missing value for option: ${arg}`;
      i += 1;
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    if (equalsIndex > 0 && RUNTIME_FLAGS_WITH_VALUES.has(arg.slice(0, equalsIndex))) {
      if (!arg.slice(equalsIndex + 1)) return `Missing value for option: ${arg.slice(0, equalsIndex)}`;
      continue;
    }

    if (arg.startsWith("-")) return `Unknown option: ${arg}`;
    return `Unknown command: ${arg}`;
  }
  return null;
}

function consumeLeadingGlobalOptions(args: string[]): string[] {
  const remaining = [...args];
  while (remaining.length > 0) {
    const [current] = remaining;
    if (!current) break;
    if (current === "--") {
      remaining.shift();
      break;
    }
    if (current === "-w" || current === "--workspace" || current === "-p" || current === "--port" || current === "--host" || current === "--idle-timeout" || current === "--tls-cert" || current === "--tls-key") {
      remaining.shift();
      if (remaining.length > 0 && !remaining[0]?.startsWith("-") && !isCliSubcommand(remaining[0])) {
        remaining.shift();
      }
      continue;
    }
    if (current.startsWith("--workspace=") || current.startsWith("--port=") || current.startsWith("--host=") || current.startsWith("--idle-timeout=") || current.startsWith("--tls-cert=") || current.startsWith("--tls-key=")) {
      remaining.shift();
      continue;
    }
    break;
  }
  return remaining;
}

function getLatestAgentSenderName(chatJid: string): string {
  const row = getDb()
    .prepare(
      `SELECT sender_name
         FROM messages
        WHERE chat_jid = ? AND sender = 'web-agent' AND sender_name IS NOT NULL AND trim(sender_name) <> ''
        ORDER BY rowid DESC
        LIMIT 1`,
    )
    .get(chatJid) as { sender_name?: string } | undefined;
  return row?.sender_name?.trim() || "Smith";
}

async function handlePostCommand(args: string[]): Promise<void> {
  const [chatJid, ...messageParts] = args;
  initDatabase();

  if (!chatJid?.trim()) {
    throw new Error("Chat JID is required for --post.");
  }

  const rawMessage = messageParts.join(" ");
  const content = stripInternalTags(rawMessage).trim();
  if (!content) {
    throw new Error("Message content is required for --post.");
  }

  const senderName = getLatestAgentSenderName(chatJid.trim());
  const rowId = storeMessage({
    id: createUuid("msg"),
    chat_jid: chatJid.trim(),
    sender: "web-agent",
    sender_name: senderName,
    content,
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: undefined,
    link_previews: undefined,
    thread_id: null,
  });

  if (rowId <= 0) {
    throw new Error("Failed to post message.");
  }

  console.log(`Posted message ${rowId} to ${chatJid.trim()}.`);
}

async function handleKeychainCommand(args: string[]): Promise<void> {
  const [subcommand, name] = args;
  initDatabase();

  switch (subcommand) {
    case "set": {
      if (!name) throw new Error("Keychain name is required.");
      const type = (getFlagValue(args, "--type") || "secret") as
        | "token"
        | "password"
        | "basic"
        | "secret";
      const username = getFlagValue(args, "--username") || null;
      const secret = getFlagValue(args, "--secret");
      const secretFile = getFlagValue(args, "--secret-file");
      let resolvedSecret = secret || "";
      if (!resolvedSecret && secretFile) {
        resolvedSecret = readFileSync(secretFile, "utf8").trim();
      }
      if (!resolvedSecret) throw new Error("Keychain secret is required.");

      await setKeychainEntry({ name, type, secret: resolvedSecret, username });
      console.log(`Stored keychain entry ${name}.`);
      return;
    }
    case "get": {
      if (!name) throw new Error("Keychain name is required.");
      const entry = await getKeychainEntry(name);
      console.log(JSON.stringify(entry, null, 2));
      return;
    }
    case "list": {
      const entries = listKeychainEntries();
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    case "delete": {
      if (!name) throw new Error("Keychain name is required.");
      const removed = deleteKeychainEntry(name);
      if (!removed) {
        console.log(`Keychain entry not found: ${name}`);
      } else {
        console.log(`Deleted keychain entry ${name}.`);
      }
      return;
    }
    default: {
      throw new Error("Unknown keychain command.");
    }
  }
}

/** Parse CLI args for sub-commands. Returns true if a sub-command was handled. */
export async function handleCliOptions(args = process.argv.slice(2)): Promise<boolean> {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(HELP_TEXT.trim());
    return true;
  }
  if (args.includes("-v") || args.includes("--version")) {
    console.log(getVersion());
    return true;
  }

  const commandArgs = consumeLeadingGlobalOptions(args);
  if (commandArgs[0] === 'access-migration') {
    try { const { handleAccessMigration } = await import('./cli-access-migration.js'); await handleAccessMigration(commandArgs.slice(1)); }
    catch { console.error('Migration copy preparation failed. Check offline locking, source topology, reviewed snapshot/mappings and new private destination. Source is unchanged; no activation was attempted.'); process.exitCode = 1; }
    return true;
  }
  if (commandArgs[0] === 'account-recovery') {
    try { const { handleOperatorRecovery } = await import('./cli-operator-recovery.js'); await handleOperatorRecovery(commandArgs.slice(1)); }
    catch { console.error('Offline recovery failed. Check the stopped runtime, migrated family store, exact target, factor policy, protected output paths and confirmations. No grant is printed; inspect the protected outputs before retrying.'); process.exitCode = 1; }
    return true;
  }
  if (commandArgs[0] === "--post") {
    try {
      await handlePostCommand(commandArgs.slice(1));
    } catch (error) {
      console.error((error as Error).message);
      return true;
    }
    return true;
  }
  if (commandArgs[0] === "keychain") {
    try {
      await handleKeychainCommand(commandArgs.slice(1));
    } catch (error) {
      console.error((error as Error).message);
      return true;
    }
    return true;
  }

  const validationError = runtimeArgError(args);
  if (validationError) {
    console.error(`${validationError}\nRun \`piclaw --help\` for usage.`);
    process.exitCode = 1;
    return true;
  }

  return false;
}
