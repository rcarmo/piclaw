import { defineTool, type ConversationId, type TaskId } from "@earendil-works/pi-durable";
import { keychainInventoryDescription, keychainInventoryParameters, readKeychainInventory } from "../../src/secure/keychain-inventory.js";
import { toolCallSummary } from "../../src/tool-call-summary.js";

export function createHostKeychainTool(options: {
  assertCurrent(): void;
  captureSourceGuard(call: { conversationId: ConversationId; taskId: TaskId; toolCallId: string }): Promise<() => void>;
}) {
  return defineTool({
    name: "keychain", description: keychainInventoryDescription, parameters: keychainInventoryParameters,
    ...toolCallSummary(() => "List entries"),
    callers: ["model"], replay: "unsafe",
    async execute(args, api, context) {
      context.abortSignal?.throwIfAborted();
      options.assertCurrent();
      const guard = await options.captureSourceGuard({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId });
      const check = () => { context.abortSignal?.throwIfAborted(); options.assertCurrent(); guard(); };
      check();
      const result = readKeychainInventory(args);
      check();
      return { output: result.content, details: result.details, isError: result.isError };
    },
  });
}
