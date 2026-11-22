import { defineTool } from '@earendil-works/pi-durable';
import { Type } from 'typebox';
import { CallRendererFunctionMessageSchema } from '@a2ui/web_core/v1_0';
import { boundedRpcJson, MAX_RPC_VALUE } from '../../src/channels/web/a2ui/agent-rpc.js';
import { readAcceptedRendererPeer, readA2uiSurfaceOwner } from '../../src/channels/web/a2ui/input-metadata.js';
import { rendererRpcError, type RendererRpcBroker } from '../../src/channels/web/a2ui/renderer-rpc.js';
import { CLASSIC_A2UI_CATALOG, isA2uiSurfaceBlock } from '../../src/channels/web/a2ui/surface.js';
import { getMessageByRowIdFromDatabase } from '../../src/db/messages.js';
import type { createHostA2uiTool } from './host-a2ui-tool.js';
import { createHostOperationAuthority } from './host-operation-authority.js';
import { resolveAcceptedMessageThread } from './host-message-thread.js';

/** RPC sends no code and cannot choose a destination other than the accepted renderer. */
export function createHostA2uiRendererTool(options: Omit<Parameters<typeof createHostA2uiTool>[0], 'broadcast'> & {renderer: RendererRpcBroker}) {
  return defineTool({
    name:'call_a2ui_renderer',
    description:'Send one A2UI v1.0 callRendererFunction message to the renderer for this turn. Only offered catalogues are available. For a surface call, include its post_id and current revision. Returns a correlated rendererFunctionResponse. Basic Catalogue functions cannot be called remotely.',
    parameters:Type.Object({message:Type.Record(Type.String(),Type.Unknown()),post_id:Type.Optional(Type.Integer({minimum:1})),
      revision:Type.Optional(Type.Integer({minimum:1}))},{additionalProperties:false}),
    callers:['model'],replay:'unsafe',
    async execute(params,api,context) {
      const message = CallRendererFunctionMessageSchema.parse(params.message);
      const {surfaceId,functionCallId,callFunction} = message.callRendererFunction;
      if (!functionCallId || functionCallId.length > 128 || /[\x00-\x1f\x7f]/.test(functionCallId)
        || !callFunction.catalogId || callFunction.catalogId.length > 512
        || Buffer.byteLength(JSON.stringify(boundedRpcJson(message))) > MAX_RPC_VALUE) throw Error('Invalid A2UI renderer call');
      const checkOwner = () => { options.assertOwner(); context.abortSignal?.throwIfAborted(); };
      checkOwner();
      const runtime = options.runtime();
      const captured = await runtime.captureToolSource(api.conversationId,api.taskId,api.callId);
      const chatJid = captured.operation.chatJid;
      const primary = captured.inputs.find(input => input.sourceSeq === captured.operation.primarySourceSeq);
      if (!primary || !captured.native || captured.delegateModel || !chatJid.startsWith('web:')) throw Error('Foreground web source required');
      const authority = createHostOperationAuthority(options.root,captured,checkOwner,true);
      const checkTurn = () => { authority.assertCurrent(); runtime.assertCapturedSourceCurrent(captured.inputs); };
      checkTurn();
      const recipient = {chatJid,sourceId:primary.sourceId,conversationId:api.conversationId};
      const peer = readAcceptedRendererPeer(options.root,recipient);
      const error = (description:string, code='INVALID_FUNCTION_CALL') => ({isError:true,output:[{type:'text' as const,
        text:JSON.stringify(rendererRpcError(functionCallId,code,description))}]});
      if (!peer?.catalogues.includes(callFunction.catalogId)) return error('The accepted turn has no renderer offering this catalogue.');
      if (callFunction['@call'] === '@index') return error('@index is only available in a template instance.','EXECUTION_ERROR');
      if (callFunction.catalogId === CLASSIC_A2UI_CATALOG) return error('Basic Catalogue functions are renderer-only.');
      const threadId = resolveAcceptedMessageThread(options.root,primary);
      if (!threadId) return error('The accepted web thread is unavailable.');
      const source = params.post_id !== undefined && params.revision !== undefined ? {post_id:params.post_id,revision:params.revision,thread_id:threadId} : undefined;
      if (surfaceId === undefined ? (params.post_id !== undefined || params.revision !== undefined) : !source)
        return error('Supply a post and revision only for a surface-bound call.');
      const checkSurface = () => {
        if (!source || surfaceId === undefined) return;
        const post = getMessageByRowIdFromDatabase(options.root,chatJid,source.post_id);
        const block = post?.data?.content_blocks?.find(isA2uiSurfaceBlock);
        const owner = readA2uiSurfaceOwner(options.root,chatJid,`a2ui:${surfaceId}`);
        if (post?.data?.thread_id !== threadId || block?.owner !== 'agent' || block.state !== 'active'
          || block.surface.surfaceId !== surfaceId || block.revision !== source.revision
          || owner?.post_id !== source.post_id || owner.conversation_id !== api.conversationId) throw Error('A2UI renderer surface changed');
      };
      try { checkSurface(); } catch { return error('The requested surface is not active in the accepted thread.'); }
      const response = await options.renderer.invoke(peer.hash,chatJid,api.conversationId,{message,source},() => {
        checkTurn();
        if (readAcceptedRendererPeer(options.root,recipient)?.hash !== peer.hash || resolveAcceptedMessageThread(options.root,primary) !== threadId)
          throw Error('A2UI renderer turn changed');
        checkSurface();
      },context.abortSignal);
      checkTurn();
      return {isError:!!response.rendererFunctionResponse.error,output:[{type:'text' as const,text:JSON.stringify(response)}]};
    },
  });
}
