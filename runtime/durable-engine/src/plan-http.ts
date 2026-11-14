import { createHash } from 'node:crypto';
import type { Session } from '@earendil-works/pi-durable';
import { awaitWithContext, type Context } from '@earendil-works/chord/context';
import { PlanDoc } from './plan-document.js';
import { DEFAULT_PLAN, normalizeStoredPlanMarkdown, structuredPlanDetails, type SessionPlan } from '../../src/plan/markdown.js';
import { createLogger } from '../../src/utils/logger.js';
const log = createLogger('plan');
export const planEtag = (plan: SessionPlan) => '"' + createHash('sha256').update(JSON.stringify(plan)).digest('hex') + '"';

/** Authenticated HTTP composition over the existing SDK Session, never a store. */
export async function handleNativePlanRequest(session: Session, request: Request, chat: string, context: Context,
  check: () => void, legacy: () => SessionPlan | undefined, changed: (plan: SessionPlan, action: 'write' | 'reset') => void) {
  const current = () => { request.signal.throwIfAborted(); context.abortSignal?.throwIfAborted(); check(); };
  const reply = (data: unknown, status = 200, tag?: string) => Response.json(data, { status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ...(tag ? { ETag: tag } : {}) } });
  const snapshot = (value: Readonly<SessionPlan>): SessionPlan => {
    if (value.chat_jid !== chat) throw Error('Plan identity mismatch');
    return { chat_jid: chat, markdown: value.markdown, updated_at: value.updated_at };
  };
  current(); let body: Record<string, unknown> = {}, markdown = DEFAULT_PLAN;
  if (request.method === 'POST') {
    if (!request.headers.get('if-match')) return reply({ error: 'Refresh the plan before saving.' }, 428);
    if (!request.body) return reply({ error: 'Missing Plan body.' }, 400);
    const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        current(); const part = await awaitWithContext(reader.read(), context); current(); if (part.done) break;
        size += part.value.byteLength; if (size > 131072) return reply({ error: 'Plan body too large.' }, 413);
        chunks.push(part.value);
      }
    } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
    current();
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Object required');
      body = value;
      if (body.chat_jid !== undefined && body.chat_jid !== chat) throw Error('Conflicting chat');
      if (body.action !== 'reset' && typeof body.markdown !== 'string') throw Error('Markdown required');
      markdown = body.action === 'reset' ? DEFAULT_PLAN : normalizeStoredPlanMarkdown(body.markdown);
    } catch { return reply({ error: 'Invalid Plan body.' }, 400); }
    if (Buffer.byteLength(JSON.stringify({ chat_jid: chat, markdown, updated_at: new Date().toISOString() }), 'utf8') > 65536) {
      return reply({ error: 'Plan value too large.' }, 413);
    }
  } else if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
  current(); const existing = await session.snapshot(PlanDoc, chat, context); current();
  const initial = snapshot(existing ?? legacy() ?? { chat_jid: chat, markdown: DEFAULT_PLAN, updated_at: null });
  if (request.method === 'GET') return reply({ ok: true, plan: structuredPlanDetails(initial) }, 200, planEtag(initial));
  let conflict = false;
  const plan = await session.commit(async tx => {
    current(); const draft = await tx.doc(PlanDoc, chat, initial); current();
    if (request.headers.get('if-match') !== planEtag(snapshot(draft))) { conflict = true; throw Error('Stale Plan write'); }
    const next = { chat_jid: chat, markdown, updated_at: new Date().toISOString() };
    draft.markdown = markdown; draft.updated_at = next.updated_at; current(); return next;
  }, context).catch(error => { if (!conflict) throw error; return undefined; });
  if (!plan) return reply({ error: 'Plan changed; refresh before saving. Your edits were not saved.' }, 409);
  current();
  try { changed(plan, body.action === 'reset' ? 'reset' : 'write'); }
  catch { log.warn('Plan change notification unavailable', { operation: 'plan.notify_failed' }); }
  return reply({ ok: true, plan: structuredPlanDetails(plan) }, 200, planEtag(plan));
}
