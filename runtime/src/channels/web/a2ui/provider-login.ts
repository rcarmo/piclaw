import { createLogger } from '../../../utils/logger.js';
import type { Database } from 'bun:sqlite';
import type { AgentControlResult } from '../../../agent-control/agent-control-types.js';
import { commitPrivateProviderAuthResponse, withPrivateProviderAuthResponse } from '../../../agent-control/handlers/login.js';
import { getDb } from '../../../db.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { resolveAndBroadcastModelStateForCommand } from '../agent/command-model-state.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { buildA2uiAction, type A2uiAction, type A2uiActionRequest } from './action.js';
import { resolveLoginSurfaceAction, retireLoginSurface } from './login-surface.js';
import { isA2uiSurfaceBlock, type A2uiSurfaceBlock } from './surface.js';

const log = createLogger("a2ui.provider-login");

const pending = new Set<string>();
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer' };
const privateJson = (value: unknown, status = 200) => Response.json(value, { status, headers });

export async function handleProviderLoginSurface(options: {
  channel: WebChannelLike; req: Request; source: Pick<A2uiActionRequest, 'chat_jid' | 'post_id' | 'thread_id'>;
  block: A2uiSurfaceBlock; action: A2uiAction; privateValue: unknown;
  authorise(): void; assertBinding(): void; replace(database: Database, next: A2uiSurfaceBlock): void; publish(): void;
}): Promise<Response> {
  const { channel, req, source, block, action, privateValue } = options;
  const surfaceId = block.surface.surfaceId;
  const lookup = () => resolveLoginSurfaceAction(source.chat_jid, surfaceId, action.sourceComponentId);
  const unavailable = () => privateJson({ error: 'This authentication action is unavailable. Use the latest surface or start again with /login.' }, 409);
  const binding = lookup();
  if (!binding || pending.has(surfaceId)) return unavailable();
  if (privateValue !== undefined && (!binding.privateField || typeof privateValue !== 'string' || privateValue.length > 4096)) {
    return privateJson({ error: 'Unexpected private authentication input.' }, 400);
  }
  if (binding.privateField === 'auth_value' && privateValue === undefined) {
    return privateJson({ error: 'Open private authentication to continue.' }, 400);
  }
  const data = Object.fromEntries(Object.entries(action.context).map(([key, value]) =>
    [key, binding.choices.has(key) && Array.isArray(value) ? value[0] ?? '' : value]));
  Object.assign(data, binding.data, binding.privateField && privateValue !== undefined ? { [binding.privateField]: privateValue } : {});
  const check = () => { options.assertBinding(); options.authorise(); if (!lookup()) throw Error('Authentication surface expired'); };
  pending.add(surfaceId);
  try {
    return await withPrivateProviderAuthResponse(async () => {
      check();
      const result = await channel.agentPool.applyControlCommand(source.chat_jid, {
        type: 'login', raw: '/login', interaction: { step: binding.step, data },
      });
      check();
      if (result.status !== 'success') return privateJson({ error: result.message || 'Authentication did not complete.' }, 422);
      const returned = result.contentBlocks?.find(isA2uiSurfaceBlock);
      if (result.authPresentation && returned?.owner !== 'login') throw Error('Private response has no continuation');
      const revision = block.revision + 1;
      const next: A2uiSurfaceBlock = returned?.owner === 'login' ? { ...returned, revision } : {
        type: 'a2ui_surface', owner: 'login', revision,
        state: binding.data?.method === 'runtime_cancel' ? 'cancelled' : 'completed', fallback_text: result.message,
        surface: { ...block.surface, dataModel: {}, components: [{ id: 'root', component: 'Text', text: result.message.replaceAll('**', '') }] },
      };
      const auth = result.authPresentation;
      const response = privateJson({ status: 'ok', ...(auth ? { auth_presentation: {
        expires_at: auth.expires_at, events: auth.events, prompt: auth.prompt,
        actions: Object.fromEntries(next.surface.components.filter(item => item.component === 'Button' && ['continue', 'check', 'cancel'].includes(item.id)).map(item => [item.id, {
          ...source, revision, request_id: crypto.randomUUID(), message: buildA2uiAction(next.surface, item.id, new Map(), new Date().toISOString()),
        }])),
      } } : {}) });
      await admitSqliteWrite(getDb(), () => options.replace(getDb(), next), check, req.signal, undefined, options.assertBinding);
      commitPrivateProviderAuthResponse();
      retireLoginSurface(surfaceId);
      // The write has committed. Browser reconnect can hydrate it if publication fails.
      try { options.publish(); } catch { log.warn("Committed provider surface update could not be broadcast", { operation: "a2ui.login.publish" }); }
      if (result.model_label) await publishModelState(channel, source.chat_jid, result);
      return response;
    });
  } catch { return unavailable(); }
  finally { pending.delete(surfaceId); if (binding.privateField) delete data[binding.privateField]; }
}

async function publishModelState(channel: WebChannelLike, chatJid: string, result: AgentControlResult) {
  try { await resolveAndBroadcastModelStateForCommand(channel, chatJid, result); }
  catch { log.warn("Activated model could not be broadcast", { operation: "a2ui.login.model_changed" }); }
}
