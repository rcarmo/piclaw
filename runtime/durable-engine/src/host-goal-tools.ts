import { admitSqliteWrite, type SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import type Database from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import type { JsonValue } from "@earendil-works/chord";
import type { ExtensionContext, ToolDefinition } from "../../src/durable-legacy-sdk.js";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { HostConversationRuntime } from "./host-runtime.js";

type GoalFactory = (resolveChat: (context: ExtensionContext) => string, policy?: { write<T>(body: SyncSqliteOperation<T>): Promise<T> }) => ToolDefinition<any, JsonValue>[];
const names = ["get_goal", "create_goal", "goal_complete", "goal_stop", "update_goal"];

/** The caller must qualify the exact installed factory before application adoption. */
export function createHostGoalTools(factory: GoalFactory, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource" | "readCapturedInputText">;
  resolveGoalInput(text: string, chat: string): { action: string };
  assertOwner(): void;
}) {
  const chatScope = new AsyncLocalStorage<string>();
  const writes = new AsyncLocalStorage<{ assertCurrent(): void; signal?: AbortSignal }>();
  const declarations = factory(() => {
    const chat = chatScope.getStore();
    if (!chat) throw Error("Goal chat authority unavailable");
    return chat;
  }, { write(body) {
    const authority = writes.getStore();
    if (!authority) throw Error("Goal write authority unavailable");
    return admitSqliteWrite(options.root, body, authority.assertCurrent, authority.signal);
  } });
  if (declarations.length !== names.length || new Set(declarations.map(tool => tool.name)).size !== names.length ||
    names.some(name => !declarations.some(tool => tool.name === name))) throw Error("Unqualified Goal tool set");
  return declarations.map(declaration => createHostTool(declaration, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, invocation) {
      if (!args || Object.getPrototypeOf(args) !== Object.prototype) throw Error("Plain Goal arguments required");
      const cloned = structuredClone(args);
      const runtime = options.runtime();
      const captured = await runtime.captureToolSource(invocation.conversationId, invocation.taskId, invocation.toolCallId);
      const texts = await runtime.readCapturedInputText(captured.inputs);
      const chatJid = captured.operation.chatJid;
      const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, declaration.name === "get_goal");
      return writes.run({ assertCurrent: authority.assertCurrent, signal: invocation.signal }, () => chatScope.run(chatJid, () => withExtensionKvAuthority({ extensionId: "goal", chatJid, assertCurrent: authority.assertCurrent, write: authority.write }, async () => {
        authority.assertCurrent();
        // A dispatched tool may outlive the request's input check. Revalidate
        // the original Goal identity immediately before executing its mutation;
        // an external terminal snapshot cannot become this operation's result.
        if (!texts.length || texts.some(text => options.resolveGoalInput(text, chatJid).action === "handled"))
          throw Error("Goal tool input lifecycle changed");
        const result = await invocation.execute(invocation.toolCallId, cloned as never, invocation.signal, undefined, undefined as never);
        authority.assertCurrent();
        return result as unknown as { content: never; details: JsonValue };
      })));
    },
  }, { callers: ["model"] }));
}
