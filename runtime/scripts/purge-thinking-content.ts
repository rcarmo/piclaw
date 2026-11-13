#!/usr/bin/env bun
/**
 * scripts/purge-thinking-content.ts — Purge persisted thinking traces from
 * the messages database, with safe defaults and dry-run preview.
 *
 * X6 from PR #655 issues tracker: the maintainer asked for a retention/purge
 * story alongside the docs. This script is the actionable counterpart so
 * users don't have to hand-write SQL.
 *
 * Usage examples (run from repo root):
 *
 *   bun run runtime/scripts/purge-thinking-content.ts --dry-run
 *   bun run runtime/scripts/purge-thinking-content.ts --all
 *   bun run runtime/scripts/purge-thinking-content.ts --older-than-days 30
 *   bun run runtime/scripts/purge-thinking-content.ts --chat-jid web:default
 *   bun run runtime/scripts/purge-thinking-content.ts --older-than-days 90 --vacuum
 *
 * Safety:
 *   - Dry-run by default if no scope flag is given (won't accidentally wipe
 *     everything when invoked without args)
 *   - Reports row counts and byte estimates BEFORE deleting
 *   - Wraps the DELETE in a transaction
 *   - --vacuum is opt-in (rebuilds the DB file, can take seconds on large DBs)
 *
 * Operational notes:
 *   - PiClaw does NOT need to be stopped — SQLite WAL mode lets the runtime
 *     keep reading while this script holds a write transaction. The DELETE
 *     itself is fast (the X5 index on created_at makes time-based scans
 *     index-only).
 *   - Removing thinking_content rows leaves `thinking_ref` blocks in the
 *     parent message's content_blocks. The pill will render but clicking it
 *     will return 404 from /agent/thinking. This is the documented behavior
 *     when capture is disabled (see I10 in the issues tracker).
 */

import { closeDatabase, getDb, openMaintenanceDatabase } from "../src/db/connection.js";

interface CliArgs {
  all: boolean;
  olderThanDays: number | null;
  chatJid: string | null;
  dryRun: boolean;
  vacuum: boolean;
  help: boolean;
}

/** Parse argv into a typed shape, with strict validation. */
function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    all: false,
    olderThanDays: null,
    chatJid: null,
    dryRun: false,
    vacuum: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--all":
        out.all = true;
        break;
      case "--older-than-days": {
        const next = argv[++i];
        const n = Number(next);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`--older-than-days expects a non-negative number, got ${next}`);
        }
        out.olderThanDays = n;
        break;
      }
      case "--chat-jid": {
        const next = argv[++i];
        if (!next) throw new Error("--chat-jid expects a value");
        out.chatJid = next;
        break;
      }
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--vacuum":
        out.vacuum = true;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`Usage: bun run runtime/scripts/purge-thinking-content.ts [options]

Scope (at least one is required, otherwise dry-run is forced):
  --all                       Delete every row in thinking_content
  --older-than-days <N>       Delete rows older than N days (uses idx_thinking_content_created_at)
  --chat-jid <jid>            Delete rows belonging to messages in the given chat

Behavior:
  --dry-run                   Show what would be deleted without writing
  --vacuum                    Run VACUUM after delete to reclaim disk space
  -h, --help                  Show this help

Examples:
  bun run runtime/scripts/purge-thinking-content.ts --older-than-days 30 --dry-run
  bun run runtime/scripts/purge-thinking-content.ts --all
  bun run runtime/scripts/purge-thinking-content.ts --chat-jid web:default --vacuum
`);
}

/** Build the WHERE clause + bind params for the chosen scope. */
function buildScope(args: CliArgs): { where: string; binds: Array<string | number> } {
  if (args.all) return { where: "1=1", binds: [] };
  if (args.olderThanDays !== null) {
    return {
      where: `created_at < datetime('now', ?)`,
      binds: [`-${args.olderThanDays} days`],
    };
  }
  if (args.chatJid) {
    return {
      where: `message_id IN (SELECT CAST(rowid AS TEXT) FROM messages WHERE chat_jid = ?)`,
      binds: [args.chatJid],
    };
  }
  throw new Error("No scope flag given");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const hasScope = args.all || args.olderThanDays !== null || args.chatJid !== null;
  if (!hasScope) {
    console.log("No scope flag (--all, --older-than-days, --chat-jid) given.");
    console.log("Forcing --dry-run with --all scope for safety.\n");
    args.all = true;
    args.dryRun = true;
  }

  openMaintenanceDatabase(undefined, args.dryRun);
  const db = getDb();
  const scope = buildScope(args);

  // Preview: how many rows and how many bytes will be affected?
  const previewSql = `
    SELECT COUNT(*) AS rows,
           COALESCE(SUM(LENGTH(text)), 0) AS bytes
    FROM thinking_content
    WHERE ${scope.where}
  `;
  const preview = db.prepare(previewSql).get(...scope.binds) as { rows: number; bytes: number };

  console.log("=== thinking_content purge preview ===");
  console.log(`Scope:        ${args.all ? "ALL" : args.olderThanDays !== null ? `older than ${args.olderThanDays} days` : `chat_jid = ${args.chatJid}`}`);
  console.log(`Matching:     ${preview.rows} rows / ${preview.bytes.toLocaleString()} bytes`);
  console.log(`Dry run:      ${args.dryRun ? "YES (no rows will be deleted)" : "no"}`);
  console.log(`Vacuum after: ${args.vacuum ? "yes" : "no"}`);
  console.log();

  if (args.dryRun || preview.rows === 0) {
    if (preview.rows === 0) console.log("Nothing to delete.");
    else console.log("Dry-run mode: pass the same flags without --dry-run to apply.");
    return;
  }

  const deleteSql = `DELETE FROM thinking_content WHERE ${scope.where}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(deleteSql).run(...scope.binds);
    db.exec("COMMIT");
    console.log(`Deleted ${result.changes} rows.`);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (args.vacuum) {
    console.log("Running VACUUM (this may take a few seconds on large DBs)...");
    const t0 = Date.now();
    db.exec("VACUUM");
    console.log(`VACUUM complete in ${Date.now() - t0}ms.`);
  }
}

main().finally(() => closeDatabase()).catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
