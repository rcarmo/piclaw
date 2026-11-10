import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { JsonValue } from "@earendil-works/chord/json";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";

export interface ResticNativeExports {
  createResticTool(assertCurrent: () => void): ToolDefinition<any, JsonValue>;
}

/** Configuration only, against the existing startup service. No backup runner. */
export function createHostResticTool(addon: ResticNativeExports, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void;
}) {
  const definition = addon.createResticTool(() => { throw Error("Invocation-local Restic authority required"); });
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      if (!args || typeof args !== "object" || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null)) throw Error("Plain Restic arguments required");
      const params = structuredClone(args) as Record<string, unknown>;
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); }, params.action !== "set_config");
      authority.assertCurrent();
      const native = addon.createResticTool(authority.assertCurrent);
      const result = await native.execute(call.toolCallId, params, call.signal, undefined, undefined as never);
      authority.assertCurrent();
      return result;
    },
  });
}
