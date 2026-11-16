import { closeDatabase, openMaintenanceDatabase, listChatBranches, previewPermanentDeleteArchivedBranch } from '../src/db.js';

/** Current-native read-only archive preview. Legacy SQL purge/address rewriting,
 * filesystem deletion, VACUUM and automatic session-file discovery are retired. */
async function main(): Promise<void> {
  const args = process.argv.slice(2), chats = new Set<string>(); let all = false, preview = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') preview = true;
    else if (arg === '--all-archived') all = true;
    else if (arg === '--chat-jid' && args[i + 1]) chats.add(args[++i]!);
    else if (arg?.startsWith('--chat-jid=')) chats.add(arg.slice('--chat-jid='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: bun runtime/scripts/prune-archived-branches.ts --dry-run (--all-archived | --chat-jid <jid>)'); return;
    } else throw Error('Legacy permanent deletion/VACUUM is retired; only explicit --dry-run archive preview is supported');
  }
  if (!preview || !all && !chats.size) throw Error('Explicit --dry-run and archive selection are required');
  openMaintenanceDatabase(undefined, true);
  if (all) for (const branch of listChatBranches(null, { includeArchived: true })) if (branch.archived_at) chats.add(branch.chat_jid);
  const targets: unknown[] = [], skipped: { chat_jid: string; error: string }[] = [];
  for (const chat of [...chats].sort()) {
    try {
      const data = previewPermanentDeleteArchivedBranch(chat);
      targets.push({ chat_jid: data.branch.chat_jid, root_chat_jid: data.branch.root_chat_jid, agent_name: data.branch.agent_name,
        archived_at: data.branch.archived_at, counts: data.counts, session_artifact_paths: [] });
    } catch (error) { skipped.push({ chat_jid: chat, error: error instanceof Error ? error.message : 'Archive preview unavailable' }); }
  }
  console.log(JSON.stringify({ mode: 'dry-run', targets, skipped, summary: { planned: targets.length, skipped: skipped.length } }, null, 2));
}
main().finally(() => closeDatabase()).catch(error => { console.error(error instanceof Error ? error.message : 'Archive preview failed'); process.exitCode = 1; });
