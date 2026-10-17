import { createBashTool, type BashToolOptions } from "../../../node_modules/@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import { createTrackedBashOperations, type TrackedBashOperationsOptions } from "../../../runtime/src/tools/tracked-bash.ts";

/** Opt-in local tracked-bash port only. Does not qualify arbitrary tools, SSH,
 * context-output persistence or the untouched public SDK local backend.
 * A fresh tool/operations closure is bound per invocation, never globally.
 */
export function createHostBashTool(options: {
  cwd: string;
  authority: { assertAllowed(): void };
  shellPath?: TrackedBashOperationsOptions["shellPath"];
  toolOptions?: Omit<BashToolOptions, "operations" | "shellPath">;
  captureSourceGuard?: (call: { conversationId: import("@earendil-works/pi-durable").ConversationId; taskId: import("@earendil-works/pi-durable").TaskId; toolCallId: string }) => Promise<() => void>;
}) {
  const schema = createBashTool(options.cwd, options.toolOptions);
  return defineTool({
    name: schema.name, description: schema.description, parameters: schema.parameters,
    structuredOutputSchema: schema.outputSchema,
    callers: ["model"], replay: "unsafe",
    async execute(args, api, context) {
      const sourceGuard = options.captureSourceGuard
        ? await options.captureSourceGuard({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId })
        : undefined;
      let active = true;
      let progressFailed = false;
      const controller = new AbortController();
      const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, controller.signal]) : controller.signal;
      const failProgress = () => {
        progressFailed = true;
        controller.abort(new Error("Bash execution failed"));
      };
      const assertAllowed = () => {
        if (!active || progressFailed || signal.aborted) throw new Error("Bash execution no longer authorized");
        try { options.authority.assertAllowed(); sourceGuard?.(); }
        catch { throw new Error("Bash execution no longer authorized"); }
      };
      const tool = createBashTool(options.cwd, {
        ...options.toolOptions,
        operations: createTrackedBashOperations({
          shellPath: options.shellPath,
          validateSpawn: () => { assertAllowed(); return true; },
        }),
      });
      let text = "";
      let updates = Promise.resolve();
      try {
        assertAllowed();
        const result = await tool.execute(api.callId, args, signal, update => {
          if (progressFailed || !active) return;
          try {
            assertAllowed();
            const next = update.content.filter(item => item.type === "text").map(item => item.text).join("");
            if (next.length > text.length && next.startsWith(text)) api.output(next.slice(text.length));
            text = next;
            // Output may revoke authority synchronously. Do not ACK it afterward.
            assertAllowed();
            updates = updates.then(async () => {
              if (progressFailed || !active) return;
              assertAllowed();
              await api.details((update.details ?? null) as JsonValue, context);
            }).catch(() => { failProgress(); });
          } catch {
            failProgress();
          }
        });
        await updates;
        if (progressFailed) throw new Error("Bash execution failed");
        assertAllowed();
        return { output: result.content, details: result.details as JsonValue | undefined,
          structuredOutput: result.structuredContent as JsonValue | undefined, isError: result.isError };
      } catch {
        await updates;
        if (progressFailed) throw new Error("Bash execution failed");
        assertAllowed();
        throw new Error("Bash execution failed");
      } finally { active = false; }
    },
  });
}
