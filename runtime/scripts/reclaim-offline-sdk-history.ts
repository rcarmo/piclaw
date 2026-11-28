#!/usr/bin/env bun

import { reclaimOfflineSdkHistory } from '../durable-engine/src/offline-sdk-history-reclaim.js';

const usage = `Usage: bun runtime/scripts/reclaim-offline-sdk-history.ts \\
  --source <closed-sdk-only-copy> --output <new-sibling-file> \\
  --conversation-id <id> --expected-sha256 <64-lowercase-hex> \\
  [--piclaw-chat-jid <jid> --piclaw-branch-id <branch-id>]

Standalone copies require Durable SDK 1.6.1 or 1.7.0. Both Piclaw flags opt in
to native archived-session reclamation with SDK 1.7.0 only. Live stores,
in-place operation, symlinks and SQLite sidecars are refused.`;

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const required = ['--source', '--output', '--conversation-id', '--expected-sha256'];
  const available = new Set([...required, '--piclaw-chat-jid', '--piclaw-branch-id']);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!available.delete(key) || !value || value.startsWith('--')) throw new Error(usage);
    values.set(key, value);
  }
  const chatJid = values.get('--piclaw-chat-jid'), branchId = values.get('--piclaw-branch-id');
  if (required.some(key => !values.has(key)) || !/^\d+$/.test(values.get('--conversation-id') ?? '') || !!chatJid !== !!branchId) throw new Error(usage);
  const receipt = await reclaimOfflineSdkHistory({ sourcePath: values.get('--source')!, outputPath: values.get('--output')!,
    conversationId: Number(values.get('--conversation-id')), expectedSourceSha256: values.get('--expected-sha256')!,
    ...(chatJid && branchId ? { piclawArchive: { chatJid, branchId } } : {}) });
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.publication !== 'durable' || receipt.warnings.length) process.exitCode = 2;
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : 'Offline SDK history reclamation failed');
  process.exitCode = 1;
});
