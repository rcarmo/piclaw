import { isNativeMessageInput, type AcceptedInput, HostConversationRuntime } from "./host-runtime.js";

/** Recover progress solely from the exact accepted submission's public committed
 * answer and tool receipts. No message_end memory or caller-supplied tool flag. */
export function createHostGoalProgressReader(addon: { isGoalProgressTool(name: unknown): boolean }, options: {
  runtime(): Pick<HostConversationRuntime, "reconcile" | "readSettledToolNames" | "readMessageResult">;
  assertOwner(): void;
}) {
  return async (input: AcceptedInput) => {
    const captured = Object.freeze({ ...input });
    options.assertOwner();
    const runtime = options.runtime();
    const state = isNativeMessageInput(captured) ? await runtime.readMessageResult(captured) : await runtime.reconcile(captured);
    options.assertOwner();
    if (!state?.answer) throw Error("Committed Goal answer required");
    const names = await runtime.readSettledToolNames(captured);
    options.assertOwner();
    if (!names) throw Error("Committed Goal tool window required");
    return { message: structuredClone(state.answer.message), hadToolActivity: names.some(name => addon.isGoalProgressTool(name)) };
  };
}
