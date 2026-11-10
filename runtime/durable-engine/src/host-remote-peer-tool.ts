import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { JsonValue } from "@earendil-works/chord/json";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";

export interface RemotePeerNativeInvocation<Ports> {
  readonly chatJid: string;
  readonly cwd: string;
  assertCurrent(): void;
  readonly nativeHostPorts: Ports;
}
export interface RemotePeerNativeExports<Ports> {
  createRemotePeerTool(options: RemotePeerNativeInvocation<Ports>): ToolDefinition<any, JsonValue>;
}
/** Ports are application-owned and provisioned once. Inbound traffic MUST use a
 * new accepted host operation through the add-on's required application port;
 * this adapter deliberately does not lend a tool's authority to background work. */
export function createHostRemotePeerTool<Ports>(addon: RemotePeerNativeExports<Ports>, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void;
  cwd: string;
  nativeHostPorts: Ports;
}) {
  const definition = addon.createRemotePeerTool({ chatJid: "", cwd: options.cwd,
    assertCurrent() { throw Error("Invocation-local Remote Peer authority required"); },
    nativeHostPorts: options.nativeHostPorts });
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      if (!args || typeof args !== "object" || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null))
        throw Error("Plain Remote Peer arguments required");
      const params = structuredClone(args) as Record<string, unknown>;
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); });
      authority.assertCurrent();
      const native = addon.createRemotePeerTool({ chatJid: captured.operation.chatJid, cwd: options.cwd,
        assertCurrent: authority.assertCurrent, nativeHostPorts: options.nativeHostPorts });
      const result = await native.execute(call.toolCallId, params, call.signal, undefined, undefined as never);
      authority.assertCurrent();
      return result;
    },
  });
}
