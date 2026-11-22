import type { Database } from 'bun:sqlite';
import { defineTool } from '@earendil-works/pi-durable';
import { a2uiToolParameters, publishAgentA2ui } from '../../src/channels/web/a2ui/publish.js';
import { getMessageByRowIdFromDatabase } from '../../src/db/messages.js';
import type { HostConversationRuntime } from './host-runtime.js';
import { createHostOperationAuthority } from './host-operation-authority.js';
import { resolveAcceptedMessageThread } from './host-message-thread.js';

/** Model-only posting in the exact accepted foreground thread, never a model-selected destination. */
export function createHostA2uiTool(options: {
  root: Database;
  assertOwner(): void;
  runtime(): Pick<HostConversationRuntime, 'captureToolSource' | 'assertCapturedSourceCurrent'>;
  broadcast(event: 'new_post' | 'interaction_updated', post: Record<string, unknown>): void;
}) {
  return defineTool({
    name: 'send_a2ui',
    description: 'Show an A2UI surface in the current Classic web thread. Use bare Express (e.g. root = Button(Text("Confirm"), action=Event("confirm"))) or one bounded batch of v1.0 JSON messages. For edits pass the returned post_id and current revision. Do not request secrets.',
    parameters: a2uiToolParameters, callers: ['model'], replay: 'unsafe',
    async execute(params, api, context) {
      const checkOwner = () => { options.assertOwner(); context.abortSignal?.throwIfAborted(); };
      checkOwner();
      const runtime = options.runtime();
      const captured = await runtime.captureToolSource(api.conversationId, api.taskId, api.callId);
      const chatJid = captured.operation.chatJid;
      const primary = captured.inputs.find(input => input.sourceSeq === captured.operation.primarySourceSeq);
      if (!primary || !captured.native || captured.delegateModel || !chatJid.startsWith('web:')) throw new Error('Foreground web source required');
      const authority = createHostOperationAuthority(options.root, captured, checkOwner, true);
      const check = () => {
        authority.assertCurrent();
        runtime.assertCapturedSourceCurrent(captured.inputs);
      };
      const result = await publishAgentA2ui({ root: options.root, chatJid, signal: context.abortSignal, authorise: check,
        thread: () => {
          const thread = resolveAcceptedMessageThread(options.root, primary);
          if (!thread) throw new Error('Foreground web thread required');
          return thread;
        } }, params);
      const interaction = getMessageByRowIdFromDatabase(options.root, chatJid, result.rowId);
      if (interaction) options.broadcast(result.created ? 'new_post' : 'interaction_updated', interaction as unknown as Record<string, unknown>);
      const receipt = { post_id: result.rowId, surface_id: result.surfaceId, revision: result.revision, deleted: result.deleted };
      return { output: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt };
    },
  });
}
