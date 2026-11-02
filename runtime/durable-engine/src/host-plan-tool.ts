import { admitSqliteWrite, type SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { TSchema } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import { withExtensionKvAuthority, type ExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import { createHostTool } from "./host-tools.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";

type Capture = Awaited<ReturnType<HostConversationRuntime["captureToolSource"]>>;
/** Host-private constructor: capture MUST come from captureToolSource, not arguments. */
export function createPlanKvAuthority(root: Database, captured: Capture, assertAllowed: () => void, readonly = false): ExtensionKvAuthority {
  return Object.freeze({ chatJid: captured.operation.chatJid, extensionId: "plan-sidebar",
    ...createHostOperationAuthority(root, captured, assertAllowed, readonly) });
}

/** Actual registered Plan tool only. Lifecycle/config HTTP ports remain blocked.
 * Runtime is late-bound to break registry -> harness -> runtime construction.
 * No public SDK/session emulator, ambient busy-chat inference, or global swaps. */
export function createHostPlanTool(definition: ToolDefinition<TSchema, JsonValue>, options: {
  root: Database;
  assertOwner(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  createTool: (write: <T>(body: SyncSqliteOperation<T>) => Promise<T>) => ToolDefinition<any, any, any>;
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
        const execute = options.createTool(body => admitSqliteWrite(options.root, body, authority.assertCurrent, call.signal)).execute;
        return execute(call.toolCallId, { ...params, chat_jid: chatJid }, call.signal, call.onUpdate, undefined as never);
      });
    },
  }, { callers: ["model", "tools"] });
}
