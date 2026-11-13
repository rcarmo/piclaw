import { existsSync } from "fs";
import { closeDatabase, getDb, openMaintenanceDatabase, listChatBranches, permanentDeleteArchivedBranch, previewPermanentDeleteArchivedBranch } from "../src/db.js";
import { listSessionArtifactPaths, removeSessionArtifacts } from "../src/agent-pool/branch-manager.js";

type CliOptions = {
  mode: "dry-run" | "apply";
  allArchived: boolean;
  chatJids: string[];
  vacuum: boolean;
};

type PreviewItem = {
  chat_jid: string;
  root_chat_jid: string;
  agent_name: string;
  archived_at: string | null;
  counts: ReturnType<typeof previewPermanentDeleteArchivedBranch>["counts"];
  session_artifact_paths: string[];
};

function printUsage(): void {
  console.log(`Usage:
  bun runtime/scripts/prune-archived-branches.ts --dry-run --all-archived
  bun runtime/scripts/prune-archived-branches.ts --apply --all-archived [--vacuum]
  bun runtime/scripts/prune-archived-branches.ts --dry-run --chat-jid <jid>
  bun runtime/scripts/prune-archived-branches.ts --apply --chat-jid <jid> [--chat-jid <jid> ...]

Notes:
  - Only already archived non-root branches can be permanently deleted.
  - Archived root sessions are reported as skipped/protected.
  - This operation is irreversible.`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "dry-run",
    allArchived: false,
    chatJids: [],
    vacuum: false,
  };

  let sawDryRun = false;
  let sawApply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      sawDryRun = true;
      options.mode = "dry-run";
      continue;
    }
    if (arg === "--apply") {
      sawApply = true;
      options.mode = "apply";
      continue;
    }
    if (arg === "--all-archived") {
      options.allArchived = true;
      continue;
    }
    if (arg === "--chat-jid") {
      const value = String(argv[index + 1] || "").trim();
      if (!value) {
        throw new Error("--chat-jid requires a value");
      }
      options.chatJids.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--chat-jid=")) {
      const value = arg.slice("--chat-jid=".length).trim();
      if (!value) throw new Error("--chat-jid requires a value");
      options.chatJids.push(value);
      continue;
    }
    if (arg === "--vacuum") {
      options.vacuum = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (sawDryRun === sawApply) {
    throw new Error("Specify exactly one of --dry-run or --apply");
  }
  if (!options.allArchived && options.chatJids.length === 0) {
    throw new Error("Specify --all-archived or at least one --chat-jid");
  }
  if (options.vacuum && options.mode !== "apply") {
    throw new Error("--vacuum requires --apply");
  }

  options.chatJids = [...new Set(options.chatJids)];
  return options;
}

function resolveTargetChatJids(options: CliOptions): string[] {
  const targets = new Set(options.chatJids);
  if (options.allArchived) {
    for (const branch of listChatBranches(null, { includeArchived: true })) {
      if (branch.archived_at) targets.add(branch.chat_jid);
    }
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}

function buildPreview(chatJid: string): PreviewItem {
  const preview = previewPermanentDeleteArchivedBranch(chatJid);
  return {
    chat_jid: preview.branch.chat_jid,
    root_chat_jid: preview.branch.root_chat_jid,
    agent_name: preview.branch.agent_name,
    archived_at: preview.branch.archived_at,
    counts: preview.counts,
    session_artifact_paths: listSessionArtifactPaths(chatJid).filter((path) => existsSync(path)),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  openMaintenanceDatabase(undefined, options.mode === "dry-run");

  const targets = resolveTargetChatJids(options);
  const planned: PreviewItem[] = [];
  const skipped: Array<{ chat_jid: string; error: string }> = [];

  for (const chatJid of targets) {
    try {
      planned.push(buildPreview(chatJid));
    } catch (error) {
      skipped.push({
        chat_jid: chatJid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (options.mode === "dry-run") {
    console.log(JSON.stringify({
      mode: options.mode,
      targets: planned,
      skipped,
      summary: {
        planned: planned.length,
        skipped: skipped.length,
      },
    }, null, 2));
    return;
  }

  const applied: Array<{
    chat_jid: string;
    agent_name: string;
    deleted: ReturnType<typeof permanentDeleteArchivedBranch>["counts"];
    removed_session_artifacts: string[];
  }> = [];

  for (const item of planned) {
    const result = permanentDeleteArchivedBranch(item.chat_jid);
    const removedSessionArtifacts = removeSessionArtifacts(item.chat_jid);
    applied.push({
      chat_jid: item.chat_jid,
      agent_name: item.agent_name,
      deleted: result.counts,
      removed_session_artifacts: removedSessionArtifacts,
    });
  }

  if (options.vacuum) {
    getDb().exec("VACUUM");
  }

  console.log(JSON.stringify({
    mode: options.mode,
    applied,
    skipped,
    vacuumed: options.vacuum,
    summary: {
      applied: applied.length,
      skipped: skipped.length,
    },
  }, null, 2));
}

main().finally(() => closeDatabase()).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message || "prune-archived-branches failed");
  process.exit(1);
});
