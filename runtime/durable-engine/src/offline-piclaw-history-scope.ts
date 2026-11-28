import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { Harness, createRegistry, defineDoc, type ConversationId } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NATIVE_STORE_APPLICATION_ID } from '../../src/db/store-format.js';
import { assertSchemaInventory, readSchemaInventory, type SchemaContract } from '../../scripts/lib/schema-ownership.js';

// Offline, release-specific overlay. See https://github.com/earendil-works/pi/issues/12641.
// This mirrors the public route document definition; force a new base to replace
// the old manifest, which otherwise could retain the removed routing identity.
const routingDoc = defineDoc({ kind: 'app.application-conversations', version: 1, scope: 'conversation',
  history: 'latest', fork: 'initial', checkpointWhen: () => true,
  initial: () => ({ version: 1, domain: '', bindings: [] as Binding[] }) });
const rootConversation = 1 as ConversationId;
export type PiclawArchiveTarget = { chatJid: string; branchId: string; conversationId: number };
type Binding = { chatJid: string; branchId: string; conversationId: number; sessionId: string };
const sdkTables = new Set(['durable_schema','durable_metadata','record_ids','conversations','entries','tasks','submissions','documents','document_revisions']);
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const refuse = (message: string): never => { throw Error(`Offline Piclaw archive: ${message}`); };

export async function assertPiclawArchiveSchema(db: Database) {
  const application = db.query<{application_id: number | bigint}, []>('PRAGMA application_id').get();
  if (Number(application?.application_id) !== NATIVE_STORE_APPLICATION_ID) refuse('a native PIC4 application store is required');
  const schema = await Bun.file(new URL('../../scripts/schema-ownership.json', import.meta.url)).json() as SchemaContract;
  assertSchemaInventory(readSchemaInventory(db), schema, 'native');
  if (db.query(`SELECT 1 FROM documents WHERE kind IN ('"app.session-history-import"','"app.copied-legacy-import"','"app.copied-legacy-tree-import"','"app.background-contexts"') LIMIT 1`).get())
    refuse('copied/imported history and private background contexts are not supported');
}

export async function retirePiclawArchiveRoute(path: string, target: PiclawArchiveTarget) {
  // Run the same admission-free provenance validation as native startup on the private input copy.
  const { assertNativeApplicationHistory } = await import('./default-application-runtime.js');
  using root = new Database(path, { readonly: true, create: false, strict: true });
  assertNativeApplicationHistory(root);
  // Harness.open may initialize writable SDK machinery. Prove the persisted
  // work queues are wholly quiescent using this read-only snapshot first.
  if (root.query(`SELECT 1 FROM tasks WHERE status IS NOT 'terminal'
        OR json_extract(record,'$.state.status') IS NOT 'terminal' LIMIT 1`).get() ||
      root.query(`SELECT 1 FROM submissions WHERE status IS NULL OR status NOT IN ('done','unanswered')
        OR json_extract(record,'$.status') IS NOT status LIMIT 1`).get())
    refuse('store has unsettled persisted SDK work');
  const branch = root.query<{archived_at:string | null;root_chat_jid:string;parent_branch_id:string|null},[string,string]>(
    'SELECT archived_at,root_chat_jid,parent_branch_id FROM chat_branches WHERE chat_jid=? AND branch_id=?').get(target.chatJid,target.branchId);
  if (!branch?.archived_at || target.chatJid === 'web:default' || branch.root_chat_jid !== target.chatJid || branch.parent_branch_id !== null)
    refuse('select an exact archived non-default root session');
  if (root.query(`SELECT 1 FROM chat_branches WHERE (root_chat_jid=?1 AND chat_jid<>?1) OR parent_branch_id=?2 LIMIT 1`).get(target.chatJid,target.branchId))
    refuse('dependent session branches exist');
  const sql = await openNodeSqliteDatabase(path, { busyTimeoutMs: 0 });
  const storage = await SqliteStorage.open(sql);
  let harness: Harness | undefined;
  try {
    const denied = async (): Promise<never> => refuse('credential access is forbidden');
    harness = await Harness.open(storage, { registry:createRegistry(), models:createModels({authContext:{env:denied,fileExists:denied}}) }, context);
    const inspection = await harness.inspect(context);
    if (inspection.scheduling !== 'paused' || inspection.tasks.length || inspection.submissions.length) refuse('store has unsettled SDK work');
    return await harness.commit(async tx => {
      const doc = await tx.doc(routingDoc, rootConversation);
      const index = doc.bindings.findIndex(b => b.chatJid === target.chatJid && b.branchId === target.branchId && b.conversationId === target.conversationId);
      if (doc.version !== 1 || !doc.domain || index === -1 || !doc.bindings.some(b => b.chatJid === 'web:default')) refuse('exact archive routing binding is absent');
      const domain = doc.domain;
      doc.bindings.splice(index, 1);
      return domain;
    }, context);
  } finally { if (harness) await harness.close(context); else await storage.close(context); }
}

function hostTables(db: Database) {
  return db.query<{name:string; type:string; wr:number | bigint}, []>('PRAGMA main.table_list').all()
    .filter(row => row.type === 'table' && (!row.name.startsWith('sqlite_') || row.name === 'sqlite_sequence') && !sdkTables.has(row.name));
}
function proof(db: Database, selectors: ReadonlyMap<string, string>, params: readonly (string | number)[]) {
  const result: Record<string,string> = {};
  for (const {name,wr} of hostTables(db)) {
    const at = selectors.get(name), pk = Number(wr)
      ? db.query<{name:string;pk:number|bigint},[]>(`PRAGMA table_info(${quote(name)})`).all().filter(c => Number(c.pk)).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(c=>quote(c.name)).join(',')
      : 'rowid';
    const hash = createHash('sha256');
    for (const row of db.query(`SELECT ${Number(wr) ? '' : '_rowid_ AS _physical_rowid_,'} * FROM ${quote(name)} ${at ? `WHERE (${at}) IS NOT TRUE` : ''} ORDER BY ${pk}`).iterate(...(at ? params : []))) {
      hash.update(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? {integer:String(value)} : value instanceof Uint8Array ? {blob:Buffer.from(value).toString('base64')} : value));
      hash.update('\n');
    }
    result[name] = hash.digest('hex');
  }
  return result;
}

/** Plan the direct native message cohort. Unsupported host-owned effects are a refusal, not a cascade. */
export function erasePiclawArchiveRows(db: Database, target: PiclawArchiveTarget, domain: string) {
  if (!db.inTransaction) refuse('host erasure requires the staged transaction');
  const {chatJid: chat, branchId, conversationId: cid} = target;
  const bindings = db.query<{source_seq:number; source_id:string; payload_ref:string; submission_id:number}, [string,string,number,string]>(`SELECT b.source_seq,b.source_id,b.payload_ref,b.submission_id FROM piclaw_durable_bindings_v1 b
    JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq AND s.source_id=b.source_id AND s.payload_ref=b.payload_ref
    JOIN submissions q ON q.id=b.submission_id AND q.conversation_id=b.conversation_id AND q.request_id=json_quote(b.request_id)
    JOIN messages m ON m.chat_jid=b.chat_jid AND m.id=b.source_id AND m.is_bot_message=0
    WHERE b.chat_jid=?1 AND b.branch_id=?2 AND b.conversation_id=?3 AND b.incarnation=?4 AND b.domain=?4
      AND b.operation_id='native-message:' || ?3 || ':' || b.source_seq
      AND q.status='done' AND json_extract(q.record,'$.type')='input'
      AND s.kind='message' AND s.state='consumed' AND s.target_operation_id IS NULL AND s.parent_source_seq IS NULL
      AND (s.payload_ref='message-row:' || m.rowid OR s.payload_ref='queued-source:' || m.id)`).all(chat,branchId,cid,domain);
  const count = (sql:string, ...args:(string|number)[]) => Number(db.query<{n:number|bigint},(string|number)[]>(sql).get(...args)?.n ?? 0);
  const bindingCount = count(`SELECT count(*) n FROM piclaw_durable_bindings_v1 WHERE chat_jid=?1 OR branch_id=?2 OR conversation_id=?3`,chat,branchId,cid);
  const sourceCount = count('SELECT count(*) n FROM service_effect_s01_sources WHERE chat_jid=?',chat);
  const submissionCount = count('SELECT count(*) n FROM submissions WHERE conversation_id=?',cid);
  if (!bindings.length || bindings.length !== bindingCount || bindings.length !== sourceCount || bindings.length !== submissionCount) {
    refuse('history is not an exact settled direct-message cohort');
  }
  const prefix = `native-answer:${domain}:${cid}:`;
  const messages = db.query<{rowid:number|bigint},[string,number,string]>(`SELECT rowid FROM messages m WHERE m.chat_jid=?1 AND (
    COALESCE(m.is_steering_message,0)<>0 OR m.content_blocks IS NOT NULL OR m.link_previews IS NOT NULL OR m.annotations IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM messages p WHERE p.chat_jid=?1 AND p.rowid=m.thread_id AND p.is_bot_message=0)
    OR CASE WHEN m.is_bot_message=0 THEN NOT EXISTS (SELECT 1 FROM piclaw_durable_bindings_v1 b WHERE b.chat_jid=?1 AND b.source_id=m.id AND b.conversation_id=?2)
      WHEN m.is_bot_message=1 AND m.is_terminal_agent_reply=1 THEN NOT EXISTS (SELECT 1 FROM submissions q WHERE q.conversation_id=?2
        AND q.status='done' AND m.id=?3 || json_extract(q.record,'$.answer')) ELSE 1 END) LIMIT 1`).get(chat,cid,prefix);
  if (messages || !count('SELECT count(*) n FROM messages WHERE chat_jid=? AND is_terminal_agent_reply=1',chat)) refuse('unsupported or unproved timeline rows');
  if (db.query(`SELECT 1 FROM messages WHERE chat_jid IS NOT ?1 AND thread_id IN (SELECT rowid FROM messages WHERE chat_jid=?1) LIMIT 1`).get(chat))
    refuse('another session references this timeline');
  if (db.query(`SELECT 1 FROM service_effect_s01_chats WHERE chat_jid=? AND active_operation_id IS NOT NULL`).get(chat) ||
      db.query(`SELECT 1 FROM chat_cursors WHERE chat_jid=? AND queued_followups_json IS NOT NULL`).get(chat)) refuse('host is not settled');

  const scope = new Map<string,string>([
    ['piclaw_durable_bindings_v1','chat_jid=?1'], ['service_effect_s01_sources','chat_jid=?1'], ['service_effect_s01_chats','chat_jid=?1'],
    ['chat_cursors','chat_jid=?1'], ['token_usage','chat_jid=?1'], ['messages','chat_jid=?1'], ['chat_branches','chat_jid=?1'], ['chats','jid=?1'],
  ]);
  const messageRows = 'SELECT rowid FROM messages WHERE chat_jid=?1';
  const messageIds = 'SELECT id FROM messages WHERE chat_jid=?1';
  const ref = quote;
  for (const { name } of hostTables(db)) {
    const selected = scope.get(name);
    const clauses: string[] = [];
    const columns = db.query<{name:string},[]>(`PRAGMA table_info(${quote(name)})`).all().map(row=>row.name);
    for (const col of columns) {
      if (/^(chat_jid|source_chat_jid|root_chat_jid|target_chat_jid|home_chat_jid|scope_key|key)$/.test(col)) clauses.push(`${ref(col)}=?1`);
      if (/(^|_)branch_id$/.test(col)) clauses.push(`${ref(col)}=?2`);
      if (/(^|_)conversation_id$/.test(col)) clauses.push(`${ref(col)}=?3`);
      if (/message_(rowid|row_id)$/.test(col)) clauses.push(`${ref(col)} IN (${messageRows})`);
      if (/(^|_)message_id$/.test(col)) clauses.push(`${ref(col)} IN (${messageIds}) OR ${ref(col)} IN (SELECT CAST(rowid AS TEXT) FROM messages WHERE chat_jid=?1)`);
      // Durable bindings and queued sources use concrete payload references to
      // host message row IDs or public message IDs. Check retained rows even in
      // tables whose target-owned rows are part of the deletion scope.
      if (/(^|_)payload_ref$/.test(col)) clauses.push(`${ref(col)} IN (SELECT 'message-row:' || rowid FROM messages WHERE chat_jid=?1)
        OR ${ref(col)} IN (SELECT 'queued-source:' || id FROM messages WHERE chat_jid=?1)`);
      // Some app owners store a chat address inside a JSON payload rather than a scoped column.
      if (/^(value|config|payload|snapshot_json|record|data|details|metadata)(_|$)/.test(col)) {
        clauses.push(`(typeof(${ref(col)})='text' AND (instr(${ref(col)},?1)>0 OR instr(${ref(col)},?2)>0))`);
      }
    }
    const retained = selected ? ` AND (${selected}) IS NOT TRUE` : '';
    if (clauses.length && db.query(`SELECT 1 FROM ${quote(name)} WHERE (${clauses.join(' OR ')})${retained}
        AND ?1 IS NOT NULL AND ?2 IS NOT NULL AND ?3>1 LIMIT 1`).get(chat,branchId,cid))
      refuse(`retained dependency in ${name}`);
  }
  const survivors = proof(db, scope, [chat]);
  const counts: Record<string,number> = {};
  for (const [table,where] of scope) counts[table]=Number(db.query(`DELETE FROM ${quote(table)} WHERE ${where}`).run(chat).changes);
  // Rebuild rather than retain FTS segment tombstones carrying deleted tokens.
  db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild'); INSERT INTO messages_fts(messages_fts,rank) VALUES('integrity-check',1);`);
  verifyPiclawArchiveRows(db, target, survivors);
  return { counts, survivors };
}

export function verifyPiclawArchiveRows(db: Database, target: PiclawArchiveTarget, survivors: Record<string,string>) {
  if (db.query('SELECT 1 FROM chats WHERE jid=? UNION ALL SELECT 1 FROM chat_branches WHERE chat_jid=? OR branch_id=?').get(target.chatJid,target.chatJid,target.branchId))
    refuse('target host route remains');
  const after = proof(db,new Map(),[]);
  if (Object.keys(survivors).length !== Object.keys(after).length || Object.entries(survivors).some(([table,digest])=>after[table]!==digest))
    refuse('surviving host rows or physical row IDs changed');
}
