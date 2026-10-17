import { AssistantEntry, configure, defineTool, type ModelRef, type ToolRegistration, type Extension } from "@earendil-works/pi-durable";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "../../../node_modules/@earendil-works/pi-coding-agent";
import type { HostConversationRuntime } from "./host-runtime.js";

/** Native foreground consumer of the actual registered Delegate declaration.
 * The legacy execute function and lifecycle handlers are deliberately never run.
 * Not a catalog exemption: installation still needs an independently qualified
 * source/registration profile and live host Settings/model approval port.
 */
export function createHostDelegateTool(definition: Pick<ToolDefinition<TSchema>, "name" | "description" | "parameters">, options: {
  assertCurrent(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource" | "assertCapturedSourceCurrent">;
  /** Must use current host availability AND the real Delegate Settings approval
   * and ordered classification policy; never grants permission via arguments. */
  selectModel(args: Readonly<Record<string, unknown>>, parent: ModelRef | undefined): Promise<ModelRef>;
  /** Rechecked before creation and after settlement. Enabled budget caps must
   * deny until operation-owned child request accounting has been qualified. */
  assertModelCurrent(model: ModelRef): void;
  readonlyTools: readonly ToolRegistration[];
  /** Installed, hook-free read-only capability extensions only. */
  readonlyExtensions: readonly Extension[];
}) {
  if (definition.name !== "delegate") throw Error("Expected registered Delegate tool");
  const { assertCurrent, runtime, selectModel, assertModelCurrent } = options;
  const readers = [...options.readonlyTools];
  const extensions = [...options.readonlyExtensions];
  if (extensions.some(extension => extension.hooks?.length || extension.sections?.length || extension.tools?.some(tool => !readers.includes(tool))))
    throw Error("Native Delegate child extensions must contain only approved readers");
  if (readers.some(tool => !["read", "grep", "find", "ls"].includes(tool.name)) || new Set(readers.map(tool => tool.name)).size !== readers.length)
    throw Error("Native Delegate requires read-only host builtins");
  return defineTool({ name: definition.name, description: definition.description, parameters: definition.parameters,
    callers: ["model"], replay: "safe", executionMode: "parallel",
    async execute(input, api, context) {
      assertCurrent();
      const args = structuredClone(input) as Record<string, unknown>;
      const supported = ["prompt", "model", "tools", "task_category", "system_prompt", "files", "timeout_sec"];
      if (Object.keys(args).some(key => !supported.includes(key))) throw Error("Unsupported native Delegate option");
      if (typeof args.prompt !== "string" || !args.prompt.trim()) throw Error("Delegate prompt required");
      // The first native profile has no attachment or deadline port yet. Explicit
      // rejection is mandatory: never silently drop a legacy schema option.
      if (args.files !== undefined && (!Array.isArray(args.files) || args.files.length)) throw Error("Native Delegate attachments are not qualified");
      if (args.timeout_sec !== undefined) throw Error("Native Delegate deadlines are not qualified");
      const names = args.tools === undefined || args.tools === "read_only" ? readers.map(tool => tool.name)
        : typeof args.tools === "string" ? args.tools.split(",").map(name => name.trim()).filter(Boolean) : [];
      if (!names.length || names.some(name => !readers.some(tool => tool.name === name))) throw Error("Native Delegate supports read-only tools only");
      if (args.system_prompt !== undefined && typeof args.system_prompt !== "string") throw Error("Invalid Delegate system prompt");
      const captured = await runtime().captureToolSource(api.conversationId, api.taskId, api.callId);
      const parent = await api.agent(context);
      const proposed = await selectModel(args, parent.model);
      const model = await api.memo("model", proposed, context);
      const check = () => { assertCurrent(); runtime().assertCapturedSourceCurrent(captured.inputs); assertModelCurrent(model); };
      check();
      const childId = await api.commit(async tx => {
        check();
        const prior = await tx.scanConversations({ ownerTaskId: api.taskId }, 2);
        if (prior.next || prior.items.length > 1) throw Error("Ambiguous Delegate child ownership");
        if (prior.items[0]) return prior.items[0].id;
        const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
        const tools = readers.filter(tool => names.includes(tool.name));
        // No parent history, recursive delegation, Plan prompt or legacy hooks.
        // Registry-wide host source hooks remain active independently.
        await configure(tx, child.id, { model, tools, modelTools: tools, extensions,
          thinkingLevel: parent.thinkingLevel, instructions: typeof args.system_prompt === "string" ? args.system_prompt : "Complete the self-contained task using read-only tools." });
        check();
        return child.id;
      }, context);
      await api.details({ conversationId: childId }, context);
      const child = await api.conversation(childId, context);
      if (!child) throw Error("Missing owned Delegate child");
      check();
      const submission = await child.submit({ type: "input", requestId: `delegate:${api.taskId}`, content: args.prompt }, context);
      const settled = await submission.wait(context);
      check();
      if (settled.type !== "input" || settled.status !== "done") throw Error("Native Delegate child did not complete");
      const answer = await api.commit(tx => tx.entry(AssistantEntry, settled.answer), context);
      const message = answer?.model?.[0];
      if (answer?.conversationId !== childId || message?.role !== "assistant" || (message.stopReason !== "stop" && message.stopReason !== "length")) throw Error("Missing committed Delegate answer");
      const text = message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("");
      if (text.length > 50_000) throw Error("Delegate answer exceeds native output bound");
      return { output: [{ type: "text", text }] };
    },
  });
}
