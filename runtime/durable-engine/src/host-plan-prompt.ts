import type { Database } from "bun:sqlite";
import { defineExtension, type GenerationHooks } from "@earendil-works/pi-durable";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { PlanPromptExports } from "./host-extension-catalog.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { createPlanKvAuthority } from "./host-plan-tool.js";

/** Request-only context: never invokes the legacy handler or writes transcript
 * entries. Each request refreshes mutable Plan state, including after tools. */
export function createHostPlanPrompt(addon: PlanPromptExports, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureRunSource">;
  assertOwner(): void;
  failClosed(error: unknown): void;
}) {
  const hooks: Pick<GenerationHooks, "beforeRequest"> = {
    async beforeRequest(request, api) {
      try {
        options.assertOwner();
        const captured = await options.runtime().captureRunSource(api.conversationId, api.taskId);
        const authority = createPlanKvAuthority(options.root, captured, options.assertOwner, true);
        return withExtensionKvAuthority(authority, () => {
          authority.assertCurrent();
          const plan = addon.loadSessionPlan(captured.operation.chatJid);
          const system = addon.buildPlanSystemPrompt(plan);
          const turn = addon.buildPlanTurnMessage(plan);
          authority.assertCurrent();
          return { messages: [...request.messages,
            ...(system ? [{ role: "system" as const, content: system, timestamp: 0 }] : []),
            ...(turn ? [{ role: "user" as const, content: turn.content, timestamp: 0 }] : []),
          ] };
        });
      } catch (error) {
        // SDK hook diagnostics must never turn missing provenance into an
        // unqualified provider dispatch. The shared model lifetime is fenced.
        options.failClosed(error);
        throw Error("Plan request authority unavailable");
      }
    },
  };
  return defineExtension({ name: "app.host-plan-prompt", hooks: [{ task: "pi.generation", handlers: hooks }] });
}
