/** Process-local enrolment state. Nothing secret is written to a surface or timeline. */
import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { getWebRuntimeConfig, setWebTotpSecret } from '../../../core/config.js';
import { DEFAULT_WEB_USER_ID, createWebSession, deleteAllWebSessions, getDb } from '../../../db.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { generateTotpQr } from '../../../utils/totp-qr.js';
import { randomSessionToken, verifyTotp } from '../auth/auth.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { CLASSIC_A2UI_CATALOG, type A2uiSurfaceBlock } from './surface.js';

export type TotpFlow = 'setup' | 'secondary' | 'reset';
const digest = (secret: string) => createHash('sha256').update(secret.trim()).digest('hex');
const pending = new Map<string, {
  chatJid: string; flow: TotpFlow; candidate: string; previous: string; issuer: string; label: string; expires: number;
}>();
let confirming = false;

export function stageTotpSurface({ chatJid, flow, candidate, activeSecret, issuer, label, ttlMs = 600_000 }: {
  chatJid: string; flow: TotpFlow; candidate: string; activeSecret: string; issuer: string; label: string; ttlMs?: number;
}): A2uiSurfaceBlock {
  const surfaceId = crypto.randomUUID();
  const now = Date.now();
  for (const [id, state] of pending) if (state.expires <= now) pending.delete(id);
  if (pending.size >= 64) pending.delete(pending.keys().next().value!);
  pending.set(surfaceId, { chatJid, flow, candidate, previous: digest(activeSecret), issuer, label, expires: now + ttlMs });
  setTimeout(() => pending.delete(surfaceId), ttlMs).unref();
  const title = flow === 'setup' ? 'Set up TOTP' : flow === 'reset' ? 'Confirm new TOTP secret' : 'Add another TOTP device';
  return { type: 'a2ui_surface', owner: 'totp', state: 'active', revision: 1, fallback_text: title, surface: {
    surfaceId, catalogId: CLASSIC_A2UI_CATALOG, dataModel: {}, components: [
      { id: 'root', component: 'Column', children: ['title', 'open'] },
      { id: 'title', component: 'Text', text: title },
      { id: 'open', component: 'Button', child: 'open_label', variant: 'primary', action: { event: { name: 'totp-open' } } },
      { id: 'open_label', component: 'Text', text: 'Open private TOTP setup' },
    ],
  } };
}

export async function handleTotpSurfaceAction(options: {
  channel: WebChannelLike; req: Request; chatJid: string; block: A2uiSurfaceBlock; code?: string;
  authorise(): void; assertBinding(): void; complete(database: Database, feedback: string): void; publish(): void;
}): Promise<Response> {
  const { req, block, code, channel } = options;
  const surfaceId = block.surface.surfaceId;
  const state = pending.get(surfaceId);
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer' };
  const unavailable = () => Response.json({ error: 'This TOTP setup is no longer available. Run /totp again.' }, { status: 409, headers });
  const config = getWebRuntimeConfig();
  const available = () => !!state && pending.get(surfaceId) === state && state.chatJid === options.chatJid
    && Date.now() < state.expires && digest(config.totpSecret) === state.previous;
  if (!state || !available()) return unavailable();
  if (code === undefined) {
    const qr = generateTotpQr({ secret: state.candidate, issuer: state.issuer, label: state.label });
    options.authorise();
    return Response.json({ status: 'ok', totp_presentation: { expires_at: state.expires,
      manual_code: qr.secret, qr: `data:image/svg+xml;base64,${Buffer.from(qr.svg, 'utf8').toString('base64')}` } }, { headers });
  }
  if (confirming) return unavailable();
  if (!verifyTotp(state.candidate, code, config.totpWindow)) {
    return Response.json({ error: 'That code did not match. No changes were made. Use a new code from your authenticator.' }, { status: 422, headers });
  }
  confirming = true;
  const rotate = state.flow !== 'secondary';
  const feedback = state.flow === 'secondary' ? 'TOTP device validated. The active secret is unchanged.'
    : `TOTP ${state.flow} confirmed. Existing web sessions were invalidated.`;
  try {
    const token = randomSessionToken();
    const db = getDb();
    await admitSqliteWrite(db, () => {
      options.complete(db, feedback);
      if (rotate) deleteAllWebSessions();
      createWebSession(token, DEFAULT_WEB_USER_ID, Math.max(60, config.sessionTtl), 'totp');
    }, phase => {
      if (!available() || !verifyTotp(state.candidate, code, config.totpWindow)) throw Error('TOTP state changed');
      // Old cookies were intentionally revoked by the transaction.
      if (phase === 'before') options.authorise();
    }, req.signal, undefined, options.assertBinding);
    pending.delete(surfaceId);
    if (rotate) {
      setWebTotpSecret(state.candidate);
      channel.authGateway.setTotpSecret(state.candidate);
    }
    options.publish();
    return Response.json({ status: 'ok', totp_result: 'success', message: feedback }, { headers: {
      ...headers, 'Set-Cookie': channel.authGateway.createTotpContext().buildSessionCookie(token, req),
    } });
  } catch {
    return unavailable();
  } finally { confirming = false; }
}
