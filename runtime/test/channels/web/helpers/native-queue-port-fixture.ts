import { getDb, getDeferredQueuedFollowups } from "../../../../src/db.js";
import { admitWebMessage, type QueuedInputMaterialization } from "../../../../src/channels/web/messaging/message-store.js";

/** Host-port double for HTTP/queue UI tests. Real message/queue transactions and
 * source identities, no SDK queues or model effects. Durable integration tests
 * separately exercise canonical work-store acceptance/intent/recovery. */
export function installNativeQueuePorts(channel: any, options: {
  available?: (chatJid: string) => boolean;
  beforeAccept?: () => void;
  onIntent?: (input: { chatJid: string; text: string; behavior: "steer"; sourceId: string; rowId: number }) => void;
} = {}) {
  const assertTransaction = (database: ReturnType<typeof getDb>) => {
    if (database !== getDb() || !database.inTransaction) throw Error("Fixture requires the owned SQL transaction");
  };
  const materialize: QueuedInputMaterialization = stored => {
    assertTransaction(stored.database);
    if (!stored.item.source_accepted || !stored.item.source_id || stored.message.id !== stored.item.source_id)
      throw Error("Fixture accepted identity mismatch");
  };
  const available = (chat: string) => options.available?.(chat) ?? channel.agentPool.isStreaming?.(chat) === true;
  channel.agentPool.isDurableRuntime = () => true;
  channel.getInputSourceAdmission = () => (stored: any) => { assertTransaction(stored.database); };
  channel.getQueuedInputSourceAdmission = () => (stored: any) => {
    assertTransaction(stored.database); if (!stored.item.source_id) throw Error("Fixture source identity missing");
  };
  channel.getQueuedInputMaterialization = () => materialize;
  channel.getAcceptedQueuedSteering = (chat: string) => !available(chat) ? undefined : {
    async accept(rowId: number) {
      options.beforeAccept?.();
      if (!available(chat)) throw Error("Fixture running binding ended");
      const item = getDeferredQueuedFollowups(chat).find(item => item.rowId === rowId);
      if (!item?.source_accepted || !item.source_id) throw Error("Fixture requires accepted input");
      const interaction = await admitWebMessage(channel, { chatJid: chat, content: item.queuedContent,
        isBot: false, mediaIds: item.mediaIds ?? [], agentId: "default", agentName: "Fixture" }, {
        contentBlocks: item.contentBlocks, linkPreviews: item.linkPreviews, threadId: item.threadId,
        screenHint: item.screenHint, isSteeringMessage: true, consumeDeferredFollowupRowId: rowId,
        materializeQueuedSource: materialize,
      });
      if (!interaction) throw Error("Fixture materialization failed");
      options.onIntent?.({ chatJid: chat, text: item.queuedContent, behavior: "steer", sourceId: item.source_id, rowId });
      return { interaction, async dispatch() {} };
    },
  };
}
