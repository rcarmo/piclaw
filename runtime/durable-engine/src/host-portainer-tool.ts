import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { JsonValue } from "@earendil-works/chord/json";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";

export interface PortainerNativeExports {
  createPortainerTool(options: { chatJid: string; assertCurrent(): void }): ToolDefinition<any, JsonValue>;
}
export function createHostPortainerTool(addon: PortainerNativeExports, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void;
}) {
  const definition = addon.createPortainerTool({ chatJid: "", assertCurrent() { throw Error("Invocation-local Portainer authority required"); } });
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      if (!args || typeof args !== "object" || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null)) throw Error("Plain Portainer arguments required");
      const params = structuredClone(args) as Record<string, unknown>;
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const readonly = ["get", "discover", "contract", "capabilities", "recommend", "workflow_help", "request_help"].includes(String(params.action));
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); }, readonly, call.signal);
      authority.assertCurrent();
      const chatJid = captured.operation.chatJid;
      if (params.chat_jid && params.chat_jid !== chatJid) throw Error("Foreign chat profile denied");
      const native = addon.createPortainerTool({ chatJid, assertCurrent: authority.assertCurrent });
      const result = await withExtensionKvAuthority({ ...authority, extensionId: "portainer", chatJid: captured.operation.chatJid, globalRead: true, globalWrite: false }, () => native.execute(call.toolCallId, params, call.signal, undefined, undefined as never));
      authority.assertCurrent();
      return result;
    },
  });
}
