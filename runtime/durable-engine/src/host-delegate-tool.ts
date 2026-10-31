import { AssistantEntry, configure, defineTool, type ModelRef, type ToolRegistration, type Extension } from "@earendil-works/pi-durable";
import { watchNativeDelegateProgress } from "./host-delegate-progress.js";
import { validateDelegateFiles } from "./host-delegate-files.js";
import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { HostConversationRuntime } from "./host-runtime.js";

/** Native foreground consumer of the actual registered Delegate declaration.
 * The legacy execute function and lifecycle handlers are deliberately never run.
 * Not a catalog exemption: installation still needs an independently qualified
 * source/registration profile and live host Settings/model approval port.
 */
export function createHostDelegateTool(definition: Pick<ToolDefinition<TSchema>, "name" | "description" | "parameters">, options: {
  assertCurrent(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource" | "assertCapturedSourceCurrent" | "watchOwnedDelegateChild">;
  /** Must use current host availability AND the real Delegate Settings approval
   * and ordered classification policy; never grants permission via arguments. */
  selectModel(args: Readonly<Record<string, unknown>>, parent: ModelRef | undefined): Promise<ModelRef>;
  /** Rechecked before creation and after settlement. Enabled budget caps must
   * deny until operation-owned child request accounting has been qualified. */
  assertModelCurrent(model: ModelRef): void;
  modelSupportsImages?(model: ModelRef): boolean;
  readFiles?(files: readonly string[], assertAllowed: () => void, options?: { modelSupportsImages: boolean }): Promise<readonly (TextContent | ImageContent)[]>;
  readonlyTools: readonly ToolRegistration[];
  /** Installed, hook-free read-only capability extensions only. */
  readonlyExtensions: readonly Extension[];
  /** Same guarded host registrations; never add-on/MCP or recursive tools. */
  standardTools?: readonly ToolRegistration[];
  standardExtensions?: readonly Extension[];
}) {
  if (definition.name !== "delegate") throw Error("Expected registered Delegate tool");
  const { assertCurrent, runtime, selectModel, assertModelCurrent, readFiles } = options;
  const readers = [...options.readonlyTools];
  const extensions = [...options.readonlyExtensions];
  if (extensions.some(extension => extension.hooks?.length || extension.sections?.length || extension.tools?.some(tool => !readers.includes(tool))))
    throw Error("Native Delegate child extensions must contain only approved readers");
  if (readers.some(tool => !["read", "grep", "find", "ls"].includes(tool.name)) || new Set(readers.map(tool => tool.name)).size !== readers.length)
    throw Error("Native Delegate requires read-only host builtins");
  const standard = [...(options.standardTools ?? [])];
  const standardExtensions = [...(options.standardExtensions ?? [])];
  if (standard.some(tool => !["read", "bash", "edit", "write", "find", "ls", "grep"].includes(tool.name)) || new Set(standard.map(tool => tool.name)).size !== standard.length)
    throw Error("Native Delegate requires standard host builtins only");
  if (standardExtensions.some(extension => extension.hooks?.length || extension.sections?.length || extension.tools?.some(tool => !standard.includes(tool))))
    throw Error("Native Delegate child extensions must contain only approved standard tools");
  return defineTool({ name: definition.name, description: definition.description, parameters: definition.parameters,
    callers: ["model"], replay: "safe", executionMode: "parallel",
    async execute(input, api, context) {
      assertCurrent();
      const args = structuredClone(input) as Record<string, unknown>;
      const supported = ["prompt", "model", "tools", "task_category", "system_prompt", "files", "timeout_sec"];
      if (Object.keys(args).some(key => !supported.includes(key))) throw Error("Unsupported native Delegate option");
      if (typeof args.prompt !== "string" || !args.prompt.trim()) throw Error("Delegate prompt required");
      if (args.model !== undefined) {
        if (typeof args.model !== "string") throw Error("Delegate model must be an exact provider/model ID");
        const slash = args.model.indexOf("/");
        if (slash <= 0 || slash === args.model.length - 1) throw Error("Delegate model must be an exact provider/model ID");
      }
      // Keep the installed declaration's default and bounds even for synthetic
      // schemas: reject invalid input before allocating any child.
      if (args.files !== undefined) {
        validateDelegateFiles(args.files);
        if (args.files.length && !readFiles) throw Error("Delegate attachment unavailable");
      }
      const timeout = args.timeout_sec === undefined ? 120 : args.timeout_sec;
      if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 10 || timeout > 300) throw Error("Delegate timeout_sec must be an integer from 10 to 300");
      const readOnly = args.tools === undefined || args.tools === "read_only";
      const approved = readOnly ? readers : standard.length ? standard : readers;
      const names = readOnly ? readers.map(tool => tool.name) : args.tools === "standard" ? standard.map(tool => tool.name)
        : typeof args.tools === "string" ? args.tools.split(",").map(name => name.trim()).filter(Boolean) : [];
      if (args.tools === "full" || !names.length || names.some(name => !approved.some(tool => tool.name === name))) throw Error("Native Delegate supports approved host builtins only; full is not qualified");
      const childExtensions = readOnly || !standard.length ? extensions : standardExtensions;
      if (args.system_prompt !== undefined && typeof args.system_prompt !== "string") throw Error("Invalid Delegate system prompt");
      // Operation-entry budget includes host source/model approval awaits. Task
      // memo preserves absolute expiry across replay; approval cannot renew it.
      const deadline = await api.memo("deadline", Date.now() + timeout * 1000, context);
      const expired = () => Date.now() >= deadline;
      const timeoutError = () => Error(`Delegate timed out after ${timeout}s`);
      const captured = await runtime().captureToolSource(api.conversationId, api.taskId, api.callId);
      const parent = await api.agent(context);
      const proposed = await selectModel(args, parent.model);
      const model = await api.memo("model", proposed, context);
      const check = () => { assertCurrent(); runtime().assertCapturedSourceCurrent(captured.inputs, true); assertModelCurrent(model); };
      check();
      const requestId = `delegate:${api.taskId}`;
      // Reconcile accepted work before touching files. Public SDK request-ID
      // deduplication retains accepted content (including queued input).
      const owned = await api.commit(async tx => {
        check();
        const prior = await tx.scanConversations({ ownerTaskId: api.taskId }, 2);
        if (prior.next || prior.items.length > 1) throw Error("Ambiguous Delegate child ownership");
        const child = prior.items[0];
        return child ? { id: child.id, submission: await tx.submissionByRequest(child.id, requestId) } : undefined;
      }, context);
      const assertReadAllowed = () => { check(); if (expired()) throw timeoutError(); };
      let content: string | (TextContent | ImageContent)[] = args.prompt;
      if (!owned?.submission && Array.isArray(args.files) && args.files.length) {
        assertReadAllowed();
        const modelSupportsImages = options.modelSupportsImages?.(model) === true;
        const guard = () => {
          assertReadAllowed();
          if (modelSupportsImages && options.modelSupportsImages?.(model) !== true) throw Error("Delegate attachment unavailable");
        };
        let attachments: readonly (TextContent | ImageContent)[];
        try { attachments = await readFiles!(args.files as string[], guard, { modelSupportsImages }); }
        catch { assertReadAllowed(); throw Error("Delegate attachment unavailable"); }
        assertReadAllowed();
        content = [{ type: "text", text: args.prompt }, ...attachments];
      }
      const childId = owned?.id ?? await api.commit(async tx => {
        check();
        const prior = await tx.scanConversations({ ownerTaskId: api.taskId }, 2);
        if (prior.next || prior.items.length > 1) throw Error("Ambiguous Delegate child ownership");
        if (prior.items[0]) return prior.items[0].id;
        if (expired()) throw timeoutError();
        const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
        const tools = approved.filter(tool => names.includes(tool.name));
        // No parent history, recursive delegation, Plan prompt or legacy hooks.
        // Registry-wide host source hooks remain active independently.
        await configure(tx, child.id, { model, tools, modelTools: tools, extensions: childExtensions,
          thinkingLevel: parent.thinkingLevel, instructions: typeof args.system_prompt === "string" ? args.system_prompt : "Complete the self-contained task using the selected tools." });
        check();
        return child.id;
      }, context);
      const child = await api.conversation(childId, context);
      if (!child) throw Error("Missing owned Delegate child");
      check();
      const progress = await watchNativeDelegateProgress({ watch: ctx => runtime().watchOwnedDelegateChild(api.conversationId, api.taskId, api.callId, childId, ctx) }, { conversationId: childId, model,
        startedAt: deadline - timeout * 1000, assertCurrent: check,
        publish: value => api.details(value, context),
      }, context);
      try {
        // A committed answer survives a late replay. Otherwise an expired replay
        // never submits new work, including the create-before-submit crash gap.
        const prior = owned?.submission ?? await api.commit(tx => tx.submissionByRequest(childId, requestId), context);
        let settled;
        if (prior?.status === "done") settled = prior;
        else {
          if (expired()) { await child.abort(context); throw timeoutError(); }
          const submission = await child.submit({ type: "input", requestId, content }, context);
          const waiting = submission.wait(context);
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            settled = await Promise.race([waiting, new Promise<undefined>(resolve => {
              timer = setTimeout(() => resolve(undefined), Math.max(0, deadline - Date.now()));
            })]);
            if (!settled) {
              // wait() cancellation only detaches the waiter. Stop this exact
              // dedicated ownership scope and join before the parent continues.
              // Cooperative providers must honour abort; this is not a hard kill.
              await child.abort(context);
              await waiting;
              throw timeoutError();
            }
          } finally { clearTimeout(timer); }
        }
        check();
        if (settled.type !== "input" || settled.status !== "done") throw Error("Native Delegate child did not complete");
        const answer = await api.commit(tx => tx.entry(AssistantEntry, settled.answer), context);
        const message = answer?.model?.[0];
        if (answer?.conversationId !== childId || message?.role !== "assistant" || (message.stopReason !== "stop" && message.stopReason !== "length")) throw Error("Missing committed Delegate answer");
        const text = message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("");
        if (text.length > 50_000) throw Error("Delegate answer exceeds native output bound");
        await progress.finish(text.length);
        check();
        return { output: [{ type: "text", text }] };
      } catch (error) {
        await progress.fail();
        throw error;
      } finally { await progress.stop(); }
    },
  });
}
