import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import type { Database } from "bun:sqlite";
import { createHostTool, type HostToolEffectPort } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { JsonValue } from "@earendil-works/chord";

export interface RegretsNativeExports<P> {
  createLateNightRegrets(ports: P): { tool: ToolDefinition<any, JsonValue> };
}
/** Binding must supply real scoped history, RootKV and accounted model ports.
 * No SDK session/context or callback emulation is constructed here. */
export function createHostRegretsTool<P>(addon: RegretsNativeExports<P>, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void;
  definition: ToolDefinition<any, JsonValue>;
  bind(operation: Awaited<ReturnType<HostConversationRuntime["captureToolSource"]>>, authority: ReturnType<typeof createHostOperationAuthority>, call: Parameters<HostToolEffectPort<any, JsonValue>['invoke']>[1]): P;
}) {
  return createHostTool(options.definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      if (!args || typeof args !== "object" || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null) || Object.keys(args).length) throw Error("Regrets takes no arguments");
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); });
      authority.assertCurrent();
      const native = addon.createLateNightRegrets(options.bind(captured, authority, call));
      const result = await native.tool.execute(call.toolCallId, args, call.signal, undefined, undefined as never);
      authority.assertSourceCurrent(); // Reading this entered controller's result grants no next effect.
      return result;
    },
  });
}

import { createHostRegretsBindings, type HostRegretsBindingOptions } from "./host-regrets-bindings.js";
/** Concrete tool wiring. Commands/settings/prompt use separately supplied current
 * request authority with createHostRegretsBindings; never reuse a tool snapshot. */
export function createBoundHostRegretsTool<E>(addon: RegretsNativeExports<ReturnType<typeof createHostRegretsBindings<E>>> & {
  readExchanges: HostRegretsBindingOptions<E>["readExchanges"];
}, options: Omit<Parameters<typeof createHostRegretsTool<ReturnType<typeof createHostRegretsBindings<E>>>>[1], "bind"> & {
  bindings: Omit<HostRegretsBindingOptions<E>, "root" | "chat" | "assertCurrent" | "readExchanges" | "accountedDecision" | "transactionalWrite">;
  /** Per captured operation: parent may supply controller-owned accounting. */
  accountedDecision?(operation: Awaited<ReturnType<HostConversationRuntime["captureToolSource"]>>, authority: ReturnType<typeof createHostOperationAuthority>): HostRegretsBindingOptions<E>["accountedDecision"];
}) {
  return createHostRegretsTool(addon, { ...options,
    bind(operation, authority) {
      return createHostRegretsBindings({ ...options.bindings, root: options.root,
        chat: operation.operation.chatJid, assertCurrent: authority.assertCurrent, transactionalWrite: body => admitSqliteWrite(options.root, body, authority.assertCurrent),
        readExchanges: addon.readExchanges, accountedDecision: options.accountedDecision?.(operation, authority) });
    },
  });
}


import type { Extension, PromptInput } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
/** Per-request native API. Parent supplies currentOperation + Root bindings, not
 * discovery-time ports. In public SDK 1.3 the before-model surface is a section's
 * render(PromptInput, Context), not an Extension.beforeModelRequest property. */
export function createHostRegretsPromptExtension<P>(addon: {
  createLateNightRegrets(ports: P): { prompt(systemPrompt: string): string };
}, options: {
  bindBeforeModelRequest(input: PromptInput, context: Context): Promise<P>;
}): Extension {
  return { name: "late-night-regrets", sections: [{ key: "late-night-regrets", tag: false,
    async render(input, context) {
      const nativeApi = addon.createLateNightRegrets(await options.bindBeforeModelRequest(input, context));
      return nativeApi.prompt("") || undefined;
    },
  }] };
}
/** Accepted host commands only. `bind` must derive chat/authority from the
 * accepted command; admission is bundle.dispatch, never pi.sendUserMessage. */
export function createHostRegretsCommand<P, AcceptedCommand>(addon: {
  createLateNightRegrets(ports: P): { command(): Promise<unknown> };
}, bind: (command: AcceptedCommand) => Promise<P>) {
  return async (accepted: AcceptedCommand) => addon.createLateNightRegrets(await bind(accepted)).command();
}
/** Fixed-source exports let the parent bind all surfaces without importing the
 * legacy default extension or retaining a mutable invocation-local native API. */
export function createHostRegretsSettings<P, Patch>(addon: {
  createLateNightRegrets(ports: P): { settings: {
    config: { get(): unknown; set(patch: Patch): unknown };
    models: { get(): unknown };
  } };
}, bind: () => Promise<P>) {
  return {
    async getConfig() { return addon.createLateNightRegrets(await bind()).settings.config.get(); },
    async setConfig(patch: Patch) {
      return addon.createLateNightRegrets(await bind()).settings.config.set(patch);
    },
    async getModels() { return addon.createLateNightRegrets(await bind()).settings.models.get(); },
  };
}
