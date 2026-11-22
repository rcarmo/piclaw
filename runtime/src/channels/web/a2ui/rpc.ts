import { CallAgentFunctionMessageSchema, ErrorMessageSchema, RendererFunctionResponseMessageSchema, type CallAgentFunctionMessage } from '@a2ui/web_core/v1_0';
import { isSingleUserAccess } from '../../../core/config-access.js';
import { captureHostDatabaseBinding, getDb } from '../../../db/connection.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { getMessageByRowIdFromDatabase } from '../../../db/messages.js';
import { captureWebRequestAuthority } from '../auth/auth-gateway.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { captureInputTarget } from '../messaging/input-request-authority.js';
import { readA2uiCatalogueOffer } from './capabilities.js';
import { parseA2uiDrafts } from './drafts.js';
import { prepareA2uiDraftProjection, readA2uiRendererDataModel, readA2uiSurfaceOwner, type AcceptedRendererPeer } from './input-metadata.js';
import { boundedRpcJson, MAX_RPC_VALUE } from './rpc-json.js';
import { A2UI_ERROR_TEXT, enqueueA2uiRendererError } from './renderer-errors.js';
import { absoluteA2uiPointer } from './data-path.js';
import { isA2uiSurfaceBlock } from './surface.js';

const MAX_BODY = 96 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readRpcBody(req: Request, maxBytes = MAX_BODY): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw Error('Missing RPC body');
  const decoder = new TextDecoder('utf-8',{fatal:true});
  let bytes=0, json='';
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (done) return JSON.parse(json+decoder.decode());
      if ((bytes+=value.length)>maxBytes) throw Error('RPC body too large');
      json+=decoder.decode(value,{stream:true});
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validCallId = (id: string) => id.length > 0 && id.length <= 128 && !/[\x00-\x1f\x7f]/.test(id);

const privateHeaders = { 'Cache-Control':'private, no-store',Vary:'Cookie' };
const json = (body: unknown, status: number) => Response.json(body,{status,headers:privateHeaders});

function rendererAuthority(channel: WebChannelLike, req: Request) {
  if (!isSingleUserAccess()) throw Error('A2UI RPC requires single-user access');
  const gateway = channel.authGateway;
  const principal = gateway?.getPrincipal?.(req);
  if (!principal || (principal.kind !== 'local' && !principal.authentication.sessionId)) throw Error('A renderer session is required');
  const verify = captureWebRequestAuthority(gateway,req);
  return { sessionId:principal.authentication.sessionId, assertCurrent() {
    verify(); if (channel.authGateway !== gateway) throw Error('A2UI RPC authentication changed');
  } };
}

const isWebChat = (value: unknown): value is string => typeof value === 'string' && value.startsWith('web:') && value.length <= 240;

/** Only the holder of the live stream and its original login can attach the peer to a turn. */
export function bindRendererOffer(channel: WebChannelLike, req: Request, chatJid: string, lease: unknown, metadata: unknown): AcceptedRendererPeer | undefined {
  if (lease === undefined) return;
  const { sessionId } = rendererAuthority(channel,req);
  const scope = channel.a2uiRpcScope?.(chatJid);
  const catalogues = readA2uiCatalogueOffer(metadata);
  if (!scope || !catalogues?.length) return;
  const hash = scope.renderer?.bind(lease,{chatJid,conversationId:scope.conversationId,sessionId});
  return hash ? {hash,catalogues:[...catalogues]} : undefined;
}

export function handleA2uiRendererPeer(channel: WebChannelLike, req: Request): Response {
  const chatJid = new URL(req.url).searchParams.get('chat_jid');
  if (!isWebChat(chatJid)) return json({error:'Invalid renderer peer chat.'},400);
  try {
    const auth = rendererAuthority(channel,req);
    const scope = channel.a2uiRpcScope?.(chatJid);
    if (!scope?.renderer) return json({error:'Renderer RPC is unavailable for this chat.'},404);
    const assertDatabase = captureHostDatabaseBinding();
    const target = captureInputTarget(chatJid);
    const assertCurrent = () => { auth.assertCurrent(); assertDatabase(); target(); scope.assertCurrent(); };
    const encoder = new TextEncoder();
    let disconnect: (() => void) | undefined;
    const abort = () => disconnect?.();
    const stream = new ReadableStream<Uint8Array>({start(controller) {
      const emit = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const peer = scope.renderer!.register({chatJid,conversationId:scope.conversationId,sessionId:auth.sessionId},assertCurrent,
        packet => emit('a2ui_call',packet),() => {
          clearInterval(heartbeat);
          req.signal.removeEventListener('abort',abort);
          scope.signal?.removeEventListener('abort',abort);
          try { controller.close(); } catch { return; } // Reader may already have cancelled the stream.
        });
      const heartbeat = setInterval(() => {
        try { assertCurrent(); controller.enqueue(encoder.encode(': heartbeat\n\n')); }
        catch { peer.disconnect(); }
      },15_000);
      disconnect = peer.disconnect;
      req.signal.addEventListener('abort',abort,{once:true});
      scope.signal?.addEventListener('abort',abort,{once:true});
      emit('a2ui_peer',{renderer_peer:peer.lease});
    },cancel:abort});
    return new Response(stream,{headers:{...privateHeaders,'Content-Type':'text/event-stream','X-Accel-Buffering':'no'}});
  } catch { return json({error:'Renderer peer is not available.'},403); }
}

export async function handleA2uiRendererReply(channel: WebChannelLike, req: Request): Promise<Response> {
  let auth: ReturnType<typeof rendererAuthority>;
  try { auth = rendererAuthority(channel,req); }
  catch { return json({error:'A2UI RPC is not authorised.'},403); }
  try {
    const body = await readRpcBody(req);
    if (!record(body) || Object.keys(body).length !== 3 || !isWebChat(body.chat_jid) || typeof body.renderer_peer !== 'string')
      throw Error('Malformed renderer response');
    const message = RendererFunctionResponseMessageSchema.parse(body.message);
    const reply = message.rendererFunctionResponse;
    if (!validCallId(reply.functionCallId) || Buffer.byteLength(JSON.stringify(boundedRpcJson(reply))) > MAX_RPC_VALUE)
      throw Error('Invalid renderer response');
    auth.assertCurrent();
    const scope = channel.a2uiRpcScope?.(body.chat_jid);
    if (!scope?.renderer?.reply(body.renderer_peer,{chatJid:body.chat_jid,conversationId:scope.conversationId,sessionId:auth.sessionId},message))
      return json({error:'The renderer call is no longer pending.'},409);
    return new Response(null,{status:204,headers:privateHeaders});
  } catch { return json({error:'Invalid A2UI renderer response.'},400); }
}

export async function handleA2uiRpc(channel: WebChannelLike, req: Request): Promise<Response> {
  const changed = () => json({error:'The A2UI RPC surface or call identity changed.'},409);
  let auth: ReturnType<typeof rendererAuthority>;
  try { auth = rendererAuthority(channel,req); }
  catch { return json({error:'A2UI RPC is not authorised.'},403); }
  const { assertCurrent:authorise, sessionId:rendererSession } = auth;
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
    const {database,scope,assertCurrent} = captureRpcSurface(channel,authorise,chatJid,postId,threadId,revision,surfaceId);
    const model = offered.length ? readA2uiRendererDataModel(database,chatJid,scope.conversationId,{draftSurface:projectDraft}) : undefined;
    const metadata = model && Object.keys(model.surfaces).length ? {a2uiRendererDataModel:model} : {};
    const response = await scope.agent.invoke({chatJid,conversationId:scope.conversationId,rendererSession,revision,offered,
      metadata,signal:scope.signal ? AbortSignal.any([scope.signal,req.signal]) : req.signal,assertCurrent},message);
    return json(response,200);
  } catch { return changed(); }
}

function captureRpcSurface(channel: WebChannelLike, authorise: () => void, chatJid: string, postId: number, threadId: number, revision: number, surfaceId: string) {
  authorise();
  const database=getDb(), assertDatabase=captureHostDatabaseBinding(database);
  const target=captureInputTarget(chatJid);
  const scope=channel.a2uiRpcScope?.(chatJid);
  if (!scope) throw Error('A2UI RPC route changed');
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
  return {database,scope,assertCurrent,assertDatabase};
}

/** Renderer diagnostics travel out of band; they never start an agent turn. */
export async function handleA2uiRendererError(channel: WebChannelLike, req: Request): Promise<Response> {
  let auth: ReturnType<typeof rendererAuthority>;
  try { auth=rendererAuthority(channel,req); }
  catch { return json({error:'A2UI RPC is not authorised.'},403); }
  let body: unknown;
  try { body=await readRpcBody(req,4096); }
  catch { return json({error:'Invalid A2UI renderer error.'},400); }
  if (!record(body) || Object.keys(body).length!==6 || !isWebChat(body.chat_jid) || !positiveId(body.post_id)
    || !positiveId(body.thread_id) || !positiveId(body.revision) || typeof body.surface_id!=='string' || !validCallId(body.surface_id))
    return json({error:'Invalid A2UI renderer error.'},400);
  const parsed=ErrorMessageSchema.safeParse(body.message);
  if (!parsed.success) return json({error:'Invalid A2UI renderer error.'},400);
  const {error}=parsed.data;
  const {code}=error;
  const {chat_jid:chatJid,post_id:postId,thread_id:threadId,revision,surface_id:surfaceId}=body;
  const path='path' in error ? error.path : undefined;
  const validation=code==='VALIDATION_FAILED' || code==='UNALLOWED_PARENT' || code==='UNALLOWED_CHILD';
  const callId='functionCallId' in error ? error.functionCallId : undefined;
  if (typeof code!=='string' || !Object.hasOwn(A2UI_ERROR_TEXT,code) || !error.message || error.message.length>1024
    || Object.keys(error).length!==(validation ? 4 : 3) || validation!==(path!==undefined)
    || (callId===undefined ? error.surfaceId!==surfaceId : typeof callId!=='string' || !validCallId(callId) || code!=='EXPRESSION_ERROR')
    || (path!==undefined && (typeof path!=='string' || path.length>128 || !absoluteA2uiPointer(path,true))))
    return json({error:'Invalid A2UI renderer error.'},400);
  const message=ErrorMessageSchema.parse({version:'1.0',error:{code,message:A2UI_ERROR_TEXT[code as keyof typeof A2UI_ERROR_TEXT],
    ...(callId===undefined ? {surfaceId} : {functionCallId:callId}),...(path===undefined ? {} : {path}),
  }});
  try {
    const {database,scope,assertCurrent,assertDatabase}=captureRpcSurface(channel,auth.assertCurrent,chatJid,postId,threadId,revision,surfaceId);
    const assertReport=()=>{
      assertCurrent();
      if (typeof callId==='string' && !scope.agent.correlatesRendererError({chatJid,conversationId:scope.conversationId,rendererSession:auth.sessionId,revision},surfaceId,callId))
        throw Error('A2UI function receipt changed');
    };
    const signal=scope.signal ? AbortSignal.any([scope.signal,req.signal]) : req.signal;
    const accepted=await admitSqliteWrite(database,()=>enqueueA2uiRendererError(database,chatJid,scope.conversationId,`a2ui:${surfaceId}`,revision,message),assertReport,signal,undefined,assertDatabase);
    return accepted ? new Response(null,{status:204,headers:privateHeaders}) : json({error:'Too many renderer reports.'},429);
  } catch { return json({error:'The A2UI error source changed.'},409); }
}
