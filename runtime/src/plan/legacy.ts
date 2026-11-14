import type { Database } from 'bun:sqlite';
import type { SessionPlan } from './markdown.js';

/** Read-only adoption of the historical composite key. No add-on import, KV
 * client, default-scope inference, mutation, migration marker or memory fallback.
 * The caller authorises the exact chat/branch before selecting its record. */
export function readLegacyPlan(db: Database, chatJid: string): SessionPlan | undefined {
  if (!chatJid.trim()) throw Error('Explicit Plan chat identity required');
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='extension_kv'").get()) return undefined;
  const row = db.query('SELECT value FROM extension_kv WHERE extension_id=? AND scope=? AND scope_key=? AND key=?')
    .get('plan-sidebar', 'chat', chatJid, 'plan') as { value: string } | null;
  if (!row) return undefined;
  let value: unknown;
  try { value = JSON.parse(row.value); }
  catch { throw Error('Existing Plan record requires review; it was not changed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Existing Plan record requires review; it was not changed');
  const plan = value as Partial<SessionPlan>;
  if (plan.chat_jid !== chatJid || typeof plan.markdown !== 'string' || (plan.updated_at !== null && typeof plan.updated_at !== 'string'))
    throw Error('Existing Plan identity or value requires review; it was not changed');
  return { chat_jid: chatJid, markdown: plan.markdown, updated_at: plan.updated_at };
}
