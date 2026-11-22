import { CallAgentFunctionMessageSchema, type CallAgentFunctionMessage } from '@a2ui/web_core/v1_0';
import { isSingleUserAccess } from '../../../core/config-access.js';
import { captureHostDatabaseBinding, getDb } from '../../../db/connection.js';
import { getMessageByRowIdFromDatabase } from '../../../db/messages.js';
import { captureWebRequestAuthority } from '../auth/auth-gateway.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { captureInputTarget } from '../messaging/input-request-authority.js';
import { readA2uiCatalogueOffer } from './capabilities.js';
import { parseA2uiDrafts } from './drafts.js';
import { prepareA2uiDraftProjection, readA2uiRendererDataModel, readA2uiSurfaceOwner } from './input-metadata.js';
import { boundedRpcJson, MAX_RPC_VALUE } from './agent-rpc.js';
import { isA2uiSurfaceBlock } from './surface.js';

const MAX_BODY = 96 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readRpcBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw Error('Missing RPC body');
  const decoder = new TextDecoder('utf-8',{fatal:true});
  let bytes=0, json='';
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (done) return JSON.parse(json+decoder.decode());
      if ((bytes+=value.length)>MAX_BODY) throw Error('RPC body too large');
      json+=decoder.decode(value,{stream:true});
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validCallId = (id: string) => id.length > 0 && id.length <= 128 && !/[\x00-\x1f\x7f]/.test(id);

export async function handleA2uiRpc(channel: WebChannelLike, req: Request): Promise<Response> {
  const json = (body: unknown, status: number) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
  const changed = () => json({error:'The A2UI RPC surface or call identity changed.'},409);
  if (!isSingleUserAccess()) return json({error:'A2UI RPC requires single-user access.'},403);
  const gateway = channel.authGateway;
  let authorise: () => void, rendererSession: string | null;
  try {
    const principal = gateway.getPrincipal?.(req);
    if (!principal || (principal.kind !== 'local' && !principal.authentication.sessionId)) throw Error('A renderer session is required');
    rendererSession = principal.authentication.sessionId;
    const verify = captureWebRequestAuthority(gateway,req);
    authorise = () => { verify(); if (channel.authGateway !== gateway) throw Error('A2UI RPC authentication changed'); };
  } catch { return json({error:'A2UI RPC is not authorised.'},403); }
  let body: unknown, message: CallAgentFunctionMessage, offered: readonly string[];
  let projectDraft: Awaited<ReturnType<typeof prepareA2uiDraftProjection>>;
  try {
    body = await readRpcBody(req);
    if (!record(body) || Object.keys(body).some(key => !['chat_jid','post_id','thread_id','revision','message','metadata','a2ui_drafts'].includes(key))) throw Error('Invalid request');
    if (typeof body.chat_jid !== 'string' || !body.chat_jid.startsWith('web:') || body.chat_jid.length > 240
      || !positiveId(body.post_id) || !positiveId(body.thread_id) || !positiveId(body.revision)) throw Error('Invalid source');
    message = CallAgentFunctionMessageSchema.parse(body.message);
    const {surfaceId,functionCallId,callFunction} = message.callAgentFunction;
    if (!validCallId(functionCallId) || !validCallId(surfaceId) || !callFunction.catalogId || callFunction.catalogId.length > 512
      || !/^[_\p{XID_Start}][\p{XID_Continue}]*$/u.test(callFunction['@call']) || callFunction['@call'].length > 128
      || Buffer.byteLength(JSON.stringify(boundedRpcJson(callFunction.args ?? {}))) > MAX_RPC_VALUE) throw Error('Invalid function call');
    offered = readA2uiCatalogueOffer(body.metadata) ?? [];
    const patches = parseA2uiDrafts(body.a2ui_drafts);
    if (patches?.length && !offered.length) throw Error('Drafts require a renderer offer');
    projectDraft = patches?.length ? await prepareA2uiDraftProjection(patches) : undefined;
  } catch { return json({error:'Invalid A2UI RPC request.'},400); }
  const {chat_jid:chatJid,post_id:postId,thread_id:threadId,revision} = body;
  const {surfaceId} = message.callAgentFunction;
  try {
    authorise();
    const database=getDb(), assertDatabase=captureHostDatabaseBinding(database);
    const target=captureInputTarget(chatJid);
    const scope=channel.a2uiRpcScope?.(chatJid);
    if (!scope) return changed();
    const assertCurrent = () => {
      authorise(); assertDatabase(); target(); scope.assertCurrent();
      const source=getMessageByRowIdFromDatabase(database,chatJid,postId);
      const root=getMessageByRowIdFromDatabase(database,chatJid,threadId);
      const block=source?.data?.content_blocks?.find(isA2uiSurfaceBlock);
      const owner=readA2uiSurfaceOwner(database,chatJid,`a2ui:${surfaceId}`);
      if (!root || (root.data?.thread_id != null && root.data.thread_id !== threadId)
        || source?.data?.type !== 'agent_response' || source.data.thread_id !== threadId
        || block?.state !== 'active' || block.owner !== 'agent' || block.revision !== revision || block.surface.surfaceId !== surfaceId
        || owner?.post_id !== postId || owner.conversation_id !== scope.conversationId) throw Error('A2UI RPC surface changed');
    };
    assertCurrent();
    const model = offered.length ? readA2uiRendererDataModel(database,chatJid,scope.conversationId,{draftSurface:projectDraft}) : undefined;
    const metadata = model && Object.keys(model.surfaces).length ? {a2uiRendererDataModel:model} : {};
    const response = await scope.agent.invoke({chatJid,conversationId:scope.conversationId,rendererSession,revision,offered,
      metadata,signal:scope.signal ? AbortSignal.any([scope.signal,req.signal]) : req.signal,assertCurrent},message);
    return json(response,200);
  } catch { return changed(); }
}
