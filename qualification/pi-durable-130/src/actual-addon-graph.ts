import { expect } from "bun:test";
import { join } from "node:path";
import { createModels, createProvider, type AssistantMessage, type Model, type TranscriptContext, type TSchema } from "../../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../../runtime/durable-engine/qualification/event-stream.ts";
import { AssistantEntry, Harness, createRegistry, defineExtension, type ToolRegistration } from "../../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../../runtime/durable-engine/qualification/sqlite.ts";
import type { JsonValue } from "../../../runtime/durable-engine/qualification/chord.ts";
import { BACKGROUND_CONTEXT as context } from "../../../runtime/durable-engine/qualification/context.ts";
import { BunSqliteDatabase } from "../../../runtime/durable-engine/src/index.js";

/** Qualification-only keyless provider; actual registered host tools, public graph. */
export async function actualAddonGraph(dir: string, tools: ToolRegistration<TSchema, JsonValue>[], invocations: () => number, revoke: () => void, serviceData: () => unknown, delegate = false) {
  const extension = defineExtension({ name: "actual-addon-services", tools });
  const registry = createRegistry(); registry.install(extension);
  const model: Model<"openai-completions"> = { provider: "synthetic-addons", id: "keyless", name: "Synthetic add-ons", api: "openai-completions",
    baseUrl: "https://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let modelCalls = 0, credentialReads = 0;
  const requests: TranscriptContext[] = [];
  const stream = (_model: unknown, request: TranscriptContext) => {
    modelCalls++; requests.push(structuredClone(request));
    if (modelCalls === 1) expect(request.messages.flatMap(message => "toolsAdded" in message ? message.toolsAdded ?? [] : []).map(tool => tool.name).sort()).toEqual(delegate ? ["delegate"] : ["code_review", "remote_peer"]);
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: modelCalls < (delegate ? 2 : 3) ? "toolUse" : "stop",
      // The pinned public tool exposes dispatches, NOT the runtime-only list action.
      content: delegate ? (modelCalls === 1 ? [{ type: "toolCall", id: "delegate-call", name: "delegate", arguments: { prompt: "synthetic child task", model: "github-copilot/gpt-6.1-sol", tools: "read" } }] : [{ type: "text", text: "synthetic delegate complete" }]) : modelCalls === 1 ? [{ type: "toolCall", id: "review-list", name: "code_review", arguments: { action: "dispatches", limit: 10 } }]
        : modelCalls === 2 ? [{ type: "toolCall", id: "peer-status", name: "remote_peer", arguments: { action: "status" } }]
        : [{ type: "text", text: "No assigned reviews; remote peer disabled." }] };
    if (modelCalls > 3) throw Error("Unexpected provider replay");
    const output = new AssistantMessageEventStream();
    output.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); output.end(); return output;
  };
  const noCredentials = async (): Promise<never> => { credentialReads++; throw Error("No ambient credentials"); };
  const models = createModels({ authContext: { env: noCredentials, fileExists: noCredentials } });
  models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "Keyless synthetic", resolve: async () => ({ auth: {}, source: "synthetic" }) } }, api: { stream, streamSimple: stream } }));
  const open = async () => Harness.open(await SqliteStorage.open(new BunSqliteDatabase(join(dir, "graph.sqlite"))),
    { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
  let harness = await open();
  try {
    const agent = { model: { provider: model.provider, modelId: model.id }, extensions: [extension], tools };
    const conversation = await harness.root(context, { agent });
    expect((await conversation.agent(context)).tools.map(tool => tool.name).sort()).toEqual(delegate ? ["delegate"] : ["code_review", "remote_peer"]);
    const submission = await conversation.submit({ type: "input", requestId: "actual-addon-roundtrip", content: "List assigned reviews, then peer status." }, context);
    await submission.wait(context);
    const status = await submission.status(context);
    if (status.type !== "input" || status.status !== "done") throw Error(JSON.stringify(status));
    const answer = await conversation.commit(tx => tx.entry(AssistantEntry, status.answer), context);
    expect(JSON.stringify(answer?.model)).toContain(delegate ? "synthetic delegate complete" : "No assigned reviews; remote peer disabled.");
    const entries = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
    const results = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
    expect(results.map(message => message.toolName)).toEqual(delegate ? ["delegate"] : ["code_review", "remote_peer"]);
    expect(results.every(message => !message.isError)).toBe(true);
    if (delegate) {
      expect(JSON.stringify(results[0]?.content)).toContain("SYNTHETIC_CHILD_RESULT");
      expect(JSON.stringify(requests[1])).toContain("delegate-call");
      expect(JSON.stringify(entries)).toContain("ephemeral_session");
    } else {
      expect(results[0]?.content).toEqual([{ type: "text", text: "[]" }]);
      expect(JSON.stringify(results[1]?.content)).toContain("enabled");
      expect(JSON.stringify(requests[2])).toContain("peer-status");
    }
    expect(JSON.stringify(entries)).toContain('"details"');
    expect(invocations()).toBe(delegate ? 1 : 2); expect(modelCalls).toBe(delegate ? 2 : 3); expect(credentialReads).toBe(0);
    const priorData = serviceData();
    const priorContext = await conversation.context(context);
    await harness.close(context);
    revoke(); // Fresh paused open has no host authority to execute or replay tools.
    harness = await open();
    const reopened = await harness.root(context, { agent });
    expect(reopened.id).toBe(conversation.id);
    expect(await reopened.context(context)).toEqual(priorContext);
    expect((await reopened.entries({ order: "ascending" }, 100, undefined, context)).items).toEqual(entries);
    const restored = await harness.submission(submission.id, context);
    expect(await restored?.status(context)).toEqual(status);
    await harness.inspect(context); await Bun.sleep(10);
    expect(modelCalls).toBe(delegate ? 2 : 3); expect(invocations()).toBe(delegate ? 1 : 2); expect(credentialReads).toBe(0);
    expect(serviceData()).toEqual(priorData);
    expect(tools.every(tool => tool.replay === "unsafe")).toBe(true);
  } finally { await harness.close(context); }
}
