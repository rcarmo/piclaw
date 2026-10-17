import type { ToolDefinition } from "../../../node_modules/@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import { defineTool, type ToolRegistration, type ConversationId, type TaskId } from "@earendil-works/pi-durable";

/** Host-owned, invocation-local port. No 1.2 session/context is stored by durable.
 * invoke MUST arrange assertAllowed immediately before each actual effect, after
 * any await, including effects inside execute. Passing a signal alone is not a
 * fence. Arbitrary registered tools are NOT qualified by this adapter.
 * The host binds its existing execution context, argument transforms and
 * keychain/env injection here; do not substitute durable coding tools.
 */
export interface HostToolEffectPort<P extends TSchema, D extends JsonValue> {
  readonly authority: { check(): void | boolean };
  /** Explicit host replay authorization, never inferred from readOnlyHint/name/callers. */
  readonly replay?: "safe" | "unsafe";
  readonly effectFence: "host-effect-port";
  invoke(args: Static<P>, call: {
    readonly toolCallId: string;
    readonly conversationId: ConversationId;
    readonly taskId: TaskId;
    readonly execute: ToolDefinition<P, D>["execute"];
    readonly assertAllowed: () => void;
    readonly signal: AbortSignal | undefined;
    readonly onUpdate: NonNullable<Parameters<ToolDefinition<P, D>["execute"]>[3]>;
  }): ReturnType<ToolDefinition<P, D>["execute"]>;
}

/** Bounded model-only bridge: JSON details and native text/image results.
 * SDK updates are replacement snapshots, not text deltas. Text is appended when
 * the new snapshot extends its predecessor; details are replaced and ACKed before
 * completion. Images are preserved in the final output, not streamed as text.
 * No structuredContent/outputSchema or nested-tool/context compatibility layer.
 */
export function createHostTool<P extends TSchema, D extends JsonValue>(
  tool: ToolDefinition<P, D>, host: HostToolEffectPort<P, D>,
): ToolRegistration<P, D> {
  if (tool.outputSchema || tool.reachesTools) throw new Error("Host bridge does not support structured or nested tools");
  if (host.effectFence !== "host-effect-port") throw new Error("Host effect port required");
  // Snapshot approved callbacks/schema: mutating the source tool cannot substitute code.
  let parameters: P;
  try { parameters = structuredClone(tool.parameters); }
  catch { throw new Error("Host tool registration unavailable"); }
  const execute = tool.execute.bind(tool);
  const prepare = tool.prepareArguments?.bind(tool);
  const checkAuthority = () => {
    let allowed: void | boolean;
    try { allowed = host.authority.check(); }
    catch { throw new Error("Host tool authority unavailable"); }
    if (allowed === false) throw new Error("Host tool permission denied");
  };
  return defineTool<P, D>({
    name: tool.name, description: tool.description, parameters,
    prepareArguments: prepare ? raw => {
      checkAuthority();
      try { return prepare(raw); }
      catch {
        checkAuthority();
        throw new Error("Host tool arguments failed");
      }
    } : undefined,
    executionMode: tool.executionMode,
    callers: ["model"], replay: host.replay ?? "unsafe",
    async execute(args, api, context) {
      let active = true;
      const assertAllowed = () => {
        if (!active) throw new Error("Host tool invocation ended");
        if (context.abortSignal?.aborted) throw new Error("Host tool permission denied");
        checkAuthority();
      };
      let text = "";
      let updates = Promise.resolve();
      let updateFailed = false;
      try {
        assertAllowed();
        const result = await host.invoke(args, {
          toolCallId: api.callId, conversationId: api.conversationId, taskId: api.taskId, execute,
          assertAllowed, signal: context.abortSignal,
          onUpdate(update) {
            assertAllowed();
            const next = update.content.filter(item => item.type === "text").map(item => item.text).join("");
            // Revisions cannot be represented by append-only output; final output
            // below remains authoritative, rather than appending duplicate snapshots.
            if (next.startsWith(text)) api.output(next.slice(text.length));
            text = next;
            updates = updates.then(async () => {
              assertAllowed();
              await api.details(update.details, context);
            }).catch(() => { updateFailed = true; });
          },
        });
        await updates;
        assertAllowed();
        if (updateFailed) throw new Error("Host tool execution failed");
        // Host-trusted JSON details stay UI-only; never promote them to output.
        return { output: result.content, details: result.details, isError: result.isError };
      } catch {
        // Never export exception messages, subclasses, fields or causes from host code.
        assertAllowed();
        throw new Error("Host tool execution failed");
      } finally {
        active = false;
      }
    },
  });
}
