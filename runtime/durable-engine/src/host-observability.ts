import type { Database } from "bun:sqlite";
import { defineExtension, type GenerationHooks } from "@earendil-works/pi-durable";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";

export interface ObservabilityNativeExports {
  createNativeTelemetryContext(): import("@earendil-works/pi-telemetry").TelemetrySpan;
  shutdownObservabilityRuntime(): Promise<void>;
  prepareObservabilityRuntime(assertCurrent: () => void): Promise<void>;
  buildObservabilitySystemPrompt(): string;
  bindObservabilityConfiguration(port: { assertCurrent(): void; read(): Record<string, unknown> | null; write(config: unknown): void | Promise<void> }): () => void;
}

/** Refresh request context through the SDK hook, never a legacy session event. */
export function createHostObservabilityPrompt(addon: ObservabilityNativeExports, options: {
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
        const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, true);
        authority.assertCurrent();
        // The installed module reads its single owner-fenced configuration port.
        const content = addon.buildObservabilitySystemPrompt();
        authority.assertCurrent();
        return { messages: [...request.messages, { role: "system" as const, content, timestamp: 0 }] };
      } catch (error) {
        options.failClosed(error);
        throw Error("Observability request authority unavailable");
      }
    },
  };
  return defineExtension({ name: "app.host-observability", hooks: [{ task: "pi.generation", handlers: hooks }] });
}
