import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../../node_modules/@earendil-works/pi-coding-agent";
import type { TSchema } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import { withExtensionKvAuthority, type ExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import { createHostTool } from "./host-tools.js";
import type { HostConversationRuntime } from "./host-runtime.js";

type Capture = Awaited<ReturnType<HostConversationRuntime["captureToolSource"]>>;
/** Host-private constructor: capture MUST come from captureToolSource, not arguments. */
export function createPlanKvAuthority(root: Database, captured: Capture, assertAllowed: () => void, readonly = false): ExtensionKvAuthority {
  const { operation, inputs } = captured;
  const chatJid = operation.chatJid;
  if (!readonly && !operation.harness) throw Error("Bound Plan harness required for writes");
  const assertCurrent = () => {
    assertAllowed();
    const current = readonly ? root.query(`SELECT 1 FROM service_effect_s01_operations o
      JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
      WHERE o.operation_id=? AND o.chat_jid=? AND o.version=? AND o.phase='executing'
      AND o.cancellation_source_id IS NULL`).get(operation.operationId, chatJid, operation.version)
      : root.query(`SELECT 1 FROM service_effect_s01_operations o
      JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
      WHERE o.operation_id=? AND o.chat_jid=? AND o.version=? AND o.phase='executing'
      AND o.cancellation_source_id IS NULL AND o.harness_state='running'
      AND o.harness_operation_id=? AND o.harness_session_id=? AND o.harness_lane=? AND o.harness_watch_generation=?`)
      .get(operation.operationId, chatJid, operation.version, operation.harness!.harnessOperationId,
        operation.harness!.sessionId, operation.harness!.lane, operation.harness!.watchGeneration);
    if (!current) throw Error("Stale Plan operation authority");
    if (readonly && operation.harness && !root.query(`SELECT 1 FROM service_effect_s01_operations
      WHERE operation_id=? AND harness_state='running' AND harness_operation_id=? AND harness_session_id=?
      AND harness_lane=? AND harness_watch_generation=?`).get(operation.operationId, operation.harness.harnessOperationId,
        operation.harness.sessionId, operation.harness.lane, operation.harness.watchGeneration))
      throw Error("Stale Plan harness authority");
    for (const input of inputs) {
      const source = root.query(`SELECT 1 FROM service_effect_s01_sources s
        JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
        WHERE os.operation_id=? AND s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.state='claimed'`)
        .get(operation.operationId, chatJid, input.sourceSeq, input.sourceId, input.payloadRef);
      if (!source) throw Error("Stale Plan source authority");
    }
  };
  return Object.freeze({ chatJid, extensionId: "plan-sidebar", assertCurrent,
    write: <T>(body: () => T): T => {
      if (readonly) throw Error("Read-only Plan authority");
      return root.transaction(() => {
        assertCurrent(); const result = body(); assertCurrent(); return result;
      }).immediate();
    },
  });
}

/** Actual registered Plan tool only. Lifecycle/config HTTP ports remain blocked.
 * Runtime is late-bound to break registry -> harness -> runtime construction.
 * No public SDK/session emulator, ambient busy-chat inference, or global swaps. */
export function createHostPlanTool(definition: ToolDefinition<TSchema, JsonValue>, options: {
  root: Database;
  assertOwner(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
}) {
  if (definition.name !== "plan") throw Error("Expected registered Plan tool");
  return createHostTool(definition, {
    authority: { check: () => options.assertOwner() }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      // Clone only validated plain data, BEFORE the first await. In particular,
      // never spread unknown input or retain a caller-owned mutable object.
      const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
      if (!plain(args)) throw new TypeError("Expected plain Plan arguments");
      const params: unknown = structuredClone(args);
      if (!plain(params)) throw new TypeError("Expected plain Plan arguments");
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      call.assertAllowed();
      const { operation } = captured;
      const chatJid = operation.chatJid;
      const explicit = params.chat_jid;
      if (explicit !== undefined && explicit !== chatJid) throw Error("Cross-chat Plan override denied");
      const authority = createPlanKvAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); });
      return withExtensionKvAuthority(authority, () => {
        authority.assertCurrent();
        return call.execute(call.toolCallId, { ...params, chat_jid: chatJid }, call.signal, call.onUpdate, undefined as never);
      });
    },
  });
}
