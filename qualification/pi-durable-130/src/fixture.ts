import { BACKGROUND_CONTEXT as context, awaitWithContext, withAbortSignal } from "../../../runtime/durable-engine/qualification/context.ts";
import { Type, createModels, createProvider, type AssistantMessage, type Model } from "../../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../../runtime/durable-engine/qualification/event-stream.ts";
import { AssistantEntry, Harness, MemoryStorage, createRegistry, defineExtension, defineTool, type Submission, type Storage } from "../../../runtime/durable-engine/qualification/durable.ts";
import { hashCanonicalRequest, type EffectIdentity } from "../../../runtime/src/service-effects/contracts/common.js";

export { context };
export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

// Synthetic host authority; a boolean is NOT an exclusive owner/lease implementation.
// Storage factory runs behind the fence, before constructing any file-backed resource.
export async function openFixture(owner: { acquired: boolean }, allocated = () => {}, openStorage?: () => Promise<Storage>) {
  if (!owner.acquired) throw new Error("Host owner must be acquired before open");
  allocated(); // All candidate resources are constructed AFTER the owner fence.
  const host = {
    modelAllowed: true, toolAllowed: true, modelCalls: 0, effects: 0, credentialLookups: 0,
    admissions: [] as EffectIdentity[], denials: [] as string[],
    transcripts: [] as string[],
    modelHold: undefined as ReturnType<typeof barrier> | undefined,
    onModelEnter: undefined as ((signal?: AbortSignal) => void) | undefined,
    finalContent: undefined as AssistantMessage["content"] | undefined,
    toolHold: undefined as ReturnType<typeof barrier> | undefined,
    toolEntered: barrier(),
  };
  function gate(kind: "model" | "tool", key: string, payload: { [key: string]: string }) {
    if (!owner.acquired || !(kind === "model" ? host.modelAllowed : host.toolAllowed)) {
      host.denials.push(kind);
      throw new Error(`Host denied ${kind}`);
    }
    host.admissions.push({ idempotencyKey: key, requestHash: hashCanonicalRequest(payload),
      operationId: "synthetic-operation", sourceSeq: 1, provenanceRef: "synthetic:qualification", redactionClass: "private" });
  }
  const tool = defineTool({
    name: "host_effect", description: "Synthetic host counter only", callers: ["model"], replay: "unsafe",
    parameters: Type.Object({ value: Type.String() }),
    execute: async (args, api, callContext) => {
      host.toolEntered.release();
      if (host.toolHold) await awaitWithContext(host.toolHold.promise, callContext);
      // Current host permission, not the phase's captured tool selection. No await after admission.
      gate("tool", `tool:${api.taskId}:${api.callId}`, args);
      host.effects++;
      return { output: [{ type: "text", text: "synthetic effect committed" }] };
    },
  });
  const extension = defineExtension({ name: "qualification", tools: [tool] });
  const registry = createRegistry();
  registry.install(extension);
  const model: Model<"openai-completions"> = {
    id: "synthetic", name: "Synthetic", provider: "qualification", api: "openai-completions", baseUrl: "https://invalid.invalid",
    reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let attempt = 0;
  const stream = (_model: unknown, transcript: { messages: readonly { role: string; content: unknown }[] }, options?: { signal?: AbortSignal }) => {
    host.transcripts.push(JSON.stringify(transcript.messages));
    host.onModelEnter?.(options?.signal); // Synchronous provider entry, before any synthetic hold or admission.
    const output = new AssistantMessageEventStream();
    void (async () => {
      let message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], stopReason: "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      try {
        const requestContext = options?.signal ? withAbortSignal(options.signal, context) : context;
        if (host.modelHold) await awaitWithContext(host.modelHold.promise, requestContext);
        options?.signal?.throwIfAborted();
        gate("model", `model:${++attempt}`, { transcript: JSON.stringify(transcript.messages) });
        host.modelCalls++;
        // Imported conversations may append a tool-catalog system entry after
        // input. Select the last dialogue message, not that metadata entry.
        const last = transcript.messages.findLast(message => message.role !== "system");
        const callsTool = last?.role === "user" && JSON.stringify(last.content).includes("use-tool");
        message = { ...message, stopReason: callsTool ? "toolUse" : "stop", content: callsTool
          ? [{ type: "toolCall", id: `call-${attempt}`, name: "host_effect", arguments: { value: "synthetic" } }]
          : host.finalContent ?? [{ type: "text", text: "synthetic answer" }] };
        output.push({ type: "done", reason: message.stopReason as "toolUse" | "stop", message });
      } catch (error) {
        message = { ...message, stopReason: "error", errorMessage: String(error) };
        output.push({ type: "error", reason: "error", error: message });
      }
      output.end();
    })();
    return output;
  };
  const denyCredentialLookup = async (): Promise<never> => {
    host.credentialLookups++;
    throw new Error("Qualification forbids environment/file credential resolution");
  };
  const models = createModels({ authContext: { env: denyCredentialLookup, fileExists: denyCredentialLookup } });
  models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "Synthetic keyless", resolve: async () => ({ auth: {}, source: "synthetic" }) } },
    api: { stream, streamSimple: stream },
  }));
  const reports: unknown[] = [];
  const storage = openStorage ? await openStorage() : new MemoryStorage();
  const harness = await Harness.open(storage, { models, registry,
    settings: { retry: { enabled: false }, compaction: { enabled: false } }, onReport: error => reports.push(error),
  }, context);
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension], tools: [tool] } });
  const accepted = new Map<string, { hash: string; submission: Promise<Submission> }>();
  function submit(requestId: string, content: string) {
    if (!owner.acquired) throw new Error("Host owner lost");
    const hash = hashCanonicalRequest({ type: "input", requestId, content });
    const prior = accepted.get(requestId);
    if (prior && prior.hash !== hash) throw new Error("Host requestId content conflict");
    if (prior) return prior.submission;
    const submission = root.submit({ type: "input", requestId, content }, context);
    accepted.set(requestId, { hash, submission });
    return submission;
  }
  async function settlement(submission: Submission) {
    // Only committed public status and entry evidence. Not watch delivery, and NOT EF-S02.
    // commit() is a serialized transaction, not a passive observer; its callback only reads.
    const status = await submission.status(context);
    if (status.type !== "input" || status.status !== "done") throw new Error("No committed answer");
    const answer = await root.commit(tx => tx.entry(AssistantEntry, status.answer), context);
    if (!answer || answer.conversationId !== root.id) throw new Error("Missing committed answer entry");
    return { status, answer };
  }
  return { owner, host, harness, storage, root, models, registry, submit, settlement, reports, close: () => harness.close(context) };

}
