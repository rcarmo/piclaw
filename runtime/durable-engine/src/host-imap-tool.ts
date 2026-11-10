import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { JsonValue } from "@earendil-works/chord/json";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";

export interface ImapNativeExports {
  createImapTool(options: { assertCurrent(): void; chatJid: string; signal?: AbortSignal }): ToolDefinition<any, JsonValue>;
}

/** Native IMAP invocation adapter; application owns addon pool disposal. */
export function createHostImapTool(addon: ImapNativeExports, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void;
}) {
  const definition = addon.createImapTool({ assertCurrent() { throw Error("Invocation-local IMAP authority required"); }, chatJid: "" });
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      if (!args || typeof args !== "object" || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null)) throw Error("Plain Imap arguments required");
      const params = structuredClone(args) as Record<string, unknown>;
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); }, false, call.signal);
      authority.assertCurrent();
      if (params.chat_jid && params.chat_jid !== captured.operation.chatJid) throw Error("Foreign chat profile denied");
      const native = addon.createImapTool({ assertCurrent: authority.assertCurrent, chatJid: captured.operation.chatJid, signal: call.signal });
      const result = await withExtensionKvAuthority({ ...authority, extensionId: "imap", chatJid: captured.operation.chatJid, globalRead: true, globalWrite: true }, () => native.execute(call.toolCallId, params, call.signal, undefined, undefined as never));
      authority.assertCurrent();
      return result;
    },
  });
}
