import type { SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, isAbsolute } from 'node:path';
import type { RuntimeOptions } from './host-runtime.ts';
import type { CodexOperation } from './host-codex-model-profile.ts';

/** Parent integration API: createHostCodexArtifactStore(root, actualOperation, binding).
 * binding comes ONLY from the model source callback: {hostOperationId,chatJid,assertCurrent,write}.
 * publish(operation, activity) accepts native image PendingActivity structurally; refs() returns
 * standard workspace file-pill paths without changing SDK assistant/canonical answer bytes.
 * Use createHostCodexAnswerMaterializer at the existing pre-seal materializeAnswer hook.
 * Never use TerminalDatabaseEffect to mutate hashed timeline/media fields after insertion.
 */
export interface CodexArtifactBinding {
  readonly hostOperationId: string;
  readonly chatJid: string;
  assertCurrent(): void;
  write<T>(body: SyncSqliteOperation<T>): T | Promise<T>;
}
export interface CodexImageActivity {
  kind: 'image';
  savedImage: { absolutePath: string; relativePath: string; callId: string; responseId?: string; outputFormat: string };
}
export interface CodexArtifactRef {
  path: string; sha256: string; bytes: number; callId: string; responseId?: string; mimeType: string; codexOperationId?: string;
}
export function createHostCodexArtifactStore(root: Database, operation: CodexOperation, binding: CodexArtifactBinding) {
  if (!Object.isFrozen(operation)) throw Error('Frozen actual Codex operation required');
  if (!binding.hostOperationId || !binding.chatJid) throw Error('Actual source binding required');
  const key = `outputrefs:${binding.hostOperationId}`;
  const check = () => { operation.signal.throwIfAborted(); operation.assertCurrent(); binding.assertCurrent(); };
  const read = (): CodexArtifactRef[] => {
    check();
    const row = root.query("SELECT value FROM extension_kv WHERE extension_id='codex-conversion' AND scope='chat' AND scope_key=? AND key=?").get(binding.chatJid, key) as { value: string } | null;
    check();
    if (!row) return [];
    const record = JSON.parse(row.value);
    if (record.hostOperationId !== binding.hostOperationId || record.chatJid !== binding.chatJid) throw Error('Codex artifact owner mismatch');
    return record.refs.map((ref: CodexArtifactRef) => ({ ...ref, codexOperationId: ref.codexOperationId ?? record.codexOperationId }));
  };
  check();
  return Object.freeze({
    async publish(actual: CodexOperation, activity: { kind: string } | CodexImageActivity) {
      check();
      if (actual !== operation) throw Error('Codex artifact operation mismatch');
      if (activity.kind !== 'image') return;
      const image = (activity as CodexImageActivity).savedImage;
      const workspace = await realpath(operation.cwd); check();
      const path = await realpath(image.absolutePath); check();
      const rel = relative(workspace, path);
      if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel) || resolve(workspace, image.relativePath) !== path || !rel.startsWith('.pi/openai-codex-images/')) throw Error('Image outside actual workspace');
      const bytes = await readFile(path); check();
      const ref: CodexArtifactRef = { codexOperationId: operation.id, path: rel, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, callId: image.callId, responseId: image.responseId, mimeType: `image/${image.outputFormat}` };
      await binding.write(() => {
        check();
        const refs = read();
        const prior = refs.find(r => r.path === ref.path);
        if (prior && prior.sha256 !== ref.sha256) throw Error('Codex artifact changed');
        if (!prior) refs.push(ref);
        root.query(`INSERT INTO extension_kv(extension_id,scope,scope_key,key,value) VALUES('codex-conversion','chat',?,?,?) ON CONFLICT(extension_id,scope,scope_key,key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`).run(binding.chatJid, key, JSON.stringify({ hostOperationId: binding.hostOperationId, chatJid: binding.chatJid, refs }));
        check();
      });
    },
    refs: read,
    /** Standard file-pill syntax; app-owned projection only, never model content. */
    filePills() { const refs = read(); return refs.length ? `Files:\n${refs.map(ref => `- ${ref.path}`).join('\n')}` : ''; },
  });
}


/** App-owned visible projection. Canonical SDK answer/history remain untouched.
 * Pass the returned function as ApplicationBootstrapOptions.materializeAnswer.
 * answers.put should be synchronous (the default owned answer store is); an async
 * implementation must fence its own commit too, since a completed write cannot be undone.
 */
export function createHostCodexAnswerMaterializer(options: {
  root: Database; cwd: string;
  answers: { put(ref: string, text: string): void | Promise<void> };
  assertOwner(): void;
}): NonNullable<RuntimeOptions['materializeAnswer']> {
  const { root, cwd, answers, assertOwner } = options;
  return async (ref, answer, operation) => {
    if (!Object.isFrozen(operation) || !operation.harness || operation.cancellation || operation.terminal)
      throw Error('Immutable live operation required');
    const h = operation.harness;
    const check = () => {
      assertOwner();
      const current = root.query(`SELECT 1 FROM service_effect_s01_operations o
        JOIN service_effect_s01_chats ch ON ch.chat_jid=o.chat_jid AND ch.active_operation_id=o.operation_id
        WHERE o.operation_id=? AND o.chat_jid=? AND o.version=? AND o.phase=?
        AND o.primary_source_seq=? AND o.cancellation_source_id IS NULL AND o.terminal_disposition IS NULL
        AND o.harness_session_id=? AND o.harness_operation_id IS ?`).get(operation.operationId, operation.chatJid,
          operation.version, operation.phase, operation.primarySourceSeq, h.sessionId, h.harnessOperationId);
      if (!current || !['executing', 'settling'].includes(operation.phase)) throw Error('Codex answer authority unavailable');
      const sources = root.query(`SELECT s.source_seq FROM service_effect_s01_sources s
        JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
        WHERE os.operation_id=? AND s.chat_jid=? AND s.state='claimed'`).all(operation.operationId, operation.chatJid) as {source_seq: number}[];
      if (!sources.some(s => s.source_seq === operation.primarySourceSeq) || sources.length !== operation.claimedSourceSeqs.length ||
        sources.some(s => !operation.claimedSourceSeqs.includes(s.source_seq))) throw Error('Codex answer source revoked');
      assertOwner();
    };
    check();
    const row = root.query("SELECT value FROM extension_kv WHERE extension_id='codex-conversion' AND scope='chat' AND scope_key=? AND key=?")
      .get(operation.chatJid, `outputrefs:${operation.operationId}`) as {value: string} | null;
    const paths: string[] = [];
    if (row) {
      const record = JSON.parse(row.value);
      if (record.hostOperationId !== operation.operationId || record.chatJid !== operation.chatJid || !Array.isArray(record.refs))
        throw Error('Codex artifact owner mismatch');
      check(); const workspace = await realpath(cwd); check();
      for (const item of record.refs) {
        if (!item || typeof item.path !== 'string' || !/^\.pi\/openai-codex-images\/[^\r\n]+$/.test(item.path) ||
          typeof (item.codexOperationId ?? record.codexOperationId) !== 'string' || !(item.codexOperationId ?? record.codexOperationId) ||
          typeof item.callId !== 'string' || !item.callId || (item.responseId !== undefined && typeof item.responseId !== 'string') ||
          typeof item.mimeType !== 'string' || !/^image\/[a-z0-9.+-]+$/.test(item.mimeType) ||
          !Number.isSafeInteger(item.bytes) || item.bytes < 0 || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256))
          throw Error('Invalid Codex artifact ref');
        check(); const path = await realpath(resolve(workspace, item.path)); check();
        const rel = relative(workspace, path);
        if (rel !== item.path || isAbsolute(rel) || rel.startsWith('../')) throw Error('Image outside actual workspace');
        check(); const bytes = await readFile(path); check();
        if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error('Codex artifact changed');
        if (!paths.includes(item.path)) paths.push(item.path);
      }
    }
    const text = answer.text + (paths.length ? `\n\nFiles:\n${paths.map(path => `- ${path}`).join('\n')}` : '');
    check(); const pending = answers.put(ref, text); check();
    if (pending !== undefined) { check(); await pending; check(); }
    return Object.freeze({ contentRef: ref, contentBlocksRef: null, mediaIds: Object.freeze([]) });
  };
}
