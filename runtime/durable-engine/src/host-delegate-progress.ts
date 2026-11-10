import type { Conversation, ConversationView, ConversationWatch, LiveState, ModelRef } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { NativeDelegateProgress } from "../../src/agent-pool/delegate-progress.js";

/** Best-effort UI observer, never submission/settlement authority. Child text and
 * reasoning stay private; only bounded lifecycle metadata and text counts cross.
 */
export async function watchNativeDelegateProgress(child: Pick<Conversation, "watch">, options: {
  conversationId: number;
  model: ModelRef;
  startedAt: number;
  assertCurrent(): void;
  publish(progress: NativeDelegateProgress): Promise<void>;
}, context: Context) {
  let active = true, observing = true, watch: ConversationWatch | undefined;
  let previous = "", previousState = "", publishedAt = 0, responseChars = 0;
  let inFlight: Promise<void> = Promise.resolve();
  const elapsed = () => Math.min(86400, Math.max(0, Math.floor((Date.now() - options.startedAt) / 1000)));
  const make = (phase: NativeDelegateProgress["phase"], tools: string[] = []): NativeDelegateProgress => ({
    kind: "native_delegate_progress", conversationId: options.conversationId,
    model: `${options.model.provider}/${options.model.modelId}`, phase, tools,
    responseChars: Math.min(responseChars, 1_000_000_000), elapsedSeconds: elapsed(),
  });
  async function emit(progress: NativeDelegateProgress, force = false) {
    if (!active) return;
    try {
      options.assertCurrent(); context.abortSignal?.throwIfAborted();
      const signature = JSON.stringify(progress), state = JSON.stringify([progress.phase, progress.tools]);
      if (!force && (signature === previous || (state === previousState && Date.now() - publishedAt < 1000))) return;
      previous = signature; previousState = state; publishedAt = Date.now();
      await options.publish(progress);
      options.assertCurrent();
    } catch { active = false; } // Display failure cannot invalidate accepted child work.
  }
  async function update(view: ConversationView) {
    if (!observing || !active) return;
    const live = view.docs["pi.live"] as LiveState | undefined;
    const running = (live?.tools ?? []).filter(slot => slot.status !== "done");
    const names = [...new Set(running.map(slot => slot.name).filter(name => ["read", "grep", "find", "ls", "bash", "edit", "write"].includes(name)))].slice(0, 8);
    const textChars = (message: any) => message?.role === "assistant"
      ? (message.content ?? []).reduce((sum: number, part: any) => sum + (part.type === "text" && typeof part.text === "string" ? part.text.length : 0), 0) : 0;
    const committed = view.entries.reduce((sum, entry) => sum + (entry.model ?? []).reduce((n, message) => n + textChars(message), 0), 0);
    const lastAssistant = view.entries.flatMap(entry => entry.model ?? []).findLast(message => message.role === "assistant");
    const generationCommitted = lastAssistant && live?.generation?.message?.content &&
      lastAssistant.timestamp === live.generation.message.timestamp && JSON.stringify(lastAssistant.content) === JSON.stringify(live.generation.message.content);
    responseChars = Math.max(responseChars, committed + (generationCommitted ? 0 : textChars(live?.generation?.message)));
    const phase = names.length ? "tool" : live?.generation?.retry ? "retrying" : live?.generation ? "generating" : "working";
    await emit(make(phase, names));
  }
  await emit(make("starting"), true);
  try {
    if (active) {
      watch = await child.watch(context);
      await update(watch.value);
      watch.start(call => {if(call.kind==='failed'){active=false;return Promise.resolve();}return(inFlight=update(call.value));});
      void watch.closed.catch(() => { active = false; });
    }
  } catch { active = false; }
  async function detach() {
    observing = false;
    const current = watch; watch = undefined;
    try { await current?.stop(); await inFlight; } catch { /* Observer failure has no execution authority. */ }
  }
  return {
    async finish(chars: number) {
      await detach();
      responseChars = Math.max(responseChars, chars);
      await emit(make("done"), true);
    },
    async fail() { await detach(); await emit(make("failed"), true); },
    async stop() { active = false; await detach(); },
  };
}
