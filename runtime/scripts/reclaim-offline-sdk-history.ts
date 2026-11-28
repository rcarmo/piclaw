#!/usr/bin/env bun

import { reclaimOfflineSdkHistory } from '../durable-engine/src/offline-sdk-history-reclaim.js';

const usage = `Usage: bun runtime/scripts/reclaim-offline-sdk-history.ts \
  --source <closed-sdk-only-copy> --output <new-sibling-file> \
  --conversation-id <id> --expected-sha256 <64-lowercase-hex>

Requires Durable SDK 1.6.1 or 1.7.0 and its exact unprefixed SQLite schema.
Piclaw's application store, in-place operation, symlinks, and SQLite sidecars are refused.`;

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const available = new Set(['--source', '--output', '--conversation-id', '--expected-sha256']);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!available.delete(key) || !value || value.startsWith('--')) throw new Error(usage);
    values.set(key, value);
  }
  if (available.size || !/^\d+$/.test(values.get('--conversation-id') ?? '')) throw new Error(usage);
  const receipt = await reclaimOfflineSdkHistory({ sourcePath: values.get('--source')!, outputPath: values.get('--output')!,
    conversationId: Number(values.get('--conversation-id')), expectedSourceSha256: values.get('--expected-sha256')! });
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.publication !== 'durable' || receipt.warnings.length) process.exitCode = 2;
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : 'Offline SDK history reclamation failed');
  process.exitCode = 1;
});
