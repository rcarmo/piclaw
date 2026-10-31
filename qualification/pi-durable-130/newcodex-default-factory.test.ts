import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import { expect } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { ModelRuntime } from "../../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { createProvider, createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai/dist/index.js";
import { createHostModels } from "../../runtime/durable-engine/src/host-models.ts";
import { HostCodexModelServices } from "../../runtime/durable-engine/src/host-codex-model-services.ts";

const routingOwner = {};
const routingScope = () => ({ turnId: "fixture-turn", accountRef: "fixture-account", provider: routingOwner });

// Regression for the factory prerequisite, not a default-factory qualification receipt.
applicationTest("normal public Root stream preserves original request signal and actual physical model at Codex capture", async () => {
  const root = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false,
    credentials: { read: async () => undefined, get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] } as any });
  const model: any = { provider: "github-copilot", id: "fixture-actual", api: "openai-responses",
    name: "fixture", type: "chat", baseUrl: "https://synthetic.invalid", reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100, maxTokens: 10 };
  const usage = { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const message: any = { role: "assistant", provider: model.provider, model: model.id, api: model.api,
    content: [{ type: "text", text: "fixture result" }], timestamp: 1, stopReason: "stop", usage };
  let requests = 0, captured = false, settled = false;
  const stream = () => {
    requests++;
    const output = createAssistantMessageEventStream();
    queueMicrotask(() => { output.push({ type: "done", reason: "stop", message }); output.end(message); });
    return output;
  };
  root.registerNativeProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "synthetic", resolve: async () => ({ auth: { apiKey: "synthetic" }, source: "fixture" }) } },
    api: { stream, streamSimple: stream } }));
  const request = new AbortController(), lifetime = new AbortController();
  const codex = new HostCodexModelServices({ routingScope,
    async capture(combined, actual, original) {
      expect(original).toBe(request.signal);
      expect(combined).not.toBe(original);
      expect(actual.provider).toBe(model.provider);
      expect(actual.api).toBe(model.api);
      expect(actual.id).toBe("fixture-actual");
      captured = true;
      return { id: "actual-operation", sessionId: "actual-session", cwd: "/synthetic", model: actual,
        signal: combined, assertCurrent() { original!.throwIfAborted(); } };
    },
    assertAccount() {},
    async observe() { throw Error("No Codex output expected for Copilot"); },
    async flush() { throw Error("No Codex output expected for Copilot"); },
  }, { createNativeCodexHooks: () => ({ request: p => p, headers: h => h, context: m => [...m], systemPrompt: p => p }) });
  const models = createHostModels(root, [model], { signal: lifetime.signal, codex,
    authorize: async () => {}, assertCurrent() {},
    prepareRequest: async () => ({ retainTerminal: async result => { expect(result.usage.totalTokens).toBe(5); return structuredClone(result); }, dispatch: async () => {}, settle: async result => {
      expect(result.usage.totalTokens).toBe(5); settled = true;
    }, abandon: async () => { throw Error("Unexpected abandon"); } }),
  });
  const result = await models.streamSimple(models.getModel(model.provider, model.id)!, { messages: [] }, { signal: request.signal }).result();
  expect(result.stopReason).toBe("stop");
  expect(result.usage.totalTokens).toBe(5);
  expect([requests, captured, settled]).toEqual([1, true, true]);
});
