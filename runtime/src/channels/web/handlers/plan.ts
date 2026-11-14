import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { captureWebRequestAuthority } from '../auth/auth-gateway.js';
import { captureHostDatabaseBinding, getDb } from '../../../db/connection.js';
import { readAccessConfig } from '../../../core/config-access.js';
import { checkCsrfOrigin } from '../http/security.js';

/** HTTP authority only. Persistence, ordering and cancellation belong to the
 * current native backend/SDK Session, never the add-on or AgentPool. */
export async function handlePlan(channel: WebChannelLike, request: Request, url: URL): Promise<Response> {
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (readAccessConfig().mode !== 'single-user') return fail('Plan requires an authorised native operator.', 403);
  if (request.method === 'POST' && (!request.headers.get('origin') || !checkCsrfOrigin(request))) return fail('Invalid origin.', 403);
  const chat = url.searchParams.get('chat_jid')?.trim();
  if (!chat) return fail('Explicit Plan chat required.', 400);
  const root = getDb(), binding = captureHostDatabaseBinding(root), gateway = channel.authGateway;
  let authority: () => void;
  try { authority = captureWebRequestAuthority(gateway, request); }
  catch { return fail('Plan access denied.', 403); }
  const check = () => {
    binding(); authority();
    if (channel.authGateway !== gateway || readAccessConfig().mode !== 'single-user') throw Error('Plan request authority changed');
    if (!root.query('SELECT 1 FROM chats WHERE jid=?').get(chat)) throw Error('Unknown Plan chat');
    const branch = root.query('SELECT archived_at FROM chat_branches WHERE chat_jid=?').get(chat) as { archived_at: string | null } | null;
    if (branch?.archived_at) throw Error('Archived Plan chat');
  };
  try {
    check();
    if (!channel.handlePlanRequest) return fail('Native Plan backend unavailable.', 503);
    return await channel.handlePlanRequest(request, chat, check);
  } catch { return fail('Plan operation could not be completed. Refresh before retrying.', 503); }
}
