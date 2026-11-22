import type { Database } from 'bun:sqlite';
import type { JsonValue } from '@earendil-works/chord/json';
import type { ToolDefinition } from '../../src/durable-legacy-sdk.js';
import { getIdentityConfig } from '../../src/core/config.js';
import { getMessageByRowIdFromDatabase, storeMessageInDatabase } from '../../src/db/messages.js';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';
import { publishNativeAddonA2ui } from '../../src/channels/web/a2ui/addon.js';
import { createHostTool } from './host-tools.js';
import { createHostOperationAuthority } from './host-operation-authority.js';
import type { HostConversationRuntime } from './host-runtime.js';
import { resolveAcceptedMessageThread } from './host-message-thread.js';

type Broadcast = (type: string, data: unknown) => void;
type SurfaceInput = Parameters<typeof publishNativeAddonA2ui>[0];
type Definition = ToolDefinition<any, JsonValue>;

export interface AutoresearchNativeExports {
  getAutoresearchPrompt(): string;
  createAutoresearchToolDefinitions(broadcast: Broadcast, invocation?: {
    chatJid: string; assertCurrent(): void;
    post(input: SurfaceInput, signal?: AbortSignal): Promise<number>;
  }): readonly Definition[];
  bindNativeAutoresearchObserver(broadcast: Broadcast, assertOwner: () => void): { reattach(): void; dispose(): void };
}

/** The catalogue declares tools; only the application grants live source and process authority. */
export function createHostAutoresearch(addon: AutoresearchNativeExports, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, 'captureToolSource' | 'assertCapturedSourceCurrent'>;
  assertOwner(): void;
  assertAttached(): void;
  broadcast: Broadcast;
}) {
  const ready = () => { options.assertOwner(); options.assertAttached(); };
  const definitions = addon.createAutoresearchToolDefinitions(options.broadcast);
  const tools = definitions.map((definition, index) => createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: 'host-effect-port', replay: 'unsafe',
    async invoke(args, call) {
      ready(); call.assertAllowed();
      const runtime = options.runtime();
      const capture = await runtime.captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const chatJid = capture.operation.chatJid;
      const primary = capture.inputs.find(input => input.sourceSeq === capture.operation.primarySourceSeq);
      if (!primary || !capture.native || capture.delegateModel || !chatJid.startsWith('web:')) throw Error('Autoresearch requires a foreground web source');
      const authority = createHostOperationAuthority(options.root, capture, () => { ready(); call.assertAllowed(); }, true);
      const assertCurrent = () => { authority.assertCurrent(); runtime.assertCapturedSourceCurrent(capture.inputs); };
      assertCurrent();
      const threadId = resolveAcceptedMessageThread(options.root, primary);
      if (!threadId) throw Error('Autoresearch requires an accepted web thread');
      const native = addon.createAutoresearchToolDefinitions(options.broadcast, { chatJid, assertCurrent, async post(input, signal) {
        if (input.chatJid !== chatJid) throw Error('Autoresearch cannot change its publication chat');
        const assertPublication = () => {
          assertCurrent();
          if (resolveAcceptedMessageThread(options.root, primary) !== threadId) throw Error('Autoresearch publication thread changed');
        };
        const id = await publishNativeAddonA2ui(input, { threadId, assertPublication, assertAction: ready,
          admitPost: (_chat, content, block, check, postSignal) => admitSqliteWrite(options.root, () => storeMessageInDatabase(options.root, {
            id: `a2ui:${block.surface.surfaceId}`, chat_jid: chatJid, thread_id: threadId, sender: 'assistant',
            sender_name: getIdentityConfig().assistantName, content, content_blocks: [block], is_bot_message: true,
            is_from_me: true, timestamp: new Date().toISOString(),
          }), check, postSignal),
        }, signal);
        assertPublication();
        const row = getMessageByRowIdFromDatabase(options.root, chatJid, id);
        if (row) options.broadcast('new_post', row);
        return id;
      } })[index];
      if (!native || native.name !== definition.name) throw Error('Autoresearch tool declaration changed');
      return native.execute(call.toolCallId, args, call.signal, call.onUpdate, undefined as never);
    },
  }));
  let observer: ReturnType<AutoresearchNativeExports['bindNativeAutoresearchObserver']> | undefined;
  return {
    tools,
    prompt() { options.assertOwner(); return addon.getAutoresearchPrompt(); },
    attach() {
      ready();
      if (observer) throw Error('Autoresearch host already attached');
      observer = addon.bindNativeAutoresearchObserver(options.broadcast, ready);
      try { observer.reattach(); }
      catch (error) { observer.dispose(); observer = undefined; throw error; }
    },
    dispose() { observer?.dispose(); observer = undefined; },
  };
}
