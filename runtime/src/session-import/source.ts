import type { JsonValue } from '@earendil-works/chord/json';
import type { Message } from '@earendil-works/pi-ai';

export const SESSION_IMPORT_LIMITS = { bytes: 8 * 1024 * 1024, entries: 1000, branches: 16 } as const;
export type OfflineSessionEntry = {
  id: string; parentId: string | null; type: string; timestamp: string;
  original: Record<string, JsonValue>; message?: Message;
};
export type OfflineSessionSource = {
  sourceSessionId: string; entries: OfflineSessionEntry[]; leaves: string[];
  selectedLeaves: string[]; selectedEntries: OfflineSessionEntry[];
};
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function require(value: unknown, reason: string): asserts value { if (!value) throw Error(`Session import refused: ${reason}`); }
function keys(value: Record<string, unknown>, allowed: readonly string[]) { require(Object.keys(value).every(key => allowed.includes(key)), 'unsupported record fields'); }

function readMessage(value: unknown): Message {
  require(plain(value) && finite(value.timestamp), 'invalid message');
  require(['user', 'assistant', 'toolResult', 'system'].includes(String(value.role)), 'unsupported message role');
  keys(value, value.role === 'assistant' ? ['role', 'content', 'timestamp', 'api', 'provider', 'model', 'usage', 'stopReason', 'errorMessage']
    : value.role === 'toolResult' ? ['role', 'content', 'timestamp', 'toolCallId', 'toolName', 'isError', 'details'] : ['role', 'content', 'timestamp']);
  if (typeof value.content !== 'string') {
    require(Array.isArray(value.content), 'invalid message content');
    for (const block of value.content) {
      require(plain(block), 'invalid content block');
      if (block.type === 'text') require(typeof block.text === 'string', 'invalid text');
      else if (block.type === 'thinking' && value.role === 'assistant') require(typeof block.thinking === 'string', 'invalid thinking');
      else if (block.type === 'image' && (value.role === 'user' || value.role === 'toolResult')) {
        require(text(block.data) && ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(String(block.mimeType)), 'unsupported inline image');
      } else if (block.type === 'toolCall' && value.role === 'assistant') {
        require(text(block.id) && text(block.name) && plain(block.arguments), 'invalid historical tool call');
      } else require(false, 'unsupported content block');
    }
  } else require(value.role === 'user' || value.role === 'system', 'unsupported string content');
  if (value.role === 'assistant') {
    require(text(value.api) && text(value.provider) && text(value.model), 'missing assistant provenance');
    require(['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(value.stopReason)), 'unsupported assistant outcome');
    const usage = value.usage;
    require(plain(usage) && ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].every(key => finite(usage[key]) && usage[key] >= 0), 'invalid recorded usage');
    const cost = usage.cost;
    require(plain(cost) && ['input', 'output', 'cacheRead', 'cacheWrite', 'total'].every(key => finite(cost[key]) && cost[key] >= 0), 'invalid recorded cost');
  }
  if (value.role === 'toolResult') require(text(value.toolCallId) && text(value.toolName) && typeof value.isError === 'boolean', 'invalid historical tool result');
  // JSON decoding detached the data; the explicit validation above establishes
  // the supported message shape. This function never projects executable tasks.
  return value as unknown as Message;
}

/** Decode one explicitly supplied offline v3 JSONL source. No paths, discovery,
 * storage, credentials, current configuration or projection callback. Whole-input
 * bounds/shape checks precede leaf selection; every omitted entry is counted. */
export function readOfflineSessionSource(jsonl: string, requestedLeaves?: readonly string[]): OfflineSessionSource {
  require(typeof jsonl === 'string' && Buffer.byteLength(jsonl, 'utf8') <= SESSION_IMPORT_LIMITS.bytes, 'source exceeds byte bound');
  const lines = jsonl.trim().split('\n');
  require(lines.length > 1 && lines.length - 1 <= SESSION_IMPORT_LIMITS.entries, 'empty source or entry bound exceeded');
  let records: unknown[];
  try { records = lines.map(line => JSON.parse(line, (_key, value) => { require(typeof value !== 'number' || Number.isFinite(value), 'non-finite number'); return value; })); }
  catch { throw Error('Session import refused: malformed JSONL'); }
  const header = records[0];
  require(plain(header) && header.type === 'session' && header.version === 3 && text(header.id) && text(header.timestamp) && Number.isFinite(Date.parse(header.timestamp)), 'unsupported session header (requires v3 JSONL)');
  keys(header, ['type', 'version', 'id', 'timestamp', 'cwd', 'parentSession']);
  require(header.parentSession === undefined, 'external parent session requires a self-contained export');
  const entries: OfflineSessionEntry[] = [], byId = new Map<string, OfflineSessionEntry>(), parents = new Set<string>();
  for (const raw of records.slice(1)) {
    require(plain(raw) && text(raw.id) && text(raw.type) && text(raw.timestamp) && Number.isFinite(Date.parse(raw.timestamp)), 'invalid source entry');
    require(!byId.has(raw.id), 'duplicate source entry ID');
    require(raw.parentId === null || text(raw.parentId) && byId.has(raw.parentId), 'missing, forward or ambiguous parent');
    const fields: Record<string, string[]> = { message: ['message'], model_change: ['provider', 'modelId'], thinking_level_change: ['thinkingLevel'],
      compaction: ['summary', 'firstKeptEntryId', 'tokensBefore', 'details', 'usage', 'fromHook', 'systemMessage'], branch_summary: ['fromId', 'summary', 'details', 'usage', 'fromHook'],
      label: ['targetId', 'label'], session_info: ['name'] };
    require(fields[raw.type], 'unsupported session entry type');
    keys(raw, ['id', 'parentId', 'type', 'timestamp', ...fields[raw.type]!]);
    const entry: OfflineSessionEntry = { id: raw.id, type: raw.type, timestamp: raw.timestamp, parentId: raw.parentId as string | null, original: raw as Record<string, JsonValue> };
    if (raw.type === 'message') entry.message = readMessage(raw.message);
    else if (raw.type === 'model_change') require(text(raw.provider) && text(raw.modelId), 'invalid historical model change');
    else if (raw.type === 'thinking_level_change') require(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(raw.thinkingLevel)), 'invalid historical thinking change');
    else if (raw.type === 'compaction') require(typeof raw.summary === 'string' && text(raw.firstKeptEntryId) && byId.has(raw.firstKeptEntryId) && finite(raw.tokensBefore), 'invalid historical compaction');
    else if (raw.type === 'branch_summary') require(typeof raw.summary === 'string' && text(raw.fromId) && byId.has(raw.fromId), 'invalid historical branch summary');
    else if (raw.type === 'label') require(text(raw.targetId) && byId.has(raw.targetId) && (raw.label === undefined || typeof raw.label === 'string'), 'invalid historical label');
    else if (raw.type === 'session_info') require(raw.name === undefined || typeof raw.name === 'string', 'invalid historical session name');
    else require(false, 'unsupported session entry type');
    entries.push(entry); byId.set(entry.id, entry); if (entry.parentId) parents.add(entry.parentId);
  }
  const leaves = entries.filter(entry => !parents.has(entry.id)).map(entry => entry.id);
  require(leaves.length <= SESSION_IMPORT_LIMITS.branches, 'branch bound exceeded');
  require(requestedLeaves !== undefined || leaves.length === 1, 'multiple leaves require explicit selection');
  const selectedLeaves = requestedLeaves ? [...requestedLeaves] : [...leaves];
  require(selectedLeaves.length > 0 && selectedLeaves.length <= SESSION_IMPORT_LIMITS.branches && new Set(selectedLeaves).size === selectedLeaves.length && selectedLeaves.every(id => leaves.includes(id)), 'invalid leaf selection');
  const selected = new Set<string>();
  for (const leaf of selectedLeaves) {
    const chain: OfflineSessionEntry[] = [];
    for (let entry: OfflineSessionEntry | undefined = byId.get(leaf); entry; entry = entry.parentId ? byId.get(entry.parentId) : undefined) { selected.add(entry.id); chain.push(entry); }
    const calls: { id: string; name: string }[] = [], seen = new Set<string>();
    for (const entry of chain.reverse()) {
      const message = entry.message;
      if (!message || message.role === 'system') continue;
      if (message.role === 'toolResult') {
        const call = calls.shift(); require(call && call.id === message.toolCallId && call.name === message.toolName, 'orphan or out-of-order historical tool result');
      } else {
        require(calls.length === 0, 'selected history has unfinished tool calls');
        if (message.role === 'assistant') for (const block of message.content) if (block.type === 'toolCall') {
          require(!seen.has(block.id), 'duplicate historical tool call'); seen.add(block.id); calls.push({ id: block.id, name: block.name });
        }
      }
    }
    require(calls.length === 0, 'selected history has unfinished tool calls');
  }
  return { sourceSessionId: header.id, entries, leaves, selectedLeaves, selectedEntries: entries.filter(entry => selected.has(entry.id)) };
}
